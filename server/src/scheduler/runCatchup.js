// server/src/scheduler/runCatchup.js
import {
  listActiveChannels,
  upsertVideoIfNew,
  updateLastVideoPublishedAt,
} from '../db/index.js';
import { fetchChannelRss, findMissedVideos } from './catchup.js';

function toMs(v) {
  return typeof v === 'number' ? v : Date.parse(v);
}

export async function runCatchup({ db, onNewVideo, fetchFn = fetch }) {
  const channels = listActiveChannels(db);
  let enqueued = 0;

  for (const ch of channels) {
    const marker = ch.last_video_published_at || 0;
    // fetchChannelRss returns {entries, deleted} — destructure entries
    const { entries } = await fetchChannelRss(ch.channel_id, fetchFn);
    if (!entries.length) continue;

    const missed = findMissedVideos(entries, marker);
    let maxPub = marker;

    for (const e of missed) {
      const publishedAt = toMs(e.published);
      const updatedAt = toMs(e.updated) || publishedAt;
      const { row, isNew } = upsertVideoIfNew(db, {
        videoId: e.videoId,
        channelId: ch.channel_id,
        title: e.title,
        publishedAt,
        updatedAt,
        thumbnailUrl: null, // parseAtom entries carry no thumbnail per the contract
      });
      if (isNew) {
        enqueued += 1;
        if (typeof onNewVideo === 'function') onNewVideo(row);
      }
      if (Number.isFinite(publishedAt) && publishedAt > maxPub) maxPub = publishedAt;
    }

    if (maxPub > marker) {
      updateLastVideoPublishedAt(db, ch.channel_id, maxPub);
    }
  }

  return { enqueued };
}
