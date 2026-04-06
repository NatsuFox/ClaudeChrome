import type {
  CapturedRequest,
  ConsoleEntry,
  PageInfo,
  TabSummary,
} from './shared/types';
import { dispatchCommand } from './command-dispatcher';

type TabContextState = {
  tab: TabSummary;
  pageInfo: PageInfo | null;
  requestsByBrowserRequestId: Map<string, CapturedRequest>;
  consoleLogs: ConsoleEntry[];
};

type SidePanelCloseOptions = {
  tabId?: number;
  windowId?: number;
};

type SidePanelApi = typeof chrome.sidePanel & {
  close?: (options: SidePanelCloseOptions) => Promise<void> | void;
  onClosed?: {
    addListener: (listener: (info: SidePanelCloseOptions) => void) => void;
  };
  onOpened?: {
    addListener: (listener: (info: SidePanelCloseOptions) => void) => void;
  };
};

const tabContexts = new Map<number, TabContextState>();
const MAX_REQUESTS = 200;
const MAX_CONSOLE = 2000;
const SIDE_PANEL_PATH = 'side-panel/panel.html';
const sidePanelApi = chrome.sidePanel as SidePanelApi;
const openPanelWindows = new Set<number>();

let reqCounter = 0;

function nextReqId(): string {
  return `req_${Date.now()}_${++reqCounter}`;
}

function cloneTabSummary(tab: TabSummary): TabSummary {
  return { ...tab };
}

function cloneRequest(entry: CapturedRequest): CapturedRequest {
  return {
    ...entry,
    requestHeaders: { ...entry.requestHeaders },
    ...(entry.responseHeaders ? { responseHeaders: { ...entry.responseHeaders } } : {}),
  };
}

function cloneConsoleEntry(entry: ConsoleEntry): ConsoleEntry {
  return { ...entry };
}

function clonePageInfo(info: PageInfo): PageInfo {
  return {
    ...info,
    scripts: [...info.scripts],
    meta: { ...info.meta },
  };
}

function createEmptyTabSummary(tabId: number): TabSummary {
  return {
    tabId,
    windowId: null,
    title: `Tab ${tabId}`,
    url: '',
    available: true,
    lastSeenAt: Date.now(),
  };
}

function ensureTabContext(tabId: number): TabContextState {
  let context = tabContexts.get(tabId);
  if (!context) {
    context = {
      tab: createEmptyTabSummary(tabId),
      pageInfo: null,
      requestsByBrowserRequestId: new Map<string, CapturedRequest>(),
      consoleLogs: [],
    };
    tabContexts.set(tabId, context);
  }
  return context;
}

function updateTabSummary(tabId: number, patch: Partial<TabSummary>): TabSummary {
  const context = ensureTabContext(tabId);
  context.tab = {
    ...context.tab,
    ...patch,
    tabId,
    lastSeenAt: patch.lastSeenAt ?? Date.now(),
  };
  return cloneTabSummary(context.tab);
}

function tabSummaryFromChromeTab(tab: chrome.tabs.Tab): TabSummary | null {
  if (tab.id == null) return null;
  return {
    tabId: tab.id,
    windowId: tab.windowId ?? null,
    title: tab.title || '',
    url: tab.url || '',
    faviconUrl: tab.favIconUrl,
    available: true,
    lastSeenAt: Date.now(),
  };
}

function forwardContextUpdate(category: 'network' | 'console' | 'page_info' | 'tab_state', payload: unknown): void {
  chrome.runtime.sendMessage(
    { type: 'context_update', category, payload },
    () => void chrome.runtime.lastError
  );
}

function pushTabState(tabId: number): void {
  const context = tabContexts.get(tabId);
  if (!context) return;
  forwardContextUpdate('tab_state', cloneTabSummary(context.tab));
}

function pushPageInfo(tabId: number): void {
  const context = tabContexts.get(tabId);
  if (!context?.pageInfo) return;
  forwardContextUpdate('page_info', clonePageInfo(context.pageInfo));
}

function isInjectableUrl(url?: string): boolean {
  return Boolean(url && /^(https?|file):/i.test(url));
}

function injectIntoTab(tabId: number): void {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      files: ['content/injector.js'],
    },
    () => void chrome.runtime.lastError
  );
}

