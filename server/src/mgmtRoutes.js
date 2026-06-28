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

  app.post('/api/tunnel/start', (req, res) => {
    tunnel.start();
    res.status(202).end();
  });

  app.post('/api/tunnel/stop', (req, res) => {
    tunnel.stop();
    res.status(202).end();
  });
}
