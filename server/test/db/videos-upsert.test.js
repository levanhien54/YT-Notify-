import { describe, it, expect } from 'vitest';
import { initDb, upsertVideoIfNew, getVideo, listVideos } from '../../src/db/index.js';

const v = {
  videoId: 'vid1',
  channelId: 'UC1',
  title: 'First',
  publishedAt: 2000,
  updatedAt: 2000,
  thumbnailUrl: 'http://t/1.jpg'
};

describe('upsertVideoIfNew', () => {
  it('inserts a new video with isNew=true and status new', () => {
    const db = initDb(':memory:');
    const { row, isNew } = upsertVideoIfNew(db, v);
    expect(isNew).toBe(true);
    expect(row.video_id).toBe('vid1');
    expect(row.status).toBe('new');
    expect(row.retries).toBe(0);
  });

  it('second call with same videoId reports isNew=false (metadata-only update)', () => {
    const db = initDb(':memory:');
    upsertVideoIfNew(db, v);
    const { row, isNew } = upsertVideoIfNew(db, { ...v, title: 'Edited', updatedAt: 3000 });
    expect(isNew).toBe(false);
    expect(row.title).toBe('Edited');
    expect(row.updated_at).toBe(3000);
    expect(row.status).toBe('new'); // status untouched -> no re-download
  });

  it('getVideo returns row or undefined', () => {
    const db = initDb(':memory:');
    upsertVideoIfNew(db, v);
    expect(getVideo(db, 'vid1').title).toBe('First');
    expect(getVideo(db, 'nope')).toBeUndefined();
  });

  it('listVideos returns newest first, limited', () => {
    const db = initDb(':memory:');
    upsertVideoIfNew(db, { ...v, videoId: 'a', publishedAt: 100 });
    upsertVideoIfNew(db, { ...v, videoId: 'b', publishedAt: 300 });
    upsertVideoIfNew(db, { ...v, videoId: 'c', publishedAt: 200 });
    const rows = listVideos(db, { limit: 2 });
    expect(rows.map((r) => r.video_id)).toEqual(['b', 'c']);
  });
});
