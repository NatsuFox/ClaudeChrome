#!/usr/bin/env node
import { WebSocketServer, WebSocket } from 'ws';
import { ContextStore, type StoredConsoleEntry, type StoredPageInfo, type StoredRequest, type StoredTabSummary } from './context-store.js';
import { SessionManager } from './session-manager.js';
import type { AgentType } from './agent-runtime.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

const WS_HOST = process.env.CLAUDECHROME_WS_HOST || '127.0.0.1';
const WS_PORT = parseInt(process.env.CLAUDECHROME_WS_PORT || '0', 10);
const RUNTIME_DIR = process.env.CLAUDECHROME_RUNTIME_DIR || path.join(os.tmpdir(), 'claudechrome');
const WS_PORT_FILE = process.env.CLAUDECHROME_WS_PORT_FILE || path.join(RUNTIME_DIR, 'ws.port');
const CONNECTION_LOG_PATH = process.env.CLAUDECHROME_CONNECTION_LOG_PATH || path.join(RUNTIME_DIR, 'connections.log');
const STORE_PORT = parseInt(process.env.CLAUDECHROME_STORE_PORT || '0', 10);
const STORE_SOCKET_PATH = process.env.CLAUDECHROME_STORE_SOCKET || path.join(RUNTIME_DIR, 'store.sock');
const MCP_BRIDGE_SCRIPT = path.resolve(__dirname, 'mcp-stdio-bridge.js');
const SESSION_WORKSPACE_ROOT = path.join(RUNTIME_DIR, 'sessions');
const EXPLICIT_CWD = process.env.CLAUDECHROME_CWD?.trim() || null;

const clients = new Set<WebSocket>();
const contextStore = new ContextStore();
const sessionManager = new SessionManager({
  contextStore,
  runtimeDir: RUNTIME_DIR,
  mcpBridgeScript: MCP_BRIDGE_SCRIPT,
  storeSocketPath: STORE_SOCKET_PATH,
  broadcast,
});

