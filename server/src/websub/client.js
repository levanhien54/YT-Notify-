import { buildSubscribeForm } from './params.js';
import { listActiveChannels } from '../db/index.js';

export async function sendSubscription({
  hubUrl,
  callbackUrl,
  channelId,
  mode,
  secret,
  leaseSeconds,
  fetchFn = fetch,
}) {
  const form = buildSubscribeForm({ callbackUrl, channelId, mode, secret, leaseSeconds });
  const res = await fetchFn(hubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return { ok: res.ok, status: res.status };
}

export async function resubscribeAll({
  db,
  callbackUrl,
  hubUrl,
  leaseSeconds,
  sendFn = sendSubscription,
  delayMs = 50,
}) {
  const channels = listActiveChannels(db);
  const results = [];
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const res = await sendFn({
      hubUrl,
      callbackUrl,
      channelId: ch.channel_id,
      mode: 'subscribe',
      secret: ch.secret,
      leaseSeconds,
    });
    results.push({ channelId: ch.channel_id, ...res });
    if (delayMs > 0 && i < channels.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}
