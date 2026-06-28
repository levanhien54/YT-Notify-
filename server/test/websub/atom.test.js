import { describe, it, expect } from 'vitest';
import { parseAtom } from '../../src/websub/atom.js';

const NEW_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:VID123</id>
    <yt:videoId>VID123</yt:videoId>
    <yt:channelId>UCabc</yt:channelId>
    <title>My New Video</title>
    <author><name>Cool Channel</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:05:00+00:00</updated>
  </entry>
</feed>`;

const DELETED_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:VIDDEL" when="2026-06-28T11:00:00+00:00">
    <link href="https://www.youtube.com/watch?v=VIDDEL"/>
    <at:by><name>Cool Channel</name></at:by>
  </at:deleted-entry>
</feed>`;

describe('parseAtom', () => {
  it('parses a new/updated entry', () => {
    const res = parseAtom(NEW_ENTRY);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toEqual({
      videoId: 'VID123',
      channelId: 'UCabc',
      title: 'My New Video',
      author: 'Cool Channel',
      published: '2026-06-28T10:00:00+00:00',
      updated: '2026-06-28T10:05:00+00:00',
      isDeleted: false,
    });
  });

  it('parses an at:deleted-entry into deleted[] with isDeleted: true', () => {
    const res = parseAtom(DELETED_ENTRY);
    expect(res.entries).toHaveLength(0);
    expect(res.deleted).toHaveLength(1);
    expect(res.deleted[0]).toEqual({
      videoId: 'VIDDEL',
      channelId: null,
      title: null,
      author: null,
      published: null,
      updated: null,
      isDeleted: true,
    });
  });

  it('returns empty entries and deleted arrays for an empty/invalid feed', () => {
    expect(parseAtom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'))
      .toEqual({ entries: [], deleted: [] });
    expect(parseAtom('')).toEqual({ entries: [], deleted: [] });
  });
});
