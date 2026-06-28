import { getAllSettings } from './db/index.js';

export const DEFAULTS = {
  webhookPort: 8787,
  mgmtPort: 5174,
  downloadDir: 'downloads',
  maxConcurrency: 2,
  leaseSeconds: 432000
};

export function loadConfig(db) {
  const s = getAllSettings(db);
  return {
    webhookPort: s.webhook_port != null ? Number(s.webhook_port) : DEFAULTS.webhookPort,
    mgmtPort: s.mgmt_port != null ? Number(s.mgmt_port) : DEFAULTS.mgmtPort,
    downloadDir: s.download_dir != null ? s.download_dir : DEFAULTS.downloadDir,
    maxConcurrency: s.max_concurrency != null ? Number(s.max_concurrency) : DEFAULTS.maxConcurrency,
    leaseSeconds: s.lease_seconds != null ? Number(s.lease_seconds) : DEFAULTS.leaseSeconds
  };
}
