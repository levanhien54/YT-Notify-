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
    resolveChannelId: async () => 'UCnew',
    sendSubscription: async () => ({ ok: true, status: 202 }),
    hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: 432000,
    fetchFn: () => {},
    genSecret: () => 'deadbeef',
    preflight: [],
    ...overrides,
  };
}

describe('GET /api/channels', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('returns all channels', async () => {
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].channelId).toBe('UC1');
  });
});

describe('POST /api/channels', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('400 when input missing', async () => {
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).post('/api/channels').send({});
    expect(res.status).toBe(400);
  });

  it('503 when tunnel has no url', async () => {
    const tunnel = { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} };
    const app = makeApp(db, { tunnel, deps: baseDeps() });
    const res = await request(app).post('/api/channels').send({ input: '@whatever' });
    expect(res.status).toBe(503);
  });

  it('409 when channel already exists', async () => {
    addChannel(db, { channelId: 'UCnew', handle: '@x', title: 'X', thumbnail: 't', secret: 's' });
    const app = makeApp(db, { deps: baseDeps({ resolveChannelId: async () => 'UCnew' }) });
    const res = await request(app).post('/api/channels').send({ input: '@x' });
    expect(res.status).toBe(409);
  });

  it('resolves, adds channel, subscribes, returns channel', async () => {
    const calls = [];
    const deps = baseDeps({
      resolveChannelId: async (input, opts) => { calls.push(['resolve', input]); return 'UCnew'; },
      sendSubscription: async (args) => { calls.push(['sub', args]); return { ok: true, status: 202 }; },
      genSecret: () => 'deadbeef',
    });
    const app = makeApp(db, { deps });
    const res = await request(app).post('/api/channels').send({ input: '@new' });

    expect(res.status).toBe(200);
    expect(res.body.channelId).toBe('UCnew');
    expect(res.body.secret).toBe('deadbeef');
    // persisted
    expect(getChannel(db, 'UCnew')).toBeTruthy();
    // subscription sent with correct args
    const subCall = calls.find((c) => c[0] === 'sub')[1];
    expect(subCall.mode).toBe('subscribe');
    expect(subCall.channelId).toBe('UCnew');
    expect(subCall.secret).toBe('deadbeef');
    expect(subCall.callbackUrl).toBe('https://t.example/webhook/youtube');
    expect(subCall.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(subCall.leaseSeconds).toBe(432000);
  });
});
