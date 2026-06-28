import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb } from '../../src/db/index.js';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/bootstrap.js';
import { wireRealtime } from '../../src/realtime/bus.js';

function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 1;
  return ee;
}

function fakeIo() {
  const emit = vi.fn();
  return { emit };
}

describe('wireRealtime forwards bootstrap emitters', () => {
  it('forwards queue and tunnel events to socket.io with contract payloads', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });
    const io = fakeIo();

    wireRealtime(io, { tunnel: app.tunnel, queue: app.queue });

    app.queue.emit('start', { videoId: 'V1' });
    app.queue.emit('progress', { videoId: 'V1', percent: 42 });
    app.queue.emit('done', { videoId: 'V1', path: 'C:\\dl\\V1.mp4' });
    app.queue.emit('failed', { videoId: 'V2', error: 'boom' });
    // a freshly-constructed (never started) tunnel reports getStatus()==='offline', getUrl()===null
    app.tunnel.emit('status', 'online');

    const names = io.emit.mock.calls.map((c) => c[0]);
    expect(names).toContain('download:start');
    expect(names).toContain('download:progress');
    expect(names).toContain('download:done');
    expect(names).toContain('download:failed');
    expect(names).toContain('tunnel:status');

    const progressCall = io.emit.mock.calls.find((c) => c[0] === 'download:progress');
    expect(progressCall[1]).toEqual({ videoId: 'V1', percent: 42 });

    // explicit tunnel:status payload assertion – uses the EMITTED status arg + getUrl()
    const statusCall = io.emit.mock.calls.find((c) => c[0] === 'tunnel:status');
    expect(statusCall[1]).toEqual({ status: 'online', url: null });
  });
});
