import {
  buildAgentLaunch,
  formatLaunchDiagnosticsNotice,
  normalizeStartupOptions,
  type AgentLaunchPlan,
  type AgentStartupOptions,
  type AgentType,
} from './agent-runtime.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContextStore } from './context-store.js';
import { CodexChatRuntime, type CodexChatRuntimeOptions } from './codex-chat-runtime.js';
import { PtyBridge } from './pty-bridge.js';

type ProcessState = 'starting' | 'running' | 'error' | 'exited';
export type SessionMode = 'terminal' | 'chat';

type AgentSession = {
  sessionId: string;
  agentType: AgentType;
  title: string;
  bindingTabId: number;
  createdAt: number;
  lastActiveAt: number;
  launchStartedAt: number;
  processState: ProcessState;
  statusMessage?: string;
  mode: SessionMode;
  pty: PtyBridge | null;
  chatRuntime: CodexChatRuntime | null;
  outputBuffer: string;
  recentOutput: string;
  transcriptPath: string;
  shellInputBuffer: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  cols: number;
  rows: number;
  cwd: string;
  startupOptions: AgentStartupOptions;
};
export interface SessionSnapshot {
  sessionId: string;
  agentType: AgentType;
  mode: SessionMode;
  title: string;
  binding: {
    kind: 'tab';
    tabId: number;
  };
  boundTab: ReturnType<ContextStore['getTab']>;
  status: 'starting' | 'connected' | 'error' | 'exited' | 'tab_unavailable';
  statusMessage?: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface CreateSessionOptions {
  sessionId: string;
  agentType: AgentType;
  mode?: SessionMode;
  title: string;
  bindingTabId: number;
  cols: number;
  rows: number;
  cwd: string;
  startupOptions?: AgentStartupOptions;
}

export interface SessionManagerOptions {
  contextStore: ContextStore;
  runtimeDir: string;
  mcpBridgeScript: string;
  storeSocketPath: string;
  broadcast: (message: object) => void;
  dispatchBrowserCommand: (
    sessionId: string,
    tabId: number,
    command: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<unknown>;
  createCodexChatRuntime?: (options: CodexChatRuntimeOptions) => CodexChatRuntime;
  logEvent?: (event: string, details: Record<string, unknown>) => void;
}

const FLUSH_INTERVAL_MS = 16;
const TRANSCRIPT_CHUNK_CHARS = 200_000;
const EARLY_EXIT_WINDOW_MS = 10_000;
const RECENT_OUTPUT_BUFFER_CHARS = 4_000;
const OUTPUT_PREVIEW_CHARS = 220;
const LAUNCH_FAILURE_ENV_KEYS = [
  'PATH',
  'SHELL',
  'HOME',
  'PWD',
  'USER',
  'LOGNAME',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'CLAUDECHROME_BASH_PATH',
  'CLAUDECHROME_CWD',
  'CLAUDECHROME_RUNTIME_DIR',
  'CLAUDECHROME_WS_PORT',
  'npm_execpath',
  'npm_command',
  'npm_config_prefix',
  'npm_lifecycle_event',
];

type AgentStartupFailure = {
  statusMessage: string;
  notice: string;
};

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function pushRecentOutput(previous: string, nextChunk: string): string {
  const combined = previous + nextChunk;
  return combined.slice(-RECENT_OUTPUT_BUFFER_CHARS);
}

function summarizeRecentOutput(value: string): string {
  const cleaned = stripAnsi(value).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  return cleaned.length > OUTPUT_PREVIEW_CHARS
    ? `...${cleaned.slice(-OUTPUT_PREVIEW_CHARS)}`
    : cleaned;
}

function startupOptionsEqual(left: AgentStartupOptions, right: AgentStartupOptions): boolean {
  return left.launchArgs === right.launchArgs
    && left.workingDirectory === right.workingDirectory
    && left.systemPromptMode === right.systemPromptMode
    && left.customSystemPrompt === right.customSystemPrompt
    && (left.apiBaseUrl ?? '') === (right.apiBaseUrl ?? '')
    && (left.apiKey ?? '') === (right.apiKey ?? '')
    && (left.model ?? '') === (right.model ?? '');
}

function classifyLocalAgentStartupFailure(session: AgentSession, code: number): AgentStartupFailure | null {
  if (session.agentType === 'shell' || code === 0) {
    return null;
  }

  const agentName = displayAgentName(session.agentType);
  const commandName = session.agentType === 'codex' ? 'codex' : 'claude';
  const runtimeMs = Date.now() - session.launchStartedAt;
  const outputPreview = summarizeRecentOutput(session.recentOutput);
  const normalizedOutput = outputPreview.toLowerCase();

  const missingCommand = code === 127
    || /\b(command not found|not found|no such file or directory|is not recognized)\b/.test(normalizedOutput);
  const authOrConfigIssue = /(login|log in|sign in|authenticate|authentication|anthropic_api_key|openai_api_key|api key|token|not authenticated|unauthorized|permission denied)/.test(normalizedOutput);
  const invalidArgs = /(unknown option|unexpected argument|invalid option|unrecognized option|usage:)/.test(normalizedOutput);
  const earlyExit = runtimeMs <= EARLY_EXIT_WINDOW_MS;

  if (!missingCommand && !authOrConfigIssue && !invalidArgs && !earlyExit) {
    return null;
  }

  let checklist = `请优先检查本机 ${agentName} CLI 是否已正确安装、可在登录 shell 中直接运行，并确认登录/API Key/权限以及当前面板启动参数配置都有效。`;
  let conclusion = `这类快速启动失败通常来自本机 ${agentName} CLI 的安装、认证或参数配置问题，而不是 ClaudeChrome 扩展本身。`;

  if (missingCommand) {
    checklist = `未找到本地 \`${commandName}\` 命令。请确认 ${agentName} CLI 已安装，并且在登录 shell 中可以直接运行。`;
    conclusion = `这表明失败发生在本机 ${agentName} CLI 的安装或 PATH 配置环节，而不是 ClaudeChrome 扩展本身。`;
  } else if (authOrConfigIssue) {
    checklist = `本地 ${agentName} CLI 已启动，但登录、API Key 或权限配置未完成。请先修复本机 ${agentName} 环境。`;
    conclusion = `这表明失败发生在本机 ${agentName} CLI 的认证或权限配置环节，而不是 ClaudeChrome 扩展本身。`;
  } else if (invalidArgs) {
    checklist = `本地 ${agentName} CLI 启动参数无效。请检查当前面板或全局默认启动参数配置。`;
    conclusion = `这表明失败发生在本机 ${agentName} CLI 的参数配置环节，而不是 ClaudeChrome 扩展本身。`;
  }

  const details = outputPreview ? `\n最近输出摘要: ${outputPreview}` : '';
  return {
    statusMessage: `${agentName} 本地环境未就绪`,
    notice: `${agentName} 未能在本地正常启动。${checklist}\n${conclusion}${details}`,
  };
}

function displayAgentName(agentType: AgentType): string {
  switch (agentType) {
    case 'codex':
      return 'Codex';
    case 'shell':
      return '终端';
    default:
      return 'Claude';
  }
}

function systemNotice(text: string): string {
  const normalizedLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const prefixed = normalizedLines
    .map((line) => `[ClaudeChrome] ${line}`.trimEnd())
    .join('\r\n');
  return `\r\n\x1b[36m${prefixed}\x1b[0m\r\n`;
}

function makeSessionTranscriptPath(runtimeDir: string, sessionId: string): string {
  const sessionDir = path.join(runtimeDir, 'sessions', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  return path.join(sessionDir, 'terminal-history.ansi');
}

function normalizeSessionMode(agentType: AgentType, mode: SessionMode | undefined): SessionMode {
  if (agentType === 'codex' || agentType === 'claude') {
    return mode === 'terminal' ? 'terminal' : 'chat';
  }
  return 'terminal';
}

function pickLaunchEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of LAUNCH_FAILURE_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

function serializeLaunchError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  const errorRecord = error as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key in details) {
      continue;
    }
    const value = errorRecord[key];
    if (typeof value === 'function') {
      continue;
    }
    details[key] = value;
  }

