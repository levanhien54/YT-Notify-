import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb, addChannel } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';

// fake child shape sufficient for inert construction (constructors do not spawn)
function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 1234;
  return ee;
}

describe('buildApp composition root', () => {
  it('builds queue, tunnel and both express apps with shared deps', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });

    expect(app.db).toBe(db);
    expect(app.queue).toBeTruthy();
    expect(app.tunnel).toBeTruthy();
    expect(typeof app.webhookApp).toBe('function'); // express app is a function
    expect(typeof app.mgmtApp).toBe('function');
    expect(typeof app.secretFor).toBe('function');
    expect(typeof app.wireTunnelResubscribe).toBe('function');
  });

  it('secretFor returns the per-channel secret from the db', () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_z', handle: '@z', title: 'Z', thumbnail: '', secret: 'zsecret' });
    const config = loadConfig(db);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });
    expect(app.secretFor('UC_z')).toBe('zsecret');
    expect(app.secretFor('missing')).toBeUndefined();
  });

  it('wires real resolve + subscribe deps into the mgmt app (not undefined)', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const resolveFn = vi.fn();
    const sendSubscriptionFn = vi.fn();
    // capture the deps createMgmtApp would receive via injected factory spies
    const app = buildApp({
      db,
      config,
      spawnFn: () => fakeSpawn(),
      fetchFn: vi.fn(),
      resolveFn,
      sendSubscriptionFn,
    });
    // mgmt deps are exposed for assertion + downstream wiring
    expect(app.mgmtDeps.resolveChannelId).toBe(resolveFn);
    expect(app.mgmtDeps.sendSubscription).toBe(sendSubscriptionFn);
    expect(app.mgmtDeps.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(app.mgmtDeps.leaseSeconds).toBe(config.leaseSeconds);
  });

  it('wireTunnelResubscribe calls resubscribeFn with the callback url when tunnel emits url', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const resubscribeFn = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn(), resubscribeFn });

    app.wireTunnelResubscribe();
    app.tunnel.emit('url', 'https://abc.trycloudflare.com');

    expect(resubscribeFn).toHaveBeenCalledTimes(1);
    const arg = resubscribeFn.mock.calls[0][0];
    expect(arg.db).toBe(db);
    expect(arg.callbackUrl).toBe('https://abc.trycloudflare.com/webhook/youtube');
    expect(arg.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(arg.leaseSeconds).toBe(config.leaseSeconds);
  });
});
