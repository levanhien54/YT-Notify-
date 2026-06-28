import { describe, it, expect } from 'vitest';
import { findExpiringChannels } from '../../src/scheduler/lease.js';

describe('findExpiringChannels', () => {
  const now = 1_000_000_000_000;
  const HOUR = 3_600_000;
  const channels = [
    { channel_id: 'UC_soon', lease_expires_at: now + 6 * HOUR },   // within 12h -> expiring
    { channel_id: 'UC_edge', lease_expires_at: now + 12 * HOUR },  // exactly threshold -> NOT (strict <)
    { channel_id: 'UC_far', lease_expires_at: now + 48 * HOUR },   // far future -> no
    { channel_id: 'UC_past', lease_expires_at: now - HOUR },       // already expired -> yes
    { channel_id: 'UC_null', lease_expires_at: null },             // never subscribed -> yes (treat as expiring)
  ];

  it('returns channels whose lease expires within now+thresholdMs (strict <)', () => {
    const res = findExpiringChannels(channels, now, 12 * HOUR);
    const ids = res.map((c) => c.channel_id).sort();
    expect(ids).toEqual(['UC_null', 'UC_past', 'UC_soon']);
  });

  it('returns empty array when none are expiring', () => {
    const far = [{ channel_id: 'X', lease_expires_at: now + 100 * HOUR }];
    expect(findExpiringChannels(far, now, HOUR)).toEqual([]);
  });
});
