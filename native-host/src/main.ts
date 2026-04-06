#!/usr/bin/env node
import { WebSocketServer, WebSocket } from 'ws';
import { buildBrowserContextContractDescriptor } from './browser-context-injection.js';
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
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CWD = process.env.CLAUDECHROME_CWD || PROJECT_ROOT;

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

function handleContextUpdate(msg: { category: string; payload: unknown }): void {
  switch (msg.category) {
    case 'network': {
      const request = msg.payload as StoredRequest;
      contextStore.addRequest(request);
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
        cwd: DEFAULT_CWD,
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
        DEFAULT_CWD,
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
      appendConnectionLog('ws_message', {
        ...meta,
        type: typeof message?.type === 'string' ? message.type : 'unknown',
      });
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
          const context = getSessionContext(sessionId);
          if ('error' in context) {
            reply(context.error);
            return;
          }
          const commandParams = (params ?? {}) as Record<string, unknown>;
          const resolvedTabId = parseRequestedTabId(commandParams.tab_id) ?? context.tabId;
          appendConnectionLog('ipc_command', { ...meta, sessionId, command, resolvedTabId });
          dispatchBrowserCommand(resolvedTabId, command as string, commandParams, timeoutMs as number | undefined)
            .then((result) => reply({ ok: true, result: attachResolvedTabId((result ?? {}) as Record<string, unknown>, resolvedTabId) }))
            .catch((err) => reply({ error: err instanceof Error ? err.message : String(err) }));
        } else {
          const result = handleStoreQuery(sessionId, tool, params);
          appendConnectionLog('ipc_query', { ...meta, sessionId, tool });
          reply(result);
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
  'browser__activate_tab',
  'browser__bind_tab',
  'browser__status',
  'browser__binding_status',
  'browser__session_context',
  'browser__capabilities',
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

type SessionContextData = Exclude<ReturnType<typeof getSessionContext>, { error: unknown }>;

const PAGE_INFO_PREVIEW_CHARS = 1200;
const DEFAULT_PAGE_PAYLOAD_CHARS = 40_000;
const MAX_PAGE_PAYLOAD_CHARS = 400_000;

function parseRequestedTabId(value: unknown): number | null {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

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
  return makeError('not_captured_yet', 'No page info has been captured for the requested tab yet.', {
    sessionId,
    resolved_tab_id: tabId,
  });
}

function makeMissingTabError(sessionId: string, tabId: number) {
  return makeError('tab_not_available', 'No captured tab metadata is available for the requested tab.', {
    sessionId,
    resolved_tab_id: tabId,
  });
}

function resolveTabScope(context: SessionContextData, params: Record<string, unknown>) {
  const requestedTabId = parseRequestedTabId(params.tab_id);
  const resolvedTabId = requestedTabId ?? context.tabId;
  const targetTab = resolvedTabId === context.tabId ? context.tab : contextStore.getTab(resolvedTabId);
  const targetPageInfo = resolvedTabId === context.tabId ? context.pageInfo : contextStore.getPageInfo(resolvedTabId);
  const targetStats = resolvedTabId === context.tabId ? context.stats : contextStore.getCaptureStats(resolvedTabId);

  return {
    requestedTabId,
    resolvedTabId,
    targetTab,
    targetPageInfo,
    targetStats,
  };
}

function attachResolvedTabId<T extends Record<string, unknown>>(payload: T, resolvedTabId: number): T & { resolved_tab_id: number } {
  return {
    ...payload,
    resolved_tab_id: resolvedTabId,
  };
}

function buildSessionContextPayload(context: SessionContextData) {
  const currentUrl = context.pageInfo?.url ?? context.tab?.url ?? null;
  const currentTitle = context.pageInfo?.title ?? context.tab?.title ?? null;
  const contract = buildBrowserContextContractDescriptor({
    bindingTabId: context.tabId,
    boundTabTitle: currentTitle ?? undefined,
    boundTabUrl: currentUrl ?? undefined,
  });

  return {
    ok: true,
    sessionId: context.sessionId,
    mode: contract.sessionMode,
    injection: {
      preset_id: contract.presetId,
      preset_description: contract.presetDescription,
      channels: contract.channels,
      system_prompt_templates: contract.systemPromptTemplates,
    },
    targeting: {
      model: contract.targetingModel,
      currentTargetKind: contract.currentTargetKind,
      targetMayChange: contract.targetMayChange,
      sessionDefaultTabId: contract.sessionDefaultTabId,
      perCallTabId: contract.perCallTabId,
      crossTabPolicy: contract.crossTabPolicy,
    },
    controls: contract.controls,
    currentTarget: {
      binding: context.snapshot.binding,
      tabId: context.tabId,
      available: Boolean(context.tab?.available),
      title: currentTitle,
      url: currentUrl,
      boundTab: context.tab,
      pageInfoAvailable: context.pageInfo != null,
    },
    recommendations: {
      whenPageScopedOrAmbiguous: ['browser__session_context', 'browser__binding_status', 'browser__get_page_content'],
      whenNeedText: ['browser__get_page_text'],
      whenNeedDomInteraction: ['browser__find_elements', 'browser__click', 'browser__type', 'browser__scroll', 'browser__wait_for'],
      whenNeedMultiTabAwareness: ['browser__list_tabs', 'browser__activate_tab', 'browser__bind_tab', 'browser__binding_status'],
      whenToolingSeemsMissing: ['browser__capabilities', 'browser__explain_unavailable', 'browser__self_check'],
    },
    policy: {
      preferClaudeChromeBrowserTools: true,
      avoidExternalHeadlessBrowserTools: true,
      fallbackRule: 'Only fall back to external/headless browser tools when the user explicitly asks or browser__explain_unavailable confirms the ClaudeChrome route is unavailable.',
    },
  };
}

function getCapabilities(context: ReturnType<typeof getSessionContext>) {
  const hasContext = !('error' in context) && context.snapshot.status !== 'tab_unavailable';
  const sessionContext = buildSessionContextPayload(context as SessionContextData);
  return {
    mode: sessionContext.mode,
    injection: sessionContext.injection,
    implementedTools: [...IMPLEMENTED_SESSION_TOOLS],
    targeting: sessionContext.targeting,
    currentTarget: sessionContext.currentTarget,
    recommendations: sessionContext.recommendations,
    policy: sessionContext.policy,
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
        tools: ['browser__list_tabs', 'browser__activate_tab', 'browser__bind_tab'],
      },
      introspection: {
        available: true,
        tools: ['browser__status', 'browser__binding_status', 'browser__session_context', 'browser__capabilities', 'browser__capture_stats', 'browser__explain_unavailable', 'browser__self_check'],
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

function handleStoreQuery(sessionId: string | undefined, tool: string, params: any): any {
  const context = getSessionContext(sessionId);
  const toolParams = (params ?? {}) as any;

  switch (tool) {
    case 'get_requests': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      const [statusMin, statusMax] = toolParams.status_range
        ? toolParams.status_range.split('-').map(Number)
        : [undefined, undefined];
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        requests: contextStore.getRequests(scope.resolvedTabId, {
          urlPattern: toolParams.url_pattern,
          method: toolParams.method,
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
          ...(toolParams.include_bodies ? {
            requestBody: request.requestBody,
            responseBody: request.responseBody?.slice(0, 10_000),
          } : {}),
        })),
      }, scope.resolvedTabId);
    }
    case 'get_request_detail': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        request: contextStore.getRequestById(scope.resolvedTabId, toolParams.request_id) || null,
      }, scope.resolvedTabId);
    }
    case 'search_responses': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      const re = new RegExp(toolParams.body_pattern, 'i');
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        matches: contextStore.getRequests(scope.resolvedTabId)
          .filter((request) => request.responseBody && re.test(request.responseBody))
          .filter((request) => !toolParams.content_type || request.mimeType?.includes(toolParams.content_type))
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
          }),
      }, scope.resolvedTabId);
    }
    case 'get_console_logs': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        entries: contextStore.getConsoleLogs(scope.resolvedTabId, {
          level: toolParams.level,
          pattern: toolParams.pattern,
          limit: toolParams.limit,
        }),
      }, scope.resolvedTabId);
    }
    case 'get_page_info': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      if (!scope.targetTab) {
        return makeMissingTabError(context.sessionId, scope.resolvedTabId);
      }
      if (!scope.targetPageInfo) {
        return makeMissingPageInfoError(context.sessionId, scope.resolvedTabId);
      }
      const pageSummary = summarizePageInfo(scope.targetPageInfo)!;
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        tabId: scope.resolvedTabId,
        ...pageSummary,
      }, scope.resolvedTabId);
    }
    case 'get_page_text': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      if (!scope.targetPageInfo) {
        return makeMissingPageInfoError(context.sessionId, scope.resolvedTabId);
      }
      const text = scope.targetPageInfo.visibleText ?? '';
      const maxChars = clampPagePayloadChars(toolParams.max_chars);
      const returnedText = text.slice(0, maxChars);
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        tabId: scope.resolvedTabId,
        url: scope.targetPageInfo.url,
        title: scope.targetPageInfo.title,
        lastSeenAt: scope.targetPageInfo.lastSeenAt,
        chars: text.length,
        returnedChars: returnedText.length,
        truncated: text.length > maxChars,
        text: returnedText,
      }, scope.resolvedTabId);
    }
    case 'get_page_html': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      if (!scope.targetPageInfo) {
        return makeMissingPageInfoError(context.sessionId, scope.resolvedTabId);
      }
      const html = scope.targetPageInfo.html ?? '';
      const maxChars = clampPagePayloadChars(toolParams.max_chars);
      const returnedHtml = html.slice(0, maxChars);
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        tabId: scope.resolvedTabId,
        url: scope.targetPageInfo.url,
        title: scope.targetPageInfo.title,
        lastSeenAt: scope.targetPageInfo.lastSeenAt,
        chars: html.length,
        returnedChars: returnedHtml.length,
        truncated: html.length > maxChars,
        html: returnedHtml,
      }, scope.resolvedTabId);
    }
    case 'get_status':
      if ('error' in context) return context.error;
      return {
        ok: true,
        sessionId: context.sessionId,
        mode: 'browser_attached',
        sessionContext: buildSessionContextPayload(context),
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
    case 'get_binding_status':
      if ('error' in context) return context.error;
      return {
        ok: true,
        sessionId: context.sessionId,
        binding: context.snapshot.binding,
        sessionStatus: context.snapshot.status,
        sessionStatusMessage: context.snapshot.statusMessage ?? null,
        targeting: buildSessionContextPayload(context).targeting,
        controls: buildSessionContextPayload(context).controls,
        boundTab: context.tab,
        pageInfo: summarizePageInfo(context.pageInfo),
      };
    case 'bind_tab': {
      if ('error' in context) return context.error;
      const requestedTabId = parseRequestedTabId(toolParams.tab_id);
      if (!requestedTabId) {
        return makeError('missing_tab_id', 'browser__bind_tab requires an explicit tab_id.', {
          sessionId: context.sessionId,
        });
      }
      sessionManager.bindSessionToTab(context.sessionId, requestedTabId);
      const rebound = getSessionContext(context.sessionId);
      if ('error' in rebound) return rebound.error;
      return attachResolvedTabId({
        ok: true,
        sessionId: rebound.sessionId,
        binding: rebound.snapshot.binding,
        boundTab: rebound.tab,
        pageInfo: summarizePageInfo(rebound.pageInfo),
      }, rebound.tabId);
    }
    case 'get_session_context':
      if ('error' in context) return context.error;
      return buildSessionContextPayload(context);
    case 'get_capabilities':
      if ('error' in context) return context.error;
      return {
        ok: true,
        sessionId: context.sessionId,
        ...getCapabilities(context),
      };
    case 'get_capture_stats': {
      if ('error' in context) return context.error;
      const scope = resolveTabScope(context, toolParams);
      return attachResolvedTabId({
        ok: true,
        sessionId: context.sessionId,
        tabId: scope.resolvedTabId,
        stats: scope.targetStats,
      }, scope.resolvedTabId);
    }
    case 'explain_unavailable':
      return explainUnavailable(context, String(toolParams.target || toolParams.tool_name || ''));
    case 'self_check': {
      if ('error' in context) return context.error;
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
