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
