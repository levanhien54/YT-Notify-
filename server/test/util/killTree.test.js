import { describe, it, expect, vi } from 'vitest';
import { killTree } from '../../src/util/killTree.js';

describe('killTree', () => {
  it('spawns taskkill with /PID /T /F on win32', () => {
    const spawnFn = vi.fn().mockReturnValue({ on() {}, unref() {} });
    killTree(4242, { platform: 'win32', spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith('taskkill', ['/PID', '4242', '/T', '/F'], expect.any(Object));
  });

  it('does nothing for a falsy pid', () => {
    const spawnFn = vi.fn();
    killTree(undefined, { platform: 'win32', spawnFn });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('uses process group kill on non-win32 (spawnFn unused)', () => {
    const spawnFn = vi.fn();
    const killer = vi.fn();
    const orig = process.kill;
    process.kill = killer;
    try {
      killTree(99, { platform: 'linux', spawnFn });
    } finally {
      process.kill = orig;
    }
    expect(spawnFn).not.toHaveBeenCalled();
    expect(killer).toHaveBeenCalledWith(-99);
  });
});
