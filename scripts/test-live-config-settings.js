#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocket } = require(path.resolve(__dirname, '../native-host/node_modules/ws'));

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT, 'dist');
const HOST_DIR = path.resolve(ROOT, 'native-host');
const HOST_ENTRY = path.resolve(HOST_DIR, 'dist/main.js');
const PROFILE_PREFS_RELATIVE = path.join('profile', 'Default', 'Preferences');
const TEST_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ClaudeChrome Config Test</title>
</head>
<body>
  <h1>ClaudeChrome Config Test</h1>
  <p>This tab exists so the side panel can bind a real browser tab.</p>
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

async function openTarget(debugPort, targetUrl) {
  return fetchJson(debugPort, `/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
}

function getExtensionIdFromProfile(preferencesPath) {
  const prefs = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
  const settings = prefs?.extensions?.settings || {};
  const ids = Object.keys(settings).filter((id) => {
    const entry = settings[id];
    return entry && entry.path && path.resolve(entry.path) === DIST_DIR;
  });
  if (ids.length !== 1) {
    throw makeError(`Expected exactly one extension id for ${DIST_DIR}, found ${ids.length}`);
  }
  return ids[0];
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.ws.off('open', onOpen);
        this.ws.off('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      this.ws.on('open', onOpen);
      this.ws.on('error', onError);
    });

    this.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(makeError(message.error.message || 'CDP command failed'));
      } else {
        pending.resolve(message.result || {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
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

async function cleanup(observerWs, panelClient, existingDir) {
  if (observerWs && observerWs.readyState === WebSocket.OPEN) {
    observerWs.close();
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
  if (existingDir) {
    fs.rmSync(existingDir, { recursive: true, force: true });
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
    throw makeError('native-host/dist/main.js is missing. Run npm run build:host first.');
  }
  if (!fs.existsSync(DIST_DIR)) {
    throw makeError('dist/ is missing. Run npm run build first.');
  }

  const report = [];
  const record = (name, detail) => {
    report.push({ name, detail });
    console.log(`PASS ${name}: ${detail}`);
  };

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-live-config-settings-'));
  TEMP_DIRS.push(runtimeDir);
  const profileDir = path.join(runtimeDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });
  const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-live-existing-dir-'));
  const missingDir = path.join(existingDir, 'missing-dir');
  const panelStateFile = path.join(runtimeDir, 'panel-state.local.json');

  const debugPort = await reservePort();
  const hostWsPort = await reservePort();
  const httpPort = await startHttpServer();
  const testUrl = `http://127.0.0.1:${httpPort}/test.html`;
  const preferencesPath = path.join(runtimeDir, PROFILE_PREFS_RELATIVE);
  const browserCommand = resolveBrowserCommand();
  const browserLaunch = resolveBrowserLaunch(browserCommand, profileDir, debugPort);

  let panelClient = null;
  let observerWs = null;
  let hostStderr = '';
  const observedOutputs = new Map();

  try {
    const hostProcess = spawnManaged('node', [HOST_ENTRY], {
      cwd: HOST_DIR,
      env: {
        ...process.env,
        CLAUDECHROME_WS_PORT: String(hostWsPort),
        CLAUDECHROME_RUNTIME_DIR: runtimeDir,
        CLAUDECHROME_PANEL_STATE_FILE: panelStateFile,
      },
    });
    hostProcess.stderr?.on('data', (chunk) => {
      hostStderr += chunk.toString();
    });
    hostProcess.stdout?.on('data', () => {});
    try {
      await waitForPort(hostWsPort, 'native host WebSocket port');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw makeError(hostStderr.trim() ? `${detail}\n${hostStderr.trim()}` : detail);
    }

    observerWs = new WebSocket(`ws://127.0.0.1:${hostWsPort}`);
    await new Promise((resolve, reject) => {
      observerWs.on('open', resolve);
      observerWs.on('error', reject);
    });
    observerWs.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'session_output') {
        const decoded = Buffer.from(message.data, 'base64').toString();
        observedOutputs.set(message.sessionId, (observedOutputs.get(message.sessionId) || '') + decoded);
      }
    });

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

    await panelClient.evaluate(`(() => {
      window.__ccSentMessages = [];
      window.__ccConfirmCalls = [];
      if (!window.__ccSendCaptureInstalled) {
        const originalSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function(data) {
          try {
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (parsed && parsed.type) {
                window.__ccSentMessages.push(parsed);
              }
            }
          } catch {
            // ignore non-JSON traffic
          }
          return originalSend.call(this, data);
        };
        window.__ccSendCaptureInstalled = true;
      }
      window.confirm = (message) => {
        window.__ccConfirmCalls.push(String(message));
        return false;
      };
      return true;
    })()`);

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

    await panelClient.evaluate(`window.__ccSentMessages = []; window.__ccConfirmCalls = []; document.getElementById('btn-launch-defaults')?.click();`);

    await panelClient.evaluate(`(() => {
      const input = document.getElementById('codex-working-dir');
      input.value = ${JSON.stringify(missingDir)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const missingState = await waitFor(async () => {
      const result = await panelClient.evaluate(`(() => {
        const input = document.getElementById('codex-working-dir');
        const save = document.getElementById('config-save');
        const hint = input?.parentElement?.querySelector('.config-hint');
        return {
          validationMessage: input?.validationMessage || '',
          ariaInvalid: input?.getAttribute('aria-invalid') || '',
          saveDisabled: Boolean(save?.disabled),
          hintText: hint?.textContent || '',
        };
      })()`);
      return result && result.validationMessage && result.saveDisabled ? result : null;
    }, 'missing-directory rejection', 15000, 150);
    if (!String(missingState.hintText).toLowerCase().includes('exist') && !String(missingState.hintText).includes('不存在')) {
      throw makeError(`Missing-directory validation did not explain the failure: ${JSON.stringify(missingState)}`);
    }
    if (!String(missingState.hintText).includes(missingDir)) {
      throw makeError(`Missing-directory validation did not include the checked path: ${JSON.stringify(missingState)}`);
    }
    record('missing directory rejection', JSON.stringify(missingState));

    await panelClient.evaluate(`(() => {
      const codexInput = document.getElementById('codex-working-dir');
      const shellInput = document.getElementById('shell-working-dir');
      codexInput.value = ${JSON.stringify(existingDir)};
      codexInput.dispatchEvent(new Event('input', { bubbles: true }));
      shellInput.value = ${JSON.stringify(existingDir)};
      shellInput.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const validState = await waitFor(async () => {
      const result = await panelClient.evaluate(`(() => {
        const input = document.getElementById('codex-working-dir');
        const save = document.getElementById('config-save');
        const hint = input?.parentElement?.querySelector('.config-hint');
        return {
          validationMessage: input?.validationMessage || '',
          ariaInvalid: input?.getAttribute('aria-invalid') || '',
          saveDisabled: Boolean(save?.disabled),
          hintText: hint?.textContent || '',
        };
      })()`);
      return result && !result.validationMessage && result.ariaInvalid === 'false' && result.saveDisabled === false ? result : null;
    }, 'existing-directory acceptance', 15000, 150);
    record('existing directory acceptance', JSON.stringify(validState));

    await panelClient.evaluate(`document.getElementById('config-save')?.click()`);
    await sleep(500);

    const postSaveState = await panelClient.evaluate(`({
      confirmCalls: window.__ccConfirmCalls,
      restartMessages: window.__ccSentMessages.filter((message) => message.type === 'session_restart'),
    })`);
    if ((postSaveState?.confirmCalls || []).length !== 0) {
      throw makeError(`Saving defaults unexpectedly triggered confirmation dialogs: ${JSON.stringify(postSaveState.confirmCalls)}`);
    }
    if ((postSaveState?.restartMessages || []).length !== 0) {
      throw makeError(`Saving defaults unexpectedly emitted session_restart messages: ${JSON.stringify(postSaveState.restartMessages)}`);
    }
    record('no auto restart on defaults save', 'no confirm dialog and no session_restart messages');

    const syncedFileState = await waitFor(() => {
      if (!fs.existsSync(panelStateFile)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(panelStateFile, 'utf8'));
      if (parsed?.launchDefaults?.codex?.workingDirectory !== existingDir || parsed?.shellWorkingDirectory !== existingDir) {
        return null;
      }
      return parsed;
    }, 'panel state file sync', 15000, 150);
    record('panel state file sync', JSON.stringify({
      codexWorkingDirectory: syncedFileState.launchDefaults.codex.workingDirectory,
      shellWorkingDirectory: syncedFileState.shellWorkingDirectory,
    }));

    await panelClient.evaluate(`document.getElementById('btn-add-codex-pane')?.click()`);
    const codexCreateMessage = await waitFor(async () => {
      const messages = await panelClient.evaluate(`window.__ccSentMessages.filter((message) => message.type === 'session_create' && message.agentType === 'codex')`);
      return Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
    }, 'codex session_create message', 15000, 150);

    if (codexCreateMessage?.startupOptions?.workingDirectory !== existingDir) {
      throw makeError(`Codex session_create did not carry the saved working directory: ${JSON.stringify(codexCreateMessage)}`);
    }
    record('codex session_create working directory', JSON.stringify({
      sessionId: codexCreateMessage.sessionId,
      workingDirectory: codexCreateMessage.startupOptions.workingDirectory,
    }));

    await waitFor(() => {
      const output = observedOutputs.get(codexCreateMessage.sessionId) || '';
      return output.includes(existingDir) ? output : null;
    }, 'codex launch diagnostics output', 15000, 150);
    record('codex launch diagnostics', existingDir);

    await panelClient.evaluate(`document.getElementById('btn-add-shell-pane')?.click()`);
    const shellCreateMessage = await waitFor(async () => {
      const messages = await panelClient.evaluate(`window.__ccSentMessages.filter((message) => message.type === 'session_create' && message.agentType === 'shell')`);
      return Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
    }, 'shell session_create message', 15000, 150);

    if (shellCreateMessage?.startupOptions?.workingDirectory !== existingDir) {
      throw makeError(`Shell session_create did not carry the saved working directory: ${JSON.stringify(shellCreateMessage)}`);
    }
    record('shell session_create working directory', JSON.stringify({
      sessionId: shellCreateMessage.sessionId,
      workingDirectory: shellCreateMessage.startupOptions.workingDirectory,
    }));

    observerWs.send(JSON.stringify({
      type: 'session_input',
      sessionId: shellCreateMessage.sessionId,
      data: Buffer.from([
        `printf '__CC_SHELL_PWD__%s__\\n' "$PWD"`,
        'exit',
        '',
      ].join('\n')).toString('base64'),
    }));
    await waitFor(() => {
      const output = observedOutputs.get(shellCreateMessage.sessionId) || '';
      return output.includes(`__CC_SHELL_PWD__${existingDir}__`) ? output : null;
    }, 'shell working directory output', 15000, 150);
    record('shell working directory output', existingDir);

    await panelClient.evaluate(`new Promise((resolve) => chrome.storage.local.remove(['panelStateV2'], resolve))`);
    await panelClient.send('Page.reload');
    await waitFor(async () => {
      const ready = await panelClient.evaluate(`document.readyState === 'complete' && !!document.getElementById('btn-launch-defaults') && !!document.getElementById('ws-port')`);
      return ready ? true : null;
    }, 'panel DOM ready after reload', 30000, 100);
    await panelClient.evaluate(`(() => {
      window.__ccSentMessages = [];
      window.__ccConfirmCalls = [];
      if (!window.__ccSendCaptureInstalled) {
        const originalSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function(data) {
          try {
            if (typeof data === 'string') {
              const parsed = JSON.parse(data);
              if (parsed && parsed.type) {
                window.__ccSentMessages.push(parsed);
              }
            }
          } catch {}
          return originalSend.call(this, data);
        };
        window.__ccSendCaptureInstalled = true;
      }
      window.confirm = (message) => {
        window.__ccConfirmCalls.push(String(message));
        return false;
      };
      return true;
    })()`);
    await waitFor(async () => {
      const restored = await panelClient.evaluate(`new Promise((resolve) => chrome.storage.local.get(['panelStateV2'], resolve))`);
      const state = restored?.panelStateV2;
      return state?.launchDefaults?.codex?.workingDirectory === existingDir
        && state?.shellWorkingDirectory === existingDir
        ? state
        : null;
    }, 'panel state restore from local file', 15000, 150);
    record('panel state restore from local file', JSON.stringify({
      codexWorkingDirectory: existingDir,
      shellWorkingDirectory: existingDir,
    }));

    console.log('\nSummary');
    report.forEach((entry) => {
      console.log(`- ${entry.name}: ${entry.detail}`);
    });
  } finally {
    await cleanup(observerWs, panelClient, existingDir);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
