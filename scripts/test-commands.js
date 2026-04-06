#!/usr/bin/env node
// Integration test for the bidirectional browser command protocol.
// Spawns the native host, connects a mock WS client (simulating the panel+extension),
// registers a session, then drives the browser commands through the IPC socket.
'use strict';

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { WebSocket } = require(path.resolve(__dirname, '../native-host/node_modules/ws'));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ROOT        = path.resolve(__dirname, '..');
const HOST_SCRIPT = path.resolve(ROOT, 'native-host/dist/main.js');
let STORE_PORT    = 0;
let WS_PORT       = 0;
const SESSION_ID  = 'test-session-001';
const TAB_ID      = 42;
const TIMEOUT_MS  = 10_000;

// ---------------------------------------------------------------------------
// Mock browser responses for each command
// ---------------------------------------------------------------------------
const MOCK_RESULTS = {
  screenshot:       { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', format: 'png' },
  navigate:         { url: 'https://example.com', status: 'complete' },
  reload:           { status: 'complete' },
  activate_tab:     { tab: { tabId: 43, windowId: 1, title: 'Example Secondary', url: 'https://example.org', active: true, pinned: false, audible: false, discarded: false, status: 'complete' } },
  list_tabs:        { windowScope: 'last_focused', activeOnly: false, count: 2, tabs: [{ tabId: 42, windowId: 1, title: 'Example', url: 'https://example.com', active: true, pinned: false, audible: false, discarded: false, status: 'complete' }] },
  get_page_content: { url: 'https://example.com', title: 'Example Domain', text: 'Example Domain\nThis domain is for use in illustrative examples.' },
  find_elements:    { elements: [{ tag: 'h1', id: '', text: 'Example Domain', rect: { x: 0, y: 0, width: 800, height: 40 } }] },
  evaluate_js:      { result: 2 },
  click:            { clicked: true },
  type:             { typed: true },
  scroll:           { scrolled: true },
  wait_for:         { satisfied: true, elapsed: 50 },
  get_cookies:      { cookies: [{ name: 'session', value: 'abc123', domain: 'example.com' }] },
  get_storage:      { localStorage: { theme: 'dark', userId: '42' }, sessionStorage: { draft: 'hello' } },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const results = [];

function pass(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed++;
  results.push({ ok: true, label });
}

function fail(label, detail = '') {
  console.error(`  \x1b[31m✗\x1b[0m ${label}${detail ? ': ' + detail : ''}`);
  failed++;
  results.push({ ok: false, label, detail });
}

function assert(cond, label, detail = '') {
  cond ? pass(label) : fail(label, detail);
}

function ipcQuery(payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { c.destroy(); reject(new Error(`IPC timeout for ${JSON.stringify(payload)}`)); }, TIMEOUT_MS);
    const c = net.createConnection({ host: '127.0.0.1', port: STORE_PORT }, () => c.end(JSON.stringify(payload) + '\n'));
    let buf = '';
    c.on('data', (d) => { buf += d; });
    c.on('end', () => { clearTimeout(t); try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    c.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) return reject(error);
        if (typeof port !== 'number') return reject(new Error('Failed to reserve a TCP port'));
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function waitForPort(port, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for: ${label}`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n\x1b[1mClaudeChrome — Browser Command Protocol Integration Test\x1b[0m');
  console.log('='.repeat(56));

  // --- Step 1: Start the native host
  console.log('\n[1] Starting native host...');
  STORE_PORT = await reservePort();
  WS_PORT = await reservePort();
  const host = spawn('node', [HOST_SCRIPT], {
    env: {
      ...process.env,
      CLAUDECHROME_WS_PORT: String(WS_PORT),
      CLAUDECHROME_STORE_PORT: String(STORE_PORT),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  host.on('error', (e) => { console.error('Host spawn error:', e.message); process.exit(1); });

  await waitForPort(WS_PORT, 'native host WebSocket port');
  await waitForPort(STORE_PORT, 'native host IPC port');
  pass('Native host WebSocket and IPC ports are listening');

  // --- Step 2: Connect mock WS client (simulates panel + extension)
  console.log('\n[2] Connecting mock WebSocket client...');
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

  // Track incoming messages and auto-respond to browser_command
  const wsMessages = [];
  let wsReady = false;

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); wsReady = true; resolve(); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  pass('Mock WebSocket client connected');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    wsMessages.push(msg);

    // Auto-respond to browser_command with canned mock result
    if (msg.type === 'browser_command') {
      const mockResult = MOCK_RESULTS[msg.command];
      ws.send(JSON.stringify({
        type: 'browser_command_result',
        id: msg.id,
        result: mockResult ?? { ok: true },
      }));
    }
  });

  // --- Step 3: Register a session with a tab binding via WS
  console.log('\n[3] Registering session with tab binding...');
  ws.send(JSON.stringify({
    type: 'session_create',
    sessionId: SESSION_ID,
    agentType: 'claude',
    title: 'Test Session',
    binding: { kind: 'tab', tabId: TAB_ID },
    cols: 80, rows: 24,
  }));

  // Wait briefly for session to be registered
  await new Promise((r) => setTimeout(r, 300));

  // Verify session binding via IPC query
  const bindStatus = await ipcQuery({ sessionId: SESSION_ID, tool: 'get_binding_status', params: {} });
  assert(bindStatus.ok === true, 'Session registered and binding status query succeeds');
  assert(bindStatus.binding?.tabId === TAB_ID || bindStatus.summary?.boundTabId === TAB_ID,
    `Session bound to tabId ${TAB_ID}`);

  // --- Step 4: Test browser commands via IPC
  console.log('\n[4] Testing browser command coverage...');

  const commands = [
    { name: 'screenshot',       params: { format: 'png' } },
    { name: 'navigate',         params: { url: 'https://example.com' } },
    { name: 'reload',           params: {} },
    { name: 'list_tabs',        params: {} },
    { name: 'activate_tab',     params: { tab_id: 43 } },
    { name: 'get_page_content', params: { include_html: false, tab_id: 43 } },
    { name: 'find_elements',    params: { selector: 'h1' } },
    { name: 'evaluate_js',      params: { expression: '1 + 1' } },
    { name: 'click',            params: { selector: '#btn' } },
    { name: 'type',             params: { selector: 'input', text: 'hello' } },
    { name: 'scroll',           params: { y: 300 } },
    { name: 'wait_for',         params: { condition: 'load' } },
    { name: 'get_cookies',      params: {} },
    { name: 'get_storage',      params: { storage_type: 'both' } },
  ];

  for (const { name, params } of commands) {
    try {
      const res = await ipcQuery({ kind: 'command', sessionId: SESSION_ID, command: name, params });
      assert(res.ok === true, `${name}: IPC round-trip succeeds`);
      const mock = MOCK_RESULTS[name];
      const resultStr = JSON.stringify(res.result);
      const firstKey = Object.keys(mock)[0];
      assert(
        resultStr.includes(JSON.stringify(Object.values(mock)[0]).slice(0, 20)),
        `${name}: result contains expected mock data (${firstKey}=${JSON.stringify(mock[firstKey]).slice(0, 30)})`,
      );
      if (params.tab_id) {
        assert(res.result?.resolved_tab_id === params.tab_id, `${name}: resolved_tab_id echoes explicit override`);
      } else if (name !== 'list_tabs') {
        assert(res.result?.resolved_tab_id === TAB_ID, `${name}: resolved_tab_id defaults to session tab`);
      }
    } catch (e) {
      fail(`${name}: IPC round-trip`, e.message);
    }
  }

  // --- Step 5: Verify WS mock received every browser_command message
  console.log('\n[5] Verifying WS message integrity...');
  const cmdMessages = wsMessages.filter((m) => m.type === 'browser_command');
  assert(cmdMessages.length === commands.length, `WS client received every browser_command message (got ${cmdMessages.length}/${commands.length})`);

  const commandNames = cmdMessages.map((m) => m.command);
  for (const { name } of commands) {
    assert(commandNames.includes(name), `browser_command '${name}' seen on WS`);
  }

  // All correlation IDs are unique
  const ids = cmdMessages.map((m) => m.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === commands.length, `All correlation IDs are unique (${uniqueIds.size}/${commands.length})`);

  const activateTabMessage = cmdMessages.find((m) => m.command === 'activate_tab');
  assert(activateTabMessage?.tabId === 43, 'activate_tab command uses explicit tab_id override');

  const pageContentMessage = cmdMessages.find((m) => m.command === 'get_page_content');
  assert(pageContentMessage?.tabId === 43, 'get_page_content command uses explicit tab_id override');

  const defaultTabMessages = cmdMessages.filter((m) => !['activate_tab', 'get_page_content'].includes(m.command));
  const allCorrectDefaultTabs = defaultTabMessages.every((m) => m.tabId === TAB_ID);
  assert(allCorrectDefaultTabs, `Default browser_command messages carry session tabId=${TAB_ID}`);

  // --- Step 6: Test unknown session error path
  console.log('\n[6] Error path: unknown session...');
  const errRes = await ipcQuery({ kind: 'command', sessionId: 'no-such-session', command: 'evaluate_js', params: { expression: '1' } });
  assert(errRes.ok === false, 'Unknown session returns a structured error response');
  assert(errRes.error?.code === 'unknown_session', 'Unknown session error code is unknown_session');
  assert(String(errRes.error?.message || '').includes('no-such-session'), `Error message names the missing session ("${errRes.error?.message}")`);

  // --- Step 7: Existing query tools still work
  console.log('\n[7] Existing IPC query tools still work...');
  const caps = await ipcQuery({ sessionId: SESSION_ID, tool: 'get_capabilities', params: {} });
  assert(caps.ok === true, 'get_capabilities query succeeds');
  assert(Array.isArray(caps.implementedTools), 'get_capabilities returns implementedTools');
  assert(caps.implementedTools.includes('browser__click'), 'get_capabilities includes browser__click');
  assert(caps.implementedTools.includes('browser__get_cookies'), 'get_capabilities includes browser__get_cookies');
  assert(caps.implementedTools.includes('browser__list_tabs'), 'get_capabilities includes browser__list_tabs');
  assert(caps.implementedTools.includes('browser__activate_tab'), 'get_capabilities includes browser__activate_tab');
  assert(caps.implementedTools.includes('browser__bind_tab'), 'get_capabilities includes browser__bind_tab');
  assert(caps.implementedTools.includes('browser__session_context'), 'get_capabilities includes browser__session_context');
  assert(caps.mode === 'browser_attached', 'get_capabilities reports browser_attached mode');
  assert(caps.targeting?.model === 'session_default_tab_with_per_call_override', 'get_capabilities reports session_default_tab_with_per_call_override targeting');
  assert(caps.families?.action?.available === true, 'get_capabilities marks action family available');
  assert(caps.families?.tabs?.available === true, 'get_capabilities marks tabs family available');
  assert(caps.families?.cookies?.available === true, 'get_capabilities marks cookies family available');
  assert(caps.families?.storage?.available === true, 'get_capabilities marks storage family available');

  const sessionContext = await ipcQuery({ sessionId: SESSION_ID, tool: 'get_session_context', params: {} });
  assert(sessionContext.ok === true, 'get_session_context query succeeds');
  assert(sessionContext.mode === 'browser_attached', 'get_session_context reports browser_attached mode');
  assert(sessionContext.targeting?.model === 'session_default_tab_with_per_call_override', 'get_session_context reports session_default_tab_with_per_call_override targeting');
  assert(sessionContext.currentTarget?.tabId === TAB_ID, `get_session_context resolves current target tabId=${TAB_ID}`);
  assert(sessionContext.controls?.bindTabTool === 'browser__bind_tab', 'get_session_context exposes bind tab control');

  const rebound = await ipcQuery({ sessionId: SESSION_ID, tool: 'bind_tab', params: { tab_id: 43 } });
  assert(rebound.ok === true, 'bind_tab query succeeds');
  assert(rebound.resolved_tab_id === 43, 'bind_tab reports resolved_tab_id=43');
  assert(rebound.binding?.tabId === 43, 'bind_tab updates the session binding');

  const reboundStatus = await ipcQuery({ sessionId: SESSION_ID, tool: 'get_binding_status', params: {} });
  assert(reboundStatus.binding?.tabId === 43, 'get_binding_status reflects rebound session tab');

  const stats = await ipcQuery({ sessionId: SESSION_ID, tool: 'get_capture_stats', params: { tab_id: 43 } });
  assert(stats.ok === true, 'get_capture_stats query succeeds');
  assert(stats.resolved_tab_id === 43, 'get_capture_stats reports resolved_tab_id for explicit tab override');

  // --- Summary
  console.log('\n' + '='.repeat(56));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('='.repeat(56) + '\n');

  ws.close();
  host.kill('SIGTERM');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\nFatal test error:', e.message);
  process.exit(1);
});
