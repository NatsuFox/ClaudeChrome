import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PtySpawnOptions } from './pty-bridge.js';

export type AgentType = 'claude' | 'codex' | 'shell';

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
  bindingTabId: number;
  boundTabTitle?: string;
  boundTabUrl?: string;
  launchArgs?: string;
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

function truncatePromptValue(value: string | undefined, maxLength = 200): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function buildBrowserSessionGuidance(options: AgentLaunchOptions, requireAck = false): string {
  const parts = [
    'You are running inside ClaudeChrome.',
    `This session is bound to browser tab #${options.bindingTabId}.`,
  ];

  const tabTitle = truncatePromptValue(options.boundTabTitle);
  const tabUrl = truncatePromptValue(options.boundTabUrl);
  if (tabTitle) {
    parts.push(`Bound tab title: ${tabTitle}.`);
  }
  if (tabUrl) {
    parts.push(`Bound tab URL: ${tabUrl}.`);
  }

  parts.push('When a task depends on the current page, tab state, DOM, browser requests, console output, cookies, storage, or page actions, use the injected claudechrome-browser MCP tools first.');
  parts.push('Treat the bound browser tab as the primary session context before falling back to local workspace inspection or generic web fetches.');
  parts.push('Do not make code or filesystem changes until the user asks.');
  if (requireAck) {
    parts.push('Reply with one short readiness note and then wait for the next user instruction.');
  }

  return parts.join(' ');
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

function buildClaudeLaunch(options: AgentLaunchOptions): PtySpawnOptions {
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

  return wrapWithLoginShell(
    'claude',
    [
      '--setting-sources',
      'user,project,local',
      '--mcp-config',
      configPath,
      '--append-system-prompt',
      buildBrowserSessionGuidance(options),
      ...splitCommandLine(options.launchArgs),
    ],
    options.cwd,
    env,
    options.cols,
    options.rows,
  );
}

function buildCodexLaunch(options: AgentLaunchOptions): PtySpawnOptions {
  const env = { ...process.env };
  const bridgeScript = escapeTomlBasicString(normalizePathForToml(options.mcpBridgeScript));
  const sessionId = escapeTomlBasicString(options.sessionId);

  return wrapWithLoginShell(
    'codex',
    [
      '-c',
      'mcp_servers.claudechrome-browser.command="node"',
      '-c',
      `mcp_servers.claudechrome-browser.args=["${bridgeScript}"]`,
      '-c',
      `mcp_servers.claudechrome-browser.env={CLAUDECHROME_STORE_PORT="${options.storePort}",CLAUDECHROME_SESSION_ID="${sessionId}"}`,
      ...splitCommandLine(options.launchArgs),
      buildBrowserSessionGuidance(options, true),
    ],
    options.cwd,
    env,
    options.cols,
    options.rows,
  );
}

function buildShellLaunch(options: AgentLaunchOptions): PtySpawnOptions {
  return {
    command: resolveBashCommand(),
    args: ['--login'],
    cwd: options.cwd,
    env: { ...process.env },
    cols: options.cols,
    rows: options.rows,
  };
}

export function buildAgentLaunch(options: AgentLaunchOptions): PtySpawnOptions {
  switch (options.agentType) {
    case 'claude':
      return buildClaudeLaunch(options);
    case 'codex':
      return buildCodexLaunch(options);
    case 'shell':
      return buildShellLaunch(options);
    default:
      throw new Error(`Unsupported agent type: ${String(options.agentType)}`);
  }
}