function appendConnectionLog(event: string, details: Record<string, unknown> = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...details,
  };
  const line = JSON.stringify(entry);

  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.appendFileSync(CONNECTION_LOG_PATH, line + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ClaudeChrome] Failed to write connection log: ${message}`);
  }

  console.error(`[ClaudeChrome] ${line}`);
}

function socketMeta(socket: net.Socket): Record<string, unknown> {
  return {
    remoteAddress: socket.remoteAddress || null,
    remotePort: socket.remotePort || null,
    localAddress: socket.localAddress || null,
    localPort: socket.localPort || null,
  };
}

function broadcast(message: object): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

type PendingCommand = {
  resolve: (r: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pendingCommands = new Map<string, PendingCommand>();

function dispatchBrowserCommand(
  tabId: number,
  command: string,
  params: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`browser_command timeout (${timeoutMs}ms): ${command}`));
    }, timeoutMs);
    pendingCommands.set(id, { resolve, reject, timer });
    broadcast({ type: 'browser_command', id, tabId, command, params });
  });
}

function sendStatus(client: WebSocket, status: 'connected' | 'disconnected' | 'error' | 'connecting', message: string): void {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify({ type: 'status', status, message }));
}

// Message rate tracking for diagnostics
type RateCounter = {
  count: number;
  windowStart: number;
  byCategory: Record<string, number>;
};

const messageRates = new Map<number, RateCounter>();
const RATE_WINDOW_MS = 60000; // 1 minute

function trackMessageRate(category: string, tabId?: number): void {
  if (tabId == null) return;

  const now = Date.now();
  let counter = messageRates.get(tabId);

  if (!counter) {
    counter = { count: 0, windowStart: now, byCategory: {} };
    messageRates.set(tabId, counter);
  }

  // Reset window
  if (now - counter.windowStart > RATE_WINDOW_MS) {
    if (counter.count > 0) {
      appendConnectionLog('message_rate', {
        tabId,
        count: counter.count,
        rate: (counter.count / (RATE_WINDOW_MS / 1000)).toFixed(2) + ' msg/sec',
        breakdown: counter.byCategory,
      });
    }
    counter.count = 0;
    counter.windowStart = now;
    counter.byCategory = {};
  }

  counter.count++;
  counter.byCategory[category] = (counter.byCategory[category] || 0) + 1;
}

function handleContextUpdate(msg: { category: string; payload: unknown }): void {
  // Log message size and track rate
  const payloadSize = JSON.stringify(msg.payload).length;
  let tabId: number | undefined;

  // Extract tabId from payload
  if (msg.category === 'network') {
    if (Array.isArray(msg.payload)) {
      tabId = (msg.payload[0] as StoredRequest | undefined)?.tabId;
    } else {
      tabId = (msg.payload as StoredRequest).tabId;
    }
  } else if (msg.category === 'console') {
    tabId = (msg.payload as StoredConsoleEntry).tabId;
  } else if (msg.category === 'page_info') {
    tabId = (msg.payload as StoredPageInfo).tabId;
  } else if (msg.category === 'tab_state') {
    tabId = (msg.payload as StoredTabSummary).tabId;
  }

  // Track rate
  trackMessageRate(msg.category, tabId);

  // Log large messages
  if (payloadSize > 50000) { // > 50KB
    appendConnectionLog('large_message', {
      category: msg.category,
      tabId,
      size: payloadSize,
    });
  }

  switch (msg.category) {
    case 'network': {
      const requests = Array.isArray(msg.payload)
        ? msg.payload as StoredRequest[]
        : [msg.payload as StoredRequest];
      for (const request of requests) {
        contextStore.addRequest(request);
      }
      break;
    }
    case 'console': {
      const entry = msg.payload as StoredConsoleEntry;
      contextStore.addConsoleLog(entry);
      break;
    }
    case 'page_info': {
      const info = msg.payload as StoredPageInfo;
      contextStore.setPageInfo(info);
      break;
    }
    case 'tab_state': {
      const tab = msg.payload as StoredTabSummary;
      contextStore.upsertTab(tab);
      // Session snapshots drive panel rerenders, so only emit them when tab metadata changes.
      sessionManager.noteTabUpdated(tab.tabId);
      break;
    }
    default:
      break;
  }
}

function resolveSessionCwd(sessionId: string): string {
  if (EXPLICIT_CWD) {
    fs.mkdirSync(EXPLICIT_CWD, { recursive: true });
    return EXPLICIT_CWD;
  }

  const cwd = path.join(SESSION_WORKSPACE_ROOT, sessionId, 'workspace');
  fs.mkdirSync(cwd, { recursive: true });
  return cwd;
}

function handleClientMessage(msg: any): void {
  switch (msg.type) {
    case 'session_create':
      sessionManager.createSession({
        sessionId: msg.sessionId,
        agentType: msg.agentType as AgentType,
        title: msg.title,
        bindingTabId: msg.binding?.tabId,
        cols: msg.cols,
        rows: msg.rows,
        cwd: resolveSessionCwd(msg.sessionId),
        launchArgs: typeof msg.launchArgs === 'string' ? msg.launchArgs : undefined,
      });
      break;
    case 'session_input': {
      const decoded = Buffer.from(msg.data, 'base64').toString();
      sessionManager.writeToSession(msg.sessionId, decoded);
      break;
    }
    case 'session_resize':
      sessionManager.resizeSession(msg.sessionId, msg.cols, msg.rows);
      break;
    case 'session_restart':
      sessionManager.restartSession(
        msg.sessionId,
        resolveSessionCwd(msg.sessionId),
        msg.agentType as AgentType | undefined,
        typeof msg.launchArgs === 'string' ? msg.launchArgs : undefined,
      );
      break;
    case 'session_close':
      sessionManager.closeSession(msg.sessionId);
      break;
    case 'session_bind_tab':
      sessionManager.bindSessionToTab(msg.sessionId, msg.tabId);
      break;
    case 'session_list_request':
      sessionManager.broadcastSnapshot();
      break;
    case 'context_update':
      handleContextUpdate(msg);
      break;
    case 'browser_command_result': {
      const pending = pendingCommands.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommands.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
      break;
    }
    default:
      break;
  }
}

const wss = new WebSocketServer({ port: WS_PORT, host: WS_HOST });
let resolvedWsPort: number = WS_PORT;

wss.on('listening', () => {
  const addr = wss.address() as { port: number };
  resolvedWsPort = addr.port;
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(WS_PORT_FILE, String(resolvedWsPort), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ClaudeChrome] Failed to write port file: ${msg}`);
  }
  appendConnectionLog('ws_listening', {
    url: `ws://${WS_HOST}:${resolvedWsPort}`,
    portFile: WS_PORT_FILE,
    logPath: CONNECTION_LOG_PATH,
  });
});

