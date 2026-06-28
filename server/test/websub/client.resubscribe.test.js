import { describe, it, expect, vi } from 'vitest';
import { initDb, addChannel, setChannelActive } from '../../src/db/index.js';
import { resubscribeAll } from '../../src/websub/client.js';

function seed() {
  const db = initDb(':memory:');
  addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: '', secret: 'sec1' });
  addChannel(db, { channelId: 'UC2', handle: '@b', title: 'B', thumbnail: '', secret: 'sec2' });
  addChannel(db, { channelId: 'UC3', handle: '@c', title: 'C', thumbnail: '', secret: 'sec3' });
  setChannelActive(db, 'UC3', false); // inactive -> skipped
  return db;
}

describe('resubscribeAll', () => {
  it('subscribes every ACTIVE channel with its own secret', async () => {
    const db = seed();
    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

    const results = await resubscribeAll({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      sendFn,
      delayMs: 0,
    });

    expect(sendFn).toHaveBeenCalledTimes(2);
    const ids = sendFn.mock.calls.map((c) => c[0].channelId).sort();
    expect(ids).toEqual(['UC1', 'UC2']);
    const first = sendFn.mock.calls.find((c) => c[0].channelId === 'UC1')[0];
    expect(first.mode).toBe('subscribe');
    expect(first.secret).toBe('sec1');
    expect(first.callbackUrl).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(first.leaseSeconds).toBe(432000);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('staggers calls by delayMs between channels', async () => {
    vi.useFakeTimers();
    const db = seed();
    let calls = 0;
    const sendFn = vi.fn().mockImplementation(async () => {
      calls++;
      return { ok: true, status: 202 };
    });

    const p = resubscribeAll({
      db,
      callbackUrl: 'https://cb/webhook/youtube',
      hubUrl: 'https://hub',
      leaseSeconds: 432000,
      sendFn,
      delayMs: 50,
    });

    await Promise.resolve();
    expect(calls).toBe(1); // first fired immediately, second is waiting on timer
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('catches per-channel errors and continues batch without aborting', async () => {
    const db = seed();
    const sendFn = vi.fn().mockImplementation(async ({ channelId }) => {
      if (channelId === 'UC2') {
        throw new Error('Network error');
      }
      return { ok: true, status: 202 };
    });

    const results = await resubscribeAll({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      sendFn,
      delayMs: 0,
    });

    // All channels attempted (2 active channels)
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);

    // UC1 succeeded
    const uc1Result = results.find((r) => r.channelId === 'UC1');
    expect(uc1Result).toEqual({ channelId: 'UC1', ok: true, status: 202 });

    // UC2 failed but batch continued
    const uc2Result = results.find((r) => r.channelId === 'UC2');
    expect(uc2Result).toEqual({ channelId: 'UC2', ok: false, status: 0 });
  });
});
