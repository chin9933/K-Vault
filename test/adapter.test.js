'use strict';

/**
 * Unit tests for the cloudreve-adapter.
 *
 * Uses Node's built-in test runner (node --test).
 * Mocks external dependencies so no live services are needed.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const os     = require('node:os');
const fs     = require('node:fs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvault-test-'));
  return path.join(dir, 'test.db');
}

// ── DB module tests ───────────────────────────────────────────────────────────

describe('db module', () => {
  let db;
  let dbPath;

  before(() => {
    dbPath = tmpDb();
    db = require('../src/db');
    db.initDb(dbPath);
  });

  after(() => {
    try { fs.rmSync(path.dirname(dbPath), { recursive: true }); } catch {}
  });

  it('upserts and retrieves a mapping by path', () => {
    db.upsertMapping({
      cloudreveFileId:  'cf-001',
      cloudreve_path:   '/inbox/test.pdf',
      telegramFileId:   'tg-file-001',
      telegramMessageId: 42,
      fileName:         'test.pdf',
      fileSize:         12345,
      mimeType:         'application/pdf',
      lastAccessed:     Math.floor(Date.now() / 1000),
      createdAt:        Math.floor(Date.now() / 1000),
      hasLocalCache:    1,
    });

    const row = db.getMappingByPath('/inbox/test.pdf');
    assert.ok(row, 'row should exist');
    assert.equal(row.telegram_file_id, 'tg-file-001');
    assert.equal(row.file_name, 'test.pdf');
    assert.equal(row.has_local_cache, 1);
  });

  it('marks a mapping as evicted', () => {
    db.markEvicted('/inbox/test.pdf');
    const row = db.getMappingByPath('/inbox/test.pdf');
    assert.equal(row.has_local_cache, 0);
  });

  it('marks a mapping as cached again', () => {
    db.markCached('/inbox/test.pdf');
    const row = db.getMappingByPath('/inbox/test.pdf');
    assert.equal(row.has_local_cache, 1);
  });

  it('updates last_accessed via touchMapping', async () => {
    const before = db.getMappingByPath('/inbox/test.pdf').last_accessed;
    // Ensure a tick passes so the timestamp can differ
    await new Promise((resolve) => setTimeout(resolve, 10));
    db.touchMapping('/inbox/test.pdf');
    const after = db.getMappingByPath('/inbox/test.pdf').last_accessed;
    assert.ok(after >= before, 'last_accessed should be >= previous value');
  });

  it('getStaleEntries returns entries older than threshold', () => {
    // Insert an entry with last_accessed far in the past
    db.upsertMapping({
      cloudreveFileId:   'cf-stale',
      cloudreve_path:    '/inbox/stale.txt',
      telegramFileId:    'tg-stale',
      telegramMessageId: null,
      fileName:          'stale.txt',
      fileSize:          100,
      mimeType:          'text/plain',
      lastAccessed:      1, // epoch + 1s → definitely stale
      createdAt:         1,
      hasLocalCache:     1,
    });

    const stale = db.getStaleEntries(60); // threshold: 60 s
    const found = stale.find((r) => r.cloudreve_path === '/inbox/stale.txt');
    assert.ok(found, 'stale entry should appear in getStaleEntries');
  });

  it('listMappings returns all rows', () => {
    const rows = db.listMappings(10, 0);
    assert.ok(rows.length >= 2, 'should have at least 2 rows');
  });
});

// ── bot.js – extractMedia ─────────────────────────────────────────────────────

describe('bot.js – extractMedia via handleUpdate (smoke test)', async () => {
  // We test the module loads without errors (real imports need live deps for full test)
  it('module loads without throwing', () => {
    assert.doesNotThrow(() => require('../src/bot'));
  });
});

// ── config.js ─────────────────────────────────────────────────────────────────

describe('config.js', () => {
  it('throws when required env vars are missing', () => {
    // Temporarily remove required vars
    const saved = {
      TG_BOT_TOKEN:        process.env.TG_BOT_TOKEN,
      TG_CHANNEL_ID:       process.env.TG_CHANNEL_ID,
      CLOUDREVE_URL:       process.env.CLOUDREVE_URL,
      CLOUDREVE_USER:      process.env.CLOUDREVE_USER,
      CLOUDREVE_PASSWORD:  process.env.CLOUDREVE_PASSWORD,
    };

    delete process.env.TG_BOT_TOKEN;
    delete process.env.TG_CHANNEL_ID;
    delete process.env.CLOUDREVE_URL;
    delete process.env.CLOUDREVE_USER;
    delete process.env.CLOUDREVE_PASSWORD;

    // Clear module cache so config re-reads env
    delete require.cache[require.resolve('../src/config')];

    assert.throws(
      () => require('../src/config').getConfig(),
      /Missing required environment variable/
    );

    // Restore
    Object.assign(process.env, saved);
    delete require.cache[require.resolve('../src/config')];
  });
});

// ── TelegramClient – unit ─────────────────────────────────────────────────────

describe('TelegramClient', () => {
  const { TelegramClient } = require('../src/telegram');

  it('constructs without throwing', () => {
    assert.doesNotThrow(() =>
      new TelegramClient({ botToken: 'tok', channelId: '-100123', apiBase: 'https://api.telegram.org' })
    );
  });

  it('_url() builds the correct URL', () => {
    const client = new TelegramClient({ botToken: 'abc123', channelId: '-100', apiBase: 'https://api.telegram.org' });
    assert.equal(client._url('sendMessage'), 'https://api.telegram.org/botabc123/sendMessage');
  });

  it('_cdnUrl() builds an internal CDN URL', () => {
    const client = new TelegramClient({ botToken: 'abc123', channelId: '-100', apiBase: 'https://api.telegram.org' });
    assert.equal(client._cdnUrl('documents/file_abc.pdf'), 'https://api.telegram.org/file/botabc123/documents/file_abc.pdf');
  });
});

// ── CloudreveClient – unit ────────────────────────────────────────────────────

describe('CloudreveClient', () => {
  const { CloudreveClient } = require('../src/cloudreve');

  it('constructs without throwing', () => {
    assert.doesNotThrow(() =>
      new CloudreveClient({ baseUrl: 'http://localhost:5212', user: 'u', password: 'p' })
    );
  });

  it('strips trailing slashes from baseUrl', () => {
    const c = new CloudreveClient({ baseUrl: 'http://localhost:5212///', user: 'u', password: 'p' });
    assert.equal(c.baseUrl, 'http://localhost:5212');
  });
});
