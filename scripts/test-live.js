#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT, requireHostDependency, resolveArtifactPaths } = require('./ci-utils.js');
const { WebSocket } = requireHostDependency('ws');
const { Client } = requireHostDependency('@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StdioClientTransport } = requireHostDependency('@modelcontextprotocol/sdk/dist/cjs/client/stdio.js');

const {
  extensionDir: DIST_DIR,
  hostDir: HOST_DIR,
  hostEntry: HOST_ENTRY,
  mcpBridgeEntry: MCP_BRIDGE_ENTRY,
} = resolveArtifactPaths();
const PROFILE_PREFS_RELATIVE = path.join('profile', 'Default', 'Preferences');
const TEST_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ClaudeChrome Live Test</title>
  <style>
    body { font-family: sans-serif; margin: 0; padding: 24px; min-height: 3200px; }
    .stack { display: flex; flex-direction: column; gap: 16px; max-width: 480px; }
    button { padding: 12px 16px; font-size: 16px; }
    #deep-anchor { margin-top: 1800px; padding: 24px; background: #eef6ff; border: 1px solid #aac7ee; }
  </style>
</head>
<body>
  <div class="stack">
    <h1>ClaudeChrome Live Test</h1>
    <button id="selector-button">Selector Click</button>
    <button id="coord-button">Coordinate Click</button>
    <div id="selector-status">selector-clicked:0</div>
    <div id="coord-status">coord-clicked:0</div>
  </div>
  <div id="deep-anchor">Deep Anchor</div>
  <script>
    localStorage.setItem('liveLocal', 'alpha');
    sessionStorage.setItem('liveSession', 'beta');
    document.cookie = 'livecookie=1; path=/';

    let selectorCount = 0;
    let coordCount = 0;
    document.getElementById('selector-button').addEventListener('click', () => {
      selectorCount += 1;
      document.getElementById('selector-status').textContent = 'selector-clicked:' + selectorCount;
      console.log('selector-click', selectorCount);
    });
    document.getElementById('coord-button').addEventListener('click', () => {
      coordCount += 1;
      document.getElementById('coord-status').textContent = 'coord-clicked:' + coordCount;
      console.log('coord-click', coordCount);
    });
  </script>
</body>
</html>
`;

const CHILDREN = [];
const TEMP_DIRS = [];
let httpServer = null;
let closedSession = false;

function makeError(message, details) {
  const error = new Error(message);
  if (details) {
    error.details = details;
  }
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, label, timeoutMs = 15000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? ` (${lastError.message})` : '';
  throw makeError(`Timed out waiting for ${label}${suffix}`);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) return reject(error);
        if (typeof port !== 'number') return reject(makeError('Failed to reserve a TCP port'));
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function pathExecutableExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutable(candidates) {
  const pathParts = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (pathExecutableExists(candidate)) return candidate;
      continue;
    }
    for (const dir of pathParts) {
      const full = path.join(dir, candidate);
      if (pathExecutableExists(full)) return full;
    }
  }
  return null;
}

function resolveBrowserCommand() {
  const override = process.env.CLAUDECHROME_LIVE_BROWSER;
  if (override) {
    return override;
  }

  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        'google-chrome',
        'chromium',
      ]
    : process.platform === 'win32'
      ? [
          'chrome.exe',
          'msedge.exe',
          'chromium.exe',
        ]
      : [
          'chromium',
          'chromium-browser',
          'google-chrome',
          'google-chrome-stable',
        ];

  const browser = findExecutable(candidates);
  if (!browser) {
    throw makeError('Could not find a Chromium or Chrome binary. Set CLAUDECHROME_LIVE_BROWSER to override.');
  }
  return browser;
}

function resolveBrowserLaunch(browserCommand, profileDir, debugPort) {
  const browserArgs = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--disable-background-networking',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${DIST_DIR}`,
    `--load-extension=${DIST_DIR}`,
    '--no-sandbox',
    'about:blank',
  ];

  const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  if (!needsXvfb) {
    return { command: browserCommand, args: browserArgs };
  }

  const xvfb = findExecutable(['xvfb-run']);
  if (!xvfb) {
    throw makeError('No DISPLAY is set and xvfb-run was not found. Install Xvfb or set DISPLAY.');
  }

  return {
    command: xvfb,
    args: ['-a', browserCommand, ...browserArgs],
  };
}

