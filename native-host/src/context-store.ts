export interface StoredTabSummary {
  tabId: number;
  windowId: number | null;
  title: string;
  url: string;
  faviconUrl?: string;
  available: boolean;
  lastSeenAt: number;
}

export interface StoredRequest {
  id: string;
  tabId: number;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  startTime: number;
  endTime?: number;
}

export interface StoredConsoleEntry {
  tabId: number;
  level: string;
  message: string;
  timestamp: number;
}

export interface StoredPageInfo {
  tabId: number;
  url: string;
  title: string;
  scripts: string[];
  meta: Record<string, string>;
  visibleText?: string;
  html?: string;
  faviconUrl?: string;
  lastSeenAt: number;
}

export interface TabCaptureStats {
  tabId: number;
  requestCount: number;
  consoleCount: number;
  hasPageInfo: boolean;
  tabLastSeenAt: number | null;
  pageInfoLastSeenAt: number | null;
  latestRequestAt: number | null;
  latestConsoleAt: number | null;
}

type TabContext = {
  tab: StoredTabSummary;
  requests: Map<string, StoredRequest>;
  consoleLogs: StoredConsoleEntry[];
  pageInfo: StoredPageInfo | null;
};

export class ContextStore {
  private tabContexts = new Map<number, TabContext>();

  private readonly maxRequests = 200;
  private readonly maxLogs = 2000;

  private ensureTabContext(tabId: number): TabContext {
    let context = this.tabContexts.get(tabId);
    if (!context) {
      context = {
        tab: {
          tabId,
          windowId: null,
          title: `Tab ${tabId}`,
          url: '',
          available: true,
          lastSeenAt: Date.now(),
        },
        requests: new Map<string, StoredRequest>(),
        consoleLogs: [],
        pageInfo: null,
      };
      this.tabContexts.set(tabId, context);
    }
    return context;
  }

  upsertTab(tab: StoredTabSummary): StoredTabSummary {
    const context = this.ensureTabContext(tab.tabId);
    context.tab = {
      ...context.tab,
      ...tab,
      tabId: tab.tabId,
      lastSeenAt: tab.lastSeenAt ?? Date.now(),
    };
    return { ...context.tab };
  }

  getTab(tabId: number): StoredTabSummary | null {
    return this.tabContexts.has(tabId) ? { ...this.tabContexts.get(tabId)!.tab } : null;
  }

  addRequest(req: StoredRequest): void {
    const context = this.ensureTabContext(req.tabId);
    const existing = context.requests.get(req.id);
    if (existing) {
      Object.assign(existing, req, {
        requestHeaders: { ...req.requestHeaders },
        responseHeaders: req.responseHeaders ? { ...req.responseHeaders } : existing.responseHeaders,
      });
    } else {
      context.requests.set(req.id, {
        ...req,
        requestHeaders: { ...req.requestHeaders },
        ...(req.responseHeaders ? { responseHeaders: { ...req.responseHeaders } } : {}),
      });
    }

    if (context.requests.size > this.maxRequests) {
      const first = context.requests.keys().next().value;
      if (first) context.requests.delete(first);
    }
  }

  getRequests(tabId: number, filter?: {
    urlPattern?: string;
    method?: string;
    statusMin?: number;
    statusMax?: number;
  }): StoredRequest[] {
    const context = this.tabContexts.get(tabId);
    if (!context) return [];

    let entries = Array.from(context.requests.values());
    if (filter?.urlPattern) {
      const re = new RegExp(filter.urlPattern, 'i');
      entries = entries.filter((entry) => re.test(entry.url));
    }
    if (filter?.method) {
      entries = entries.filter((entry) => entry.method.toUpperCase() === filter.method!.toUpperCase());
    }
    if (filter?.statusMin != null) {
      entries = entries.filter((entry) => entry.status != null && entry.status >= filter.statusMin!);
    }
    if (filter?.statusMax != null) {
      entries = entries.filter((entry) => entry.status != null && entry.status <= filter.statusMax!);
    }
    return entries.map((entry) => ({
      ...entry,
      requestHeaders: { ...entry.requestHeaders },
      ...(entry.responseHeaders ? { responseHeaders: { ...entry.responseHeaders } } : {}),
    }));
  }

  getRequestById(tabId: number, requestId: string): StoredRequest | undefined {
    const context = this.tabContexts.get(tabId);
    if (!context) return undefined;
    const request = context.requests.get(requestId);
    if (!request) return undefined;
    return {
      ...request,
      requestHeaders: { ...request.requestHeaders },
      ...(request.responseHeaders ? { responseHeaders: { ...request.responseHeaders } } : {}),
    };
  }

  addConsoleLog(entry: StoredConsoleEntry): void {
    const context = this.ensureTabContext(entry.tabId);
    context.consoleLogs.push({ ...entry });
    if (context.consoleLogs.length > this.maxLogs) {
      context.consoleLogs.splice(0, context.consoleLogs.length - this.maxLogs);
    }
  }

  getConsoleLogs(tabId: number, filter?: { level?: string; pattern?: string; limit?: number }): StoredConsoleEntry[] {
    const context = this.tabContexts.get(tabId);
    if (!context) return [];

    let logs = [...context.consoleLogs];
    if (filter?.level) logs = logs.filter((log) => log.level === filter.level);
    if (filter?.pattern) {
      const re = new RegExp(filter.pattern, 'i');
      logs = logs.filter((log) => re.test(log.message));
    }
    return logs.slice(-(filter?.limit || 100)).map((log) => ({ ...log }));
  }

  setPageInfo(info: StoredPageInfo): void {
    const context = this.ensureTabContext(info.tabId);
    context.pageInfo = {
      ...info,
      scripts: [...info.scripts],
      meta: { ...info.meta },
    };
  }

  getPageInfo(tabId: number): StoredPageInfo | null {
    const context = this.tabContexts.get(tabId);
    if (!context?.pageInfo) return null;
    return {
      ...context.pageInfo,
      scripts: [...context.pageInfo.scripts],
      meta: { ...context.pageInfo.meta },
    };
  }

  getCaptureStats(tabId: number): TabCaptureStats {
    const context = this.tabContexts.get(tabId);
    if (!context) {
      return {
        tabId,
        requestCount: 0,
        consoleCount: 0,
        hasPageInfo: false,
        tabLastSeenAt: null,
        pageInfoLastSeenAt: null,
        latestRequestAt: null,
        latestConsoleAt: null,
      };
    }

    let latestRequestAt: number | null = null;
    for (const request of context.requests.values()) {
      const candidate = request.endTime ?? request.startTime;
      if (latestRequestAt == null || candidate > latestRequestAt) {
        latestRequestAt = candidate;
      }
    }

    let latestConsoleAt: number | null = null;
    for (const entry of context.consoleLogs) {
      if (latestConsoleAt == null || entry.timestamp > latestConsoleAt) {
        latestConsoleAt = entry.timestamp;
      }
    }

    return {
      tabId,
      requestCount: context.requests.size,
      consoleCount: context.consoleLogs.length,
      hasPageInfo: context.pageInfo != null,
      tabLastSeenAt: context.tab.lastSeenAt ?? null,
      pageInfoLastSeenAt: context.pageInfo?.lastSeenAt ?? null,
      latestRequestAt,
      latestConsoleAt,
    };
  }

  clear(): void {
    this.tabContexts.clear();
  }
}
