import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { initDb, addChannel, getVideo } from '../../src/db/index.js';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/bootstrap.js';
import { buildSampleAtom, signBody } from '../../../scripts/lib/sampleAtom.js';

const SECRET = 'e2e-secret';
const CHANNEL = 'UC_e2e';
const VIDEO = 'E2EVID';

// Confirm this matches routes.js's invalid-HMAC status (assumed 403; adjust if different).
const WEBHOOK_BAD_HMAC_STATUS = 403;

// fake yt-dlp child: emits one progress line then exits 0
function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 777;
  setTimeout(() => {
    ee.stdout.emit('data', Buffer.from('[download]  100.0% of 1.00MiB\n'));
    ee.emit('close', 0);
  }, 0);
  return ee;
}

describe('e2e: webhook -> db -> queue', () => {
  it('drives a signed notification through the full pipeline', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: CHANNEL, handle: '@e2e', title: 'E2E', thumbnail: '', secret: SECRET });
    const config = loadConfig(db);

    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });

    // Assert enqueue via a spy rather than relying on async 'start' event timing.
    const enqueueSpy = vi.spyOn(app.queue, 'enqueue');

    const xml = buildSampleAtom({ channelId: CHANNEL, videoId: VIDEO, title: 'E2E Video' });
    const res = await request(app.webhookApp)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', signBody(xml, SECRET))
      .send(Buffer.from(xml, 'utf8'));

    expect(res.status).toBe(204);

    // onNewVideo runs async after the 204; flush timers/microtasks.
    await new Promise((r) => setTimeout(r, 20));

    // video persisted by the webhook handler
    const row = getVideo(db, VIDEO);
    expect(row).toBeTruthy();
    expect(row.channel_id).toBe(CHANNEL);
    expect(row.title).toBe('E2E Video');

    // queue picked it up via onNewVideo -> enqueue
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0].video_id).toBe(VIDEO);
  });

  it('rejects an unsigned notification and stores nothing', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: CHANNEL, handle: '@e2e', title: 'E2E', thumbnail: '', secret: SECRET });
    const config = loadConfig(db);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });

    const xml = buildSampleAtom({ channelId: CHANNEL, videoId: 'BADVID', title: 'x' });
    const res = await request(app.webhookApp)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', signBody(xml, 'wrong-secret'))
      .send(Buffer.from(xml, 'utf8'));

    expect(res.status).toBe(WEBHOOK_BAD_HMAC_STATUS);
    expect(getVideo(db, 'BADVID')).toBeUndefined();
  });
});
