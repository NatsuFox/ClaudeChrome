import * as pty from 'node-pty';
import { execFile, execFileSync } from 'node:child_process';
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
  private pendingCleanupPid: number | null = null;
  private processExitCleanupHandler: (() => void) | null = null;

  spawn(options: PtySpawnOptions): void {
    this.clearForceKillTimer();
    this.pendingCleanupPid = null;
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
      const exitedPid = this.proc?.pid ?? null;
      if (exitedPid != null) {
        this.cleanupExitedProcessTree(exitedPid);
      } else {
        this.clearForceKillTimer();
        this.pendingCleanupPid = null;
      }
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
    this.pendingCleanupPid = pid;
    this.terminateProcessTree(pid, 'SIGTERM');
    this.scheduleForceKill(pid);
  }

  get alive(): boolean {
    return this.proc !== null;
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  private cleanupExitedProcessTree(pid: number): void {
    if (this.pendingCleanupPid !== pid) {
      this.pendingCleanupPid = pid;
      this.terminateProcessTree(pid, 'SIGTERM');
      this.scheduleForceKill(pid);
      return;
    }

    this.terminateProcessTree(pid, 'SIGTERM');
  }

  private scheduleForceKill(pid: number): void {
    this.clearForceKillTimer();
    this.pendingCleanupPid = pid;
    this.armProcessExitCleanup(pid);
    this.forceKillTimer = setTimeout(() => {
      if (this.pendingCleanupPid === pid) {
        this.terminateProcessTree(pid, 'SIGKILL');
        this.pendingCleanupPid = null;
      }
      this.clearForceKillTimer();
    }, PROCESS_TREE_KILL_GRACE_MS);
  }

  private armProcessExitCleanup(pid: number): void {
    this.clearProcessExitCleanup();
    this.processExitCleanupHandler = () => {
      if (this.pendingCleanupPid === pid) {
        this.terminateProcessTree(pid, 'SIGKILL');
      }
    };
    process.once('exit', this.processExitCleanupHandler);
  }

  private clearProcessExitCleanup(): void {
    if (!this.processExitCleanupHandler) {
      return;
    }
    process.off('exit', this.processExitCleanupHandler);
    this.processExitCleanupHandler = null;
  }

  private clearForceKillTimer(): void {
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    this.clearProcessExitCleanup();
  }

  private collectUnixProcessTreeTargets(pid: number): { pids: number[]; processGroups: number[] } {
    try {
      const output = execFileSync('ps', ['-eo', 'pid=,ppid=,pgid='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const childrenByParent = new Map<number, number[]>();
      const processGroupByPid = new Map<number, number>();

      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [pidValue, parentValue, processGroupValue] = trimmed.split(/\s+/).map((value) => Number.parseInt(value, 10));
        if (!Number.isFinite(pidValue) || !Number.isFinite(parentValue) || !Number.isFinite(processGroupValue)) {
          continue;
        }
        if (!childrenByParent.has(parentValue)) {
          childrenByParent.set(parentValue, []);
        }
        childrenByParent.get(parentValue)?.push(pidValue);
        processGroupByPid.set(pidValue, processGroupValue);
      }

      const queue = [pid];
      const visited = new Set<number>();
      while (queue.length > 0) {
        const current = queue.shift();
        if (current == null || visited.has(current)) {
          continue;
        }
        visited.add(current);
        const children = childrenByParent.get(current) || [];
        queue.push(...children);
      }

      const processGroups = new Set<number>();
      for (const currentPid of visited) {
        const processGroup = processGroupByPid.get(currentPid);
        if (typeof processGroup === 'number' && processGroup > 0) {
          processGroups.add(processGroup);
        }
      }

      if (processGroups.size === 0) {
        processGroups.add(pid);
      }

      return {
        pids: Array.from(visited),
        processGroups: Array.from(processGroups),
      };
    } catch {
      return { pids: [pid], processGroups: [pid] };
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

    const { pids, processGroups } = this.collectUnixProcessTreeTargets(pid);
    for (const processGroup of processGroups) {
      try {
        process.kill(-processGroup, signal);
      } catch {
        // Ignore missing process groups and continue with per-process cleanup.
      }
    }

    for (const processId of pids) {
      try {
        process.kill(processId, signal);
      } catch {
        // Ignore races with natural process exit.
      }
    }
  }
}
