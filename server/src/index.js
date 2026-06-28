import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Server as IOServer } from 'socket.io';
import { initDb } from './db/index.js';
import { loadConfig } from './config.js';
import { checkBinaries } from './preflight.js';
import { buildApp, HUB_URL } from './bootstrap.js';
import { wireRealtime } from './realtime/bus.js';
import { runLeaseRenewal } from './scheduler/runLease.js';

const LEASE_INTERVAL_MS = 60 * 60 * 1000; // hourly

export async function start({ dbPath = '../yt-notify.db' } = {}) {
  const db = initDb(dbPath);
  const config = loadConfig(db);

  const preflight = checkBinaries(
    ['cloudflared', 'yt-dlp', 'ffmpeg'],
    (name) => process.env[`BIN_${name.toUpperCase()}`] || null
  );
  const missing = preflight.filter((b) => !b.found).map((b) => b.name);
  if (missing.length) console.warn('[preflight] missing binaries:', missing.join(', '));

  const app = buildApp({ db, config, spawnFn: spawn, preflight });

  // Public webhook listener (tunneled).
  const webhookServer = http.createServer(app.webhookApp);
  webhookServer.listen(config.webhookPort, () =>
    console.log(`[webhook] listening on :${config.webhookPort}`)
  );

  // Local management listener (127.0.0.1 only).
  const mgmtServer = http.createServer(app.mgmtApp);
  const io = new IOServer(mgmtServer, { cors: { origin: '*' } });
  wireRealtime(io, { tunnel: app.tunnel, queue: app.queue });
  mgmtServer.listen(config.mgmtPort, '127.0.0.1', () =>
    console.log(`[mgmt] listening on 127.0.0.1:${config.mgmtPort}`)
  );

  // Resubscribe-all on every new public url; catch-up on reconnect.
  app.wireTunnelResubscribe();
  app.wireReconnectCatchup();
  app.tunnel.start();

  // Hourly lease renewal (channels expiring within 12h).
  const leaseTimer = setInterval(() => {
    const url = app.tunnel.getUrl();
    if (!url) return;
    runLeaseRenewal({
      db,
      callbackUrl: `${url}/webhook/youtube`,
      hubUrl: HUB_URL,
      leaseSeconds: config.leaseSeconds,
    }).catch(() => {});
  }, LEASE_INTERVAL_MS);

  function shutdown() {
    clearInterval(leaseTimer);
    // TunnelManager.stop() kills its own child tree per the contract.
    try {
      app.tunnel.stop();
    } catch {
      /* noop */
    }
    webhookServer.close();
    mgmtServer.close();
    io.close();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, webhookServer, mgmtServer, io, shutdown };
}

// Only auto-start when run directly, never on import (keeps tests inert).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
