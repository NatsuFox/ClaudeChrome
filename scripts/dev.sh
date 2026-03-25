#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# Build native host first
cd native-host
npm install
npm run build
cd ..

# Install extension deps and start webpack watch
npm install
echo "==> Starting webpack dev build (watch mode)..."
echo "    Load dist/ as unpacked extension in chrome://extensions"
npx webpack --mode development --watch
