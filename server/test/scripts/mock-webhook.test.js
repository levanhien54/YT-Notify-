import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildSampleAtom, signBody } from '../../../scripts/lib/sampleAtom.js';
import { parseAtom } from '../../src/websub/atom.js';
import { verifyHmac } from '../../src/websub/hmac.js';

describe('mock-webhook sample payload', () => {
  it('builds Atom xml that parseAtom can read', () => {
    const xml = buildSampleAtom({
      channelId: 'UC_mock',
      videoId: 'MOCKVID',
      title: 'Mock Title',
      published: '2026-06-28T12:00:00+00:00',
    });
    const parsed = parseAtom(xml);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].videoId).toBe('MOCKVID');
    expect(parsed.entries[0].channelId).toBe('UC_mock');
    expect(parsed.entries[0].title).toBe('Mock Title');
  });

  it('signs the body so verifyHmac accepts it', () => {
    const xml = buildSampleAtom({ channelId: 'UC_mock', videoId: 'MOCKVID', title: 'T' });
    const sig = signBody(xml, 'mysecret');
    expect(sig.startsWith('sha1=')).toBe(true);
    expect(verifyHmac(xml, sig, 'mysecret')).toBe(true);
    expect(verifyHmac(xml, sig, 'wrongsecret')).toBe(false);
  });

  it('produces a signature equal to a manual HMAC-SHA1', () => {
    const body = 'hello';
    const expected = 'sha1=' + crypto.createHmac('sha1', 's').update(body).digest('hex');
    expect(signBody(body, 's')).toBe(expected);
  });
});
