import { spawn } from 'node:child_process';

export function killTree(pid, { platform = process.platform, spawnFn = spawn } = {}) {
  if (!pid) return;
  if (platform === 'win32') {
    spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  // Non-win32: kill the process group directly; spawnFn is unused on this path.
  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {
      /* already dead */
    }
  }
}