function enableSidePanelForTab(tabId: number): void {
  chrome.sidePanel.setOptions({ tabId, enabled: true }, () => void chrome.runtime.lastError);
}

function markPanelOpen(windowId: number | null | undefined): void {
  if (typeof windowId === 'number') {
    openPanelWindows.add(windowId);
  }
}

function markPanelClosed(windowId: number | null | undefined): void {
  if (typeof windowId === 'number') {
    openPanelWindows.delete(windowId);
  }
}

function disableActionClickToggle(): void {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }, () => void chrome.runtime.lastError);
}

function repairSidePanelAvailability(): void {
  disableActionClickToggle();
  chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true }, () => void chrome.runtime.lastError);
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id != null) {
        enableSidePanelForTab(tab.id);
      }
    });
  });
}

function openSidePanelForTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;

  enableSidePanelForTab(tab.id);

  const onOpened = () => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.error(`[ClaudeChrome] Failed to open side panel: ${error.message}`);
      markPanelClosed(tab.windowId);
      return;
    }
    markPanelOpen(tab.windowId);
  };

  if (tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }, onOpened);
    return;
  }

  chrome.sidePanel.open({ tabId: tab.id }, onOpened);
}

function closeSidePanelForWindow(windowId: number): void {
  if (typeof sidePanelApi.close !== 'function') {
    return;
  }

  Promise.resolve(sidePanelApi.close({ windowId }))
    .then(() => {
      markPanelClosed(windowId);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('No active side panel')) {
        markPanelClosed(windowId);
        return;
      }
      console.error(`[ClaudeChrome] Failed to close side panel before toggle: ${message}`);
    });
}

function toggleSidePanelForTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) {
    return;
  }

  updateTabFromChromeTab(tab);
  if (isInjectableUrl(tab.url)) {
    injectIntoTab(tab.id);
  }

  if (tab.windowId != null && openPanelWindows.has(tab.windowId) && typeof sidePanelApi.close === 'function') {
    closeSidePanelForWindow(tab.windowId);
    return;
  }

  openSidePanelForTab(tab);
}

function evictOldRequests(context: TabContextState): void {
  if (context.requestsByBrowserRequestId.size <= MAX_REQUESTS) return;
  const keys = Array.from(context.requestsByBrowserRequestId.keys());
  const toRemove = keys.slice(0, keys.length - MAX_REQUESTS);
  for (const key of toRemove) {
    context.requestsByBrowserRequestId.delete(key);
  }
}

function updateTabFromChromeTab(tab?: chrome.tabs.Tab): TabSummary | null {
  if (!tab?.id) return null;
  const summary = tabSummaryFromChromeTab(tab);
  if (!summary) return null;
  const next = updateTabSummary(tab.id, summary);
  pushTabState(tab.id);
  return next;
}

function refreshTab(tabId: number): void {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      const context = tabContexts.get(tabId);
      if (!context) return;
      context.tab = {
        ...context.tab,
        available: false,
        lastSeenAt: Date.now(),
      };
      pushTabState(tabId);
      return;
    }

    const summary = updateTabFromChromeTab(tab);
    if (summary && isInjectableUrl(summary.url)) {
      injectIntoTab(summary.tabId);
    }
  });
}

function refreshCurrentWindowActiveTab(sendResponse?: (response: unknown) => void): void {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const summary = tabs[0] ? updateTabFromChromeTab(tabs[0]) : null;
    if (summary && isInjectableUrl(summary.url)) {
      injectIntoTab(summary.tabId);
    }
    sendResponse?.({ type: 'get_current_window_active_tab_result', tab: summary });
  });
}

function buildPageInfo(tabId: number, info: Omit<PageInfo, 'tabId' | 'lastSeenAt'>): PageInfo {
  return {
    tabId,
    url: info.url,
    title: info.title,
    scripts: info.scripts ?? [],
    meta: info.meta ?? {},
    visibleText: info.visibleText ?? '',
    html: info.html ?? '',
    faviconUrl: info.faviconUrl,
    lastSeenAt: Date.now(),
  };
}

