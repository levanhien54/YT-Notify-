import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';

const SECRET = 'chan-secret';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>VIDX</yt:videoId>
    <yt:channelId>UCsig</yt:channelId>
    <title>Sig Test</title>
    <author><name>Chan</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:00:00+00:00</updated>
  </entry>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

// secretFor keyed by channelId (proves per-channel secret resolution, not an arg-ignoring stub)
function makeApp() {
  return createWebhookApp({
    db: initDb(':memory:'),
    secretFor: (id) => (id === 'UCsig' ? SECRET : undefined),
    onNewVideo: () => {},
    onDeleted: () => {},
  });
}

describe('POST /webhook/youtube HMAC enforcement', () => {
  it('rejects with 403 when signature is invalid', async () => {
    const res = await request(makeApp())
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, 'WRONG_SECRET'))
      .send(XML);
    expect(res.status).toBe(403);
  });

  it('rejects with 403 when signature header is missing', async () => {
    const res = await request(makeApp())
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .send(XML);
    expect(res.status).toBe(403);
  });

  it('accepts (204) when signature is valid and secretFor resolves the channel', async () => {
    const res = await request(makeApp())
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, SECRET))
      .send(XML);
    expect(res.status).toBe(204);
  });
});
