#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildAgentLaunch } = require(path.resolve(__dirname, '../native-host/dist/agent-runtime.js'));

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed += 1;
}

function fail(label, detail = '') {
  console.error(`  \x1b[31m✗\x1b[0m ${label}${detail ? `: ${detail}` : ''}`);
  failed += 1;
}

function test(label, fn) {
  try {
    fn();
    pass(label);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

function withPlatform(platform, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function baseOptions(overrides = {}) {
  return {
    sessionId: 'session-123',
    agentType: 'claude',
    cwd: '/tmp/workspace',
    cols: 100,
    rows: 40,
    runtimeDir: '/tmp/claudechrome-runtime',
    mcpBridgeScript: '/tmp/claudechrome-runtime/mcp-stdio-bridge.js',
    storeSocketPath: '/tmp/claudechrome-runtime/store.sock',
    storePort: 43121,
    bindingTabId: 17,
    boundTabTitle: 'ClaudeChrome Test Tab',
    boundTabUrl: 'https://example.com/path?x=1',
    launchArgs: '--search',
    ...overrides,
  };
}

console.log('\n\x1b[1mClaudeChrome — Agent Runtime Launch Tests\x1b[0m');
console.log('='.repeat(48));

test('Claude launch appends browser-session system guidance', () => {
  const launch = withPlatform('linux', () => buildAgentLaunch(baseOptions({ agentType: 'claude' })));
  assert.strictEqual(launch.command, 'bash');
  assert.strictEqual(launch.args[0], '--login');
  assert(launch.args[2].includes('--append-system-prompt'));
  assert(launch.args[2].includes('browser tab #17'));
  assert(launch.args[2].includes('claudechrome-browser MCP tools first'));
  assert(launch.args[2].includes('https://example.com/path?x=1'));
});

test('Windows Codex launch normalizes bridge path and includes startup guidance prompt', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-agent-runtime-'));
  const fakeBash = path.join(tempRoot, 'Git', 'bin', 'bash.exe');
  fs.mkdirSync(path.dirname(fakeBash), { recursive: true });
  fs.writeFileSync(fakeBash, '');

  const launch = withPlatform('win32', () => withEnv({
    CLAUDECHROME_BASH_PATH: undefined,
    ProgramFiles: tempRoot,
    'ProgramFiles(x86)': undefined,
    LOCALAPPDATA: undefined,
  }, () => buildAgentLaunch(baseOptions({
    agentType: 'codex',
    mcpBridgeScript: 'C:\\Repo\\native-host\\dist\\mcp-stdio-bridge.js',
    launchArgs: '-a never -s danger-full-access',
    bindingTabId: 42,
    boundTabTitle: 'Bound Product Page',
    boundTabUrl: 'https://example.com/products/42',
  }))));

  assert.strictEqual(launch.command, fakeBash);
  assert(launch.args[2].includes('C:/Repo/native-host/dist/mcp-stdio-bridge.js'));
  assert(launch.args[2].includes('browser tab #42'));
  assert(launch.args[2].includes('Bound Product Page'));
  assert(launch.args[2].includes('Reply with one short readiness note'));
});

test('Explicit bash override wins over platform discovery on Windows', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-agent-runtime-override-'));
  const overrideBash = path.join(tempRoot, 'portable', 'bash.exe');
  fs.mkdirSync(path.dirname(overrideBash), { recursive: true });
  fs.writeFileSync(overrideBash, '');

  const launch = withPlatform('win32', () => withEnv({
    CLAUDECHROME_BASH_PATH: overrideBash,
    ProgramFiles: path.join(tempRoot, 'unused'),
    'ProgramFiles(x86)': undefined,
    LOCALAPPDATA: undefined,
  }, () => buildAgentLaunch(baseOptions({ agentType: 'shell' }))));

  assert.strictEqual(launch.command, overrideBash);
});

console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  process.exit(1);
}
