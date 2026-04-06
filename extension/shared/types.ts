export interface NMMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

export type AgentType = 'claude' | 'codex' | 'shell';
export type LaunchConfigAgentType = 'claude' | 'codex';

export interface AgentStartupOptions {
  launchArgs: string;
  workingDirectory: string;
  systemPromptMode: 'default' | 'custom' | 'none';
  customSystemPrompt: string;
}

export interface AgentLaunchConfig {
  claude: AgentStartupOptions;
  codex: AgentStartupOptions;
}

export type SessionRuntimeStatus =
  | 'starting'
  | 'connected'
  | 'disconnected'
  | 'exited'
  | 'tab_unavailable'
  | 'error';

export interface TabSummary {
  tabId: number;
  windowId: number | null;
  title: string;
  url: string;
  faviconUrl?: string;
  available: boolean;
  lastSeenAt: number;
}

export interface SessionBinding {
  kind: 'tab';
  tabId: number;
}

export interface SessionSnapshot {
  sessionId: string;
  agentType: AgentType;
  title: string;
  binding: SessionBinding;
  boundTab: TabSummary | null;
  status: SessionRuntimeStatus;
  statusMessage?: string;
  createdAt: number;
  lastActiveAt: number;
}

// PTY data from native host → extension
export interface SessionOutputMessage {
  type: 'session_output';
  sessionId: string;
  data: string; // base64-encoded
}

// PTY input from extension → native host
export interface SessionInputMessage {
  type: 'session_input';
  sessionId: string;
  data: string; // base64-encoded
}

export interface SessionCreateMessage {
  type: 'session_create';
  sessionId: string;
  agentType: AgentType;
  title: string;
  binding: SessionBinding;
  cols: number;
  rows: number;
  launchArgs?: string;
}

export interface SessionRestartMessage {
  type: 'session_restart';
  sessionId: string;
  agentType?: AgentType;
  launchArgs?: string;
}

export interface SessionCloseMessage {
  type: 'session_close';
  sessionId: string;
}

export interface SessionBindTabMessage {
  type: 'session_bind_tab';
  sessionId: string;
  tabId: number;
}

export interface SessionResizeMessage {
  type: 'session_resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionListRequestMessage {
  type: 'session_list_request';
}

export interface SessionSnapshotMessage {
  type: 'session_snapshot';
  sessions: SessionSnapshot[];
}

export interface SessionClosedMessage {
  type: 'session_closed';
  sessionId: string;
}

// Browser context update from extension → native host
export interface ContextUpdate {
  type: 'context_update';
  category: 'network' | 'console' | 'page_info' | 'tab_state';
  payload: unknown;
}

// Context query from native host → extension
export interface ContextQuery {
  type: 'context_query';
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

// Context response from extension → native host
export interface ContextResponse {
  type: 'context_response';
  id: string;
  result: unknown;
  error?: string;
}

// Host connection status
export interface StatusMessage {
  type: 'status';
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  message?: string;
}

// Chunked message for >1MB payloads
export interface ChunkMessage {
  type: 'chunk';
  chunk_id: string;
  index: number;
  total: number;
  data: string;
}

// Captured network request
export interface CapturedRequest {
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
  size?: number;
}

// Console log entry
export interface ConsoleEntry {
  tabId: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: number;
  source?: string;
}

// Page info
export interface PageInfo {
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

export interface CapturedBodyMessage {
  type: 'captured_body';
  url: string;
  body: string;
  method: string;
}

export interface ConsoleEntryMessage {
  type: 'console_entry';
  entry: Omit<ConsoleEntry, 'tabId'>;
}

export interface PageInfoMessage {
  type: 'page_info';
  info: Omit<PageInfo, 'tabId' | 'lastSeenAt'>;
}

export interface PanelOpenedMessage {
  type: 'panel_opened';
}

export interface PanelClosedMessage {
  type: 'panel_closed';
}

export interface CollapseSidePanelMessage {
  type: 'collapse_side_panel';
}

export interface CollapseSidePanelResultMessage {
  type: 'collapse_side_panel_result';
  ok: boolean;
  error?: string;
}

export interface GetCurrentWindowActiveTabMessage {
  type: 'get_current_window_active_tab';
}

export interface GetCurrentWindowActiveTabResultMessage {
  type: 'get_current_window_active_tab_result';
  tab: TabSummary | null;
  error?: string;
}

export interface ActivateTabMessage {
  type: 'activate_tab';
  tabId: number;
}

export interface ActivateTabResultMessage {
  type: 'activate_tab_result';
  tab: TabSummary | null;
  error?: string;
}

// Bidirectional command protocol
export interface BrowserCommandMessage {
  type: 'browser_command';
  id: string;       // UUID correlation ID echoed in result
  tabId: number;
  command: string;
  params: Record<string, unknown>;
}

export interface BrowserCommandResultMessage {
  type: 'browser_command_result';
  id: string;
  result?: unknown;
  error?: string;
}

export type ExtensionMessage =
  | ActivateTabMessage
  | ActivateTabResultMessage
  | BrowserCommandMessage
  | BrowserCommandResultMessage
  | CollapseSidePanelMessage
  | CollapseSidePanelResultMessage
  | CapturedBodyMessage
  | ChunkMessage
  | ConsoleEntryMessage
  | ContextQuery
  | ContextResponse
  | ContextUpdate
  | GetCurrentWindowActiveTabMessage
  | GetCurrentWindowActiveTabResultMessage
  | PageInfoMessage
  | PanelClosedMessage
  | PanelOpenedMessage
  | SessionBindTabMessage
  | SessionCloseMessage
  | SessionClosedMessage
  | SessionCreateMessage
  | SessionInputMessage
  | SessionListRequestMessage
  | SessionOutputMessage
  | SessionResizeMessage
  | SessionRestartMessage
  | SessionSnapshotMessage
  | StatusMessage;
