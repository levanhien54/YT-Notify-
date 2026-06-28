import { buildTopicUrl } from './topic.js';

// hub.verify is fixed to 'async' for all hub requests (implementation-internal constant,
// intentionally NOT part of the buildSubscribeForm parameter list).
const HUB_VERIFY = 'async';

export function buildSubscribeForm({ callbackUrl, channelId, mode, secret, leaseSeconds }) {
  const form = new URLSearchParams();
  form.set('hub.callback', callbackUrl);
  form.set('hub.topic', buildTopicUrl(channelId));
  form.set('hub.mode', mode);
  form.set('hub.verify', HUB_VERIFY);
  if (mode === 'subscribe') {
    if (secret != null) form.set('hub.secret', secret);
    if (leaseSeconds != null) form.set('hub.lease_seconds', String(leaseSeconds));
  }
  return form;
}
