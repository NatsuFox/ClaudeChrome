#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'native-host/src/pty-bridge.ts');
const OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-pty-cleanup');
const COMPILED = path.resolve(OUTDIR, 'pty-bridge.js');

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.error(`  \x1b[31m✗\x1b[0m ${label}${detail ? ': ' + detail : ''}`);
  failed++;
}

function assert(condition, label, detail = '') {
  condition ? pass(label) : fail(label, detail);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, label, timeoutMs = 5000, intervalMs = 100) {
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

async function main() {
  console.log('\n\x1b[1mClaudeChrome — PTY Cleanup Tests\x1b[0m');
  console.log('='.repeat(40));

  if (process.platform === 'win32') {
    console.log('\n[skip] PTY cleanup test is Unix-only in this environment.');
    process.exit(0);
  }

  console.log('\n[1] Compiling pty-bridge.ts...');
  fs.mkdirSync(OUTDIR, { recursive: true });

  try {
    execSync(
      `npx tsc --module commonjs --moduleResolution node --target es2020 --outDir "${OUTDIR}" --skipLibCheck --esModuleInterop --strict false "${SRC}"`,
      { cwd: ROOT, stdio: 'pipe' }
    );
    pass('Compilation succeeded');
  } catch (error) {
    fail('Compilation failed', error.stdout?.toString() || error.message);
    process.exit(1);
  }

  process.env.NODE_PATH = [
    path.resolve(ROOT, 'native-host/node_modules'),
    process.env.NODE_PATH || '',
  ].filter(Boolean).join(path.delimiter);
  Module._initPaths();

  const { PtyBridge } = require(COMPILED);

  console.log('\n[2] Verifying kill() tears down descendant processes...');
  const bridge = new PtyBridge();
  let output = '';
  let exitCode = null;

  bridge.on('data', (data) => {
    output += data;
  });
  bridge.on('exit', (code) => {
    exitCode = code;
  });

  bridge.spawn({
    command: 'bash',
    args: ['-lc', 'sleep 1000 & echo CHILD:$!; exec sleep 1000'],
    cwd: ROOT,
    env: { ...process.env },
    cols: 80,
    rows: 24,
  });

  const childPid = await waitFor(() => {
    const match = output.match(/CHILD:(\d+)/);
    return match ? Number(match[1]) : null;
  }, 'child pid announcement');

  const leaderPid = bridge.pid;
  assert(typeof leaderPid === 'number' && leaderPid > 0, `PTY leader pid is available (${leaderPid})`);
  assert(processExists(childPid), `Background child process ${childPid} is running before kill()`);

  bridge.kill();

  await waitFor(() => exitCode !== null || !processExists(leaderPid), 'PTY leader exit');
  await waitFor(() => !processExists(childPid), 'background child exit');

  assert(!processExists(leaderPid), `PTY leader process ${leaderPid} exits after kill()`);
  assert(!processExists(childPid), `Background child process ${childPid} exits after kill()`);

  console.log('\n[3] Verifying natural PTY exit tears down residual descendants...');
  const naturalBridge = new PtyBridge();
  let naturalOutput = '';
  let naturalExitCode = null;

  naturalBridge.on('data', (data) => {
    naturalOutput += data;
  });
  naturalBridge.on('exit', (code) => {
    naturalExitCode = code;
  });

  naturalBridge.spawn({
    command: 'bash',
    args: ['-lc', 'nohup sleep 1000 >/dev/null 2>&1 & echo CHILD:$!; exit 0'],
    cwd: ROOT,
    env: { ...process.env },
    cols: 80,
    rows: 24,
  });

  const naturalChildPid = await waitFor(() => {
    const match = naturalOutput.match(/CHILD:(\d+)/);
    return match ? Number(match[1]) : null;
  }, 'natural-exit child pid announcement');

  await waitFor(() => naturalExitCode !== null, 'natural PTY leader exit');
  await waitFor(() => !processExists(naturalChildPid), 'detached child cleanup after natural exit', 7000);

  assert(!processExists(naturalChildPid), `Detached child process ${naturalChildPid} exits after natural PTY exit`);

  console.log('\n' + '='.repeat(40));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('='.repeat(40) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal test error:', error.message);
  process.exit(1);
});
