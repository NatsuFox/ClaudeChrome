#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'extension/content/capture-utils.ts');
const OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-capture-utils');
const COMPILED = path.resolve(OUTDIR, 'capture-utils.js');

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

async function main() {
  console.log('\n\x1b[1mClaudeChrome — Capture Guard Tests\x1b[0m');
  console.log('='.repeat(40));
  console.log('\n[1] Compiling capture-utils.ts...');

  fs.mkdirSync(OUTDIR, { recursive: true });

  try {
    execSync(
      `npx tsc --module commonjs --moduleResolution node --target es2020 --lib es2020,dom --outDir "${OUTDIR}" --skipLibCheck --esModuleInterop --strict false "${SRC}"`,
      { cwd: ROOT, stdio: 'pipe' }
    );
    pass('Compilation succeeded');
  } catch (error) {
    fail('Compilation failed', error.stdout?.toString() || error.message);
    process.exit(1);
  }

  const {
    MAX_CAPTURED_BODY_BYTES,
    isCapturableResponseContentType,
    isKnownContentLengthWithinLimit,
    shouldCaptureXhrBody,
    readResponseBodyPreview,
  } = require(COMPILED);

  console.log('\n[2] Verifying content-type and size guards...');
  assert(isCapturableResponseContentType('application/json; charset=utf-8') === true, 'JSON responses are capturable');
  assert(isCapturableResponseContentType('application/problem+json') === true, 'Structured +json responses are capturable');
  assert(isCapturableResponseContentType('image/png') === false, 'Binary image responses are skipped');
  assert(isKnownContentLengthWithinLimit(String(MAX_CAPTURED_BODY_BYTES - 1)) === true, 'Known sizes below the limit are allowed');
  assert(isKnownContentLengthWithinLimit(String(MAX_CAPTURED_BODY_BYTES + 1)) === false, 'Known sizes above the limit are rejected');
  assert(shouldCaptureXhrBody('application/json', String(MAX_CAPTURED_BODY_BYTES)) === true, 'XHR capture allows bounded JSON responses');
  assert(shouldCaptureXhrBody('application/json', null) === false, 'XHR capture skips responses without a known size');

  console.log('\n[3] Verifying bounded response preview reads...');
  const largeResponse = new Response('x'.repeat(MAX_CAPTURED_BODY_BYTES * 2), {
    headers: { 'content-type': 'text/plain' },
  });
  const preview = await readResponseBodyPreview(largeResponse, 1024, 1024);
  assert(preview.length === 1024, `Preview respects byte/char budget (${preview.length})`);

  const unicodeResponse = new Response('你好世界'.repeat(512), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
  const unicodePreview = await readResponseBodyPreview(unicodeResponse, 4096, 300);
  assert(unicodePreview.length <= 300, `Unicode preview respects char budget (${unicodePreview.length})`);
  assert(unicodePreview.includes('你好世界'), 'Unicode preview preserves decoded text');

  console.log('\n' + '='.repeat(40));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('='.repeat(40) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal test error:', error.message);
  process.exit(1);
});
