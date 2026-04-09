const MAX_VISIBLE_TEXT_CHARS = 8_000;
const MAX_HTML_CHARS = 8_000;
const PAGE_INFO_MUTATION_DEBOUNCE_MS = 1_000;
const PAGE_INFO_BACKGROUND_MIN_INTERVAL_MS = 5_000;
const CAPTURE_SETTINGS_STORAGE_KEY = 'ccCaptureSettings';
const CAPTURE_RESPONSE_BODIES_DATASET_KEY = 'claudechromeCaptureResponseBodies';

type CaptureSettings = {
  captureResponseBodies: boolean;
};

type QueuePageInfoOptions = {
  includeHtml?: boolean;
  priority?: 'background' | 'immediate';
};

function safeSendMessage(message: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // Extension context invalidated (e.g. extension reloaded) — ignore.
  }
}

let lastPageInfoKey = '';
let lastPageInfoSentAt = 0;
let pageInfoTimer: number | null = null;
let queuedPageInfoIncludeHtml = false;
let queuedPageInfoPriority: 'background' | 'immediate' = 'background';
const root = document.documentElement;

function applyCaptureSettings(settings: CaptureSettings): void {
  if (!root) {
    return;
  }
  root.dataset[CAPTURE_RESPONSE_BODIES_DATASET_KEY] = settings.captureResponseBodies ? '1' : '0';
}

function normalizeCaptureSettings(value: unknown): CaptureSettings {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<CaptureSettings>;
    return {
      captureResponseBodies: candidate.captureResponseBodies === true,
    };
  }
  return { captureResponseBodies: false };
}

function loadCaptureSettings(): void {
  applyCaptureSettings({ captureResponseBodies: false });
  try {
    chrome.storage.local.get({
      [CAPTURE_SETTINGS_STORAGE_KEY]: { captureResponseBodies: false },
    }, (items) => {
      applyCaptureSettings(normalizeCaptureSettings(items[CAPTURE_SETTINGS_STORAGE_KEY]));
    });
  } catch {
    applyCaptureSettings({ captureResponseBodies: false });
  }
}

if (root?.dataset.claudechromeInjectorInstalled === '1') {
  loadCaptureSettings();
  queuePageInfoSend(0, { priority: 'background' });
} else {
  if (root) {
    root.dataset.claudechromeInjectorInstalled = '1';
  }
  loadCaptureSettings();

  // Content script: injects page-script.js into the page context.
  // This runs in the content script isolated world.
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/page-script.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  queuePageInfoSend(0, { includeHtml: true, priority: 'immediate' });
  window.addEventListener('load', () => queuePageInfoSend(0, { includeHtml: true, priority: 'immediate' }));
  window.addEventListener('popstate', () => queuePageInfoSend(0, { includeHtml: true, priority: 'immediate' }));
  window.addEventListener('hashchange', () => queuePageInfoSend(0, { includeHtml: true, priority: 'immediate' }));

  const titleObserverTarget = document.querySelector('title') || document.head || document.documentElement;
  if (titleObserverTarget) {
    new MutationObserver(() => queuePageInfoSend(0, { priority: 'background' })).observe(titleObserverTarget, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  new MutationObserver(() => {
    queuePageInfoSend(PAGE_INFO_MUTATION_DEBOUNCE_MS, { priority: 'background' });
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[CAPTURE_SETTINGS_STORAGE_KEY]) {
      return;
    }
    applyCaptureSettings(normalizeCaptureSettings(changes[CAPTURE_SETTINGS_STORAGE_KEY].newValue));
  });

  // Bridge: listen for messages from page-script (via window.postMessage).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'claudechrome-page') return;

    const msg = event.data;
    if (msg.type === 'captured_body') {
      safeSendMessage({
        type: 'captured_body',
        url: msg.url,
        body: msg.body,
        method: msg.method,
      });
    } else if (msg.type === 'console_entry') {
      safeSendMessage({
        type: 'console_entry',
        entry: msg.entry,
      });
    }
  });
}

function queuePageInfoSend(delayMs: number, options: QueuePageInfoOptions = {}): void {
  const includeHtml = options.includeHtml === true;
  const priority = options.priority === 'immediate' ? 'immediate' : 'background';

  queuedPageInfoIncludeHtml = queuedPageInfoIncludeHtml || includeHtml;
  if (priority === 'immediate') {
    queuedPageInfoPriority = 'immediate';
  }

  if (pageInfoTimer != null) {
    window.clearTimeout(pageInfoTimer);
  }

  const now = Date.now();
  const throttleDelay = queuedPageInfoPriority === 'background'
    ? Math.max(0, lastPageInfoSentAt + PAGE_INFO_BACKGROUND_MIN_INTERVAL_MS - now)
    : 0;

  pageInfoTimer = window.setTimeout(() => {
    pageInfoTimer = null;
    const nextIncludeHtml = queuedPageInfoIncludeHtml;
    queuedPageInfoIncludeHtml = false;
    queuedPageInfoPriority = 'background';
    sendPageInfo({ includeHtml: nextIncludeHtml });
  }, Math.max(delayMs, throttleDelay));
}

function collectScripts(): string[] {
  return Array.from(document.scripts).map((script, index) => script.src || `inline:${index}`);
}

function collectMeta(): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [index, element] of Array.from(document.querySelectorAll<HTMLMetaElement>('meta')).entries()) {
    const key = element.getAttribute('name')
      || element.getAttribute('property')
      || element.getAttribute('http-equiv')
      || `meta_${index}`;
    const value = element.getAttribute('content');
    if (key && value) {
      meta[key] = value;
    }
  }

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) {
    meta.canonical = canonical;
  }

  return meta;
}

function buildPageInfoKey(info: {
  url: string;
  title: string;
  visibleText: string;
  html: string;
}): string {
  return [
    info.url,
    info.title,
    String(info.visibleText.length),
    info.visibleText.slice(0, 512),
    info.visibleText.slice(-512),
    String(info.html.length),
    info.html.slice(0, 512),
    info.html.slice(-512),
  ].join('\n');
}

function sendPageInfo(options: { includeHtml?: boolean } = {}): void {
  const includeHtml = options.includeHtml === true;
  const info = {
    url: window.location.href,
    title: document.title,
    scripts: collectScripts(),
    meta: collectMeta(),
    visibleText: document.body?.innerText?.slice(0, MAX_VISIBLE_TEXT_CHARS) || '',
    html: includeHtml ? (document.documentElement?.outerHTML?.slice(0, MAX_HTML_CHARS) || '') : '',
  };
  const nextKey = buildPageInfoKey(info);
  if (nextKey === lastPageInfoKey) return;

  lastPageInfoKey = nextKey;
  lastPageInfoSentAt = Date.now();

  safeSendMessage({
    type: 'page_info',
    info,
  });
}
