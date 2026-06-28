// server/test/tunnel/manager.output.test.js
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

describe('TunnelManager output parsing', () => {
  it('emits log for each line received on stderr', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const logs = [];
    tm.on('log', (l) => logs.push(l));
    tm.start();
    child.stderr.emit('data', Buffer.from('INF Starting tunnel\nINF Registered tunnel connection\n'));
    expect(logs).toContain('INF Starting tunnel');
    expect(logs).toContain('INF Registered tunnel connection');
  });

  it('emits url and goes online when a tunnel url appears on stderr', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const urls = [];
    const statuses = [];
    tm.on('url', (u) => urls.push(u));
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    child.stderr.emit('data', Buffer.from('|  https://happy-cat-test.trycloudflare.com  |\n'));
    expect(urls).toEqual(['https://happy-cat-test.trycloudflare.com']);
    expect(tm.getUrl()).toBe('https://happy-cat-test.trycloudflare.com');
    expect(tm.getStatus()).toBe('online');
    expect(statuses).toContain('online');
  });

  it('also parses urls arriving on stdout', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    tm.start();
    child.stdout.emit('data', Buffer.from('https://from-stdout.trycloudflare.com\n'));
    expect(tm.getUrl()).toBe('https://from-stdout.trycloudflare.com');
    expect(tm.getStatus()).toBe('online');
  });

  it('emits url every time a NEW url appears (ephemeral reconnect)', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const urls = [];
    tm.on('url', (u) => urls.push(u));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://first-aaa.trycloudflare.com\n'));
    child.stderr.emit('data', Buffer.from('https://second-bbb.trycloudflare.com\n'));
    expect(urls).toEqual([
      'https://first-aaa.trycloudflare.com',
      'https://second-bbb.trycloudflare.com',
    ]);
    expect(tm.getUrl()).toBe('https://second-bbb.trycloudflare.com');
  });

  it('does not re-emit url when the same url is parsed twice in a row', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const urls = [];
    tm.on('url', (u) => urls.push(u));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://same-aaa.trycloudflare.com\n'));
    child.stderr.emit('data', Buffer.from('https://same-aaa.trycloudflare.com\n'));
    expect(urls).toEqual(['https://same-aaa.trycloudflare.com']);
  });

  it('handles a chunk split across two data events (line buffering)', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    tm.start();
    child.stderr.emit('data', Buffer.from('https://split-cccc'));
    child.stderr.emit('data', Buffer.from('.trycloudflare.com\n'));
    expect(tm.getUrl()).toBe('https://split-cccc.trycloudflare.com');
  });
});
