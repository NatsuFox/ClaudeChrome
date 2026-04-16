#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ROOT,
  getReleaseBaseNames,
  getRepoMetadata,
  normalizeGitTag,
} = require('./ci-utils.js');

function fail(message, errors) {
  console.error(`\n[release-check] ${message}`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const { rootPackage, nativeHostPackage, extensionManifest } = getRepoMetadata();
const version = rootPackage.version;
const errors = [];

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  errors.push(`Root package version is not semver-like: ${version}`);
}

if (nativeHostPackage.version !== version) {
  errors.push(`native-host/package.json version ${nativeHostPackage.version} does not match root version ${version}`);
}

if (extensionManifest.version !== version) {
  errors.push(`extension/manifest.json version ${extensionManifest.version} does not match root version ${version}`);
}

if (extensionManifest.manifest_version !== 3) {
  errors.push(`Expected manifest_version 3, found ${extensionManifest.manifest_version}`);
}

if (!extensionManifest.background || typeof extensionManifest.background.service_worker !== 'string') {
  errors.push('Extension manifest is missing background.service_worker');
}

if (!extensionManifest.side_panel || extensionManifest.side_panel.default_path !== 'side-panel/panel.html') {
  errors.push('Extension manifest must expose side_panel.default_path as side-panel/panel.html');
}

if (!Array.isArray(extensionManifest.permissions) || extensionManifest.permissions.length === 0) {
  errors.push('Extension manifest must declare at least one permission');
}

const tagFromCi = normalizeGitTag(
  process.env.CLAUDECHROME_EXPECT_RELEASE_TAG
  || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null)
  || (process.env.GITHUB_REF && process.env.GITHUB_REF.startsWith('refs/tags/') ? process.env.GITHUB_REF : null),
);

if (tagFromCi && tagFromCi !== `v${version}`) {
  errors.push(`Release tag ${tagFromCi} does not match package version v${version}`);
}

const { extensionBaseName, nativeHostBaseName } = getReleaseBaseNames(version);
for (const readmePath of ['README.md', 'README.en.md']) {
  const text = readText(readmePath);
  if (!text.includes(`${extensionBaseName}.zip`)) {
    errors.push(`${readmePath} does not mention ${extensionBaseName}.zip`);
  }
  if (!text.includes(`${nativeHostBaseName}.zip`)) {
    errors.push(`${readmePath} does not mention ${nativeHostBaseName}.zip`);
  }
}

if (errors.length > 0) {
  fail('Release metadata validation failed.', errors);
}

console.log('[release-check] OK');
console.log(`[release-check] version=${version}`);
console.log(`[release-check] tag=${tagFromCi || '(not enforcing a tag in this run)'}`);
console.log(`[release-check] permissions=${extensionManifest.permissions.join(', ')}`);
