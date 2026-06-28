// server/src/bootstrap.js
import { spawn } from 'node:child_process';
import { getChannel } from './db/index.js';
import { DownloadQueue } from './downloader/queue.js';
import { TunnelManager } from './tunnel/manager.js';
import { createWebhookApp } from './webhookApp.js';
import { createMgmtApp } from './mgmtApp.js';
import { resubscribeAll, sendSubscription } from './websub/client.js';
import { resolveChannelId } from './downloader/resolver.js';
import { handleDeleted } from './websub/onDeleted.js';

export const HUB_URL = 'https://pubsubhubbub.appspot.com/subscribe';

export function buildApp({
  db,
  config,
  spawnFn = spawn,
  fetchFn = fetch,
  resubscribeFn = resubscribeAll,
  resolveFn = resolveChannelId,
  sendSubscriptionFn = sendSubscription,
  preflight = [],
}) {
  const secretFor = (channelId) => {
    const ch = getChannel(db, channelId);
    return ch ? ch.secret : undefined;
  };

  const queue = new DownloadQueue({
    db,
    concurrency: config.maxConcurrency,
    downloadDir: config.downloadDir,
    spawnFn,
  });

  const tunnel = new TunnelManager({ port: config.webhookPort, spawnFn });

  const onNewVideo = (row) => {
    if (row) queue.enqueue(row);
  };
  const onDeleted = handleDeleted(db);

  const webhookApp = createWebhookApp({ db, secretFor, onNewVideo, onDeleted });

  // Real wiring for the mgmt channel routes (resolve -> add -> subscribe / unsubscribe).
  const mgmtDeps = {
    config,
    resolveChannelId: resolveFn,
    sendSubscription: sendSubscriptionFn,
    hubUrl: HUB_URL,
    leaseSeconds: config.leaseSeconds,
    fetchFn,
    preflight,
  };
  const mgmtApp = createMgmtApp({ db, tunnel, queue, deps: mgmtDeps });

  function wireTunnelResubscribe() {
    tunnel.on('url', (url) => {
      resubscribeFn({
        db,
        callbackUrl: `${url}/webhook/youtube`,
        hubUrl: HUB_URL,
        leaseSeconds: config.leaseSeconds,
      });
    });
  }

  return {
    db,
    config,
    queue,
    tunnel,
    webhookApp,
    mgmtApp,
    mgmtDeps,
    secretFor,
    onNewVideo,
    onDeleted,
    wireTunnelResubscribe,
  };
}
