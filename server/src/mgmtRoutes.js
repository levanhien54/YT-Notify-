import { listChannels, listVideos } from './db/index.js';

function countDownloading(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'downloading'").get();
  return row ? row.n : 0;
}

export function registerMgmtRoutes(app, { db, tunnel, queue, deps }) {
  app.get('/api/status', (req, res) => {
    res.json({
      tunnel: { status: tunnel.getStatus(), url: tunnel.getUrl() },
      counts: {
        channels: listChannels(db).length,
        videos: listVideos(db, { limit: 1000000 }).length,
        downloading: countDownloading(db),
      },
      preflight: deps.preflight || [],
    });
  });
}
