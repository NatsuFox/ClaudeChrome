import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
}

export class PtyBridge extends EventEmitter {
  private proc: pty.IPty | null = null;

  spawn(options: PtySpawnOptions): void {
    this.proc = pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
    });

    this.proc.onData((data: string) => {
      this.emit('data', data);
    });

    this.proc.onExit(({ exitCode }) => {
      this.emit('exit', exitCode);
      this.proc = null;
    });
  }

  write(data: string): void {
    this.proc?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.proc?.resize(cols, rows);
  }

  kill(): void {
    this.proc?.kill();
  }

  get alive(): boolean {
    return this.proc !== null;
  }
}
