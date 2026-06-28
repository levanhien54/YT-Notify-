import express from 'express';
import { registerWebhookRoutes } from './websub/routes.js';

export function createWebhookApp({ db, secretFor, onNewVideo, onDeleted }) {
  // Bare public factory. Webhook routes AND per-route body parsing are added in
  // Phase 2 via registerWebhookRoutes(app, {...}); no global parser here because
  // HMAC verification needs the exact raw bytes (handled per-route in Phase 2 Task 8).
  const app = express();
  app.locals.deps = { db, secretFor, onNewVideo, onDeleted };
  registerWebhookRoutes(app, { db, secretFor, onNewVideo, onDeleted });
  return app;
}
