import { listActiveChannels } from '../db/index.js';
import { findExpiringChannels } from './lease.js';
import { sendSubscription } from '../websub/client.js';

export async function renewExpiringLeases({
  db,
  callbackUrl,
  hubUrl,
  leaseSeconds,
  now = Date.now(),
  thresholdMs = 12 * 60 * 60 * 1000,
  sendFn = sendSubscription,
  delayMs = 50,
}) {
  const active = listActiveChannels(db);
  const expiring = findExpiringChannels(active, now, thresholdMs);
  const results = [];
  for (let i = 0; i < expiring.length; i++) {
    const ch = expiring[i];
    const res = await sendFn({
      hubUrl,
      callbackUrl,
      channelId: ch.channel_id,
      mode: 'subscribe',
      secret: ch.secret,
      leaseSeconds,
    });
    results.push({ channelId: ch.channel_id, ...res });
    if (delayMs > 0 && i < expiring.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}
