#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SessionManager } = require(path.resolve(__dirname, '../native-host/dist/session-manager.js'));
const { ContextStore } = require(path.resolve(__dirname, '../native-host/dist/context-store.js'));

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

function createManager(runtimeDir, overrides = {}) {
  const manager = new SessionManager({
    contextStore: new ContextStore(),
    runtimeDir,
    mcpBridgeScript: path.join(runtimeDir, 'mcp-stdio-bridge.js'),
    storeSocketPath: path.join(runtimeDir, 'store.sock'),
    broadcast: () => {},
    ...overrides,
  });
  manager.launchSession = () => {};
  return manager;
}

function createSession(manager, overrides = {}) {
  const options = {
    sessionId: 'session-1',
    agentType: 'claude',
    title: 'Claude 1',
    bindingTabId: 42,
    cols: 100,
    rows: 40,
    cwd: '/tmp/workspace',
    ...overrides,
  };
  manager.createSession(options);
  return manager.sessions.get(options.sessionId);
}

console.log('\n\x1b[1mClaudeChrome — Session History Tests\x1b[0m');
console.log('='.repeat(48));

test('flushOutput persists terminal data and replay restores it', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const manager = createManager(runtimeDir);
  const session = createSession(manager);

  manager.queueOutput(session, 'hello\nworld\n');
  manager.flushAllOutputs();

  assert.strictEqual(fs.readFileSync(session.transcriptPath, 'utf8'), 'hello\nworld\n');

  const replayMessages = [];
  manager.replayAllOutputToClient((message) => replayMessages.push(message));

  assert.strictEqual(replayMessages.length, 1);
  assert.strictEqual(replayMessages[0].type, 'session_output');
  assert.strictEqual(replayMessages[0].sessionId, 'session-1');
  assert.strictEqual(replayMessages[0].replay, true);
  assert.strictEqual(replayMessages[0].reset, true);
  assert.strictEqual(Buffer.from(replayMessages[0].data, 'base64').toString('utf8'), 'hello\nworld\n');
});

test('replay splits long transcripts into ordered reset-aware chunks', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const manager = createManager(runtimeDir);
  const session = createSession(manager, { sessionId: 'session-2', title: 'Codex 1', agentType: 'codex' });
  const transcript = 'x'.repeat(210_000) + '\n' + 'y'.repeat(210_000);

  manager.queueOutput(session, transcript);
  manager.flushAllOutputs();

  const replayMessages = [];
  manager.replayAllOutputToClient((message) => replayMessages.push(message));

  assert(replayMessages.length >= 3);
  assert.strictEqual(replayMessages[0].reset, true);
  replayMessages.slice(1).forEach((message) => {
    assert.strictEqual(message.reset, false);
    assert.strictEqual(message.replay, true);
  });

  const restored = replayMessages
    .map((message) => Buffer.from(message.data, 'base64').toString('utf8'))
    .join('');
  assert.strictEqual(restored, transcript);
});

test('quick agent startup failures stay visible as local-environment errors', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const broadcasts = [];
  const manager = createManager(runtimeDir, {
    broadcast: (message) => broadcasts.push(message),
  });
  const session = createSession(manager, { sessionId: 'session-3', title: 'Codex 2', agentType: 'codex' });

  session.processState = 'running';
  session.launchStartedAt = Date.now();
  manager.queueOutput(session, 'bash: exec: codex: not found\n');
  manager.flushAllOutputs();
  manager.handleProcessExit(session, 127);

  assert.strictEqual(manager.hasSession('session-3'), true);

  const snapshot = manager.getSnapshot('session-3');
  assert(snapshot);
  assert.strictEqual(snapshot.status, 'error');
  assert.strictEqual(snapshot.statusMessage, 'Codex 本地环境未就绪');

  const transcript = fs.readFileSync(session.transcriptPath, 'utf8');
  assert.match(transcript, /codex: not found/);
  assert.match(transcript, /不是 ClaudeChrome 扩展本身/);

  assert.strictEqual(broadcasts.some((message) => message.type === 'session_closed' && message.sessionId === 'session-3'), false);
  assert.strictEqual(broadcasts.some((message) => message.type === 'session_snapshot' && message.sessions.some((entry) => entry.sessionId === 'session-3' && entry.status === 'error')), true);
});

test('system notices prefix each rendered line in the transcript', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const manager = createManager(runtimeDir);
  const session = createSession(manager, { sessionId: 'session-4', title: 'Claude 2', agentType: 'claude' });

  manager.emitSystemNotice(session, 'line one\nline two');
  manager.flushAllOutputs();

  const transcript = fs.readFileSync(session.transcriptPath, 'utf8');
  assert.match(transcript, /\[ClaudeChrome\] line one\r\n\[ClaudeChrome\] line two/);
});

test('launch failures write a per-session diagnostics artifact and host log entry', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const logEntries = [];
  const manager = createManager(runtimeDir, {
    logEvent: (event, details) => logEntries.push({ event, details }),
  });
  const session = createSession(manager, { sessionId: 'session-5', title: 'Shell 5', agentType: 'shell' });

  manager.recordLaunchFailure(session, {
    spawn: {
      command: '/bin/bash',
      args: ['--login'],
      cwd: '/tmp/workspace',
      env: {
        PATH: '/usr/bin:/bin',
        HOME: '/Users/tester',
      },
      cols: 100,
      rows: 40,
    },
    diagnostics: {
      transport: 'disabled',
      configuredWorkingDirectory: '',
      resolvedWorkingDirectory: '/tmp/workspace',
      launchArgs: '',
      effectivePrompt: '',
    },
  }, Object.assign(new Error('posix_spawnp failed.'), { code: 'ENOENT' }));

  const artifactPath = path.join(runtimeDir, 'sessions', 'session-5', 'launch-failure.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.strictEqual(artifact.command, '/bin/bash');
  assert.strictEqual(artifact.error.message, 'posix_spawnp failed.');
  assert.strictEqual(artifact.error.code, 'ENOENT');
  assert.strictEqual(logEntries.some((entry) => entry.event === 'session_launch_failed' && entry.details.artifactPath === artifactPath), true);
});

console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  process.exit(1);
}
