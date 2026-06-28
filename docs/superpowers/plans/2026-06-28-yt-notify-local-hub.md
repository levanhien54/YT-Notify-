# YT-Notify Local Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local single-user Windows app that receives YouTube WebSub notifications through a Cloudflare Quick Tunnel and auto-downloads new videos, with a realtime React dashboard.

**Architecture:** One Node process runs TWO HTTP listeners sharing a SQLite DB, a download queue, and a Socket.io event bus: a public Webhook listener (port 8787, the only thing cloudflared tunnels) and a local Management listener (port 5174, REST + Socket.io + React build, bound to 127.0.0.1). Because Quick Tunnel URLs change on every (re)connect, a tunnel watcher re-subscribes all active channels whenever the public URL changes; an hourly scheduler renews expiring leases and a reconnect catch-up backfills missed videos via RSS.

**Tech Stack:** Node.js 18+ (ESM), Express, better-sqlite3, socket.io, fast-xml-parser, native fetch/crypto/child_process; React 18 + Vite + Tailwind + lucide-react + socket.io-client; external binaries cloudflared, yt-dlp, ffmpeg. Tests: vitest + supertest (server), vitest + @testing-library/react + jsdom (client).

## Global Constraints

- Node.js **18+**; server and client are both **ESM** (`"type":"module"`).
- Server runtime deps (exact): `express`, `better-sqlite3` (synchronous API), `socket.io`, `fast-xml-parser`. Server dev deps: `vitest`, `supertest`.
- Client deps: React 18, `vite`, `tailwindcss`, `lucide-react`, `socket.io-client`; client test deps: `vitest`, `@testing-library/react`, `jsdom`.
- **Test working directory = `server/`** for all server tests. Run one file: `npx vitest run <path>`. Run all: `npm test` (script: `vitest run`).
- Tests must NEVER hit the real network or spawn real binaries: inject `spawnFn`/`fetchFn`, mock with vitest (`vi.mock('node:child_process')`, `vi.spyOn(globalThis,'fetch')`), use `supertest` for HTTP handlers, and `better-sqlite3` `':memory:'` for DB tests.
- Conventional commit messages; commit at the end of every task.
- **Two listeners, one process:** Public Webhook port **8787** serves ONLY `GET/POST /webhook/youtube` and is the only port cloudflared tunnels. Local Management port **5174** serves REST + Socket.io + `client/dist`, bound to `127.0.0.1`, never tunneled.
- WebSub hub URL (exact): `https://pubsubhubbub.appspot.com/subscribe`. Topic URL: `https://www.youtube.com/feeds/videos.xml?channel_id=<UC...>`.
- Webhook POST: read RAW body, verify `X-Hub-Signature` HMAC-SHA1 against the per-channel `hub.secret`; reject mismatch with **403**; respond **204** then process async; dedup by `videoId` (metadata-only updates do NOT re-download); handle `at:deleted-entry`.
- Default config (`DEFAULTS`): `webhookPort:8787, mgmtPort:5174, downloadDir:'downloads', maxConcurrency:2, leaseSeconds:432000`.
- yt-dlp format string (exact): `-f "bv*+ba/b" --merge-output-format mp4 --newline --download-archive <archive>`.
- Windows shutdown: kill child process trees with `taskkill /PID <pid> /T /F`. Thumbnails: `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`.

## Cross-Phase Conventions & Reconciliation (READ FIRST)

The phases below were authored independently; these rules are the single source of truth wherever two tasks appear to touch the same file.

1. **One npm project, in `server/`.** `server/package.json` and `server/vitest.config.js` are created ONCE in **Phase 0 Task 1** (config uses `include: ['test/**/*.test.js']`). There is NO repo-root `vitest.config.js` and NO second `package.json`; any later "scaffolding" mention is superseded by Phase 0.
2. **Working directories.** Run ALL `npx vitest …` / `npm …` commands with **cwd = `server/`**; test paths are relative to `server/` (e.g. `npx vitest run test/tunnel/parser.test.js`). If a task prints a path like `server/test/<x>`, run it from `server/` as `test/<x>`. Run ALL `git` commands from the **repo root** with full repo-relative paths (`git add server/src/...`). The React client (Phase 4) is a SEPARATE npm project under `client/`; run its tests with cwd = `client/`.
3. **`server/src/webhookApp.js` owner = Phase 0 Task 11** (bare factory, NO global body parser). **Phase 2 Task 7 MODIFIES** it to register routes; **Phase 2 Task 8** adds the POST handler with per-route `express.raw`. No global raw parser exists anywhere.
4. **`server/src/scheduler/catchup.js` owner = Phase 2 Tasks 11–12** (both `findMissedVideos` + `fetchChannelRss`). Phase 5 reuses it and does NOT recreate it.
5. **`server/src/mgmtApp.js`**: Phase 0 Task 12 creates the bare factory; **Phase 3.5 Task 7 MODIFIES** it to call `registerMgmtRoutes` and serve `client/dist`. The `/api/*` REST surface lives in `server/src/mgmtRoutes.js` (Phase 3.5).
6. **Phase ordering.** Implement in this order: 0 → 1 → 2 → 3 → **3.5 (Management REST API)** → 4 → 5. Phase 3.5 MUST precede Phase 4 because the React UI consumes the `/api/*` endpoints.

## File Structure

```
server/
  package.json, vitest.config.js
  src/
    index.js              # bootstrap: preflight -> db -> config -> queue -> tunnel -> 2 listeners -> socket.io -> wireRealtime -> resubscribe on url change -> lease scheduler -> graceful shutdown
    version.js
    config.js             # DEFAULTS + loadConfig(db)
    preflight.js          # checkBinaries(names, resolver)
    db/index.js           # initDb + channels/videos/settings repos
    tunnel/parser.js      # parseTunnelUrl(line)  [pure]
    tunnel/manager.js     # TunnelManager (EventEmitter)
    websub/topic.js       # buildTopicUrl  [pure]
    websub/params.js      # buildSubscribeForm  [pure]
    websub/hmac.js        # verifyHmac  [pure]
    websub/atom.js        # parseAtom  [pure]
    websub/client.js      # sendSubscription, resubscribeAll
    websub/routes.js      # registerWebhookRoutes (GET verify + POST notify)
    scheduler/lease.js    # findExpiringChannels  [pure] + renewal wiring
    scheduler/catchup.js  # findMissedVideos [pure] + fetchChannelRss
    downloader/progress.js# parseProgress  [pure]
    downloader/args.js    # buildYtdlpArgs  [pure]
    downloader/resolver.js# resolveChannelId
    downloader/queue.js   # DownloadQueue (EventEmitter)
    realtime/bus.js       # wireRealtime(io, emitters)
    webhookApp.js         # createWebhookApp  (public)
    mgmtApp.js            # createMgmtApp     (local REST + serve client)
  test/                   # mirrors src/ ; vitest
  bin/                    # (optional) cloudflared.exe, yt-dlp.exe, ffmpeg.exe
client/
  src/ api.js, socket.js, App.jsx, components/*  ; tests via @testing-library/react
scripts/mock-webhook.js   # signs + POSTs a sample Atom payload for e2e testing
docs/superpowers/{specs,plans}/
```

---

## Phase 0: Preflight & Scaffolding

> **Working-directory conventions (apply to every task):**
> - All `npx vitest run ...` and `npm ...` commands run with **cwd = `server/`**. Test paths are written relative to `server/` (e.g. `test/db/init.test.js`), matching `vitest.config.js` `include: ['test/**/*.test.js']` and the `../src/...` imports.
> - All `git` commands run with **cwd = repo root**, using full repo-relative paths (e.g. `server/src/db/index.js`).

### Task 1: Server project init (ESM + vitest + git)

**Files:**
- Create: `server/package.json`
- Create: `server/vitest.config.js`
- Create: `.gitignore`
- Create: `server/src/version.js`
- Test: `server/test/scaffold.test.js`

**Interfaces:**
- Consumes: nothing (root task)
- Produces: ESM-configured `server` workspace; `export const VERSION` from `server/src/version.js` (sanity import target proving ESM + vitest wiring); locked tech-stack dependencies in `package.json`

- [ ] **Step 1: Write the failing test**
```js
// server/test/scaffold.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { VERSION } from '../src/version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPkg() {
  return JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
}

describe('server scaffold', () => {
  it('package.json declares ESM and the vitest test script', () => {
    const pkg = readPkg();
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('declares the locked runtime dependencies', () => {
    const deps = readPkg().dependencies ?? {};
    expect(deps).toHaveProperty('express');
    expect(deps).toHaveProperty('better-sqlite3');
    expect(deps).toHaveProperty('socket.io');
    expect(deps).toHaveProperty('fast-xml-parser');
  });

  it('declares the locked dev/test dependencies', () => {
    const dev = readPkg().devDependencies ?? {};
    expect(dev).toHaveProperty('vitest');
    expect(dev).toHaveProperty('supertest');
  });

  it('exposes a string VERSION via ESM import', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2: Install dependencies**
Run (cwd = `server/`): `npm install`
Expected: `node_modules/` and a lockfile are created; `vitest`, `supertest`, `express`, `better-sqlite3`, `socket.io`, `fast-xml-parser` resolve so the test runner can execute. (This action must precede the first `npx vitest run` so the RED run is clean rather than fetching vitest on the fly.)
- [ ] **Step 3: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/scaffold.test.js`
Expected: FAIL — cannot resolve `../src/version.js` (module does not exist).
- [ ] **Step 4: Write minimal implementation**
```json
// server/package.json
{
  "name": "yt-notify-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "start": "node src/index.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "express": "^4.19.2",
    "fast-xml-parser": "^4.4.1",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^2.0.5"
  }
}
```
```js
// server/vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js']
  }
});
```
```js
// server/src/version.js
export const VERSION = '0.1.0';
```
```
# .gitignore
node_modules/
downloads/
*.sqlite
*.sqlite3
*.db
server/bin/
client/dist/
.DS_Store
```
(If `npm install` in Step 2 ran before `package.json` existed, re-run `npm install` in `server/` now so the locked deps are installed.)
- [ ] **Step 5: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/scaffold.test.js`
Expected: PASS
- [ ] **Step 6: Commit**
```bash
# cwd = repo root
git init
git add .gitignore server/package.json server/vitest.config.js server/src/version.js server/test/scaffold.test.js
git commit -m "chore(scaffold): init server ESM workspace with vitest and locked deps"
```

---

### Task 2: DB init + schema (initDb)

**Files:**
- Create: `server/src/db/index.js`
- Test: `server/test/db/init.test.js`

**Interfaces:**
- Consumes: better-sqlite3 (synchronous)
- Produces: `initDb(filePath)` -> db handle; creates `channels`, `videos`, `settings` tables if absent; accepts `':memory:'`

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/init.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import { initDb } from '../../src/db/index.js';

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

describe('initDb', () => {
  it('creates the three core tables in :memory:', () => {
    const db = initDb(':memory:');
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['channels', 'videos', 'settings']));
  });

  it('channels table has the contract columns', () => {
    const db = initDb(':memory:');
    expect(tableColumns(db, 'channels')).toEqual(
      expect.arrayContaining([
        'channel_id', 'handle', 'title', 'thumbnail', 'active', 'secret',
        'subscribed_at', 'lease_expires_at', 'last_video_published_at', 'created_at'
      ])
    );
  });

  it('videos and settings tables have the contract columns', () => {
    const db = initDb(':memory:');
    expect(tableColumns(db, 'videos')).toEqual(
      expect.arrayContaining([
        'video_id', 'channel_id', 'title', 'published_at', 'updated_at',
        'thumbnail_url', 'status', 'download_path', 'retries', 'error', 'created_at'
      ])
    );
    expect(tableColumns(db, 'settings')).toEqual(
      expect.arrayContaining(['key', 'value'])
    );
  });

  it('is idempotent (calling twice does not throw)', () => {
    const db = initDb(':memory:');
    expect(() => initDb(':memory:')).not.toThrow();
    expect(db).toBeTruthy();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/init.test.js`
Expected: FAIL — cannot resolve `../../src/db/index.js` (no module yet).
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js
import Database from 'better-sqlite3';

