export function findExpiringChannels(channels, now, thresholdMs) {
  const cutoff = now + thresholdMs;
  return channels.filter((c) => {
    const exp = c.lease_expires_at;
    if (exp == null) return true; // never subscribed -> needs subscription
    return exp < cutoff;
  });
}
