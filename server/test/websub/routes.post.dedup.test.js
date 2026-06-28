import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb, addChannel, listVideos } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';

const SECRET = 'chan-secret';
const NEW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>DUPVID</yt:videoId>
    <yt:channelId>UCdup</yt:channelId>
    <title>First Title</title>
    <author><name>Chan</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:00:00+00:00</updated>
  </entry>
</feed>`;

// Same videoId, later updated -> metadata update, must NOT create a second video
const UPDATE_XML = NEW_XML.replace('First Title', 'Edited Title')
  .replace('10:00:00+00:00</updated>', '12:00:00+00:00</updated>');

const DELETE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:DUPVID" when="2026-06-28T13:00:00+00:00"/>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

function post(app, xml) {
  return request(app)
    .post('/webhook/youtube')
    .set('Content-Type', 'application/atom+xml')
    .set('X-Hub-Signature', sign(xml, SECRET))
    .send(xml);
}

// secretFor keyed by channelId -> proves tombstone channelId recovery works for signed deletes.
function makeApp(db, { onNewVideo = () => {}, onDeleted = () => {} } = {}) {
  return createWebhookApp({
    db,
    secretFor: (id) => (id === 'UCdup' ? SECRET : undefined),
    onNewVideo,
    onDeleted,
  });
}

describe('POST /webhook/youtube dedup + callbacks', () => {
  it('stores a new video once and fires onNewVideo with the row; re-POST does not duplicate or re-fire', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UCdup', handle: '@d', title: 'D', thumbnail: '', secret: SECRET });
    const onNewVideo = vi.fn();
    const app = makeApp(db, { onNewVideo });

    const r1 = await post(app, NEW_XML);
    expect(r1.status).toBe(204);
    await new Promise((r) => setImmediate(r)); // let scheduled callbacks run

    expect(listVideos(db, { limit: 100 })).toHaveLength(1);
    expect(onNewVideo).toHaveBeenCalledTimes(1);
    expect(onNewVideo.mock.calls[0][0].video_id).toBe('DUPVID');

    // Metadata-only update for the SAME videoId -> still one video, no new onNewVideo
    const r2 = await post(app, UPDATE_XML);
    expect(r2.status).toBe(204);
    await new Promise((r) => setImmediate(r));

    expect(listVideos(db, { limit: 100 })).toHaveLength(1);
    expect(onNewVideo).toHaveBeenCalledTimes(1);
  });

  it('verifies a SIGNED delete via per-channel secret (recovered channelId) and fires onDeleted', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UCdup', handle: '@d', title: 'D', thumbnail: '', secret: SECRET });
    const onDeleted = vi.fn();
    const app = makeApp(db, { onDeleted });

    // Store the video first so the tombstone's channelId can be recovered from the DB.
    await post(app, NEW_XML);
    await new Promise((r) => setImmediate(r));

    const res = await post(app, DELETE_XML);
    expect(res.status).toBe(204); // 403 here would prove secretFor got channelId:null
    await new Promise((r) => setImmediate(r));

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith('DUPVID');
  });
});
