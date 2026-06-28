import { describe, it, expect } from 'vitest';
import { initDb, getSetting, setSetting, getAllSettings } from '../../src/db/index.js';

describe('settings kv', () => {
  it('getSetting returns undefined for an unknown key', () => {
    const db = initDb(':memory:');
    expect(getSetting(db, 'webhook_port')).toBeUndefined();
  });

  it('setSetting inserts then updates (upsert), always returning a string', () => {
    const db = initDb(':memory:');
    setSetting(db, 'webhook_port', '8787');
    expect(getSetting(db, 'webhook_port')).toBe('8787');
    setSetting(db, 'webhook_port', '9000');
    expect(getSetting(db, 'webhook_port')).toBe('9000');
  });

  it('getAllSettings returns a plain key->value object', () => {
    const db = initDb(':memory:');
    setSetting(db, 'mgmt_port', '5174');
    setSetting(db, 'download_dir', 'downloads');
    expect(getAllSettings(db)).toEqual({ mgmt_port: '5174', download_dir: 'downloads' });
  });
});
