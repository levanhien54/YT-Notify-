const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/i;

export function parseTunnelUrl(line) {
  if (typeof line !== 'string' || line.length === 0) return null;
  const match = line.match(TUNNEL_URL_RE);
  if (!match) return null;
  return match[0].replace(/\/+$/, '');
}
