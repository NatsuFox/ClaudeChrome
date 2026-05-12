#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHAT_STATE_SRC = path.resolve(ROOT, 'extension/side-panel/agent-chat-state.ts');
const CHAT_VIEW_SRC = path.resolve(ROOT, 'extension/side-panel/agent-chat-view.ts');
const TYPES_SRC = path.resolve(ROOT, 'extension/shared/types.ts');
const LEXICON_SRC = path.resolve(ROOT, 'extension/side-panel/lexicon.ts');
const LEXICON_JSON = path.resolve(ROOT, 'extension/side-panel/lexicon.json');
const OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-agent-chat-view');
const STATE_COMPILED = path.resolve(OUTDIR, 'side-panel/agent-chat-state.js');
const VIEW_COMPILED = path.resolve(OUTDIR, 'side-panel/agent-chat-view.js');
const LEXICON_OUT = path.resolve(OUTDIR, 'side-panel/lexicon.json');

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed += 1;
}

function fail(label, detail = '') {
  console.error(`  \x1b[31m✗\x1b[0m ${label}${detail ? ': ' + detail : ''}`);
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

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.rows = 0;
    this.value = '';
    this._textContent = '';
    this.placeholder = '';
    this.className = '';
    this.type = '';
    this.open = false;
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  get textContent() {
    return [this._textContent, ...this.children.map((child) => child.textContent)].join('');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type) || [];
    listeners.forEach((listener) => listener(event));
    return true;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const walk = (node) => {
      if (className && node.className.split(/\s+/).includes(className)) {
        matches.push(node);
      }
      node.children.forEach(walk);
    };
    walk(this);
    return matches;
  }

  focus() {
    global.document.activeElement = this;
  }
}