function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  CHILDREN.push(child);
  return child;
}

function collectOutput(child, label) {
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
    if (stdout.length > 20000) stdout = stdout.slice(-20000);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });
  return () => ({
    label,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  });
}

async function waitForPort(port, label, timeoutMs = 30000) {
  await waitFor(() => new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(null));
  }), label, timeoutMs, 250);
}

function startHttpServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if ((req.url || '/').startsWith('/test.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(TEST_PAGE_HTML);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(makeError('Failed to bind HTTP server'));
        return;
      }
      httpServer = server;
      resolve(address.port);
    });
    server.on('error', reject);
  });
}

async function fetchJson(debugPort, pathName, init) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${pathName}`, init);
  if (!response.ok) {
    throw makeError(`HTTP ${response.status} for ${pathName}`);
  }
  return response.json();
}

async function listTargets(debugPort) {
  return fetchJson(debugPort, '/json/list');
}

async function openTarget(debugPort, url) {
  const encoded = encodeURIComponent(url);
  for (const method of ['PUT', 'GET']) {
    try {
      return await fetchJson(debugPort, `/json/new?${encoded}`, { method });
    } catch {
      // Try the fallback method.
    }
  }
  throw makeError(`Failed to open target for ${url}`);
}

function getExtensionIdFromProfile(preferencesPath) {
  const prefs = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
  const settings = prefs.extensions?.settings || {};
  for (const [extensionId, config] of Object.entries(settings)) {
    if (config && config.path && path.resolve(config.path) === DIST_DIR) {
      return extensionId;
    }
  }
  throw makeError('Failed to locate the loaded ClaudeChrome extension ID in the Chromium profile');
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 0;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.on('open', resolve);
      ws.on('error', reject);
      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (typeof message.id === 'number' && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) {
            reject(makeError(message.error.message || JSON.stringify(message.error)));
          } else {
            resolve(message.result);
          }
        }
      });
      ws.on('close', () => {
        for (const pending of this.pending.values()) {
          pending.reject(makeError('CDP socket closed'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw makeError(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

function ipcRequest(storePort, payload) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port: storePort }, () => {
      client.end(`${JSON.stringify(payload)}\n`);
    });
    const chunks = [];
    client.on('data', (chunk) => chunks.push(chunk));
    client.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    client.on('error', reject);
  });
}

function ipcQuery(storePort, sessionId, tool, params = {}) {
  return ipcRequest(storePort, { sessionId, tool, params });
}

function ipcCommand(storePort, sessionId, command, params = {}, timeoutMs = 20000) {
  return ipcRequest(storePort, { kind: 'command', sessionId, command, params, timeoutMs });
}

async function createSession(hostWsPort, storePort, sessionId, tabId) {
  const ws = new WebSocket(`ws://127.0.0.1:${hostWsPort}`);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({
    type: 'session_create',
    sessionId,
    agentType: 'shell',
    title: 'Live Test Session',
    binding: { kind: 'tab', tabId },
    cols: 100,
    rows: 30,
  }));
  await waitFor(async () => {
    const status = await ipcQuery(storePort, sessionId, 'get_binding_status', {});
    const boundTabId = status?.binding?.tabId ?? status?.summary?.boundTabId;
    return status?.ok === true && boundTabId === tabId ? status : null;
  }, 'session binding', 30000, 250);
  return ws;
}

function unwrapCommand(name, response) {
  if (!response || response.ok !== true) {
    throw makeError(`${name} failed: ${JSON.stringify(response)}`);
  }
  return response.result;
}

function unwrapMcpTextResult(name, response) {
  const textBlock = response?.content?.find((entry) => entry.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string') {
    throw makeError(`${name} returned no text content: ${JSON.stringify(response)}`);
  }
  try {
    return JSON.parse(textBlock.text);
  } catch (error) {
    throw makeError(`${name} returned invalid JSON text`, { response, error: String(error) });
  }
}

