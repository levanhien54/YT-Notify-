import { describe, it, expect } from 'vitest';
import { findMissedVideos } from '../../src/scheduler/catchup.js';

describe('findMissedVideos', () => {
  const entries = [
    { videoId: 'A', published: '2026-06-28T09:00:00+00:00' },
    { videoId: 'B', published: '2026-06-28T10:00:00+00:00' },
    { videoId: 'C', published: '2026-06-28T11:00:00+00:00' },
  ];

  it('returns entries published strictly after lastPublishedAt (ms)', () => {
    const last = Date.parse('2026-06-28T10:00:00+00:00');
    const res = findMissedVideos(entries, last);
    expect(res.map((e) => e.videoId)).toEqual(['C']);
  });

  it('returns all entries when lastPublishedAt is null/0', () => {
    expect(findMissedVideos(entries, null).map((e) => e.videoId)).toEqual(['A', 'B', 'C']);
    expect(findMissedVideos(entries, 0).map((e) => e.videoId)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty array for empty input', () => {
    expect(findMissedVideos([], 123)).toEqual([]);
    expect(findMissedVideos(undefined, 123)).toEqual([]);
  });
});
