#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'extension/side-panel/terminal-shortcuts.ts');
const OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-terminal-shortcuts');
const COMPILED = path.resolve(OUTDIR, 'terminal-shortcuts.js');

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

function keyEvent(overrides) {
  return {
    key: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

console.log('\n\x1b[1mClaudeChrome — Terminal Shortcut Tests\x1b[0m');
console.log('='.repeat(45));
console.log('\n[1] Compiling terminal shortcut helper...');

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

console.log('\n[2] Verifying shortcut mappings...');
const {
  SHIFT_ENTER_SEQUENCE,
  WORD_BACKWARD_SEQUENCE,
  WORD_FORWARD_SEQUENCE,
  isMacPlatform,
  resolveTerminalShortcut,
} = require(COMPILED);

assert(isMacPlatform('MacIntel') === true, 'Mac platform detection matches MacIntel');
assert(isMacPlatform('Windows') === false, 'Mac platform detection skips Windows');

let action = resolveTerminalShortcut(keyEvent({ key: 'Enter', shiftKey: true }), false);
assert(action?.kind === 'sequence', 'Shift+Enter resolves to a sequence');
assert(action?.sequence === SHIFT_ENTER_SEQUENCE, 'Shift+Enter emits the multiline input sequence');

action = resolveTerminalShortcut(keyEvent({ key: 'v', ctrlKey: true }), false);
assert(action?.kind === 'paste', 'Ctrl+V resolves to paste');

action = resolveTerminalShortcut(keyEvent({ key: 'V', metaKey: true, shiftKey: true }), true);
assert(action?.kind === 'paste', 'Meta+Shift+V resolves to paste');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowLeft', ctrlKey: true }), false);
assert(action?.sequence === WORD_BACKWARD_SEQUENCE, 'Ctrl+Left emits the readline word-backward sequence');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowRight', ctrlKey: true }), false);
assert(action?.sequence === WORD_FORWARD_SEQUENCE, 'Ctrl+Right emits the readline word-forward sequence');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowLeft', altKey: true }), true);
assert(action?.sequence === WORD_BACKWARD_SEQUENCE, 'Option+Left on Mac emits word-backward');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowRight', altKey: true }), true);
assert(action?.sequence === WORD_FORWARD_SEQUENCE, 'Option+Right on Mac emits word-forward');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowLeft', metaKey: true }), true);
assert(action?.sequence === WORD_BACKWARD_SEQUENCE, 'Command+Left on Mac emits word-backward');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowRight', metaKey: true }), true);
assert(action?.sequence === WORD_FORWARD_SEQUENCE, 'Command+Right on Mac emits word-forward');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowUp', metaKey: true }), true);
assert(action?.sequence === '\u001b[1;5A', 'Command+Up on Mac emits the modified-arrow fallback');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowLeft', metaKey: true }), false);
assert(action === null, 'Meta+Left is ignored on non-Mac platforms');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowLeft', altKey: true }), false);
assert(action?.sequence === WORD_BACKWARD_SEQUENCE, 'Alt+Left on non-Mac emits word-backward');

action = resolveTerminalShortcut(keyEvent({ key: 'ArrowUp', altKey: true }), false);
assert(action?.sequence === '\u001b[1;5A', 'Alt+Up on non-Mac emits the modified-arrow fallback');

action = resolveTerminalShortcut(keyEvent({ key: 'Enter' }), false);
assert(action === null, 'Plain Enter is left to xterm defaults');

console.log(`\nPassed: ${passed}`);
if (failed > 0) {
  console.error(`Failed: ${failed}`);
  process.exit(1);
}
console.log('Failed: 0');
