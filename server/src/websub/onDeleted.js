import { getVideo, updateVideoStatus } from '../db/index.js';

// Returns an onDeleted(videoId) callback that marks the video skipped (no download).
export function handleDeleted(db) {
  return (videoId) => {
    if (!videoId) return;
    if (!getVideo(db, videoId)) return; // nothing to skip for unknown ids
    updateVideoStatus(db, videoId, 'skipped', {});
  };
}
