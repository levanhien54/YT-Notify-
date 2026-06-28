import { getAllSettings } from './db/index.js';

export const DEFAULTS = {
  webhook_port: 8787,
  mgmt_port: 5174,
  download_dir: process.env.YT_DOWNLOAD_DIR || 'downloads',
  max_concurrency: 2,
  lease_seconds: 432000
};

export function loadConfig(db) {
  const s = getAllSettings(db);
  return {
    webhookPort: s.webhook_port != null ? Number(s.webhook_port) : DEFAULTS.webhook_port,
    mgmtPort: s.mgmt_port != null ? Number(s.mgmt_port) : DEFAULTS.mgmt_port,
    downloadDir: s.download_dir != null ? s.download_dir : DEFAULTS.download_dir,
    maxConcurrency: s.max_concurrency != null ? Number(s.max_concurrency) : DEFAULTS.max_concurrency,
    leaseSeconds: s.lease_seconds != null ? Number(s.lease_seconds) : DEFAULTS.lease_seconds
  };
}
