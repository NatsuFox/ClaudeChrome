#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  ROOT,
  assertExists,
  getReleasePaths,
  getRepoMetadata,
  loadJson,
} = require('./ci-utils.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const { rootPackage } = getRepoMetadata();
const version = rootPackage.version;
const releasePaths = getReleasePaths(version);

assertExists(releasePaths.manifestPath, 'Release manifest is missing. Run npm run release:artifacts first.');
assertExists(releasePaths.extensionDir, 'Staged extension artifact is missing. Run npm run release:artifacts first.');
assertExists(releasePaths.nativeHostDir, 'Staged native-host artifact is missing. Run npm run release:artifacts first.');

const extensionManifestPath = path.join(releasePaths.extensionDir, 'manifest.json');
assertExists(extensionManifestPath, 'Staged extension manifest is missing.');
const extensionManifest = loadJson(extensionManifestPath);

assert(extensionManifest.version === version, `Staged extension version ${extensionManifest.version} does not match ${version}`);
assert(extensionManifest.manifest_version === 3, `Staged manifest_version must be 3, found ${extensionManifest.manifest_version}`);
assert(extensionManifest.side_panel?.default_path === 'side-panel/panel.html', 'Staged extension is missing side-panel/panel.html wiring');

for (const relativePath of [
  'service-worker.js',
  'side-panel/panel.html',
  'side-panel/panel.js',
  'side-panel/panel.css',
  'side-panel/config-panel.css',
  'content/injector.js',
  'content/page-script.js',
  'branding/logo.png',
]) {
  assertExists(path.join(releasePaths.extensionDir, relativePath), `Staged extension is missing ${relativePath}`);
}

const stagedNativeHostPackagePath = path.join(releasePaths.nativeHostDir, 'package.json');
const stagedNativeHostPackage = loadJson(stagedNativeHostPackagePath);
assert(stagedNativeHostPackage.version === version, `Staged native-host version ${stagedNativeHostPackage.version} does not match ${version}`);
assert(typeof stagedNativeHostPackage.scripts?.start === 'string', 'Staged native-host package.json is missing scripts.start');

for (const relativePath of [
  'package-lock.json',
  'dist/main.js',
  'dist/mcp-stdio-bridge.js',
  'dist/install.js',
  'start-native-host.sh',
  'start-native-host-macos.sh',
  'start-native-host-linux.sh',
  'start-native-host.cmd',
  'start-native-host-windows.cmd',
  'start-native-host.ps1',
  'start-native-host-windows.ps1',
]) {
  assertExists(path.join(releasePaths.nativeHostDir, relativePath), `Staged native-host artifact is missing ${relativePath}`);
}

const releaseManifest = loadJson(releasePaths.manifestPath);
assert(releaseManifest.version === version, `Release manifest version ${releaseManifest.version} does not match ${version}`);
assert(releaseManifest.extension?.baseName === releasePaths.extensionBaseName, 'Release manifest extension base name is out of sync');
assert(releaseManifest.nativeHost?.baseName === releasePaths.nativeHostBaseName, 'Release manifest native-host base name is out of sync');

console.log('[release-smoke] OK');
console.log(`[release-smoke] extension=${path.relative(ROOT, releasePaths.extensionDir)}`);
console.log(`[release-smoke] native-host=${path.relative(ROOT, releasePaths.nativeHostDir)}`);
