#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PANEL_HTML = fs.readFileSync(path.join(ROOT, 'extension/side-panel/panel.html'), 'utf8');
const PANEL_TS = fs.readFileSync(path.join(ROOT, 'extension/side-panel/panel.ts'), 'utf8');
const PANEL_CSS = fs.readFileSync(path.join(ROOT, 'extension/side-panel/panel.css'), 'utf8');
const CONFIG_CSS = fs.readFileSync(path.join(ROOT, 'extension/side-panel/config-panel.css'), 'utf8');
const LEXICON = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/side-panel/lexicon.json'), 'utf8'));

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

function extractBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

console.log('\n\x1b[1mClaudeChrome — Panel UI Polish Tests\x1b[0m');
console.log('='.repeat(44));

const toolbarBlock = extractBlock(PANEL_HTML, '<div class="toolbar-cluster toolbar-action-cluster">', '<div class="toolbar-cluster toolbar-layout-cluster">');
const statusBlock = extractBlock(PANEL_HTML, '<div class="toolbar-cluster toolbar-status-cluster">', '<div class="toolbar-cluster toolbar-action-cluster">');
assert(toolbarBlock.includes('btn-add-shell-pane'), 'Header keeps Shell add action');
assert(toolbarBlock.includes('btn-add-claude-pane'), 'Header keeps Claude add action');
assert(toolbarBlock.includes('btn-add-codex-pane'), 'Header keeps Codex add action');
assert(!toolbarBlock.includes('btn-launch-defaults'), 'Header no longer contains launch defaults text button');
assert(!toolbarBlock.includes('btn-toggle-body-capture'), 'Header no longer contains response debug text button');
assert(statusBlock.includes('status-indicator'), 'Connection status remains in header');
assert(statusBlock.includes('toolbar-port-control'), 'Header contains polished port control cluster');
assert(statusBlock.includes('ws-port'), 'Header contains port input beside connection status');
assert(statusBlock.includes('btn-apply-port'), 'Header contains apply-port action');
assert(statusBlock.includes('btn-reconnect'), 'Header contains reconnect action');

const hiddenControls = extractBlock(PANEL_HTML, '<div id="settings-control-source" hidden>', '<div id="shell">');
['btn-launch-defaults', 'btn-toggle-body-capture', 'btn-language-toggle', 'btn-theme-toggle'].forEach((id) => {
  assert(hiddenControls.includes(id), `Settings control source preserves #${id}`);
});
['ws-port', 'btn-apply-port', 'btn-reconnect'].forEach((id) => {
  assert(!hiddenControls.includes(id), `Settings control source no longer owns #${id}`);
});

['btnAddShellPane', 'btnAddClaudePane', 'btnAddCodexPane', 'btnTogglePanel'].forEach((symbol) => {
  assert(new RegExp(`setIconButton\\(${symbol},`).test(PANEL_TS), `${symbol} is rendered through setIconButton`);
});

['addButton', 'renameButton', 'colorButton', 'collapseButton', 'btnGo', 'btnBind', 'btnRestart', 'btnClose'].forEach((symbol) => {
  assert(new RegExp(`setIconButton\\(${symbol},`).test(PANEL_TS), `${symbol} uses an icon-only control`);
});

assert(PANEL_TS.includes('appearanceActions.appendChild(btnLanguageToggle);'), 'Language toggle is rendered inside Settings');
assert(PANEL_TS.includes('appearanceActions.appendChild(btnThemeToggle);'), 'Theme toggle is rendered inside Settings');
assert(PANEL_TS.includes('appearanceActions.appendChild(btnToggleBodyCapture);'), 'Response debug toggle is rendered inside Settings');
assert(!PANEL_TS.includes('portField.appendChild(portInput);'), 'Port input is not reparented by Settings render');
assert(!PANEL_TS.includes('connectionActions.appendChild(btnReconnect);'), 'Reconnect action is not reparented by Settings render');

assert(!/linear-gradient|radial-gradient/.test(PANEL_CSS), 'Panel CSS avoids full-surface gradients');
assert(PANEL_CSS.includes('.toolbar-icon-button'), 'Toolbar icon button class is styled');
assert(PANEL_CSS.includes('.toolbar-port-control'), 'Header port control is styled');
assert(PANEL_CSS.includes('#btn-toggle-body-capture svg'), 'Response debug button icon is styled');
assert(PANEL_CSS.includes('--icon-size: 18px'), 'Language and theme icons keep readable settings-panel sizing');
assert(PANEL_CSS.includes('--icon-size: 17px'), 'Response debug icon keeps readable settings-panel sizing');
assert(CONFIG_CSS.includes('.config-field input[type="url"]'), 'Built-in API Base URL field uses config input styling');
assert(CONFIG_CSS.includes('.config-field input[type="password"]'), 'Built-in API Key field uses config input styling');
assert(CONFIG_CSS.includes('font-family: var(--font-mono);'), 'Built-in API fields use a precise monospace style');

assert(Boolean(LEXICON.locales.zh.settingsAppearanceTitle), 'Chinese settings appearance copy exists');
assert(Boolean(LEXICON.locales.en.settingsAppearanceTitle), 'English settings appearance copy exists');

console.log(`\nPassed: ${passed}`);
if (failed > 0) {
  console.error(`Failed: ${failed}`);
  process.exit(1);
}
console.log('Failed: 0');
