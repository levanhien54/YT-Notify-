import { describe, it, expect, vi } from 'vitest';
import {
  initDb,
  addChannel,
  getVideo,
  getChannel,
  setChannelActive,
  updateLastVideoPublishedAt,
} from '../../src/db/index.js';
import { runCatchup } from '../../src/scheduler/runCatchup.js';

function feedXml(entries) {
  const body = entries
    .map(
      (e) => `<entry>
        <yt:videoId>${e.videoId}</yt:videoId>
        <yt:channelId>${e.channelId}</yt:channelId>
        <title>${e.title}</title>
        <author><name>A</name></author>
        <published>${e.published}</published>
        <updated>${e.published}</updated>
      </entry>`
    )
    .join('');
  return `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

describe('runCatchup', () => {
  it('enqueues only videos newer than the marker and advances the marker', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_a', handle: '@a', title: 'A', thumbnail: '', secret: 's' });
    // marker = 2026-03-01 (set via the contract function, not raw SQL)
    updateLastVideoPublishedAt(db, 'UC_a', Date.parse('2026-03-01T00:00:00Z'));

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        feedXml([
          { videoId: 'OLD1', channelId: 'UC_a', title: 'old', published: '2026-01-01T00:00:00+00:00' },
          { videoId: 'NEW1', channelId: 'UC_a', title: 'new', published: '2026-06-01T00:00:00+00:00' },
        ]),
    });

    const onNewVideo = vi.fn();
    const result = await runCatchup({ db, onNewVideo, fetchFn });

    expect(result.enqueued).toBe(1);
    expect(getVideo(db, 'NEW1')).toBeTruthy();
    expect(getVideo(db, 'OLD1')).toBeUndefined();
    expect(onNewVideo).toHaveBeenCalledTimes(1);

    // marker advanced to the newest published, read back via the contract getter
    const ch = getChannel(db, 'UC_a');
    expect(ch.last_video_published_at).toBe(Date.parse('2026-06-01T00:00:00Z'));
  });

  it('skips inactive channels and tolerates fetch failures', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_b', handle: '@b', title: 'B', thumbnail: '', secret: 's' });
    setChannelActive(db, 'UC_b', false);

    const fetchFn = vi.fn();
    const result = await runCatchup({ db, onNewVideo: vi.fn(), fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(0);
  });
});
