import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb, addChannel, listVideos } from '../../src/db/index.js';
import { buildTopicUrl } from '../../src/websub/topic.js';
import { runWebhookFlow } from '../../src/webhookFlow.js';

const CHANNEL = 'UCe2e';
const SECRET = 'e2e-secret';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>E2EVID</yt:videoId>
    <yt:channelId>${CHANNEL}</yt:channelId>
    <title>E2E Video</title>
    <author><name>E2E Chan</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:00:00+00:00</updated>
  </entry>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

describe('WebSub end-to-end flow', () => {
  it('verifies the GET challenge then stores a video from a signed POST keyed by the DB secret', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: CHANNEL, handle: '@e2e', title: 'E2E', thumbnail: '', secret: SECRET });

    const { app } = runWebhookFlow({ db });

    // 1) Verification handshake echoes the challenge.
    const getRes = await request(app)
      .get('/webhook/youtube')
      .query({
        'hub.mode': 'subscribe',
        'hub.topic': buildTopicUrl(CHANNEL),
        'hub.challenge': 'E2E_CHALLENGE',
      });
    expect(getRes.status).toBe(200);
    expect(getRes.text).toBe('E2E_CHALLENGE');

    // 2) Signed notification is verified with the channel's DB secret and stored.
    const postRes = await request(app)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, SECRET))
      .send(XML);
    expect(postRes.status).toBe(204);
    await new Promise((r) => setImmediate(r));

    const videos = listVideos(db, { limit: 10 });
    expect(videos).toHaveLength(1);
    expect(videos[0].video_id).toBe('E2EVID');

    // 3) A POST signed with the WRONG secret is rejected.
    const badRes = await request(app)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, 'nope'))
      .send(XML);
    expect(badRes.status).toBe(403);
  });
});