export function initDb(filePath) {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      channel_id TEXT PRIMARY KEY,
      handle TEXT,
      title TEXT,
      thumbnail TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      secret TEXT,
      subscribed_at INTEGER,
      lease_expires_at INTEGER,
      last_video_published_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS videos (
      video_id TEXT PRIMARY KEY,
      channel_id TEXT,
      title TEXT,
      published_at INTEGER,
      updated_at INTEGER,
      thumbnail_url TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      download_path TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/init.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/init.test.js
git commit -m "feat(db): initDb creates channels/videos/settings schema"
```

---

### Task 3: Channel write/read functions (addChannel, getChannel, listChannels)

**Files:**
- Modify: `server/src/db/index.js` (append functions)
- Test: `server/test/db/channels-crud.test.js`

**Interfaces:**
- Consumes: `initDb(':memory:')`
- Produces:
  - `addChannel(db, {channelId, handle, title, thumbnail, secret})` -> channel row (active=1, created_at set)
  - `getChannel(db, channelId)` -> row | undefined
  - `listChannels(db)` -> row[]

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/channels-crud.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import { initDb, addChannel, getChannel, listChannels } from '../../src/db/index.js';

const sample = {
  channelId: 'UC123',
  handle: '@creator',
  title: 'Creator',
  thumbnail: 'http://t/x.jpg',
  secret: 's3cr3t'
};

describe('channels add/get/list', () => {
  it('addChannel returns the inserted row with defaults', () => {
    const db = initDb(':memory:');
    const row = addChannel(db, sample);
    expect(row.channel_id).toBe('UC123');
    expect(row.handle).toBe('@creator');
    expect(row.title).toBe('Creator');
    expect(row.thumbnail).toBe('http://t/x.jpg');
    expect(row.secret).toBe('s3cr3t');
    expect(row.active).toBe(1);
    expect(typeof row.created_at).toBe('number');
  });

  it('getChannel returns the row, or undefined when absent', () => {
    const db = initDb(':memory:');
    addChannel(db, sample);
    expect(getChannel(db, 'UC123').title).toBe('Creator');
    expect(getChannel(db, 'NOPE')).toBeUndefined();
  });

  it('listChannels returns all rows', () => {
    const db = initDb(':memory:');
    addChannel(db, sample);
    addChannel(db, { ...sample, channelId: 'UC999', title: 'Other' });
    const all = listChannels(db);
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.channel_id).sort()).toEqual(['UC123', 'UC999']);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/channels-crud.test.js`
Expected: FAIL — `addChannel` is not exported from `db/index.js`.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js  (append below initDb)

export function addChannel(db, { channelId, handle, title, thumbnail, secret }) {
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO channels (channel_id, handle, title, thumbnail, active, secret, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(channelId, handle, title, thumbnail, secret, createdAt);
  return getChannel(db, channelId);
}

export function getChannel(db, channelId) {
  return db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId);
}

export function listChannels(db) {
  return db.prepare('SELECT * FROM channels ORDER BY created_at ASC').all();
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/channels-crud.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/channels-crud.test.js
git commit -m "feat(db): addChannel/getChannel/listChannels"
```

---

### Task 4: Channel active state functions (listActiveChannels, setChannelActive, removeChannel)

**Files:**
- Modify: `server/src/db/index.js` (append functions)
- Test: `server/test/db/channels-active.test.js`

**Interfaces:**
- Consumes: `addChannel`, `getChannel`, `listChannels`
- Produces:
  - `listActiveChannels(db)` -> row[] where active=1
  - `setChannelActive(db, channelId, active /*bool*/)`
  - `removeChannel(db, channelId)`

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/channels-active.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import {
  initDb, addChannel, getChannel, listChannels,
  listActiveChannels, setChannelActive, removeChannel
} from '../../src/db/index.js';

function seed(db) {
  addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: '', secret: 's1' });
  addChannel(db, { channelId: 'UC2', handle: '@b', title: 'B', thumbnail: '', secret: 's2' });
}

describe('channels active/remove', () => {
  it('listActiveChannels excludes deactivated channels', () => {
    const db = initDb(':memory:');
    seed(db);
    setChannelActive(db, 'UC2', false);
    const active = listActiveChannels(db);
    expect(active.map((r) => r.channel_id)).toEqual(['UC1']);
  });

  it('setChannelActive flips the flag back to 1', () => {
    const db = initDb(':memory:');
    seed(db);
    setChannelActive(db, 'UC1', false);
    expect(getChannel(db, 'UC1').active).toBe(0);
    setChannelActive(db, 'UC1', true);
    expect(getChannel(db, 'UC1').active).toBe(1);
  });

  it('removeChannel deletes the row', () => {
    const db = initDb(':memory:');
    seed(db);
    removeChannel(db, 'UC1');
    expect(getChannel(db, 'UC1')).toBeUndefined();
    expect(listChannels(db)).toHaveLength(1);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/channels-active.test.js`
Expected: FAIL — `listActiveChannels` not exported.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js  (append)

export function listActiveChannels(db) {
  return db.prepare('SELECT * FROM channels WHERE active = 1 ORDER BY created_at ASC').all();
}

export function setChannelActive(db, channelId, active) {
  db.prepare('UPDATE channels SET active = ? WHERE channel_id = ?')
    .run(active ? 1 : 0, channelId);
}

export function removeChannel(db, channelId) {
  db.prepare('DELETE FROM channels WHERE channel_id = ?').run(channelId);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/channels-active.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/channels-active.test.js
git commit -m "feat(db): listActiveChannels/setChannelActive/removeChannel"
```

---

### Task 5: Channel subscription & last-video bookkeeping (updateChannelSubscription, updateLastVideoPublishedAt)

**Files:**
- Modify: `server/src/db/index.js` (append functions)
- Test: `server/test/db/channels-subscription.test.js`

**Interfaces:**
- Consumes: `addChannel`, `getChannel`
- Produces:
  - `updateChannelSubscription(db, channelId, {subscribedAt, leaseExpiresAt})`
  - `updateLastVideoPublishedAt(db, channelId, publishedAt /*ms*/)`

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/channels-subscription.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import {
  initDb, addChannel, getChannel,
  updateChannelSubscription, updateLastVideoPublishedAt
} from '../../src/db/index.js';

function seed(db) {
  addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: '', secret: 's1' });
}

describe('channel subscription bookkeeping', () => {
  it('updateChannelSubscription stores subscribed_at + lease_expires_at', () => {
    const db = initDb(':memory:');
    seed(db);
    updateChannelSubscription(db, 'UC1', { subscribedAt: 1000, leaseExpiresAt: 433000 });
    const row = getChannel(db, 'UC1');
    expect(row.subscribed_at).toBe(1000);
    expect(row.lease_expires_at).toBe(433000);
  });

  it('updateLastVideoPublishedAt stores the timestamp', () => {
    const db = initDb(':memory:');
    seed(db);
    updateLastVideoPublishedAt(db, 'UC1', 1719500000000);
    expect(getChannel(db, 'UC1').last_video_published_at).toBe(1719500000000);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/channels-subscription.test.js`
Expected: FAIL — `updateChannelSubscription` not exported.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js  (append)

export function updateChannelSubscription(db, channelId, { subscribedAt, leaseExpiresAt }) {
  db.prepare(`
    UPDATE channels SET subscribed_at = ?, lease_expires_at = ? WHERE channel_id = ?
  `).run(subscribedAt, leaseExpiresAt, channelId);
}

export function updateLastVideoPublishedAt(db, channelId, publishedAt) {
  db.prepare('UPDATE channels SET last_video_published_at = ? WHERE channel_id = ?')
    .run(publishedAt, channelId);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/channels-subscription.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/channels-subscription.test.js
git commit -m "feat(db): updateChannelSubscription/updateLastVideoPublishedAt"
```

---

### Task 6: Video dedup insert (upsertVideoIfNew, getVideo, listVideos)

**Files:**
- Modify: `server/src/db/index.js` (append functions)
- Test: `server/test/db/videos-upsert.test.js`

**Interfaces:**
- Consumes: `initDb(':memory:')`
- Produces:
  - `upsertVideoIfNew(db, {videoId, channelId, title, publishedAt, updatedAt, thumbnailUrl})` -> `{row, isNew:boolean}`
  - `getVideo(db, videoId)` -> row | undefined
  - `listVideos(db, {limit})` -> row[] newest first

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/videos-upsert.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import { initDb, upsertVideoIfNew, getVideo, listVideos } from '../../src/db/index.js';

const v = {
  videoId: 'vid1',
  channelId: 'UC1',
  title: 'First',
  publishedAt: 2000,
  updatedAt: 2000,
  thumbnailUrl: 'http://t/1.jpg'
};

describe('upsertVideoIfNew', () => {
  it('inserts a new video with isNew=true and status new', () => {
    const db = initDb(':memory:');
    const { row, isNew } = upsertVideoIfNew(db, v);
    expect(isNew).toBe(true);
    expect(row.video_id).toBe('vid1');
    expect(row.status).toBe('new');
    expect(row.retries).toBe(0);
  });

  it('second call with same videoId reports isNew=false (metadata-only update)', () => {
    const db = initDb(':memory:');
    upsertVideoIfNew(db, v);
    const { row, isNew } = upsertVideoIfNew(db, { ...v, title: 'Edited', updatedAt: 3000 });
    expect(isNew).toBe(false);
    expect(row.title).toBe('Edited');
    expect(row.updated_at).toBe(3000);
    expect(row.status).toBe('new'); // status untouched -> no re-download
  });

  it('getVideo returns row or undefined', () => {
    const db = initDb(':memory:');
    upsertVideoIfNew(db, v);
    expect(getVideo(db, 'vid1').title).toBe('First');
    expect(getVideo(db, 'nope')).toBeUndefined();
  });

  it('listVideos returns newest first, limited', () => {
    const db = initDb(':memory:');
    upsertVideoIfNew(db, { ...v, videoId: 'a', publishedAt: 100 });
    upsertVideoIfNew(db, { ...v, videoId: 'b', publishedAt: 300 });
    upsertVideoIfNew(db, { ...v, videoId: 'c', publishedAt: 200 });
    const rows = listVideos(db, { limit: 2 });
    expect(rows.map((r) => r.video_id)).toEqual(['b', 'c']);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/videos-upsert.test.js`
Expected: FAIL — `upsertVideoIfNew` not exported.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js  (append)

export function getVideo(db, videoId) {
  return db.prepare('SELECT * FROM videos WHERE video_id = ?').get(videoId);
}

export function upsertVideoIfNew(db, { videoId, channelId, title, publishedAt, updatedAt, thumbnailUrl }) {
  const existing = getVideo(db, videoId);
  if (existing) {
    db.prepare(`
      UPDATE videos SET title = ?, updated_at = ?, thumbnail_url = ? WHERE video_id = ?
    `).run(title, updatedAt, thumbnailUrl, videoId);
    return { row: getVideo(db, videoId), isNew: false };
  }
  db.prepare(`
    INSERT INTO videos
      (video_id, channel_id, title, published_at, updated_at, thumbnail_url, status, retries, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'new', 0, ?)
  `).run(videoId, channelId, title, publishedAt, updatedAt, thumbnailUrl, Date.now());
  return { row: getVideo(db, videoId), isNew: true };
}

export function listVideos(db, { limit } = {}) {
  if (limit != null) {
    return db.prepare('SELECT * FROM videos ORDER BY published_at DESC LIMIT ?').all(limit);
  }
  return db.prepare('SELECT * FROM videos ORDER BY published_at DESC').all();
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/videos-upsert.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/videos-upsert.test.js
git commit -m "feat(db): upsertVideoIfNew dedup + getVideo/listVideos"
```

---

### Task 7: Video status & retry mutations (updateVideoStatus, incrementRetries)

**Files:**
- Modify: `server/src/db/index.js` (append functions)
- Test: `server/test/db/videos-status.test.js`

**Interfaces:**
- Consumes: `upsertVideoIfNew`, `getVideo`
- Produces:
  - `updateVideoStatus(db, videoId, status, {downloadPath, error}={})`
  - `incrementRetries(db, videoId)` -> new retries count

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/videos-status.test.js  (cwd for runs: server/)
import { describe, it, expect } from 'vitest';
import {
  initDb, upsertVideoIfNew, getVideo,
  updateVideoStatus, incrementRetries
} from '../../src/db/index.js';

function seed(db) {
  upsertVideoIfNew(db, {
    videoId: 'vid1', channelId: 'UC1', title: 'T',
    publishedAt: 1, updatedAt: 1, thumbnailUrl: ''
  });
}

describe('video status + retries', () => {
  it('updateVideoStatus sets status and optional downloadPath', () => {
    const db = initDb(':memory:');
    seed(db);
    updateVideoStatus(db, 'vid1', 'done', { downloadPath: 'C:/dl/vid1.mp4' });
    const row = getVideo(db, 'vid1');
    expect(row.status).toBe('done');
    expect(row.download_path).toBe('C:/dl/vid1.mp4');
  });

  it('updateVideoStatus records an error message on failure', () => {
    const db = initDb(':memory:');
    seed(db);
    updateVideoStatus(db, 'vid1', 'failed', { error: 'premiere not ready' });
    const row = getVideo(db, 'vid1');
    expect(row.status).toBe('failed');
    expect(row.error).toBe('premiere not ready');
  });

  it('incrementRetries returns the new count each call', () => {
    const db = initDb(':memory:');
    seed(db);
    expect(incrementRetries(db, 'vid1')).toBe(1);
    expect(incrementRetries(db, 'vid1')).toBe(2);
    expect(getVideo(db, 'vid1').retries).toBe(2);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/videos-status.test.js`
Expected: FAIL — `updateVideoStatus` not exported.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js  (append)

export function updateVideoStatus(db, videoId, status, { downloadPath, error } = {}) {
  db.prepare(`
    UPDATE videos
       SET status = ?,
           download_path = COALESCE(?, download_path),
           error = COALESCE(?, error)
     WHERE video_id = ?
  `).run(status, downloadPath ?? null, error ?? null, videoId);
}

export function incrementRetries(db, videoId) {
  db.prepare('UPDATE videos SET retries = retries + 1 WHERE video_id = ?').run(videoId);
  return getVideo(db, videoId).retries;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/videos-status.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/videos-status.test.js
git commit -m "feat(db): updateVideoStatus/incrementRetries"
```

---

### Task 8: Settings key/value functions (getSetting, setSetting, getAllSettings)

**Files:**
- Modify: `server/src/db/index.js` (append functions)
- Test: `server/test/db/settings.test.js`

**Interfaces:**
- Consumes: `initDb(':memory:')`
- Produces:
  - `getSetting(db, key)` -> string | undefined
  - `setSetting(db, key, value)` (upsert)
  - `getAllSettings(db)` -> `{key:value}`

- [ ] **Step 1: Write the failing test**
```js
// server/test/db/settings.test.js  (cwd for runs: server/)
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
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/db/settings.test.js`
Expected: FAIL — `getSetting` not exported.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/db/index.js  (append)

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

export function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/db/settings.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/db/index.js server/test/db/settings.test.js
git commit -m "feat(db): getSetting/setSetting/getAllSettings kv store"
```

---

### Task 9: Config defaults + loadConfig

**Files:**
- Create: `server/src/config.js`
- Test: `server/test/config.test.js`

**Interfaces:**
- Consumes: `initDb`, `setSetting` from `server/src/db/index.js`
- Produces:
  - `DEFAULTS = { webhookPort:8787, mgmtPort:5174, downloadDir:'downloads', maxConcurrency:2, leaseSeconds:432000 }`
  - `loadConfig(db)` -> config object (DEFAULTS merged with settings table; numeric fields coerced to Number)

- [ ] **Step 1: Write the failing test**
```js
// server/test/config.test.js  (cwd for runs: server/)
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
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/config.test.js`
Expected: FAIL — cannot resolve `../src/config.js`.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/config.js
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
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/config.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/config.js server/test/config.test.js
git commit -m "feat(config): DEFAULTS + loadConfig merge with settings table"
```

---

### Task 10: Preflight binary check (checkBinaries — PURE, injected resolver)

**Files:**
- Create: `server/src/preflight.js`
- Test: `server/test/preflight.test.js`

**Interfaces:**
- Consumes: nothing (pure)
- Produces: `checkBinaries(names, resolver)` where `resolver(name)->path|null`; returns `{name, found, path}[]`

- [ ] **Step 1: Write the failing test**
```js
// server/test/preflight.test.js  (cwd for runs: server/)
import { describe, it, expect, vi } from 'vitest';
import { checkBinaries } from '../src/preflight.js';

describe('checkBinaries (pure, injected resolver)', () => {
  it('maps each name to found/path using the resolver', () => {
    const resolver = vi.fn((name) =>
      name === 'cloudflared' ? 'C:/bin/cloudflared.exe' : null
    );
    const result = checkBinaries(['cloudflared', 'yt-dlp', 'ffmpeg'], resolver);
    expect(result).toEqual([
      { name: 'cloudflared', found: true, path: 'C:/bin/cloudflared.exe' },
      { name: 'yt-dlp', found: false, path: null },
      { name: 'ffmpeg', found: false, path: null }
    ]);
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it('treats undefined resolver result as not found', () => {
    const resolver = () => undefined;
    expect(checkBinaries(['x'], resolver)).toEqual([
      { name: 'x', found: false, path: null }
    ]);
  });

  it('returns an empty array for no names', () => {
    expect(checkBinaries([], () => null)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/preflight.test.js`
Expected: FAIL — cannot resolve `../src/preflight.js`.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/preflight.js
export function checkBinaries(names, resolver) {
  return names.map((name) => {
    const resolved = resolver(name);
    const path = resolved || null;
    return { name, found: Boolean(path), path };
  });
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/preflight.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/preflight.js server/test/preflight.test.js
git commit -m "feat(preflight): pure checkBinaries with injected resolver"
```

---

### Task 11: Public webhook app factory (createWebhookApp)

**Files:**
- Create: `server/src/webhookApp.js`
- Test: `server/test/webhookApp.test.js`

**Interfaces:**
- Consumes: express; `initDb(':memory:')`
- Produces: `createWebhookApp({ db, secretFor, onNewVideo, onDeleted })` -> a **bare** express app (public). Body parsing is added **per-route** in Phase 2 (Task 8 mounts `express.raw` on the POST handler so HMAC sees the exact bytes); do NOT mount a global parser here. Webhook GET/POST handlers are registered in **Phase 2** via `registerWebhookRoutes(app, {...})`.

- [ ] **Step 1: Write the failing test**
```js
// server/test/webhookApp.test.js  (cwd for runs: server/)
// Phase 0 proves only that the factory returns a usable express app. Routes and
// per-route body parsing are added in Phase 2 (registerWebhookRoutes + express.raw).
import { describe, it, expect } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createWebhookApp } from '../src/webhookApp.js';

function makeApp() {
  const db = initDb(':memory:');
  return createWebhookApp({
    db,
    secretFor: () => 'secret',
    onNewVideo: () => {},
    onDeleted: () => {}
  });
}

describe('createWebhookApp', () => {
  it('returns a callable express app (request handler function)', () => {
    const app = makeApp();
    expect(typeof app).toBe('function');
    expect(typeof app.use).toBe('function');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/webhookApp.test.js`
Expected: FAIL — cannot resolve `../src/webhookApp.js`.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/webhookApp.js
import express from 'express';

export function createWebhookApp({ db, secretFor, onNewVideo, onDeleted }) {
  // Bare public factory. Webhook routes AND per-route body parsing are added in
  // Phase 2 via registerWebhookRoutes(app, {...}); no global parser here because
  // HMAC verification needs the exact raw bytes (handled per-route in Phase 2 Task 8).
  const app = express();
  app.locals.deps = { db, secretFor, onNewVideo, onDeleted };
  return app;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/webhookApp.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/webhookApp.js server/test/webhookApp.test.js
git commit -m "feat(webhook): createWebhookApp factory with express.raw body"
```

---

### Task 12: Local management app factory (createMgmtApp)

**Files:**
- Create: `server/src/mgmtApp.js`
- Test: `server/test/mgmtApp.test.js`

**Interfaces:**
- Consumes: express; `initDb(':memory:')`
- Produces: `createMgmtApp({ db, tunnel, queue, deps })` -> express app with `express.json()` mounted. REST API (`/api/*`), Socket.io wiring, and static `client/dist` serving are added in later phases.

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmtApp.test.js  (cwd for runs: server/)
// Verifies only contract-specified Phase 0 behavior: the factory returns an
// express app with express.json mounted. No invented /health route or body.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { initDb } from '../src/db/index.js';
import { createMgmtApp } from '../src/mgmtApp.js';

function makeApp() {
  const db = initDb(':memory:');
  return createMgmtApp({ db, tunnel: null, queue: null, deps: {} });
}

describe('createMgmtApp', () => {
  it('returns a callable express app (request handler function)', () => {
    const app = makeApp();
    expect(typeof app).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('parses JSON bodies (express.json mounted)', async () => {
    const app = makeApp();
    // Test-only probe route to confirm the JSON parser is active. Not part of
    // the public REST contract; mounted only inside this test.
    app.post('/__echo', (req, res) => res.json(req.body));
    const res = await request(app).post('/__echo').send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ a: 1 });
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run (cwd = `server/`): `npx vitest run test/mgmtApp.test.js`
Expected: FAIL — cannot resolve `../src/mgmtApp.js`.
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/mgmtApp.js
import express from 'express';

export function createMgmtApp({ db, tunnel, queue, deps }) {
  const app = express();
  app.use(express.json());

  // REST API (/api/*), Socket.io, and static client/dist serving are wired
  // in later phases. Keep references available to those routes.
  app.locals.deps = { db, tunnel, queue, ...deps };

  return app;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run (cwd = `server/`): `npx vitest run test/mgmtApp.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
# cwd = repo root
git add server/src/mgmtApp.js server/test/mgmtApp.test.js
git commit -m "feat(mgmt): createMgmtApp factory with express.json"
```

---

### Task 13: Phase 0 verification gate (full suite — NOT a TDD task)

> This is a non-TDD **verification gate**, not a Write-failing-test/verify-fail cycle. It produces no module and no new test; it only confirms the whole Phase 0 suite is green before moving on. The per-task RED→GREEN commits in Tasks 1–12 already prove each unit fails-then-passes — this gate adds no fake RED phase.

**Files:**
- Modify: none (verification only)
- Test: runs the entire `server/test` suite via `npm test`

**Interfaces:**
- Consumes: every module produced in Tasks 1–12
- Produces: confirmation that `npm test` passes for the whole DB layer, config, preflight, and both app factories (no new exports)

- [ ] **Step 1: Run the full suite**
Run (cwd = `server/`): `npm test`
Expected: PASS — all of `scaffold`, `db/init`, `db/channels-crud`, `db/channels-active`, `db/channels-subscription`, `db/videos-upsert`, `db/videos-status`, `db/settings`, `config`, `preflight`, `webhookApp`, `mgmtApp` are green. If any file fails, the failing file name pinpoints the regression to fix in its owning task before proceeding.
- [ ] **Step 2: Commit the gate marker**
```bash
# cwd = repo root — explicit file list (never git add -A)
git add server/package.json server/vitest.config.js
git commit -m "test(phase0): verify full suite green — db, config, preflight, app factories" --allow-empty
```

---

## Phase 1: Tunnel Core

### Task 1: `parseTunnelUrl` (PURE)

**Files:**
- Create: `server/src/tunnel/parser.js`
- Test: `server/test/tunnel/parser.test.js`

**Interfaces:**
- Consumes: the Phase 0 scaffold — `server/package.json` and `server/vitest.config.js` from **Phase 0 Task 1**. Do NOT recreate them and do NOT add a repo-root `vitest.config.js`.
- Produces: `parseTunnelUrl(line: string) -> 'https://x.trycloudflare.com' | null` (PURE)

- [ ] **Step 1: Write the failing test**
```js
// server/test/tunnel/parser.test.js
import { describe, it, expect } from 'vitest';
import { parseTunnelUrl } from '../../src/tunnel/parser.js';

describe('parseTunnelUrl', () => {
  it('parses a plain https trycloudflare url line', () => {
    const line = '2024-01-01T00:00:00Z INF https://happy-cat-test.trycloudflare.com';
    expect(parseTunnelUrl(line)).toBe('https://happy-cat-test.trycloudflare.com');
  });

  it('parses the boxed cloudflared banner line (with | borders and spaces)', () => {
    const line = '|  https://random-words-here-1234.trycloudflare.com                         |';
    expect(parseTunnelUrl(line)).toBe('https://random-words-here-1234.trycloudflare.com');
  });

  it('parses a url embedded in a sentence', () => {
    const line = 'Your quick Tunnel has been created! Visit it at https://abc-def-ghi.trycloudflare.com to test';
    expect(parseTunnelUrl(line)).toBe('https://abc-def-ghi.trycloudflare.com');
  });

  it('strips a trailing slash from the matched url', () => {
    const line = 'INF |  https://foo-bar-baz.trycloudflare.com/  |';
    expect(parseTunnelUrl(line)).toBe('https://foo-bar-baz.trycloudflare.com');
  });

  it('returns null for a line with no tunnel url', () => {
    expect(parseTunnelUrl('INF Starting tunnel process')).toBeNull();
  });

  it('returns null for a non-trycloudflare https url', () => {
    expect(parseTunnelUrl('INF https://www.youtube.com/feeds')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTunnelUrl('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseTunnelUrl(null)).toBeNull();
    expect(parseTunnelUrl(undefined)).toBeNull();
    expect(parseTunnelUrl(42)).toBeNull();
  });

  it('ignores http (non-https) trycloudflare urls', () => {
    expect(parseTunnelUrl('INF http://insecure.trycloudflare.com')).toBeNull();
  });

  it('returns the first url when multiple appear on one line', () => {
    const line = 'https://one-aaa.trycloudflare.com and https://two-bbb.trycloudflare.com';
    expect(parseTunnelUrl(line)).toBe('https://one-aaa.trycloudflare.com');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/tunnel/parser.test.js`
Expected: FAIL — module `server/src/tunnel/parser.js` does not exist (import/resolve error).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/tunnel/parser.js
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/i;

export function parseTunnelUrl(line) {
  if (typeof line !== 'string' || line.length === 0) return null;
  const match = line.match(TUNNEL_URL_RE);
  if (!match) return null;
  return match[0].replace(/\/+$/, '');
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/tunnel/parser.test.js`
Expected: PASS (all 10 test cases green).

- [ ] **Step 5: Commit**
```bash
git add vitest.config.js server/package.json server/src/tunnel/parser.js server/test/tunnel/parser.test.js
git commit -m "feat(tunnel): parse public url from cloudflared output"
```

---

### Task 2: `TunnelManager` — start() spawns cloudflared and emits `status: connecting`

**Files:**
- Create: `server/src/tunnel/manager.js`
- Test: `server/test/tunnel/manager.start.test.js`

**Interfaces:**
- Consumes: `parseTunnelUrl(line) -> string|null` (Task 1)
- Produces: `class TunnelManager extends EventEmitter` with `constructor({ port, spawnFn=spawn })`, `start()`, `getStatus() -> 'online'|'offline'|'connecting'`, `getUrl() -> string|null`. Events: `'status'(status)`, `'log'(line)`, `'url'(url)`.

- [ ] **Step 1: Write the failing test**
```js
// server/test/tunnel/manager.start.test.js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/tunnel/manager.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

describe('TunnelManager.start', () => {
  it('starts as offline before start() is called', () => {
    const tm = new TunnelManager({ port: 8787, spawnFn: vi.fn() });
    expect(tm.getStatus()).toBe('offline');
    expect(tm.getUrl()).toBeNull();
  });

  it('spawns cloudflared with tunnel --url http://localhost:<port>', () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('cloudflared');
    expect(args).toEqual(['tunnel', '--url', 'http://localhost:8787']);
  });

  it('transitions to connecting and emits status on start()', () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    const statuses = [];
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    expect(tm.getStatus()).toBe('connecting');
    expect(statuses).toContain('connecting');
  });

  it('does not spawn twice if start() is called while connecting', () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    tm.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/tunnel/manager.start.test.js`
Expected: FAIL — module `server/src/tunnel/manager.js` does not exist (import/resolve error).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/tunnel/manager.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { parseTunnelUrl } from './parser.js';

export class TunnelManager extends EventEmitter {
  constructor({ port, spawnFn = spawn }) {
    super();
    this.port = port;
    this.spawnFn = spawnFn;
    this.child = null;
    this.status = 'offline';
    this.url = null;
  }

  getStatus() {
    return this.status;
  }

  getUrl() {
    return this.url;
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  start() {
    if (this.child) return;
    this._setStatus('connecting');
    this.child = this.spawnFn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${this.port}`,
    ]);
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/tunnel/manager.start.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/src/tunnel/manager.js server/test/tunnel/manager.start.test.js
git commit -m "feat(tunnel): TunnelManager spawns cloudflared and reports connecting"
```

---

### Task 3: `TunnelManager` — parse stderr/stdout data into `log` + `url` + `online` status

**Files:**
- Modify: `server/src/tunnel/manager.js` (extend `start()` to wire stdout/stderr `data` listeners)
- Test: `server/test/tunnel/manager.output.test.js`

**Interfaces:**
- Consumes: `parseTunnelUrl(line)` (Task 1); fake child with `stdout`/`stderr` EventEmitters
- Produces: events `'log'(line: string)`, `'url'(url: string)`, `'status'('online')`; `getUrl()` reflects latest parsed url.

- [ ] **Step 1: Write the failing test**
```js
// server/test/tunnel/manager.output.test.js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/tunnel/manager.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

describe('TunnelManager output parsing', () => {
  it('emits log for each line received on stderr', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const logs = [];
    tm.on('log', (l) => logs.push(l));
    tm.start();
    child.stderr.emit('data', Buffer.from('INF Starting tunnel\nINF Registered tunnel connection\n'));
    expect(logs).toContain('INF Starting tunnel');
    expect(logs).toContain('INF Registered tunnel connection');
  });

  it('emits url and goes online when a tunnel url appears on stderr', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const urls = [];
    const statuses = [];
    tm.on('url', (u) => urls.push(u));
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    child.stderr.emit('data', Buffer.from('|  https://happy-cat-test.trycloudflare.com  |\n'));
    expect(urls).toEqual(['https://happy-cat-test.trycloudflare.com']);
    expect(tm.getUrl()).toBe('https://happy-cat-test.trycloudflare.com');
    expect(tm.getStatus()).toBe('online');
    expect(statuses).toContain('online');
  });

  it('also parses urls arriving on stdout', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    tm.start();
    child.stdout.emit('data', Buffer.from('https://from-stdout.trycloudflare.com\n'));
    expect(tm.getUrl()).toBe('https://from-stdout.trycloudflare.com');
    expect(tm.getStatus()).toBe('online');
  });

  it('emits url every time a NEW url appears (ephemeral reconnect)', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const urls = [];
    tm.on('url', (u) => urls.push(u));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://first-aaa.trycloudflare.com\n'));
    child.stderr.emit('data', Buffer.from('https://second-bbb.trycloudflare.com\n'));
    expect(urls).toEqual([
      'https://first-aaa.trycloudflare.com',
      'https://second-bbb.trycloudflare.com',
    ]);
    expect(tm.getUrl()).toBe('https://second-bbb.trycloudflare.com');
  });

  it('does not re-emit url when the same url is parsed twice in a row', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const urls = [];
    tm.on('url', (u) => urls.push(u));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://same-aaa.trycloudflare.com\n'));
    child.stderr.emit('data', Buffer.from('https://same-aaa.trycloudflare.com\n'));
    expect(urls).toEqual(['https://same-aaa.trycloudflare.com']);
  });

  it('handles a chunk split across two data events (line buffering)', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    tm.start();
    child.stderr.emit('data', Buffer.from('https://split-cccc'));
    child.stderr.emit('data', Buffer.from('.trycloudflare.com\n'));
    expect(tm.getUrl()).toBe('https://split-cccc.trycloudflare.com');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/tunnel/manager.output.test.js`
Expected: FAIL — no `log`/`url` events emitted; `getUrl()` stays `null` and status stays `connecting` (assertions for url/status/log all fail).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/tunnel/manager.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { parseTunnelUrl } from './parser.js';

export class TunnelManager extends EventEmitter {
  constructor({ port, spawnFn = spawn }) {
    super();
    this.port = port;
    this.spawnFn = spawnFn;
    this.child = null;
    this.status = 'offline';
    this.url = null;
    this._buf = '';
  }

  getStatus() {
    return this.status;
  }

  getUrl() {
    return this.url;
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  _handleLine(line) {
    if (line.length === 0) return;
    this.emit('log', line);
    const url = parseTunnelUrl(line);
    if (url && url !== this.url) {
      this.url = url;
      this.emit('url', url);
      this._setStatus('online');
    }
  }

  _handleData(chunk) {
    this._buf += chunk.toString();
    const parts = this._buf.split('\n');
    this._buf = parts.pop();
    for (const part of parts) {
      this._handleLine(part.replace(/\r$/, ''));
    }
  }

  start() {
    if (this.child) return;
    this._buf = '';
    this._setStatus('connecting');
    this.child = this.spawnFn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${this.port}`,
    ]);
    const onData = (chunk) => this._handleData(chunk);
    if (this.child.stdout) this.child.stdout.on('data', onData);
    if (this.child.stderr) this.child.stderr.on('data', onData);
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/tunnel/manager.output.test.js`
Expected: PASS. Also re-run Task 2 file: `npx vitest run test/tunnel/manager.start.test.js` (still PASS).

- [ ] **Step 5: Commit**
```bash
git add server/src/tunnel/manager.js server/test/tunnel/manager.output.test.js
git commit -m "feat(tunnel): emit log/url/online status from cloudflared output"
```

---

### Task 4: `TunnelManager` — child exit goes `offline` and clears url

**Files:**
- Modify: `server/src/tunnel/manager.js` (wire child `exit`/`close` listener in `start()`)
- Test: `server/test/tunnel/manager.exit.test.js`

**Interfaces:**
- Consumes: fake child EventEmitter with `exit` event
- Produces: on child `exit` -> `getStatus()='offline'`, `getUrl()=null`, emits `'status'('offline')`; manager can be `start()`ed again afterward.

- [ ] **Step 1: Write the failing test**
```js
// server/test/tunnel/manager.exit.test.js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/tunnel/manager.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

describe('TunnelManager child exit', () => {
  it('goes offline and clears url when child exits', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const statuses = [];
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://will-die-aaa.trycloudflare.com\n'));
    expect(tm.getStatus()).toBe('online');

    child.emit('exit', 0, null);
    expect(tm.getStatus()).toBe('offline');
    expect(tm.getUrl()).toBeNull();
    expect(statuses[statuses.length - 1]).toBe('offline');
  });

  it('allows start() again after the child exits (spawns a fresh child)', () => {
    const first = makeFakeChild();
    const second = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    first.emit('exit', 1, null);
    tm.start();
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(tm.getStatus()).toBe('connecting');
  });

  it('parses a new url from the second child after a reconnect cycle', () => {
    const first = makeFakeChild();
    const second = makeFakeChild();
    const spawnFn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const tm = new TunnelManager({ port: 8787, spawnFn });
    const urls = [];
    tm.on('url', (u) => urls.push(u));
    tm.start();
    first.stderr.emit('data', Buffer.from('https://old-aaa.trycloudflare.com\n'));
    first.emit('exit', 0, null);
    tm.start();
    second.stderr.emit('data', Buffer.from('https://new-bbb.trycloudflare.com\n'));
    expect(urls).toEqual([
      'https://old-aaa.trycloudflare.com',
      'https://new-bbb.trycloudflare.com',
    ]);
    expect(tm.getUrl()).toBe('https://new-bbb.trycloudflare.com');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/tunnel/manager.exit.test.js`
Expected: FAIL — no `exit` handler, so status stays `online`, `getUrl()` is non-null, and `start()` returns early (`this.child` truthy) leaving `spawnFn` called once.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/tunnel/manager.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { parseTunnelUrl } from './parser.js';

export class TunnelManager extends EventEmitter {
  constructor({ port, spawnFn = spawn }) {
    super();
    this.port = port;
    this.spawnFn = spawnFn;
    this.child = null;
    this.status = 'offline';
    this.url = null;
    this._buf = '';
  }

  getStatus() {
    return this.status;
  }

  getUrl() {
    return this.url;
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  _handleLine(line) {
    if (line.length === 0) return;
    this.emit('log', line);
    const url = parseTunnelUrl(line);
    if (url && url !== this.url) {
      this.url = url;
      this.emit('url', url);
      this._setStatus('online');
    }
  }

  _handleData(chunk) {
    this._buf += chunk.toString();
    const parts = this._buf.split('\n');
    this._buf = parts.pop();
    for (const part of parts) {
      this._handleLine(part.replace(/\r$/, ''));
    }
  }

  _onExit() {
    this.child = null;
    this.url = null;
    this._buf = '';
    this._setStatus('offline');
  }

  start() {
    if (this.child) return;
    this._buf = '';
    this._setStatus('connecting');
    this.child = this.spawnFn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${this.port}`,
    ]);
    const onData = (chunk) => this._handleData(chunk);
    if (this.child.stdout) this.child.stdout.on('data', onData);
    if (this.child.stderr) this.child.stderr.on('data', onData);
    this.child.on('exit', () => this._onExit());
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/tunnel/manager.exit.test.js`
Expected: PASS. Re-run prior tunnel tests: `npx vitest run test/tunnel/` (all PASS).

- [ ] **Step 5: Commit**
```bash
git add server/src/tunnel/manager.js server/test/tunnel/manager.exit.test.js
git commit -m "feat(tunnel): mark offline and clear url on cloudflared exit"
```

---

### Task 5: `TunnelManager.stop()` — kills child tree on Windows (`taskkill /PID <pid> /T /F`)

**Files:**
- Modify: `server/src/tunnel/manager.js` (add `stop()`; reuse the injected `spawnFn` to run `taskkill`)
- Test: `server/test/tunnel/manager.stop.test.js`

**Interfaces:**
- Consumes: fake child with `pid` + `kill`; the injected `spawnFn` (also used to spawn `taskkill`)
- Produces: `stop()` — kills child tree by running `taskkill /PID <pid> /T /F` through `spawnFn`, sets status `offline`, clears url/child. Constructor unchanged: `constructor({ port, spawnFn=spawn })`.

- [ ] **Step 1: Write the failing test**
```js
// server/test/tunnel/manager.stop.test.js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/tunnel/manager.js';

function makeFakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = pid;
  return child;
}

describe('TunnelManager.stop', () => {
  it('runs taskkill with the child pid via the injected spawnFn', () => {
    const child = makeFakeChild(9001);
    const spawnCalls = [];
    const spawnFn = vi.fn((cmd, args) => {
      spawnCalls.push([cmd, args]);
      return child;
    });
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    spawnCalls.length = 0; // ignore the cloudflared spawn
    tm.stop();
    expect(spawnCalls).toEqual([['taskkill', ['/PID', '9001', '/T', '/F']]]);
  });

  it('sets status offline and clears url after stop()', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const statuses = [];
    tm.on('status', (s) => statuses.push(s));
    tm.start();
    child.stderr.emit('data', Buffer.from('https://bye-aaa.trycloudflare.com\n'));
    tm.stop();
    expect(tm.getStatus()).toBe('offline');
    expect(tm.getUrl()).toBeNull();
    expect(statuses[statuses.length - 1]).toBe('offline');
  });

  it('is a no-op (no kill, stays offline) when no child is running', () => {
    const spawnFn = vi.fn();
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.stop();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(tm.getStatus()).toBe('offline');
  });

  it('does not double-fire offline when the child later emits exit after stop()', () => {
    const child = makeFakeChild();
    const tm = new TunnelManager({ port: 8787, spawnFn: () => child });
    const offlineCount = [];
    tm.on('status', (s) => { if (s === 'offline') offlineCount.push(s); });
    tm.start();
    tm.stop();
    child.emit('exit', 0, null); // late exit from the killed process
    expect(offlineCount.length).toBe(1);
  });

  it('default kill behavior spawns taskkill /PID <pid> /T /F', () => {
    const child = makeFakeChild(7777);
    const spawnCalls = [];
    const spawnFn = vi.fn((cmd, args) => {
      spawnCalls.push([cmd, args]);
      return child;
    });
    const tm = new TunnelManager({ port: 8787, spawnFn });
    tm.start();
    spawnCalls.length = 0; // ignore the cloudflared spawn
    tm.stop();
    expect(spawnCalls.length).toBe(1);
    const [cmd, args] = spawnCalls[0];
    expect(cmd).toBe('taskkill');
    expect(args).toEqual(['/PID', '7777', '/T', '/F']);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/tunnel/manager.stop.test.js`
Expected: FAIL — `stop()` is undefined (`tm.stop is not a function`); no `taskkill` spawn occurs.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/tunnel/manager.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { parseTunnelUrl } from './parser.js';

export class TunnelManager extends EventEmitter {
  constructor({ port, spawnFn = spawn }) {
    super();
    this.port = port;
    this.spawnFn = spawnFn;
    this.child = null;
    this.status = 'offline';
    this.url = null;
    this._buf = '';
    this._stopping = false;
  }

  getStatus() {
    return this.status;
  }

  getUrl() {
    return this.url;
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  _handleLine(line) {
    if (line.length === 0) return;
    this.emit('log', line);
    const url = parseTunnelUrl(line);
    if (url && url !== this.url) {
      this.url = url;
      this.emit('url', url);
      this._setStatus('online');
    }
  }

  _handleData(chunk) {
    this._buf += chunk.toString();
    const parts = this._buf.split('\n');
    this._buf = parts.pop();
    for (const part of parts) {
      this._handleLine(part.replace(/\r$/, ''));
    }
  }

  _goOffline() {
    this.child = null;
    this.url = null;
    this._buf = '';
    this._setStatus('offline');
  }

  _onExit() {
    if (this._stopping) {
      // stop() already transitioned to offline; just reset the flag.
      this._stopping = false;
      return;
    }
    this._goOffline();
  }

  start() {
    if (this.child) return;
    this._buf = '';
    this._stopping = false;
    this._setStatus('connecting');
    this.child = this.spawnFn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${this.port}`,
    ]);
    const onData = (chunk) => this._handleData(chunk);
    if (this.child.stdout) this.child.stdout.on('data', onData);
    if (this.child.stderr) this.child.stderr.on('data', onData);
    this.child.on('exit', () => this._onExit());
  }

  stop() {
    if (!this.child) return;
    this._stopping = true;
    const pid = this.child.pid;
    if (pid != null) {
      this.spawnFn('taskkill', ['/PID', String(pid), '/T', '/F']);
    }
    this._goOffline();
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/tunnel/manager.stop.test.js`
Expected: PASS. Full phase regression: `npx vitest run test/tunnel/` (all PASS).

- [ ] **Step 5: Commit**
```bash
git add server/src/tunnel/manager.js server/test/tunnel/manager.stop.test.js
git commit -m "feat(tunnel): stop() kills cloudflared child tree via taskkill"
```

---

## Phase 2: WebSub End-to-End

### Task 1: WebSub Topic URL Builder

**Files:**
- Create: `server/src/websub/topic.js`
- Test: `server/test/websub/topic.test.js`

**Interfaces:**
- Consumes: (none)
- Produces: `buildTopicUrl(channelId: string) -> string`

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/topic.test.js
import { describe, it, expect } from 'vitest';
import { buildTopicUrl } from '../../src/websub/topic.js';

describe('buildTopicUrl', () => {
  it('builds the YouTube feed topic url for a channel id', () => {
    expect(buildTopicUrl('UC123abc')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123abc'
    );
  });

  it('url-encodes the channel id', () => {
    expect(buildTopicUrl('UC a/b')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC%20a%2Fb'
    );
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/topic.test.js`
Expected: FAIL — cannot resolve module `../../src/websub/topic.js` (file does not exist yet)
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/topic.js
export function buildTopicUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/topic.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/topic.js server/test/websub/topic.test.js
git commit -m "feat(websub): build youtube feed topic url from channel id"
```

---

### Task 2: WebSub Subscribe Form Builder

**Files:**
- Create: `server/src/websub/params.js`
- Test: `server/test/websub/params.test.js`

**Interfaces:**
- Consumes: `buildTopicUrl(channelId) -> string`
- Produces: `buildSubscribeForm({callbackUrl, channelId, mode, secret, leaseSeconds}) -> URLSearchParams`
- Note: `hub.verify` is a hard-coded internal constant (`'async'`) — it is NOT a function parameter and no caller passes `verify` in.

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/params.test.js
import { describe, it, expect } from 'vitest';
import { buildSubscribeForm } from '../../src/websub/params.js';

describe('buildSubscribeForm', () => {
  it('builds a subscribe form with all hub params', () => {
    const form = buildSubscribeForm({
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      channelId: 'UC123',
      mode: 'subscribe',
      secret: 's3cr3t',
      leaseSeconds: 432000,
    });
    expect(form).toBeInstanceOf(URLSearchParams);
    expect(form.get('hub.callback')).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(form.get('hub.topic')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123'
    );
    expect(form.get('hub.mode')).toBe('subscribe');
    expect(form.get('hub.secret')).toBe('s3cr3t');
    expect(form.get('hub.lease_seconds')).toBe('432000');
    // hub.verify is an internal constant, always 'async'
    expect(form.get('hub.verify')).toBe('async');
  });

  it('omits hub.secret and hub.lease_seconds for unsubscribe', () => {
    const form = buildSubscribeForm({
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      channelId: 'UC123',
      mode: 'unsubscribe',
    });
    expect(form.get('hub.mode')).toBe('unsubscribe');
    expect(form.has('hub.secret')).toBe(false);
    expect(form.has('hub.lease_seconds')).toBe(false);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/params.test.js`
Expected: FAIL — cannot resolve module `../../src/websub/params.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/params.js
import { buildTopicUrl } from './topic.js';

// hub.verify is fixed to 'async' for all hub requests (implementation-internal constant,
// intentionally NOT part of the buildSubscribeForm parameter list).
const HUB_VERIFY = 'async';

export function buildSubscribeForm({ callbackUrl, channelId, mode, secret, leaseSeconds }) {
  const form = new URLSearchParams();
  form.set('hub.callback', callbackUrl);
  form.set('hub.topic', buildTopicUrl(channelId));
  form.set('hub.mode', mode);
  form.set('hub.verify', HUB_VERIFY);
  if (mode === 'subscribe') {
    if (secret != null) form.set('hub.secret', secret);
    if (leaseSeconds != null) form.set('hub.lease_seconds', String(leaseSeconds));
  }
  return form;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/params.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/params.js server/test/websub/params.test.js
git commit -m "feat(websub): build hub subscribe/unsubscribe form params"
```

---

### Task 3: WebSub HMAC-SHA1 Verifier

**Files:**
- Create: `server/src/websub/hmac.js`
- Test: `server/test/websub/hmac.test.js`

**Interfaces:**
- Consumes: `node:crypto`
- Produces: `verifyHmac(rawBody: Buffer|string, signatureHeader: string, secret: string) -> boolean`

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/hmac.test.js
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyHmac } from '../../src/websub/hmac.js';

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

describe('verifyHmac', () => {
  const secret = 'topsecret';
  const body = Buffer.from('<feed>hello</feed>');

  it('returns true for a valid sha1 signature (Buffer body)', () => {
    expect(verifyHmac(body, sign(body, secret), secret)).toBe(true);
  });

  it('returns true for a valid signature (string body)', () => {
    const s = '<feed>hi</feed>';
    expect(verifyHmac(s, sign(s, secret), secret)).toBe(true);
  });

  it('returns false when signature does not match', () => {
    expect(verifyHmac(body, sign(body, 'wrong'), secret)).toBe(false);
  });

  it('returns false for a missing/empty signature header', () => {
    expect(verifyHmac(body, undefined, secret)).toBe(false);
    expect(verifyHmac(body, '', secret)).toBe(false);
  });

  it('returns false for a malformed (non sha1=) header', () => {
    expect(verifyHmac(body, 'deadbeef', secret)).toBe(false);
  });

  it('returns false when secret is missing', () => {
    expect(verifyHmac(body, sign(body, secret), undefined)).toBe(false);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/hmac.test.js`
Expected: FAIL — cannot resolve module `../../src/websub/hmac.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/hmac.js
import crypto from 'node:crypto';

export function verifyHmac(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith('sha1=')) return false;
  const provided = signatureHeader.slice('sha1='.length);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expected = crypto.createHmac('sha1', secret).update(body).digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/hmac.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/hmac.js server/test/websub/hmac.test.js
git commit -m "feat(websub): verify x-hub-signature hmac-sha1 with timing-safe compare"
```

---

### Task 4: Atom Feed Parser (new + metadata-update + deleted-entry)

**Files:**
- Create: `server/src/websub/atom.js`
- Test: `server/test/websub/atom.test.js`

**Interfaces:**
- Consumes: `fast-xml-parser`
- Produces: `parseAtom(xml: string) -> { entries: {videoId,channelId,title,author,published,updated}[], deleted: {videoId,channelId}[] }`
- Note: per the contract, `deleted[].channelId` is `null` (a tombstone carries no `yt:channelId`); the route layer recovers the real channelId from the DB before resolving the per-channel secret (see Task 9).

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/atom.test.js
import { describe, it, expect } from 'vitest';
import { parseAtom } from '../../src/websub/atom.js';

const NEW_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:VID123</id>
    <yt:videoId>VID123</yt:videoId>
    <yt:channelId>UCabc</yt:channelId>
    <title>My New Video</title>
    <author><name>Cool Channel</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:05:00+00:00</updated>
  </entry>
</feed>`;

const DELETED_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:VIDDEL" when="2026-06-28T11:00:00+00:00">
    <link href="https://www.youtube.com/watch?v=VIDDEL"/>
    <at:by><name>Cool Channel</name></at:by>
  </at:deleted-entry>
</feed>`;

describe('parseAtom', () => {
  it('parses a new/updated entry', () => {
    const res = parseAtom(NEW_ENTRY);
    expect(res.deleted).toEqual([]);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toEqual({
      videoId: 'VID123',
      channelId: 'UCabc',
      title: 'My New Video',
      author: 'Cool Channel',
      published: '2026-06-28T10:00:00+00:00',
      updated: '2026-06-28T10:05:00+00:00',
    });
  });

  it('parses an at:deleted-entry into deleted[] with videoId from ref and channelId null', () => {
    const res = parseAtom(DELETED_ENTRY);
    expect(res.entries).toEqual([]);
    expect(res.deleted).toHaveLength(1);
    expect(res.deleted[0]).toEqual({ videoId: 'VIDDEL', channelId: null });
  });

  it('returns empty arrays for an empty/invalid feed', () => {
    expect(parseAtom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'))
      .toEqual({ entries: [], deleted: [] });
    expect(parseAtom('')).toEqual({ entries: [], deleted: [] });
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/atom.test.js`
Expected: FAIL — cannot resolve module `../../src/websub/atom.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/atom.js
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v['#text'] != null ? String(v['#text']) : null;
  return String(v);
}

function videoIdFromRef(ref) {
  if (!ref) return null;
  const m = String(ref).match(/yt:video:(.+)$/);
  return m ? m[1] : null;
}

export function parseAtom(xml) {
  if (!xml || !xml.trim()) return { entries: [], deleted: [] };
  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return { entries: [], deleted: [] };
  }
  const feed = doc && doc.feed ? doc.feed : {};

  const entries = asArray(feed.entry).map((e) => ({
    videoId: text(e.videoId),
    channelId: text(e.channelId),
    title: text(e.title),
    author: e.author ? text(e.author.name) : null,
    published: text(e.published),
    updated: text(e.updated),
  }));

  const deleted = asArray(feed['deleted-entry']).map((d) => ({
    videoId: videoIdFromRef(d['@_ref']),
    channelId: null,
  }));

  return { entries, deleted };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/atom.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/atom.js server/test/websub/atom.test.js
git commit -m "feat(websub): parse atom feed entries and at:deleted-entry tombstones"
```

---

### Task 5: WebSub Client — sendSubscription (mocked fetch)

**Files:**
- Create: `server/src/websub/client.js`
- Test: `server/test/websub/client.send.test.js`

**Interfaces:**
- Consumes: `buildSubscribeForm({callbackUrl, channelId, mode, secret, leaseSeconds}) -> URLSearchParams`
- Produces: `async sendSubscription({hubUrl, callbackUrl, channelId, mode, secret, leaseSeconds, fetchFn=fetch}) -> {ok, status}`
- Note: this task implements ONLY `sendSubscription`. `resubscribeAll` is added as new code in Task 6.

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/client.send.test.js
import { describe, it, expect, vi } from 'vitest';
import { sendSubscription } from '../../src/websub/client.js';

describe('sendSubscription', () => {
  it('POSTs a form-encoded subscribe request to the hub', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const res = await sendSubscription({
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      channelId: 'UC123',
      mode: 'subscribe',
      secret: 's3cr3t',
      leaseSeconds: 432000,
      fetchFn,
    });

    expect(res).toEqual({ ok: true, status: 202 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    // Decode the form body and assert on real field values (robust vs. encoded-substring matching).
    const sent = new URLSearchParams(opts.body);
    expect(sent.get('hub.mode')).toBe('subscribe');
    expect(sent.get('hub.callback')).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(sent.get('hub.topic')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC123'
    );
    expect(sent.get('hub.secret')).toBe('s3cr3t');
    expect(sent.get('hub.lease_seconds')).toBe('432000');
  });

  it('returns ok:false with status on hub rejection', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const res = await sendSubscription({
      hubUrl: 'https://hub',
      callbackUrl: 'https://cb/webhook/youtube',
      channelId: 'UC9',
      mode: 'unsubscribe',
      fetchFn,
    });
    expect(res).toEqual({ ok: false, status: 400 });
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/client.send.test.js`
Expected: FAIL — cannot resolve module `../../src/websub/client.js` (no `sendSubscription` export)
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/client.js
import { buildSubscribeForm } from './params.js';

export async function sendSubscription({
  hubUrl,
  callbackUrl,
  channelId,
  mode,
  secret,
  leaseSeconds,
  fetchFn = fetch,
}) {
  const form = buildSubscribeForm({ callbackUrl, channelId, mode, secret, leaseSeconds });
  const res = await fetchFn(hubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return { ok: res.ok, status: res.status };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/client.send.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/client.js server/test/websub/client.send.test.js
git commit -m "feat(websub): send subscribe/unsubscribe POST to hub with injectable fetch"
```

---

### Task 6: WebSub Client — resubscribeAll (staggered over active channels)

**Files:**
- Modify: `server/src/websub/client.js` (add `resubscribeAll` export + `listActiveChannels` import)
- Test: `server/test/websub/client.resubscribe.test.js`

**Interfaces:**
- Consumes: `listActiveChannels(db) -> row[]`; `sendSubscription({...}) -> {ok,status}`
- Produces: `async resubscribeAll({db, callbackUrl, hubUrl, leaseSeconds, sendFn=sendSubscription, delayMs=50}) -> {channelId,ok,status}[]`

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/client.resubscribe.test.js
import { describe, it, expect, vi } from 'vitest';
import { initDb, addChannel, setChannelActive } from '../../src/db/index.js';
import { resubscribeAll } from '../../src/websub/client.js';

function seed() {
  const db = initDb(':memory:');
  addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: '', secret: 'sec1' });
  addChannel(db, { channelId: 'UC2', handle: '@b', title: 'B', thumbnail: '', secret: 'sec2' });
  addChannel(db, { channelId: 'UC3', handle: '@c', title: 'C', thumbnail: '', secret: 'sec3' });
  setChannelActive(db, 'UC3', false); // inactive -> skipped
  return db;
}

describe('resubscribeAll', () => {
  it('subscribes every ACTIVE channel with its own secret', async () => {
    const db = seed();
    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

    const results = await resubscribeAll({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      sendFn,
      delayMs: 0,
    });

    expect(sendFn).toHaveBeenCalledTimes(2);
    const ids = sendFn.mock.calls.map((c) => c[0].channelId).sort();
    expect(ids).toEqual(['UC1', 'UC2']);
    const first = sendFn.mock.calls.find((c) => c[0].channelId === 'UC1')[0];
    expect(first.mode).toBe('subscribe');
    expect(first.secret).toBe('sec1');
    expect(first.callbackUrl).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(first.leaseSeconds).toBe(432000);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('staggers calls by delayMs between channels', async () => {
    vi.useFakeTimers();
    const db = seed();
    let calls = 0;
    const sendFn = vi.fn().mockImplementation(async () => {
      calls++;
      return { ok: true, status: 202 };
    });

    const p = resubscribeAll({
      db,
      callbackUrl: 'https://cb/webhook/youtube',
      hubUrl: 'https://hub',
      leaseSeconds: 432000,
      sendFn,
      delayMs: 50,
    });

    await Promise.resolve();
    expect(calls).toBe(1); // first fired immediately, second is waiting on timer
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/client.resubscribe.test.js`
Expected: FAIL — `resubscribeAll is not exported from '../../src/websub/client.js'` (only `sendSubscription` exists after Task 5)
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/client.js  (add the import at top, append resubscribeAll)
import { listActiveChannels } from '../db/index.js';

export async function resubscribeAll({
  db,
  callbackUrl,
  hubUrl,
  leaseSeconds,
  sendFn = sendSubscription,
  delayMs = 50,
}) {
  const channels = listActiveChannels(db);
  const results = [];
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const res = await sendFn({
      hubUrl,
      callbackUrl,
      channelId: ch.channel_id,
      mode: 'subscribe',
      secret: ch.secret,
      leaseSeconds,
    });
    results.push({ channelId: ch.channel_id, ...res });
    if (delayMs > 0 && i < channels.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/client.resubscribe.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/client.js server/test/websub/client.resubscribe.test.js
git commit -m "feat(websub): resubscribeAll subscribes active channels staggered by delayMs"
```

---

### Task 7: Webhook Routes — GET challenge echo

**Files:**
- Create: `server/src/websub/routes.js`
- Modify: `server/src/webhookApp.js` (created bare in Phase 0 Task 11; here it gains route registration via `registerWebhookRoutes`)
- Test: `server/test/websub/routes.get.test.js`

**Interfaces:**
- Consumes: `express`, `supertest`
- Produces:
  - `registerWebhookRoutes(app, { db, secretFor, onNewVideo, onDeleted }) -> void`
  - `createWebhookApp({ db, secretFor, onNewVideo, onDeleted }) -> express.Application`
- Note: this task implements ONLY the GET verification route. The POST handler (HMAC + dedup + dispatch) is added as new code in Tasks 8 and 9. Per the contract, GET echoes `hub.challenge` when `hub.mode`+`hub.topic` are present; the missing-params case returns **404** (the chosen, documented status for this project — used consistently by tests and clients).

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/routes.get.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { initDb } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';

function makeApp() {
  return createWebhookApp({
    db: initDb(':memory:'),
    secretFor: () => 'irrelevant',
    onNewVideo: () => {},
    onDeleted: () => {},
  });
}

describe('GET /webhook/youtube (verification handshake)', () => {
  it('echoes hub.challenge as text/plain 200 when mode+topic present', async () => {
    const res = await request(makeApp())
      .get('/webhook/youtube')
      .query({
        'hub.mode': 'subscribe',
        'hub.topic': 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1',
        'hub.challenge': 'CHALLENGE_TOKEN_123',
        'hub.lease_seconds': '432000',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('CHALLENGE_TOKEN_123');
  });

  it('returns 404 when hub.mode/hub.topic missing', async () => {
    const res = await request(makeApp())
      .get('/webhook/youtube')
      .query({ 'hub.challenge': 'x' });
    expect(res.status).toBe(404);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/routes.get.test.js`
Expected: FAIL — cannot resolve module `../../src/webhookApp.js` / `../../src/websub/routes.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/routes.js
export function registerWebhookRoutes(app, { db, secretFor, onNewVideo, onDeleted }) {
  // GET: WebSub verification handshake -> echo hub.challenge.
  // Missing hub.mode/hub.topic -> 404 (project-chosen status for malformed handshakes).
  app.get('/webhook/youtube', (req, res) => {
    const mode = req.query['hub.mode'];
    const topic = req.query['hub.topic'];
    const challenge = req.query['hub.challenge'];
    if (!mode || !topic) {
      res.status(404).end();
      return;
    }
    res.status(200).type('text/plain').send(challenge != null ? String(challenge) : '');
  });
}
```
```js
// server/src/webhookApp.js
import express from 'express';
import { registerWebhookRoutes } from './websub/routes.js';

export function createWebhookApp({ db, secretFor, onNewVideo, onDeleted }) {
  const app = express();
  registerWebhookRoutes(app, { db, secretFor, onNewVideo, onDeleted });
  return app;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/routes.get.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/routes.js server/src/webhookApp.js server/test/websub/routes.get.test.js
git commit -m "feat(websub): GET /webhook/youtube echoes hub.challenge for verification"
```

---

### Task 8: Webhook Routes — POST verifies HMAC (403 on mismatch, 204 on valid)

**Files:**
- Modify: `server/src/websub/routes.js` (add the `POST /webhook/youtube` handler with `express.raw` + HMAC verification)
- Test: `server/test/websub/routes.post.hmac.test.js`

**Interfaces:**
- Consumes: `createWebhookApp({db, secretFor, onNewVideo, onDeleted})`; `verifyHmac(rawBody, signatureHeader, secret) -> boolean`; `parseAtom(xml)`
- Produces: POST verification behavior — 403 on bad/missing signature, 204 on valid (no DB write / callbacks yet; those are added in Task 9)
- Note: there is no POST route yet after Task 7, so this test genuinely fails (404). The handler uses `express.raw({ type: () => true })` so the exact bytes are preserved for HMAC. The per-channel secret is resolved via `secretFor(channelId)`, where `channelId` comes from the parsed entry; for tombstones (`channelId: null` from `parseAtom`) the DB recovery added in Task 9 supplies the real channelId — Task 8 covers only signed entry POSTs.

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/routes.post.hmac.test.js
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';

const SECRET = 'chan-secret';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>VIDX</yt:videoId>
    <yt:channelId>UCsig</yt:channelId>
    <title>Sig Test</title>
    <author><name>Chan</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:00:00+00:00</updated>
  </entry>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

// secretFor keyed by channelId (proves per-channel secret resolution, not an arg-ignoring stub)
function makeApp() {
  return createWebhookApp({
    db: initDb(':memory:'),
    secretFor: (id) => (id === 'UCsig' ? SECRET : undefined),
    onNewVideo: () => {},
    onDeleted: () => {},
  });
}

describe('POST /webhook/youtube HMAC enforcement', () => {
  it('rejects with 403 when signature is invalid', async () => {
    const res = await request(makeApp())
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, 'WRONG_SECRET'))
      .send(XML);
    expect(res.status).toBe(403);
  });

  it('rejects with 403 when signature header is missing', async () => {
    const res = await request(makeApp())
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .send(XML);
    expect(res.status).toBe(403);
  });

  it('accepts (204) when signature is valid and secretFor resolves the channel', async () => {
    const res = await request(makeApp())
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, SECRET))
      .send(XML);
    expect(res.status).toBe(204);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/routes.post.hmac.test.js`
Expected: FAIL — Task 7 registered no POST route, so the 403/204 cases return **404** (no matching handler)
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/routes.js  (add imports at top, add POST handler inside registerWebhookRoutes)
import express from 'express';
import { verifyHmac } from './hmac.js';
import { parseAtom } from './atom.js';

// ...inside registerWebhookRoutes(app, { db, secretFor, onNewVideo, onDeleted }) { ... }

  // POST: notifications. express.raw preserves exact bytes for HMAC verification.
  app.post('/webhook/youtube', express.raw({ type: () => true }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const xml = rawBody.toString('utf8');
    const { entries, deleted } = parseAtom(xml);

    // channelId from the first parsed entry (tombstone channelId recovery is added in Task 9).
    const channelId = (entries[0] && entries[0].channelId) || null;
    const secret = secretFor(channelId);
    const signature = req.get('X-Hub-Signature');

    if (!verifyHmac(rawBody, signature, secret)) {
      res.status(403).end();
      return;
    }

    res.status(204).end();
  });
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/routes.post.hmac.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/routes.js server/test/websub/routes.post.hmac.test.js
git commit -m "feat(websub): POST /webhook/youtube verifies hmac, 403 on mismatch and 204 on valid"
```

---

### Task 9: Webhook Routes — POST stores new video once (dedup) + dispatch callbacks

**Files:**
- Modify: `server/src/websub/routes.js` (add `upsertVideoIfNew`/`getVideo` import; add dedup + `onNewVideo`/`onDeleted` dispatch and tombstone channelId recovery into the existing POST handler)
- Test: `server/test/websub/routes.post.dedup.test.js`

**Interfaces:**
- Consumes: `createWebhookApp(...)`; `upsertVideoIfNew(db, {...}) -> {row, isNew}`; `listVideos(db, {limit})`; `getVideo(db, videoId) -> row | undefined`; `addChannel(db, {...})`
- Produces: dedup + async callback dispatch behavior; tombstone channelId recovered from the stored video row so `secretFor` receives a real channelId

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/routes.post.dedup.test.js
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb, addChannel, listVideos } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';

const SECRET = 'chan-secret';
const NEW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>DUPVID</yt:videoId>
    <yt:channelId>UCdup</yt:channelId>
    <title>First Title</title>
    <author><name>Chan</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:00:00+00:00</updated>
  </entry>
</feed>`;

// Same videoId, later updated -> metadata update, must NOT create a second video
const UPDATE_XML = NEW_XML.replace('First Title', 'Edited Title')
  .replace('10:00:00+00:00</updated>', '12:00:00+00:00</updated>');

const DELETE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:DUPVID" when="2026-06-28T13:00:00+00:00"/>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

function post(app, xml) {
  return request(app)
    .post('/webhook/youtube')
    .set('Content-Type', 'application/atom+xml')
    .set('X-Hub-Signature', sign(xml, SECRET))
    .send(xml);
}

// secretFor keyed by channelId -> proves tombstone channelId recovery works for signed deletes.
function makeApp(db, { onNewVideo = () => {}, onDeleted = () => {} } = {}) {
  return createWebhookApp({
    db,
    secretFor: (id) => (id === 'UCdup' ? SECRET : undefined),
    onNewVideo,
    onDeleted,
  });
}

describe('POST /webhook/youtube dedup + callbacks', () => {
  it('stores a new video once and fires onNewVideo with the row; re-POST does not duplicate or re-fire', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UCdup', handle: '@d', title: 'D', thumbnail: '', secret: SECRET });
    const onNewVideo = vi.fn();
    const app = makeApp(db, { onNewVideo });

    const r1 = await post(app, NEW_XML);
    expect(r1.status).toBe(204);
    await new Promise((r) => setImmediate(r)); // let scheduled callbacks run

    expect(listVideos(db, { limit: 100 })).toHaveLength(1);
    expect(onNewVideo).toHaveBeenCalledTimes(1);
    expect(onNewVideo.mock.calls[0][0].video_id).toBe('DUPVID');

    // Metadata-only update for the SAME videoId -> still one video, no new onNewVideo
    const r2 = await post(app, UPDATE_XML);
    expect(r2.status).toBe(204);
    await new Promise((r) => setImmediate(r));

    expect(listVideos(db, { limit: 100 })).toHaveLength(1);
    expect(onNewVideo).toHaveBeenCalledTimes(1);
  });

  it('verifies a SIGNED delete via per-channel secret (recovered channelId) and fires onDeleted', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UCdup', handle: '@d', title: 'D', thumbnail: '', secret: SECRET });
    const onDeleted = vi.fn();
    const app = makeApp(db, { onDeleted });

    // Store the video first so the tombstone's channelId can be recovered from the DB.
    await post(app, NEW_XML);
    await new Promise((r) => setImmediate(r));

    const res = await post(app, DELETE_XML);
    expect(res.status).toBe(204); // 403 here would prove secretFor got channelId:null
    await new Promise((r) => setImmediate(r));

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith('DUPVID');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/routes.post.dedup.test.js`
Expected: FAIL — after Task 8 the POST handler returns 204 but never writes the video or calls `onNewVideo`/`onDeleted` (`listVideos` is empty, `onNewVideo`/`onDeleted` never called); the signed-delete case also 403s because `secretFor(null)` returns `undefined`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/routes.js  (add import at top; replace the POST handler body)
import { upsertVideoIfNew, getVideo } from '../db/index.js';

  // POST: notifications. express.raw preserves exact bytes for HMAC verification.
  app.post('/webhook/youtube', express.raw({ type: () => true }), (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const xml = rawBody.toString('utf8');
    const { entries, deleted } = parseAtom(xml);

    // Recover channelId for HMAC: prefer the parsed entry; for tombstones (channelId:null)
    // look up the stored video row so secretFor() receives the real per-channel id.
    let channelId = entries[0] && entries[0].channelId;
    if (!channelId && deleted[0]) {
      const existing = getVideo(db, deleted[0].videoId);
      channelId = existing ? existing.channel_id : null;
    }
    const secret = secretFor(channelId || null);
    const signature = req.get('X-Hub-Signature');

    if (!verifyHmac(rawBody, signature, secret)) {
      res.status(403).end();
      return;
    }

    for (const entry of entries) {
      const { isNew, row } = upsertVideoIfNew(db, {
        videoId: entry.videoId,
        channelId: entry.channelId,
        title: entry.title,
        publishedAt: entry.published ? Date.parse(entry.published) : null,
        updatedAt: entry.updated ? Date.parse(entry.updated) : null,
        thumbnailUrl: null,
      });
      if (isNew && typeof onNewVideo === 'function') {
        Promise.resolve().then(() => onNewVideo(row));
      }
    }

    for (const d of deleted) {
      if (typeof onDeleted === 'function') {
        Promise.resolve().then(() => onDeleted(d.videoId));
      }
    }

    res.status(204).end();
  });
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/routes.post.dedup.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/websub/routes.js server/test/websub/routes.post.dedup.test.js
git commit -m "feat(websub): POST dedups by videoId, recovers tombstone channelId, dispatches onNewVideo/onDeleted"
```

---

### Task 10: Scheduler — findExpiringChannels (PURE)

**Files:**
- Create: `server/src/scheduler/lease.js`
- Test: `server/test/scheduler/lease.test.js`

**Interfaces:**
- Consumes: (none)
- Produces: `findExpiringChannels(channels: row[], now: number, thresholdMs: number) -> row[]`

- [ ] **Step 1: Write the failing test**
```js
// server/test/scheduler/lease.test.js
import { describe, it, expect } from 'vitest';
import { findExpiringChannels } from '../../src/scheduler/lease.js';

describe('findExpiringChannels', () => {
  const now = 1_000_000_000_000;
  const HOUR = 3_600_000;
  const channels = [
    { channel_id: 'UC_soon', lease_expires_at: now + 6 * HOUR },   // within 12h -> expiring
    { channel_id: 'UC_edge', lease_expires_at: now + 12 * HOUR },  // exactly threshold -> NOT (strict <)
    { channel_id: 'UC_far', lease_expires_at: now + 48 * HOUR },   // far future -> no
    { channel_id: 'UC_past', lease_expires_at: now - HOUR },       // already expired -> yes
    { channel_id: 'UC_null', lease_expires_at: null },             // never subscribed -> yes (treat as expiring)
  ];

  it('returns channels whose lease expires within now+thresholdMs (strict <)', () => {
    const res = findExpiringChannels(channels, now, 12 * HOUR);
    const ids = res.map((c) => c.channel_id).sort();
    expect(ids).toEqual(['UC_null', 'UC_past', 'UC_soon']);
  });

  it('returns empty array when none are expiring', () => {
    const far = [{ channel_id: 'X', lease_expires_at: now + 100 * HOUR }];
    expect(findExpiringChannels(far, now, HOUR)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scheduler/lease.test.js`
Expected: FAIL — cannot resolve module `../../src/scheduler/lease.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/scheduler/lease.js
export function findExpiringChannels(channels, now, thresholdMs) {
  const cutoff = now + thresholdMs;
  return channels.filter((c) => {
    const exp = c.lease_expires_at;
    if (exp == null) return true; // never subscribed -> needs subscription
    return exp < cutoff;
  });
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scheduler/lease.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/scheduler/lease.js server/test/scheduler/lease.test.js
git commit -m "feat(scheduler): findExpiringChannels selects leases expiring within threshold"
```

---

### Task 11: Catch-up — findMissedVideos (PURE)

**Files:**
- Create: `server/src/scheduler/catchup.js`
- Test: `server/test/scheduler/catchup.missed.test.js`

**Interfaces:**
- Consumes: (none for the pure function)
- Produces: `findMissedVideos(rssEntries: {videoId,published}[], lastPublishedAt: number) -> entries[]`
- Note: this task implements ONLY `findMissedVideos`. `fetchChannelRss` is added as new code in Task 12.

- [ ] **Step 1: Write the failing test**
```js
// server/test/scheduler/catchup.missed.test.js
import { describe, it, expect } from 'vitest';
import { findMissedVideos } from '../../src/scheduler/catchup.js';

describe('findMissedVideos', () => {
  const entries = [
    { videoId: 'A', published: '2026-06-28T09:00:00+00:00' },
    { videoId: 'B', published: '2026-06-28T10:00:00+00:00' },
    { videoId: 'C', published: '2026-06-28T11:00:00+00:00' },
  ];

  it('returns entries published strictly after lastPublishedAt (ms)', () => {
    const last = Date.parse('2026-06-28T10:00:00+00:00');
    const res = findMissedVideos(entries, last);
    expect(res.map((e) => e.videoId)).toEqual(['C']);
  });

  it('returns all entries when lastPublishedAt is null/0', () => {
    expect(findMissedVideos(entries, null).map((e) => e.videoId)).toEqual(['A', 'B', 'C']);
    expect(findMissedVideos(entries, 0).map((e) => e.videoId)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty array for empty input', () => {
    expect(findMissedVideos([], 123)).toEqual([]);
    expect(findMissedVideos(undefined, 123)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scheduler/catchup.missed.test.js`
Expected: FAIL — cannot resolve module `../../src/scheduler/catchup.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/scheduler/catchup.js
export function findMissedVideos(rssEntries, lastPublishedAt) {
  if (!Array.isArray(rssEntries) || rssEntries.length === 0) return [];
  const last = lastPublishedAt == null ? 0 : lastPublishedAt;
  return rssEntries.filter((e) => {
    const ts = e && e.published ? Date.parse(e.published) : NaN;
    if (Number.isNaN(ts)) return false;
    return ts > last;
  });
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scheduler/catchup.missed.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/scheduler/catchup.js server/test/scheduler/catchup.missed.test.js
git commit -m "feat(scheduler): findMissedVideos filters rss entries newer than last published"
```

---

### Task 12: Catch-up — fetchChannelRss (mocked fetch)

**Files:**
- Modify: `server/src/scheduler/catchup.js` (add `parseAtom` import + `fetchChannelRss` export)
- Test: `server/test/scheduler/catchup.fetch.test.js`

**Interfaces:**
- Consumes: `parseAtom(xml) -> {entries, deleted}`
- Produces: `async fetchChannelRss(channelId, fetchFn=fetch) -> entries[]`

- [ ] **Step 1: Write the failing test**
```js
// server/test/scheduler/catchup.fetch.test.js
import { describe, it, expect, vi } from 'vitest';
import { fetchChannelRss } from '../../src/scheduler/catchup.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>R1</yt:videoId>
    <yt:channelId>UCfeed</yt:channelId>
    <title>Recent One</title>
    <author><name>Feed Chan</name></author>
    <published>2026-06-28T09:00:00+00:00</published>
    <updated>2026-06-28T09:00:00+00:00</updated>
  </entry>
</feed>`;

describe('fetchChannelRss', () => {
  it('GETs the channel feed url and returns parsed entries', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, text: async () => RSS });
    const entries = await fetchChannelRss('UCfeed', fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCfeed'
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].videoId).toBe('R1');
    expect(entries[0].channelId).toBe('UCfeed');
  });

  it('returns [] when the feed responds non-ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    expect(await fetchChannelRss('UCmissing', fetchFn)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scheduler/catchup.fetch.test.js`
Expected: FAIL — `fetchChannelRss is not exported from '../../src/scheduler/catchup.js'` (only `findMissedVideos` exists after Task 11)
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/scheduler/catchup.js  (add import at top, append fetchChannelRss)
import { parseAtom } from '../websub/atom.js';

export async function fetchChannelRss(channelId, fetchFn = fetch) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetchFn(url);
  if (!res.ok) return [];
  const xml = await res.text();
  return parseAtom(xml).entries;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scheduler/catchup.fetch.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/scheduler/catchup.js server/test/scheduler/catchup.fetch.test.js
git commit -m "feat(scheduler): fetchChannelRss fetches feed and returns parsed entries"
```

---

### Task 13: Scheduler Renewal Wiring (findExpiringChannels + resubscribe)

**Files:**
- Create: `server/src/scheduler/index.js`
- Test: `server/test/scheduler/renewal.test.js`

**Interfaces:**
- Consumes: `findExpiringChannels(channels, now, thresholdMs)`; `listActiveChannels(db)`; `sendSubscription({...}) -> {ok,status}`
- Produces: `async renewExpiringLeases({db, callbackUrl, hubUrl, leaseSeconds, now, thresholdMs=43200000, sendFn=sendSubscription, delayMs=50}) -> {channelId,ok,status}[]`

- [ ] **Step 1: Write the failing test**
```js
// server/test/scheduler/renewal.test.js
import { describe, it, expect, vi } from 'vitest';
import { initDb, addChannel, updateChannelSubscription } from '../../src/db/index.js';
import { renewExpiringLeases } from '../../src/scheduler/index.js';

const HOUR = 3_600_000;

describe('renewExpiringLeases', () => {
  it('re-subscribes only active channels whose lease expires within thresholdMs', async () => {
    const now = 1_000_000_000_000;
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_soon', handle: '@s', title: 'S', thumbnail: '', secret: 'sec_soon' });
    addChannel(db, { channelId: 'UC_far', handle: '@f', title: 'F', thumbnail: '', secret: 'sec_far' });
    updateChannelSubscription(db, 'UC_soon', { subscribedAt: now, leaseExpiresAt: now + 3 * HOUR });
    updateChannelSubscription(db, 'UC_far', { subscribedAt: now, leaseExpiresAt: now + 100 * HOUR });

    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const results = await renewExpiringLeases({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      now,
      thresholdMs: 12 * HOUR,
      sendFn,
      delayMs: 0,
    });

    expect(sendFn).toHaveBeenCalledTimes(1);
    const arg = sendFn.mock.calls[0][0];
    expect(arg.channelId).toBe('UC_soon');
    expect(arg.mode).toBe('subscribe');
    expect(arg.secret).toBe('sec_soon');
    expect(arg.leaseSeconds).toBe(432000);
    expect(results).toEqual([{ channelId: 'UC_soon', ok: true, status: 202 }]);
  });

  it('does nothing when no active channel is expiring', async () => {
    const now = 1_000_000_000_000;
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_ok', handle: '@o', title: 'O', thumbnail: '', secret: 'sec' });
    updateChannelSubscription(db, 'UC_ok', { subscribedAt: now, leaseExpiresAt: now + 100 * HOUR });

    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const results = await renewExpiringLeases({
      db,
      callbackUrl: 'https://cb/webhook/youtube',
      hubUrl: 'https://hub',
      leaseSeconds: 432000,
      now,
      thresholdMs: 12 * HOUR,
      sendFn,
      delayMs: 0,
    });

    expect(sendFn).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scheduler/renewal.test.js`
Expected: FAIL — cannot resolve module `../../src/scheduler/index.js`
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/scheduler/index.js
import { listActiveChannels } from '../db/index.js';
import { findExpiringChannels } from './lease.js';
import { sendSubscription } from '../websub/client.js';

export async function renewExpiringLeases({
  db,
  callbackUrl,
  hubUrl,
  leaseSeconds,
  now = Date.now(),
  thresholdMs = 12 * 60 * 60 * 1000,
  sendFn = sendSubscription,
  delayMs = 50,
}) {
  const active = listActiveChannels(db);
  const expiring = findExpiringChannels(active, now, thresholdMs);
  const results = [];
  for (let i = 0; i < expiring.length; i++) {
    const ch = expiring[i];
    const res = await sendFn({
      hubUrl,
      callbackUrl,
      channelId: ch.channel_id,
      mode: 'subscribe',
      secret: ch.secret,
      leaseSeconds,
    });
    results.push({ channelId: ch.channel_id, ...res });
    if (delayMs > 0 && i < expiring.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scheduler/renewal.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/scheduler/index.js server/test/scheduler/renewal.test.js
git commit -m "feat(scheduler): renewExpiringLeases re-subscribes active channels nearing lease expiry"
```

---

### Task 14: WebSub End-to-End Integration (signed POST -> stored video -> GET challenge)

**Files:**
- Create: `server/src/webhookFlow.js`
- Test: `server/test/websub/e2e.flow.test.js`

**Interfaces:**
- Consumes: `createWebhookApp({db, secretFor, onNewVideo, onDeleted})`; `initDb`; `addChannel`; `getChannel`; `listVideos`; `buildTopicUrl`
- Produces: `runWebhookFlow({db}) -> { app, secretFor }` — an integration shim that wires `createWebhookApp` to a real DB-keyed `secretFor(channelId)` (looks up the channel's stored secret), so a single app handles GET verification and signed POST notifications end-to-end.

- [ ] **Step 1: Write the failing test**
```js
// server/test/websub/e2e.flow.test.js
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb, addChannel, listVideos } from '../../src/db/index.js';
import { buildTopicUrl } from '../../src/websub/topic.js';
import { runWebhookFlow } from '../../src/webhookFlow.js';

const CHANNEL = 'UCe2e';
const SECRET = 'e2e-secret';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>E2EVID</yt:videoId>
    <yt:channelId>${CHANNEL}</yt:channelId>
    <title>E2E Video</title>
    <author><name>E2E Chan</name></author>
    <published>2026-06-28T10:00:00+00:00</published>
    <updated>2026-06-28T10:00:00+00:00</updated>
  </entry>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

describe('WebSub end-to-end flow', () => {
  it('verifies the GET challenge then stores a video from a signed POST keyed by the DB secret', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: CHANNEL, handle: '@e2e', title: 'E2E', thumbnail: '', secret: SECRET });

    const { app } = runWebhookFlow({ db });

    // 1) Verification handshake echoes the challenge.
    const getRes = await request(app)
      .get('/webhook/youtube')
      .query({
        'hub.mode': 'subscribe',
        'hub.topic': buildTopicUrl(CHANNEL),
        'hub.challenge': 'E2E_CHALLENGE',
      });
    expect(getRes.status).toBe(200);
    expect(getRes.text).toBe('E2E_CHALLENGE');

    // 2) Signed notification is verified with the channel's DB secret and stored.
    const postRes = await request(app)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, SECRET))
      .send(XML);
    expect(postRes.status).toBe(204);
    await new Promise((r) => setImmediate(r));

    const videos = listVideos(db, { limit: 10 });
    expect(videos).toHaveLength(1);
    expect(videos[0].video_id).toBe('E2EVID');

    // 3) A POST signed with the WRONG secret is rejected.
    const badRes = await request(app)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(XML, 'nope'))
      .send(XML);
    expect(badRes.status).toBe(403);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/e2e.flow.test.js`
Expected: FAIL — cannot resolve module `../../src/webhookFlow.js` (no `runWebhookFlow` export)
- [ ] **Step 3: Write minimal implementation**
```js
// server/src/webhookFlow.js
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
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/e2e.flow.test.js`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add server/src/webhookFlow.js server/test/websub/e2e.flow.test.js
git commit -m "feat(websub): end-to-end webhook flow wires db-keyed secretFor for verify + signed post"
```

---

## Phase 3: Downloader

### Task 1: parseProgress (PURE)

**Files:**
- Create: `server/src/downloader/progress.js`
- Test: `server/test/downloader/progress.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `parseProgress(line: string) -> { percent: number } | null`

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect } from 'vitest';
import { parseProgress } from '../../src/downloader/progress.js';

describe('parseProgress', () => {
  it('parses a yt-dlp --newline download line into percent', () => {
    const line = '[download]  23.4% of 12.34MiB at 1.23MiB/s ETA 00:08';
    expect(parseProgress(line)).toEqual({ percent: 23.4 });
  });

  it('parses 100% completion line', () => {
    const line = '[download] 100% of 12.34MiB in 00:10';
    expect(parseProgress(line)).toEqual({ percent: 100 });
  });

  it('parses integer percent', () => {
    const line = '[download]   5% of ~10.00MiB at 500.00KiB/s ETA 00:20';
    expect(parseProgress(line)).toEqual({ percent: 5 });
  });

  it('returns null for non-progress lines', () => {
    expect(parseProgress('[youtube] abc123: Downloading webpage')).toBeNull();
    expect(parseProgress('[Merger] Merging formats into "out.mp4"')).toBeNull();
    expect(parseProgress('')).toBeNull();
  });

  it('returns null for a download line without a percentage', () => {
    expect(parseProgress('[download] Destination: video.f137.mp4')).toBeNull();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/downloader/progress.test.js`
Expected: FAIL — `parseProgress` is not exported / module `server/src/downloader/progress.js` does not exist.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/downloader/progress.js
// PURE: parse a yt-dlp --newline output line -> { percent } | null

const PROGRESS_RE = /^\[download\]\s+(\d+(?:\.\d+)?)%/;

export function parseProgress(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(PROGRESS_RE);
  if (!m) return null;
  return { percent: parseFloat(m[1]) };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/downloader/progress.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/downloader/progress.js server/test/downloader/progress.test.js
git commit -m "feat(downloader): parse yt-dlp progress lines into percent"
```

---

### Task 2: buildYtdlpArgs (PURE)

**Files:**
- Create: `server/src/downloader/args.js`
- Test: `server/test/downloader/args.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `buildYtdlpArgs({ url, outputTemplate, archivePath }) -> string[]`

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect } from 'vitest';
import { buildYtdlpArgs } from '../../src/downloader/args.js';

describe('buildYtdlpArgs', () => {
  const base = {
    url: 'https://www.youtube.com/watch?v=abc123',
    outputTemplate: 'C:/dl/%(uploader)s/%(title)s [%(id)s].%(ext)s',
    archivePath: 'C:/dl/archive.txt',
  };

  it('builds the full yt-dlp argument vector', () => {
    expect(buildYtdlpArgs(base)).toEqual([
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--newline',
      '--download-archive', 'C:/dl/archive.txt',
      '-o', 'C:/dl/%(uploader)s/%(title)s [%(id)s].%(ext)s',
      'https://www.youtube.com/watch?v=abc123',
    ]);
  });

  it('places the url as the final positional argument', () => {
    const args = buildYtdlpArgs(base);
    expect(args[args.length - 1]).toBe(base.url);
  });

  it('uses the best-video+best-audio format selector', () => {
    const args = buildYtdlpArgs(base);
    const fi = args.indexOf('-f');
    expect(args[fi + 1]).toBe('bv*+ba/b');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/downloader/args.test.js`
Expected: FAIL — `buildYtdlpArgs` is not exported / module does not exist.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/downloader/args.js
// PURE: assemble yt-dlp CLI args for best-quality merged download

export function buildYtdlpArgs({ url, outputTemplate, archivePath }) {
  return [
    '-f', 'bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--newline',
    '--download-archive', archivePath,
    '-o', outputTemplate,
    url,
  ];
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/downloader/args.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/downloader/args.js server/test/downloader/args.test.js
git commit -m "feat(downloader): build yt-dlp argument vector for best-quality merge"
```

---

### Task 3: resolveChannelId (mocked spawnFn)

**Files:**
- Create: `server/src/downloader/resolver.js`
- Test: `server/test/downloader/resolver.test.js`

**Interfaces:**
- Consumes: injected `spawnFn` (signature compatible with `node:child_process` `spawn(cmd, args)` returning a child with `stdout`/`stderr` EventEmitters and a process `EventEmitter` emitting `'close'`/`'error'`)
- Produces: `async resolveChannelId(input, { spawnFn=spawn }={}) -> 'UC...'`

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { resolveChannelId } from '../../src/downloader/resolver.js';

// Build a fake child process whose stdout emits `out`, stderr emits `err`,
// then the process emits 'close' with `code`.
function fakeChild({ out = '', err = '', code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (out) child.stdout.emit('data', Buffer.from(out));
    if (err) child.stderr.emit('data', Buffer.from(err));
    child.emit('close', code);
  });
  return child;
}

describe('resolveChannelId', () => {
  it('returns the channel_id printed by yt-dlp for a handle', async () => {
    const spawnFn = vi.fn(() =>
      fakeChild({ out: 'UCabcdef1234567890ABCDEF\n' })
    );
    const id = await resolveChannelId('@SomeHandle', { spawnFn });
    expect(id).toBe('UCabcdef1234567890ABCDEF');
  });

  it('invokes yt-dlp with --print channel_id and the input', async () => {
    const spawnFn = vi.fn(() => fakeChild({ out: 'UCxyz\n' }));
    await resolveChannelId('https://youtube.com/@x', { spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('yt-dlp');
    expect(args).toContain('--print');
    expect(args).toContain('channel_id');
    expect(args[args.length - 1]).toBe('https://youtube.com/@x');
  });

  it('trims and returns the first non-empty UC line if multiple printed', async () => {
    const spawnFn = vi.fn(() =>
      fakeChild({ out: '\nUConly1234567890\nUConly1234567890\n' })
    );
    const id = await resolveChannelId('UConly1234567890', { spawnFn });
    expect(id).toBe('UConly1234567890');
  });

  it('rejects when yt-dlp exits non-zero', async () => {
    const spawnFn = vi.fn(() =>
      fakeChild({ err: 'ERROR: unable to resolve\n', code: 1 })
    );
    await expect(
      resolveChannelId('garbage', { spawnFn })
    ).rejects.toThrow(/unable to resolve|exit/i);
  });

  it('rejects when output contains no channel id', async () => {
    const spawnFn = vi.fn(() => fakeChild({ out: 'NA\n', code: 0 }));
    await expect(
      resolveChannelId('weird', { spawnFn })
    ).rejects.toThrow(/channel id/i);
  });

  it('rejects when the child process errors', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    const spawnFn = vi.fn(() => child);
    await expect(
      resolveChannelId('@x', { spawnFn })
    ).rejects.toThrow(/ENOENT/);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/downloader/resolver.test.js`
Expected: FAIL — `resolveChannelId` is not exported / module does not exist.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/downloader/resolver.js
import { spawn } from 'node:child_process';

// Resolve any channel input (handle / channel URL / video URL / UC...) to a
// canonical 'UC...' id by asking yt-dlp to print the channel_id field.
export async function resolveChannelId(input, { spawnFn = spawn } = {}) {
  const args = ['--quiet', '--no-warnings', '--print', 'channel_id', input];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn('yt-dlp', args);
    } catch (err) {
      reject(err);
      return;
    }

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited ${code}: ${err.trim() || 'unknown error'}`));
        return;
      }
      const id = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /^UC[\w-]+$/.test(l));
      if (!id) {
        reject(new Error(`could not resolve channel id from input: ${input}`));
        return;
      }
      resolve(id);
    });
  });
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/downloader/resolver.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/downloader/resolver.js server/test/downloader/resolver.test.js
git commit -m "feat(downloader): resolve channel input to UC id via yt-dlp --print"
```

---

### Task 4: DownloadQueue — single job lifecycle + concurrency (start/progress/done, db status, concurrency gating)

**Files:**
- Create: `server/src/downloader/queue.js`
- Test: `server/test/downloader/queue.lifecycle.test.js`

**Interfaces:**
- Consumes:
  - `initDb(':memory:')`, `addChannel`, `upsertVideoIfNew`, `getVideo`, `updateVideoStatus` from `server/src/db/index.js`
  - Relies on Phase 1 `videos` schema columns: `status`, `download_path`, `retries` (snake_case), as written/read by `updateVideoStatus`/`incrementRetries`/`getVideo`. Confirm these exact column names against the Phase 1 schema task before starting.
  - `buildYtdlpArgs({url,outputTemplate,archivePath})` from `server/src/downloader/args.js`
  - `parseProgress(line)` from `server/src/downloader/progress.js`
  - injected `spawnFn`
- Produces: `class DownloadQueue extends EventEmitter` with `constructor({ db, concurrency, downloadDir, maxRetries=5, spawnFn=spawn })`, `enqueue(video)`; events `'start'({videoId})`, `'progress'({videoId,percent})`, `'done'({videoId,path})`, `'failed'({videoId,error})`. Ships `_pump()`/`_active` concurrency gating and the real-output-path capture used by later tasks. (Retry/backoff is intentionally NOT shipped here — see Task 6.)

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb, addChannel, upsertVideoIfNew, getVideo } from '../../src/db/index.js';
import { DownloadQueue } from '../../src/downloader/queue.js';

// Fake child: exposes stdout/stderr emitters to drive output.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 4242;
  return child;
}

function seedVideo(db) {
  addChannel(db, { channelId: 'UCseed', handle: '@seed', title: 'Seed', thumbnail: null, secret: 's' });
  const { row } = upsertVideoIfNew(db, {
    videoId: 'vid1',
    channelId: 'UCseed',
    title: 'Hello',
    publishedAt: 1000,
    updatedAt: 1000,
    thumbnailUrl: null,
  });
  return row;
}

function seedMany(db, n) {
  addChannel(db, { channelId: 'UCc', handle: '@c', title: 'C', thumbnail: null, secret: 's' });
  const rows = [];
  for (let i = 0; i < n; i++) {
    const { row } = upsertVideoIfNew(db, {
      videoId: `v${i}`, channelId: 'UCc', title: `T${i}`,
      publishedAt: 1000 + i, updatedAt: 1000 + i, thumbnailUrl: null,
    });
    rows.push(row);
  }
  return rows;
}

describe('DownloadQueue single job lifecycle', () => {
  it('emits start, forwards progress, emits done and stores the real file path in db', async () => {
    const db = initDb(':memory:');
    const video = seedVideo(db);

    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);

    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', spawnFn });

    const events = [];
    q.on('start', (e) => events.push(['start', e]));
    q.on('progress', (e) => events.push(['progress', e]));
    const done = new Promise((res) => q.on('done', (e) => { events.push(['done', e]); res(e); }));

    q.enqueue(video);

    // start is emitted once the job is picked up
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1));
    expect(events.find((e) => e[0] === 'start')).toEqual(['start', { videoId: 'vid1' }]);
    expect(getVideo(db, 'vid1').status).toBe('downloading');

    // drive progress + the real destination line yt-dlp prints + success exit
    child.stdout.emit('data', Buffer.from('[download]  42.0% of 10MiB at 1MiB/s ETA 00:05\n'));
    child.stdout.emit('data', Buffer.from('[download] Destination: C:/dl/Seed/Hello [vid1].mp4\n'));
    child.emit('close', 0);

    const doneEvt = await done;
    expect(doneEvt.videoId).toBe('vid1');
    expect(typeof doneEvt.path).toBe('string');
    expect(doneEvt.path).toBe('C:/dl/Seed/Hello [vid1].mp4');

    const prog = events.find((e) => e[0] === 'progress');
    expect(prog[1]).toEqual({ videoId: 'vid1', percent: 42.0 });

    const fresh = getVideo(db, 'vid1');
    expect(fresh.status).toBe('done');
    expect(fresh.download_path).toBe('C:/dl/Seed/Hello [vid1].mp4');
    // the stored path must be a concrete file path, not the unexpanded template
    expect(fresh.download_path).not.toContain('%(');
  });

  it('captures the merged-output path from the [Merger] line when present', async () => {
    const db = initDb(':memory:');
    const video = seedVideo(db);
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', spawnFn });

    const done = new Promise((res) => q.on('done', res));
    q.enqueue(video);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1));

    child.stdout.emit('data', Buffer.from('[download] Destination: C:/dl/Seed/Hello [vid1].f137.mp4\n'));
    child.stdout.emit('data', Buffer.from('[Merger] Merging formats into "C:/dl/Seed/Hello [vid1].mp4"\n'));
    child.emit('close', 0);

    const evt = await done;
    expect(evt.path).toBe('C:/dl/Seed/Hello [vid1].mp4');
    expect(getVideo(db, 'vid1').download_path).toBe('C:/dl/Seed/Hello [vid1].mp4');
  });

  it('spawns yt-dlp with args from buildYtdlpArgs (format selector + url)', async () => {
    const db = initDb(':memory:');
    const video = seedVideo(db);
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', spawnFn });

    q.enqueue(video);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(1));

    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('yt-dlp');
    expect(args).toContain('bv*+ba/b');
    expect(args[args.length - 1]).toContain('vid1');
    child.emit('close', 0);
  });

  it('never runs more than `concurrency` jobs at once', async () => {
    const db = initDb(':memory:');
    const rows = seedMany(db, 5);

    const children = [];
    const spawnFn = vi.fn(() => {
      const c = makeFakeChild();
      children.push(c);
      return c;
    });

    const q = new DownloadQueue({ db, concurrency: 2, downloadDir: 'C:/dl', spawnFn });

    let live = 0;
    let maxLive = 0;
    q.on('start', () => { live += 1; maxLive = Math.max(maxLive, live); });
    q.on('done', () => { live -= 1; });

    rows.forEach((r) => q.enqueue(r));

    // After enqueuing 5 with concurrency 2, only 2 should be spawned.
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(2));
    expect(maxLive).toBe(2);

    // Complete the first two -> the next two should start.
    children[0].emit('close', 0);
    children[1].emit('close', 0);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(4));
    expect(maxLive).toBe(2);

    // Complete remaining.
    children[2].emit('close', 0);
    children[3].emit('close', 0);
    await vi.waitFor(() => expect(spawnFn).toHaveBeenCalledTimes(5));
    children[4].emit('close', 0);

    await vi.waitFor(() => {
      expect(getVideo(db, 'v4').status).toBe('done');
      expect(live).toBe(0);
    });
    expect(maxLive).toBe(2);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/downloader/queue.lifecycle.test.js`
Expected: FAIL — `DownloadQueue` is not exported / module `server/src/downloader/queue.js` does not exist.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/downloader/queue.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildYtdlpArgs } from './args.js';
import { parseProgress } from './progress.js';
import { updateVideoStatus } from '../db/index.js';

const DEST_RE = /^\[download\]\s+Destination:\s+(.+)\s*$/;
const MERGER_RE = /^\[Merger\] Merging formats into "(.+)"\s*$/;
const ALREADY_RE = /^\[download\]\s+(.+) has already been downloaded\s*$/;

export class DownloadQueue extends EventEmitter {
  constructor({ db, concurrency, downloadDir, maxRetries = 5, spawnFn = spawn }) {
    super();
    this.db = db;
    this.concurrency = concurrency;
    this.downloadDir = downloadDir;
    this.maxRetries = maxRetries;
    this.spawnFn = spawnFn;
    this._queue = [];
    this._active = 0;
  }

  enqueue(video) {
    updateVideoStatus(this.db, video.video_id, 'queued');
    this._queue.push({ video, attempt: 0 });
    this._pump();
  }

  _pump() {
    while (this._active < this.concurrency && this._queue.length > 0) {
      const job = this._queue.shift();
      this._active += 1;
      this._run(job);
    }
  }

  _videoUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  _run(job) {
    const { video } = job;
    const videoId = video.video_id;
    const outputTemplate = path.join(
      this.downloadDir,
      '%(uploader)s',
      '%(title)s [%(id)s].%(ext)s'
    );
    const archivePath = path.join(this.downloadDir, 'archive.txt');
    const args = buildYtdlpArgs({
      url: this._videoUrl(videoId),
      outputTemplate,
      archivePath,
    });

    updateVideoStatus(this.db, videoId, 'downloading');
    this.emit('start', { videoId });

    const child = this.spawnFn('yt-dlp', args);
    let stderr = '';
    let destPath = null;
    let mergedPath = null;

    const onLine = (buf) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        const p = parseProgress(line);
        if (p) {
          this.emit('progress', { videoId, percent: p.percent });
          continue;
        }
        const merge = line.match(MERGER_RE);
        if (merge) { mergedPath = merge[1]; continue; }
        const dest = line.match(DEST_RE);
        if (dest) { destPath = dest[1]; continue; }
        const already = line.match(ALREADY_RE);
        if (already) { destPath = already[1]; }
      }
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const finish = () => { this._active -= 1; this._pump(); };

    child.on('error', (err) => {
      this._handleFailure(job, err.message || String(err), finish);
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Prefer the merged path; fall back to the download destination.
        const downloadPath = mergedPath || destPath || null;
        updateVideoStatus(this.db, videoId, 'done', { downloadPath });
        this.emit('done', { videoId, path: downloadPath });
        finish();
      } else {
        this._handleFailure(job, `yt-dlp exited ${code}: ${stderr.trim()}`, finish);
      }
    });
  }

  // Task 4 (naive): any failure goes straight to 'failed' with no retry.
  // Retry/backoff is added in Task 6.
  _handleFailure(job, error, finish) {
    const videoId = job.video.video_id;
    updateVideoStatus(this.db, videoId, 'failed', { error });
    this.emit('failed', { videoId, error });
    finish();
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/downloader/queue.lifecycle.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/downloader/queue.js server/test/downloader/queue.lifecycle.test.js
git commit -m "feat(downloader): DownloadQueue lifecycle, concurrency gating, real-path capture"
```

---

### Task 5: DownloadQueue — retry with backoff then failed

**Files:**
- Modify: `server/src/downloader/queue.js` — replace the naive `_handleFailure` (Task 4) with retry/backoff logic
- Test: `server/test/downloader/queue.retry.test.js`

**Interfaces:**
- Consumes:
  - `DownloadQueue` (Task 4); `initDb(':memory:')`, `addChannel`, `upsertVideoIfNew`, `getVideo` from db
  - `incrementRetries(db, videoId) -> number` and `updateVideoStatus(db, videoId, status, {error})` from `server/src/db/index.js`
  - Relies on Phase 1 `videos` schema columns: `status`, `retries` (snake_case), as read by `getVideo`. Confirm these exact column names against the Phase 1 schema task before starting.
- Produces: a retry-capable `_handleFailure(job, error, finish)` — `incrementRetries` then requeue after exponential backoff up to `maxRetries`, else mark `failed` and emit `'failed'`.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb, addChannel, upsertVideoIfNew, getVideo } from '../../src/db/index.js';
import { DownloadQueue } from '../../src/downloader/queue.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function seedOne(db) {
  addChannel(db, { channelId: 'UCr', handle: '@r', title: 'R', thumbnail: null, secret: 's' });
  const { row } = upsertVideoIfNew(db, {
    videoId: 'vr', channelId: 'UCr', title: 'Retry me',
    publishedAt: 1000, updatedAt: 1000, thumbnailUrl: null,
  });
  return row;
}

// Flush pending microtasks so synchronously-emitted child events are processed.
const flush = () => Promise.resolve();

describe('DownloadQueue retry/backoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries on non-zero exit up to maxRetries, then emits failed', async () => {
    const db = initDb(':memory:');
    const video = seedOne(db);

    const children = [];
    const spawnFn = vi.fn(() => {
      const c = makeFakeChild();
      children.push(c);
      return c;
    });

    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', maxRetries: 2, spawnFn });

    const failed = [];
    q.on('failed', (e) => failed.push(e));

    // attempt 1 spawns synchronously inside enqueue() -> _pump() -> _run().
    q.enqueue(video);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // attempt 1 fails -> incrementRetries=1, requeued after 1000ms backoff.
    children[0].stderr.emit('data', Buffer.from('ERROR: video unavailable'));
    children[0].emit('close', 1);
    expect(getVideo(db, 'vr').status).toBe('queued');
    expect(getVideo(db, 'vr').retries).toBe(1);

    // advance past backoff -> requeue callback runs -> attempt 2 spawns.
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawnFn.mock.calls.length).toBe(2);

    // attempt 2 fails -> retries=2 (== maxRetries) -> backoff 2000ms then attempt 3.
    children[1].emit('close', 1);
    expect(getVideo(db, 'vr').retries).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(spawnFn.mock.calls.length).toBe(3);

    // attempt 3 fails -> retries=3 (> maxRetries) -> failed, no more spawns.
    children[2].emit('close', 1);
    await flush();
    expect(getVideo(db, 'vr').status).toBe('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].videoId).toBe('vr');
    expect(failed[0].error).toMatch(/exited 1|unavailable/);
    expect(getVideo(db, 'vr').retries).toBe(3);
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });

  it('marks failed and emits when the child errors and retries are exhausted', async () => {
    const db = initDb(':memory:');
    const video = seedOne(db);
    const children = [];
    const spawnFn = vi.fn(() => { const c = makeFakeChild(); children.push(c); return c; });
    const q = new DownloadQueue({ db, concurrency: 1, downloadDir: 'C:/dl', maxRetries: 0, spawnFn });

    const failed = [];
    q.on('failed', (e) => failed.push(e));

    q.enqueue(video);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    children[0].emit('error', new Error('ENOENT: yt-dlp not found'));
    await flush();

    expect(getVideo(db, 'vr').status).toBe('failed');
    expect(failed[0].error).toMatch(/ENOENT/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/downloader/queue.retry.test.js`
Expected: FAIL — with the Task 4 naive `_handleFailure`, the first non-zero exit sets status `failed` and emits `'failed'` immediately. The assertion `expect(getVideo(db, 'vr').status).toBe('queued')` (and `.retries` to be `1`) fails because there is no `incrementRetries`/backoff requeue.

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/downloader/queue.js
// 1) Update the import to add incrementRetries:
import { updateVideoStatus, incrementRetries } from '../db/index.js';

// 2) Replace the naive _handleFailure from Task 4 with retry/backoff:
//
//   _handleFailure(job, error, finish) { ... }
//
// New body:
  _handleFailure(job, error, finish) {
    const videoId = job.video.video_id;
    const retries = incrementRetries(this.db, videoId);
    if (retries <= this.maxRetries) {
      const backoff = Math.min(1000 * 2 ** (retries - 1), 30000);
      updateVideoStatus(this.db, videoId, 'queued', { error });
      // Free the slot only after the backoff so the requeued job re-enters _pump.
      setTimeout(() => {
        this._queue.push({ video: job.video, attempt: retries });
        finish();
      }, backoff);
    } else {
      updateVideoStatus(this.db, videoId, 'failed', { error });
      this.emit('failed', { videoId, error });
      finish();
    }
  }
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/downloader/queue.retry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/downloader/queue.js server/test/downloader/queue.retry.test.js
git commit -m "feat(downloader): DownloadQueue retries with exponential backoff then fails"
```

---

### Phase 3 verification (not a TDD task)

After Tasks 1-5 are committed, run the gates below to confirm the phase deliverable. No new code or commit — each per-task green gate already covered its own change; this is a final cross-check only.

- Run the downloader suite: `npx vitest run test/downloader/`
  Expected: PASS, 5 files (progress, args, resolver, queue.lifecycle, queue.retry).
- Run the full project suite: `npm test`
  Expected: PASS (no regressions in earlier phases).

Deliverable confirmed when: `DownloadQueue` runs jobs within `concurrency`, parses progress via `parseProgress`, captures the real merged/destination file path into `videos.download_path`, retries failures with exponential backoff up to `maxRetries` then `failed`, and updates `videos.status` (`queued` -> `downloading` -> `done`/`failed`); `resolveChannelId` resolves input to `UC...`; `buildYtdlpArgs` produces the exact best-quality merge args.

---

## Phase 3.5: Management REST API, Static Serving & Preflight Surfacing

This phase implements the Management REST API consumed by the React UI (Phase 4). It builds `server/src/mgmtRoutes.js` (the `registerMgmtRoutes` registrar) and wires it into the existing `createMgmtApp` factory from Phase 0, then adds static SPA serving. All collaborators (db, tunnel, queue, deps) are injected — no globals, no real network, no real spawning, no real listen. Every HTTP test uses `supertest` against the app factory with fake `tunnel`/`queue`/`deps`.

---

### Task 1: GET /api/status route

**Files:**
- Create: `server/src/mgmtRoutes.js`
- Test: `server/test/mgmt/status.test.js`

**Interfaces:**
- Consumes: `registerMgmtRoutes(app, {db, tunnel, queue, deps})`; `tunnel.getStatus()->string`; `tunnel.getUrl()->url|null`; `listChannels(db)`; `listVideos(db,{limit})`; `deps.preflight` (array of `{name,found,path}`); db query for `status='downloading'`.
- Produces: `GET /api/status -> { tunnel:{status,url}, counts:{channels,videos,downloading}, preflight:[{name,found,path}] }`.

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/status.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, upsertVideoIfNew, updateVideoStatus } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, { tunnel, queue, deps } = {}) {
  const app = express();
  app.use(express.json());
  const fakeTunnel = tunnel || { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} };
  const fakeQueue = queue || { enqueue() {} };
  const fakeDeps = deps || { preflight: [] };
  registerMgmtRoutes(app, { db, tunnel: fakeTunnel, queue: fakeQueue, deps: fakeDeps });
  return app;
}

describe('GET /api/status', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('returns tunnel, counts and preflight', async () => {
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
    addChannel(db, { channelId: 'UC2', handle: '@b', title: 'B', thumbnail: 't', secret: 's' });
    upsertVideoIfNew(db, { videoId: 'v1', channelId: 'UC1', title: 'V1', publishedAt: '2026-01-01T00:00:00Z' });
    upsertVideoIfNew(db, { videoId: 'v2', channelId: 'UC1', title: 'V2', publishedAt: '2026-01-02T00:00:00Z' });
    updateVideoStatus(db, 'v1', 'downloading', {});

    const tunnel = { getStatus: () => 'online', getUrl: () => 'https://x.example', start() {}, stop() {} };
    const deps = { preflight: [{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }] };
    const app = makeApp(db, { tunnel, deps });

    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.tunnel).toEqual({ status: 'online', url: 'https://x.example' });
    expect(res.body.counts).toEqual({ channels: 2, videos: 2, downloading: 1 });
    expect(res.body.preflight).toEqual([{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }]);
  });

  it('defaults preflight to empty array and url to null', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.tunnel).toEqual({ status: 'offline', url: null });
    expect(res.body.counts).toEqual({ channels: 0, videos: 0, downloading: 0 });
    expect(res.body.preflight).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/status.test.js`
Expected: FAIL — `Cannot find module '../../src/mgmtRoutes.js'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/mgmtRoutes.js
import { listChannels, listVideos } from './db/index.js';

function countDownloading(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'downloading'").get();
  return row ? row.n : 0;
}

export function registerMgmtRoutes(app, { db, tunnel, queue, deps }) {
  app.get('/api/status', (req, res) => {
    res.json({
      tunnel: { status: tunnel.getStatus(), url: tunnel.getUrl() },
      counts: {
        channels: listChannels(db).length,
        videos: listVideos(db, { limit: 1000000 }).length,
        downloading: countDownloading(db),
      },
      preflight: deps.preflight || [],
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/status.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtRoutes.js server/test/mgmt/status.test.js && git commit -m "feat(mgmt): add GET /api/status route"
```

---

### Task 2: POST /api/tunnel/start and /api/tunnel/stop routes

**Files:**
- Modify: `server/src/mgmtRoutes.js`
- Test: `server/test/mgmt/tunnel.test.js`

**Interfaces:**
- Consumes: `tunnel.start()`; `tunnel.stop()`.
- Produces: `POST /api/tunnel/start -> 202`; `POST /api/tunnel/stop -> 202`.

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/tunnel.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, tunnel) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel,
    queue: { enqueue() {} },
    deps: { preflight: [] },
  });
  return app;
}

describe('tunnel control routes', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('POST /api/tunnel/start calls tunnel.start and returns 202', async () => {
    let started = 0;
    const tunnel = { getStatus: () => 'offline', getUrl: () => null, start() { started++; }, stop() {} };
    const app = makeApp(db, tunnel);
    const res = await request(app).post('/api/tunnel/start');
    expect(res.status).toBe(202);
    expect(started).toBe(1);
  });

  it('POST /api/tunnel/stop calls tunnel.stop and returns 202', async () => {
    let stopped = 0;
    const tunnel = { getStatus: () => 'online', getUrl: () => 'u', start() {}, stop() { stopped++; } };
    const app = makeApp(db, tunnel);
    const res = await request(app).post('/api/tunnel/stop');
    expect(res.status).toBe(202);
    expect(stopped).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/tunnel.test.js`
Expected: FAIL — routes not registered, requests return 404 (expected 202).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/mgmtRoutes.js
import { listChannels, listVideos } from './db/index.js';

function countDownloading(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'downloading'").get();
  return row ? row.n : 0;
}

export function registerMgmtRoutes(app, { db, tunnel, queue, deps }) {
  app.get('/api/status', (req, res) => {
    res.json({
      tunnel: { status: tunnel.getStatus(), url: tunnel.getUrl() },
      counts: {
        channels: listChannels(db).length,
        videos: listVideos(db, { limit: 1000000 }).length,
        downloading: countDownloading(db),
      },
      preflight: deps.preflight || [],
    });
  });

  app.post('/api/tunnel/start', (req, res) => {
    tunnel.start();
    res.status(202).end();
  });

  app.post('/api/tunnel/stop', (req, res) => {
    tunnel.stop();
    res.status(202).end();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/tunnel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtRoutes.js server/test/mgmt/tunnel.test.js && git commit -m "feat(mgmt): add tunnel start/stop routes"
```

---

### Task 3: GET /api/channels and POST /api/channels routes

**Files:**
- Modify: `server/src/mgmtRoutes.js`
- Test: `server/test/mgmt/channels-read-create.test.js`

**Interfaces:**
- Consumes: `listChannels(db)`; `getChannel(db,channelId)`; `addChannel(db,{channelId,handle,title,thumbnail,secret})->row`; `deps.resolveChannelId(input,opts)->'UC...'`; `deps.sendSubscription({hubUrl,callbackUrl,channelId,mode,secret,leaseSeconds,fetchFn})`; `deps.hubUrl`; `deps.leaseSeconds`; `deps.fetchFn`; `deps.genSecret()->string` (optional, default `randomBytes(16).toString('hex')`); `tunnel.getUrl()`.
- Produces: `GET /api/channels -> channel[]`; `POST /api/channels {input} -> channel` (400 missing input, 409 exists, 503 no tunnel url).

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/channels-read-create.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, getChannel } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, { tunnel, deps } = {}) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel: tunnel || { getStatus: () => 'online', getUrl: () => 'https://t.example', start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: deps || {},
  });
  return app;
}

function baseDeps(overrides = {}) {
  return {
    resolveChannelId: async () => 'UCnew',
    sendSubscription: async () => ({ ok: true, status: 202 }),
    hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: 432000,
    fetchFn: () => {},
    genSecret: () => 'deadbeef',
    preflight: [],
    ...overrides,
  };
}

describe('GET /api/channels', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('returns all channels', async () => {
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].channelId).toBe('UC1');
  });
});

describe('POST /api/channels', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('400 when input missing', async () => {
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).post('/api/channels').send({});
    expect(res.status).toBe(400);
  });

  it('503 when tunnel has no url', async () => {
    const tunnel = { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} };
    const app = makeApp(db, { tunnel, deps: baseDeps() });
    const res = await request(app).post('/api/channels').send({ input: '@whatever' });
    expect(res.status).toBe(503);
  });

  it('409 when channel already exists', async () => {
    addChannel(db, { channelId: 'UCnew', handle: '@x', title: 'X', thumbnail: 't', secret: 's' });
    const app = makeApp(db, { deps: baseDeps({ resolveChannelId: async () => 'UCnew' }) });
    const res = await request(app).post('/api/channels').send({ input: '@x' });
    expect(res.status).toBe(409);
  });

  it('resolves, adds channel, subscribes, returns channel', async () => {
    const calls = [];
    const deps = baseDeps({
      resolveChannelId: async (input, opts) => { calls.push(['resolve', input]); return 'UCnew'; },
      sendSubscription: async (args) => { calls.push(['sub', args]); return { ok: true, status: 202 }; },
      genSecret: () => 'deadbeef',
    });
    const app = makeApp(db, { deps });
    const res = await request(app).post('/api/channels').send({ input: '@new' });

    expect(res.status).toBe(200);
    expect(res.body.channelId).toBe('UCnew');
    expect(res.body.secret).toBe('deadbeef');
    // persisted
    expect(getChannel(db, 'UCnew')).toBeTruthy();
    // subscription sent with correct args
    const subCall = calls.find((c) => c[0] === 'sub')[1];
    expect(subCall.mode).toBe('subscribe');
    expect(subCall.channelId).toBe('UCnew');
    expect(subCall.secret).toBe('deadbeef');
    expect(subCall.callbackUrl).toBe('https://t.example/webhook/youtube');
    expect(subCall.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(subCall.leaseSeconds).toBe(432000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/channels-read-create.test.js`
Expected: FAIL — `/api/channels` routes not registered (404 instead of 200/400/409/503).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/mgmtRoutes.js
import { randomBytes } from 'node:crypto';
import {
  listChannels,
  listVideos,
  getChannel,
  addChannel,
} from './db/index.js';

function countDownloading(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'downloading'").get();
  return row ? row.n : 0;
}

export function registerMgmtRoutes(app, { db, tunnel, queue, deps }) {
  const genSecret = deps.genSecret || (() => randomBytes(16).toString('hex'));

  app.get('/api/status', (req, res) => {
    res.json({
      tunnel: { status: tunnel.getStatus(), url: tunnel.getUrl() },
      counts: {
        channels: listChannels(db).length,
        videos: listVideos(db, { limit: 1000000 }).length,
        downloading: countDownloading(db),
      },
      preflight: deps.preflight || [],
    });
  });

  app.post('/api/tunnel/start', (req, res) => {
    tunnel.start();
    res.status(202).end();
  });

  app.post('/api/tunnel/stop', (req, res) => {
    tunnel.stop();
    res.status(202).end();
  });

  app.get('/api/channels', (req, res) => {
    res.json(listChannels(db));
  });

  app.post('/api/channels', async (req, res, next) => {
    try {
      const input = req.body && req.body.input;
      if (!input) {
        return res.status(400).json({ error: 'input is required' });
      }
      const baseUrl = tunnel.getUrl();
      if (!baseUrl) {
        return res.status(503).json({ error: 'tunnel has no public url yet' });
      }
      const channelId = await deps.resolveChannelId(input, { spawnFn: deps.spawnFn });
      if (getChannel(db, channelId)) {
        return res.status(409).json({ error: 'channel already exists' });
      }
      const secret = genSecret();
      const callbackUrl = `${baseUrl}/webhook/youtube`;
      const channel = addChannel(db, {
        channelId,
        handle: input,
        title: input,
        thumbnail: null,
        secret,
      });
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl,
        channelId,
        mode: 'subscribe',
        secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      res.json(channel);
    } catch (err) {
      next(err);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/channels-read-create.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtRoutes.js server/test/mgmt/channels-read-create.test.js && git commit -m "feat(mgmt): add GET/POST /api/channels routes"
```

---

### Task 4: PATCH /api/channels/:id and DELETE /api/channels/:id routes

**Files:**
- Modify: `server/src/mgmtRoutes.js`
- Test: `server/test/mgmt/channels-update-delete.test.js`

**Interfaces:**
- Consumes: `getChannel(db,channelId)`; `setChannelActive(db,channelId,active)`; `removeChannel(db,channelId)`; `deps.sendSubscription({...,mode})`; `tunnel.getUrl()`.
- Produces: `PATCH /api/channels/:id {active} -> channel` (subscribe when active=true, unsubscribe when active=false); `DELETE /api/channels/:id -> 204` (unsubscribe then remove).

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/channels-update-delete.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, getChannel } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db, { tunnel, deps } = {}) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel: tunnel || { getStatus: () => 'online', getUrl: () => 'https://t.example', start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: deps || {},
  });
  return app;
}

function baseDeps(overrides = {}) {
  return {
    resolveChannelId: async () => 'UCx',
    sendSubscription: async () => ({ ok: true, status: 202 }),
    hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: 432000,
    fetchFn: () => {},
    genSecret: () => 'deadbeef',
    preflight: [],
    ...overrides,
  };
}

describe('PATCH /api/channels/:id', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 'sek' });
  });

  it('active=false unsubscribes and returns inactive channel', async () => {
    const calls = [];
    const deps = baseDeps({ sendSubscription: async (a) => { calls.push(a); return { ok: true, status: 202 }; } });
    const app = makeApp(db, { deps });
    const res = await request(app).patch('/api/channels/UC1').send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(0);
    expect(calls[0].mode).toBe('unsubscribe');
    expect(calls[0].channelId).toBe('UC1');
    expect(calls[0].secret).toBe('sek');
    expect(calls[0].callbackUrl).toBe('https://t.example/webhook/youtube');
  });

  it('active=true subscribes and returns active channel', async () => {
    const calls = [];
    const deps = baseDeps({ sendSubscription: async (a) => { calls.push(a); return { ok: true, status: 202 }; } });
    const app = makeApp(db, { deps });
    const res = await request(app).patch('/api/channels/UC1').send({ active: true });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(1);
    expect(calls[0].mode).toBe('subscribe');
  });

  it('404 for unknown channel', async () => {
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).patch('/api/channels/NOPE').send({ active: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/channels/:id', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 'sek' });
  });

  it('unsubscribes then removes and returns 204', async () => {
    const calls = [];
    const deps = baseDeps({ sendSubscription: async (a) => { calls.push(a); return { ok: true, status: 202 }; } });
    const app = makeApp(db, { deps });
    const res = await request(app).delete('/api/channels/UC1');
    expect(res.status).toBe(204);
    expect(calls[0].mode).toBe('unsubscribe');
    expect(calls[0].channelId).toBe('UC1');
    expect(getChannel(db, 'UC1')).toBeUndefined();
  });

  it('404 for unknown channel', async () => {
    const app = makeApp(db, { deps: baseDeps() });
    const res = await request(app).delete('/api/channels/NOPE');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/channels-update-delete.test.js`
Expected: FAIL — PATCH/DELETE routes not registered (404 for the success cases that expect 200/204).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/mgmtRoutes.js
import { randomBytes } from 'node:crypto';
import {
  listChannels,
  listVideos,
  getChannel,
  addChannel,
  setChannelActive,
  removeChannel,
} from './db/index.js';

function countDownloading(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'downloading'").get();
  return row ? row.n : 0;
}

export function registerMgmtRoutes(app, { db, tunnel, queue, deps }) {
  const genSecret = deps.genSecret || (() => randomBytes(16).toString('hex'));
  const callbackFor = () => {
    const baseUrl = tunnel.getUrl();
    return baseUrl ? `${baseUrl}/webhook/youtube` : null;
  };

  app.get('/api/status', (req, res) => {
    res.json({
      tunnel: { status: tunnel.getStatus(), url: tunnel.getUrl() },
      counts: {
        channels: listChannels(db).length,
        videos: listVideos(db, { limit: 1000000 }).length,
        downloading: countDownloading(db),
      },
      preflight: deps.preflight || [],
    });
  });

  app.post('/api/tunnel/start', (req, res) => {
    tunnel.start();
    res.status(202).end();
  });

  app.post('/api/tunnel/stop', (req, res) => {
    tunnel.stop();
    res.status(202).end();
  });

  app.get('/api/channels', (req, res) => {
    res.json(listChannels(db));
  });

  app.post('/api/channels', async (req, res, next) => {
    try {
      const input = req.body && req.body.input;
      if (!input) {
        return res.status(400).json({ error: 'input is required' });
      }
      const callbackUrl = callbackFor();
      if (!callbackUrl) {
        return res.status(503).json({ error: 'tunnel has no public url yet' });
      }
      const channelId = await deps.resolveChannelId(input, { spawnFn: deps.spawnFn });
      if (getChannel(db, channelId)) {
        return res.status(409).json({ error: 'channel already exists' });
      }
      const secret = genSecret();
      const channel = addChannel(db, {
        channelId,
        handle: input,
        title: input,
        thumbnail: null,
        secret,
      });
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl,
        channelId,
        mode: 'subscribe',
        secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      res.json(channel);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/channels/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = getChannel(db, id);
      if (!existing) {
        return res.status(404).json({ error: 'channel not found' });
      }
      const active = !!(req.body && req.body.active);
      setChannelActive(db, id, active);
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl: callbackFor(),
        channelId: id,
        mode: active ? 'subscribe' : 'unsubscribe',
        secret: existing.secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      res.json(getChannel(db, id));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/channels/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = getChannel(db, id);
      if (!existing) {
        return res.status(404).json({ error: 'channel not found' });
      }
      await deps.sendSubscription({
        hubUrl: deps.hubUrl,
        callbackUrl: callbackFor(),
        channelId: id,
        mode: 'unsubscribe',
        secret: existing.secret,
        leaseSeconds: deps.leaseSeconds,
        fetchFn: deps.fetchFn,
      });
      removeChannel(db, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/channels-update-delete.test.js`
Expected: PASS. (Also re-run `npx vitest run test/mgmt/channels-read-create.test.js` — still PASS.)

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtRoutes.js server/test/mgmt/channels-update-delete.test.js && git commit -m "feat(mgmt): add PATCH/DELETE /api/channels/:id routes"
```

---

### Task 5: GET /api/videos route

**Files:**
- Modify: `server/src/mgmtRoutes.js`
- Test: `server/test/mgmt/videos.test.js`

**Interfaces:**
- Consumes: `listVideos(db,{limit})->video[]` (newest first).
- Produces: `GET /api/videos?limit= -> video[]` (default limit 50).

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/videos.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, addChannel, upsertVideoIfNew } from '../../src/db/index.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel: { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: { preflight: [] },
  });
  return app;
}

describe('GET /api/videos', () => {
  let db;
  beforeEach(() => {
    db = initDb(':memory:');
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
  });

  it('returns videos newest first with default limit 50', async () => {
    for (let i = 0; i < 60; i++) {
      upsertVideoIfNew(db, {
        videoId: `v${i}`,
        channelId: 'UC1',
        title: `V${i}`,
        publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      });
    }
    const app = makeApp(db);
    const res = await request(app).get('/api/videos');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(50);
    expect(res.body[0].videoId).toBe('v59');
  });

  it('honors explicit limit query param', async () => {
    upsertVideoIfNew(db, { videoId: 'a', channelId: 'UC1', title: 'A', publishedAt: '2026-01-01T00:00:00Z' });
    upsertVideoIfNew(db, { videoId: 'b', channelId: 'UC1', title: 'B', publishedAt: '2026-01-02T00:00:00Z' });
    const app = makeApp(db);
    const res = await request(app).get('/api/videos?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].videoId).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/videos.test.js`
Expected: FAIL — `/api/videos` not registered (404 instead of 200).

- [ ] **Step 3: Write minimal implementation**
Add this route inside `registerMgmtRoutes`, immediately after the `delete('/api/channels/:id', ...)` handler:
```js
  app.get('/api/videos', (req, res) => {
    const raw = req.query.limit;
    const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
    res.json(listVideos(db, { limit }));
  });
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/videos.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtRoutes.js server/test/mgmt/videos.test.js && git commit -m "feat(mgmt): add GET /api/videos route"
```

---

### Task 6: GET /api/settings and PATCH /api/settings routes

**Files:**
- Modify: `server/src/mgmtRoutes.js`
- Test: `server/test/mgmt/settings.test.js`

**Interfaces:**
- Consumes: `getAllSettings(db)->{key:value}`; `setSetting(db,key,value)`; `DEFAULTS` from `./config.js`.
- Produces: `GET /api/settings -> getAllSettings merged over DEFAULTS`; `PATCH /api/settings {..} -> merged settings`.

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/settings.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDb, setSetting } from '../../src/db/index.js';
import { DEFAULTS } from '../../src/config.js';
import { registerMgmtRoutes } from '../../src/mgmtRoutes.js';

function makeApp(db) {
  const app = express();
  app.use(express.json());
  registerMgmtRoutes(app, {
    db,
    tunnel: { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: { preflight: [] },
  });
  return app;
}

describe('GET /api/settings', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('returns DEFAULTS when nothing stored', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.maxConcurrency).toBe(DEFAULTS.maxConcurrency);
    expect(res.body.downloadDir).toBe(DEFAULTS.downloadDir);
  });

  it('merges stored values over DEFAULTS', async () => {
    setSetting(db, 'maxConcurrency', '5');
    const app = makeApp(db);
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.maxConcurrency).toBe('5');
    expect(res.body.webhookPort).toBe(DEFAULTS.webhookPort);
  });
});

describe('PATCH /api/settings', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('persists each key and returns merged settings', async () => {
    const app = makeApp(db);
    const res = await request(app)
      .patch('/api/settings')
      .send({ maxConcurrency: '4', downloadDir: '/data/dl' });
    expect(res.status).toBe(200);
    expect(res.body.maxConcurrency).toBe('4');
    expect(res.body.downloadDir).toBe('/data/dl');
    // unspecified keys still default
    expect(res.body.leaseSeconds).toBe(DEFAULTS.leaseSeconds);

    // persisted across a fresh request
    const res2 = await request(app).get('/api/settings');
    expect(res2.body.maxConcurrency).toBe('4');
    expect(res2.body.downloadDir).toBe('/data/dl');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/settings.test.js`
Expected: FAIL — `/api/settings` routes not registered (404 instead of 200).

- [ ] **Step 3: Write minimal implementation**
Add the import for DEFAULTS/getAllSettings/setSetting and the two routes. At the top of `server/src/mgmtRoutes.js` add to the existing imports:
```js
import { getAllSettings, setSetting } from './db/index.js';
import { DEFAULTS } from './config.js';
```
Then add a helper and the routes inside `registerMgmtRoutes`, after the `/api/videos` handler:
```js
  const mergedSettings = () => ({ ...DEFAULTS, ...getAllSettings(db) });

  app.get('/api/settings', (req, res) => {
    res.json(mergedSettings());
  });

  app.patch('/api/settings', (req, res) => {
    const body = req.body || {};
    for (const [key, value] of Object.entries(body)) {
      setSetting(db, key, value);
    }
    res.json(mergedSettings());
  });
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/settings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtRoutes.js server/test/mgmt/settings.test.js && git commit -m "feat(mgmt): add GET/PATCH /api/settings routes"
```

---

### Task 7: Wire registerMgmtRoutes into createMgmtApp + static SPA serving

**Files:**
- Modify: `server/src/mgmtApp.js`
- Test: `server/test/mgmt/app-wiring.test.js`

**Interfaces:**
- Consumes: `createMgmtApp({db, tunnel, queue, deps}) -> express app`; `registerMgmtRoutes(app, {db, tunnel, queue, deps})`; `express.static`; `fs.existsSync`.
- Produces: `createMgmtApp` returns an app whose `/api/*` routes are live, sets `app.locals.deps = {db, tunnel, queue, ...deps}`, and (when `../client/dist` exists) serves static files with a SPA fallback to `index.html` for non-`/api` routes; when the dist dir is absent, behavior is unchanged so tests without a build still pass.

- [ ] **Step 1: Write the failing test**
```js
// server/test/mgmt/app-wiring.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { initDb, addChannel } from '../../src/db/index.js';
import { createMgmtApp } from '../../src/mgmtApp.js';

function deps(overrides = {}) {
  return {
    config: {},
    resolveChannelId: async () => 'UCx',
    sendSubscription: async () => ({ ok: true, status: 202 }),
    hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
    leaseSeconds: 432000,
    fetchFn: () => {},
    preflight: [{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }],
    ...overrides,
  };
}

function makeApp(db) {
  return createMgmtApp({
    db,
    tunnel: { getStatus: () => 'offline', getUrl: () => null, start() {}, stop() {} },
    queue: { enqueue() {} },
    deps: deps(),
  });
}

describe('createMgmtApp wiring', () => {
  let db;
  beforeEach(() => { db = initDb(':memory:'); });

  it('exposes the api routes via registerMgmtRoutes', async () => {
    addChannel(db, { channelId: 'UC1', handle: '@a', title: 'A', thumbnail: 't', secret: 's' });
    const app = makeApp(db);
    const res = await request(app).get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('surfaces preflight through /api/status', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.preflight).toEqual([{ name: 'yt-dlp', found: true, path: '/usr/bin/yt-dlp' }]);
  });

  it('sets app.locals.deps including db, tunnel, queue and spread deps', () => {
    const app = makeApp(db);
    expect(app.locals.deps.db).toBe(db);
    expect(app.locals.deps.tunnel).toBeTruthy();
    expect(app.locals.deps.queue).toBeTruthy();
    expect(app.locals.deps.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
  });

  it('returns 404 for unknown non-api routes when no client build exists', async () => {
    const app = makeApp(db);
    const res = await request(app).get('/totally-unknown-page');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mgmt/app-wiring.test.js`
Expected: FAIL — `createMgmtApp` only has `express.json()` and the placeholder comment, so `/api/channels` and `/api/status` return 404 (expected 200).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/mgmtApp.js
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMgmtRoutes } from './mgmtRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMgmtApp({ db, tunnel, queue, deps = {} }) {
  const app = express();
  app.use(express.json());

  app.locals.deps = { db, tunnel, queue, ...deps };

  registerMgmtRoutes(app, { db, tunnel, queue, deps });

  const clientDist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mgmt/app-wiring.test.js`
Expected: PASS. (Full sanity: `npx vitest run test/mgmt` — all mgmt tests PASS.)

- [ ] **Step 5: Commit**
```bash
git add server/src/mgmtApp.js server/test/mgmt/app-wiring.test.js && git commit -m "feat(mgmt): wire mgmt routes and SPA static serving into createMgmtApp"
```

---

## Phase 4: React Dashboard UI

This phase scaffolds the Vite + React + Tailwind client and builds every client module from the contract test-first. Server tests use Node; client tests use the jsdom environment, so this phase adds a dedicated `client/vitest.config.js` and `client/src/test/setup.js`. All network and socket dependencies are injected or mocked — no real fetch, no real socket connection.

---

### Task 1: Client scaffold + Vitest/jsdom test harness

**Files:**
- Create: `client/package.json`
- Create: `client/.gitignore`
- Create: `client/vite.config.js`
- Create: `client/vitest.config.js`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`
- Create: `client/index.html`
- Create: `client/src/index.css`
- Create: `client/src/main.jsx`
- Create: `client/src/test/setup.js`
- Create: `client/src/test/smoke.test.jsx`
- Test: `client/src/test/smoke.test.jsx`

**Interfaces:**
- Consumes: nothing (scaffold).
- Produces: jsdom test environment + `@testing-library/jest-dom` matchers available to all later client tasks; `client/dist` build target consumed by `createMgmtApp`.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/test/smoke.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello() {
  return <h1>YT-Notify</h1>;
}

describe('test harness', () => {
  it('renders a component into jsdom and matches jest-dom', () => {
    render(<Hello />);
    expect(screen.getByRole('heading', { name: 'YT-Notify' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/test/smoke.test.jsx -t "renders a component into jsdom"`
Expected: FAIL — no `package.json`/deps installed, `@testing-library/react` and `vitest` cannot be resolved, and `toBeInTheDocument` is undefined (no jest-dom setup).

- [ ] **Step 3: Write minimal implementation**
```json
// client/package.json
{
  "name": "yt-notify-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "lucide-react": "^0.408.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.7.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.6",
    "vite": "^5.3.4",
    "vitest": "^2.0.4"
  }
}
```
```
# client/.gitignore
node_modules
dist
```
```js
// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/socket.io': { target: 'http://127.0.0.1:5174', ws: true },
    },
  },
});
```
```js
// client/vitest.config.js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
```
```js
// client/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
```
```js
// client/postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```
```html
<!-- client/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YT-Notify Local Hub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```
```css
/* client/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```
```jsx
// client/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```
```js
// client/src/test/setup.js
import '@testing-library/jest-dom/vitest';
```
> Run `cd client && npm install` after creating these files so the harness can resolve.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/test/smoke.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/package.json client/.gitignore client/vite.config.js client/vitest.config.js client/tailwind.config.js client/postcss.config.js client/index.html client/src/index.css client/src/main.jsx client/src/test/setup.js client/src/test/smoke.test.jsx
git commit -m "chore(client): scaffold vite+react+tailwind with vitest jsdom harness"
```

---

### Task 2: `api.js` REST fetch wrapper

**Files:**
- Create: `client/src/api.js`
- Test: `client/src/api.test.js`

**Interfaces:**
- Consumes: REST API from contract (`GET /api/status`, `GET /api/channels`, `POST /api/channels {input}`, `DELETE /api/channels/:id`, `PATCH /api/channels/:id {active}`, `GET /api/videos?limit=`, `GET /api/settings`, `PATCH /api/settings`, `POST /api/tunnel/start`, `POST /api/tunnel/stop`).
- Produces: `getStatus()`, `listChannels()`, `addChannel(input)`, `deleteChannel(id)`, `toggleChannel(id, active)`, `listVideos(limit)`, `getSettings()`, `patchSettings(patch)`, `startTunnel()`, `stopTunnel()` — all return Promises; JSON endpoints resolve to parsed body, 202 endpoints resolve to `true`.

- [ ] **Step 1: Write the failing test**
```js
// client/src/api.test.js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as api from './api.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const realFetch = globalThis.fetch;

describe('api wrapper', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('getStatus GETs /api/status and returns parsed json', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ tunnel: { status: 'online', url: 'https://x.trycloudflare.com' }, counts: { channels: 1, videos: 2, downloading: 0 } })
    );
    const out = await api.getStatus();
    expect(fetch).toHaveBeenCalledWith('/api/status');
    expect(out.tunnel.status).toBe('online');
  });

  it('listChannels GETs /api/channels', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([{ channel_id: 'UC1' }]));
    const out = await api.listChannels();
    expect(fetch).toHaveBeenCalledWith('/api/channels');
    expect(out).toEqual([{ channel_id: 'UC1' }]);
  });

  it('addChannel POSTs JSON {input} to /api/channels', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ channel_id: 'UC9' }));
    const out = await api.addChannel('@somehandle');
    expect(fetch).toHaveBeenCalledWith('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '@somehandle' }),
    });
    expect(out.channel_id).toBe('UC9');
  });

  it('deleteChannel DELETEs /api/channels/:id', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}, 200));
    await api.deleteChannel('UC1');
    expect(fetch).toHaveBeenCalledWith('/api/channels/UC1', { method: 'DELETE' });
  });

  it('toggleChannel PATCHes {active} to /api/channels/:id', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ channel_id: 'UC1', active: 0 }));
    const out = await api.toggleChannel('UC1', false);
    expect(fetch).toHaveBeenCalledWith('/api/channels/UC1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    expect(out.active).toBe(0);
  });

  it('listVideos GETs /api/videos with limit query', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([{ video_id: 'v1' }]));
    const out = await api.listVideos(25);
    expect(fetch).toHaveBeenCalledWith('/api/videos?limit=25');
    expect(out).toEqual([{ video_id: 'v1' }]);
  });

  it('getSettings GETs /api/settings', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ max_concurrency: '2' }));
    const out = await api.getSettings();
    expect(fetch).toHaveBeenCalledWith('/api/settings');
    expect(out.max_concurrency).toBe('2');
  });

  it('patchSettings PATCHes JSON to /api/settings', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ max_concurrency: '3' }));
    const out = await api.patchSettings({ max_concurrency: '3' });
    expect(fetch).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_concurrency: '3' }),
    });
    expect(out.max_concurrency).toBe('3');
  });

  it('startTunnel POSTs /api/tunnel/start and returns true on 202', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) });
    const out = await api.startTunnel();
    expect(fetch).toHaveBeenCalledWith('/api/tunnel/start', { method: 'POST' });
    expect(out).toBe(true);
  });

  it('stopTunnel POSTs /api/tunnel/stop and returns true on 202', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) });
    const out = await api.stopTunnel();
    expect(fetch).toHaveBeenCalledWith('/api/tunnel/stop', { method: 'POST' });
    expect(out).toBe(true);
  });

  it('throws on non-ok json response', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 500));
    await expect(api.getStatus()).rejects.toThrow('HTTP 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/api.test.js -t "getStatus GETs /api/status and returns parsed json"`
Expected: FAIL — `client/src/api.js` does not exist; import cannot be resolved.

- [ ] **Step 3: Write minimal implementation**
```js
// client/src/api.js
async function request(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

async function getJson(url) {
  const res = await request(url);
  return res.json();
}

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function getStatus() {
  return getJson('/api/status');
}

export function listChannels() {
  return getJson('/api/channels');
}

export async function addChannel(input) {
  const res = await request('/api/channels', jsonInit('POST', { input }));
  return res.json();
}

export async function deleteChannel(id) {
  await request(`/api/channels/${id}`, { method: 'DELETE' });
  return true;
}

export async function toggleChannel(id, active) {
  const res = await request(`/api/channels/${id}`, jsonInit('PATCH', { active }));
  return res.json();
}

export function listVideos(limit = 50) {
  return getJson(`/api/videos?limit=${limit}`);
}

export function getSettings() {
  return getJson('/api/settings');
}

export async function patchSettings(patch) {
  const res = await request('/api/settings', jsonInit('PATCH', patch));
  return res.json();
}

export async function startTunnel() {
  await request('/api/tunnel/start', { method: 'POST' });
  return true;
}

export async function stopTunnel() {
  await request('/api/tunnel/stop', { method: 'POST' });
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/api.js client/src/api.test.js
git commit -m "feat(client): add api fetch wrapper for rest endpoints"
```

---

### Task 3: `socket.js` — `useSocket()` hook

**Files:**
- Create: `client/src/socket.js`
- Test: `client/src/socket.test.jsx`

**Interfaces:**
- Consumes: Socket.io server->client events from contract: `tunnel:status`{status,url}, `video:new`{video}, `download:start`{videoId}, `download:progress`{videoId,percent}, `download:done`{videoId,path}, `download:failed`{videoId,error}, `log`{line}.
- Produces: `useSocket()` -> `{ tunnel:{status,url}, videos:[], progress:{[videoId]:percent}, logs:[], connected:boolean }`. Reacts live to incoming socket events. `socket.io-client` `io` is the injection seam (`vi.mock('socket.io-client')`).

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/socket.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Fake socket: records handlers so the test can emit events.
const handlers = {};
const fakeSocket = {
  on: vi.fn((evt, cb) => { handlers[evt] = cb; }),
  off: vi.fn((evt) => { delete handlers[evt]; }),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

import { useSocket } from './socket.js';

function Probe() {
  const { tunnel, videos, progress, logs, connected } = useSocket();
  return (
    <div>
      <span data-testid="status">{tunnel.status}</span>
      <span data-testid="url">{tunnel.url || ''}</span>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="video-count">{videos.length}</span>
      <span data-testid="first-video">{videos[0]?.video_id || ''}</span>
      <span data-testid="progress-v1">{progress.v1 ?? ''}</span>
      <span data-testid="log-count">{logs.length}</span>
    </div>
  );
}

describe('useSocket', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it('starts offline/disconnected, then reflects connect', () => {
    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('offline');
    expect(screen.getByTestId('connected').textContent).toBe('false');
    act(() => handlers['connect']());
    expect(screen.getByTestId('connected').textContent).toBe('true');
  });

  it('updates tunnel state on tunnel:status', () => {
    render(<Probe />);
    act(() => handlers['tunnel:status']({ status: 'online', url: 'https://x.trycloudflare.com' }));
    expect(screen.getByTestId('status').textContent).toBe('online');
    expect(screen.getByTestId('url').textContent).toBe('https://x.trycloudflare.com');
  });

  it('prepends incoming video:new to videos list', () => {
    render(<Probe />);
    act(() => handlers['video:new']({ video: { video_id: 'a' } }));
    act(() => handlers['video:new']({ video: { video_id: 'b' } }));
    expect(screen.getByTestId('video-count').textContent).toBe('2');
    expect(screen.getByTestId('first-video').textContent).toBe('b');
  });

  it('tracks download progress keyed by videoId', () => {
    render(<Probe />);
    act(() => handlers['download:progress']({ videoId: 'v1', percent: 42 }));
    expect(screen.getByTestId('progress-v1').textContent).toBe('42');
  });

  it('appends log lines', () => {
    render(<Probe />);
    act(() => handlers['log']({ line: 'hello' }));
    act(() => handlers['log']({ line: 'world' }));
    expect(screen.getByTestId('log-count').textContent).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/socket.test.jsx -t "starts offline/disconnected, then reflects connect"`
Expected: FAIL — `client/src/socket.js` does not exist; `useSocket` import is undefined.

- [ ] **Step 3: Write minimal implementation**
```js
// client/src/socket.js
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [tunnel, setTunnel] = useState({ status: 'offline', url: null });
  const [videos, setVideos] = useState([]);
  const [progress, setProgress] = useState({});
  const [logs, setLogs] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io({ autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('tunnel:status', ({ status, url }) =>
      setTunnel({ status, url: url ?? null })
    );
    socket.on('video:new', ({ video }) =>
      setVideos((prev) => [video, ...prev])
    );
    socket.on('download:start', ({ videoId }) =>
      setProgress((prev) => ({ ...prev, [videoId]: 0 }))
    );
    socket.on('download:progress', ({ videoId, percent }) =>
      setProgress((prev) => ({ ...prev, [videoId]: percent }))
    );
    socket.on('download:done', ({ videoId }) =>
      setProgress((prev) => ({ ...prev, [videoId]: 100 }))
    );
    socket.on('download:failed', ({ videoId }) =>
      setProgress((prev) => {
        const next = { ...prev };
        delete next[videoId];
        return next;
      })
    );
    socket.on('log', ({ line }) =>
      setLogs((prev) => [...prev, line])
    );

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('tunnel:status');
      socket.off('video:new');
      socket.off('download:start');
      socket.off('download:progress');
      socket.off('download:done');
      socket.off('download:failed');
      socket.off('log');
      socket.disconnect();
    };
  }, []);

  return { connected, tunnel, videos, progress, logs };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/socket.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/socket.js client/src/socket.test.jsx
git commit -m "feat(client): add useSocket hook for realtime dashboard state"
```

---

### Task 4: `format.js` relative-time helper + thumbnail URL builder

**Files:**
- Create: `client/src/lib/format.js`
- Test: `client/src/lib/format.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `thumbUrl(videoId)` -> `https://i.ytimg.com/vi/<id>/hqdefault.jpg`; `relativeTime(tsMs, now)` -> human string (`'just now'`, `'5m ago'`, `'3h ago'`, `'2d ago'`). Pure functions consumed by VideoFeed/ChannelList.

- [ ] **Step 1: Write the failing test**
```js
// client/src/lib/format.test.js
import { describe, it, expect } from 'vitest';
import { thumbUrl, relativeTime } from './format.js';

describe('thumbUrl', () => {
  it('builds the i.ytimg hqdefault url', () => {
    expect(thumbUrl('abc123')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('returns "just now" under a minute', () => {
    expect(relativeTime(now - 30_000, now)).toBe('just now');
  });
  it('returns minutes', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
  });
  it('returns hours', () => {
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });
  it('returns days', () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('handles missing timestamp gracefully', () => {
    expect(relativeTime(null, now)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/lib/format.test.js -t "builds the i.ytimg hqdefault url"`
Expected: FAIL — `client/src/lib/format.js` does not exist.

- [ ] **Step 3: Write minimal implementation**
```js
// client/src/lib/format.js
export function thumbUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function relativeTime(tsMs, now = Date.now()) {
  if (tsMs == null) return '';
  const diff = now - tsMs;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/lib/format.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/lib/format.js client/src/lib/format.test.js
git commit -m "feat(client): add thumbnail url and relative time helpers"
```

---

### Task 5: `StatusBar` component

**Files:**
- Create: `client/src/components/StatusBar.jsx`
- Test: `client/src/components/StatusBar.test.jsx`

**Interfaces:**
- Consumes: tunnel shape `{status,url}` from `useSocket`; `lucide-react` icons.
- Produces: `<StatusBar tunnel={{status,url}} onStart onStop />`. Shows status text + url; renders a Start button when offline and a Stop button when online/connecting; clicking invokes the matching callback.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/components/StatusBar.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusBar from './StatusBar.jsx';

describe('StatusBar', () => {
  it('shows offline status and a Start button', () => {
    const onStart = vi.fn();
    render(<StatusBar tunnel={{ status: 'offline', url: null }} onStart={onStart} onStop={() => {}} />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /start/i });
    fireEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the public url and a Stop button when online', () => {
    const onStop = vi.fn();
    render(
      <StatusBar
        tunnel={{ status: 'online', url: 'https://x.trycloudflare.com' }}
        onStart={() => {}}
        onStop={onStop}
      />
    );
    expect(screen.getByText('https://x.trycloudflare.com')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /stop/i });
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows connecting status with a Stop button', () => {
    render(<StatusBar tunnel={{ status: 'connecting', url: null }} onStart={() => {}} onStop={() => {}} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/components/StatusBar.test.jsx -t "shows offline status and a Start button"`
Expected: FAIL — `client/src/components/StatusBar.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**
```jsx
// client/src/components/StatusBar.jsx
import { Wifi, WifiOff, Play, Square, Loader2 } from 'lucide-react';

const ICONS = {
  online: Wifi,
  connecting: Loader2,
  offline: WifiOff,
};

export default function StatusBar({ tunnel, onStart, onStop }) {
  const status = tunnel?.status || 'offline';
  const url = tunnel?.url || null;
  const Icon = ICONS[status] || WifiOff;
  const isOffline = status === 'offline';

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-800 px-4 py-3 text-slate-100">
      <div className="flex items-center gap-3">
        <Icon className={status === 'connecting' ? 'animate-spin' : ''} size={20} />
        <div className="flex flex-col">
          <span className="text-sm font-medium capitalize">{status}</span>
          {url && <span className="text-xs text-sky-300 break-all">{url}</span>}
        </div>
      </div>
      {isOffline ? (
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500"
        >
          <Play size={16} /> Start
        </button>
      ) : (
        <button
          type="button"
          onClick={onStop}
          className="flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-sm hover:bg-rose-500"
        >
          <Square size={16} /> Stop
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/components/StatusBar.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/components/StatusBar.jsx client/src/components/StatusBar.test.jsx
git commit -m "feat(client): add StatusBar with tunnel start/stop controls"
```

---

### Task 6: `AddChannel` component

**Files:**
- Create: `client/src/components/AddChannel.jsx`
- Test: `client/src/components/AddChannel.test.jsx`

**Interfaces:**
- Consumes: `lucide-react`.
- Produces: `<AddChannel onAdd={(input) => Promise} />`. Controlled input; submitting trims and calls `onAdd(input)`; clears input on resolve; disables the button while pending; ignores empty/whitespace submissions.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/components/AddChannel.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddChannel from './AddChannel.jsx';

describe('AddChannel', () => {
  it('calls onAdd with trimmed input on submit and clears the field', async () => {
    const onAdd = vi.fn().mockResolvedValue({ channel_id: 'UC1' });
    render(<AddChannel onAdd={onAdd} />);
    const input = screen.getByPlaceholderText(/@handle/i);
    fireEvent.change(input, { target: { value: '  @cool  ' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith('@cool');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not call onAdd for empty/whitespace input', () => {
    const onAdd = vi.fn();
    render(<AddChannel onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText(/@handle/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('disables the button while the add is pending', async () => {
    let resolve;
    const onAdd = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<AddChannel onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText(/@handle/i), { target: { value: '@x' } });
    const btn = screen.getByRole('button', { name: /add/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolve({ channel_id: 'UCx' });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/components/AddChannel.test.jsx -t "calls onAdd with trimmed input on submit and clears the field"`
Expected: FAIL — `client/src/components/AddChannel.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**
```jsx
// client/src/components/AddChannel.jsx
import { useState } from 'react';
import { Plus } from 'lucide-react';

export default function AddChannel({ onAdd }) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onAdd(trimmed);
      setValue('');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="@handle, channel URL, video URL, or UC..."
        className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1 rounded bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
      >
        <Plus size={16} /> Add
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/components/AddChannel.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/components/AddChannel.jsx client/src/components/AddChannel.test.jsx
git commit -m "feat(client): add AddChannel input with async submit handling"
```

---

### Task 7: `ChannelList` component

**Files:**
- Create: `client/src/components/ChannelList.jsx`
- Test: `client/src/components/ChannelList.test.jsx`

**Interfaces:**
- Consumes: channel rows (`channel_id`, `title`, `handle`, `thumbnail`, `active`) from `GET /api/channels`; `lucide-react`.
- Produces: `<ChannelList channels={[]} onToggle={(id, active)=>...} onRemove={(id)=>...} />`. Lists channels; each has an active toggle (passes the negated current state) and a remove button.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/components/ChannelList.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ChannelList from './ChannelList.jsx';

const channels = [
  { channel_id: 'UC1', title: 'Alpha', handle: '@alpha', thumbnail: '', active: 1 },
  { channel_id: 'UC2', title: 'Beta', handle: '@beta', thumbnail: '', active: 0 },
];

describe('ChannelList', () => {
  it('renders one row per channel with its title', () => {
    render(<ChannelList channels={channels} onToggle={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an empty state when there are no channels', () => {
    render(<ChannelList channels={[]} onToggle={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/no channels/i)).toBeInTheDocument();
  });

  it('toggles with the negated active state', () => {
    const onToggle = vi.fn();
    render(<ChannelList channels={channels} onToggle={onToggle} onRemove={() => {}} />);
    const alphaRow = screen.getByText('Alpha').closest('li');
    fireEvent.click(within(alphaRow).getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledWith('UC1', false);
  });

  it('removes by channel id', () => {
    const onRemove = vi.fn();
    render(<ChannelList channels={channels} onToggle={() => {}} onRemove={onRemove} />);
    const betaRow = screen.getByText('Beta').closest('li');
    fireEvent.click(within(betaRow).getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith('UC2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/components/ChannelList.test.jsx -t "renders one row per channel with its title"`
Expected: FAIL — `client/src/components/ChannelList.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**
```jsx
// client/src/components/ChannelList.jsx
import { Trash2, Power } from 'lucide-react';

export default function ChannelList({ channels, onToggle, onRemove }) {
  if (!channels || channels.length === 0) {
    return <p className="text-sm text-slate-500">No channels yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-200">
      {channels.map((c) => {
        const isActive = !!c.active;
        return (
          <li key={c.channel_id} className="flex items-center gap-3 py-2">
            {c.thumbnail ? (
              <img src={c.thumbnail} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-slate-300" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.title || c.channel_id}</p>
              {c.handle && <p className="truncate text-xs text-slate-500">{c.handle}</p>}
            </div>
            <button
              type="button"
              aria-label={`toggle ${c.channel_id}`}
              onClick={() => onToggle(c.channel_id, !isActive)}
              className={`rounded p-1.5 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}
            >
              <Power size={16} />
            </button>
            <button
              type="button"
              aria-label={`remove ${c.channel_id}`}
              onClick={() => onRemove(c.channel_id)}
              className="rounded p-1.5 text-rose-500 hover:text-rose-400"
            >
              <Trash2 size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/components/ChannelList.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/components/ChannelList.jsx client/src/components/ChannelList.test.jsx
git commit -m "feat(client): add ChannelList with toggle and remove actions"
```

---

### Task 8: `VideoFeed` component (with live download status)

**Files:**
- Create: `client/src/components/VideoFeed.jsx`
- Test: `client/src/components/VideoFeed.test.jsx`

**Interfaces:**
- Consumes: video rows (`video_id`, `title`, `channel_id`, `published_at`, `status`, `download_path`); `progress` map from `useSocket`; `thumbUrl`/`relativeTime` from `lib/format`; `lucide-react`.
- Produces: `<VideoFeed videos={[]} progress={{}} />`. Renders thumbnail (from `thumbUrl(video_id)`), title, relative published time, and a status label; when a videoId is present in `progress`, shows a `<progress>` bar with that percent.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/components/VideoFeed.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import VideoFeed from './VideoFeed.jsx';

const videos = [
  { video_id: 'vid1', title: 'First', channel_id: 'UC1', published_at: Date.now() - 60000, status: 'done', download_path: 'C:/x.mp4' },
  { video_id: 'vid2', title: 'Second', channel_id: 'UC1', published_at: Date.now() - 3600000, status: 'downloading', download_path: null },
];

describe('VideoFeed', () => {
  it('renders a card per video with title and yt thumbnail', () => {
    render(<VideoFeed videos={videos} progress={{}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    const img = screen.getAllByRole('img')[0];
    expect(img).toHaveAttribute('src', 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
  });

  it('shows the per-video status label', () => {
    render(<VideoFeed videos={videos} progress={{}} />);
    expect(screen.getByText(/done/i)).toBeInTheDocument();
    expect(screen.getByText(/downloading/i)).toBeInTheDocument();
  });

  it('renders a progress bar with the live percent for downloading videos', () => {
    render(<VideoFeed videos={videos} progress={{ vid2: 73 }} />);
    const card = screen.getByText('Second').closest('article');
    const bar = within(card).getByRole('progressbar');
    expect(bar.value).toBe(73);
    expect(bar.max).toBe(100);
  });

  it('shows an empty state with no videos', () => {
    render(<VideoFeed videos={[]} progress={{}} />);
    expect(screen.getByText(/no videos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/components/VideoFeed.test.jsx -t "renders a card per video with title and yt thumbnail"`
Expected: FAIL — `client/src/components/VideoFeed.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**
```jsx
// client/src/components/VideoFeed.jsx
import { thumbUrl, relativeTime } from '../lib/format.js';

export default function VideoFeed({ videos, progress }) {
  if (!videos || videos.length === 0) {
    return <p className="text-sm text-slate-500">No videos yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {videos.map((v) => {
        const pct = progress?.[v.video_id];
        const hasProgress = typeof pct === 'number';
        return (
          <article key={v.video_id} className="flex gap-3 rounded-lg border border-slate-200 p-2">
            <img
              src={thumbUrl(v.video_id)}
              alt=""
              className="h-20 w-36 flex-none rounded object-cover bg-slate-200"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{v.title}</p>
              <p className="text-xs text-slate-500">{relativeTime(v.published_at)}</p>
              <p className="mt-1 text-xs font-semibold uppercase text-slate-600">{v.status}</p>
              {hasProgress && (
                <progress
                  className="mt-1 h-2 w-full"
                  max="100"
                  value={pct}
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/components/VideoFeed.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/components/VideoFeed.jsx client/src/components/VideoFeed.test.jsx
git commit -m "feat(client): add VideoFeed with live download progress"
```

---

### Task 9: `Settings` component

**Files:**
- Create: `client/src/components/Settings.jsx`
- Test: `client/src/components/Settings.test.jsx`

**Interfaces:**
- Consumes: settings object (`{webhook_port, mgmt_port, download_dir, max_concurrency, lease_seconds}`) from `GET /api/settings`; `lucide-react`.
- Produces: `<Settings settings={{}} onSave={(patch)=>Promise} />`. Editable fields for `download_dir` and `max_concurrency`; Save calls `onSave` with only the edited values; disables Save while saving.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/components/Settings.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from './Settings.jsx';

const settings = {
  webhook_port: '8787',
  mgmt_port: '5174',
  download_dir: 'downloads',
  max_concurrency: '2',
  lease_seconds: '432000',
};

describe('Settings', () => {
  it('renders editable download_dir and max_concurrency fields', () => {
    render(<Settings settings={settings} onSave={() => {}} />);
    expect(screen.getByLabelText(/download dir/i)).toHaveValue('downloads');
    expect(screen.getByLabelText(/concurrency/i)).toHaveValue('2');
  });

  it('saves the edited values', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<Settings settings={settings} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/download dir/i), { target: { value: 'D:/yt' } });
    fireEvent.change(screen.getByLabelText(/concurrency/i), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ download_dir: 'D:/yt', max_concurrency: '4' })
    );
  });

  it('disables Save while saving', async () => {
    let resolve;
    const onSave = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<Settings settings={settings} onSave={onSave} />);
    const btn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    resolve({});
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/components/Settings.test.jsx -t "renders editable download_dir and max_concurrency fields"`
Expected: FAIL — `client/src/components/Settings.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**
```jsx
// client/src/components/Settings.jsx
import { useState } from 'react';
import { Save } from 'lucide-react';

export default function Settings({ settings, onSave }) {
  const [downloadDir, setDownloadDir] = useState(settings?.download_dir ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(settings?.max_concurrency ?? '');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ download_dir: downloadDir, max_concurrency: maxConcurrency });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span>Download dir</span>
        <input
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Max concurrency</span>
        <input
          value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="flex w-fit items-center gap-1 rounded bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
      >
        <Save size={16} /> Save
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/components/Settings.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add client/src/components/Settings.jsx client/src/components/Settings.test.jsx
git commit -m "feat(client): add Settings form for download dir and concurrency"
```

---

### Task 10: `App.jsx` dashboard wiring + production build gate

**Files:**
- Create: `client/src/App.jsx`
- Test: `client/src/App.test.jsx`

**Interfaces:**
- Consumes: `useSocket()` (`socket.js`); all `api.js` functions; `StatusBar`, `AddChannel`, `ChannelList`, `VideoFeed`, `Settings`.
- Produces: `<App />` — loads channels/videos/settings on mount via the API, merges live `useSocket` videos ahead of fetched ones, wires StatusBar to `startTunnel`/`stopTunnel`, AddChannel to `addChannel` + refetch, ChannelList to `toggleChannel`/`deleteChannel` + refetch. End-of-phase deliverable: dashboard renders status, channel add/list, and a socket-driven live feed, and produces a `client/dist/` static build served by `createMgmtApp`.

- [ ] **Step 1: Write the failing test**
```jsx
// client/src/App.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- mock the socket so we can drive live events ---
vi.mock('./socket.js', () => ({
  useSocket: () => ({
    connected: true,
    tunnel: { status: 'offline', url: null },
    videos: globalThis.__liveVideos || [],
    progress: {},
    logs: [],
  }),
}));

// --- mock the api module ---
vi.mock('./api.js', () => ({
  getStatus: vi.fn().mockResolvedValue({ tunnel: { status: 'offline', url: null }, counts: {} }),
  listChannels: vi.fn().mockResolvedValue([{ channel_id: 'UC1', title: 'Alpha', handle: '@alpha', active: 1 }]),
  listVideos: vi.fn().mockResolvedValue([{ video_id: 'vidA', title: 'Fetched', channel_id: 'UC1', published_at: 0, status: 'done' }]),
  getSettings: vi.fn().mockResolvedValue({ download_dir: 'downloads', max_concurrency: '2' }),
  patchSettings: vi.fn().mockResolvedValue({ download_dir: 'downloads', max_concurrency: '2' }),
  addChannel: vi.fn().mockResolvedValue({ channel_id: 'UC2' }),
  deleteChannel: vi.fn().mockResolvedValue(true),
  toggleChannel: vi.fn().mockResolvedValue({}),
  startTunnel: vi.fn().mockResolvedValue(true),
  stopTunnel: vi.fn().mockResolvedValue(true),
}));

import App from './App.jsx';
import * as api from './api.js';

beforeEach(() => {
  globalThis.__liveVideos = [];
  vi.clearAllMocks();
});

describe('App dashboard', () => {
  it('loads and renders channels, videos and settings on mount', async () => {
    render(<App />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Fetched')).toBeInTheDocument();
    expect(api.listChannels).toHaveBeenCalled();
    expect(api.listVideos).toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalled();
  });

  it('adds a channel and refetches the channel list', async () => {
    render(<App />);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByPlaceholderText(/@handle/i), { target: { value: '@new' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(api.addChannel).toHaveBeenCalledWith('@new'));
    await waitFor(() => expect(api.listChannels).toHaveBeenCalledTimes(2));
  });

  it('starts the tunnel from the StatusBar', async () => {
    render(<App />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(api.startTunnel).toHaveBeenCalledTimes(1);
  });

  it('shows live socket videos merged ahead of fetched ones', async () => {
    globalThis.__liveVideos = [{ video_id: 'live1', title: 'LiveOne', channel_id: 'UC1', published_at: 0, status: 'new' }];
    render(<App />);
    expect(await screen.findByText('LiveOne')).toBeInTheDocument();
    expect(await screen.findByText('Fetched')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd client && npx vitest run src/App.test.jsx -t "loads and renders channels, videos and settings on mount"`
Expected: FAIL — `client/src/App.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**
```jsx
// client/src/App.jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from './socket.js';
import * as api from './api.js';
import StatusBar from './components/StatusBar.jsx';
import AddChannel from './components/AddChannel.jsx';
import ChannelList from './components/ChannelList.jsx';
import VideoFeed from './components/VideoFeed.jsx';
import Settings from './components/Settings.jsx';

export default function App() {
  const { tunnel, videos: liveVideos, progress } = useSocket();
  const [channels, setChannels] = useState([]);
  const [fetchedVideos, setFetchedVideos] = useState([]);
  const [settings, setSettings] = useState(null);

  const refreshChannels = useCallback(async () => {
    setChannels(await api.listChannels());
  }, []);

  const refreshVideos = useCallback(async () => {
    setFetchedVideos(await api.listVideos(50));
  }, []);

  useEffect(() => {
    refreshChannels();
    refreshVideos();
    api.getSettings().then(setSettings);
  }, [refreshChannels, refreshVideos]);

  const mergedVideos = useMemo(() => {
    const seen = new Set(liveVideos.map((v) => v.video_id));
    return [...liveVideos, ...fetchedVideos.filter((v) => !seen.has(v.video_id))];
  }, [liveVideos, fetchedVideos]);

  const handleAdd = useCallback(async (input) => {
    await api.addChannel(input);
    await refreshChannels();
  }, [refreshChannels]);

  const handleToggle = useCallback(async (id, active) => {
    await api.toggleChannel(id, active);
    await refreshChannels();
  }, [refreshChannels]);

  const handleRemove = useCallback(async (id) => {
    await api.deleteChannel(id);
    await refreshChannels();
  }, [refreshChannels]);

  const handleSaveSettings = useCallback(async (patch) => {
    setSettings(await api.patchSettings(patch));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-xl font-bold">YT-Notify Local Hub</h1>

      <StatusBar tunnel={tunnel} onStart={api.startTunnel} onStop={api.stopTunnel} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Channels</h2>
        <AddChannel onAdd={handleAdd} />
        <ChannelList channels={channels} onToggle={handleToggle} onRemove={handleRemove} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Feed</h2>
        <VideoFeed videos={mergedVideos} progress={progress} />
      </section>

      {settings && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Settings</h2>
          <Settings settings={settings} onSave={handleSaveSettings} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd client && npx vitest run src/App.test.jsx && npm run build`
Expected: PASS — `App.test.jsx` green, and the production build succeeds producing `client/dist/index.html` (the static bundle served by `createMgmtApp`).

- [ ] **Step 5: Commit**
```bash
git add client/src/App.jsx client/src/App.test.jsx
git commit -m "feat(client): wire dashboard App with live socket-driven feed"
```

---

## Phase 5: Resilience, Wiring & Hardening

### Task 1: (No new work) catch-up primitives already exist from Phase 2

> `server/src/scheduler/catchup.js` — exporting both `findMissedVideos(rssEntries, lastPublishedAt)` (PURE) and `fetchChannelRss(channelId, fetchFn=fetch)` — was **fully implemented and tested in Phase 2 Tasks 11–12** (test: `server/test/scheduler/catchup.fetch.test.js`). Do NOT recreate the file or its tests here. This task is intentionally a no-op; proceed directly to Task 2 (`runCatchup`), which consumes those two functions.

---

### Task 2: Catch-up orchestrator (`runCatchup`)

**Files:**
- Create: `server/src/scheduler/runCatchup.js`
- Test: `server/test/scheduler/runCatchup.test.js`

**Interfaces:**
- Consumes: `listActiveChannels(db)`, `getChannel(db, channelId)`, `setChannelActive(db, channelId, active)`, `upsertVideoIfNew(db, {...})`, `updateLastVideoPublishedAt(db, channelId, publishedAt)`, `getVideo(db, videoId)` from `server/src/db/index.js`; `fetchChannelRss(channelId, fetchFn)` and `findMissedVideos(rssEntries, lastPublishedAt)` from `server/src/scheduler/catchup.js` (Phase 2 Tasks 11–12)
- Produces: `export async function runCatchup({ db, onNewVideo, fetchFn=fetch })` -> `Promise<{enqueued:number}>` — for each active channel, fetch RSS, enqueue missed videos (newer than the channel's stored last-published marker) via `upsertVideoIfNew`, call `onNewVideo(row)` for new rows, advance the marker via `updateLastVideoPublishedAt`. Channel row fields are read from `getChannel`'s returned row (snake_case schema: `channel_id`, `last_video_published_at`).

> Schema dependency: this task relies on the earlier-phase `db/index.js` schema using snake_case column/row keys (`channel_id`, `last_video_published_at`), the same keys `getChannel(db, id)` returns and `updateLastVideoPublishedAt` writes. If the schema differs, update the field access here and in Tasks 3/10 to match `getChannel`'s actual row shape.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import {
  initDb,
  addChannel,
  getVideo,
  getChannel,
  setChannelActive,
  updateLastVideoPublishedAt,
} from '../../src/db/index.js';
import { runCatchup } from '../../src/scheduler/runCatchup.js';

function feedXml(entries) {
  const body = entries
    .map(
      (e) => `<entry>
        <yt:videoId>${e.videoId}</yt:videoId>
        <yt:channelId>${e.channelId}</yt:channelId>
        <title>${e.title}</title>
        <author><name>A</name></author>
        <published>${e.published}</published>
        <updated>${e.published}</updated>
      </entry>`
    )
    .join('');
  return `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

describe('runCatchup', () => {
  it('enqueues only videos newer than the marker and advances the marker', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_a', handle: '@a', title: 'A', thumbnail: '', secret: 's' });
    // marker = 2026-03-01 (set via the contract function, not raw SQL)
    updateLastVideoPublishedAt(db, 'UC_a', Date.parse('2026-03-01T00:00:00Z'));

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        feedXml([
          { videoId: 'OLD1', channelId: 'UC_a', title: 'old', published: '2026-01-01T00:00:00+00:00' },
          { videoId: 'NEW1', channelId: 'UC_a', title: 'new', published: '2026-06-01T00:00:00+00:00' },
        ]),
    });

    const onNewVideo = vi.fn();
    const result = await runCatchup({ db, onNewVideo, fetchFn });

    expect(result.enqueued).toBe(1);
    expect(getVideo(db, 'NEW1')).toBeTruthy();
    expect(getVideo(db, 'OLD1')).toBeUndefined();
    expect(onNewVideo).toHaveBeenCalledTimes(1);

    // marker advanced to the newest published, read back via the contract getter
    const ch = getChannel(db, 'UC_a');
    expect(ch.last_video_published_at).toBe(Date.parse('2026-06-01T00:00:00Z'));
  });

  it('skips inactive channels and tolerates fetch failures', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_b', handle: '@b', title: 'B', thumbnail: '', secret: 's' });
    setChannelActive(db, 'UC_b', false);

    const fetchFn = vi.fn();
    const result = await runCatchup({ db, onNewVideo: vi.fn(), fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(0);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scheduler/runCatchup.test.js -t "enqueues only videos newer"`
Expected: FAIL — cannot import `runCatchup` (module `runCatchup.js` does not exist).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/scheduler/runCatchup.js
import {
  listActiveChannels,
  upsertVideoIfNew,
  updateLastVideoPublishedAt,
} from '../db/index.js';
import { fetchChannelRss, findMissedVideos } from './catchup.js';

function toMs(v) {
  return typeof v === 'number' ? v : Date.parse(v);
}

export async function runCatchup({ db, onNewVideo, fetchFn = fetch }) {
  const channels = listActiveChannels(db);
  let enqueued = 0;

  for (const ch of channels) {
    const marker = ch.last_video_published_at || 0;
    const entries = await fetchChannelRss(ch.channel_id, fetchFn);
    if (!entries.length) continue;

    const missed = findMissedVideos(entries, marker);
    let maxPub = marker;

    for (const e of missed) {
      const publishedAt = toMs(e.published);
      const updatedAt = toMs(e.updated) || publishedAt;
      const { row, isNew } = upsertVideoIfNew(db, {
        videoId: e.videoId,
        channelId: ch.channel_id,
        title: e.title,
        publishedAt,
        updatedAt,
        thumbnailUrl: null, // parseAtom entries carry no thumbnail per the contract
      });
      if (isNew) {
        enqueued += 1;
        if (typeof onNewVideo === 'function') onNewVideo(row);
      }
      if (Number.isFinite(publishedAt) && publishedAt > maxPub) maxPub = publishedAt;
    }

    if (maxPub > marker) {
      updateLastVideoPublishedAt(db, ch.channel_id, maxPub);
    }
  }

  return { enqueued };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scheduler/runCatchup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/scheduler/runCatchup.js server/test/scheduler/runCatchup.test.js
git commit -m "feat(catchup): enqueue missed videos per active channel on reconnect"
```

---

### Task 3: Lease renewal runner (`runLeaseRenewal`)

**Files:**
- Create: `server/src/scheduler/runLease.js`
- Test: `server/test/scheduler/runLease.test.js`

**Interfaces:**
- Consumes: `listActiveChannels(db)`, `updateChannelSubscription(db, channelId, {subscribedAt, leaseExpiresAt})` from `server/src/db/index.js`; `findExpiringChannels(channels, now, thresholdMs)` from `server/src/scheduler/lease.js`; `sendSubscription({hubUrl, callbackUrl, channelId, mode, secret, leaseSeconds, fetchFn})` from `server/src/websub/client.js`
- Produces: `export async function runLeaseRenewal({ db, callbackUrl, hubUrl, leaseSeconds, now=Date.now(), thresholdMs=43200000, sendFn=sendSubscription })` -> `Promise<{renewed:number}>` — resubscribe (mode `'subscribe'`) every active channel whose lease expires within 12h. `findExpiringChannels` reads the same `lease_expires_at` row field that `updateChannelSubscription({leaseExpiresAt})` writes.

> Schema dependency: relies on the snake_case row fields `channel_id`, `secret`, and `lease_expires_at` exposed by `listActiveChannels`/`findExpiringChannels`. The lease marker is set in the test via `updateChannelSubscription` (a contract function), not raw SQL.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import { initDb, addChannel, updateChannelSubscription } from '../../src/db/index.js';
import { runLeaseRenewal } from '../../src/scheduler/runLease.js';

describe('runLeaseRenewal', () => {
  it('renews only channels whose lease expires within the threshold', async () => {
    const db = initDb(':memory:');
    const now = 1_000_000_000_000;

    addChannel(db, { channelId: 'UC_soon', handle: '@s', title: 'S', thumbnail: '', secret: 'sec1' });
    addChannel(db, { channelId: 'UC_later', handle: '@l', title: 'L', thumbnail: '', secret: 'sec2' });
    // expires in 6h -> within 12h threshold (set via contract function)
    updateChannelSubscription(db, 'UC_soon', {
      subscribedAt: now,
      leaseExpiresAt: now + 6 * 3600 * 1000,
    });
    // expires in 48h -> outside threshold
    updateChannelSubscription(db, 'UC_later', {
      subscribedAt: now,
      leaseExpiresAt: now + 48 * 3600 * 1000,
    });

    const sendFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

    const result = await runLeaseRenewal({
      db,
      callbackUrl: 'https://x.trycloudflare.com/webhook/youtube',
      hubUrl: 'https://pubsubhubbub.appspot.com/subscribe',
      leaseSeconds: 432000,
      now,
      thresholdMs: 12 * 3600 * 1000,
      sendFn,
    });

    expect(result.renewed).toBe(1);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const arg = sendFn.mock.calls[0][0];
    expect(arg.channelId).toBe('UC_soon');
    expect(arg.mode).toBe('subscribe');
    expect(arg.secret).toBe('sec1');
    expect(arg.callbackUrl).toBe('https://x.trycloudflare.com/webhook/youtube');
    expect(arg.hubUrl).toBe('https://pubsubhubbub.appspot.com/subscribe');
    expect(arg.leaseSeconds).toBe(432000);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scheduler/runLease.test.js -t "renews only channels"`
Expected: FAIL — cannot import `runLeaseRenewal` (module does not exist).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/scheduler/runLease.js
import { listActiveChannels } from '../db/index.js';
import { findExpiringChannels } from './lease.js';
import { sendSubscription } from '../websub/client.js';

export async function runLeaseRenewal({
  db,
  callbackUrl,
  hubUrl,
  leaseSeconds,
  now = Date.now(),
  thresholdMs = 12 * 3600 * 1000,
  sendFn = sendSubscription,
}) {
  if (!callbackUrl) return { renewed: 0 };
  const expiring = findExpiringChannels(listActiveChannels(db), now, thresholdMs);
  let renewed = 0;
  for (const ch of expiring) {
    await sendFn({
      hubUrl,
      callbackUrl,
      channelId: ch.channel_id,
      mode: 'subscribe',
      secret: ch.secret,
      leaseSeconds,
      fetchFn: fetch,
    });
    renewed += 1;
  }
  return { renewed };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scheduler/runLease.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/scheduler/runLease.js server/test/scheduler/runLease.test.js
git commit -m "feat(scheduler): renew leases for channels expiring within 12h"
```

---

### Task 4: Deleted-entry handling end-to-end (webhook POST -> status skipped)

**Files:**
- Create: `server/src/websub/onDeleted.js`
- Test: `server/test/websub/deleted.e2e.test.js`

**Interfaces:**
- Consumes: `createWebhookApp({db, secretFor, onNewVideo, onDeleted})` from `server/src/webhookApp.js`; `verifyHmac` (used internally by routes); `updateVideoStatus(db, videoId, status, {})`, `getVideo(db, videoId)`, `upsertVideoIfNew` from `server/src/db/index.js`; `node:crypto` for signing in the test
- Produces: `export function handleDeleted(db)` -> returns an `onDeleted` callback `(videoId) => void` that marks the video `status='skipped'` (no download). Wires `at:deleted-entry` -> DB skip.

> HMAC/channelId note: the POST handler in `routes.js` (built in the webhook phase) reads the `X-Hub-Signature` header (`sha1=<hex>`) and verifies it via `secretFor(channelId)`. For tombstone feeds the channelId comes from `parseAtom`'s `deleted:[{videoId, channelId}]`, so the sample tombstone below **includes a `<yt:channelId>` element** to guarantee `parseAtom` yields a resolvable `channelId`. The test's `secretFor` returns a constant `SECRET` regardless of channelId, so verification succeeds even if the channelId resolution differs; the explicit `yt:channelId` ensures `routes.js` never calls `secretFor(undefined)` on this payload.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { initDb, addChannel, upsertVideoIfNew, getVideo } from '../../src/db/index.js';
import { createWebhookApp } from '../../src/webhookApp.js';
import { handleDeleted } from '../../src/websub/onDeleted.js';

const SECRET = 'topsecret';

// Tombstone WITH a resolvable channelId so routes.js can call secretFor(channelId).
const DELETED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:DEL123" when="2026-06-01T00:00:00+00:00">
    <yt:videoId>DEL123</yt:videoId>
    <yt:channelId>UC_del</yt:channelId>
    <link href="https://www.youtube.com/watch?v=DEL123"/>
    <at:by><name>Test Author</name></at:by>
  </at:deleted-entry>
</feed>`;

function sign(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}

describe('deleted-entry e2e', () => {
  it('marks an existing video as skipped and does not call onNewVideo', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: 'UC_del', handle: '@d', title: 'D', thumbnail: '', secret: SECRET });
    upsertVideoIfNew(db, {
      videoId: 'DEL123',
      channelId: 'UC_del',
      title: 'doomed',
      publishedAt: Date.now(),
      updatedAt: Date.now(),
      thumbnailUrl: null,
    });

    const onNewVideo = vi.fn();
    const app = createWebhookApp({
      db,
      secretFor: () => SECRET, // constant secret, independent of channelId
      onNewVideo,
      onDeleted: handleDeleted(db),
    });

    const body = Buffer.from(DELETED_XML, 'utf8');
    const res = await request(app)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', sign(body, SECRET))
      .send(body);

    expect(res.status).toBe(204);
    // onDeleted runs async after response; allow microtask/timer flush
    await new Promise((r) => setTimeout(r, 10));
    expect(getVideo(db, 'DEL123').status).toBe('skipped');
    expect(onNewVideo).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/websub/deleted.e2e.test.js -t "marks an existing video as skipped"`
Expected: FAIL — cannot import `handleDeleted` from `onDeleted.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/websub/onDeleted.js
import { getVideo, updateVideoStatus } from '../db/index.js';

// Returns an onDeleted(videoId) callback that marks the video skipped (no download).
export function handleDeleted(db) {
  return (videoId) => {
    if (!videoId) return;
    if (!getVideo(db, videoId)) return; // nothing to skip for unknown ids
    updateVideoStatus(db, videoId, 'skipped', {});
  };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/websub/deleted.e2e.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/websub/onDeleted.js server/test/websub/deleted.e2e.test.js
git commit -m "feat(websub): mark deleted-entry videos as skipped end-to-end"
```

---

### Task 5: Windows child-tree kill helper (`killTree`)

**Files:**
- Create: `server/src/util/killTree.js`
- Test: `server/test/util/killTree.test.js`

**Interfaces:**
- Consumes: `node:child_process` `spawn` (injectable; **win32-only** — the non-win32 path uses `process.kill(-pid)` and never touches `spawnFn`)
- Produces: `export function killTree(pid, { platform=process.platform, spawnFn=spawn }={})` -> on Windows runs `taskkill /PID <pid> /T /F`; elsewhere `process.kill(-pid)` (process-group) fallback. Used by graceful shutdown in `index.js`.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import { killTree } from '../../src/util/killTree.js';

describe('killTree', () => {
  it('spawns taskkill with /PID /T /F on win32', () => {
    const spawnFn = vi.fn().mockReturnValue({ on() {}, unref() {} });
    killTree(4242, { platform: 'win32', spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith('taskkill', ['/PID', '4242', '/T', '/F'], expect.any(Object));
  });

  it('does nothing for a falsy pid', () => {
    const spawnFn = vi.fn();
    killTree(undefined, { platform: 'win32', spawnFn });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('uses process group kill on non-win32 (spawnFn unused)', () => {
    const spawnFn = vi.fn();
    const killer = vi.fn();
    const orig = process.kill;
    process.kill = killer;
    try {
      killTree(99, { platform: 'linux', spawnFn });
    } finally {
      process.kill = orig;
    }
    expect(spawnFn).not.toHaveBeenCalled();
    expect(killer).toHaveBeenCalledWith(-99);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/util/killTree.test.js -t "spawns taskkill"`
Expected: FAIL — cannot import `killTree` (module does not exist).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/util/killTree.js
import { spawn } from 'node:child_process';

export function killTree(pid, { platform = process.platform, spawnFn = spawn } = {}) {
  if (!pid) return;
  if (platform === 'win32') {
    spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  // Non-win32: kill the process group directly; spawnFn is unused on this path.
  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {
      /* already dead */
    }
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/util/killTree.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/util/killTree.js server/test/util/killTree.test.js
git commit -m "feat(util): cross-platform child-tree kill (taskkill on windows)"
```

---

### Task 6: Bootstrap composition root (`buildApp`)

**Files:**
- Create: `server/src/bootstrap.js`
- Test: `server/test/bootstrap.test.js`

**Interfaces:**
- Consumes: `getChannel`, `loadConfig` from db/config; `DownloadQueue` (`server/src/downloader/queue.js`), `TunnelManager` (`server/src/tunnel/manager.js`), `createWebhookApp` (`server/src/webhookApp.js`), `createMgmtApp` (`server/src/mgmtApp.js`), `resubscribeAll` (`server/src/websub/client.js`), `resolveChannelId` (`server/src/downloader/resolver.js`), `sendSubscription` (`server/src/websub/client.js`), `handleDeleted` (Task 4)
- Produces: `export function buildApp({ db, config, spawnFn=spawn, fetchFn=fetch, resubscribeFn=resubscribeAll, resolveFn=resolveChannelId, sendSubscriptionFn=sendSubscription })` -> `{ db, config, queue, tunnel, webhookApp, mgmtApp, secretFor, onNewVideo, onDeleted, wireTunnelResubscribe() }`. Pure composition (no `listen()`, no `tunnel.start()` / `queue.enqueue` at construction — `TunnelManager`/`DownloadQueue` constructors are side-effect-free per their contracts), so it is testable with supertest. The mgmt app receives **real** `resolveChannelId` and `sendSubscription` (not `undefined`) plus the `hubUrl`/`leaseSeconds` it needs to resolve+add+subscribe. `wireTunnelResubscribe()` attaches a `tunnel.on('url', ...)` handler that calls `resubscribeFn({db, callbackUrl:url+'/webhook/youtube', hubUrl, leaseSeconds})`.

- [ ] **Step 1: Write the failing test**
```js
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
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/bootstrap.test.js -t "builds queue, tunnel and both express apps"`
Expected: FAIL — cannot import `buildApp` (module does not exist).

- [ ] **Step 3: Write minimal implementation**
```js
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
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/bootstrap.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/bootstrap.js server/test/bootstrap.test.js
git commit -m "feat(bootstrap): composition root wiring db/queue/tunnel/two apps with real mgmt deps"
```

---

### Task 7: Realtime wiring smoke (`wireRealtime` over bootstrap emitters)

**Files:**
- Create/replace: `server/src/realtime/bus.js` (this task owns the final `wireRealtime` implementation; if an earlier-phase stub exists it is fully replaced here)
- Test: `server/test/realtime/bus.wiring.test.js`

**Interfaces:**
- Consumes: `wireRealtime(io, emitters)` from `server/src/realtime/bus.js`; `buildApp(...)` (Task 6) for real `queue` and `tunnel` EventEmitters
- Produces: Confirmed contract — `tunnel` `'status'(status)` -> `io.emit('tunnel:status', {status, url:tunnel.getUrl()})` using the **emitted status argument**; `tunnel` `'url'(url)` -> `io.emit('tunnel:status', {status:tunnel.getStatus(), url})`; queue `'start'` -> `'download:start'`; `'progress'` -> `'download:progress'`; `'done'` -> `'download:done'`; `'failed'` -> `'download:failed'`; `tunnel` `'log'(line)` -> `'log'({line})`.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb } from '../../src/db/index.js';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/bootstrap.js';
import { wireRealtime } from '../../src/realtime/bus.js';

function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 1;
  return ee;
}

function fakeIo() {
  const emit = vi.fn();
  return { emit };
}

describe('wireRealtime forwards bootstrap emitters', () => {
  it('forwards queue and tunnel events to socket.io with contract payloads', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });
    const io = fakeIo();

    wireRealtime(io, { tunnel: app.tunnel, queue: app.queue });

    app.queue.emit('start', { videoId: 'V1' });
    app.queue.emit('progress', { videoId: 'V1', percent: 42 });
    app.queue.emit('done', { videoId: 'V1', path: 'C:\\dl\\V1.mp4' });
    app.queue.emit('failed', { videoId: 'V2', error: 'boom' });
    // a freshly-constructed (never started) tunnel reports getStatus()==='offline', getUrl()===null
    app.tunnel.emit('status', 'online');

    const names = io.emit.mock.calls.map((c) => c[0]);
    expect(names).toContain('download:start');
    expect(names).toContain('download:progress');
    expect(names).toContain('download:done');
    expect(names).toContain('download:failed');
    expect(names).toContain('tunnel:status');

    const progressCall = io.emit.mock.calls.find((c) => c[0] === 'download:progress');
    expect(progressCall[1]).toEqual({ videoId: 'V1', percent: 42 });

    // explicit tunnel:status payload assertion — uses the EMITTED status arg + getUrl()
    const statusCall = io.emit.mock.calls.find((c) => c[0] === 'tunnel:status');
    expect(statusCall[1]).toEqual({ status: 'online', url: null });
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/realtime/bus.wiring.test.js -t "forwards queue and tunnel events"`
Expected: FAIL — `wireRealtime` is not yet implemented here (module missing or stub forwards fewer events / a wrong `tunnel:status` payload), so the `toContain`/`toEqual` assertions fail (e.g. missing `download:progress`, or `tunnel:status` payload not `{status:'online', url:null}`).

- [ ] **Step 3: Write minimal implementation**
```js
// server/src/realtime/bus.js
// Forwards tunnel/queue events to socket.io with the contract event names.
export function wireRealtime(io, emitters = {}) {
  const { tunnel, queue } = emitters;

  if (tunnel) {
    // Use the emitted status argument (TunnelManager emits 'status'(status)).
    tunnel.on('status', (status) => {
      const url = typeof tunnel.getUrl === 'function' ? tunnel.getUrl() : null;
      io.emit('tunnel:status', { status, url });
    });
    tunnel.on('url', (url) => {
      const status = typeof tunnel.getStatus === 'function' ? tunnel.getStatus() : undefined;
      io.emit('tunnel:status', { status, url });
    });
    tunnel.on('log', (line) => io.emit('log', { line }));
  }

  if (queue) {
    queue.on('start', ({ videoId }) => io.emit('download:start', { videoId }));
    queue.on('progress', ({ videoId, percent }) =>
      io.emit('download:progress', { videoId, percent })
    );
    queue.on('done', ({ videoId, path }) => io.emit('download:done', { videoId, path }));
    queue.on('failed', ({ videoId, error }) => io.emit('download:failed', { videoId, error }));
  }
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/realtime/bus.wiring.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/realtime/bus.js server/test/realtime/bus.wiring.test.js
git commit -m "feat(realtime): forward queue/tunnel events with contract socket.io payloads"
```

---

### Task 8: Mock-webhook harness script (`scripts/mock-webhook.js`)

**Files:**
- Create: `scripts/mock-webhook.js`
- Create: `scripts/lib/sampleAtom.js` (exported sample-builder + signer so the script is unit-testable)
- Test: `server/test/scripts/mock-webhook.test.js`

**Interfaces:**
- Consumes: `node:crypto` HMAC-SHA1; signature shape `sha1=<hex>` (matches `verifyHmac`)
- Produces: `scripts/lib/sampleAtom.js` exporting `export function buildSampleAtom({channelId, videoId, title, published})` -> Atom xml string and `export function signBody(body, secret)` -> `'sha1=<hex>'`. The CLI `scripts/mock-webhook.js` reads `--url --channel --video --secret` and POSTs the signed payload via global `fetch` (so a running app processes it through the real pipeline).

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildSampleAtom, signBody } from '../../../scripts/lib/sampleAtom.js';
import { parseAtom } from '../../src/websub/atom.js';
import { verifyHmac } from '../../src/websub/hmac.js';

describe('mock-webhook sample payload', () => {
  it('builds Atom xml that parseAtom can read', () => {
    const xml = buildSampleAtom({
      channelId: 'UC_mock',
      videoId: 'MOCKVID',
      title: 'Mock Title',
      published: '2026-06-28T12:00:00+00:00',
    });
    const parsed = parseAtom(xml);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].videoId).toBe('MOCKVID');
    expect(parsed.entries[0].channelId).toBe('UC_mock');
    expect(parsed.entries[0].title).toBe('Mock Title');
  });

  it('signs the body so verifyHmac accepts it', () => {
    const xml = buildSampleAtom({ channelId: 'UC_mock', videoId: 'MOCKVID', title: 'T' });
    const sig = signBody(xml, 'mysecret');
    expect(sig.startsWith('sha1=')).toBe(true);
    expect(verifyHmac(xml, sig, 'mysecret')).toBe(true);
    expect(verifyHmac(xml, sig, 'wrongsecret')).toBe(false);
  });

  it('produces a signature equal to a manual HMAC-SHA1', () => {
    const body = 'hello';
    const expected = 'sha1=' + crypto.createHmac('sha1', 's').update(body).digest('hex');
    expect(signBody(body, 's')).toBe(expected);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/scripts/mock-webhook.test.js -t "builds Atom xml that parseAtom can read"`
Expected: FAIL — cannot import from `scripts/lib/sampleAtom.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**
```js
// scripts/lib/sampleAtom.js
import crypto from 'node:crypto';

export function buildSampleAtom({
  channelId,
  videoId,
  title = 'Sample Video',
  published = new Date().toISOString(),
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}"/>
    <author><name>Mock Author</name><uri>https://www.youtube.com/channel/${channelId}</uri></author>
    <published>${published}</published>
    <updated>${published}</updated>
  </entry>
</feed>`;
}

export function signBody(body, secret) {
  return 'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
}
```
```js
// scripts/mock-webhook.js
import { buildSampleAtom, signBody } from './lib/sampleAtom.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || 'http://localhost:8787/webhook/youtube';
  const channelId = args.channel || 'UC_mock_channel';
  const videoId = args.video || `MOCK_${Date.now()}`;
  const secret = args.secret;
  if (!secret) {
    console.error('Missing --secret (must match the channel secret in the DB)');
    process.exit(1);
  }

  const xml = buildSampleAtom({ channelId, videoId, title: args.title || 'Mock Notification' });
  const signature = signBody(xml, secret);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/atom+xml', 'X-Hub-Signature': signature },
    body: xml,
  });
  console.log(`POST ${url} -> ${res.status} (videoId=${videoId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/scripts/mock-webhook.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add scripts/mock-webhook.js scripts/lib/sampleAtom.js server/test/scripts/mock-webhook.test.js
git commit -m "feat(scripts): mock-webhook harness that signs and posts sample atom"
```

---

### Task 9: End-to-end pipeline check (webhook -> db -> queue with mocks)

> Non-fail-first note: this is an **integration/verification task** that exercises modules already built and committed in Tasks 4, 6, and 8. By the time it runs those exports exist, so the new test is expected to pass on first run — it does **not** drive a new red-then-green implementation and has **no Step 3 source file**. It is included to lock in the cross-module pipeline behavior. (See Task 12 for the full-suite gate.)

**Files:**
- Test: `server/test/e2e/pipeline.e2e.test.js`

**Interfaces:**
- Consumes: `buildApp(...)` (Task 6) for shared `db`/`queue`/`webhookApp`; `buildSampleAtom`/`signBody` (Task 8); `addChannel`, `getVideo` (db); supertest against `app.webhookApp`. Mocks `spawnFn` so the queue never spawns real `yt-dlp`.
- Produces: Proof the full path runs — a signed POST creates a `videos` row and the `DownloadQueue` receives an `enqueue` (asserted via a **spy on `queue.enqueue`**, not on event timing) without touching the network or real binaries.

> HMAC-failure status: the rejection assertion uses the status code that the webhook phase's `routes.js` returns on an invalid HMAC. The contract pins only `204` on success; confirm the actual failure code from `routes.js` and assert that exact code below. The draft assumes `403`; change the two `WEBHOOK_BAD_HMAC_STATUS` references if `routes.js` returns a different code.

- [ ] **Step 1: Write the test (verification, expected green once Tasks 4/6/8 are in)**
```js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { initDb, addChannel, getVideo } from '../../src/db/index.js';
import { loadConfig } from '../../src/config.js';
import { buildApp } from '../../src/bootstrap.js';
import { buildSampleAtom, signBody } from '../../../scripts/lib/sampleAtom.js';

const SECRET = 'e2e-secret';
const CHANNEL = 'UC_e2e';
const VIDEO = 'E2EVID';

// Confirm this matches routes.js's invalid-HMAC status (assumed 403; adjust if different).
const WEBHOOK_BAD_HMAC_STATUS = 403;

// fake yt-dlp child: emits one progress line then exits 0
function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 777;
  setTimeout(() => {
    ee.stdout.emit('data', Buffer.from('[download]  100.0% of 1.00MiB\n'));
    ee.emit('close', 0);
  }, 0);
  return ee;
}

describe('e2e: webhook -> db -> queue', () => {
  it('drives a signed notification through the full pipeline', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: CHANNEL, handle: '@e2e', title: 'E2E', thumbnail: '', secret: SECRET });
    const config = loadConfig(db);

    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });

    // Assert enqueue via a spy rather than relying on async 'start' event timing.
    const enqueueSpy = vi.spyOn(app.queue, 'enqueue');

    const xml = buildSampleAtom({ channelId: CHANNEL, videoId: VIDEO, title: 'E2E Video' });
    const res = await request(app.webhookApp)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', signBody(xml, SECRET))
      .send(Buffer.from(xml, 'utf8'));

    expect(res.status).toBe(204);

    // onNewVideo runs async after the 204; flush timers/microtasks.
    await new Promise((r) => setTimeout(r, 20));

    // video persisted by the webhook handler
    const row = getVideo(db, VIDEO);
    expect(row).toBeTruthy();
    expect(row.channel_id).toBe(CHANNEL);
    expect(row.title).toBe('E2E Video');

    // queue picked it up via onNewVideo -> enqueue
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0].video_id).toBe(VIDEO);
  });

  it('rejects an unsigned notification and stores nothing', async () => {
    const db = initDb(':memory:');
    addChannel(db, { channelId: CHANNEL, handle: '@e2e', title: 'E2E', thumbnail: '', secret: SECRET });
    const config = loadConfig(db);
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn() });

    const xml = buildSampleAtom({ channelId: CHANNEL, videoId: 'BADVID', title: 'x' });
    const res = await request(app.webhookApp)
      .post('/webhook/youtube')
      .set('Content-Type', 'application/atom+xml')
      .set('X-Hub-Signature', signBody(xml, 'wrong-secret'))
      .send(Buffer.from(xml, 'utf8'));

    expect(res.status).toBe(WEBHOOK_BAD_HMAC_STATUS);
    expect(getVideo(db, 'BADVID')).toBeUndefined();
  });
});
```
- [ ] **Step 2: Run the verification test**
Run: `npx vitest run test/e2e/pipeline.e2e.test.js`
Expected: PASS — Tasks 4, 6 and 8 are already committed, so `buildApp`, the webhook pipeline, and `buildSampleAtom`/`signBody` all exist. The signed POST returns `204`, persists the row, and `onNewVideo` calls `queue.enqueue` (observed via the spy); the wrong-secret POST returns the invalid-HMAC status and stores nothing. (If this fails, the failure points at a real wiring gap in an earlier task — fix that task, do not weaken this test.)

- [ ] **Step 3: (no source file — verification only)**
This task adds no implementation. It depends entirely on Tasks 4/6/8; if it is red, the offending earlier task must be corrected.

- [ ] **Step 4: Confirm green**
Run: `npx vitest run test/e2e/pipeline.e2e.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/test/e2e/pipeline.e2e.test.js
git commit -m "test(e2e): signed webhook drives db + download queue end-to-end"
```

---

### Task 10: Reconnect catch-up wiring (`wireReconnectCatchup`)

**Files:**
- Modify: `server/src/bootstrap.js` (add `wireReconnectCatchup()` to the returned object)
- Test: `server/test/bootstrap.catchup.test.js`

**Interfaces:**
- Consumes: `runCatchup({db, onNewVideo, fetchFn})` (Task 2); `tunnel` `'status'` event from `TunnelManager`
- Produces: `wireReconnectCatchup()` on the `buildApp` result — when tunnel transitions to `'online'`, runs `runCatchup` so videos missed during downtime are enqueued. Debounced to one run per online transition.

- [ ] **Step 1: Write the failing test**
```js
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { initDb } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/bootstrap.js';

function fakeSpawn() {
  const ee = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.kill = vi.fn();
  ee.pid = 1;
  return ee;
}

describe('wireReconnectCatchup', () => {
  it('runs catch-up when the tunnel goes online', async () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const catchupFn = vi.fn().mockResolvedValue({ enqueued: 0 });
    const app = buildApp({
      db,
      config,
      spawnFn: () => fakeSpawn(),
      fetchFn: vi.fn(),
      catchupFn,
    });

    app.wireReconnectCatchup();
    app.tunnel.emit('status', 'connecting');
    expect(catchupFn).not.toHaveBeenCalled();

    app.tunnel.emit('status', 'online');
    expect(catchupFn).toHaveBeenCalledTimes(1);
    const arg = catchupFn.mock.calls[0][0];
    expect(arg.db).toBe(db);
    expect(typeof arg.onNewVideo).toBe('function');
  });

  it('does not double-run while already online', () => {
    const db = initDb(':memory:');
    const config = loadConfig(db);
    const catchupFn = vi.fn().mockResolvedValue({ enqueued: 0 });
    const app = buildApp({ db, config, spawnFn: () => fakeSpawn(), fetchFn: vi.fn(), catchupFn });

    app.wireReconnectCatchup();
    app.tunnel.emit('status', 'online');
    app.tunnel.emit('status', 'online');
    expect(catchupFn).toHaveBeenCalledTimes(1);

    // a drop then re-online triggers a fresh run
    app.tunnel.emit('status', 'offline');
    app.tunnel.emit('status', 'online');
    expect(catchupFn).toHaveBeenCalledTimes(2);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/bootstrap.catchup.test.js -t "runs catch-up when the tunnel goes online"`
Expected: FAIL — `app.wireReconnectCatchup` is not a function (and `buildApp` ignores `catchupFn`).

- [ ] **Step 3: Write minimal implementation**
Add the import near the top of `server/src/bootstrap.js`:
```js
import { runCatchup } from './scheduler/runCatchup.js';
```
Add `catchupFn = runCatchup` to the destructured params of `buildApp`:
```js
export function buildApp({
  db,
  config,
  spawnFn = spawn,
  fetchFn = fetch,
  resubscribeFn = resubscribeAll,
  resolveFn = resolveChannelId,
  sendSubscriptionFn = sendSubscription,
  catchupFn = runCatchup,
}) {
```
Inside `buildApp`, after `wireTunnelResubscribe` is defined, add the reconnect handler:
```js
  let wasOnline = false;
  function wireReconnectCatchup() {
    tunnel.on('status', (status) => {
      if (status === 'online' && !wasOnline) {
        wasOnline = true;
        Promise.resolve(catchupFn({ db, onNewVideo, fetchFn })).catch(() => {});
      } else if (status !== 'online') {
        wasOnline = false;
      }
    });
  }
```
And add `wireReconnectCatchup` to the returned object, which becomes:
```js
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
    wireReconnectCatchup,
  };
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/bootstrap.catchup.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/bootstrap.js server/test/bootstrap.catchup.test.js
git commit -m "feat(bootstrap): run catch-up enqueue when tunnel reconnects online"
```

---

### Task 11: Entry point + npm scripts (`server/src/index.js`, `server/package.json`)

> Package location decision: this is the **server package**, so `package.json` lives at `server/package.json`. The test resolves the package root as `server/` (one level up from `server/test/`), so the `start` script value is `node src/index.js` (relative to `server/`), and the test's regex matches `node src/index.js`.

**Files:**
- Create: `server/src/index.js` (thin runtime: listens both apps, attaches socket.io, starts scheduler + tunnel, graceful shutdown). Guarded by `import.meta.url === pathToFileURL(process.argv[1]).href` so importing it in tests does not start listeners.
- Modify: `server/package.json` (add `scripts`: `dev`, `start`, `test`; ensure `"type":"module"`)
- Test: `server/test/index.scripts.test.js`

**Interfaces:**
- Consumes: `buildApp(...)` (Tasks 6/10), `initDb`, `loadConfig`, `checkBinaries` (`server/src/preflight.js`), `runLeaseRenewal` (Task 3), `Server as IOServer` from `socket.io`, `wireRealtime` (Task 7). Child-tree kill is delegated to `tunnel.stop()` (the `TunnelManager` contract says `stop()` "kills child tree"), so `index.js` does **not** reach into an undocumented `.child` field.
- Produces: a `start()` function used by the guarded entry; `server/package.json` scripts so `npm test` runs `vitest run`, `npm run dev`/`npm start` boot the app.

- [ ] **Step 1: Write the failing test**
```js
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
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/index.scripts.test.js -t "package.json defines module type"`
Expected: FAIL — `server/package.json` lacks the required `scripts` (and/or `server/src/index.js` does not yet export `start`).

- [ ] **Step 3: Write minimal implementation**
`server/package.json` (merge into existing — keep existing deps):
```json
{
  "type": "module",
  "scripts": {
    "dev": "node src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  }
}
```
`server/src/index.js`:
```js
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server as IOServer } from 'socket.io';
import { initDb } from './db/index.js';
import { loadConfig } from './config.js';
import { checkBinaries } from './preflight.js';
import { buildApp, HUB_URL } from './bootstrap.js';
import { wireRealtime } from './realtime/bus.js';
import { runLeaseRenewal } from './scheduler/runLease.js';

const LEASE_INTERVAL_MS = 60 * 60 * 1000; // hourly

export async function start({ dbPath = './yt-notify.db' } = {}) {
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
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/index.scripts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/index.js server/package.json server/test/index.scripts.test.js
git commit -m "feat(index): bootstrap two listeners, scheduler, socket.io, graceful shutdown"
```

---

### Task 12: Full-suite green gate (non-TDD verification gate)

> Non-TDD gate: this task is the phase's aggregate verification gate, **exempt from the fail-first structure**. It writes no test and no feature code; it only runs the whole suite and fixes any regression surfaced by an earlier task. Keep it last.

**Files:**
- (No new files — verification gate for the whole phase.)

**Interfaces:**
- Consumes: every module created in Phase 5 and earlier phases.
- Produces: confirmation that `npm test` runs the entire `vitest run` suite green (the phase deliverable).

- [ ] **Step 1: (no new test — aggregate gate)**
No new test is authored here. The "red" condition is any failing test anywhere in the suite.

- [ ] **Step 2: Run the full suite**
Run: `npm test`
Expected: If any Phase 5 task is incomplete, FAIL listing the offending file(s) (e.g. missing `buildApp`, `runCatchup`, `killTree`, or entry-guard tests).

- [ ] **Step 3: (no new feature code) Fix regressions in the owning task**
Any failure is repaired in the Task (1-11) that owns the offending module — typically a missing export or an unwired `onNewVideo -> queue.enqueue`. No new feature code is introduced in Task 12 itself.

- [ ] **Step 4: Run the full suite to verify green**
Run: `npm test`
Expected: PASS — full suite green; app boots both listeners, re-subscribes on url change, recovers missed videos on reconnect, and the mock webhook drives the full pipeline in the e2e test.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "chore(phase5): green full vitest suite — resilience, wiring, hardening"
```
