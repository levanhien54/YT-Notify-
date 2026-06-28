import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';

function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 1;
  return ee;
}

describe('wireReconnectCatchup', () => {
  it('runs catch-up when the tunnel goes online', async () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const catchupFn = vi.fn().mockResolvedValue({ enqueued: 0 });
    const app = buildApp({
      db,
      config,
      spawnFn: () => fakeSpawn(),
      fetchFn: vi.fn(),
      catchupFn,
    });

    app.wireReconnectCatchup();
    app.tunnel.emit('status', 'connecting');
    expect(catchupFn).not.toHaveBeenCalled();

    app.tunnel.emit('status', 'online');
    expect(catchupFn).toHaveBeenCalledTimes(1);
    const arg = catchupFn.mock.calls[0][0];
    expect(arg.db).toBe(db);
    expect(typeof arg.onNewVideo).toBe('function');
  });

  it('does not double-run while already online', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const catchupFn = vi.fn().mockResolvedValue({ enqueued: 0 });
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn(), catchupFn });

    app.wireReconnectCatchup();
    app.tunnel.emit('status', 'online');
    app.tunnel.emit('status', 'online');
    expect(catchupFn).toHaveBeenCalledTimes(1);

    // a drop then re-online triggers a fresh run
    app.tunnel.emit('status', 'offline');
    app.tunnel.emit('status', 'online');
    expect(catchupFn).toHaveBeenCalledTimes(2);
  });
});
