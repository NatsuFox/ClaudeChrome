#!/usr/bin/env node
// Registers the Native Messaging host manifest for Chrome/Chromium
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const NM_HOST_NAME = 'com.anthropic.claudechrome';

function getManifestDir(): string {
  const platform = os.platform();
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
    case 'linux':
      return path.join(home, '.config/google-chrome/NativeMessagingHosts');
    case 'win32':
      return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'NativeMessagingHosts');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function install() {
  const hostScript = path.resolve(__dirname, 'main.js');
  const manifestDir = getManifestDir();

  fs.mkdirSync(manifestDir, { recursive: true });

  const manifest = {
    name: NM_HOST_NAME,
    description: 'ClaudeChrome Native Messaging Host',
    path: hostScript,
    type: 'stdio',
    allowed_origins: [],
  };

  // Write wrapper script for non-Windows
  if (os.platform() !== 'win32') {
    const wrapperPath = path.resolve(__dirname, 'claudechrome-host.sh');

    // Chrome spawns the host with a minimal PATH (/usr/bin:/bin).
    // Resolve absolute paths at install time (when PATH is correct) and
    // embed them so the host and claude are always findable.
    const nodePath = process.execPath;
    const extraDirs: string[] = [path.dirname(nodePath)];

    try {
      const claudeBin = execSync('which claude', { encoding: 'utf8' }).trim();
      const claudeDir = path.dirname(claudeBin);
      if (claudeDir && !extraDirs.includes(claudeDir)) extraDirs.push(claudeDir);
    } catch {
      // claude not on PATH at install time — user must ensure it is available
    }

    const pathPrefix = extraDirs.join(':');
    const wrapper = `#!/bin/bash\nexport PATH="${pathPrefix}:$PATH"\nexec "${nodePath}" "${hostScript}" "$@"\n`;
    fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
    manifest.path = wrapperPath;
  }

  const manifestPath = path.join(manifestDir, `${NM_HOST_NAME}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Native messaging host installed:`);
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Host: ${manifest.path}`);
  console.log(`\nNote: Add your extension ID to allowed_origins in the manifest.`);
}

install();