  return details;
}

export class SessionManager {
  private readonly contextStore: ContextStore;
  private readonly runtimeDir: string;
  private readonly mcpBridgeScript: string;
  private storeSocketPath: string;
  private storePort = 0;
  private readonly broadcast: (message: object) => void;
  private readonly dispatchBrowserCommand: SessionManagerOptions['dispatchBrowserCommand'];
  private readonly createCodexChatRuntime: (options: CodexChatRuntimeOptions) => CodexChatRuntime;
  private readonly logEvent?: (event: string, details: Record<string, unknown>) => void;
  private readonly sessions = new Map<string, AgentSession>();

  constructor(options: SessionManagerOptions) {
    this.contextStore = options.contextStore;
    this.runtimeDir = options.runtimeDir;
    this.mcpBridgeScript = options.mcpBridgeScript;
    this.storeSocketPath = options.storeSocketPath;
    this.broadcast = options.broadcast;
    this.dispatchBrowserCommand = options.dispatchBrowserCommand;
    this.createCodexChatRuntime = options.createCodexChatRuntime ?? ((runtimeOptions) => new CodexChatRuntime(runtimeOptions));
    this.logEvent = options.logEvent;
  }

  setStorePort(port: number): void {
    this.storePort = port;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getBindingTabId(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.bindingTabId ?? null;
  }

  getSnapshot(sessionId: string): SessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    return session ? this.toSnapshot(session) : null;
  }

