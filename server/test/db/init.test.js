import { describe, it, expect } from 'vitest';
import { initDb } from '../../src/db/index.js';

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

describe('initDb', () => {
  it('creates the three core tables in :memory:', () => {
    const db = initDb(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['channels', 'videos', 'settings']));
  });

  it('channels table has the contract columns', () => {
    const db = initDb(':memory:');
    expect(tableColumns(db, 'channels')).toEqual(
      expect.arrayContaining([
        'channel_id', 'handle', 'title', 'thumbnail', 'active', 'secret',
        'subscribed_at', 'lease_expires_at', 'last_video_published_at', 'created_at'
      ])
    );
  });

  it('videos and settings tables have the contract columns', () => {
    const db = initDb(':memory:');
    expect(tableColumns(db, 'videos')).toEqual(
      expect.arrayContaining([
        'video_id', 'channel_id', 'title', 'published_at', 'updated_at',
        'thumbnail_url', 'status', 'download_path', 'retries', 'error', 'created_at'
      ])
    );
    expect(tableColumns(db, 'settings')).toEqual(
      expect.arrayContaining(['key', 'value'])
    );
  });

  it('is idempotent (calling twice does not throw)', () => {
    const db = initDb(':memory:');
    expect(() => initDb(':memory:')).not.toThrow();
    expect(db).toBeTruthy();
  });
});
