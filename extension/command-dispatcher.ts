// command-dispatcher.ts
// Implements all Tier 1 browser commands for the bidirectional command protocol.
// Runs in the service worker context (isolated world, full Chrome API access).

const CAPTURE_SETTINGS_STORAGE_KEY = 'ccCaptureSettings';

export async function dispatchCommand(
  command: string,
  tabId: number,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (command) {
    case 'list_tabs':             return cmdListTabs(tabId, params);
    case 'screenshot':            return cmdScreenshot(tabId, params);
    case 'navigate':              return cmdNavigate(tabId, params);
    case 'reload':                return cmdReload(tabId, params);
    case 'get_page_content':      return cmdGetPageContent(tabId, params);
    case 'find_elements':         return cmdFindElements(tabId, params);
    case 'evaluate_js':           return cmdEvaluateJs(tabId, params);
    case 'click':                 return cmdClick(tabId, params);
    case 'type':                  return cmdType(tabId, params);
    case 'scroll':                return cmdScroll(tabId, params);
    case 'wait_for':              return cmdWaitFor(tabId, params);
    case 'get_cookies':           return cmdGetCookies(tabId, params);
    case 'get_storage':           return cmdGetStorage(tabId, params);
    case 'get_selection':         return cmdGetSelection(tabId, params);
    case 'get_capture_settings':  return cmdGetCaptureSettings(tabId, params);
    case 'set_element_text':      return cmdSetElementText(tabId, params);
    case 'set_element_html':      return cmdSetElementHtml(tabId, params);
    case 'set_element_style':     return cmdSetElementStyle(tabId, params);
    case 'add_element_class':     return cmdAddElementClass(tabId, params);
    case 'remove_element_class':  return cmdRemoveElementClass(tabId, params);
    case 'get_computed_style':    return cmdGetComputedStyle(tabId, params);
    case 'get_element_properties': return cmdGetElementProperties(tabId, params);
    case 'highlight_element':     return cmdHighlightElement(tabId, params);
    default:
      throw new Error(`Unknown browser command: ${command}`);
  }
}

function toScriptArg<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

function normalizeClassNames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const names = raw
    .flatMap((entry) => typeof entry === 'string' ? entry.split(/\s+/) : [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function normalizeStyleMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || entry == null) continue;
    out[key] = String(entry);
  }
  return out;
}

function normalizeStyleProperties(value: unknown): string[] {
  const defaults = [
    'display',
    'visibility',
    'opacity',
    'color',
    'backgroundColor',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'position',
    'zIndex',
    'width',
    'height',
    'margin',
    'padding',
    'border',
  ];
  if (!Array.isArray(value)) {
    return defaults;
  }
  const properties = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return properties.length > 0 ? [...new Set(properties)] : defaults;
}

function summarizeTabForList(tab: chrome.tabs.Tab) {
  return {
    tabId: tab.id!,
    windowId: tab.windowId ?? null,
    title: tab.title || '',
    url: tab.url || '',
    faviconUrl: tab.favIconUrl,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible),
    discarded: Boolean(tab.discarded),
    status: tab.status ?? 'unknown',
  };
}

// --- Tab Listing ---

async function cmdListTabs(
  _tabId: number,
  params: Record<string, unknown>
): Promise<{
  windowScope: 'last_focused' | 'all';
  activeOnly: boolean;
  count: number;
  tabs: Array<ReturnType<typeof summarizeTabForList>>;
}> {
  const windowScope = params.window_scope === 'all' ? 'all' : 'last_focused';
  const activeOnly = params.active_only === true;
  const query: chrome.tabs.QueryInfo = {};

  if (windowScope === 'last_focused') {
    query.lastFocusedWindow = true;
  }
  if (activeOnly) {
    query.active = true;
  }

  const tabs = await chrome.tabs.query(query);
  const summaries = tabs
    .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id != null)
    .map((tab) => summarizeTabForList(tab));

  return {
    windowScope,
    activeOnly,
    count: summaries.length,
    tabs: summaries,
  };
}

// --- Screenshot ---

