import * as pty from 'node-pty';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

const PROCESS_TREE_KILL_GRACE_MS = 2_000;

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
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null;

  spawn(options: PtySpawnOptions): void {
    this.clearForceKillTimer();
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
      this.clearForceKillTimer();
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
    const proc = this.proc;
    if (!proc) {
      return;
    }

    const pid = proc.pid;
    this.terminateProcessTree(pid, 'SIGTERM');
    this.scheduleForceKill(pid);
  }

  get alive(): boolean {
    return this.proc !== null;
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  private scheduleForceKill(pid: number): void {
    this.clearForceKillTimer();
    this.forceKillTimer = setTimeout(() => {
      if (this.proc?.pid !== pid) {
        this.clearForceKillTimer();
        return;
      }
      this.terminateProcessTree(pid, 'SIGKILL');
      this.clearForceKillTimer();
    }, PROCESS_TREE_KILL_GRACE_MS);
  }

  private clearForceKillTimer(): void {
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
  }

  private terminateProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (pid <= 0) {
      return;
    }

    if (process.platform === 'win32') {
      const args = ['/pid', String(pid), '/T'];
      if (signal === 'SIGKILL') {
        args.push('/F');
      }
      execFile('taskkill', args, () => undefined);
      return;
    }

    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to the direct child kill when the process group is unavailable.
    }

    try {
      process.kill(pid, signal);
    } catch {
      // Ignore races with natural process exit.
    }
  }
}
