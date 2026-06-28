import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, upsertVideoIfNew } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel: { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: { preflight: [] },
  });
  return app;
}

describe('GET /api/videos', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
  });

  it('returns videos newest first with default limit 50', async () => {
    for (let i = 0; i < 60; i++) {
      upsertVideoIfNew(db, {
        videoId: `v${i}`,
        channelId: 'UC1',
        title: `V${i}`,
        publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      });
    }
    const app = makeApp(db);
    const res = await request(app).get('/api/videos');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(50);
    expect(res.body[0].videoId).toBe('v59');
  });

  it('honors explicit limit query param', async () => {
    upsertVideoIfNew(db, { videoId: 'a', channelId: 'UC1', title: 'A', publishedAt: '2026-01-01T00:00:00Z' });
    upsertVideoIfNew(db, { videoId: 'b', channelId: 'UC1', title: 'B', publishedAt: '2026-01-02T00:00:00Z' });
    const app = makeApp(db);
    const res = await request(app).get('/api/videos?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].videoId).toBe('b');
  });
});
