#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATE_SRC = path.resolve(ROOT, 'extension/side-panel/state.ts');
const STATE_LEXICON_SRC = path.resolve(ROOT, 'extension/side-panel/lexicon.ts');
const STATE_LEXICON_JSON = path.resolve(ROOT, 'extension/side-panel/lexicon.json');
const STATE_OUTDIR = path.resolve(os.tmpdir(), 'claudechrome-test-workspace-default-agent');
const STATE_COMPILED = path.resolve(STATE_OUTDIR, 'side-panel/state.js');
const STATE_LEXICON_OUT = path.resolve(STATE_OUTDIR, 'side-panel/lexicon.json');

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

console.log('\n\x1b[1mClaudeChrome — Workspace Default Agent Tests\x1b[0m');
console.log('='.repeat(54));
console.log('\n[1] Compiling side-panel state helper...');

fs.mkdirSync(STATE_OUTDIR, { recursive: true });

try {
  execSync(
    `npx tsc --module commonjs --moduleResolution node --target es2021 --outDir "${STATE_OUTDIR}" --skipLibCheck --esModuleInterop --resolveJsonModule --allowSyntheticDefaultImports --strict false "${STATE_SRC}" "${STATE_LEXICON_SRC}"`,
    { cwd: ROOT, stdio: 'pipe' },
  );
  fs.mkdirSync(path.dirname(STATE_LEXICON_OUT), { recursive: true });
  fs.copyFileSync(STATE_LEXICON_JSON, STATE_LEXICON_OUT);
  pass('Side-panel state helper compilation succeeded');
} catch (error) {
  fail('Side-panel state helper compilation failed', error.stdout?.toString() || error.message);
  process.exit(1);
}

const state = require(STATE_COMPILED);

console.log('\n[2] Verifying workspace default-agent behavior...');
test('createWorkspace preserves an explicit default agent type', () => {
  const workspace = state.createWorkspace(0, 'codex');
  assert.strictEqual(workspace.defaultAgentType, 'codex');
});

test('createDefaultState uses the workspace default agent for the first pane', () => {
  const panelState = state.createDefaultState('9999');
  assert.strictEqual(panelState.workspaces[0].defaultAgentType, 'claude');
  assert.strictEqual(panelState.panes[0].agentType, panelState.workspaces[0].defaultAgentType);
});

test('ensureValidState backfills missing workspace default agents to Claude', () => {
  const panelState = state.createDefaultState('9999');
  delete panelState.workspaces[0].defaultAgentType;
  const migrated = state.ensureValidState(panelState, '9999');
  assert.strictEqual(migrated.workspaces[0].defaultAgentType, 'claude');
});

test('ensureValidState preserves stored workspace default agents', () => {
  const panelState = state.createDefaultState('9999');
  panelState.workspaces[0].defaultAgentType = 'shell';
  const migrated = state.ensureValidState(panelState, '9999');
  assert.strictEqual(migrated.workspaces[0].defaultAgentType, 'shell');
});

console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  process.exit(1);
}
