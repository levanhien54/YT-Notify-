import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb, addChannel, upsertVideoIfNew, getVideo } from '../../src/db/index.js';
import { DownloadQueue } from '../../src/downloader/queue.js';

// Fake child: exposes stdout/stderr emitters to drive output.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

function seedVideo(db) {
  addChannel(db, { channelId: 'UCseed', handle: '@seed', title: 'Seed', thumbnail: null, secret: 's' });
  const { row } = upsertVideoIfNew(db, {
    videoId: 'vid1',
    channelId: 'UCseed',
    title: 'Hello',
    publishedAt: 1000,
    updatedAt: 1000,
    thumbnailUrl: null,
  });
  return row;
}

function seedMany(db, n) {
  addChannel(db, { channelId: 'UCc', handle: '@c', title: 'C', thumbnail: null, secret: 's' });
  const rows = [];
  for (let i = 0; i < n; i++) {
    const { row } = upsertVideoIfNew(db, {
      videoId: `v${i}`, channelId: 'UCc', title: `T${i}`,
      publishedAt: 1000 + i, updatedAt: 1000 + i, thumbnailUrl: null,
    });
    rows.push(row);
  }
  return rows;
}

describe('DownloadQueue single job lifecycle', () => {
  it('emits start, forwards progress, emits done and stores the real file path in db', async () => {
    const db = initDb(':memory:');
    const video = seedVideo(db);

    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);

    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', spawnFn });

    const events = [];
    q.on('start', (e) => events.push(['start', e]));
    q.on('progress', (e) => events.push(['progress', e]));
    const done = new Promise((res) => q.on('done', (e) => { events.push(['done', e]); res(e); }));

    q.enqueue(video);

    // start is emitted once the job is picked up
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1));
    expect(events.find((e) => e[0] === 'start')).toEqual(['start', { videoId: 'vid1' }]);
    expect(getVideo(db, 'vid1').status).toBe('downloading');

    // drive progress + the real destination line yt-dlp prints + success exit
    child.stdout.emit('data', Buffer.from('[download]  42.0% of 10MiB at 1MiB/s ETA 00:05\n'));
    child.stdout.emit('data', Buffer.from('[download] Destination: C:/dl/Seed/Hello [vid1].mp4\n'));
    child.emit('close', 0);

    const doneEvt = await done;
    expect(doneEvt.videoId).toBe('vid1');
    expect(typeof doneEvt.path).toBe('string');
    expect(doneEvt.path).toBe('C:/dl/Seed/Hello [vid1].mp4');

    const prog = events.find((e) => e[0] === 'progress');
    expect(prog[1]).toEqual({ videoId: 'vid1', percent: 42.0 });

    const fresh = getVideo(db, 'vid1');
    expect(fresh.status).toBe('done');
    expect(fresh.download_path).toBe('C:/dl/Seed/Hello [vid1].mp4');
    // the stored path must be a concrete file path, not the unexpanded template
    expect(fresh.download_path).not.toContain('%(');
  });

  it('captures the merged-output path from the [Merger] line when present', async () => {
    const db = initDb(':memory:');
    const video = seedVideo(db);
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', spawnFn });

    const done = new Promise((res) => q.on('done', res));
    q.enqueue(video);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1));

    child.stdout.emit('data', Buffer.from('[download] Destination: C:/dl/Seed/Hello [vid1].f137.mp4\n'));
    child.stdout.emit('data', Buffer.from('[Merger] Merging formats into "C:/dl/Seed/Hello [vid1].mp4"\n'));
    child.emit('close', 0);

    const evt = await done;
    expect(evt.path).toBe('C:/dl/Seed/Hello [vid1].mp4');
    expect(getVideo(db, 'vid1').download_path).toBe('C:/dl/Seed/Hello [vid1].mp4');
  });

  it('spawns yt-dlp with args from buildYtdlpArgs (format selector + url)', async () => {
    const db = initDb(':memory:');
    const video = seedVideo(db);
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', spawnFn });

    q.enqueue(video);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1));

    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('yt-dlp');
    expect(args).toContain('bv*+ba/b');
    expect(args[args.length - 1]).toContain('vid1');
    child.emit('close', 0);
  });

  it('never runs more than `concurrency` jobs at once', async () => {
    const db = initDb(':memory:');
    const rows = seedMany(db, 5);

    const children = [];
    const spawnFn = vi.fn(() => {
      const c = makeFakeChild();
      children.push(c);
      return c;
    });

    const q = new DownloadQueue({ db, concurrency: 2, downloadDir: 'C:/dl', spawnFn });

    let live = 0;
    let maxLive = 0;
    q.on('start', () => { live += 1; maxLive = Math.max(maxLive, live); });
    q.on('done', () => { live -= 1; });

    rows.forEach((r) => q.enqueue(r));

    // After enqueuing 5 with concurrency 2, only 2 should be spawned.
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2));
    expect(maxLive).toBe(2);

    // Complete the first two -> the next two should start.
    children[0].emit('close', 0);
    children[1].emit('close', 0);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(4));
    expect(maxLive).toBe(2);

    // Complete remaining.
    children[2].emit('close', 0);
    children[3].emit('close', 0);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(5));
    children[4].emit('close', 0);

    await vi.waitFor(() => {
      expect(getVideo(db, 'v4').status).toBe('done');
      expect(live).toBe(0);
    });
    expect(maxLive).toBe(2);
  });
});
