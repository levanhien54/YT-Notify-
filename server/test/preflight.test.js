import { describe, it, expect, vi } from 'vitest';
import { checkBinaries } from '../src/preflight.js';

describe('checkBinaries (pure, injected resolver)', () => {
  it('maps each name to found/path using the resolver', () => {
    const resolver = vi.fn((name) =>
      name === 'cloudflared' ? 'C:/bin/cloudflared.exe' : null
    );
    const result = checkBinaries(['cloudflared', 'yt-dlp', 'ffmpeg'], resolver);
    expect(result).toEqual([
      { name: 'cloudflared', found: true, path: 'C:/bin/cloudflared.exe' },
      { name: 'yt-dlp', found: false, path: null },
      { name: 'ffmpeg', found: false, path: null }
    ]);
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it('treats undefined resolver result as not found', () => {
    const resolver = () => undefined;
    expect(checkBinaries(['x'], resolver)).toEqual([
      { name: 'x', found: false, path: null }
    ]);
  });

  it('returns an empty array for no names', () => {
    expect(checkBinaries([], () => null)).toEqual([]);
  });
});
