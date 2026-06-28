import { describe, it, expect } from 'vitest';
import {
  initDb, upsertVideoIfNew, getVideo,
  updateVideoStatus, incrementRetries
} from '../../src/db/index.js';

function seed(db) {
  upsertVideoIfNew(db, {
    videoId: 'vid1', channelId: 'UC1', title: 'T',
    publishedAt: 1, updatedAt: 1, thumbnailUrl: ''
  });
}

describe('video status + retries', () => {
  it('updateVideoStatus sets status and optional downloadPath', () => {
    const db = initDb(':memory:');
    seed(db);
    updateVideoStatus(db, 'vid1', 'done', { downloadPath: 'C:/dl/vid1.mp4' });
    const row = getVideo(db, 'vid1');
    expect(row.status).toBe('done');
    expect(row.download_path).toBe('C:/dl/vid1.mp4');
  });

  it('updateVideoStatus records an error message on failure', () => {
    const db = initDb(':memory:');
    seed(db);
    updateVideoStatus(db, 'vid1', 'failed', { error: 'premiere not ready' });
    const row = getVideo(db, 'vid1');
    expect(row.status).toBe('failed');
    expect(row.error).toBe('premiere not ready');
  });

  it('incrementRetries returns the new count each call', () => {
    const db = initDb(':memory:');
    seed(db);
    expect(incrementRetries(db, 'vid1')).toBe(1);
    expect(incrementRetries(db, 'vid1')).toBe(2);
    expect(getVideo(db, 'vid1').retries).toBe(2);
  });
});
