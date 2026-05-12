#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SessionManager } = require(path.resolve(__dirname, '../native-host/dist/session-manager.js'));
const { ContextStore } = require(path.resolve(__dirname, '../native-host/dist/context-store.js'));
const codexChatRuntime = require(path.resolve(__dirname, '../native-host/dist/codex-chat-runtime.js'));
const localAgentConfig = require(path.resolve(__dirname, '../native-host/dist/local-agent-config.js'));

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

function startupOptions(overrides = {}) {
  return {
    launchArgs: '',
    workingDirectory: '',
    systemPromptMode: 'default',
    customSystemPrompt: '',
    apiBaseUrl: '',
    apiKey: '',
    model: '',
    ...overrides,
  };
}

function createManager(runtimeDir, overrides = {}) {
  const manager = new SessionManager({
    contextStore: new ContextStore(),
    runtimeDir,
    mcpBridgeScript: path.join(runtimeDir, 'mcp-stdio-bridge.js'),
    storeSocketPath: path.join(runtimeDir, 'store.sock'),
    broadcast: () => {},
    dispatchBrowserCommand: async () => ({ ok: true }),
    ...overrides,
  });
  if (!overrides.useRealLaunch) {
    manager.launchSession = () => {};
  }
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
  const terminalReplay = replayMessages.filter((message) => message.type === 'session_output');

  assert.strictEqual(terminalReplay.length, 1);
  assert.strictEqual(terminalReplay[0].sessionId, 'session-1');
  assert.strictEqual(terminalReplay[0].replay, true);
  assert.strictEqual(terminalReplay[0].reset, true);
  assert.strictEqual(Buffer.from(terminalReplay[0].data, 'base64').toString('utf8'), 'hello\nworld\n');
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
  const terminalReplay = replayMessages.filter((message) => message.type === 'session_output');

  assert(terminalReplay.length >= 3);
  assert.strictEqual(terminalReplay[0].reset, true);
  terminalReplay.slice(1).forEach((message) => {
    assert.strictEqual(message.reset, false);
    assert.strictEqual(message.replay, true);
  });

  const restored = terminalReplay
    .map((message) => Buffer.from(message.data, 'base64').toString('utf8'))
    .join('');
  assert.strictEqual(restored, transcript);
});

test('codex and claude chat sessions use the built-in runtime without launching a PTY', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const broadcasts = [];
  const chatRequests = [];
  const manager = createManager(runtimeDir, {
    broadcast: (message) => broadcasts.push(message),
    useRealLaunch: true,
    createCodexChatRuntime: (options) => ({
      handleRequest: (requestId, input) => chatRequests.push({ requestId, input, sessionId: options.sessionId }),
      cancel: () => {},
      replay: (send) => send({
        type: 'agent_chat_update',
        sessionId: options.sessionId,
        message: {
          id: 'replayed',
          role: 'assistant',
          content: 'Replayed chat',
          createdAt: 1,
          status: 'completed',
        },
        replay: true,
        reset: true,
      }),
      dispose: () => {},
    }),
  });
  const session = createSession(manager, {
    sessionId: 'chat-session',
    title: 'Codex Chat',
    agentType: 'codex',
    mode: 'chat',
  });

  assert.strictEqual(session.mode, 'chat');
  assert.strictEqual(session.pty, null);
  assert(session.chatRuntime);

  const snapshot = manager.getSnapshot('chat-session');
  assert(snapshot);
  assert.strictEqual(snapshot.mode, 'chat');
  assert.strictEqual(snapshot.status, 'tab_unavailable');
  assert.strictEqual(snapshot.statusMessage, 'Codex 内置聊天已启动');

  manager.sendChatMessage('chat-session', 'request-1', 'Hello Codex');
  assert.deepStrictEqual(chatRequests, [{ requestId: 'request-1', input: 'Hello Codex', sessionId: 'chat-session' }]);

  const replayMessages = [];
  manager.replayAllOutputToClient((message) => replayMessages.push(message));
  assert(replayMessages.some((message) => message.type === 'agent_chat_update' && message.replay === true && message.message?.content === 'Replayed chat'));
  assert.strictEqual(broadcasts.some((message) => message.type === 'session_snapshot'), true);

  const claudeSession = createSession(manager, {
    sessionId: 'claude-chat-session',
    title: 'Claude Chat',
    agentType: 'claude',
    mode: 'chat',
  });
  assert.strictEqual(claudeSession.mode, 'chat');
  assert.strictEqual(claudeSession.pty, null);
  assert(claudeSession.chatRuntime);
  assert.strictEqual(manager.getSnapshot('claude-chat-session')?.statusMessage, 'Claude 内置聊天已启动');

  manager.sendChatMessage('claude-chat-session', 'request-2', 'Hello Claude');
  assert.deepStrictEqual(chatRequests.at(-1), { requestId: 'request-2', input: 'Hello Claude', sessionId: 'claude-chat-session' });
});

