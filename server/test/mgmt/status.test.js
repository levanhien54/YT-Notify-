import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, upsertVideoIfNew, updateVideoStatus } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, { tunnel, queue, deps } = {}) {
  const app = express();
  app.use(express.json());
  const fakeTunnel = tunnel || { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} };
  const fakeQueue = queue || { enqueue() {} };
  const fakeDeps = deps || { preflight: [] };
  registerMgmtRoutes(app, { db, tunnel: fakeTunnel, queue: fakeQueue, deps: fakeDeps });
  return app;
}

describe('GET /api/status', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('returns tunnel, counts and preflight', async () => {
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
    addChannel(db, { channelId: 'UC2', handle: '@b', title: 'B', thumbnail: 't', secret: 's' });
    upsertVideoIfNew(db, { videoId: 'v1', channelId: 'UC1', title: 'V1', publishedAt: '2026-01-01T00:00:00Z' });
    upsertVideoIfNew(db, { videoId: 'v2', channelId: 'UC1', title: 'V2', publishedAt: '2026-01-02T00:00:00Z' });
    updateVideoStatus(db, 'v1', 'downloading', {});

    const tunnel = { getStatus: () => 'online', getUrl: () => 'https://x.example', start() {}, stop() {} };
    const deps = { preflight: [{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }] };
    const app = makeApp(db, { tunnel, deps });

    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.tunnel).toEqual({ status: 'online', url: 'https://x.example' });
    expect(res.body.counts).toEqual({ channels: 2, videos: 2, downloading: 1 });
    expect(res.body.preflight).toEqual([{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }]);
  });

  it('defaults preflight to empty array and url to null', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.tunnel).toEqual({ status: 'offline', url: null });
    expect(res.body.counts).toEqual({ channels: 0, videos: 0, downloading: 0 });
    expect(res.body.preflight).toEqual([]);
  });
});
