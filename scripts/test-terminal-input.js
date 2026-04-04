#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TextEncoder } = require('util');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'extension/shared/base64.ts');
const OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-base64');
const COMPILED = path.resolve(OUTDIR, 'base64.js');

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

function assert(condition, label, detail = '') {
  if (condition) {
    pass(label);
    return;
  }
  fail(label, detail);
}

function installWebEncodingGlobals() {
  if (typeof global.TextEncoder !== 'function') {
    global.TextEncoder = TextEncoder;
  }
  if (typeof global.btoa !== 'function') {
    global.btoa = (input) => Buffer.from(input, 'binary').toString('base64');
  }
  if (typeof global.atob !== 'function') {
    global.atob = (input) => Buffer.from(input, 'base64').toString('binary');
  }
}

console.log('\n\x1b[1mClaudeChrome — Terminal Unicode Input Tests\x1b[0m');
console.log('='.repeat(48));
console.log('\n[1] Compiling base64 helper...');

fs.mkdirSync(OUTDIR, { recursive: true });

try {
  execSync(
    `npx tsc --module commonjs --moduleResolution node --target es2020 --outDir "${OUTDIR}" --skipLibCheck --esModuleInterop --strict false "${SRC}"`,
    { cwd: ROOT, stdio: 'pipe' },
  );
  pass('Compilation succeeded');
} catch (error) {
  fail('Compilation failed', error.stdout?.toString() || error.message);
  process.exit(1);
}

console.log('\n[2] Verifying UTF-8 terminal transport...');
installWebEncodingGlobals();

const { encodeUtf8ToBase64, decodeBase64ToBytes } = require(COMPILED);
const samples = [
  'plain-ascii',
  '中文输入',
  '拼音 abc 123',
  'かな漢字変換',
  'emoji 😀 terminal',
];

for (const sample of samples) {
  const encoded = encodeUtf8ToBase64(sample);
  const expected = Buffer.from(sample, 'utf8').toString('base64');
  assert(encoded === expected, `encodeUtf8ToBase64 matches Node UTF-8 base64 for ${JSON.stringify(sample)}`);

  const hostDecoded = Buffer.from(encoded, 'base64').toString('utf8');
  assert(hostDecoded === sample, `native-host decode round-trip preserves ${JSON.stringify(sample)}`);

  const byteDecoded = Buffer.from(decodeBase64ToBytes(encoded)).toString('utf8');
  assert(byteDecoded === sample, `decodeBase64ToBytes preserves ${JSON.stringify(sample)}`);
}

console.log(`\nPassed: ${passed}`);
if (failed > 0) {
  console.error(`Failed: ${failed}`);
  process.exit(1);
}
console.log('Failed: 0');
