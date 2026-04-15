import * as fs from 'node:fs';
import * as path from 'node:path';
import { IMPLEMENTED_SESSION_TOOLS } from './browser-tools.js';
import type { PtySpawnOptions } from './pty-bridge.js';

export type AgentType = 'claude' | 'codex' | 'shell';
export type SystemPromptMode = 'default' | 'custom' | 'none';
export type PromptTransport = 'append-system-prompt' | 'initial-prompt' | 'disabled';

export interface AgentStartupOptions {
  launchArgs: string;
  workingDirectory: string;
  systemPromptMode: SystemPromptMode;
  customSystemPrompt: string;
}

export interface BoundTabContext {
  tabId: number;
  title?: string;
  url?: string;
}

export interface AgentLaunchOptions {
  sessionId: string;
  agentType: AgentType;
  cwd: string;
  cols: number;
  rows: number;
  runtimeDir: string;
  mcpBridgeScript: string;
  storeSocketPath: string;
  storePort: number;
  launchArgs?: string;
  startupOptions?: AgentStartupOptions;
  boundTab?: BoundTabContext | null;
}

export interface AgentLaunchDiagnostics {
  transport: PromptTransport;
  configuredWorkingDirectory: string;
  resolvedWorkingDirectory: string;
  launchArgs: string;
  effectivePrompt: string;
}

export interface AgentLaunchPlan {
  spawn: PtySpawnOptions;
  diagnostics: AgentLaunchDiagnostics;
}

export const DEFAULT_CODEX_LAUNCH_ARGS = '-a never -s workspace-write';
const CLAUDECHROME_BROWSER_MCP_SERVER = 'claudechrome-browser';
const CODEX_MCP_TOOL_APPROVAL_MODE = 'approve';

