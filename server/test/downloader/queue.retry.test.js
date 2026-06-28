import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb, addChannel, upsertVideoIfNew, getVideo } from '../../src/db/index.js';
import { DownloadQueue } from '../../src/downloader/queue.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function seedOne(db) {
  addChannel(db, { channelId: 'UCr', handle: '@r', title: 'R', thumbnail: null, secret: 's' });
  const { row } = upsertVideoIfNew(db, {
    videoId: 'vr', channelId: 'UCr', title: 'Retry me',
    publishedAt: 1000, updatedAt: 1000, thumbnailUrl: null,
  });
  return row;
}

// Flush pending microtasks so synchronously-emitted child events are processed.
const flush = () => Promise.resolve();

describe('DownloadQueue retry/backoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries on non-zero exit up to maxRetries, then emits failed', async () => {
    const db = initDb(':memory:');
    const video = seedOne(db);

    const children = [];
    const spawnFn = vi.fn(() => {
      const c = makeFakeChild();
      children.push(c);
      return c;
    });

    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', maxRetries: 2, spawnFn });

    const failed = [];
    q.on('failed', (e) => failed.push(e));

    // attempt 1 spawns synchronously inside enqueue() -> _pump() -> _run().
    q.enqueue(video);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // attempt 1 fails -> incrementRetries=1, requeued after 1000ms backoff.
    children[0].stderr.emit('data', Buffer.from('ERROR: video unavailable'));
    children[0].emit('close', 1);
    expect(getVideo(db, 'vr').status).toBe('queued');
    expect(getVideo(db, 'vr').retries).toBe(1);

    // advance past backoff -> requeue callback runs -> attempt 2 spawns.
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawnFn.mock.calls.length).toBe(2);

    // attempt 2 fails -> retries=2 (== maxRetries) -> backoff 2000ms then attempt 3.
    children[1].emit('close', 1);
    expect(getVideo(db, 'vr').retries).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(spawnFn.mock.calls.length).toBe(3);

    // attempt 3 fails -> retries=3 (> maxRetries) -> failed, no more spawns.
    children[2].emit('close', 1);
    await flush();
    expect(getVideo(db, 'vr').status).toBe('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].videoId).toBe('vr');
    expect(failed[0].error).toMatch(/exited 1|unavailable/);
    expect(getVideo(db, 'vr').retries).toBe(3);
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });

  it('marks failed and emits when the child errors and retries are exhausted', async () => {
    const db = initDb(':memory:');
    const video = seedOne(db);
    const children = [];
    const spawnFn = vi.fn(() => { const c = makeFakeChild(); children.push(c); return c; });
    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', maxRetries: 0, spawnFn });

    const failed = [];
    q.on('failed', (e) => failed.push(e));

    q.enqueue(video);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    children[0].emit('error', new Error('ENOENT: yt-dlp not found'));
    await flush();

    expect(getVideo(db, 'vr').status).toBe('failed');
    expect(failed[0].error).toMatch(/ENOENT/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
