import { describe, it, expect } from 'vitest';
import { buildTopicUrl } from '../../src/websub/topic.js';

describe('buildTopicUrl', () => {
  it('builds the YouTube feed topic url for a channel id', () => {
    expect(buildTopicUrl('UC123abc')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123abc'
    );
  });

  it('url-encodes the channel id', () => {
    expect(buildTopicUrl('UC a/b')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC%20a%2Fb'
    );
  });
});
