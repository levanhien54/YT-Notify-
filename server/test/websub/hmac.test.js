import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyHmac } from '../../src/websub/hmac.js';

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

describe('verifyHmac', () => {
  const secret = 'topsecret';
  const body = Buffer.from('<feed>hello</feed>');

  it('returns true for a valid sha1 signature (Buffer body)', () => {
    expect(verifyHmac(body, sign(body, secret), secret)).toBe(true);
  });

  it('returns true for a valid signature (string body)', () => {
    const s = '<feed>hi</feed>';
    expect(verifyHmac(s, sign(s, secret), secret)).toBe(true);
  });

  it('returns false when signature does not match', () => {
    expect(verifyHmac(body, sign(body, 'wrong'), secret)).toBe(false);
  });

  it('returns false for a missing/empty signature header', () => {
    expect(verifyHmac(body, undefined, secret)).toBe(false);
    expect(verifyHmac(body, '', secret)).toBe(false);
  });

  it('returns false for a malformed (non sha1=) header', () => {
    expect(verifyHmac(body, 'deadbeef', secret)).toBe(false);
  });

  it('returns false when secret is missing', () => {
    expect(verifyHmac(body, sign(body, secret), undefined)).toBe(false);
  });
});
