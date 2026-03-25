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
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function wrapWithLoginShell(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, cols: number, rows: number): PtySpawnOptions {
  const commandLine = ['exec', shellQuote(command), ...args.map(shellQuote)].join(' ');
  return {
    command: 'bash',
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
          CLAUDECHROME_STORE_SOCKET: options.storeSocketPath,
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
    ],
    options.cwd,
    env,
    options.cols,
    options.rows,
  );
}

function buildCodexLaunch(options: AgentLaunchOptions): PtySpawnOptions {
  const env = { ...process.env };
  const bridgeScript = escapeTomlBasicString(options.mcpBridgeScript);
  const storeSocket = escapeTomlBasicString(options.storeSocketPath);
  const sessionId = escapeTomlBasicString(options.sessionId);

  return wrapWithLoginShell(
    'codex',
    [
      '-c',
      'mcp_servers.claudechrome-browser.command="node"',
      '-c',
      `mcp_servers.claudechrome-browser.args=["${bridgeScript}"]`,
      '-c',
      `mcp_servers.claudechrome-browser.env={CLAUDECHROME_STORE_SOCKET="${storeSocket}",CLAUDECHROME_SESSION_ID="${sessionId}"}`,
    ],
    options.cwd,
    env,
    options.cols,
    options.rows,
  );
}

function buildShellLaunch(options: AgentLaunchOptions): PtySpawnOptions {
  return {
    command: 'bash',
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
