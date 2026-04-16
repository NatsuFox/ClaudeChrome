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

function writeUnixLauncher(fileName, osLabel) {
  writeExecutable(
    path.join(releasePaths.nativeHostDir, fileName),
    `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${'${BASH_SOURCE[0]}'}")" && pwd)"
cd "$SCRIPT_DIR"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to start the ClaudeChrome native host bundle on ${osLabel}." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to start the ClaudeChrome native host bundle on ${osLabel}." >&2
  exit 1
fi
if [ ! -f "node_modules/ws/package.json" ]; then
  echo "Installing ClaudeChrome native-host runtime dependencies for ${osLabel}..."
  npm install --omit=dev
fi
find node_modules/node-pty -name spawn-helper -type f -exec chmod 755 {} + 2>/dev/null || true
export CLAUDECHROME_WS_PORT="${'${CLAUDECHROME_WS_PORT:-9999}'}"
echo "Starting ClaudeChrome native host on port ${'${CLAUDECHROME_WS_PORT}'} (${osLabel})"
exec node dist/main.js
`,
  );
}

writeUnixLauncher('start-native-host-macos.sh', 'macOS');
writeUnixLauncher('start-native-host-linux.sh', 'Linux');

writeExecutable(
  path.join(releasePaths.nativeHostDir, 'start-native-host-windows.cmd'),
  `@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to start the ClaudeChrome native host bundle on Windows.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required to start the ClaudeChrome native host bundle on Windows.
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing ClaudeChrome native-host runtime dependencies for Windows...
  call npm install --omit=dev
  if errorlevel 1 exit /b %errorlevel%
)
if "%CLAUDECHROME_WS_PORT%"=="" set CLAUDECHROME_WS_PORT=9999
echo Starting ClaudeChrome native host on port %CLAUDECHROME_WS_PORT% (Windows)
node dist/main.js
exit /b %errorlevel%
`,
);

writeExecutable(
  path.join(releasePaths.nativeHostDir, 'start-native-host-windows.ps1'),
  `param([int]$Port = 9999)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required to start the ClaudeChrome native host bundle on Windows.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm is required to start the ClaudeChrome native host bundle on Windows.'
}
if (-not (Test-Path 'node_modules/ws/package.json')) {
  Write-Host 'Installing ClaudeChrome native-host runtime dependencies for Windows...'
  npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if ($env:CLAUDECHROME_WS_PORT) {
  $Port = [int]$env:CLAUDECHROME_WS_PORT
}
$env:CLAUDECHROME_WS_PORT = "$Port"
Write-Host "Starting ClaudeChrome native host on port $Port (Windows)"
node dist/main.js
exit $LASTEXITCODE
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
    launchers: [
      'start-native-host-macos.sh',
      'start-native-host-linux.sh',
      'start-native-host-windows.cmd',
      'start-native-host-windows.ps1',
    ],
  },
};

fs.writeFileSync(releasePaths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log('[release-artifacts] Staged release artifacts');
console.log(`[release-artifacts] extension=${path.relative(ROOT, releasePaths.extensionDir)}`);
console.log(`[release-artifacts] native-host=${path.relative(ROOT, releasePaths.nativeHostDir)}`);
