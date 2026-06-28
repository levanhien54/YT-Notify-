// server/test/tunnel/manager.exit.test.js
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

describe('TunnelManager child exit', () => {
  it('goes offline and clears url when child exits', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const statuses = [];
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://will-die-aaa.trycloudflare.com\n'));
    expect(tm.getStatus()).toBe('online');

    child.emit('exit', 0, null);
    expect(tm.getStatus()).toBe('offline');
    expect(tm.getUrl()).toBeNull();
    expect(statuses[statuses.length - 1]).toBe('offline');
  });

  it('allows start() again after the child exits (spawns a fresh child)', () => {
    const first = makeFakeChild();
    const second = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    first.emit('exit', 1, null);
    tm.start();
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(tm.getStatus()).toBe('connecting');
  });

  it('parses a new url from the second child after a reconnect cycle', () => {
    const first = makeFakeChild();
    const second = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    const urls = [];
    tm.on('url', (u) => urls.push(u));
    tm.start();
    first.stderr.emit('data', Buffer.from('https://old-aaa.trycloudflare.com\n'));
    first.emit('exit', 0, null);
    tm.start();
    second.stderr.emit('data', Buffer.from('https://new-bbb.trycloudflare.com\n'));
    expect(urls).toEqual([
      'https://old-aaa.trycloudflare.com',
      'https://new-bbb.trycloudflare.com',
    ]);
    expect(tm.getUrl()).toBe('https://new-bbb.trycloudflare.com');
  });
});
