import { randomBytes } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import {
  listChannels,
  listVideos,
  getChannel,
  addChannel,
  setChannelActive,
  removeChannel,
  updateChannelMeta,
  getAllSettings,
  setSetting,
} from './db/index.js';
import { DEFAULTS } from './config.js';

const _xmlParser = new XMLParser({ ignoreAttributes: false });

// Fetch real channel title + thumbnail from YouTube RSS feed (no API key needed).
async function fetchChannelMeta(channelId, fetchFn) {
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const res = await fetchFn(url);
    if (!res.ok) return {};
    const xml = await res.text();
    const data = _xmlParser.parse(xml);
    const feed = data?.feed;
    return {
      title: feed?.title ?? null,
      thumbnail: feed?.['media:thumbnail']?.['@_url'] ?? null,
    };
  } catch {
    return {};
  }
}

// Extract @handle from a YouTube URL or raw input.
function extractHandle(input) {
  const m = input.match(/@([\w.-]+)/);
  if (m) return '@' + m[1];
  if (input.startsWith('@')) return input;
  return null;
}

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

function mapVideo(row) {
  if (!row) return row;
  return {
    videoId: row.video_id,
    channelId: row.channel_id,
    title: row.title,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    downloadPath: row.download_path,
    retries: row.retries,
    error: row.error,
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
      // Fetch real channel name from YouTube RSS (graceful fallback)
      const meta = await fetchChannelMeta(channelId, deps.fetchFn);
      const secret = genSecret();
      const channel = addChannel(db, {
        channelId,
        handle: extractHandle(input) || channelId,
        title: meta.title || extractHandle(input) || channelId,
        thumbnail: meta.thumbnail || null,
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
      res.json(mapChannel(getChannel(db, id)));
    } catch (err) {
      next(err);
    }
  });

  // Refresh channel titles/thumbnails from YouTube RSS for all stale channels.
  app.post('/api/channels/refresh-meta', async (req, res) => {
    const all = listChannels(db);
    const stale = all.filter(
      (c) => !c.title || c.title.startsWith('http') || c.title === c.channel_id
    );
    // Fire-and-forget; client polls /api/channels for updates
    (async () => {
      for (const ch of stale) {
        const meta = await fetchChannelMeta(ch.channel_id, deps.fetchFn);
        if (meta.title) updateChannelMeta(db, ch.channel_id, meta);
      }
    })().catch(() => {});
    res.json({ refreshing: stale.length });
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

  app.get('/api/videos', (req, res) => {
    const raw = req.query.limit;
    const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
    res.json(listVideos(db, { limit }).map(mapVideo));
  });

  const mergedSettings = () => ({ ...DEFAULTS, ...getAllSettings(db) });

  app.get('/api/settings', (req, res) => {
    res.json(mergedSettings());
  });

  app.patch('/api/settings', (req, res) => {
    const body = req.body || {};
    for (const [key, value] of Object.entries(body)) {
      setSetting(db, key, value);
    }
    res.json(mergedSettings());
  });
}
