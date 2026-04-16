#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_ROOT = path.join(ROOT, '.release');
const ROOT_PACKAGE_PATH = path.join(ROOT, 'package.json');
const NATIVE_HOST_PACKAGE_PATH = path.join(ROOT, 'native-host', 'package.json');
const EXTENSION_MANIFEST_PATH = path.join(ROOT, 'extension', 'manifest.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getRepoMetadata() {
  return {
    rootPackage: loadJson(ROOT_PACKAGE_PATH),
    nativeHostPackage: loadJson(NATIVE_HOST_PACKAGE_PATH),
    extensionManifest: loadJson(EXTENSION_MANIFEST_PATH),
  };
}

function getReleaseBaseNames(version = getRepoMetadata().rootPackage.version) {
  return {
    extensionBaseName: `ClaudeChrome-extension-v${version}`,
    nativeHostBaseName: `ClaudeChrome-native-host-v${version}`,
  };
}

function getReleasePaths(version = getRepoMetadata().rootPackage.version) {
  const { extensionBaseName, nativeHostBaseName } = getReleaseBaseNames(version);
  return {
    releaseRoot: RELEASE_ROOT,
    buildRoot: path.join(RELEASE_ROOT, 'build'),
    distRoot: path.join(RELEASE_ROOT, 'dist'),
    manifestPath: path.join(RELEASE_ROOT, 'release-manifest.json'),
    extensionBaseName,
    nativeHostBaseName,
    extensionDir: path.join(RELEASE_ROOT, 'build', extensionBaseName),
    nativeHostDir: path.join(RELEASE_ROOT, 'build', nativeHostBaseName),
  };
}

function resolveArtifactPaths(env = process.env) {
  const extensionDir = path.resolve(env.CLAUDECHROME_EXTENSION_DIR || path.join(ROOT, 'dist'));
  const hostDir = path.resolve(env.CLAUDECHROME_HOST_DIR || path.join(ROOT, 'native-host'));
  return {
    rootDir: ROOT,
    extensionDir,
    hostDir,
    hostEntry: path.resolve(env.CLAUDECHROME_HOST_ENTRY || path.join(hostDir, 'dist', 'main.js')),
    mcpBridgeEntry: path.resolve(env.CLAUDECHROME_MCP_BRIDGE_ENTRY || path.join(hostDir, 'dist', 'mcp-stdio-bridge.js')),
    hostNodeModulesDir: path.join(hostDir, 'node_modules'),
  };
}

function requireHostDependency(modulePath, env = process.env) {
  const { hostNodeModulesDir } = resolveArtifactPaths(env);
  return require(path.join(hostNodeModulesDir, modulePath));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function writeExecutable(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function assertExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message || `Missing required path: ${filePath}`);
  }
}

function normalizeGitTag(rawValue) {
  if (!rawValue) return null;
  if (rawValue.startsWith('refs/tags/')) {
    return rawValue.slice('refs/tags/'.length);
  }
  return rawValue;
}

module.exports = {
  ROOT,
  RELEASE_ROOT,
  ROOT_PACKAGE_PATH,
  NATIVE_HOST_PACKAGE_PATH,
  EXTENSION_MANIFEST_PATH,
  assertExists,
  copyDir,
  copyFile,
  ensureDir,
  getReleaseBaseNames,
  getReleasePaths,
  getRepoMetadata,
  loadJson,
  normalizeGitTag,
  requireHostDependency,
  resolveArtifactPaths,
  resetDir,
  writeExecutable,
};
