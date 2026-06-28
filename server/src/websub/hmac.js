import crypto from 'node:crypto';

export function verifyHmac(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith('sha1=')) return false;
  const provided = signatureHeader.slice('sha1='.length);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expected = crypto.createHmac('sha1', secret).update(body).digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