wss.on('error', (error: Error) => {
  appendConnectionLog('ws_server_error', { message: error.message });
});

wss.on('headers', (_headers, req) => {
  appendConnectionLog('ws_handshake', {
    ...socketMeta(req.socket),
    origin: req.headers.origin || null,
    userAgent: req.headers['user-agent'] || null,
  });
});

wss.on('connection', (client, req) => {
  clients.add(client);
  const meta = socketMeta(req.socket);
  appendConnectionLog('ws_connected', meta);

  sendStatus(client, 'connected', 'Connected to ClaudeChrome host');
  client.send(JSON.stringify({ type: 'session_snapshot', sessions: sessionManager.listSnapshots() }));

  client.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      const logPayload: Record<string, unknown> = {
        ...meta,
        type: typeof message?.type === 'string' ? message.type : 'unknown',
      };
      if (message?.type === 'context_update') {
        logPayload.category = typeof message.category === 'string' ? message.category : 'unknown';
        logPayload.payloadSize = JSON.stringify(message.payload ?? null).length;
      }
      appendConnectionLog('ws_message', logPayload);
      handleClientMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendConnectionLog('ws_bad_message', {
        ...meta,
        message,
      });
    }
  });

  client.on('error', (error) => {
    appendConnectionLog('ws_socket_error', {
      ...meta,
      message: error.message,
    });
  });

  client.on('close', (code, reason) => {
    clients.delete(client);
    appendConnectionLog('ws_closed', {
      ...meta,
      code,
      reason: reason.toString(),
    });
  });
});

let ipcServer: net.Server | null = null;

function startIpcServer(_socketPath: string): void {
  ipcServer = net.createServer({ allowHalfOpen: true }, (conn) => {
    const meta = socketMeta(conn);
    let data = '';

    const reply = (payload: unknown) => {
      if (conn.destroyed || conn.writableEnded) {
        appendConnectionLog('ipc_reply_skipped', meta);
        return;
      }
      try {
        conn.end(JSON.stringify(payload));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendConnectionLog('ipc_reply_error', {
          ...meta,
          message,
        });
      }
    };

    conn.on('error', (error) => {
      appendConnectionLog('ipc_socket_error', {
        ...meta,
        message: error.message,
      });
    });

    conn.on('data', (chunk) => {
      data += chunk.toString();
    });

    conn.on('end', () => {
      try {
        const parsed = JSON.parse(data.trim());
        const { kind, sessionId, tool, command, params, timeoutMs } = parsed;

        if (kind === 'command') {
          const tabId = sessionManager.getBindingTabId(sessionId);
          if (tabId == null) {
            reply({ error: `No session or tab binding for session: ${sessionId}` });
            return;
          }
          appendConnectionLog('ipc_command', { ...meta, sessionId, command });
          dispatchBrowserCommand(tabId, command as string, (params ?? {}) as Record<string, unknown>, timeoutMs as number | undefined)
            .then((result) => reply({ ok: true, result }))
            .catch((err) => reply({ error: err instanceof Error ? err.message : String(err) }));
        } else {
          appendConnectionLog('ipc_query', { ...meta, sessionId, tool });
          Promise.resolve(handleStoreQuery(sessionId, tool, params))
            .then((result) => reply(result))
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              reply({ error: message });
            });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply({ error: message });
      }
    });
  });

  ipcServer.on('error', (error: any) => {
    broadcast({
      type: 'status',
      status: 'error',
      message: `IPC server error: ${error.message}`,
    });
  });

  ipcServer.listen(STORE_PORT, '127.0.0.1', () => {
    const addr = ipcServer!.address() as net.AddressInfo;
    const resolvedPort = addr.port;
    appendConnectionLog('ipc_listening', { port: resolvedPort });
    sessionManager.setStorePort(resolvedPort);
  });
}

