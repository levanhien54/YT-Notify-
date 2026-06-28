import { describe, it, expect } from 'vitest';
import { initDb, addChannel, getChannel, listChannels } from '../../src/db/index.js';

const sample = {
  channelId: 'UC123',
  handle: '@creator',
  title: 'Creator',
  thumbnail: 'http://t/x.jpg',
  secret: 's3cr3t'
};

describe('channels add/get/list', () => {
  it('addChannel returns the inserted row with defaults', () => {
    const db = initDb(':memory:');
    const row = addChannel(db, sample);
    expect(row.channel_id).toBe('UC123');
    expect(row.handle).toBe('@creator');
    expect(row.title).toBe('Creator');
    expect(row.thumbnail).toBe('http://t/x.jpg');
    expect(row.secret).toBe('s3cr3t');
    expect(row.active).toBe(1);
    expect(typeof row.created_at).toBe('number');
  });

  it('getChannel returns the row, or undefined when absent', () => {
    const db = initDb(':memory:');
    addChannel(db, sample);
    expect(getChannel(db, 'UC123').title).toBe('Creator');
    expect(getChannel(db, 'NOPE')).toBeUndefined();
  });

  it('listChannels returns all rows', () => {
    const db = initDb(':memory:');
    addChannel(db, sample);
    addChannel(db, { ...sample, channelId: 'UC999', title: 'Other' });
    const all = listChannels(db);
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.channel_id).sort()).toEqual(['UC123', 'UC999']);
  });
});
