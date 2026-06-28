export function findMissedVideos(rssEntries, lastPublishedAt) {
  if (!Array.isArray(rssEntries) || rssEntries.length === 0) return [];
  const last = lastPublishedAt == null ? 0 : lastPublishedAt;
  return rssEntries.filter((e) => {
    const ts = e && e.published ? Date.parse(e.published) : NaN;
    if (Number.isNaN(ts)) return false;
    return ts > last;
  });
}
