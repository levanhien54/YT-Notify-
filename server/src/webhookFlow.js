import { getChannel } from './db/index.js';
import { createWebhookApp } from './webhookApp.js';

export function runWebhookFlow({ db }) {
  // Real per-channel secret resolution from the DB (no arg-ignoring stub).
  const secretFor = (channelId) => {
    if (!channelId) return undefined;
    const ch = getChannel(db, channelId);
    return ch ? ch.secret : undefined;
  };
  const app = createWebhookApp({
    db,
    secretFor,
    onNewVideo: () => {},
    onDeleted: () => {},
  });
  return { app, secretFor };
}
