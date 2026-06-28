import { describe, it, expect, vi } from 'vitest';
import { fetchChannelRss } from '../../src/scheduler/catchup.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>R1</yt:videoId>
    <yt:channelId>UCfeed</yt:channelId>
    <title>Recent One</title>
    <author><name>Feed Chan</name></author>
    <published>2026-06-28T09:00:00+00:00</published>
    <updated>2026-06-28T09:00:00+00:00</updated>
  </entry>
</feed>`;

describe('fetchChannelRss', () => {
  it('GETs the channel feed url and returns parsed entries', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => RSS });
    const entries = await fetchChannelRss('UCfeed', fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCfeed'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].videoId).toBe('R1');
    expect(entries[0].channelId).toBe('UCfeed');
  });

  it('returns [] when the feed responds non-ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    expect(await fetchChannelRss('UCmissing', fetchFn)).toEqual([]);
  });
});