test('codex terminal mode keeps the local CLI PTY path', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const manager = createManager(runtimeDir, { useRealLaunch: true });
  const session = createSession(manager, {
    sessionId: 'codex-terminal',
    title: 'Codex Terminal',
    agentType: 'codex',
    mode: 'terminal',
  });

  assert.strictEqual(session.mode, 'terminal');
  assert.strictEqual(manager.getSnapshot('codex-terminal')?.mode, 'terminal');
  assert(session.pty);
  assert.strictEqual(session.chatRuntime, null);
});

test('switching between terminal and built-in views preserves an active local CLI PTY', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  let disposed = 0;
  const manager = createManager(runtimeDir, {
    createCodexChatRuntime: () => ({
      handleRequest: () => {},
      cancel: () => {},
      replay: () => {},
      dispose: () => { disposed += 1; },
    }),
  });
  const session = createSession(manager, {
    sessionId: 'codex-mode-switch',
    title: 'Codex Mode Switch',
    agentType: 'codex',
    mode: 'terminal',
  });
  const pty = {
    write: () => {},
    resize: () => {},
    kill: () => { killed += 1; },
  };
  let killed = 0;
  session.pty = pty;
  session.processState = 'running';

  manager.setSessionMode('codex-mode-switch', 'chat');
  assert.strictEqual(session.mode, 'chat');
  assert.strictEqual(session.pty, pty);
  assert(session.chatRuntime);
  assert.strictEqual(killed, 0);

  manager.setSessionMode('codex-mode-switch', 'terminal');
  assert.strictEqual(session.mode, 'terminal');
  assert.strictEqual(session.pty, pty);
  assert.strictEqual(disposed, 0);
  assert.strictEqual(killed, 0);

  manager.restartSession('codex-mode-switch', '/tmp/workspace', 'codex', startupOptions(), 'chat');
  assert.strictEqual(session.mode, 'chat');
  assert.strictEqual(session.pty, pty);
  assert.strictEqual(killed, 0);
});

test('binding a chat session updates snapshots without structured event messages', () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-session-history-'));
  const broadcasts = [];
  const manager = createManager(runtimeDir, {
    broadcast: (message) => broadcasts.push(message),
    useRealLaunch: true,
    createCodexChatRuntime: () => ({
      handleRequest: () => {},
      cancel: () => {},
      replay: () => {},
      dispose: () => {},
    }),
  });
  createSession(manager, { sessionId: 'session-events-4', title: 'Codex Chat', agentType: 'codex', mode: 'chat' });

  manager.bindSessionToTab('session-events-4', 84);

  const snapshot = broadcasts.find((message) => (
    message.type === 'session_snapshot'
    && message.sessions.some((entry) => entry.sessionId === 'session-events-4' && entry.binding.tabId === 84)
  ));
  assert(snapshot);
  assert.strictEqual(broadcasts.some((message) => message.type === 'agent_chat_update'), false);
});