const IMPLEMENTED_SESSION_TOOLS = [
  'browser__get_requests',
  'browser__get_request_detail',
  'browser__search_responses',
  'browser__get_console_logs',
  'browser__get_page_info',
  'browser__get_page_text',
  'browser__get_page_html',
  'browser__list_tabs',
  'browser__status',
  'browser__session_context',
  'browser__binding_status',
  'browser__capabilities',
  'browser__capture_policy',
  'browser__capture_stats',
  'browser__explain_unavailable',
  'browser__self_check',
  'browser__screenshot',
  'browser__navigate',
  'browser__reload',
  'browser__get_page_content',
  'browser__find_elements',
  'browser__evaluate_js',
  'browser__click',
  'browser__type',
  'browser__scroll',
  'browser__wait_for',
  'browser__get_cookies',
  'browser__get_storage',
  'browser__get_selection',
] as const;

function makeError(code: string, message: string, details: Record<string, unknown> = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details,
    },
  };
}

function getSessionContext(sessionId: string | undefined) {
  if (!sessionId) {
    return { error: makeError('missing_session_id', 'Missing sessionId') };
  }

  const snapshot = sessionManager.getSnapshot(sessionId);
  if (!snapshot) {
    return { error: makeError('unknown_session', `Unknown session: ${sessionId}`, { sessionId }) };
  }

  const tabId = snapshot.binding.tabId;
  const tab = contextStore.getTab(tabId);
  const pageInfo = contextStore.getPageInfo(tabId);
  const stats = contextStore.getCaptureStats(tabId);

  return {
    sessionId,
    snapshot,
    tabId,
    tab,
    pageInfo,
    stats,
  };
}

const PAGE_INFO_PREVIEW_CHARS = 1200;
const DEFAULT_PAGE_PAYLOAD_CHARS = 40_000;
const MAX_PAGE_PAYLOAD_CHARS = 400_000;

function clampPagePayloadChars(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PAGE_PAYLOAD_CHARS;
  }
  return Math.min(MAX_PAGE_PAYLOAD_CHARS, Math.max(256, Math.floor(numeric)));
}

function summarizePageInfo(pageInfo: StoredPageInfo | null) {
  if (!pageInfo) {
    return null;
  }

  return {
    url: pageInfo.url,
    title: pageInfo.title,
    faviconUrl: pageInfo.faviconUrl,
    lastSeenAt: pageInfo.lastSeenAt,
    scripts: [...pageInfo.scripts],
    meta: { ...pageInfo.meta },
    content: {
      hasVisibleText: Boolean(pageInfo.visibleText),
      visibleTextChars: pageInfo.visibleText?.length ?? 0,
      visibleTextPreview: pageInfo.visibleText?.slice(0, PAGE_INFO_PREVIEW_CHARS) ?? '',
      hasHtml: Boolean(pageInfo.html),
      htmlChars: pageInfo.html?.length ?? 0,
    },
  };
}

function makeMissingPageInfoError(sessionId: string, tabId: number) {
  return makeError('not_captured_yet', 'No page info has been captured for the bound tab yet.', {
    sessionId,
    boundTabId: tabId,
  });
}

function summarizeSessionContext(context: Exclude<ReturnType<typeof getSessionContext>, { error: unknown }>) {
  const suggestedNextTools: string[] = [];

  if (context.pageInfo) {
    suggestedNextTools.push('browser__get_page_text', 'browser__get_page_info');
  } else {
    suggestedNextTools.push('browser__binding_status', 'browser__get_page_info');
  }

  if (context.stats.requestCount > 0) {
    suggestedNextTools.push('browser__get_requests');
  }
  if (context.stats.consoleCount > 0) {
    suggestedNextTools.push('browser__get_console_logs');
  }

  suggestedNextTools.push('browser__capabilities');

  return {
    ok: true,
    sessionId: context.sessionId,
    binding: context.snapshot.binding,
    sessionStatus: context.snapshot.status,
    sessionStatusMessage: context.snapshot.statusMessage ?? null,
    boundTab: context.tab,
    pageInfo: summarizePageInfo(context.pageInfo),
    capture: {
      requestCount: context.stats.requestCount,
      consoleCount: context.stats.consoleCount,
      hasPageInfo: context.stats.hasPageInfo,
    },
    suggestedNextTools: [...new Set(suggestedNextTools)],
  };
}

