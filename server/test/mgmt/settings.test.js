import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, setSetting } from '../../src/db/index.js';
import { DEFAULTS } from '../../src/config.js';
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

describe('GET /api/settings', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('returns DEFAULTS when nothing stored', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.max_concurrency).toBe(DEFAULTS.max_concurrency);
    expect(res.body.download_dir).toBe(DEFAULTS.download_dir);
  });

  it('merges stored values over DEFAULTS', async () => {
    setSetting(db, 'max_concurrency', '5');
    const app = makeApp(db);
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.max_concurrency).toBe('5');
    expect(res.body.webhook_port).toBe(DEFAULTS.webhook_port);
  });
});

describe('PATCH /api/settings', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('persists each key and returns merged settings', async () => {
    const app = makeApp(db);
    const res = await request(app)
      .patch('/api/settings')
      .send({ max_concurrency: '4', download_dir: '/data/dl' });
    expect(res.status).toBe(200);
    expect(res.body.max_concurrency).toBe('4');
    expect(res.body.download_dir).toBe('/data/dl');
    // unspecified keys still default
    expect(res.body.lease_seconds).toBe(DEFAULTS.lease_seconds);

    // persisted across a fresh request
    const res2 = await request(app).get('/api/settings');
    expect(res2.body.max_concurrency).toBe('4');
    expect(res2.body.download_dir).toBe('/data/dl');
  });
});