async function cmdScreenshot(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ dataUrl: string; format: string }> {
  const format = (params.format === 'jpeg' ? 'jpeg' : 'png') as 'png' | 'jpeg';
  const quality = typeof params.quality === 'number' ? params.quality : 90;
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format, quality });
  return { dataUrl, format };
}

// --- Navigation ---

async function cmdNavigate(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ url: string; status: string }> {
  const url = String(params.url);
  const waitForLoad = params.wait_for_load !== false;
  await chrome.tabs.update(tabId, { url });
  if (waitForLoad) {
    await waitForTabLoad(tabId);
  }
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url ?? url, status: tab.status ?? 'unknown' };
}

async function cmdReload(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ status: string }> {
  const bypassCache = params.bypass_cache === true;
  await chrome.tabs.reload(tabId, { bypassCache });
  await waitForTabLoad(tabId);
  return { status: 'complete' };
}

function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message ?? 'Tab unavailable'));
        }
        if (tab.status === 'complete') return resolve();
        if (Date.now() > deadline) return reject(new Error(`Navigation timeout after ${timeoutMs}ms`));
        setTimeout(check, 150);
      });
    }
    setTimeout(check, 150);
  });
}

// --- Live Page Content ---

async function cmdGetPageContent(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ url: string; title: string; text: string; html?: string }> {
  const maxChars = Math.min(typeof params.max_chars === 'number' ? params.max_chars : 200_000, 500_000);
  const includeHtml = params.include_html === true;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (max: number, html: boolean) => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? '').slice(0, max),
      html: html ? (document.documentElement?.outerHTML ?? '').slice(0, max) : undefined,
    }),
    args: [maxChars, includeHtml],
  });
  return result.result as { url: string; title: string; text: string; html?: string };
}

async function cmdFindElements(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ elements: Array<{ tag: string; id: string; text: string; rect: object; pageX: number; pageY: number }> }> {
  const selector = String(params.selector ?? '*');
  const limit = typeof params.limit === 'number' ? params.limit : 50;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, lim: number) => {
      const nodes = Array.from(document.querySelectorAll(sel)).slice(0, lim);
      return {
        elements: nodes.map(el => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id ?? '',
            text: ((el as HTMLElement).innerText ?? '').slice(0, 500),
            // viewport-relative (may change after scroll)
            rect: r.toJSON(),
            // page-relative (stable regardless of scroll position)
            pageX: Math.round(r.left + window.scrollX),
            pageY: Math.round(r.top + window.scrollY),
          };
        }),
      };
    },
    args: [selector, limit],
  });
  return result.result as { elements: Array<{ tag: string; id: string; text: string; rect: object; pageX: number; pageY: number }> };
}

// --- JavaScript Evaluation ---

async function cmdEvaluateJs(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ result: unknown; error?: string; consoleEntries?: Array<{ level: string; message: string; timestamp: number; source: string }> }> {
  const expression = String(params.expression ?? '');
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',  // Run in page context so page CSP (unsafe-eval) doesn't apply
    func: (expr: string) => {
      const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
      const originals = new Map<typeof levels[number], (...args: any[]) => void>();
      const consoleEntries: Array<{ level: string; message: string; timestamp: number; source: string }> = [];
      const stringifyConsoleArg = (value: unknown) => {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); }
        catch { return String(value); }
      };

      try {
        for (const level of levels) {
          const original = console[level].bind(console);
          originals.set(level, original);
          console[level] = (...args: any[]) => {
            consoleEntries.push({
              level,
              message: args.map(stringifyConsoleArg).join(' '),
              timestamp: Date.now(),
              source: 'evaluate_js',
            });
            return original(...args);
          };
        }
        // eslint-disable-next-line no-eval
        const result = eval(expr);
        const response = (() => {
          try { JSON.stringify(result); } catch { return { result: String(result) }; }
          return { result };
        })();
        return { ...response, consoleEntries };
      } catch (e) {
        return { result: null, error: String(e), consoleEntries };
      } finally {
        for (const [level, original] of originals) {
          console[level] = original;
        }
      }
    },
    args: [expression],
  });
  return res.result as { result: unknown; error?: string; consoleEntries?: Array<{ level: string; message: string; timestamp: number; source: string }> };
}

// --- Interaction ---