function getCapabilities(context: ReturnType<typeof getSessionContext>) {
  const hasContext = !('error' in context) && context.snapshot.status !== 'tab_unavailable';
  return {
    mode: 'default',
    implementedTools: [...IMPLEMENTED_SESSION_TOOLS],
    families: {
      page: {
        available: true,
        tools: ['browser__get_page_info', 'browser__get_page_text', 'browser__get_page_html', 'browser__get_page_content', 'browser__find_elements'],
      },
      network: {
        available: true,
        tools: ['browser__get_requests', 'browser__get_request_detail', 'browser__search_responses'],
      },
      console: {
        available: true,
        tools: ['browser__get_console_logs'],
      },
      tabs: {
        available: true,
        tools: ['browser__list_tabs'],
      },
      introspection: {
        available: true,
        tools: ['browser__status', 'browser__session_context', 'browser__binding_status', 'browser__capabilities', 'browser__capture_policy', 'browser__capture_stats', 'browser__explain_unavailable', 'browser__self_check'],
      },
      cookies: {
        available: true,
        tools: ['browser__get_cookies'],
      },
      storage: {
        available: true,
        tools: ['browser__get_storage'],
      },
      debugger: {
        available: false,
        code: 'not_implemented_yet',
        reason: 'Inspector-mode debugger-backed tools are planned but not implemented in the current host.',
      },
      action: {
        available: true,
        tools: ['browser__screenshot', 'browser__navigate', 'browser__reload', 'browser__evaluate_js', 'browser__click', 'browser__type', 'browser__scroll', 'browser__wait_for'],
      },
    },
    bindingReady: hasContext,
  };
}

function explainUnavailable(context: ReturnType<typeof getSessionContext>, target: string) {
  if ('error' in context) {
    return context.error;
  }

  if (context.snapshot.status === 'tab_unavailable') {
    return makeError('bound_tab_unavailable', 'The bound tab for this session is unavailable.', {
      sessionId: context.sessionId,
      boundTabId: context.tabId,
    });
  }

  if (IMPLEMENTED_SESSION_TOOLS.includes(target as (typeof IMPLEMENTED_SESSION_TOOLS)[number])) {
    return {
      ok: true,
      target,
      available: true,
      message: `${target} is implemented and available for this session.`,
    };
  }

  const capabilities = getCapabilities(context);
  for (const [family, info] of Object.entries(capabilities.families)) {
    const tools = 'tools' in info && Array.isArray(info.tools) ? info.tools : [];
    if (family === target || tools.includes(target)) {
      if (info.available) {
        return {
          ok: true,
          target,
          available: true,
          family,
        };
      }
      const unavailable = info as { available: boolean; code?: string; reason?: string };
      return makeError(
        unavailable.code || 'not_implemented_yet',
        typeof unavailable.reason === 'string' ? unavailable.reason : `${target} is not available.`,
        { target, family },
      );
    }
  }

  return makeError('not_implemented_yet', `${target} is not implemented in the current host.`, { target });
}

async function getLivePageContentForQuery(
  sessionId: string,
  tabId: number,
  maxChars: number,
  includeHtml: boolean
) {
  const result = await dispatchBrowserCommand(tabId, 'get_page_content', {
    include_html: includeHtml,
    max_chars: maxChars,
  }, 10_000) as { url: string; title: string; text: string; html?: string };

  return {
    ok: true,
    sessionId,
    tabId,
    url: result.url,
    title: result.title,
    lastSeenAt: Date.now(),
    text: result.text,
    html: result.html,
  };
}

