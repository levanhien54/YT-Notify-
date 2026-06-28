import { describe, it, expect } from 'vitest';
import { parseTunnelUrl } from '../../src/tunnel/parser.js';

describe('parseTunnelUrl', () => {
  it('parses a plain https trycloudflare url line', () => {
    const line = '2024-01-01T00:00:00Z INF https://happy-cat-test.trycloudflare.com';
    expect(parseTunnelUrl(line)).toBe('https://happy-cat-test.trycloudflare.com');
  });

  it('parses the boxed cloudflared banner line (with | borders and spaces)', () => {
    const line = '|  https://random-words-here-1234.trycloudflare.com                         |';
    expect(parseTunnelUrl(line)).toBe('https://random-words-here-1234.trycloudflare.com');
  });

  it('parses a url embedded in a sentence', () => {
    const line = 'Your quick Tunnel has been created! Visit it at https://abc-def-ghi.trycloudflare.com to test';
    expect(parseTunnelUrl(line)).toBe('https://abc-def-ghi.trycloudflare.com');
  });

  it('strips a trailing slash from the matched url', () => {
    const line = 'INF |  https://foo-bar-baz.trycloudflare.com/  |';
    expect(parseTunnelUrl(line)).toBe('https://foo-bar-baz.trycloudflare.com');
  });

  it('returns null for a line with no tunnel url', () => {
    expect(parseTunnelUrl('INF Starting tunnel process')).toBeNull();
  });

  it('returns null for a non-trycloudflare https url', () => {
    expect(parseTunnelUrl('INF https://www.youtube.com/feeds')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTunnelUrl('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseTunnelUrl(null)).toBeNull();
    expect(parseTunnelUrl(undefined)).toBeNull();
    expect(parseTunnelUrl(42)).toBeNull();
  });

  it('ignores http (non-https) trycloudflare urls', () => {
    expect(parseTunnelUrl('INF http://insecure.trycloudflare.com')).toBeNull();
  });

  it('returns the first url when multiple appear on one line', () => {
    const line = 'https://one-aaa.trycloudflare.com and https://two-bbb.trycloudflare.com';
    expect(parseTunnelUrl(line)).toBe('https://one-aaa.trycloudflare.com');
  });
});
