import express from 'express';
import { verifyHmac } from './hmac.js';
import { parseAtom } from './atom.js';
import { upsertVideoIfNew, getVideo } from '../db/index.js';

export function registerWebhookRoutes(app, { db, secretFor, onNewVideo, onDeleted }) {
  // GET: WebSub verification handshake -> echo hub.challenge.
  // Missing hub.mode/hub.topic -> 404 (project-chosen status for malformed handshakes).
  app.get('/webhook/youtube', (req, res) => {
    const mode = req.query['hub.mode'];
    const topic = req.query['hub.topic'];
    const challenge = req.query['hub.challenge'];
    if (!mode || !topic) {
      res.status(404).end();
      return;
    }
    res.status(200).type('text/plain').send(challenge != null ? String(challenge) : '');
  });

  // POST: notifications. express.raw preserves exact bytes for HMAC verification.
  app.post('/webhook/youtube', express.raw({ type: () => true }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const xml = rawBody.toString('utf8');
    const { entries, deleted } = parseAtom(xml);

    // Recover channelId for HMAC: prefer the parsed entry; for tombstones (channelId:null)
    // look up the stored video row so secretFor() receives the real per-channel id.
    let channelId = entries[0] && entries[0].channelId;
    if (!channelId && deleted[0]) {
      const existing = getVideo(db, deleted[0].videoId);
      channelId = existing ? existing.channel_id : null;
    }
    const secret = secretFor(channelId || null);
    const signature = req.get('X-Hub-Signature');

    if (!verifyHmac(rawBody, signature, secret)) {
      res.status(403).end();
      return;
    }

    for (const entry of entries) {
      const { isNew, row } = upsertVideoIfNew(db, {
        videoId: entry.videoId,
        channelId: entry.channelId,
        title: entry.title,
        publishedAt: entry.published ? Date.parse(entry.published) : null,
        updatedAt: entry.updated ? Date.parse(entry.updated) : null,
        thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
      });
      if (isNew && typeof onNewVideo === 'function') {
        Promise.resolve().then(() => onNewVideo(row));
      }
    }

    for (const d of deleted) {
      if (typeof onDeleted === 'function') {
        Promise.resolve().then(() => onDeleted(d.videoId));
      }
    }

    res.status(204).end();
  });
}
