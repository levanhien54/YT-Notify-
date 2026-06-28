import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, getChannel } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, { tunnel, deps } = {}) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel: tunnel || { getStatus: () => 'online', getUrl: () => 'https://t.example', start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: deps || {},
  });
  return app;
}

function baseDeps(overrides = {}) {
  return {
    resolveChannelId: async () => 'UCx',
    sendSubscription: async () => ({ ok: true, status: 202 }),
    hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: 432000,
    fetchFn: () => {},
    genSecret: () => 'deadbeef',
    preflight: [],
    ...overrides,
  };
}

describe('PATCH /api/channels/:id', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 'sek' });
  });

  it('active=false unsubscribes and returns inactive channel', async () => {
    const calls = [];
    const deps = baseDeps({ sendSubscription: async (a) => { calls.push(a); return { ok: true, status: 202 }; } });
    const app = makeApp(db, { deps });
    const res = await request(app).patch('/api/channels/UC1').send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
    expect(calls[0].mode).toBe('unsubscribe');
    expect(calls[0].channelId).toBe('UC1');
    expect(calls[0].secret).toBe('sek');
    expect(calls[0].callbackUrl).toBe('https://t.example/webhook/youtube');
  });

  it('active=true subscribes and returns active channel', async () => {
    const calls = [];
    const deps = baseDeps({ sendSubscription: async (a) => { calls.push(a); return { ok: true, status: 202 }; } });
    const app = makeApp(db, { deps });
    const res = await request(app).patch('/api/channels/UC1').send({ active: true });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(1);
    expect(calls[0].mode).toBe('subscribe');
  });

  it('404 for unknown channel', async () => {
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).patch('/api/channels/NOPE').send({ active: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/channels/:id', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 'sek' });
  });

  it('unsubscribes then removes and returns 204', async () => {
    const calls = [];
    const deps = baseDeps({ sendSubscription: async (a) => { calls.push(a); return { ok: true, status: 202 }; } });
    const app = makeApp(db, { deps });
    const res = await request(app).delete('/api/channels/UC1');
    expect(res.status).toBe(204);
    expect(calls[0].mode).toBe('unsubscribe');
    expect(calls[0].channelId).toBe('UC1');
    expect(getChannel(db, 'UC1')).toBeUndefined();
  });

  it('404 for unknown channel', async () => {
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).delete('/api/channels/NOPE');
    expect(res.status).toBe(404);
  });
});