async function createMcpClient(storePort, sessionId) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_BRIDGE_ENTRY],
    cwd: HOST_DIR,
    env: {
      ...process.env,
      CLAUDECHROME_STORE_PORT: String(storePort),
      CLAUDECHROME_SESSION_ID: sessionId,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'claudechrome-live-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

async function cleanup(sessionWs, panelClient, mcpTransport) {
  if (sessionWs && sessionWs.readyState === WebSocket.OPEN && !closedSession) {
    sessionWs.send(JSON.stringify({ type: 'session_close', sessionId: 'live-test-session' }));
    closedSession = true;
    await sleep(100);
    sessionWs.close();
  }
  if (panelClient) {
    panelClient.close();
  }
  if (mcpTransport) {
    await Promise.race([
      mcpTransport.close().catch(() => undefined),
      sleep(1000),
    ]);
  }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(() => resolve()));
    httpServer = null;
  }
  for (const child of CHILDREN.reverse()) {
    if (!child.killed && child.exitCode == null) {
      child.kill('SIGTERM');
    }
  }
  for (const child of CHILDREN.reverse()) {
    if (child.exitCode == null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode == null) child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

async function main() {
  if (!fs.existsSync(HOST_ENTRY)) {
    throw makeError(`Host entry is missing at ${HOST_ENTRY}. Run npm run build:host first or set CLAUDECHROME_HOST_ENTRY / CLAUDECHROME_HOST_DIR.`);
  }
  if (!fs.existsSync(MCP_BRIDGE_ENTRY)) {
    throw makeError(`MCP bridge entry is missing at ${MCP_BRIDGE_ENTRY}. Run npm run build:host first or set CLAUDECHROME_MCP_BRIDGE_ENTRY.`);
  }
  if (!fs.existsSync(DIST_DIR)) {
    throw makeError(`Extension directory is missing at ${DIST_DIR}. Run npm run build first or set CLAUDECHROME_EXTENSION_DIR.`);
  }

  const report = [];
  const record = (name, ok, detail) => {
    report.push({ name, ok, detail });
    const prefix = ok ? 'PASS' : 'FAIL';
    console.log(`${prefix} ${name}: ${detail}`);
  };

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-live-'));
  TEMP_DIRS.push(runtimeDir);
  const profileDir = path.join(runtimeDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const storePort = await reservePort();
  const preferencesPath = path.join(runtimeDir, PROFILE_PREFS_RELATIVE);
  const browserCommand = resolveBrowserCommand();
  const debugPort = await reservePort();
  const hostWsPort = await reservePort();
  const httpPort = await startHttpServer();
  const testUrl = `http://127.0.0.1:${httpPort}/test.html`;
  const sessionId = 'live-test-session';

  let panelClient = null;
  let sessionWs = null;
  let mcpTransport = null;
  let hostLogs = () => ({ label: 'host', stdout: '', stderr: '' });
  let browserLogs = () => ({ label: 'browser', stdout: '', stderr: '' });

  try {
    const hostProcess = spawnManaged('node', [HOST_ENTRY], {
      cwd: HOST_DIR,
      env: {
        ...process.env,
        CLAUDECHROME_WS_PORT: String(hostWsPort),
        CLAUDECHROME_RUNTIME_DIR: runtimeDir,
        CLAUDECHROME_STORE_PORT: String(storePort),
      },
    });
    hostLogs = collectOutput(hostProcess, 'host');
    await waitForPort(hostWsPort, 'native host WebSocket port');
    await waitForPort(storePort, 'native host IPC port');

    const browserLaunch = resolveBrowserLaunch(browserCommand, profileDir, debugPort);
    const browserProcess = spawnManaged(browserLaunch.command, browserLaunch.args, { cwd: ROOT, env: process.env });
    browserLogs = collectOutput(browserProcess, 'browser');
    await waitForPort(debugPort, 'Chromium DevTools port');
    await waitFor(async () => {
      const targets = await listTargets(debugPort);
      return Array.isArray(targets) ? targets : null;
    }, 'Chromium DevTools target list', 30000, 250);

    const extensionId = await waitFor(() => {
      try {
        return getExtensionIdFromProfile(preferencesPath);
      } catch {
        return null;
      }
    }, 'extension ID in Chromium profile', 30000, 250);
    record('extension load', true, `extensionId=${extensionId}`);

    const panelUrl = `chrome-extension://${extensionId}/side-panel/panel.html`;
    await openTarget(debugPort, panelUrl);
    const panelTarget = await waitFor(async () => {
      const targets = await listTargets(debugPort);
      return targets.find((target) => target.url === panelUrl) || null;
    }, 'panel page target', 30000, 250);

    panelClient = new CdpClient(panelTarget.webSocketDebuggerUrl);
    await panelClient.connect();
    await panelClient.send('Runtime.enable');
    await waitFor(async () => {
      const ready = await panelClient.evaluate(`document.readyState === 'complete' && !!document.getElementById('ws-port') && !!document.getElementById('btn-apply-port')`);
      return ready ? true : null;
    }, 'panel DOM ready', 30000, 100);

    const localizationCheck = await panelClient.evaluate(`(() => {
      const read = () => ({
        languageButton: document.getElementById('btn-language-toggle')?.textContent?.trim() || '',
        themeButton: document.getElementById('btn-theme-toggle')?.textContent?.trim() || '',
        themeTitle: document.getElementById('btn-theme-toggle')?.title || '',
        closeButton: document.getElementById('btn-toggle-panel')?.textContent?.trim() || '',
        addShellButton: document.getElementById('btn-add-shell-pane')?.textContent?.trim() || '',
        workspaceEdge: document.getElementById('workspace-rail-edge-toggle')?.textContent?.trim() || '',
        workspaceTitle: document.querySelector('.workspace-tab-title')?.textContent?.trim() || '',
        workspaceHint: document.querySelector('.workspace-tab-hint')?.textContent?.trim() || '',
      });
      const before = read();
      document.getElementById('btn-language-toggle')?.click();
      const after = read();
      return { before, after };
    })()`);
    if (
      localizationCheck?.before?.languageButton !== '中文' ||
      localizationCheck?.before?.themeButton !== '深色' ||
      localizationCheck?.before?.closeButton !== '关闭侧边栏' ||
      localizationCheck?.before?.addShellButton !== '+ 终端' ||
      localizationCheck?.before?.workspaceEdge !== '收起' ||
      localizationCheck?.before?.workspaceTitle !== '工作区 1' ||
      localizationCheck?.before?.workspaceHint !== '关联当前标签页' ||
      localizationCheck?.after?.languageButton !== 'English' ||
      localizationCheck?.after?.themeButton !== 'Dark' ||
      localizationCheck?.after?.themeTitle !== 'Current theme: Dark' ||
      localizationCheck?.after?.closeButton !== 'Close Sidebar' ||
      localizationCheck?.after?.addShellButton !== '+ Shell' ||
      localizationCheck?.after?.workspaceEdge !== 'Collapse' ||
      localizationCheck?.after?.workspaceTitle !== 'Workspace 1' ||
      localizationCheck?.after?.workspaceHint !== 'Focused browser tab binding'
    ) {
      throw makeError(`Language toggle localization mismatch: ${JSON.stringify(localizationCheck)}`);
    }
    record('panel localization toggle', true, JSON.stringify(localizationCheck));

    const configLocalizationCheck = await panelClient.evaluate(`(() => {
      const readConfig = () => ({
        title: document.getElementById('config-title')?.textContent?.trim() || '',
        defaultsTab: document.querySelector('.config-tab[data-tab="defaults"]')?.textContent?.trim() || '',
        debugTab: document.querySelector('.config-tab[data-tab="prompt-debug"]')?.textContent?.trim() || '',
        claudeHeading: document.querySelector('#claude-config-section h3')?.textContent?.trim() || '',
        workingDirLabel: document.querySelector('label[for="claude-working-dir"]')?.textContent?.trim() || '',
        promptModeLabel: document.querySelector('label[for="claude-prompt-mode"]')?.textContent?.trim() || '',
        resetLabel: document.getElementById('config-reset')?.textContent?.trim() || '',
        saveLabel: document.getElementById('config-save')?.textContent?.trim() || '',
        closeTitle: document.getElementById('config-close')?.getAttribute('title') || '',
      });
      document.getElementById('btn-launch-defaults')?.click();
      const english = readConfig();
      document.getElementById('btn-language-toggle')?.click();
      const chinese = readConfig();
      document.getElementById('config-close')?.click();
      document.getElementById('btn-language-toggle')?.click();
      return { english, chinese };
    })()`);
    if (
      configLocalizationCheck?.english?.title !== 'Default startup settings' ||
      configLocalizationCheck?.english?.defaultsTab !== 'Startup settings' ||
      configLocalizationCheck?.english?.debugTab !== 'Prompt injection debug' ||
      configLocalizationCheck?.english?.claudeHeading !== 'Claude default settings' ||
      configLocalizationCheck?.english?.workingDirLabel !== 'Working directory' ||
      configLocalizationCheck?.english?.promptModeLabel !== 'Browser context prompt mode' ||
      configLocalizationCheck?.english?.resetLabel !== 'Restore defaults' ||
      configLocalizationCheck?.english?.saveLabel !== 'Save default settings' ||
      configLocalizationCheck?.english?.closeTitle !== 'Close' ||
      configLocalizationCheck?.chinese?.title !== '默认启动设置' ||
      configLocalizationCheck?.chinese?.defaultsTab !== '启动设置' ||
      configLocalizationCheck?.chinese?.debugTab !== '提示注入调试' ||
      configLocalizationCheck?.chinese?.claudeHeading !== 'Claude 默认配置' ||
      configLocalizationCheck?.chinese?.workingDirLabel !== '工作目录' ||
      configLocalizationCheck?.chinese?.promptModeLabel !== '浏览器环境提示模式' ||
      configLocalizationCheck?.chinese?.resetLabel !== '恢复默认' ||
      configLocalizationCheck?.chinese?.saveLabel !== '保存默认设置' ||
      configLocalizationCheck?.chinese?.closeTitle !== '关闭'
    ) {
      throw makeError(`Config panel localization mismatch: ${JSON.stringify(configLocalizationCheck)}`);
    }
    record('config panel localization toggle', true, JSON.stringify(configLocalizationCheck));

    const panelConfig = await panelClient.evaluate(`(() => {
      const input = document.getElementById('ws-port');
      const button = document.getElementById('btn-apply-port');
      input.value = String(${hostWsPort});
      button.click();
      return {
        ok: true,
        value: input.value,
        status: document.getElementById('status-text')?.textContent || ''
      };
    })()`);
    record('panel configure', true, JSON.stringify(panelConfig));
    const connectedStatus = await waitFor(async () => {
      const panelStatus = await panelClient.evaluate(`({
        text: document.getElementById('status-text')?.textContent || '',
        state: document.getElementById('status-indicator')?.className || '',
        port: document.getElementById('ws-port')?.value || ''
      })`);
      return panelStatus && (panelStatus.state === 'connected' || String(panelStatus.text).includes('Connected to ClaudeChrome host')) ? panelStatus : null;
    }, 'panel WebSocket connection', 30000, 250);
    record('panel relay connection', true, `${connectedStatus.state} ${connectedStatus.text}`);

    await openTarget(debugPort, testUrl);
    const testTarget = await waitFor(async () => {
      const targets = await listTargets(debugPort);
      return targets.find((target) => target.url === testUrl) || null;
    }, 'test page target', 30000, 250);
    record('test page open', true, testTarget.url);

    const activeTab = await panelClient.evaluate(`new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'get_current_window_active_tab' }, resolve);
    })`);
    const boundTabId = activeTab?.tab?.tabId;
    if (typeof boundTabId !== 'number') {
      throw makeError(`Could not resolve active tab from panel: ${JSON.stringify(activeTab)}`);
    }
    record('active tab resolution', true, `tabId=${boundTabId}`);

    sessionWs = await createSession(hostWsPort, storePort, sessionId, boundTabId);
    record('session create', true, `sessionId=${sessionId}, tabId=${boundTabId}`);

    const caps = await ipcQuery(storePort, sessionId, 'get_capabilities', {});
    if (
      caps.ok !== true ||
      caps.families?.action?.available !== true ||
      caps.families?.cookies?.available !== true ||
      caps.families?.storage?.available !== true ||
      caps.families?.tabs?.available !== true
    ) {
      throw makeError(`Capabilities mismatch: ${JSON.stringify(caps)}`);
    }
    record('capabilities', true, 'action/cookies/storage/tabs families available');

    const listTabs = unwrapCommand('list_tabs(default)', await ipcCommand(storePort, sessionId, 'list_tabs', {}));
    const boundTabSummary = Array.isArray(listTabs.tabs)
      ? listTabs.tabs.find((tab) => tab.tabId === boundTabId)
      : null;
    if (listTabs.windowScope !== 'last_focused' || !boundTabSummary || boundTabSummary.url !== testUrl) {
      throw makeError(`Tab listing mismatch: ${JSON.stringify(listTabs)}`);
    }
    record('list_tabs command', true, `count=${listTabs.count}, boundTab=${boundTabSummary.tabId}`);

    const activeTabs = unwrapCommand(
      'list_tabs(active_only)',
      await ipcCommand(storePort, sessionId, 'list_tabs', { window_scope: 'all', active_only: true })
    );
    const activeBoundTab = Array.isArray(activeTabs.tabs)
      ? activeTabs.tabs.find((tab) => tab.tabId === boundTabId && tab.active === true)
      : null;
    if (activeTabs.activeOnly !== true || !activeBoundTab) {
      throw makeError(`Active tab listing mismatch: ${JSON.stringify(activeTabs)}`);
    }
    record('list_tabs active_only', true, `count=${activeTabs.count}, activeBoundTab=${activeBoundTab.tabId}`);

    const mcp = await createMcpClient(storePort, sessionId);
    mcpTransport = mcp.transport;
    const mcpTools = await mcp.client.listTools();
    if (!Array.isArray(mcpTools.tools) || !mcpTools.tools.some((tool) => tool.name === 'browser__list_tabs')) {
      throw makeError(`MCP tool list missing browser__list_tabs: ${JSON.stringify(mcpTools)}`);
    }
    record('mcp tool registration', true, 'browser__list_tabs is exposed over stdio MCP');

    const mcpListTabs = unwrapMcpTextResult(
      'browser__list_tabs MCP call',
      await mcp.client.callTool({
        name: 'browser__list_tabs',
        arguments: { window_scope: 'all', active_only: true },
      })
    );
    const mcpBoundTab = Array.isArray(mcpListTabs?.result?.tabs)
      ? mcpListTabs.result.tabs.find((tab) => tab.tabId === boundTabId && tab.active === true)
      : null;
    if (mcpListTabs?.ok !== true || !mcpBoundTab || mcpBoundTab.url !== testUrl) {
      throw makeError(`MCP list_tabs mismatch: ${JSON.stringify(mcpListTabs)}`);
    }
    record('mcp list_tabs live call', true, `activeBoundTab=${mcpBoundTab.tabId}`);

    const storage = unwrapCommand('get_storage', await ipcCommand(storePort, sessionId, 'get_storage', {
      storage_type: 'both',
      keys: ['liveLocal', 'liveSession'],
    }));
    if (storage.localStorage?.liveLocal !== 'alpha' || storage.sessionStorage?.liveSession !== 'beta') {
      throw makeError(`Storage tool mismatch: ${JSON.stringify(storage)}`);
    }
    record('get_storage', true, `local=${storage.localStorage.liveLocal}, session=${storage.sessionStorage.liveSession}`);

    const cookies = unwrapCommand('get_cookies', await ipcCommand(storePort, sessionId, 'get_cookies', {
      url: testUrl,
      name: 'livecookie',
    }));
    if (!Array.isArray(cookies.cookies) || !cookies.cookies.some((cookie) => cookie.name === 'livecookie')) {
      throw makeError(`Cookie tool mismatch: ${JSON.stringify(cookies)}`);
    }
    record('get_cookies', true, `cookies=${cookies.cookies.length}`);

    const clickSelector = unwrapCommand('click(selector)', await ipcCommand(storePort, sessionId, 'click', { selector: '#selector-button' }));
    if (clickSelector.clicked !== true) {
      throw makeError(`Selector click response was not successful: ${JSON.stringify(clickSelector)}`);
    }
    await waitFor(async () => {
      const page = await ipcQuery(storePort, sessionId, 'get_page_text', { max_chars: 5000 });
      return page.ok === true && page.text.includes('selector-clicked:1') ? page : null;
    }, 'selector click visible text', 30000, 250);
    record('click selector', true, 'selector-clicked:1');

    const coordButton = unwrapCommand('find_elements(coord button)', await ipcCommand(storePort, sessionId, 'find_elements', { selector: '#coord-button', limit: 1 }));
    const rect = coordButton.elements?.[0]?.rect;
    if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number' || typeof rect.width !== 'number' || typeof rect.height !== 'number') {
      throw makeError(`Missing coordinate button rect: ${JSON.stringify(coordButton)}`);
    }
    const centerX = Math.round(rect.x + rect.width / 2);
    const centerY = Math.round(rect.y + rect.height / 2);
    const clickCoords = unwrapCommand('click(coords)', await ipcCommand(storePort, sessionId, 'click', { x: centerX, y: centerY }));
    if (clickCoords.clicked !== true) {
      throw makeError(`Coordinate click response was not successful: ${JSON.stringify(clickCoords)}`);
    }
    await waitFor(async () => {
      const page = await ipcQuery(storePort, sessionId, 'get_page_text', { max_chars: 5000 });
      return page.ok === true && page.text.includes('coord-clicked:1') ? page : null;
    }, 'coordinate click visible text', 30000, 250);
    record('click coordinates', true, `coord button center=(${centerX}, ${centerY}) -> coord-clicked:1`);

    const initialAnchor = unwrapCommand('find_elements(initial anchor)', await ipcCommand(storePort, sessionId, 'find_elements', { selector: '#deep-anchor', limit: 1 }));
    const initialTop = initialAnchor.elements?.[0]?.rect?.top;
    if (typeof initialTop !== 'number') {
      throw makeError(`Initial anchor rect missing: ${JSON.stringify(initialAnchor)}`);
    }

    const scrollInstant = unwrapCommand('scroll instant', await ipcCommand(storePort, sessionId, 'scroll', { y: 900 }));
    if (scrollInstant.scrolled !== true) {
      throw makeError(`Instant scroll response was not successful: ${JSON.stringify(scrollInstant)}`);
    }
    const anchorAfterInstant = await waitFor(async () => {
      const result = unwrapCommand('find_elements(anchor after instant scroll)', await ipcCommand(storePort, sessionId, 'find_elements', { selector: '#deep-anchor', limit: 1 }));
      const top = result.elements?.[0]?.rect?.top;
      return typeof top === 'number' && top <= initialTop - 700 ? result : null;
    }, 'instant scroll anchor movement', 30000, 250);
    record('scroll coordinates instant', true, `anchorTop=${anchorAfterInstant.elements[0].rect.top}`);

    const scrollSmooth = unwrapCommand('scroll smooth', await ipcCommand(storePort, sessionId, 'scroll', { y: 1500, behavior: 'smooth' }));
    if (scrollSmooth.scrolled !== true) {
      throw makeError(`Smooth scroll response was not successful: ${JSON.stringify(scrollSmooth)}`);
    }
    const anchorAfterSmooth = await waitFor(async () => {
      const result = unwrapCommand('find_elements(anchor after smooth scroll)', await ipcCommand(storePort, sessionId, 'find_elements', { selector: '#deep-anchor', limit: 1 }));
      const top = result.elements?.[0]?.rect?.top;
      return typeof top === 'number' && top <= initialTop - 1300 ? result : null;
    }, 'smooth scroll anchor movement', 30000, 300);
    record('scroll coordinates smooth', true, `anchorTop=${anchorAfterSmooth.elements[0].rect.top}`);

    const scrollSelector = unwrapCommand('scroll selector', await ipcCommand(storePort, sessionId, 'scroll', { selector: '#deep-anchor' }));
    if (scrollSelector.scrolled !== true) {
      throw makeError(`Selector scroll response was not successful: ${JSON.stringify(scrollSelector)}`);
    }
    const anchorAfterSelector = await waitFor(async () => {
      const result = unwrapCommand('find_elements(anchor after selector scroll)', await ipcCommand(storePort, sessionId, 'find_elements', { selector: '#deep-anchor', limit: 1 }));
      const top = result.elements?.[0]?.rect?.top;
      return typeof top === 'number' && top <= 200 ? result : null;
    }, 'selector scroll anchor movement', 30000, 250);
    record('scroll selector', true, `anchorTop=${anchorAfterSelector.elements[0].rect.top}`);

    const consoleMessages = await waitFor(async () => {
      const logs = await ipcQuery(storePort, sessionId, 'get_console_logs', { limit: 20 });
      const messages = Array.isArray(logs) ? logs.map((entry) => entry.message || '') : [];
      const sawSelector = messages.some((message) => String(message).includes('selector-click'));
      const sawCoord = messages.some((message) => String(message).includes('coord-click'));
      return sawSelector && sawCoord ? messages : null;
    }, 'console capture', 30000, 250);
    record('console capture', true, JSON.stringify(consoleMessages.slice(0, 4)));

    console.log('\nLive summary');
    console.log(JSON.stringify({ ok: report.every((item) => item.ok), report }, null, 2));
  } catch (error) {
    const details = {
      host: hostLogs(),
      browser: browserLogs(),
    };
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FATAL ${message}`);
    console.error(JSON.stringify(details, null, 2));
    throw error;
  } finally {
    await cleanup(sessionWs, panelClient, mcpTransport);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });
