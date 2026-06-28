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
}