async function getCapturePolicyForTab(tabId: number) {
  try {
    const result = await dispatchBrowserCommand(tabId, 'get_capture_settings', {}, 5_000) as {
      captureResponseBodies?: boolean;
    };

    return {
      responseBodies: {
        mode: 'opt_in',
        available: true,
        enabled: result.captureResponseBodies === true,
      },
    };
  } catch (error) {
    return {
      responseBodies: {
        mode: 'opt_in',
        available: false,
        enabled: null,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function handleStoreQuery(sessionId: string | undefined, tool: string, params: any): Promise<any> {
  const context = getSessionContext(sessionId);

  switch (tool) {
    case 'get_requests': {
      if ('error' in context) return context.error;
      const [statusMin, statusMax] = params.status_range
        ? params.status_range.split('-').map(Number)
        : [undefined, undefined];
      return contextStore.getRequests(context.tabId, {
        urlPattern: params.url_pattern,
        method: params.method,
        statusMin,
        statusMax,
      }).map((request) => ({
        id: request.id,
        tabId: request.tabId,
        url: request.url,
        method: request.method,
        status: request.status,
        mimeType: request.mimeType,
        startTime: request.startTime,
        endTime: request.endTime,
        ...(params.include_bodies ? {
          requestBody: request.requestBody,
          responseBody: request.responseBody?.slice(0, 10_000),
        } : {}),
      }));
    }
    case 'get_request_detail':
      if ('error' in context) return context.error;
      return contextStore.getRequestById(context.tabId, params.request_id) || null;
    case 'search_responses': {
      if ('error' in context) return context.error;
      const re = new RegExp(params.body_pattern, 'i');
      return contextStore.getRequests(context.tabId)
        .filter((request) => request.responseBody && re.test(request.responseBody))
        .filter((request) => !params.content_type || request.mimeType?.includes(params.content_type))
        .map((request) => {
          const idx = request.responseBody!.search(re);
          const snippet = request.responseBody!.slice(Math.max(0, idx - 50), idx + 150);
          return {
            id: request.id,
            tabId: request.tabId,
            url: request.url,
            method: request.method,
            status: request.status,
            matchSnippet: snippet,
          };
        });
    }
    case 'get_console_logs':
      if ('error' in context) return context.error;
      return contextStore.getConsoleLogs(context.tabId, {
        level: params.level,
        pattern: params.pattern,
        limit: params.limit,
      });
    case 'get_page_info': {
      if ('error' in context) return context.error;
      if (!context.pageInfo) {
        return makeMissingPageInfoError(context.sessionId, context.tabId);
      }
      const pageSummary = summarizePageInfo(context.pageInfo)!;
      return {
        ok: true,
        sessionId: context.sessionId,
        tabId: context.tabId,
        ...pageSummary,
      };
    }
    case 'get_page_text': {
      if ('error' in context) return context.error;
      const maxChars = clampPagePayloadChars(params.max_chars);
      const live = await getLivePageContentForQuery(context.sessionId, context.tabId, maxChars, false);
      const text = live.text ?? '';
      return {
        ok: true,
        sessionId: context.sessionId,
        tabId: context.tabId,
        url: live.url,
        title: live.title,
        lastSeenAt: live.lastSeenAt,
        chars: text.length,
        returnedChars: text.length,
        truncated: false,
        text,
      };
    }
    case 'get_page_html': {
      if ('error' in context) return context.error;
      const maxChars = clampPagePayloadChars(params.max_chars);
      const live = await getLivePageContentForQuery(context.sessionId, context.tabId, maxChars, true);
      const html = live.html ?? '';
      return {
        ok: true,
        sessionId: context.sessionId,
        tabId: context.tabId,
        url: live.url,
        title: live.title,
        lastSeenAt: live.lastSeenAt,
        chars: html.length,
        returnedChars: html.length,
        truncated: false,
        html,
      };
    }
    case 'get_status': {
      if ('error' in context) return context.error;
      const capturePolicy = await getCapturePolicyForTab(context.tabId);
      return {
        ok: true,
        sessionId: context.sessionId,
        mode: 'default',
        transport: {
          websocket: {
            host: WS_HOST,
            port: resolvedWsPort,
            connectedClients: clients.size,
          },
          ipc: {
            socketPath: STORE_SOCKET_PATH,
          },
        },
        session: context.snapshot,
        binding: {
          tabId: context.tabId,
          boundTab: context.tab,
        },
        capture: {
          stats: context.stats,
          pageInfoPresent: context.pageInfo != null,
          policy: capturePolicy,
        },
        collectors: {
          page_info: {
            status: context.pageInfo ? 'ok' : 'degraded',
            lastSeenAt: context.pageInfo?.lastSeenAt ?? null,
          },
          network: {
            status: context.stats.requestCount > 0 ? 'ok' : 'degraded',
            count: context.stats.requestCount,
            latestAt: context.stats.latestRequestAt,
          },
          console: {
            status: context.stats.consoleCount > 0 ? 'ok' : 'degraded',
            count: context.stats.consoleCount,
            latestAt: context.stats.latestConsoleAt,
          },
          debugger: {
            status: 'disabled',
            code: 'not_implemented_yet',
          },
        },
      };
    }
    case 'get_session_context': {
      if ('error' in context) return context.error;
      const capturePolicy = await getCapturePolicyForTab(context.tabId);
      const sessionContext = summarizeSessionContext(context);
      return {
        ...sessionContext,
        capture: {
          ...sessionContext.capture,
          policy: capturePolicy,
        },
      };
    }
    case 'get_binding_status': {
      if ('error' in context) return context.error;
      const capturePolicy = await getCapturePolicyForTab(context.tabId);
      return {
        ok: true,
        sessionId: context.sessionId,
        binding: context.snapshot.binding,
        sessionStatus: context.snapshot.status,
        sessionStatusMessage: context.snapshot.statusMessage ?? null,
        boundTab: context.tab,
        pageInfo: summarizePageInfo(context.pageInfo),
        capturePolicy,
      };
    }
    case 'get_capabilities':
      if ('error' in context) return context.error;
      return {
        ok: true,
        sessionId: context.sessionId,
        ...getCapabilities(context),
      };
    case 'get_capture_policy': {
      if ('error' in context) return context.error;
      const capturePolicy = await getCapturePolicyForTab(context.tabId);
      return {
        ok: true,
        sessionId: context.sessionId,
        tabId: context.tabId,
        policy: capturePolicy,
      };
    }
    case 'get_capture_stats': {
      if ('error' in context) return context.error;
      const capturePolicy = await getCapturePolicyForTab(context.tabId);
      return {
        ok: true,
        sessionId: context.sessionId,
        tabId: context.tabId,
        stats: context.stats,
        policy: capturePolicy,
      };
    }
    case 'explain_unavailable':
      return explainUnavailable(context, String(params.target || params.tool_name || ''));
    case 'self_check': {
      if ('error' in context) return context.error;
      const capturePolicy = await getCapturePolicyForTab(context.tabId);
      const checks = [
        {
          name: 'session_snapshot',
          status: 'ok',
          message: 'Session snapshot is available.',
        },
        {
          name: 'bound_tab',
          status: context.tab ? 'ok' : 'error',
          code: context.tab ? undefined : 'bound_tab_unavailable',
          message: context.tab ? `Bound to tab ${context.tabId}.` : 'No bound tab record is available.',
        },
        {
          name: 'page_info',
          status: context.pageInfo ? 'ok' : 'warn',
          code: context.pageInfo ? undefined : 'not_captured_yet',
          message: context.pageInfo ? `Captured page info for ${context.pageInfo.url}.` : 'No page info has been captured for the bound tab yet.',
        },
        {
          name: 'network_capture',
          status: context.stats.requestCount > 0 ? 'ok' : 'warn',
          code: context.stats.requestCount > 0 ? undefined : 'not_captured_yet',
          message: context.stats.requestCount > 0 ? `Captured ${context.stats.requestCount} requests.` : 'No requests have been captured for the bound tab yet.',
        },
        {
          name: 'console_capture',
          status: context.stats.consoleCount > 0 ? 'ok' : 'warn',
          code: context.stats.consoleCount > 0 ? undefined : 'not_captured_yet',
          message: context.stats.consoleCount > 0 ? `Captured ${context.stats.consoleCount} console entries.` : 'No console entries have been captured for the bound tab yet.',
        },
        {
          name: 'response_body_capture_policy',
          status: capturePolicy.responseBodies.available ? 'ok' : 'warn',
          code: capturePolicy.responseBodies.available ? undefined : 'capture_policy_unavailable',
          message: capturePolicy.responseBodies.available
            ? (capturePolicy.responseBodies.enabled
                ? 'Response body capture is enabled in opt-in mode.'
                : 'Response body capture is disabled in opt-in mode.')
            : 'Response body capture policy could not be read from the browser session.',
        },
      ];

      const overall = checks.some((check) => check.status === 'error')
        ? 'error'
        : checks.some((check) => check.status === 'warn')
          ? 'warn'
          : 'ok';

      return {
        ok: true,
        overall,
        sessionId: context.sessionId,
        checks,
        summary: {
          sessionStatus: context.snapshot.status,
          boundTabId: context.tabId,
          implementedTools: [...IMPLEMENTED_SESSION_TOOLS],
          captureStats: context.stats,
        },
      };
    }
    default:
      return makeError('unknown_tool', `Unknown tool: ${tool}`, { tool });
  }
}

try {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  startIpcServer(STORE_SOCKET_PATH); // socket path ignored; TCP is used
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ClaudeChrome] Failed to start IPC server: ${message}`);
}

function cleanup(): void {
  sessionManager.shutdown();
  ipcServer?.close();
  try { fs.unlinkSync(WS_PORT_FILE); } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
