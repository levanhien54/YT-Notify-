import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { initDb, addChannel } from '../../src/db/index.js';
import { createMgmtApp } from '../../src/mgmtApp.js';

function deps(overrides = {}) {
  return {
    config: {},
    resolveChannelId: async () => 'UCx',
    sendSubscription: async () => ({ ok: true, status: 202 }),
    hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: 432000,
    fetchFn: () => {},
    preflight: [{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }],
    ...overrides,
  };
}

function makeApp(db) {
  return createMgmtApp({
    db,
    tunnel: { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: deps(),
  });
}

describe('createMgmtApp wiring', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('exposes the api routes via registerMgmtRoutes', async () => {
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
    const app = makeApp(db);
    const res = await request(app).get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('surfaces preflight through /api/status', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.preflight).toEqual([{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }]);
  });

  it('sets app.locals.deps including db, tunnel, queue and spread deps', () => {
    const app = makeApp(db);
    expect(app.locals.deps.db).toBe(db);
    expect(app.locals.deps.tunnel).toBeTruthy();
    expect(app.locals.deps.queue).toBeTruthy();
    expect(app.locals.deps.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
  });

  it('returns 404 for unknown non-api routes when no client build exists', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/totally-unknown-page');
    expect(res.status).toBe(404);
  });
});
