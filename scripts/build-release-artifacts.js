#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  NATIVE_HOST_PACKAGE_PATH,
  RELEASE_ROOT,
  ROOT,
  assertExists,
  copyDir,
  copyFile,
  ensureDir,
  getReleasePaths,
  getRepoMetadata,
  resolveArtifactPaths,
  resetDir,
  writeExecutable,
} = require('./ci-utils.js');

const { rootPackage } = getRepoMetadata();
const version = rootPackage.version;
const releasePaths = getReleasePaths(version);
const sourcePaths = resolveArtifactPaths({});
const nativeHostLockPath = path.join(ROOT, 'native-host', 'package-lock.json');
const nativeHostDistDir = path.join(sourcePaths.hostDir, 'dist');

assertExists(sourcePaths.extensionDir, `Extension build output is missing at ${sourcePaths.extensionDir}. Run npm run build first.`);
assertExists(path.join(sourcePaths.extensionDir, 'manifest.json'), `dist/manifest.json is missing at ${sourcePaths.extensionDir}. Run npm run build first.`);
assertExists(nativeHostDistDir, `native-host/dist is missing at ${nativeHostDistDir}. Run npm run build:host first.`);
assertExists(sourcePaths.hostEntry, `Host entry is missing at ${sourcePaths.hostEntry}. Run npm run build:host first.`);
assertExists(path.join(sourcePaths.hostDir, 'dist', 'mcp-stdio-bridge.js'), 'native-host/dist/mcp-stdio-bridge.js is missing. Run npm run build:host first.');
assertExists(path.join(sourcePaths.hostDir, 'dist', 'install.js'), 'native-host/dist/install.js is missing. Run npm run build:host first.');
assertExists(NATIVE_HOST_PACKAGE_PATH, 'native-host/package.json is missing.');
assertExists(nativeHostLockPath, 'native-host/package-lock.json is missing.');

ensureDir(RELEASE_ROOT);
resetDir(releasePaths.buildRoot);
resetDir(releasePaths.distRoot);

copyDir(sourcePaths.extensionDir, releasePaths.extensionDir);
ensureDir(releasePaths.nativeHostDir);
copyDir(nativeHostDistDir, path.join(releasePaths.nativeHostDir, 'dist'));
copyFile(NATIVE_HOST_PACKAGE_PATH, path.join(releasePaths.nativeHostDir, 'package.json'));
copyFile(nativeHostLockPath, path.join(releasePaths.nativeHostDir, 'package-lock.json'));

writeExecutable(
  path.join(releasePaths.nativeHostDir, 'start-native-host.sh'),
  `#!/usr/bin/env bash
set -euo pipefail
export CLAUDECHROME_WS_PORT="${'${CLAUDECHROME_WS_PORT:-9999}'}"
echo "Starting ClaudeChrome native host on port ${'${CLAUDECHROME_WS_PORT}'}"
npm run start
`,
);

writeExecutable(
  path.join(releasePaths.nativeHostDir, 'start-native-host.cmd'),
  `@echo off
if "%CLAUDECHROME_WS_PORT%"=="" set CLAUDECHROME_WS_PORT=9999
echo Starting ClaudeChrome native host on port %CLAUDECHROME_WS_PORT%
npm run start
`,
);

writeExecutable(
  path.join(releasePaths.nativeHostDir, 'start-native-host.ps1'),
  `param([int]$Port = 9999)
if ($env:CLAUDECHROME_WS_PORT) {
  $Port = [int]$env:CLAUDECHROME_WS_PORT
}
$env:CLAUDECHROME_WS_PORT = "$Port"
Write-Host "Starting ClaudeChrome native host on port $Port"
npm run start
`,
);

const manifest = {
  version,
  tag: `v${version}`,
  generatedAt: new Date().toISOString(),
  extension: {
    baseName: releasePaths.extensionBaseName,
    dir: path.relative(ROOT, releasePaths.extensionDir),
  },
  nativeHost: {
    baseName: releasePaths.nativeHostBaseName,
    dir: path.relative(ROOT, releasePaths.nativeHostDir),
  },
};

fs.writeFileSync(releasePaths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log('[release-artifacts] Staged release artifacts');
console.log(`[release-artifacts] extension=${path.relative(ROOT, releasePaths.extensionDir)}`);
console.log(`[release-artifacts] native-host=${path.relative(ROOT, releasePaths.nativeHostDir)}`);
