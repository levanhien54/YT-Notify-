import { describe, it, expect } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createWebhookApp } from '../src/webhookApp.js';

function makeApp() {
  const db = initDb(':memory:');
  return createWebhookApp({
    db,
    secretFor: () => 'secret',
    onNewVideo: () => {},
    onDeleted: () => {}
  });
}

describe('createWebhookApp', () => {
  it('returns a callable express app (request handler function)', () => {
    const app = makeApp();
    expect(typeof app).toBe('function');
    expect(typeof app.use).toBe('function');
  });
});
