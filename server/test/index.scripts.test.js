import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

// server/test/index.scripts.test.js -> package root is server/
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../');

describe('npm scripts + entry guard', () => {
  it('package.json defines module type and dev/start/test scripts', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts.start).toMatch(/node .*src\/index\.js/);
    expect(pkg.scripts.dev).toBeTruthy();
  });

  it('index.js exports start() and does NOT bind any port on import', async () => {
    const mgmtPort = 5174;
    const webhookPort = 8787;

    const mod = await import('../src/index.js');
    expect(typeof mod.start).toBe('function');

    // Real assertion that importing did NOT auto-listen: both default ports must be free.
    const free = (port) =>
      new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(port, '127.0.0.1');
      });

    expect(await free(mgmtPort)).toBe(true);
    expect(await free(webhookPort)).toBe(true);
  });
});
