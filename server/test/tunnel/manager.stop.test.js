// server/test/tunnel/manager.stop.test.js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/tunnel/manager.js';

function makeFakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = pid;
  return child;
}

describe('TunnelManager.stop', () => {
  it('runs taskkill with the child pid via the injected spawnFn', () => {
    const child = makeFakeChild(9001);
    const spawnCalls = [];
    const spawnFn = vi.fn((cmd, args) => {
      spawnCalls.push([cmd, args]);
      return child;
    });
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    spawnCalls.length = 0; // ignore the cloudflared spawn
    tm.stop();
    expect(spawnCalls).toEqual([['taskkill', ['/PID', '9001', '/T', '/F']]]);
  });

  it('sets status offline and clears url after stop()', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const statuses = [];
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://bye-aaa.trycloudflare.com\n'));
    tm.stop();
    expect(tm.getStatus()).toBe('offline');
    expect(tm.getUrl()).toBeNull();
    expect(statuses[statuses.length - 1]).toBe('offline');
  });

  it('is a no-op (no kill, stays offline) when no child is running', () => {
    const spawnFn = vi.fn();
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.stop();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(tm.getStatus()).toBe('offline');
  });

  it('does not double-fire offline when the child later emits exit after stop()', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const offlineCount = [];
    tm.on('status', (s) => { if (s === 'offline') offlineCount.push(s); });
    tm.start();
    tm.stop();
    child.emit('exit', 0, null); // late exit from the killed process
    expect(offlineCount.length).toBe(1);
  });

  it('default kill behavior spawns taskkill /PID <pid> /T /F', () => {
    const child = makeFakeChild(7777);
    const spawnCalls = [];
    const spawnFn = vi.fn((cmd, args) => {
      spawnCalls.push([cmd, args]);
      return child;
    });
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    spawnCalls.length = 0; // ignore the cloudflared spawn
    tm.stop();
    expect(spawnCalls.length).toBe(1);
    const [cmd, args] = spawnCalls[0];
    expect(cmd).toBe('taskkill');
    expect(args).toEqual(['/PID', '7777', '/T', '/F']);
  });
});
