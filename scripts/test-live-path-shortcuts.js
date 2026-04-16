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

const {
  extensionDir: DIST_DIR,
  hostDir: HOST_DIR,
  hostEntry: HOST_ENTRY,
} = resolveArtifactPaths();
const PROFILE_PREFS_RELATIVE = path.join('profile', 'Default', 'Preferences');
const TEST_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ClaudeChrome Focused Live Test</title>
</head>
<body>
  <h1>Focused Live Test</h1>
  <p>This tab exists so the panel can bind a real active browser tab.</p>
</body>
</html>
`;

const CHILDREN = [];
const TEMP_DIRS = [];
let httpServer = null;

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
      // try next method
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

const CDP_MODIFIER_ALT = 1;
const CDP_MODIFIER_CTRL = 2;
const CDP_MODIFIER_META = 4;
const CDP_MODIFIER_SHIFT = 8;

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

async function createSession(hostWsPort, sessionId, tabId) {
  const ws = new WebSocket(`ws://127.0.0.1:${hostWsPort}`);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.send(JSON.stringify({
    type: 'session_create',
    sessionId,
    agentType: 'shell',
    title: 'Shortcut Live Session',
    binding: { kind: 'tab', tabId },
    cols: 100,
    rows: 30,
  }));
  return ws;
}

async function cleanup(sessionWs, panelClient) {
  if (sessionWs && sessionWs.readyState === WebSocket.OPEN) {
    try {
      sessionWs.send(JSON.stringify({ type: 'session_close', sessionId: 'live-path-shortcuts-session' }));
      await sleep(100);
    } catch {}
    sessionWs.close();
  }
  if (panelClient) {
    panelClient.close();
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
      // ignore temp cleanup failures
    }
  }
}