function findRequestForBody(tabId: number, url: string, method: string): CapturedRequest | null {
  const context = tabContexts.get(tabId);
  if (!context) return null;

  const requests = Array.from(context.requestsByBrowserRequestId.values());
  requests.sort((a, b) => b.startTime - a.startTime);
  return requests.find((entry) => entry.url === url && entry.method === method && !entry.responseBody) || null;
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.type === 'main_frame' || details.tabId < 0) return;

    const context = ensureTabContext(details.tabId);
    const entry: CapturedRequest = {
      id: nextReqId(),
      tabId: details.tabId,
      url: details.url,
      method: details.method,
      requestHeaders: {},
      startTime: details.timeStamp,
    };

    if (details.requestBody) {
      if (details.requestBody.raw?.[0]?.bytes) {
        const decoder = new TextDecoder();
        entry.requestBody = decoder.decode(details.requestBody.raw[0].bytes);
      } else if (details.requestBody.formData) {
        entry.requestBody = JSON.stringify(details.requestBody.formData);
      }
    }

    context.requestsByBrowserRequestId.set(details.requestId, entry);
    evictOldRequests(context);
    updateTabSummary(details.tabId, { available: true, lastSeenAt: Date.now() });
    pushTabState(details.tabId);
    forwardContextUpdate('network', cloneRequest(entry));
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const context = tabContexts.get(details.tabId);
    const entry = context?.requestsByBrowserRequestId.get(details.requestId);
    if (!entry || !details.requestHeaders) return;

    entry.requestHeaders = {};
    for (const header of details.requestHeaders) {
      if (header.name && header.value) {
        entry.requestHeaders[header.name] = header.value;
      }
    }

    forwardContextUpdate('network', cloneRequest(entry));
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const context = tabContexts.get(details.tabId);
    const entry = context?.requestsByBrowserRequestId.get(details.requestId);
    if (!entry || !details.responseHeaders) return;

    entry.responseHeaders = {};
    for (const header of details.responseHeaders) {
      if (header.name && header.value) {
        entry.responseHeaders[header.name] = header.value;
      }
    }
    entry.status = details.statusCode;
    entry.statusText = details.statusLine || '';
    const contentType = details.responseHeaders.find((header) => header.name.toLowerCase() === 'content-type');
    if (contentType?.value) {
      entry.mimeType = contentType.value;
    }

    forwardContextUpdate('network', cloneRequest(entry));
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const context = tabContexts.get(details.tabId);
    const entry = context?.requestsByBrowserRequestId.get(details.requestId);
    if (!entry) return;

    entry.endTime = details.timeStamp;
    entry.status = details.statusCode;
    forwardContextUpdate('network', cloneRequest(entry));
  },
  { urls: ['<all_urls>'] }
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captured_body') {
    if (!sender.tab?.id) return;
    const entry = findRequestForBody(sender.tab.id, msg.url, msg.method);
    if (!entry) return;
    entry.responseBody = msg.body;
    forwardContextUpdate('network', cloneRequest(entry));
    return;
  }

  if (msg.type === 'console_entry') {
    if (!sender.tab?.id) return;
    const context = ensureTabContext(sender.tab.id);
    const entry: ConsoleEntry = {
      ...msg.entry,
      tabId: sender.tab.id,
    };
    context.consoleLogs.push(entry);
    if (context.consoleLogs.length > MAX_CONSOLE) {
      context.consoleLogs.splice(0, context.consoleLogs.length - MAX_CONSOLE);
    }
    updateTabSummary(sender.tab.id, {
      windowId: sender.tab.windowId ?? null,
      title: sender.tab.title || context.tab.title,
      url: sender.tab.url || context.tab.url,
      faviconUrl: sender.tab.favIconUrl || context.tab.faviconUrl,
      available: true,
      lastSeenAt: Date.now(),
    });
    pushTabState(sender.tab.id);
    forwardContextUpdate('console', cloneConsoleEntry(entry));
    return;
  }

  if (msg.type === 'page_info') {
    if (!sender.tab?.id) return;
    const nextPageInfo = buildPageInfo(sender.tab.id, msg.info);
    const context = ensureTabContext(sender.tab.id);
    context.pageInfo = nextPageInfo;
    updateTabSummary(sender.tab.id, {
      windowId: sender.tab.windowId ?? null,
      title: nextPageInfo.title || sender.tab.title || context.tab.title,
      url: nextPageInfo.url || sender.tab.url || context.tab.url,
      faviconUrl: sender.tab.favIconUrl || nextPageInfo.faviconUrl || context.tab.faviconUrl,
      available: true,
      lastSeenAt: nextPageInfo.lastSeenAt,
    });
    pushTabState(sender.tab.id);
    pushPageInfo(sender.tab.id);
    return;
  }

  if (msg.type === 'panel_opened') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      markPanelOpen(tabs[0]?.windowId);
    });
    refreshCurrentWindowActiveTab();
    return;
  }

  if (msg.type === 'panel_closed') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      markPanelClosed(tabs[0]?.windowId);
    });
    return;
  }

  if (msg.type === 'collapse_side_panel') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id || activeTab.windowId == null) {
        sendResponse({
          type: 'collapse_side_panel_result',
          ok: false,
          error: 'No active browser window is available to collapse the side panel.',
        });
        return;
      }

      if (typeof sidePanelApi.close !== 'function') {
        sendResponse({
          type: 'collapse_side_panel_result',
          ok: false,
          error: 'This Chrome build does not support programmatic side panel closing.',
        });
        return;
      }

      Promise.resolve(sidePanelApi.close({ windowId: activeTab.windowId }))
        .then(() => {
          markPanelClosed(activeTab.windowId);
          sendResponse({
            type: 'collapse_side_panel_result',
            ok: true,
          });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('No active side panel')) {
            markPanelClosed(activeTab.windowId);
            sendResponse({
              type: 'collapse_side_panel_result',
              ok: true,
            });
            return;
          }

          sendResponse({
            type: 'collapse_side_panel_result',
            ok: false,
            error: message,
          });
        });
    });
    return true;
  }

  if (msg.type === 'get_current_window_active_tab') {
    refreshCurrentWindowActiveTab(sendResponse);
    return true;
  }

  if (msg.type === 'activate_tab') {
    chrome.tabs.update(msg.tabId, { active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          type: 'activate_tab_result',
          tab: null,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      const summary = tab ? updateTabFromChromeTab(tab) : null;
      if (summary && isInjectableUrl(summary.url)) {
        injectIntoTab(summary.tabId);
      }
      sendResponse({ type: 'activate_tab_result', tab: summary });
    });
    return true;
  }

  if (msg.type === 'browser_command') {
    const { id, tabId, command, params } = msg;
    dispatchCommand(command as string, tabId as number, params as Record<string, unknown>)
      .then((result) => {
        chrome.runtime.sendMessage(
          { type: 'browser_command_result', id, result },
          () => void chrome.runtime.lastError
        );
      })
      .catch((err) => {
        chrome.runtime.sendMessage(
          {
            type: 'browser_command_result',
            id,
            error: err instanceof Error ? err.message : String(err),
          },
          () => void chrome.runtime.lastError
        );
      });
    return true;
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  refreshTab(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  toggleSidePanelForTab(tab);
});

sidePanelApi.onOpened?.addListener((info) => {
  markPanelOpen(info.windowId);
});

sidePanelApi.onClosed?.addListener((info) => {
  markPanelClosed(info.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status || changeInfo.url || changeInfo.title || changeInfo.favIconUrl) {
    updateTabFromChromeTab(tab);
  }

  if (changeInfo.status === 'complete' && isInjectableUrl(tab.url)) {
    injectIntoTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const context = tabContexts.get(tabId);
  if (!context) return;
  context.tab = {
    ...context.tab,
    available: false,
    lastSeenAt: Date.now(),
  };
  pushTabState(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const removed = tabContexts.get(removedTabId);
  if (removed) {
    removed.tab = {
      ...removed.tab,
      available: false,
      lastSeenAt: Date.now(),
    };
    pushTabState(removedTabId);
  }
  refreshTab(addedTabId);
});

chrome.runtime.onInstalled.addListener(() => {
  repairSidePanelAvailability();
  refreshCurrentWindowActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  repairSidePanelAvailability();
});

repairSidePanelAvailability();
refreshCurrentWindowActiveTab();
