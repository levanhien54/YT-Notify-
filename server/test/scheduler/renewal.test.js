import { describe, it, expect, vi } from 'vitest';
import { initDb, addChannel, updateChannelSubscription } from '../../src/db/index.js';
import { renewExpiringLeases } from '../../src/scheduler/index.js';

const HOUR = 3_600_000;

describe('renewExpiringLeases', () => {
  it('re-subscribes only active channels whose lease expires within thresholdMs', async () => {
    const now = 1_000_000_000_000;
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_soon', handle: '@s', title: 'S', thumbnail: '', secret: 'sec_soon' });
    addChannel(db, { channelId: 'UC_far', handle: '@f', title: 'F', thumbnail: '', secret: 'sec_far' });
    updateChannelSubscription(db, 'UC_soon', { subscribedAt: now, leaseExpiresAt: now + 3 * HOUR });
    updateChannelSubscription(db, 'UC_far', { subscribedAt: now, leaseExpiresAt: now + 100 * HOUR });

    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const results = await renewExpiringLeases({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      now,
      thresholdMs: 12 * HOUR,
      sendFn,
      delayMs: 0,
    });

    expect(sendFn).toHaveBeenCalledTimes(1);
    const arg = sendFn.mock.calls[0][0];
    expect(arg.channelId).toBe('UC_soon');
    expect(arg.mode).toBe('subscribe');
    expect(arg.secret).toBe('sec_soon');
    expect(arg.leaseSeconds).toBe(432000);
    expect(results).toEqual([{ channelId: 'UC_soon', ok: true, status: 202 }]);
  });

  it('does nothing when no active channel is expiring', async () => {
    const now = 1_000_000_000_000;
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_ok', handle: '@o', title: 'O', thumbnail: '', secret: 'sec' });
    updateChannelSubscription(db, 'UC_ok', { subscribedAt: now, leaseExpiresAt: now + 100 * HOUR });

    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const results = await renewExpiringLeases({
      db,
      callbackUrl: 'https://cb/webhook/youtube',
      hubUrl: 'https://hub',
      leaseSeconds: 432000,
      now,
      thresholdMs: 12 * HOUR,
      sendFn,
      delayMs: 0,
    });

    expect(sendFn).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