test('codex chat runtime normalizes Responses streaming events', () => {
  const stream = [
    'data: {"type":"response.created","response":{"id":"resp_1"}}',
    '',
    'data: {"type":"response.output_text.delta","delta":"Hello"}',
    '',
    'data: {"type":"response.output_text.delta","delta":" world"}',
    '',
    'data: {"type":"response.reasoning_summary_text.delta","delta":"Checked context."}',
    '',
    'data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"ws_1","status":"completed","action":{"query":"ClaudeChrome"}}}',
    '',
    'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"browser__get_page_text","arguments":"{\\"max_chars\\":100}"}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  const parsed = codexChatRuntime.parseResponsesStreamForTest(stream);
  assert.strictEqual(parsed.id, 'resp_1');
  assert.strictEqual(parsed.output_text, 'Hello world');
  assert(parsed.output.some((item) => item.type === 'reasoning'));
  assert(parsed.output.some((item) => item.type === 'web_search_call'));
  assert(parsed.output.some((item) => item.type === 'function_call' && item.name === 'browser__get_page_text'));
});

test('codex chat runtime joins streamed function names and argument deltas', () => {
  const stream = [
    'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_2","call_id":"call_2","name":"browser__find_elements","arguments":""}}',
    '',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_2","call_id":"call_2","delta":"{\\"selector\\":"}',
    '',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_2","call_id":"call_2","delta":"\\"main\\"}"}',
    '',
    'data: {"type":"response.function_call_arguments.done","item_id":"fc_2","call_id":"call_2","arguments":"{\\"selector\\":\\"main\\"}"}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');

  const parsed = codexChatRuntime.parseResponsesStreamForTest(stream);
  const call = parsed.output.find((item) => item.type === 'function_call' && item.call_id === 'call_2');
  assert(call);
  assert.strictEqual(call.name, 'browser__find_elements');
  assert.strictEqual(call.arguments, '{"selector":"main"}');
});

test('built-in codex chat inherits API settings from local Codex config', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-local-config-'));
  const codexHome = path.join(tempRoot, '.codex');
  const projectDir = path.join(tempRoot, 'project');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model = "gpt-local-codex"',
    'model_provider = "relay_provider"',
    '',
    '[model_providers.relay_provider]',
    'base_url = "https://relay.example.com/codex"',
    'wire_api = "responses"',
    'env_key = "CUSTOM_CODEX_KEY"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'auth-json-key' }));

  withEnv({
    CODEX_HOME: codexHome,
    CUSTOM_CODEX_KEY: 'provider-env-key',
    CLAUDECHROME_OPENAI_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: undefined,
    OPENAI_MODEL: undefined,
    CLAUDECHROME_CODEX_MODEL: undefined,
  }, () => {
    const resolved = localAgentConfig.resolveCodexChatSettings({
      startupOptions: startupOptions(),
      cwd: projectDir,
    });

    assert.strictEqual(resolved.apiBaseUrl, 'https://relay.example.com/codex');
    assert.strictEqual(resolved.apiKey, 'provider-env-key');
    assert.strictEqual(resolved.model, 'gpt-local-codex');
    assert.strictEqual(resolved.sources.apiBaseUrl, path.join(codexHome, 'config.toml'));
    assert.strictEqual(resolved.sources.apiKey, 'CUSTOM_CODEX_KEY');
    assert.strictEqual(resolved.sources.model, path.join(codexHome, 'config.toml'));
  });
});

test('built-in codex chat panel fields override inherited local config', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-local-config-'));
  const codexHome = path.join(tempRoot, '.codex');
  const projectDir = path.join(tempRoot, 'project');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model = "gpt-local-codex"',
    'model_provider = "relay_provider"',
    '[model_providers.relay_provider]',
    'base_url = "https://relay.example.com/codex"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'auth-json-key' }));

  withEnv({ CODEX_HOME: codexHome }, () => {
    const resolved = localAgentConfig.resolveCodexChatSettings({
      startupOptions: startupOptions({
        apiBaseUrl: 'https://panel.example.com/v1/',
        apiKey: 'panel-key',
        model: 'panel-model',
      }),
      cwd: projectDir,
    });

    assert.strictEqual(resolved.apiBaseUrl, 'https://panel.example.com/v1');
    assert.strictEqual(resolved.apiKey, 'panel-key');
    assert.strictEqual(resolved.model, 'panel-model');
    assert.strictEqual(resolved.sources.apiBaseUrl, 'panel');
    assert.strictEqual(resolved.sources.apiKey, 'panel');
    assert.strictEqual(resolved.sources.model, 'panel');
  });
});

