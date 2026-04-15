#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn } = require('node:child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { WebSocket } = require(path.resolve(__dirname, '../native-host/node_modules/ws'));

const ROOT = path.resolve(__dirname, '..');
const HOST_DIR = path.resolve(ROOT, 'native-host');
const HOST_MAIN = path.resolve(HOST_DIR, 'dist/main.js');
const SESSION_ID = 'exit-cleanup-session';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS ${label}`);
  passed += 1;
}

function fail(label, detail = '') {
  console.error(`  FAIL ${label}${detail ? ': ' + detail : ''}`);
  failed += 1;
}

function record(label, fn) {
  try {
    fn();
    pass(label);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, label, timeoutMs = 10000, intervalMs = 100) {
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
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
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

async function waitForPort(port, label, timeoutMs = 10000) {
  await waitFor(() => new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  }), label, timeoutMs, 100);
}

function processExists(pid) {
  if (typeof pid !== 'number' || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function connectWs(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function stopHost(hostProcess) {
  if (!hostProcess || hostProcess.exitCode != null) {
    return;
  }

  hostProcess.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (hostProcess.exitCode == null) {
        hostProcess.kill('SIGKILL');
      }
      resolve();
    }, 4000);
    hostProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function forceKillProcessGroup(pid) {
  if (!processExists(pid) || process.platform === 'win32') {
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore cleanup races in the test harness.
    }
  }
}

async function main() {
  console.log('\nClaudeChrome - Exit Cleanup Integration Test');
  console.log('='.repeat(48));

  if (process.platform === 'win32') {
    console.log('\n[skip] Exit cleanup process-tree test is Unix-only in this environment.');
    process.exit(0);
  }

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-exit-cleanup-'));
  const wsPort = await reservePort();
  let hostProcess = null;
  let ws = null;
  let ws2 = null;
  let stderr = '';
  let output = '';
  let leaderPid = null;
  let childPid = null;

  try {
    console.log('\n[1] Starting native host...');
    hostProcess = spawn('node', [HOST_MAIN], {
      cwd: HOST_DIR,
      env: {
        ...process.env,
        CLAUDECHROME_WS_PORT: String(wsPort),
        CLAUDECHROME_RUNTIME_DIR: runtimeDir,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    hostProcess.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    await waitForPort(wsPort, 'native host WebSocket port');
    pass('Native host WebSocket port is listening');

    console.log('\n[2] Creating shell session with foreground and detached children...');
    ws = await connectWs(wsPort);
    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'session_output' && message.sessionId === SESSION_ID) {
        output += Buffer.from(message.data, 'base64').toString('utf8');
      }
    });

    ws.send(JSON.stringify({
      type: 'session_create',
      sessionId: SESSION_ID,
      agentType: 'shell',
      title: 'Exit Cleanup Shell',
      binding: { kind: 'tab', tabId: 1 },
      cols: 100,
      rows: 30,
      startupOptions: {
        launchArgs: '',
        workingDirectory: ROOT,
        systemPromptMode: 'default',
        customSystemPrompt: '',
      },
    }));

    ws.send(JSON.stringify({
      type: 'session_input',
      sessionId: SESSION_ID,
      data: Buffer.from("printf 'LEADER:%s\\n' \"$BASHPID\"; nohup sleep 1000 >/dev/null 2>&1 & printf 'CHILD:%s\\n' \"$!\"; exec sleep 1000\n").toString('base64'),
    }));

    leaderPid = await waitFor(() => {
      const match = output.match(/LEADER:(\d+)/);
      return match ? Number(match[1]) : null;
    }, 'shell leader pid');
    childPid = await waitFor(() => {
      const match = output.match(/CHILD:(\d+)/);
      return match ? Number(match[1]) : null;
    }, 'detached child pid');

    record(`Shell leader ${leaderPid} is running before disconnect`, () => assert.strictEqual(processExists(leaderPid), true));
    record(`Detached child ${childPid} is running before disconnect`, () => assert.strictEqual(processExists(childPid), true));

    console.log('\n[3] Simulating abrupt final panel disconnect...');
    ws.terminate();
    ws = null;

    await waitFor(() => !processExists(leaderPid), 'shell leader cleanup after last client disconnect', 9000);
    await waitFor(() => !processExists(childPid), 'detached child cleanup after last client disconnect', 9000);

    record(`Shell leader ${leaderPid} exits after last client disconnect`, () => assert.strictEqual(processExists(leaderPid), false));
    record(`Detached child ${childPid} exits after last client disconnect`, () => assert.strictEqual(processExists(childPid), false));

    console.log('\n[4] Reconnecting to confirm host has no live sessions...');
    let latestSnapshot = null;
    ws2 = await connectWs(wsPort);
    ws2.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === 'session_snapshot') {
        latestSnapshot = message.sessions;
      }
    });
    ws2.send(JSON.stringify({ type: 'session_list_request' }));
    await waitFor(() => Array.isArray(latestSnapshot), 'session snapshot after reconnect');

    record('Reconnected host reports no leftover cleanup session', () => {
      assert.strictEqual(latestSnapshot.some((entry) => entry.sessionId === SESSION_ID), false);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail('Exit cleanup integration failed', stderr ? `${detail}\n${stderr.trim()}` : detail);
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (ws2 && ws2.readyState === WebSocket.OPEN) {
      ws2.close();
    }
    if (leaderPid) forceKillProcessGroup(leaderPid);
    if (childPid) forceKillProcessGroup(childPid);
    await stopHost(hostProcess);
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(48));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(48) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal test error:', error.message);
  process.exit(1);
});
