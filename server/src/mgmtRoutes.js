import { randomBytes } from 'node:crypto';
import {
  listChannels,
  listVideos,
  getChannel,
  addChannel,
  setChannelActive,
  removeChannel,
} from './db/index.js';

function countDownloading(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'downloading'").get();
  return row ? row.n : 0;
}

function mapChannel(row) {
  if (!row) return row;
  return {
    channelId: row.channel_id,
    handle: row.handle,
    title: row.title,
    thumbnail: row.thumbnail,
    active: row.active,
    secret: row.secret,
    subscribedAt: row.subscribed_at,
    leaseExpiresAt: row.lease_expires_at,
    lastVideoPublishedAt: row.last_video_published_at,
    createdAt: row.created_at,
  };
}

export function registerMgmtRoutes(app, { db, tunnel, queue, deps }) {
  const genSecret = deps.genSecret || (() => randomBytes(16).toString('hex'));
  const callbackFor = () => {
    const baseUrl = tunnel.getUrl();
    return baseUrl ? `${baseUrl}/webhook/youtube` : null;
  };

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

  app.get('/api/channels', (req, res) => {
    res.json(listChannels(db).map(mapChannel));
  });

  app.post('/api/channels', async (req, res, next) => {
    try {
      const input = req.body && req.body.input;
      if (!input) {
        return res.status(400).json({ error: 'input is required' });
      }
      const callbackUrl = callbackFor();
      if (!callbackUrl) {
        return res.status(503).json({ error: 'tunnel has no public url yet' });
      }
      const channelId = await deps.resolveChannelId(input, { spawnFn: deps.spawnFn });
      if (getChannel(db, channelId)) {
        return res.status(409).json({ error: 'channel already exists' });
      }
      const secret = genSecret();
      const channel = addChannel(db, {
        channelId,
        handle: input,
        title: input,
        thumbnail: null,
        secret,
      });
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl,
        channelId,
        mode: 'subscribe',
        secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      res.json(mapChannel(channel));
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/channels/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = getChannel(db, id);
      if (!existing) {
        return res.status(404).json({ error: 'channel not found' });
      }
      const active = !!(req.body && req.body.active);
      setChannelActive(db, id, active);
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl: callbackFor(),
        channelId: id,
        mode: active ? 'subscribe' : 'unsubscribe',
        secret: existing.secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      res.json(getChannel(db, id));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/channels/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = getChannel(db, id);
      if (!existing) {
        return res.status(404).json({ error: 'channel not found' });
      }
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl: callbackFor(),
        channelId: id,
        mode: 'unsubscribe',
        secret: existing.secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      removeChannel(db, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
