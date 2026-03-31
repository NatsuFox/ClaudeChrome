const MAX_VISIBLE_TEXT_CHARS = 200_000;
const MAX_HTML_CHARS = 500_000;
const PAGE_INFO_DEBOUNCE_MS = 250;

function safeSendMessage(message: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // Extension context invalidated (e.g. extension reloaded) — ignore.
  }
}

let lastPageInfoKey = '';
let pageInfoTimer: number | null = null;
const root = document.documentElement;

if (root?.dataset.claudechromeInjectorInstalled === '1') {
  queuePageInfoSend(0);
} else {
  if (root) {
    root.dataset.claudechromeInjectorInstalled = '1';
  }

  // Content script: injects page-script.js into the page context
  // This runs in the content script isolated world.
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/page-script.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  queuePageInfoSend(0);
  window.addEventListener('load', () => queuePageInfoSend(0));
  window.addEventListener('popstate', () => queuePageInfoSend(0));
  window.addEventListener('hashchange', () => queuePageInfoSend(0));

  const titleObserverTarget = document.querySelector('title') || document.head || document.documentElement;
  if (titleObserverTarget) {
    new MutationObserver(() => queuePageInfoSend(0)).observe(titleObserverTarget, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  new MutationObserver(() => queuePageInfoSend(PAGE_INFO_DEBOUNCE_MS)).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
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

function queuePageInfoSend(delayMs: number): void {
  if (pageInfoTimer != null) {
    window.clearTimeout(pageInfoTimer);
  }
  pageInfoTimer = window.setTimeout(() => {
    pageInfoTimer = null;
    sendPageInfo();
  }, delayMs);
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

function sendPageInfo() {
  const info = {
    url: window.location.href,
    title: document.title,
    scripts: collectScripts(),
    meta: collectMeta(),
    visibleText: document.body?.innerText?.slice(0, MAX_VISIBLE_TEXT_CHARS) || '',
    html: document.documentElement?.outerHTML?.slice(0, MAX_HTML_CHARS) || '',
  };
  const nextKey = buildPageInfoKey(info);
  if (nextKey === lastPageInfoKey) return;
  lastPageInfoKey = nextKey;

  safeSendMessage({
    type: 'page_info',
    info,
  });
}
