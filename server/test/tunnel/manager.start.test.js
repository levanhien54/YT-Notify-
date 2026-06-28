// server/test/tunnel/manager.start.test.js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/tunnel/manager.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

describe('TunnelManager.start', () => {
  it('starts as offline before start() is called', () => {
    const tm = new TunnelManager({ port: 8787, spawnFn: vi.fn() });
    expect(tm.getStatus()).toBe('offline');
    expect(tm.getUrl()).toBeNull();
  });

  it('spawns cloudflared with tunnel --url http://localhost:<port>', () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('cloudflared');
    expect(args).toEqual(['tunnel', '--url', 'http://localhost:8787']);
  });

  it('transitions to connecting and emits status on start()', () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    const statuses = [];
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    expect(tm.getStatus()).toBe('connecting');
    expect(statuses).toContain('connecting');
  });

  it('does not spawn twice if start() is called while connecting', () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    tm.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