async function cmdClick(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ clicked: boolean; error?: string }> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const x = typeof params.x === 'number' ? params.x : undefined;
  const y = typeof params.y === 'number' ? params.y : undefined;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string | null, cx: number | null, cy: number | null) => {
      let el: Element | null = null;
      if (sel) {
        el = document.querySelector(sel);
        if (!el) return { clicked: false, error: `Element not found: ${sel}` };
        // Scroll into view so the element is in the viewport before clicking
        (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
      } else if (cx !== null && cy !== null) {
        // x/y are viewport-relative; scroll first if needed via caller
        el = document.elementFromPoint(cx, cy);
        if (!el) return { clicked: false, error: `No element at (${cx}, ${cy})` };
      } else {
        return { clicked: false, error: 'selector or x/y required' };
      }
      (el as HTMLElement).click();
      return { clicked: true };
    },
    args: [toScriptArg(selector), toScriptArg(x), toScriptArg(y)],
  });
  return result.result as { clicked: boolean; error?: string };
}

async function cmdType(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ typed: boolean; error?: string }> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const x = typeof params.x === 'number' ? params.x : undefined;
  const y = typeof params.y === 'number' ? params.y : undefined;
  const text = String(params.text ?? '');
  const clear = params.clear === true;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string | null, cx: number | null, cy: number | null, txt: string, clr: boolean) => {
      let el: HTMLInputElement | null = null;
      if (sel) {
        el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return { typed: false, error: `Element not found: ${sel}` };
      } else if (cx !== null && cy !== null) {
        el = document.elementFromPoint(cx, cy) as HTMLInputElement | null;
        if (!el) return { typed: false, error: `No element at (${cx}, ${cy})` };
      } else {
        return { typed: false, error: 'selector or x/y required' };
      }
      el.focus();
      if (clr) el.value = '';
      el.value += txt;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true };
    },
    args: [toScriptArg(selector), toScriptArg(x), toScriptArg(y), text, clear],
  });
  return result.result as { typed: boolean; error?: string };
}

async function cmdScroll(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ scrolled: boolean }> {
  const selector = typeof params.selector === 'string' ? params.selector : undefined;
  const x = typeof params.x === 'number' ? params.x : 0;
  const y = typeof params.y === 'number' ? params.y : 0;
  const behavior = params.behavior === 'smooth' ? 'smooth' : 'instant';
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string | null, sx: number, sy: number, beh: string) => {
      if (sel) {
        const el = document.querySelector(sel);
        el?.scrollIntoView({ behavior: beh as ScrollBehavior });
      } else {
        window.scrollTo({ left: sx, top: sy, behavior: beh as ScrollBehavior });
      }
      return { scrolled: true };
    },
    args: [toScriptArg(selector), x, y, behavior],
  });
  return result.result as { scrolled: boolean };
}

// --- Wait For Condition ---

async function cmdWaitFor(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ satisfied: boolean; elapsed: number }> {
  const condition = String(params.condition ?? 'load');
  const value = typeof params.value === 'string' ? params.value : '';
  const timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : 10_000;
  const start = Date.now();
  const deadline = start + timeoutMs;

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) break;

    if (condition === 'load' && tab.status === 'complete') {
      return { satisfied: true, elapsed: Date.now() - start };
    }
    if (condition === 'url' && (tab.url ?? '').includes(value)) {
      return { satisfied: true, elapsed: Date.now() - start };
    }
    if (condition === 'title' && (tab.title ?? '').includes(value)) {
      return { satisfied: true, elapsed: Date.now() - start };
    }
    if (condition === 'selector') {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel: string) => !!document.querySelector(sel),
        args: [value],
      }).catch(() => [{ result: false }]);
      if (res.result) return { satisfied: true, elapsed: Date.now() - start };
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return { satisfied: false, elapsed: timeoutMs };
}

// --- Cookies ---

async function cmdGetCookies(
  _tabId: number,
  params: Record<string, unknown>
): Promise<{ cookies: chrome.cookies.Cookie[] }> {
  const details: chrome.cookies.GetAllDetails = {};
  if (typeof params.url === 'string') details.url = params.url;
  if (typeof params.name === 'string') details.name = params.name;
  if (typeof params.domain === 'string') details.domain = params.domain;
  const cookies = await chrome.cookies.getAll(details);
  return { cookies };
}

