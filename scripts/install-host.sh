#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "==> Building native host..."
cd native-host
npm install
npm run build

echo "==> Registering native messaging host..."
node dist/install.js

echo "==> Done!"
echo "    Remember to add your extension ID to allowed_origins in the NM manifest."
