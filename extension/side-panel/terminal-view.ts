import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';

import { decodeBase64ToBytes } from '../shared/base64';
import type { PanelTheme } from './state';

const DARK_THEME: ITheme = {
  background: '#07111f',
  foreground: '#d6e6ff',
  cursor: '#f8fafc',
  cursorAccent: '#07111f',
  selectionBackground: '#28486b',
  black: '#07111f',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#d6e6ff',
  brightBlack: '#52627d',
  brightRed: '#ff8ea1',
  brightGreen: '#b4f581',
  brightYellow: '#f4c184',
  brightBlue: '#9ab9ff',
  brightMagenta: '#d0b6ff',
  brightCyan: '#9de6ff',
  brightWhite: '#f8fafc',
};

const LIGHT_THEME: ITheme = {
  background: '#fffaf5',
  foreground: '#1b2a40',
  cursor: '#3558ff',
  cursorAccent: '#fffaf5',
  selectionBackground: '#cad9ff',
  black: '#24364d',
  red: '#c64b63',
  green: '#1f8f58',
  yellow: '#b56f1f',
  blue: '#3558ff',
  magenta: '#7b4cd6',
  cyan: '#0d7d94',
  white: '#8798ad',
  brightBlack: '#566a83',
  brightRed: '#dd5e76',
  brightGreen: '#2ca96b',
  brightYellow: '#cf8d3b',
  brightBlue: '#5573ff',
  brightMagenta: '#9567ea',
  brightCyan: '#2998b2',
  brightWhite: '#18263d',
};

function themeForMode(mode: PanelTheme): ITheme {
  return mode === 'light' ? LIGHT_THEME : DARK_THEME;
}

export class TerminalView {
  readonly root: HTMLDivElement;

  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private mounted = false;

  constructor(theme: PanelTheme = 'dark') {
    this.root = document.createElement('div');
    this.root.className = 'pane-terminal';

    this.terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'Menlo', 'Consolas', 'Courier New', monospace",
      fontSize: 13,
      theme: { ...themeForMode(theme) },
      cursorBlink: true,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    try {
      this.terminal.loadAddon(new WebglAddon());
    } catch {
      // Fall back to the default renderer when WebGL is unavailable.
    }

    this.setTheme(theme);
  }

  mount(parent: HTMLElement): void {
    if (this.root.parentElement !== parent) {
      parent.replaceChildren(this.root);
    }

    if (!this.mounted) {
      this.terminal.open(this.root);
      this.mounted = true;
    }

    this.fit();
  }

  setTheme(theme: PanelTheme): void {
    this.root.dataset.theme = theme;
    this.terminal.options.theme = { ...themeForMode(theme) };
  }

  fit(): void {
    if (!this.mounted || !this.root.isConnected || this.root.offsetParent === null) {
      return;
    }
    this.fitAddon.fit();
  }

  writeBase64(data: string): void {
    this.terminal.write(decodeBase64ToBytes(data));
  }

  writeln(text: string): void {
    this.terminal.writeln(text);
  }

  clear(): void {
    this.terminal.clear();
  }

  focus(): void {
    this.terminal.focus();
  }

  getSize(): { cols: number; rows: number } {
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }

  onData(listener: (data: string) => void): void {
    this.terminal.onData(listener);
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
