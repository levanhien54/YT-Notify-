import { buildSubscribeForm } from './params.js';

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
