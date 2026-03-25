#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "==> Installing extension dependencies..."
npm install

echo "==> Building extension..."
npm run build

echo "==> Installing native host dependencies..."
cd native-host
npm install

echo "==> Building native host..."
npm run build

echo "==> Done! Extension built to dist/"
echo "    Load dist/ as unpacked extension in chrome://extensions"
