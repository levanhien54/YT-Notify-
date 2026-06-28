import { describe, it, expect } from 'vitest';
import {
  initDb, addChannel, getChannel,
  updateChannelSubscription, updateLastVideoPublishedAt
} from '../../src/db/index.js';

function seed(db) {
  addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: '', secret: 's1' });
}

describe('channel subscription bookkeeping', () => {
  it('updateChannelSubscription stores subscribed_at + lease_expires_at', () => {
    const db = initDb(':memory:');
    seed(db);
    updateChannelSubscription(db, 'UC1', { subscribedAt: 1000, leaseExpiresAt: 433000 });
    const row = getChannel(db, 'UC1');
    expect(row.subscribed_at).toBe(1000);
    expect(row.lease_expires_at).toBe(433000);
  });

  it('updateLastVideoPublishedAt stores the timestamp', () => {
    const db = initDb(':memory:');
    seed(db);
    updateLastVideoPublishedAt(db, 'UC1', 1719500000000);
    expect(getChannel(db, 'UC1').last_video_published_at).toBe(1719500000000);
  });
});
