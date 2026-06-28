import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { initDb } from '../src/db/index.js';
import { createMgmtApp } from '../src/mgmtApp.js';

function makeApp() {
  const db = initDb(':memory:');
  return createMgmtApp({ db, tunnel: null, queue: null, deps: {} });
}

describe('createMgmtApp', () => {
  it('returns a callable express app (request handler function)', () => {
    const app = makeApp();
    expect(typeof app).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('parses JSON bodies (express.json mounted)', async () => {
    const app = makeApp();
    // Test-only probe route to confirm the JSON parser is active. Not part of
    // the public REST contract; mounted only inside this test.
    app.post('/__echo', (req, res) => res.json(req.body));
    const res = await request(app).post('/__echo').send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ a: 1 });
  });
});