function installDom() {
  global.document = {
    activeElement: null,
    createElement: (tagName) => new FakeElement(tagName),
  };
  global.window = {
    setTimeout: () => 0,
  };
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}`,
    },
  });
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {},
      },
    },
  });
}

console.log('\n\x1b[1mClaudeChrome — Agent Chat View Tests\x1b[0m');
console.log('='.repeat(48));
console.log('\n[1] Compiling chat modules...');

fs.mkdirSync(OUTDIR, { recursive: true });
try {
  execSync(
    `npx tsc --module commonjs --moduleResolution node --target es2021 --lib es2021,dom --outDir "${OUTDIR}" --skipLibCheck --esModuleInterop --resolveJsonModule --allowSyntheticDefaultImports --strict false "${CHAT_STATE_SRC}" "${CHAT_VIEW_SRC}" "${TYPES_SRC}" "${LEXICON_SRC}"`,
    { cwd: ROOT, stdio: 'pipe' },
  );
  fs.mkdirSync(path.dirname(LEXICON_OUT), { recursive: true });
  fs.copyFileSync(LEXICON_JSON, LEXICON_OUT);
  pass('Chat modules compiled');
} catch (error) {
  fail('Chat module compilation failed', error.stdout?.toString() || error.message);
  process.exit(1);
}

installDom();
const { AgentChatBuffer } = require(STATE_COMPILED);
const { AgentChatView } = require(VIEW_COMPILED);

test('chat buffer resets and deduplicates messages by id', () => {
  const buffer = new AgentChatBuffer();
  buffer.apply({ type: 'agent_chat_update', sessionId: 's1', message: message({ id: 'old' }) });
  buffer.apply({ type: 'agent_chat_update', sessionId: 's1', reset: true, message: message({ id: 'new' }) });
  buffer.apply({ type: 'agent_chat_update', sessionId: 's1', message: message({ id: 'new', content: 'updated' }) });

  assert.strictEqual(buffer.size, 1);
  assert.strictEqual(buffer.getAll()[0].content, 'updated');
  assert.strictEqual(buffer.get('new').content, 'updated');
  buffer.remove('new');
  assert.strictEqual(buffer.size, 0);
});

test('chat view renders empty state, messages, reasoning, and tools', () => {
  const view = new AgentChatView('session-1', 'en');
  assert.strictEqual(view.root.querySelector('.agent-chat-empty').textContent, 'Send a message to built-in Codex');

  view.applyMessage({
    type: 'agent_chat_update',
    sessionId: 'session-1',
    message: message({
      id: 'assistant-1',
      role: 'assistant',
      content: 'Done',
      reasoning: 'Checked the page first.',
      tools: [{ id: 'tool-1', name: 'browser__get_page_text', status: 'completed', outputPreview: 'ok' }],
    }),
  });

  assert.strictEqual(view.root.querySelectorAll('.agent-chat-message').length, 1);
  assert(view.root.querySelector('.agent-chat-message-header').textContent.includes('Codex'));
  assert(view.root.querySelector('.agent-chat-reasoning'));
  assert(view.root.querySelector('.agent-chat-tool').textContent.includes('browser__get_page_text'));
  assert.strictEqual(view.root.querySelector('.agent-chat-tool').dataset.kind, 'browser_tool');
  assert(view.root.querySelector('.agent-chat-tool-block'));
});

test('chat view can relabel the same surface for Claude', () => {
  const view = new AgentChatView('session-claude', 'en', 'claude');
  assert.strictEqual(view.root.querySelector('.agent-chat-empty').textContent, 'Send a message to built-in Claude');

  view.applyMessage({
    type: 'agent_chat_update',
    sessionId: 'session-claude',
    message: message({ id: 'assistant-claude', role: 'assistant', content: 'Ready' }),
  });
  assert(view.root.querySelector('.agent-chat-message-header').textContent.includes('Claude'));

  view.setAgentType('codex');
  assert(view.root.querySelector('.agent-chat-message-header').textContent.includes('Codex'));
});

test('chat view uses DevTools-style expandable event rows', () => {
  const view = new AgentChatView('session-events', 'en');
  view.applyMessage({
    type: 'agent_chat_update',
    sessionId: 'session-events',
    message: message({
      id: 'assistant-events',
      role: 'assistant',
      status: 'streaming',
      content: '```ts\nconst ok = true;\n```',
      reasoning: 'Reviewing current browser state.',
      tools: [
        { id: 'tool-running', name: 'browser__session_context', status: 'running', input: {} },
      ],
    }),
  });

  assert(view.root.querySelector('.agent-chat-code-viewer'));
  const reasoning = view.root.querySelector('.agent-chat-reasoning');
  assert.strictEqual(reasoning.open, true);
  assert(view.root.querySelector('.agent-chat-output').textContent.includes('Output'));
  const reasoningEvent = view.root.querySelector('.agent-chat-reasoning');
  assert(reasoningEvent.textContent.includes('Reasoning'));
  assert(view.root.querySelector('.agent-chat-event-status').textContent.includes('Running'));
  assert.strictEqual(view.root.querySelector('.agent-chat-tool').dataset.status, 'running');
});

test('chat view renders web-search and tool inputs as card modules', () => {
  const view = new AgentChatView('session-1b', 'en');
  view.applyMessage({
    type: 'agent_chat_update',
    sessionId: 'session-1b',
    message: message({
      id: 'assistant-2',
      role: 'assistant',
      content: 'Searched.',
      tools: [{ id: 'tool-web', kind: 'web_search', name: 'web_search', status: 'completed', input: { query: 'ClaudeChrome' }, outputPreview: '2 sources' }],
    }),
  });

  const tool = view.root.querySelector('.agent-chat-tool');
  assert.strictEqual(tool.dataset.kind, 'web_search');
  assert(tool.textContent.includes('ClaudeChrome'));
  assert(tool.textContent.includes('2 sources'));
});

test('chat view mirrors local CLI output into the built-in transcript', () => {
  const view = new AgentChatView('session-terminal-sync', 'en');
  view.applyTerminalOutput('\u001b[36m[ClaudeChrome] Launching Codex\u001b[0m\r\n');
  view.applyTerminalOutput('Ready for input\n');

  assert.strictEqual(view.root.querySelectorAll('.agent-chat-system').length, 1);
  assert(view.root.querySelector('.agent-chat-system').textContent.includes('[ClaudeChrome] Launching Codex'));
  assert(view.root.querySelector('.agent-chat-system').textContent.includes('Ready for input'));

  view.applyTerminalOutput('After reset\n', { reset: true });
  assert(!view.root.querySelector('.agent-chat-system').textContent.includes('Ready for input'));
  assert(view.root.querySelector('.agent-chat-system').textContent.includes('After reset'));
});

test('chat view submits prompts and disables input while streaming', () => {
  const view = new AgentChatView('session-2', 'en');
  const sent = [];
  view.onSend((message) => sent.push(message));
  const input = view.root.querySelector('.agent-chat-input');
  input.value = 'Inspect this page';
  view.root.querySelector('.agent-chat-composer').dispatchEvent({
    type: 'submit',
    preventDefault: () => {},
  });

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, 'agent_chat_request');
  assert.strictEqual(sent[0].sessionId, 'session-2');
  assert.strictEqual(sent[0].input, 'Inspect this page');
  assert.strictEqual(input.disabled, true);

  view.applyMessage({
    type: 'agent_chat_update',
    sessionId: 'session-2',
    message: message({ id: sent[0].requestId, role: 'assistant', status: 'completed', content: 'Ready' }),
  });
  assert.strictEqual(input.disabled, false);
});

function message(overrides = {}) {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    createdAt: 1,
    status: 'completed',
    ...overrides,
  };
}

console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  process.exit(1);
}
