#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src', 'ui');
const outputDir = path.join(rootDir, '.site-pages');

function ensureExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing required path: ${targetPath}`);
  }
}

function main() {
  ensureExists(sourceDir);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.cpSync(sourceDir, outputDir, { recursive: true });

  const requiredFiles = [
    'index.html',
    'index-zh.html',
    'app.js',
    'styles.css',
    'lexicon-inline.js',
  ];

  for (const relativePath of requiredFiles) {
    ensureExists(path.join(outputDir, relativePath));
  }

  console.log(`Built GitHub Pages artifact at ${outputDir}`);
}

main();
