#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'extension/shared/network-update-buffer.ts');
const OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-network-update-buffer');
const COMPILED = path.resolve(OUTDIR, 'network-update-buffer.js');

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

async function main() {
  console.log('\n\x1b[1mClaudeChrome — Network Update Buffer Tests\x1b[0m');
  console.log('='.repeat(48));
  console.log('\n[1] Compiling network-update-buffer.ts...');

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

  const { NetworkUpdateBuffer } = require(COMPILED);

  console.log('\n[2] Verifying batched flushes...');
  const flushes = [];
  const buffer = new NetworkUpdateBuffer(20, 512, (tabId, payload) => {
    flushes.push({ tabId, payload });
  });

  buffer.enqueue(7, { id: 'req-a', tabId: 7, url: 'https://a.test', method: 'GET', requestHeaders: {}, startTime: 1, endTime: 2 });
  buffer.enqueue(7, { id: 'req-b', tabId: 7, url: 'https://b.test', method: 'GET', requestHeaders: {}, startTime: 3, endTime: 4 });
  await sleep(50);

  assert(flushes.length === 1, `Two requests flush once (${flushes.length})`);
  assert(Array.isArray(flushes[0]?.payload), 'Two pending requests flush as an array payload');
  assert(flushes[0]?.payload.length === 2, `Batched payload includes both requests (${flushes[0]?.payload.length || 0})`);

  console.log('\n[3] Verifying request dedupe before flush...');
  flushes.length = 0;
  buffer.enqueue(9, { id: 'req-body', tabId: 9, url: 'https://body.test', method: 'GET', requestHeaders: {}, startTime: 1, endTime: 2 });
  buffer.enqueue(9, { id: 'req-body', tabId: 9, url: 'https://body.test', method: 'GET', requestHeaders: {}, startTime: 1, endTime: 3, responseBody: '{"ok":true}' });
  await sleep(50);

  assert(flushes.length === 1, `Deduped request still flushes once (${flushes.length})`);
  assert(!Array.isArray(flushes[0]?.payload), 'Single deduped request flushes as an object payload');
  assert(flushes[0]?.payload.responseBody === '{"ok":true}', 'Latest request version wins before flush');

  console.log('\n[4] Verifying byte budget splits oversized batches...');
  flushes.length = 0;
  buffer.enqueue(10, { id: 'req-small', tabId: 10, url: 'https://small.test', method: 'GET', requestHeaders: {}, startTime: 1, endTime: 2 });
  buffer.enqueue(10, { id: 'req-large', tabId: 10, url: 'https://large.test', method: 'GET', requestHeaders: {}, startTime: 3, endTime: 4, responseBody: 'x'.repeat(2000) });
  await sleep(50);

  assert(flushes.length === 2, `Oversized batches split before flush (${flushes.length})`);
  assert(!Array.isArray(flushes[0]?.payload), 'First split payload flushes as a single request');
  assert(!Array.isArray(flushes[1]?.payload), 'Second split payload flushes as a single request');
  assert(flushes[0]?.payload.id === 'req-small', 'Byte-budget split flushes the existing small request first');
  assert(flushes[1]?.payload.id === 'req-large', 'Byte-budget split flushes the large request separately');

  console.log('\n[5] Verifying clearTab cancels pending flushes...');
  flushes.length = 0;
  buffer.enqueue(11, { id: 'req-clear', tabId: 11, url: 'https://clear.test', method: 'GET', requestHeaders: {}, startTime: 1, endTime: 2 });
  buffer.clearTab(11);
  await sleep(50);

  assert(flushes.length === 0, 'clearTab prevents the pending flush');

  console.log('\n' + '='.repeat(48));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('='.repeat(48) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal test error:', error.message);
  process.exit(1);
});
