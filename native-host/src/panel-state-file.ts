import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PANEL_STATE_FILE_ENV = 'CLAUDECHROME_PANEL_STATE_FILE';
const PANEL_STATE_FILE_NAME = 'panel-state.local.json';

export interface PanelStateFileReadResult {
  found: boolean;
  path: string;
  state?: unknown;
  error?: string;
}

function defaultPanelStateDirectory(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeChrome');
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ClaudeChrome');
  }

  return path.join(process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'), 'claudechrome');
}

export function resolvePanelStateFilePath(): string {
  const override = process.env[PANEL_STATE_FILE_ENV]?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(defaultPanelStateDirectory(), PANEL_STATE_FILE_NAME);
}

export function writePanelStateFile(state: unknown): string {
  const filePath = resolvePanelStateFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readPanelStateFile(): PanelStateFileReadResult {
  const filePath = resolvePanelStateFilePath();
  if (!fs.existsSync(filePath)) {
    return { found: false, path: filePath };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return {
      found: true,
      path: filePath,
      state: JSON.parse(raw),
    };
  } catch (error) {
    return {
      found: true,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
