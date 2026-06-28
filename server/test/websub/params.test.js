import { describe, it, expect } from 'vitest';
import { buildSubscribeForm } from '../../src/websub/params.js';

describe('buildSubscribeForm', () => {
  it('builds a subscribe form with all hub params', () => {
    const form = buildSubscribeForm({
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      channelId: 'UC123',
      mode: 'subscribe',
      secret: 's3cr3t',
      leaseSeconds: 432000,
    });
    expect(form).toBeInstanceOf(URLSearchParams);
    expect(form.get('hub.callback')).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(form.get('hub.topic')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123'
    );
    expect(form.get('hub.mode')).toBe('subscribe');
    expect(form.get('hub.secret')).toBe('s3cr3t');
    expect(form.get('hub.lease_seconds')).toBe('432000');
    // hub.verify is an internal constant, always 'async'
    expect(form.get('hub.verify')).toBe('async');
  });

  it('omits hub.secret and hub.lease_seconds for unsubscribe', () => {
    const form = buildSubscribeForm({
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      channelId: 'UC123',
      mode: 'unsubscribe',
    });
    expect(form.get('hub.mode')).toBe('unsubscribe');
    expect(form.has('hub.secret')).toBe(false);
    expect(form.has('hub.lease_seconds')).toBe(false);
  });
});