async function main() {
  if (!fs.existsSync(HOST_ENTRY)) {
    throw makeError(`Host entry is missing at ${HOST_ENTRY}. Run npm run build:host first or set CLAUDECHROME_HOST_ENTRY / CLAUDECHROME_HOST_DIR.`);
  }
  if (!fs.existsSync(DIST_DIR)) {
    throw makeError(`Extension directory is missing at ${DIST_DIR}. Run npm run build first or set CLAUDECHROME_EXTENSION_DIR.`);
  }

  const report = [];
  const record = (name, detail) => {
    report.push({ name, detail });
    console.log(`PASS ${name}: ${detail}`);
  };

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-live-path-shortcuts-'));
  TEMP_DIRS.push(runtimeDir);
  const profileDir = path.join(runtimeDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const debugPort = await reservePort();
  const hostWsPort = await reservePort();
  const httpPort = await startHttpServer();
  const testUrl = `http://127.0.0.1:${httpPort}/test.html`;
  const preferencesPath = path.join(runtimeDir, PROFILE_PREFS_RELATIVE);
  const browserCommand = resolveBrowserCommand();
  const browserLaunch = resolveBrowserLaunch(browserCommand, profileDir, debugPort);

  let panelClient = null;
  let sessionWs = null;

  try {
    const hostProcess = spawnManaged('node', [HOST_ENTRY], {
      cwd: HOST_DIR,
      env: {
        ...process.env,
        CLAUDECHROME_WS_PORT: String(hostWsPort),
        CLAUDECHROME_RUNTIME_DIR: runtimeDir,
      },
    });
    hostProcess.stderr?.on('data', () => {});
    hostProcess.stdout?.on('data', () => {});
    await waitForPort(hostWsPort, 'native host WebSocket port');

    const browserProcess = spawnManaged(browserLaunch.command, browserLaunch.args, { cwd: ROOT, env: process.env });
    browserProcess.stderr?.on('data', () => {});
    browserProcess.stdout?.on('data', () => {});
    await waitForPort(debugPort, 'Chromium DevTools port');
    await waitFor(async () => {
      const targets = await listTargets(debugPort);
      return Array.isArray(targets) ? targets : null;
    }, 'Chromium target list', 30000, 250);

    const extensionId = await waitFor(() => {
      try {
        return getExtensionIdFromProfile(preferencesPath);
      } catch {
        return null;
      }
    }, 'extension ID in Chromium profile', 30000, 250);
    record('extension load', `extensionId=${extensionId}`);

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
      const ready = await panelClient.evaluate(`document.readyState === 'complete' && !!document.getElementById('btn-launch-defaults') && !!document.getElementById('ws-port')`);
      return ready ? true : null;
    }, 'panel DOM ready', 30000, 100);

    const invalidPathState = await panelClient.evaluate(`(() => {
      document.getElementById('btn-launch-defaults')?.click();
      const input = document.getElementById('claude-working-dir');
      const save = document.getElementById('config-save');
      const hint = input?.parentElement?.querySelector('.config-hint');
      input.value = 'relative/path';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        validationMessage: input.validationMessage,
        ariaInvalid: input.getAttribute('aria-invalid'),
        saveDisabled: Boolean(save.disabled),
        hintText: hint?.textContent || '',
      };
    })()`);
    if (!invalidPathState?.validationMessage || invalidPathState.ariaInvalid !== 'true' || invalidPathState.saveDisabled !== true) {
      throw makeError(`Relative-path validation did not trigger correctly: ${JSON.stringify(invalidPathState)}`);
    }
    record('config working-directory rejection', JSON.stringify(invalidPathState));

    const tildePathState = await panelClient.evaluate(`(() => {
      const input = document.getElementById('claude-working-dir');
      const save = document.getElementById('config-save');
      const hint = input?.parentElement?.querySelector('.config-hint');
      input.value = '~/demo';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('config-close')?.click();
      return {
        validationMessage: input.validationMessage,
        ariaInvalid: input.getAttribute('aria-invalid'),
        saveDisabled: Boolean(save.disabled),
        hintText: hint?.textContent || '',
      };
    })()`);
    if (tildePathState?.validationMessage || tildePathState.ariaInvalid !== 'false' || tildePathState.saveDisabled !== false) {
      throw makeError(`Tilde-path validation did not clear correctly: ${JSON.stringify(tildePathState)}`);
    }
    record('config working-directory tilde acceptance', JSON.stringify(tildePathState));

    const panelConfig = await panelClient.evaluate(`(() => {
      const input = document.getElementById('ws-port');
      const button = document.getElementById('btn-apply-port');
      input.value = String(${hostWsPort});
      button.click();
      return { value: input.value };
    })()`);
    record('panel configure', JSON.stringify(panelConfig));

    await waitFor(async () => {
      const panelStatus = await panelClient.evaluate(`({
        text: document.getElementById('status-text')?.textContent || '',
        state: document.getElementById('status-indicator')?.className || ''
      })`);
      return panelStatus && (panelStatus.state === 'connected' || String(panelStatus.text).includes('Connected to ClaudeChrome host')) ? panelStatus : null;
    }, 'panel WebSocket connection', 30000, 250);
    record('panel relay connection', 'connected');

    await openTarget(debugPort, testUrl);
    await waitFor(async () => {
      const targets = await listTargets(debugPort);
      return targets.find((target) => target.url === testUrl) || null;
    }, 'test page target', 30000, 250);

    const activeTab = await panelClient.evaluate(`new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'get_current_window_active_tab' }, resolve);
    })`);
    const boundTabId = activeTab?.tab?.tabId;
    if (typeof boundTabId !== 'number') {
      throw makeError(`Could not resolve active tab from panel: ${JSON.stringify(activeTab)}`);
    }
    record('active tab resolution', `tabId=${boundTabId}`);

    await panelClient.evaluate(`(() => {
      window.__ccSentInputs = [];
      if (!window.__ccSendCaptureInstalled) {
        const originalSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function(data) {
          try {
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (parsed && parsed.type === 'session_input') {
                window.__ccSentInputs.push({ sessionId: parsed.sessionId, data: parsed.data });
              }
            }
          } catch {
            // ignore non-JSON traffic
          }
          return originalSend.call(this, data);
        };
        window.__ccSendCaptureInstalled = true;
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: async () => 'CLIPBOARD-LIVE'
        }
      });
      return true;
    })()`);

    sessionWs = await createSession(hostWsPort, 'live-path-shortcuts-session', boundTabId);
    record('session create', `sessionId=live-path-shortcuts-session, tabId=${boundTabId}`);

    await waitFor(async () => {
      const ready = await panelClient.evaluate(`!!document.querySelector('.xterm-helper-textarea')`);
      return ready ? true : null;
    }, 'xterm helper textarea', 30000, 250);
    record('terminal render', 'xterm helper textarea present');

    async function dispatchShortcut(eventInit, expectedText, label) {
      await panelClient.evaluate(`window.__ccSentInputs = []`);
      const focusTarget = await panelClient.evaluate(`(() => {
        const textarea = document.querySelector('.xterm-helper-textarea');
        const root = document.querySelector('.pane-terminal');
        if (!textarea || !root) {
          throw new Error('Missing terminal focus target');
        }
        window.__ccLastTerminalKeydown = null;
        textarea.addEventListener('keydown', (event) => {
          window.__ccLastTerminalKeydown = {
            key: event.key,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
          };
        }, { once: true });
        textarea.focus();
        const rect = root.getBoundingClientRect();
        return {
          x: Math.round(rect.left + Math.min(rect.width / 2, 24)),
          y: Math.round(rect.top + Math.min(rect.height / 2, 24)),
        };
      })()`);

      await panelClient.send('Page.bringToFront');
      await panelClient.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: focusTarget.x,
        y: focusTarget.y,
        button: 'left',
        clickCount: 1,
      });
      await panelClient.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: focusTarget.x,
        y: focusTarget.y,
        button: 'left',
        clickCount: 1,
      });

      const modifiers = (eventInit.altKey ? CDP_MODIFIER_ALT : 0)
        | (eventInit.ctrlKey ? CDP_MODIFIER_CTRL : 0)
        | (eventInit.metaKey ? CDP_MODIFIER_META : 0)
        | (eventInit.shiftKey ? CDP_MODIFIER_SHIFT : 0);
      const keyCode = eventInit.key.length === 1 ? eventInit.key.toUpperCase().charCodeAt(0) : (
        eventInit.key === 'Enter' ? 13 :
        eventInit.key === 'Backspace' ? 8 :
        eventInit.key === 'Delete' ? 46 :
        eventInit.key === 'Insert' ? 45 : 0
      );
      const code = eventInit.code || (
        eventInit.key.length === 1 ? `Key${eventInit.key.toUpperCase()}` : eventInit.key
      );

      await panelClient.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: eventInit.key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers,
      });
      await panelClient.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: eventInit.key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers,
      });

      let captured;
      try {
        captured = await waitFor(async () => {
          const inputs = await panelClient.evaluate(`window.__ccSentInputs.filter((entry) => entry.sessionId === 'live-path-shortcuts-session')`);
          return Array.isArray(inputs) && inputs.length > 0 ? inputs : null;
        }, `${label} outbound session_input`, 10000, 100);
      } catch (error) {
        const keydownSeen = await panelClient.evaluate(`window.__ccLastTerminalKeydown`);
        const activeElement = await panelClient.evaluate(`document.activeElement?.className || document.activeElement?.tagName || null`);
        throw makeError(`${label} produced no outbound session_input`, {
          originalError: error instanceof Error ? error.message : String(error),
          keydownSeen,
          activeElement,
        });
      }

      const decoded = Buffer.from(captured[captured.length - 1].data, 'base64').toString('utf8');
      if (decoded !== expectedText) {
        const keydownSeen = await panelClient.evaluate(`window.__ccLastTerminalKeydown`);
        throw makeError(`${label} emitted unexpected text`, { expectedText, decoded, captured, keydownSeen });
      }
      record(label, JSON.stringify({ decoded }));
    }

    await dispatchShortcut({ key: 'Enter', shiftKey: true }, '\u001b[27;2;13~', 'shortcut Shift+Enter');
    await dispatchShortcut({ key: 'Backspace', ctrlKey: true }, '\u0017', 'shortcut Ctrl+Backspace');
    await dispatchShortcut({ key: 'Delete', ctrlKey: true }, '\u001bd', 'shortcut Ctrl+Delete');
    await dispatchShortcut({ key: 'u', ctrlKey: true }, '\u0015', 'shortcut Ctrl+U');
    await dispatchShortcut({ key: 'Insert', shiftKey: true }, 'CLIPBOARD-LIVE', 'shortcut Shift+Insert paste');

    console.log('\nFocused live smoke summary:');
    for (const entry of report) {
      console.log(`- ${entry.name}: ${entry.detail}`);
    }
  } finally {
    await cleanup(sessionWs, panelClient);
  }
}

main().catch((error) => {
  const details = error?.details ? `\nDetails: ${JSON.stringify(error.details)}` : '';
  console.error(`FAIL ${error.message}${details}`);
  process.exitCode = 1;
});
