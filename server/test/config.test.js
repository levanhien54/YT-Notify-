import { describe, it, expect } from 'vitest';
import { initDb, setSetting } from '../src/db/index.js';
import { DEFAULTS, loadConfig } from '../src/config.js';

describe('config', () => {
  it('exposes the locked DEFAULTS', () => {
    expect(DEFAULTS).toEqual({
      webhookPort: 8787,
      mgmtPort: 5174,
      downloadDir: 'downloads',
      maxConcurrency: 2,
      leaseSeconds: 432000
    });
  });

  it('loadConfig returns DEFAULTS when settings table is empty', () => {
    const db = initDb(':memory:');
    expect(loadConfig(db)).toEqual(DEFAULTS);
  });

  it('loadConfig overrides defaults from settings and coerces numbers', () => {
    const db = initDb(':memory:');
    setSetting(db, 'webhook_port', '9999');
    setSetting(db, 'mgmt_port', '6000');
    setSetting(db, 'download_dir', 'D:/vids');
    setSetting(db, 'max_concurrency', '4');
    setSetting(db, 'lease_seconds', '86400');
    const cfg = loadConfig(db);
    expect(cfg.webhookPort).toBe(9999);
    expect(cfg.mgmtPort).toBe(6000);
    expect(cfg.downloadDir).toBe('D:/vids');
    expect(cfg.maxConcurrency).toBe(4);
    expect(cfg.leaseSeconds).toBe(86400);
  });
});
