import { describe, it, expect, vi } from 'vitest';
import { sendSubscription } from '../../src/websub/client.js';

describe('sendSubscription', () => {
  it('POSTs a form-encoded subscribe request to the hub', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const res = await sendSubscription({
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      channelId: 'UC123',
      mode: 'subscribe',
      secret: 's3cr3t',
      leaseSeconds: 432000,
      fetchFn,
    });

    expect(res).toEqual({ ok: true, status: 202 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    // Decode the form body and assert on real field values (robust vs. encoded-substring matching).
    const sent = new URLSearchParams(opts.body);
    expect(sent.get('hub.mode')).toBe('subscribe');
    expect(sent.get('hub.callback')).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(sent.get('hub.topic')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123'
    );
    expect(sent.get('hub.secret')).toBe('s3cr3t');
    expect(sent.get('hub.lease_seconds')).toBe('432000');
  });

  it('returns ok:false with status on hub rejection', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const res = await sendSubscription({
      hubUrl: 'https://hub',
      callbackUrl: 'https://cb/webhook/youtube',
      channelId: 'UC9',
      mode: 'unsubscribe',
      fetchFn,
    });
    expect(res).toEqual({ ok: false, status: 400 });
  });
});