function buildCodexMcpApprovalOverrides(serverName: string): string[] {
  return IMPLEMENTED_SESSION_TOOLS.flatMap((toolName) => [
    '-c',
    `mcp_servers.${serverName}.tools.${toolName}.approval_mode="${CODEX_MCP_TOOL_APPROVAL_MODE}"`,
  ]);
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizePathForToml(value: string): string {
  return process.platform === 'win32' ? value.replace(/\\/g, '/') : value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function existingPath(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveBashCommand(): string {
  const override = process.env.CLAUDECHROME_BASH_PATH?.trim();
  if (override) {
    return override;
  }

  if (process.platform !== 'win32') {
    return 'bash';
  }

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;

  const gitBash = existingPath([
    programFiles ? path.join(programFiles, 'Git', 'bin', 'bash.exe') : undefined,
    programFiles ? path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe') : undefined,
    programFilesX86 ? path.join(programFilesX86, 'Git', 'bin', 'bash.exe') : undefined,
    programFilesX86 ? path.join(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe') : undefined,
    localAppData ? path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : undefined,
    localAppData ? path.join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'bash.exe') : undefined,
  ]);

  return gitBash || 'bash';
}

function wrapWithLoginShell(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, cols: number, rows: number): PtySpawnOptions {
  const commandLine = ['exec', shellQuote(command), ...args.map(shellQuote)].join(' ');
  return {
    command: resolveBashCommand(),
    args: ['--login', '-ic', commandLine],
    cwd,
    env,
    cols,
    rows,
  };
}

function ensureSessionDir(runtimeDir: string, sessionId: string): string {
  const sessionDir = path.join(runtimeDir, 'sessions', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

function splitCommandLine(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  const args: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote === 'single') {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'") {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }
  if (current) {
    args.push(current);
  }
  return args;
}

export function defaultStartupOptionsForAgent(agentType: AgentType): AgentStartupOptions {
  return {
    launchArgs: agentType === 'codex' ? DEFAULT_CODEX_LAUNCH_ARGS : '',
    workingDirectory: '',
    systemPromptMode: 'default',
    customSystemPrompt: '',
  };
}

export function normalizeStartupOptions(agentType: AgentType, value: Partial<AgentStartupOptions> | undefined): AgentStartupOptions {
  const defaults = defaultStartupOptionsForAgent(agentType);
  return {
    launchArgs: typeof value?.launchArgs === 'string' ? value.launchArgs : defaults.launchArgs,
    workingDirectory: typeof value?.workingDirectory === 'string' ? value.workingDirectory : defaults.workingDirectory,
    systemPromptMode: value?.systemPromptMode === 'custom' || value?.systemPromptMode === 'none'
      ? value.systemPromptMode
      : defaults.systemPromptMode,
    customSystemPrompt: typeof value?.customSystemPrompt === 'string' ? value.customSystemPrompt : defaults.customSystemPrompt,
  };
}

function buildBoundTabLines(boundTab?: BoundTabContext | null): string[] {
  if (!boundTab) {
    return [
      '- tabId: <unknown>',
      '- title: <not available yet>',
      '- url: <not available yet>',
    ];
  }

  return [
    `- tabId: ${boundTab.tabId}`,
    `- title: ${boundTab.title?.trim() || '<untitled>'}`,
    `- url: ${boundTab.url?.trim() || '<unknown>'}`,
  ];
}

function buildEffectiveStartupPrompt(options: AgentLaunchOptions, startupOptions: AgentStartupOptions): string {
  if (startupOptions.systemPromptMode === 'none') {
    return '';
  }

  const lines = [
    'You are running inside ClaudeChrome, a browser-attached agent session.',
    'Use the `claudechrome-browser` MCP server as the source of truth for live browser state.',
    'When the user says "this page", "the current tab", or similar, treat it as the tab bound to this session unless they explicitly specify another tab.',
    'Prefer browser tools and live page inspection over static assumptions.',
    'Current bound tab at launch:',
    ...buildBoundTabLines(options.boundTab),
  ];

  if (startupOptions.systemPromptMode === 'custom' && startupOptions.customSystemPrompt.trim()) {
    lines.push('', 'Additional custom startup instructions:', startupOptions.customSystemPrompt.trim());
  }

  return lines.join('\n');
}

export function formatLaunchDiagnosticsNotice(agentType: AgentType, diagnostics: AgentLaunchDiagnostics): string {
  const label = agentType === 'codex' ? 'Codex' : agentType === 'shell' ? '终端' : 'Claude';
  const configuredWorkingDirectory = diagnostics.configuredWorkingDirectory || '默认工作区';
  const lines = [
    `${label} 启动配置已应用`,
    `配置目录: ${configuredWorkingDirectory}`,
    `实际目录: ${diagnostics.resolvedWorkingDirectory}`,
    `启动参数: ${diagnostics.launchArgs || '无'}`,
  ];

  if (diagnostics.transport === 'disabled') {
    lines.push('浏览器环境提示: 已禁用');
    return lines.join('\n');
  }

  lines.push(
    `浏览器环境提示: ${diagnostics.transport === 'append-system-prompt' ? '通过 --append-system-prompt 注入' : '作为启动时的首条上下文指令注入'}`,
    '注入内容:',
    ...diagnostics.effectivePrompt.split('\n').map((line) => `  ${line}`),
  );
  return lines.join('\n');
}

function buildClaudeLaunch(options: AgentLaunchOptions, startupOptions: AgentStartupOptions): AgentLaunchPlan {
  const sessionDir = ensureSessionDir(options.runtimeDir, options.sessionId);
  const configPath = path.join(sessionDir, 'claude-mcp-config.json');
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const config = {
    mcpServers: {
      'claudechrome-browser': {
        command: 'node',
        args: [options.mcpBridgeScript],
        env: {
          CLAUDECHROME_STORE_PORT: String(options.storePort),
          CLAUDECHROME_SESSION_ID: options.sessionId,
        },
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const effectivePrompt = buildEffectiveStartupPrompt(options, startupOptions);
  const args = [
    '--setting-sources',
    'user,project,local',
    '--mcp-config',
    configPath,
  ];

  if (effectivePrompt) {
    args.push('--append-system-prompt', effectivePrompt);
  }

  args.push(...splitCommandLine(startupOptions.launchArgs));

  return {
    spawn: wrapWithLoginShell('claude', args, options.cwd, env, options.cols, options.rows),
    diagnostics: {
      transport: effectivePrompt ? 'append-system-prompt' : 'disabled',
      configuredWorkingDirectory: startupOptions.workingDirectory.trim(),
      resolvedWorkingDirectory: options.cwd,
      launchArgs: startupOptions.launchArgs.trim(),
      effectivePrompt,
    },
  };
}

function buildCodexLaunch(options: AgentLaunchOptions, startupOptions: AgentStartupOptions): AgentLaunchPlan {
  const env = { ...process.env };
  const bridgeScript = escapeTomlBasicString(normalizePathForToml(options.mcpBridgeScript));
  const sessionId = escapeTomlBasicString(options.sessionId);
  const effectivePrompt = buildEffectiveStartupPrompt(options, startupOptions);

  const args = [
    '-c',
    `mcp_servers.${CLAUDECHROME_BROWSER_MCP_SERVER}.command=\"node\"`,
    '-c',
    `mcp_servers.${CLAUDECHROME_BROWSER_MCP_SERVER}.args=["${bridgeScript}"]`,
    '-c',
    `mcp_servers.${CLAUDECHROME_BROWSER_MCP_SERVER}.env={CLAUDECHROME_STORE_PORT="${options.storePort}",CLAUDECHROME_SESSION_ID="${sessionId}"}`,
    ...buildCodexMcpApprovalOverrides(CLAUDECHROME_BROWSER_MCP_SERVER),
    ...splitCommandLine(startupOptions.launchArgs),
  ];

  if (effectivePrompt) {
    args.push(effectivePrompt);
  }

  return {
    spawn: wrapWithLoginShell('codex', args, options.cwd, env, options.cols, options.rows),
    diagnostics: {
      transport: effectivePrompt ? 'initial-prompt' : 'disabled',
      configuredWorkingDirectory: startupOptions.workingDirectory.trim(),
      resolvedWorkingDirectory: options.cwd,
      launchArgs: startupOptions.launchArgs.trim(),
      effectivePrompt,
    },
  };
}

function buildShellLaunch(options: AgentLaunchOptions, startupOptions: AgentStartupOptions): AgentLaunchPlan {
  return {
    spawn: {
      command: resolveBashCommand(),
      args: ['--login'],
      cwd: options.cwd,
      env: { ...process.env },
      cols: options.cols,
      rows: options.rows,
    },
    diagnostics: {
      transport: 'disabled',
      configuredWorkingDirectory: startupOptions.workingDirectory.trim(),
      resolvedWorkingDirectory: options.cwd,
      launchArgs: startupOptions.launchArgs.trim(),
      effectivePrompt: '',
    },
  };
}

export function buildAgentLaunch(options: AgentLaunchOptions): AgentLaunchPlan {
  const startupOptions = normalizeStartupOptions(options.agentType, options.startupOptions);
  switch (options.agentType) {
    case 'claude':
      return buildClaudeLaunch(options, startupOptions);
    case 'codex':
      return buildCodexLaunch(options, startupOptions);
    case 'shell':
      return buildShellLaunch(options, startupOptions);
    default:
      throw new Error(`Unsupported agent type: ${String(options.agentType)}`);
  }
}
