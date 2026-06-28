import { describe, it, expect } from 'vitest';
import { parseProgress } from '../../src/downloader/progress.js';

describe('parseProgress', () => {
  it('parses a yt-dlp --newline download line into percent', () => {
    const line = '[download]  23.4% of 12.34MiB at 1.23MiB/s ETA 00:08';
    expect(parseProgress(line)).toEqual({ percent: 23.4 });
  });

  it('parses 100% completion line', () => {
    const line = '[download] 100% of 12.34MiB in 00:10';
    expect(parseProgress(line)).toEqual({ percent: 100 });
  });

  it('parses integer percent', () => {
    const line = '[download]   5% of ~10.00MiB at 500.00KiB/s ETA 00:20';
    expect(parseProgress(line)).toEqual({ percent: 5 });
  });

  it('returns null for non-progress lines', () => {
    expect(parseProgress('[youtube] abc123: Downloading webpage')).toBeNull();
    expect(parseProgress('[Merger] Merging formats into "out.mp4"')).toBeNull();
    expect(parseProgress('')).toBeNull();
  });

  it('returns null for a download line without a percentage', () => {
    expect(parseProgress('[download] Destination: video.f137.mp4')).toBeNull();
  });
});
