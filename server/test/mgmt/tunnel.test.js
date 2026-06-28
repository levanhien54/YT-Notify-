import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, tunnel) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel,
    queue: { enqueue() {} },
    deps: { preflight: [] },
  });
  return app;
}

describe('tunnel control routes', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('POST /api/tunnel/start calls tunnel.start and returns 202', async () => {
    let started = 0;
    const tunnel = { getStatus: () => 'offline', getUrl: () => null, start() { started++; }, stop() {} };
    const app = makeApp(db, tunnel);
    const res = await request(app).post('/api/tunnel/start');
    expect(res.status).toBe(202);
    expect(started).toBe(1);
  });

  it('POST /api/tunnel/stop calls tunnel.stop and returns 202', async () => {
    let stopped = 0;
    const tunnel = { getStatus: () => 'online', getUrl: () => 'u', start() {}, stop() { stopped++; } };
    const app = makeApp(db, tunnel);
    const res = await request(app).post('/api/tunnel/stop');
    expect(res.status).toBe(202);
    expect(stopped).toBe(1);
  });
});
