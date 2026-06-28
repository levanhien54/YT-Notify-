import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb, addChannel, upsertVideoIfNew, getVideo } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';
import { handleDeleted } from '../../src/websub/onDeleted.js';

const SECRET = 'topsecret';

// Tombstone WITH a resolvable channelId so routes.js can call secretFor(channelId).
const DELETED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:DEL123" when="2026-06-01T00:00:00+00:00">
    <yt:videoId>DEL123</yt:videoId>
    <yt:channelId>UC_del</yt:channelId>
    <link href="https://www.youtube.com/watch?v=DEL123"/>
    <at:by><name>Test Author</name></at:by>
  </at:deleted-entry>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

describe('deleted-entry e2e', () => {
  it('marks an existing video as skipped and does not call onNewVideo', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_del', handle: '@d', title: 'D', thumbnail: '', secret: SECRET });
    upsertVideoIfNew(db, {
      videoId: 'DEL123',
      channelId: 'UC_del',
      title: 'doomed',
      publishedAt: Date.now(),
      updatedAt: Date.now(),
      thumbnailUrl: null,
    });

    const onNewVideo = vi.fn();
    const app = createWebhookApp({
      db,
      secretFor: () => SECRET, // constant secret, independent of channelId
      onNewVideo,
      onDeleted: handleDeleted(db),
    });

    const body = Buffer.from(DELETED_XML, 'utf8');
    const res = await request(app)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(body, SECRET))
      .send(body);

    expect(res.status).toBe(204);
    // onDeleted runs async after response; allow microtask/timer flush
    await new Promise((r) => setTimeout(r, 10));
    expect(getVideo(db, 'DEL123').status).toBe('skipped');
    expect(onNewVideo).not.toHaveBeenCalled();
  });
});
