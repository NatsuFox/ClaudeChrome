import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

export class TerminalView {
  readonly root: HTMLDivElement;

  private readonly terminal: Terminal;
  private readonly fitAddon: FitAddon;
  private mounted = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'pane-terminal';

    this.terminal = new Terminal({
      fontFamily: "'Menlo', 'Consolas', 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
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

  fit(): void {
    if (!this.mounted || !this.root.isConnected || this.root.offsetParent === null) {
      return;
    }
    this.fitAddon.fit();
  }

  writeBase64(data: string): void {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    this.terminal.write(bytes);
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
