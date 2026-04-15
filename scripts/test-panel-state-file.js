#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readPanelStateFile,
  resolvePanelStateFilePath,
  writePanelStateFile,
} = require(path.resolve(__dirname, '../native-host/dist/panel-state-file.js'));

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed += 1;
}

function fail(label, detail = '') {
  console.error(`  \x1b[31m✗\x1b[0m ${label}${detail ? `: ${detail}` : ''}`);
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

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

console.log('\n\x1b[1mClaudeChrome — Panel State File Tests\x1b[0m');
console.log('='.repeat(50));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudechrome-panel-state-file-'));
const stateFile = path.join(tempRoot, 'panel-state.local.json');

try {
  test('Override path is honored', () => {
    withEnv({ CLAUDECHROME_PANEL_STATE_FILE: stateFile }, () => {
      assert.strictEqual(resolvePanelStateFilePath(), stateFile);
    });
  });

  test('Missing state file reports not found', () => {
    withEnv({ CLAUDECHROME_PANEL_STATE_FILE: stateFile }, () => {
      assert.strictEqual(fs.existsSync(stateFile), false);
      const result = readPanelStateFile();
      assert.strictEqual(result.found, false);
      assert.strictEqual(result.path, stateFile);
    });
  });

  test('Panel state file round-trips saved JSON', () => {
    const sampleState = {
      shellWorkingDirectory: '/tmp/project',
      launchDefaults: {
        claude: { launchArgs: '', workingDirectory: '', systemPromptMode: 'default', customSystemPrompt: '' },
        codex: { launchArgs: '-a never', workingDirectory: '/tmp/project', systemPromptMode: 'default', customSystemPrompt: '' },
      },
      updatedAt: 123,
    };

    withEnv({ CLAUDECHROME_PANEL_STATE_FILE: stateFile }, () => {
      const writtenPath = writePanelStateFile(sampleState);
      assert.strictEqual(writtenPath, stateFile);
      const result = readPanelStateFile();
      assert.strictEqual(result.found, true);
      assert.deepStrictEqual(result.state, sampleState);
    });
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\nResults: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
if (failed > 0) {
  process.exit(1);
}
