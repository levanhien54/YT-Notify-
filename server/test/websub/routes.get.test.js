import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { initDb } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';

function makeApp() {
  return createWebhookApp({
    db: initDb(':memory:'),
    secretFor: () => 'irrelevant',
    onNewVideo: () => {},
    onDeleted: () => {},
  });
}

describe('GET /webhook/youtube (verification handshake)', () => {
  it('echoes hub.challenge as text/plain 200 when mode+topic present', async () => {
    const res = await request(makeApp())
      .get('/webhook/youtube')
      .query({
        'hub.mode': 'subscribe',
        'hub.topic': 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1',
        'hub.challenge': 'CHALLENGE_TOKEN_123',
        'hub.lease_seconds': '432000',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('CHALLENGE_TOKEN_123');
  });

  it('returns 404 when hub.mode/hub.topic missing', async () => {
    const res = await request(makeApp())
      .get('/webhook/youtube')
      .query({ 'hub.challenge': 'x' });
    expect(res.status).toBe(404);
  });
});