  listSnapshots(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map((session) => this.toSnapshot(session));
  }

  broadcastSnapshot(): void {
    this.broadcast({ type: 'session_snapshot', sessions: this.listSnapshots() });
  }

  createSession(options: CreateSessionOptions): SessionSnapshot {
    const normalizedStartupOptions = normalizeStartupOptions(options.agentType, options.startupOptions);
    const mode = normalizeSessionMode(options.agentType, options.mode);
    const existing = this.sessions.get(options.sessionId);
    if (existing) {
      existing.agentType = options.agentType;
      existing.mode = mode;
      existing.title = options.title;
      existing.bindingTabId = options.bindingTabId;
      existing.cwd = options.cwd;
      existing.startupOptions = normalizedStartupOptions;
      existing.transcriptPath = existing.transcriptPath || makeSessionTranscriptPath(this.runtimeDir, options.sessionId);
      existing.lastActiveAt = Date.now();
      if (existing.mode === 'chat' && !existing.chatRuntime) {
        existing.chatRuntime = this.createChatRuntime(existing);
      }
      this.broadcastSnapshot();
      return this.toSnapshot(existing);
    }

    const now = Date.now();
    const session: AgentSession = {
      sessionId: options.sessionId,
      agentType: options.agentType,
      title: options.title,
      bindingTabId: options.bindingTabId,
      createdAt: now,
      lastActiveAt: now,
      launchStartedAt: now,
      processState: 'starting',
      statusMessage: `正在启动 ${displayAgentName(options.agentType)}…`,
      mode,
      pty: null,
      chatRuntime: null,
      outputBuffer: '',
      recentOutput: '',
      transcriptPath: makeSessionTranscriptPath(this.runtimeDir, options.sessionId),
      shellInputBuffer: '',
      flushTimer: null,
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      startupOptions: normalizedStartupOptions,
    };
    this.sessions.set(session.sessionId, session);
    this.launchSession(session);
    this.broadcastSnapshot();
    return this.toSnapshot(session);
  }

  writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.pty) return;
    session.lastActiveAt = Date.now();
    this.inspectShellInput(session, data);
    session.pty.write(data);
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.cols = cols;
    session.rows = rows;
    session.pty?.resize(cols, rows);
  }

  bindSessionToTab(sessionId: string, tabId: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.bindingTabId = tabId;
    session.lastActiveAt = Date.now();
    session.statusMessage = `已绑定标签页 ${tabId}`;
    this.broadcastSnapshot();
  }

  setSessionMode(sessionId: string, mode: SessionMode): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const nextMode = normalizeSessionMode(session.agentType, mode);
    if (session.mode === nextMode) {
      this.broadcastSnapshot();
      return;
    }
    session.mode = nextMode;
    session.lastActiveAt = Date.now();

    if (nextMode === 'chat' && (session.agentType === 'codex' || session.agentType === 'claude')) {
      session.chatRuntime = session.chatRuntime ?? this.createChatRuntime(session);
      session.statusMessage = session.pty
        ? `${displayAgentName(session.agentType)} 本地 CLI 仍在后台运行；已切换到内置聊天视图`
        : `${displayAgentName(session.agentType)} 内置聊天已启动`;
    } else if (session.pty) {
      session.statusMessage = `${displayAgentName(session.agentType)} 本地 CLI 已恢复显示`;
    }

    this.broadcastSnapshot();
  }

  restartSession(sessionId: string, cwd?: string, agentType?: AgentType, startupOptions?: AgentStartupOptions, mode?: SessionMode): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const previousAgentType = session.agentType;
    const previousMode = session.mode;
    const previousCwd = session.cwd;
    const previousStartupOptions = session.startupOptions;
    const hasPty = Boolean(session.pty);
    if (agentType) {
      session.agentType = agentType;
    }
    const nextMode = normalizeSessionMode(session.agentType, mode ?? session.mode);
    if (cwd) {
      session.cwd = cwd;
    }
    if (startupOptions !== undefined) {
      session.startupOptions = normalizeStartupOptions(session.agentType, startupOptions);
    }
    const onlyModeChanged = previousAgentType === session.agentType
      && previousMode !== nextMode
      && previousCwd === session.cwd
      && startupOptionsEqual(previousStartupOptions, session.startupOptions);
    const canPreserveRunningLocalCliForViewSwitch = hasPty
      && previousAgentType === session.agentType
      && previousMode !== nextMode
      && previousCwd === session.cwd;
    if (onlyModeChanged || canPreserveRunningLocalCliForViewSwitch) {
      session.startupOptions = previousStartupOptions;
      this.setSessionMode(sessionId, nextMode);
      return;
    }
    session.mode = nextMode;
    session.lastActiveAt = Date.now();
    session.statusMessage = `正在重启 ${displayAgentName(session.agentType)}…`;

    const previous = session.pty;
    session.pty = null;
    previous?.kill();
    session.chatRuntime?.dispose();
    session.chatRuntime = null;
    this.flushOutput(session);
    this.launchSession(session);
    this.broadcastSnapshot();
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.flushOutput(session);
    this.sessions.delete(sessionId);
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    const previous = session.pty;
    session.pty = null;
    previous?.kill();
    session.chatRuntime?.dispose();
    session.chatRuntime = null;
    this.broadcast({ type: 'session_closed', sessionId });
    this.broadcastSnapshot();
  }

  closeAllSessions(): void {
    const sessionIds = Array.from(this.sessions.keys());
    if (sessionIds.length === 0) {
      return;
    }

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (!session) continue;
      this.flushOutput(session);
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
        session.flushTimer = null;
      }
      const previous = session.pty;
      session.pty = null;
      previous?.kill();
      session.chatRuntime?.dispose();
      session.chatRuntime = null;
      this.sessions.delete(sessionId);
      this.broadcast({ type: 'session_closed', sessionId });
    }
    this.broadcastSnapshot();
  }

  noteTabUpdated(tabId: number): void {
    if (!Array.from(this.sessions.values()).some((session) => session.bindingTabId === tabId)) {
      return;
    }
    this.broadcastSnapshot();
  }

  flushAllOutputs(): void {
    for (const session of this.sessions.values()) {
      this.flushOutput(session);
    }
  }

  replayAllOutputToClient(send: (message: object) => void): void {
    for (const session of this.sessions.values()) {
      this.replayOutputToClient(session, send);
      session.chatRuntime?.replay(send);
    }
  }

  sendChatMessage(sessionId: string, requestId: string, input: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.mode !== 'chat' || (session.agentType !== 'codex' && session.agentType !== 'claude')) {
      const agentName = session?.agentType ? displayAgentName(session.agentType) : 'Agent';
      this.broadcast({
        type: 'agent_chat_update',
        sessionId,
        message: {
          id: requestId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'error',
          error: `No built-in ${agentName} chat session is active for session: ${sessionId}`,
        },
      });
      return;
    }
    session.lastActiveAt = Date.now();
    session.chatRuntime = session.chatRuntime ?? this.createChatRuntime(session);
    session.chatRuntime.handleRequest(requestId, input);
  }

  cancelChatMessage(sessionId: string, requestId?: string): void {
    this.sessions.get(sessionId)?.chatRuntime?.cancel(requestId);
  }

  shutdown(): void {
    this.closeAllSessions();
  }

  private makeLaunchFailureArtifactPath(session: AgentSession): string {
    return path.join(path.dirname(session.transcriptPath), 'launch-failure.json');
  }

  private recordLaunchFailure(session: AgentSession, launchPlan: AgentLaunchPlan | null, error: unknown): string {
    const artifactPath = this.makeLaunchFailureArtifactPath(session);
    const payload = {
      ts: new Date().toISOString(),
      sessionId: session.sessionId,
      agentType: session.agentType,
      mode: session.mode,
      title: session.title,
      bindingTabId: session.bindingTabId,
      configuredWorkingDirectory: session.startupOptions.workingDirectory.trim(),
      resolvedWorkingDirectory: launchPlan?.spawn.cwd ?? session.cwd,
      command: launchPlan?.spawn.command ?? null,
      args: launchPlan?.spawn.args ?? [],
      cwdExists: fs.existsSync(launchPlan?.spawn.cwd ?? session.cwd),
      commandExists: launchPlan?.spawn.command && path.isAbsolute(launchPlan.spawn.command)
        ? fs.existsSync(launchPlan.spawn.command)
        : null,
      diagnostics: launchPlan?.diagnostics ?? null,
      env: pickLaunchEnvironment(launchPlan?.spawn.env ?? process.env),
      process: {
        platform: process.platform,
        version: process.version,
        arch: process.arch,
      },
      error: serializeLaunchError(error),
    };

    fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.logEvent?.('session_launch_failed', {
      sessionId: session.sessionId,
      agentType: session.agentType,
      artifactPath,
      command: payload.command,
      args: payload.args,
      cwd: payload.resolvedWorkingDirectory,
      cwdExists: payload.cwdExists,
      commandExists: payload.commandExists,
      env: payload.env,
      error: payload.error,
    });
    return artifactPath;
  }

  private createChatRuntime(session: AgentSession): CodexChatRuntime {
    return this.createCodexChatRuntime({
      sessionId: session.sessionId,
      runtimeDir: this.runtimeDir,
      agentType: session.agentType,
      contextStore: this.contextStore,
      getBindingTabId: () => this.getBindingTabId(session.sessionId),
      getWorkingDirectory: () => session.cwd,
      getStartupOptions: () => session.startupOptions,
      dispatchBrowserCommand: (sessionId, tabId, command, params, timeoutMs) => {
        return this.dispatchBrowserCommand(sessionId, tabId, command, params, timeoutMs);
      },
      broadcast: this.broadcast,
      logEvent: this.logEvent,
    });
  }

  private launchSession(session: AgentSession): void {
    if (session.mode === 'chat' && (session.agentType === 'codex' || session.agentType === 'claude')) {
      session.pty = null;
      session.chatRuntime = this.createChatRuntime(session);
      session.processState = 'running';
      session.statusMessage = `${displayAgentName(session.agentType)} 内置聊天已启动`;
      this.broadcastSnapshot();
      return;
    }

    const bridge = new PtyBridge();
    session.pty = bridge;
    session.processState = 'starting';
    session.launchStartedAt = Date.now();
    session.outputBuffer = '';
    session.recentOutput = '';
    session.shellInputBuffer = '';
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }

    bridge.on('data', (data: string) => {
      if (session.pty !== bridge) return;
      this.queueOutput(session, data);
    });

    bridge.on('exit', (code: number) => {
      if (session.pty !== bridge) return;
      session.pty = null;
      this.flushOutput(session);
      this.handleProcessExit(session, code);
    });

    let launchPlan: AgentLaunchPlan | null = null;

    try {
      launchPlan = buildAgentLaunch({
        sessionId: session.sessionId,
        agentType: session.agentType,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        runtimeDir: this.runtimeDir,
        mcpBridgeScript: this.mcpBridgeScript,
        storeSocketPath: this.storeSocketPath,
        storePort: this.storePort,
        launchArgs: session.startupOptions.launchArgs,
        startupOptions: session.startupOptions,
        boundTab: this.contextStore.getTab(session.bindingTabId) ?? undefined,
      });
      bridge.spawn(launchPlan.spawn);
      session.processState = 'running';
      session.statusMessage = `${displayAgentName(session.agentType)} 已启动`;

      if (session.agentType !== 'shell') {
        this.emitSystemNotice(session, formatLaunchDiagnosticsNotice(session.agentType, launchPlan.diagnostics));
      }
    } catch (error) {
      session.pty = null;
      session.processState = 'error';
      session.statusMessage = error instanceof Error ? error.message : String(error);
      const artifactPath = this.recordLaunchFailure(session, launchPlan, error);
      this.emitSystemNotice(
        session,
        `${displayAgentName(session.agentType)} 启动失败。\n错误: ${session.statusMessage}\n诊断文件: ${artifactPath}`,
      );
      this.flushOutput(session);
    }
  }

  private handleProcessExit(session: AgentSession, code: number): void {
    const agentName = displayAgentName(session.agentType);
    session.lastActiveAt = Date.now();
    session.shellInputBuffer = '';

    const startupFailure = classifyLocalAgentStartupFailure(session, code);
    if (startupFailure) {
      session.processState = 'error';
      session.statusMessage = startupFailure.statusMessage;
      this.emitSystemNotice(session, startupFailure.notice);
      this.flushOutput(session);
      this.broadcastSnapshot();
      return;
    }

    session.processState = 'exited';
    session.statusMessage = `${agentName} 已结束（退出码 ${code}）`;
    this.sessions.delete(session.sessionId);
    this.broadcast({ type: 'session_closed', sessionId: session.sessionId });
    this.broadcastSnapshot();
  }

  private inspectShellInput(session: AgentSession, data: string): void {
    if (session.agentType !== 'shell') {
      session.shellInputBuffer = '';
      return;
    }

    for (const char of data) {
      if (char === '\u0003' || char === '\u0004') {
        session.shellInputBuffer = '';
        continue;
      }
      if (char === '\b' || char === '\u007f') {
        session.shellInputBuffer = session.shellInputBuffer.slice(0, -1);
        continue;
      }
      if (char === '\r' || char === '\n') {
        this.maybeWarnAboutDetachedShellLaunch(session, session.shellInputBuffer);
        session.shellInputBuffer = '';
        continue;
      }
      if (char >= ' ' && char !== '\u007f') {
        session.shellInputBuffer += char;
      }
    }
  }

  private maybeWarnAboutDetachedShellLaunch(session: AgentSession, commandLine: string): void {
    const trimmed = commandLine.trim();
    if (!trimmed) {
      return;
    }

    const tokens = trimmed.split(/\s+/);
    const command = tokens[0] === 'exec' ? tokens[1] : tokens[0];
    if (command !== 'claude' && command !== 'codex') {
      return;
    }

    const agentName = command === 'codex' ? 'Codex' : 'Claude';
    this.emitSystemNotice(
      session,
      `在终端面板中启动的 ${agentName} 不会自动关联当前网页。建议直接新建 ${agentName} 面板。`,
    );
  }

  private queueOutput(session: AgentSession, data: string): void {
    session.outputBuffer += data;
    session.recentOutput = pushRecentOutput(session.recentOutput, data);
    if (session.flushTimer) return;
    session.flushTimer = setTimeout(() => {
      this.flushOutput(session);
    }, FLUSH_INTERVAL_MS);
  }

  private flushOutput(session: AgentSession): void {
    if (!session.outputBuffer) {
      session.flushTimer = null;
      return;
    }

    const output = session.outputBuffer;
    session.outputBuffer = '';
    session.flushTimer = null;
    this.appendTranscript(session, output);
    this.broadcastOutput(session, output);
  }

  private appendTranscript(session: AgentSession, data: string): void {
    if (!data) {
      return;
    }
    fs.appendFileSync(session.transcriptPath, data, 'utf8');
  }

  private broadcastOutput(session: AgentSession, data: string): void {
    this.broadcast({
      type: 'session_output',
      sessionId: session.sessionId,
      data: Buffer.from(data).toString('base64'),
    });
  }

  private replayOutputToClient(session: AgentSession, send: (message: object) => void): void {
    if (!fs.existsSync(session.transcriptPath)) {
      return;
    }

    const transcript = fs.readFileSync(session.transcriptPath, 'utf8');
    if (!transcript) {
      return;
    }

    let reset = true;
    for (let offset = 0; offset < transcript.length; offset += TRANSCRIPT_CHUNK_CHARS) {
      const chunk = transcript.slice(offset, offset + TRANSCRIPT_CHUNK_CHARS);
      send({
        type: 'session_output',
        sessionId: session.sessionId,
        data: Buffer.from(chunk).toString('base64'),
        replay: true,
        reset,
      });
      reset = false;
    }
  }

  private emitSystemNotice(session: AgentSession, text: string): void {
    this.queueOutput(session, systemNotice(text));
  }

  private toSnapshot(session: AgentSession): SessionSnapshot {
    const boundTab = this.contextStore.getTab(session.bindingTabId);
    let status: SessionSnapshot['status'];
    let statusMessage = session.statusMessage;

    if (session.processState === 'error') {
      status = 'error';
    } else if (session.processState === 'exited') {
      status = 'exited';
    } else if (session.processState === 'starting') {
      status = 'starting';
    } else if (!boundTab || !boundTab.available) {
      status = 'tab_unavailable';
      statusMessage = statusMessage || '当前绑定的标签页不可用';
    } else {
      status = 'connected';
    }

    return {
      sessionId: session.sessionId,
      agentType: session.agentType,
      mode: session.mode,
      title: session.title,
      binding: {
        kind: 'tab',
        tabId: session.bindingTabId,
      },
      boundTab,
      status,
      statusMessage,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    };
  }
}
