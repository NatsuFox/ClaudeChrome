#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildAgentLaunch,
  DEFAULT_CODEX_LAUNCH_ARGS,
  formatLaunchDiagnosticsNotice,
} = require(path.resolve(__dirname, '../native-host/dist/agent-runtime.js'));
const { IMPLEMENTED_SESSION_TOOLS } = require(path.resolve(__dirname, '../native-host/dist/browser-tools.js'));

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
    startupOptions: {
      launchArgs: '--search',
      workingDirectory: '',
      systemPromptMode: 'default',
      customSystemPrompt: '',
    },
    boundTab: {
      tabId: 42,
      title: 'Example page',
      url: 'https://example.com/docs',
    },
    ...overrides,
  };
}

console.log('\n\x1b[1mClaudeChrome — Agent Runtime Launch Tests\x1b[0m');
console.log('='.repeat(48));

test('Claude launch appends browser-aware startup prompt', () => {
  const plan = withPlatform('linux', () => buildAgentLaunch(baseOptions({
    agentType: 'claude',
    startupOptions: {
      launchArgs: '--search',
      workingDirectory: '',
      systemPromptMode: 'custom',
      customSystemPrompt: 'Always mention the injected browser context in your first reply.',
    },
  })));

  assert.strictEqual(plan.spawn.command, 'bash');
  assert.strictEqual(plan.spawn.args[0], '--login');
  assert(plan.spawn.args[2].includes('--mcp-config'));
  assert(plan.spawn.args[2].includes('--append-system-prompt'));
  assert(plan.spawn.args[2].includes('https://example.com/docs'));
  assert(plan.spawn.args[2].includes('Always mention the injected browser context'));
  assert.strictEqual(plan.diagnostics.transport, 'append-system-prompt');
  assert(plan.diagnostics.effectivePrompt.includes('Example page'));
});

test('Codex launch carries browser context as initial startup instructions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-agent-runtime-'));
  const fakeBash = path.join(tempRoot, 'Git', 'bin', 'bash.exe');
  fs.mkdirSync(path.dirname(fakeBash), { recursive: true });
  fs.writeFileSync(fakeBash, '');

  const plan = withPlatform('win32', () => withEnv({
    CLAUDECHROME_BASH_PATH: undefined,
    ProgramFiles: tempRoot,
    'ProgramFiles(x86)': undefined,
    LOCALAPPDATA: undefined,
  }, () => buildAgentLaunch(baseOptions({
    agentType: 'codex',
    cwd: 'C:\\Workspace\\project',
    mcpBridgeScript: 'C:\\Repo\\native-host\\dist\\mcp-stdio-bridge.js',
    startupOptions: {
      launchArgs: DEFAULT_CODEX_LAUNCH_ARGS,
      workingDirectory: '~/project',
      systemPromptMode: 'default',
      customSystemPrompt: '',
    },
  }))));

  assert.strictEqual(plan.spawn.command, fakeBash);
  assert.strictEqual(plan.spawn.cwd, 'C:\\Workspace\\project');
  assert(plan.spawn.args[2].includes('C:/Repo/native-host/dist/mcp-stdio-bridge.js'));
  assert(plan.spawn.args[2].includes('workspace-write'));
  IMPLEMENTED_SESSION_TOOLS.forEach((toolName) => {
    assert(plan.spawn.args[2].includes(`tools.${toolName}.approval_mode`));
  });
  assert(plan.spawn.args[2].includes('You are running inside ClaudeChrome'));
  assert(plan.spawn.args[2].includes('https://example.com/docs'));
  assert.strictEqual(plan.diagnostics.transport, 'initial-prompt');
  assert.strictEqual(plan.diagnostics.configuredWorkingDirectory, '~/project');
  assert.strictEqual(plan.diagnostics.resolvedWorkingDirectory, 'C:\\Workspace\\project');
});

test('Disabling prompt injection leaves launch transport disabled', () => {
  const plan = withPlatform('linux', () => buildAgentLaunch(baseOptions({
    agentType: 'claude',
    startupOptions: {
      launchArgs: '--search',
      workingDirectory: '',
      systemPromptMode: 'none',
      customSystemPrompt: '',
    },
  })));

  assert.strictEqual(plan.diagnostics.transport, 'disabled');
  assert.strictEqual(plan.diagnostics.effectivePrompt, '');
  assert(!plan.spawn.args[2].includes('--append-system-prompt'));
});

test('Launch diagnostics notice is structured for terminal rendering', () => {
  const notice = formatLaunchDiagnosticsNotice('claude', {
    transport: 'append-system-prompt',
    configuredWorkingDirectory: '~/workspace',
    resolvedWorkingDirectory: '/tmp/workspace',
    launchArgs: '',
    effectivePrompt: 'line one\nline two',
  });

  assert(notice.includes('配置目录: ~/workspace'));
  assert(notice.includes('实际目录: /tmp/workspace'));
  assert(notice.includes('启动参数: 无'));
  assert(notice.includes('注入内容:\n  line one\n  line two'));
});

console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  process.exit(1);
}