// --- Selection ---

async function cmdGetSelection(
  tabId: number,
  _params: Record<string, unknown>
): Promise<{ selection: string; hasSelection: boolean }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : '';
      return { selection: text, hasSelection: text.length > 0 };
    },
    args: [],
  });
  return result.result as { selection: string; hasSelection: boolean };
}


// --- Storage ---

async function cmdGetStorage(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ localStorage?: Record<string, string>; sessionStorage?: Record<string, string> }> {
  const storageType = String(params.storage_type ?? 'both');
  const keys = Array.isArray(params.keys) ? params.keys as string[] : null;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (type: string, ks: string[] | null) => {
      function dump(store: Storage): Record<string, string> {
        const out: Record<string, string> = {};
        const keyList = ks ?? Object.keys(store);
        for (const k of keyList) {
          const v = store.getItem(k);
          if (v !== null) out[k] = v;
        }
        return out;
      }
      return {
        localStorage: type !== 'session' ? dump(localStorage) : undefined,
        sessionStorage: type !== 'local' ? dump(sessionStorage) : undefined,
      };
    },
    args: [storageType, keys],
  });
  return result.result as { localStorage?: Record<string, string>; sessionStorage?: Record<string, string> };
}

async function cmdGetCaptureSettings(
  _tabId: number,
  _params: Record<string, unknown>
): Promise<{ captureResponseBodies: boolean }> {
  const items = await chrome.storage.local.get({
    [CAPTURE_SETTINGS_STORAGE_KEY]: { captureResponseBodies: false },
  });
  const raw = items[CAPTURE_SETTINGS_STORAGE_KEY] as { captureResponseBodies?: unknown } | undefined;
  return {
    captureResponseBodies: raw?.captureResponseBodies === true,
  };
}

// --- Element Mutation / Inspection ---

async function cmdSetElementText(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; previousText?: string; text?: string; error?: string }> {
  const selector = String(params.selector ?? '');
  const text = String(params.text ?? '');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, nextText: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      const previousText = el.textContent ?? '';
      el.textContent = nextText;
      return { success: true, previousText, text: el.textContent ?? '' };
    },
    args: [selector, text],
  });
  return result.result as { success: boolean; previousText?: string; text?: string; error?: string };
}

async function cmdSetElementHtml(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; previousHtml?: string; html?: string; sanitized?: boolean; error?: string }> {
  const selector = String(params.selector ?? '');
  const html = String(params.html ?? '');
  const sanitize = params.sanitize !== false;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, nextHtml: string, shouldSanitize: boolean) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      const previousHtml = el.innerHTML;

      if (shouldSanitize) {
        const template = document.createElement('template');
        template.innerHTML = nextHtml;
        template.content.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach((node) => node.remove());
        template.content.querySelectorAll<HTMLElement>('*').forEach((node) => {
          for (const attr of Array.from(node.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:'))) {
              node.removeAttribute(attr.name);
            }
          }
        });
        el.replaceChildren(template.content.cloneNode(true));
      } else {
        el.innerHTML = nextHtml;
      }

      return { success: true, previousHtml, html: el.innerHTML, sanitized: shouldSanitize };
    },
    args: [selector, html, sanitize],
  });
  return result.result as { success: boolean; previousHtml?: string; html?: string; sanitized?: boolean; error?: string };
}

async function cmdSetElementStyle(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; previousStyles?: Record<string, string>; currentStyles?: Record<string, string>; error?: string }> {
  const selector = String(params.selector ?? '');
  const styles = normalizeStyleMap(params.styles);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, nextStyles: Record<string, string>) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      const previousStyles: Record<string, string> = {};
      const currentStyles: Record<string, string> = {};
      for (const [property, value] of Object.entries(nextStyles)) {
        const cssProperty = property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
        previousStyles[property] = el.style.getPropertyValue(cssProperty) || (el.style as unknown as Record<string, string>)[property] || '';
        if (property.includes('-')) {
          el.style.setProperty(property, value);
        } else {
          (el.style as unknown as Record<string, string>)[property] = value;
        }
        currentStyles[property] = el.style.getPropertyValue(cssProperty) || (el.style as unknown as Record<string, string>)[property] || '';
      }
      return { success: true, previousStyles, currentStyles };
    },
    args: [selector, styles],
  });
  return result.result as { success: boolean; previousStyles?: Record<string, string>; currentStyles?: Record<string, string>; error?: string };
}