test('built-in codex chat inherits default openai provider overrides', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-local-config-'));
  const codexHome = path.join(tempRoot, '.codex');
  const projectDir = path.join(tempRoot, 'project');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    '[model_providers.openai]',
    'base_url = "https://openai-override.example.com/v1"',
    'env_key = "OPENAI_OVERRIDE_KEY"',
    '',
  ].join('\n'));

  withEnv({
    CODEX_HOME: codexHome,
    OPENAI_OVERRIDE_KEY: 'override-key',
    CLAUDECHROME_OPENAI_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: undefined,
  }, () => {
    const resolved = localAgentConfig.resolveCodexChatSettings({
      startupOptions: startupOptions(),
      cwd: projectDir,
    });

    assert.strictEqual(resolved.apiBaseUrl, 'https://openai-override.example.com/v1');
    assert.strictEqual(resolved.apiKey, 'override-key');
    assert.strictEqual(resolved.sources.apiBaseUrl, path.join(codexHome, 'config.toml'));
    assert.strictEqual(resolved.sources.apiKey, 'OPENAI_OVERRIDE_KEY');
  });
});

test('built-in codex chat inherits Codex and Claude instruction files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-local-config-'));
  const codexHome = path.join(tempRoot, '.codex');
  const claudeHome = path.join(tempRoot, '.claude');
  const projectDir = path.join(tempRoot, 'project', 'nested');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'AGENTS.md'), 'Global Codex rule');
  fs.writeFileSync(path.join(claudeHome, 'CLAUDE.md'), 'Global Claude memory');
  fs.writeFileSync(path.join(tempRoot, 'project', 'AGENTS.md'), 'Project Codex rule');
  fs.writeFileSync(path.join(projectDir, '.claude', 'CLAUDE.md'), 'Nested Claude memory');
  fs.writeFileSync(path.join(projectDir, '.claude', 'rules', 'ui.md'), 'Nested Claude UI rule');

  withEnv({ CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome }, () => {
    const result = localAgentConfig.buildLocalInstructionContext(projectDir);
    assert(result.text.includes('Global Codex rule'));
    assert(result.text.includes('Global Claude memory'));
    assert(result.text.includes('Project Codex rule'));
    assert(result.text.includes('Nested Claude memory'));
    assert(result.text.includes('Nested Claude UI rule'));
    assert(result.sources.includes(path.join(codexHome, 'AGENTS.md')));
    assert(result.sources.includes(path.join(claudeHome, 'CLAUDE.md')));
  });
});

test('built-in claude chat inherits model from local Claude settings', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-local-config-'));
  const claudeHome = path.join(tempRoot, '.claude');
  const projectDir = path.join(tempRoot, 'project');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({ model: 'claude-local-model' }));

  withEnv({
    CLAUDE_CONFIG_DIR: claudeHome,
    ANTHROPIC_API_KEY: 'anthropic-env-key',
    CLAUDECHROME_ANTHROPIC_API_KEY: undefined,
    CLAUDECHROME_ANTHROPIC_BASE_URL: undefined,
    CLAUDECHROME_CLAUDE_MODEL: undefined,
    ANTHROPIC_BASE_URL: undefined,
    ANTHROPIC_MODEL: undefined,
  }, () => {
    const resolved = localAgentConfig.resolveClaudeChatSettings({
      startupOptions: startupOptions(),
      cwd: projectDir,
    });
    assert.strictEqual(resolved.apiBaseUrl, 'https://api.anthropic.com/v1');
    assert.strictEqual(resolved.apiKey, 'anthropic-env-key');
    assert.strictEqual(resolved.model, 'claude-local-model');
    assert.strictEqual(resolved.sources.apiKey, 'ANTHROPIC_API_KEY');
    assert.strictEqual(resolved.sources.model, path.join(claudeHome, 'settings.json'));
  });
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
