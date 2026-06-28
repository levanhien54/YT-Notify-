import { describe, it, expect, vi } from 'vitest';
import { initDb, addChannel, updateChannelSubscription } from '../../src/db/index.js';
import { runLeaseRenewal } from '../../src/scheduler/runLease.js';

describe('runLeaseRenewal', () => {
  it('renews only channels whose lease expires within the threshold', async () => {
    const db = initDb(':memory:');
    const now = 1_000_000_000_000;

    addChannel(db, { channelId: 'UC_soon', handle: '@s', title: 'S', thumbnail: '', secret: 'sec1' });
    addChannel(db, { channelId: 'UC_later', handle: '@l', title: 'L', thumbnail: '', secret: 'sec2' });
    // expires in 6h -> within 12h threshold (set via contract function)
    updateChannelSubscription(db, 'UC_soon', {
      subscribedAt: now,
      leaseExpiresAt: now + 6 * 3600 * 1000,
    });
    // expires in 48h -> outside threshold
    updateChannelSubscription(db, 'UC_later', {
      subscribedAt: now,
      leaseExpiresAt: now + 48 * 3600 * 1000,
    });

    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

    const result = await runLeaseRenewal({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      now,
      thresholdMs: 12 * 3600 * 1000,
      sendFn,
    });

    expect(result.renewed).toBe(1);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const arg = sendFn.mock.calls[0][0];
    expect(arg.channelId).toBe('UC_soon');
    expect(arg.mode).toBe('subscribe');
    expect(arg.secret).toBe('sec1');
    expect(arg.callbackUrl).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(arg.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(arg.leaseSeconds).toBe(432000);
  });
});
