import { listActiveChannels } from '../db/index.js';
import { findExpiringChannels } from './lease.js';
import { sendSubscription } from '../websub/client.js';

export async function runLeaseRenewal({
  db,
  callbackUrl,
  hubUrl,
  leaseSeconds,
  now = Date.now(),
  thresholdMs = 12 * 3600 * 1000,
  sendFn = sendSubscription,
}) {
  if (!callbackUrl) return { renewed: 0 };
  const expiring = findExpiringChannels(listActiveChannels(db), now, thresholdMs);
  let renewed = 0;
  for (const ch of expiring) {
    await sendFn({
      hubUrl,
      callbackUrl,
      channelId: ch.channel_id,
      mode: 'subscribe',
      secret: ch.secret,
      leaseSeconds,
      fetchFn: fetch,
    });
    renewed += 1;
  }
  return { renewed };
}
