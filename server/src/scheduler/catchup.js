import { parseAtom } from '../websub/atom.js';
import { buildTopicUrl } from '../websub/topic.js';

export function findMissedVideos(rssEntries, lastPublishedAt) {
  if (!Array.isArray(rssEntries) || rssEntries.length === 0) return [];
  const last = lastPublishedAt == null ? 0 : lastPublishedAt;
  return rssEntries.filter((e) => {
    const ts = e && e.published ? Date.parse(e.published) : NaN;
    if (Number.isNaN(ts)) return false;
    return ts > last;
  });
}

export async function fetchChannelRss(channelId, fetchFn = fetch) {
  const url = buildTopicUrl(channelId);
  const res = await fetchFn(url);
  if (!res.ok) return [];
  const xml = await res.text();
  return parseAtom(xml).entries;
}
