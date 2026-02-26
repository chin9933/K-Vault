'use strict';

/**
 * SQLite database layer.
 *
 * Schema:
 *   file_mappings  – Cloudreve ↔ Telegram file mapping + cache state
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let _db = null;

function getDb() {
  if (_db) return _db;
  throw new Error('Database not initialized. Call initDb() first.');
}

function initDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_mappings (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      cloudreve_file_id   TEXT,
      cloudreve_path      TEXT    NOT NULL,
      telegram_file_id    TEXT    NOT NULL,
      telegram_message_id INTEGER,
      file_name           TEXT,
      file_size           INTEGER DEFAULT 0,
      mime_type           TEXT,
      last_accessed       INTEGER DEFAULT 0,
      created_at          INTEGER NOT NULL,
      has_local_cache     INTEGER DEFAULT 1
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cloudreve_path
      ON file_mappings(cloudreve_path);

    CREATE INDEX IF NOT EXISTS idx_last_accessed
      ON file_mappings(last_accessed);

    CREATE INDEX IF NOT EXISTS idx_has_local_cache
      ON file_mappings(has_local_cache);
  `);

  _db = db;
  return db;
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

/**
 * Insert or replace a file mapping record.
 */
function upsertMapping(record) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO file_mappings
      (cloudreve_file_id, cloudreve_path, telegram_file_id, telegram_message_id,
       file_name, file_size, mime_type, last_accessed, created_at, has_local_cache)
    VALUES
      (@cloudreve_file_id, @cloudreve_path, @telegram_file_id, @telegram_message_id,
       @file_name, @file_size, @mime_type, @last_accessed, @created_at, @has_local_cache)
    ON CONFLICT(cloudreve_path) DO UPDATE SET
      cloudreve_file_id   = excluded.cloudreve_file_id,
      telegram_file_id    = excluded.telegram_file_id,
      telegram_message_id = excluded.telegram_message_id,
      file_name           = excluded.file_name,
      file_size           = excluded.file_size,
      mime_type           = excluded.mime_type,
      last_accessed       = excluded.last_accessed,
      has_local_cache     = excluded.has_local_cache
  `);
  stmt.run({
    cloudreve_file_id:   record.cloudreveFileId   ?? null,
    cloudreve_path:      record.cloudreve_path,
    telegram_file_id:    record.telegramFileId,
    telegram_message_id: record.telegramMessageId ?? null,
    file_name:           record.fileName          ?? null,
    file_size:           record.fileSize          ?? 0,
    mime_type:           record.mimeType          ?? null,
    last_accessed:       record.lastAccessed       ?? 0,
    created_at:          record.createdAt          ?? Math.floor(Date.now() / 1000),
    has_local_cache:     record.hasLocalCache      ?? 1,
  });
}

/**
 * Look up a mapping by Cloudreve path.
 */
function getMappingByPath(cloudreve_path) {
  return getDb()
    .prepare('SELECT * FROM file_mappings WHERE cloudreve_path = ?')
    .get(cloudreve_path) ?? null;
}

/**
 * Look up a mapping by Cloudreve file ID.
 */
function getMappingByCloudreveId(cloudreveFileId) {
  return getDb()
    .prepare('SELECT * FROM file_mappings WHERE cloudreve_file_id = ?')
    .get(cloudreveFileId) ?? null;
}

/**
 * Update last_accessed timestamp for a file.
 */
function touchMapping(cloudreve_path) {
  getDb()
    .prepare('UPDATE file_mappings SET last_accessed = ? WHERE cloudreve_path = ?')
    .run(Math.floor(Date.now() / 1000), cloudreve_path);
}

/**
 * Mark a file as evicted from Cloudreve local cache.
 */
function markEvicted(cloudreve_path) {
  getDb()
    .prepare('UPDATE file_mappings SET has_local_cache = 0 WHERE cloudreve_path = ?')
    .run(cloudreve_path);
}

/**
 * Mark a file as restored to Cloudreve local cache.
 */
function markCached(cloudreve_path) {
  getDb()
    .prepare('UPDATE file_mappings SET has_local_cache = 1, last_accessed = ? WHERE cloudreve_path = ?')
    .run(Math.floor(Date.now() / 1000), cloudreve_path);
}

/**
 * Return all records whose last_accessed is older than `thresholdSeconds`
 * and still have a local cache copy.
 */
function getStaleEntries(thresholdSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
  return getDb()
    .prepare(`
      SELECT * FROM file_mappings
      WHERE has_local_cache = 1
        AND last_accessed < ?
        AND last_accessed > 0
    `)
    .all(cutoff);
}

/**
 * Return all records that are currently not cached locally.
 */
function getEvictedEntries() {
  return getDb()
    .prepare('SELECT * FROM file_mappings WHERE has_local_cache = 0')
    .all();
}

/**
 * Return all mappings (for diagnostics).
 */
function listMappings(limit = 100, offset = 0) {
  return getDb()
    .prepare('SELECT * FROM file_mappings ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

module.exports = {
  initDb,
  getDb,
  upsertMapping,
  getMappingByPath,
  getMappingByCloudreveId,
  touchMapping,
  markEvicted,
  markCached,
  getStaleEntries,
  getEvictedEntries,
  listMappings,
};
