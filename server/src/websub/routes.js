import express from 'express';
import { verifyHmac } from './hmac.js';
import { parseAtom } from './atom.js';

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
    const { entries } = parseAtom(xml);

    // channelId from the first parsed entry (tombstone channelId recovery is added in Task 9).
    const channelId = (entries[0] && entries[0].channelId) || null;
    const secret = secretFor(channelId);
    const signature = req.get('X-Hub-Signature');

    if (!verifyHmac(rawBody, signature, secret)) {
      res.status(403).end();
      return;
    }

    res.status(204).end();
  });
}