async function cmdAddElementClass(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; addedClasses?: string[]; currentClasses?: string[]; error?: string }> {
  const selector = String(params.selector ?? '');
  const classes = normalizeClassNames(params.classes);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, classNames: string[]) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      el.classList.add(...classNames);
      return { success: true, addedClasses: classNames, currentClasses: Array.from(el.classList) };
    },
    args: [selector, classes],
  });
  return result.result as { success: boolean; addedClasses?: string[]; currentClasses?: string[]; error?: string };
}

async function cmdRemoveElementClass(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; removedClasses?: string[]; currentClasses?: string[]; error?: string }> {
  const selector = String(params.selector ?? '');
  const classes = normalizeClassNames(params.classes);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, classNames: string[]) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      el.classList.remove(...classNames);
      return { success: true, removedClasses: classNames, currentClasses: Array.from(el.classList) };
    },
    args: [selector, classes],
  });
  return result.result as { success: boolean; removedClasses?: string[]; currentClasses?: string[]; error?: string };
}

async function cmdGetComputedStyle(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; styles?: Record<string, string>; error?: string }> {
  const selector = String(params.selector ?? '');
  const properties = normalizeStyleProperties(params.properties);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, props: string[]) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      const computed = window.getComputedStyle(el);
      const styles: Record<string, string> = {};
      for (const property of props) {
        styles[property] = computed.getPropertyValue(property) || (computed as unknown as Record<string, string>)[property] || '';
      }
      return { success: true, styles };
    },
    args: [selector, properties],
  });
  return result.result as { success: boolean; styles?: Record<string, string>; error?: string };
}

async function cmdGetElementProperties(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; properties?: Record<string, unknown>; error?: string }> {
  const selector = String(params.selector ?? '');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      const rect = el.getBoundingClientRect();
      const attributes = Object.fromEntries(Array.from(el.attributes).map((attr) => [attr.name, attr.value]));
      return {
        success: true,
        properties: {
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          attributes,
          textContent: el.textContent ?? '',
          innerHTML: el.innerHTML,
          value: 'value' in el ? String((el as HTMLInputElement).value ?? '') : undefined,
          checked: 'checked' in el ? Boolean((el as HTMLInputElement).checked) : undefined,
          disabled: 'disabled' in el ? Boolean((el as HTMLInputElement).disabled) : undefined,
          dimensions: { width: rect.width, height: rect.height },
          position: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
          pagePosition: { x: rect.left + window.scrollX, y: rect.top + window.scrollY },
        },
      };
    },
    args: [selector],
  });
  return result.result as { success: boolean; properties?: Record<string, unknown>; error?: string };
}

async function cmdHighlightElement(
  tabId: number,
  params: Record<string, unknown>
): Promise<{ success: boolean; highlightId?: string; error?: string }> {
  const selector = String(params.selector ?? '');
  const color = typeof params.color === 'string' && params.color.trim() ? params.color : 'red';
  const duration = typeof params.duration === 'number' ? Math.max(0, params.duration) : 0;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, highlightColor: string, durationMs: number) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { success: false, error: `Element not found: ${sel}` };
      const rect = el.getBoundingClientRect();
      const highlightId = `claudechrome-highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const overlay = document.createElement('div');
      overlay.id = highlightId;
      overlay.setAttribute('data-claudechrome-highlight', '1');
      overlay.style.position = 'fixed';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.border = `2px solid ${highlightColor}`;
      overlay.style.background = 'transparent';
      overlay.style.boxSizing = 'border-box';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '2147483647';
      document.documentElement.appendChild(overlay);
      if (durationMs > 0) {
        window.setTimeout(() => overlay.remove(), durationMs);
      }
      return { success: true, highlightId };
    },
    args: [selector, color, duration],
  });
  return result.result as { success: boolean; highlightId?: string; error?: string };
}
