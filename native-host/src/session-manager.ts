import {
  buildAgentLaunch,
  formatLaunchDiagnosticsNotice,
  normalizeStartupOptions,
  type AgentStartupOptions,
  type AgentType,
} from './agent-runtime.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContextStore } from './context-store.js';
import { PtyBridge } from './pty-bridge.js';

type ProcessState = 'starting' | 'running' | 'error' | 'exited';

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
  pty: PtyBridge | null;
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
}

const FLUSH_INTERVAL_MS = 16;
const TRANSCRIPT_CHUNK_CHARS = 200_000;
const EARLY_EXIT_WINDOW_MS = 10_000;
const RECENT_OUTPUT_BUFFER_CHARS = 4_000;
const OUTPUT_PREVIEW_CHARS = 220;

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

export class SessionManager {
  private readonly contextStore: ContextStore;
  private readonly runtimeDir: string;
  private readonly mcpBridgeScript: string;
  private storeSocketPath: string;
  private storePort = 0;
  private readonly broadcast: (message: object) => void;
  private readonly sessions = new Map<string, AgentSession>();

  constructor(options: SessionManagerOptions) {
    this.contextStore = options.contextStore;
    this.runtimeDir = options.runtimeDir;
    this.mcpBridgeScript = options.mcpBridgeScript;
    this.storeSocketPath = options.storeSocketPath;
    this.broadcast = options.broadcast;
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
    const existing = this.sessions.get(options.sessionId);
    if (existing) {
      existing.agentType = options.agentType;
      existing.title = options.title;
      existing.bindingTabId = options.bindingTabId;
      existing.cwd = options.cwd;
      existing.startupOptions = normalizedStartupOptions;
      existing.transcriptPath = existing.transcriptPath || makeSessionTranscriptPath(this.runtimeDir, options.sessionId);
      existing.lastActiveAt = Date.now();
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
      pty: null,
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

  restartSession(sessionId: string, cwd?: string, agentType?: AgentType, startupOptions?: AgentStartupOptions): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (agentType) {
      session.agentType = agentType;
    }
    if (cwd) {
      session.cwd = cwd;
    }
    if (startupOptions !== undefined) {
      session.startupOptions = normalizeStartupOptions(session.agentType, startupOptions);
    }
    session.lastActiveAt = Date.now();
    session.statusMessage = `正在重启 ${displayAgentName(session.agentType)}…`;

    const previous = session.pty;
    session.pty = null;
    previous?.kill();
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
    }
  }

  shutdown(): void {
    this.closeAllSessions();
  }

  private launchSession(session: AgentSession): void {
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

    try {
      const launchPlan = buildAgentLaunch({
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
