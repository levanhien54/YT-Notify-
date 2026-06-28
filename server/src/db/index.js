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

export function updateChannelSubscription(db, channelId, { subscribedAt, leaseExpiresAt }) {
  db.prepare(`
    UPDATE channels SET subscribed_at = ?, lease_expires_at = ? WHERE channel_id = ?
  `).run(subscribedAt, leaseExpiresAt, channelId);
}

export function updateLastVideoPublishedAt(db, channelId, publishedAt) {
  db.prepare('UPDATE channels SET last_video_published_at = ? WHERE channel_id = ?')
    .run(publishedAt, channelId);
}

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
