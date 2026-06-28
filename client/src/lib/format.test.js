import { describe, it, expect } from 'vitest';
import { thumbUrl, relativeTime } from './format.js';

describe('thumbUrl', () => {
  it('builds the i.ytimg hqdefault url', () => {
    expect(thumbUrl('abc123')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('returns "just now" under a minute', () => {
    expect(relativeTime(now - 30_000, now)).toBe('just now');
  });
  it('returns minutes', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
  });
  it('returns hours', () => {
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });
  it('returns days', () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('handles missing timestamp gracefully', () => {
    expect(relativeTime(null, now)).toBe('');
  });
});
