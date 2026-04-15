#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_SRC = path.resolve(ROOT, 'extension/side-panel/working-directory.ts');
const FRONTEND_OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-working-directory');
const FRONTEND_COMPILED = path.resolve(FRONTEND_OUTDIR, 'working-directory.js');
const HOST_COMPILED = path.resolve(ROOT, 'native-host/dist/working-directory.js');
const HOST_MAIN = path.resolve(ROOT, 'native-host/dist/main.js');
const HOST_CWD = path.resolve(ROOT, 'native-host');
const WebSocket = require(path.resolve(ROOT, 'native-host/node_modules/ws'));

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

function waitForPort(port, label, timeoutMs = 10000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${label} on port ${port}`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a TCP port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function waitForCondition(check, label, timeoutMs = 10000, intervalMs = 50) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = check();
        if (value) {
          resolve(value);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

async function runHostWorkingDirectorySmokeTest() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-working-directory-runtime-'));
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-working-directory-target-'));
  const wsPort = await reservePort();
  const sessionId = `working-directory-${Date.now()}`;
  const pwdMarker = `__CC_PWD__${workingDirectory}__`;

  let hostProcess = null;
  let ws = null;
  let stderr = '';
  let output = '';
  let sessionClosed = false;

  try {
    hostProcess = spawn('node', [HOST_MAIN], {
      cwd: HOST_CWD,
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

    ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.type === 'session_output' && message.sessionId === sessionId) {
        output += Buffer.from(message.data, 'base64').toString();
      } else if (message.type === 'session_closed' && message.sessionId === sessionId) {
        sessionClosed = true;
      }
    });

    ws.send(JSON.stringify({
      type: 'session_create',
      sessionId,
      agentType: 'shell',
      title: 'Working Directory Smoke Test',
      binding: { kind: 'tab', tabId: 1 },
      cols: 100,
      rows: 30,
      startupOptions: {
        launchArgs: '',
        workingDirectory,
        systemPromptMode: 'default',
        customSystemPrompt: '',
      },
    }));

    await waitForCondition(() => output.includes(workingDirectory), 'shell launch diagnostics');

    ws.send(JSON.stringify({
      type: 'session_input',
      sessionId,
      data: Buffer.from(`printf '__CC_PWD__%s__\n' "$PWD"\nexit\n`).toString('base64'),
    }));

    await waitForCondition(() => output.includes(pwdMarker), 'shell pwd output');
    await waitForCondition(() => sessionClosed, 'shell session closure');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(stderr ? `${detail}\n${stderr.trim()}` : detail);
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'session_close', sessionId }));
      } catch {}
      ws.close();
    }

    if (hostProcess && hostProcess.exitCode == null) {
      hostProcess.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (hostProcess.exitCode == null) {
            hostProcess.kill('SIGKILL');
          }
          resolve();
        }, 3000);
        hostProcess.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  console.log('\n\x1b[1mClaudeChrome — Working Directory Validation Tests\x1b[0m');
  console.log('='.repeat(58));
  console.log('\n[1] Compiling frontend working-directory helper...');

  fs.mkdirSync(FRONTEND_OUTDIR, { recursive: true });

  try {
    execSync(
      `npx tsc --module commonjs --moduleResolution node --target es2020 --outDir "${FRONTEND_OUTDIR}" --skipLibCheck --esModuleInterop --strict false "${FRONTEND_SRC}"`,
      { cwd: ROOT, stdio: 'pipe' },
    );
    pass('Frontend helper compilation succeeded');
  } catch (error) {
    fail('Frontend helper compilation failed', error.stdout?.toString() || error.message);
    process.exit(1);
  }

  const frontend = require(FRONTEND_COMPILED);
  const host = require(HOST_COMPILED);
  const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-working-directory-existing-'));
  const existingFile = path.join(existingDir, 'not-a-directory.txt');
  const missingDir = path.join(existingDir, 'missing-subdir');
  fs.writeFileSync(existingFile, 'test');

  try {
    console.log('\n[2] Verifying accepted configured paths...');
    test('Empty working directory is allowed on the frontend', () => {
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory(''), true);
    });

    test('Absolute POSIX paths are allowed on the frontend', () => {
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('/tmp/project'), true);
    });

    test('Windows-style absolute paths are allowed on the frontend', () => {
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('C:\\Users\\me\\project'), true);
    });

    test('Leading-tilde paths are allowed on the frontend', () => {
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('~/project'), true);
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('~\\project'), true);
    });

    console.log('\n[3] Verifying rejected relative paths...');
    test('Relative paths are rejected on the frontend', () => {
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('project/subdir'), false);
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('../project'), false);
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('.'), false);
    });

    test('Unsupported tilde forms are rejected on the frontend', () => {
      assert.strictEqual(frontend.isValidConfiguredWorkingDirectory('~other/project'), false);
    });

    console.log('\n[4] Verifying host-side expansion and fallback rules...');
    test('Host expands leading tilde to the provided home directory', () => {
      assert.strictEqual(host.expandUserHomePrefix('~/project', '/home/tester'), path.join('/home/tester', 'project'));
      assert.strictEqual(host.expandUserHomePrefix('~', '/home/tester'), '/home/tester');
    });

    test('Host absolute-path check follows the current OS rules', () => {
      assert.strictEqual(host.isAbsoluteConfiguredWorkingDirectory('/srv/work'), true);
      if (process.platform !== 'win32') {
        assert.strictEqual(host.isAbsoluteConfiguredWorkingDirectory('C:\\Users\\tester\\work'), false);
      }
    });

    test('Host validates an existing configured directory', () => {
      const result = host.validateConfiguredWorkingDirectory(existingDir);
      assert.strictEqual(result.code, 'valid');
      assert.strictEqual(result.normalizedPath, existingDir);
    });

    test('Host rejects a missing configured directory with a checked-path message', () => {
      const result = host.validateConfiguredWorkingDirectory(missingDir);
      assert.strictEqual(result.code, 'not_found');
      assert.strictEqual(result.normalizedPath, missingDir);
      assert.match(result.message, /does not exist/);
      assert(result.message.includes(missingDir));
    });

    test('Host rejects a configured path that is not a directory with a checked-path message', () => {
      const result = host.validateConfiguredWorkingDirectory(existingFile);
      assert.strictEqual(result.code, 'not_directory');
      assert.strictEqual(result.normalizedPath, existingFile);
      assert.match(result.message, /must point to an existing directory/);
      assert(result.message.includes(existingFile));
    });

    test('Host keeps absolute configured paths unchanged', () => {
      assert.strictEqual(host.resolveConfiguredWorkingDirectory(existingDir, '/fallback', '/session/workspace'), existingDir);
    });

    test('Host uses explicit cwd only when working directory is empty', () => {
      assert.strictEqual(host.resolveConfiguredWorkingDirectory('', '/fallback', '/session/workspace'), '/fallback');
    });

    test('Host falls back to the session workspace when nothing is configured', () => {
      assert.strictEqual(host.resolveConfiguredWorkingDirectory(undefined, null, '/session/workspace'), '/session/workspace');
    });

    test('Host rejects relative configured paths', () => {
      assert.throws(
        () => host.resolveConfiguredWorkingDirectory('project/subdir', '/fallback', '/session/workspace'),
        new RegExp(host.INVALID_WORKING_DIRECTORY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    });

    test('Host rejects missing configured paths without creating them', () => {
      assert.strictEqual(fs.existsSync(missingDir), false);
      assert.throws(
        () => host.resolveConfiguredWorkingDirectory(missingDir, '/fallback', '/session/workspace'),
        new RegExp(host.MISSING_WORKING_DIRECTORY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      assert.strictEqual(fs.existsSync(missingDir), false);
    });

    console.log('\n[5] Verifying configured working directories are applied to real shell launches...');
    try {
      await runHostWorkingDirectorySmokeTest();
      pass('Host applies the configured working directory to launched shell sessions');
    } catch (error) {
      fail(
        'Host applies the configured working directory to launched shell sessions',
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    fs.rmSync(existingDir, { recursive: true, force: true });
  }

  console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
