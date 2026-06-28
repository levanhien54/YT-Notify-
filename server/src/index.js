import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Server as IOServer } from 'socket.io';
import { initDb } from './db/index.js';
import { loadConfig } from './config.js';
import { buildApp, HUB_URL } from './bootstrap.js';
import { wireRealtime } from './realtime/bus.js';
import { runLeaseRenewal } from './scheduler/runLease.js';
import { ensureBinaries } from './util/binaries.js';

const LEASE_INTERVAL_MS = 60 * 60 * 1000; // hourly

export async function start({ dbPath = '../yt-notify.db' } = {}) {
  const db = initDb(dbPath);
  const config = loadConfig(db);

  const preflightState = [
    { name: 'cloudflared', found: false, path: null, status: 'checking' },
    { name: 'yt-dlp', found: false, path: null, status: 'checking' },
    { name: 'ffmpeg', found: false, path: null, status: 'checking' }
  ];

  const resolvedPaths = {};
  const customSpawn = (cmd, args, opts) => {
    const realCmd = resolvedPaths[cmd] || cmd;
    return spawn(realCmd, args, opts);
  };

  const app = buildApp({ db, config, spawnFn: customSpawn, preflight: preflightState });

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

  let leaseTimer = null;

  ensureBinaries((name, status) => {
    const pf = preflightState.find(b => b.name === name);
    if (pf) pf.status = status;
  }).then((paths) => {
    Object.assign(resolvedPaths, paths);
    for (const [name, p] of Object.entries(paths)) {
      const pf = preflightState.find(b => b.name === name);
      if (pf) { pf.found = true; pf.path = p; pf.status = 'ready'; }
    }
    
    // Resubscribe-all on every new public url; catch-up on reconnect.
    app.wireTunnelResubscribe();
    app.wireReconnectCatchup();
    app.tunnel.start();

    // Hourly lease renewal (channels expiring within 12h).
    leaseTimer = setInterval(() => {
      const url = app.tunnel.getUrl();
      if (!url) return;
      runLeaseRenewal({
        db,
        callbackUrl: `${url}/webhook/youtube`,
        hubUrl: HUB_URL,
        leaseSeconds: config.leaseSeconds,
      }).catch(() => {});
    }, LEASE_INTERVAL_MS);
  }).catch(err => {
    console.error('[bootstrap] Failed to provision binaries:', err);
  });

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
