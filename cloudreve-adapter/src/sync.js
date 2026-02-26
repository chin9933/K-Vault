'use strict';

/**
 * Sync orchestration.
 *
 * Implements the core business logic:
 *   1. syncNewUploads()  – detect files added to Cloudreve → upload to Telegram → record mapping
 *   2. downloadProxy()   – serve a file: check Cloudreve cache → if absent, pull from Telegram
 *   3. importFromTelegram() – upload a Telegram file to Cloudreve (used by bot)
 */

const path       = require('path');

const db         = require('./db');
const { CloudreveClient } = require('./cloudreve');
const { TelegramClient  } = require('./telegram');
const { getConfig        } = require('./config');

// ── Factory helpers ─────────────────────────────────────────────────────────

function makeCloudreve() {
  const cfg = getConfig();
  return new CloudreveClient(cfg.cloudreve);
}

function makeTelegram() {
  const cfg = getConfig();
  return new TelegramClient(cfg.telegram);
}

// ── 1. Upload-sync: Cloudreve → Telegram ────────────────────────────────────

/**
 * Scan a Cloudreve directory for files that are not yet backed up to Telegram,
 * then upload each one.
 *
 * @param {string} [dirPath]  – Cloudreve path to scan (defaults to configured inbox)
 * @returns {Promise<{synced: number, errors: number}>}
 */
async function syncNewUploads(dirPath) {
  const cfg       = getConfig();
  const cloudreve = makeCloudreve();
  const telegram  = makeTelegram();

  const targetDir = dirPath || cfg.cloudreve.inboxPath;

  await cloudreve.ensureDirectory(targetDir);

  const listing = await cloudreve.listDirectory(targetDir);
  const files   = (listing?.objects ?? []).filter((o) => o.type === 'file');

  let synced = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = `${targetDir.replace(/\/+$/, '')}/${file.name}`;
    const existing = db.getMappingByPath(filePath);
    if (existing) continue; // already backed up

    try {
      const { fileId: cloudreveFileId } = file;
      const fileRes = await cloudreve.downloadFile(cloudreveFileId);
      if (!fileRes.ok) {
        console.error(`[sync] Failed to download ${filePath} from Cloudreve: ${fileRes.status}`);
        errors++;
        continue;
      }

      const buffer   = await fileRes.buffer();
      const mimeType = fileRes.headers.get('content-type') || 'application/octet-stream';

      const { fileId: tgFileId, messageId } = await telegram.uploadFile({
        data:     buffer,
        fileName: file.name,
        mimeType,
        fileSize: buffer.length,
        caption:  `Synced from Cloudreve: ${filePath}`,
      });

      db.upsertMapping({
        cloudreveFileId: String(cloudreveFileId),
        cloudreve_path:  filePath,
        telegramFileId:  tgFileId,
        telegramMessageId: messageId,
        fileName:        file.name,
        fileSize:        file.size || buffer.length,
        mimeType,
        lastAccessed:    Math.floor(Date.now() / 1000),
        createdAt:       Math.floor(Date.now() / 1000),
        hasLocalCache:   1,
      });

      console.log(`[sync] Backed up "${file.name}" → TG file_id=${tgFileId}`);
      synced++;
    } catch (err) {
      console.error(`[sync] Error backing up "${file.name}":`, err.message);
      errors++;
    }
  }

  return { synced, errors };
}

// ── 2. Download proxy ────────────────────────────────────────────────────────

/**
 * Download a file to the caller.
 *
 * Flow:
 *   a) Look up the mapping by Cloudreve path.
 *   b) If has_local_cache = 1: serve via Cloudreve download URL.
 *   c) If has_local_cache = 0: pull from Telegram, re-upload to Cloudreve, then serve.
 *   d) Update last_accessed.
 *
 * Returns a fetch Response that the HTTP handler can pipe to the client.
 * The Telegram CDN URL is NEVER returned to the client.
 *
 * @param {string} cloudreve_path – full Cloudreve path of the requested file
 * @returns {Promise<{buffer: Buffer, fileName: string, mimeType: string}>}
 */
async function downloadProxy(cloudreve_path) {
  const mapping = db.getMappingByPath(cloudreve_path);
  if (!mapping) {
    const err = new Error(`No mapping found for path: ${cloudreve_path}`);
    err.status = 404;
    throw err;
  }

  db.touchMapping(cloudreve_path);

  const cloudreve = makeCloudreve();
  const telegram  = makeTelegram();

  // --- Case A: local cache present in Cloudreve ---
  if (mapping.has_local_cache) {
    try {
      const fileRes = await cloudreve.downloadFile(mapping.cloudreve_file_id);
      if (fileRes.ok) {
        const buffer   = await fileRes.buffer();
        const mimeType = fileRes.headers.get('content-type') ||
                         mapping.mime_type ||
                         'application/octet-stream';
        return { buffer, fileName: mapping.file_name, mimeType };
      }
      // Cloudreve returned an error – fall through to re-fetch from Telegram
      console.warn(`[proxy] Cloudreve download failed (${fileRes.status}), re-fetching from Telegram`);
    } catch (err) {
      console.warn('[proxy] Cloudreve download threw, re-fetching from Telegram:', err.message);
    }
  }

  // --- Case B: re-fetch from Telegram and restore to Cloudreve ---
  console.log(`[proxy] Restoring "${mapping.file_name}" from Telegram…`);

  const { buffer, mimeType: tgMime } = await telegram.downloadFile(mapping.telegram_file_id);
  const mimeType = mapping.mime_type || tgMime;
  const fileName = mapping.file_name || 'file';

  // Ensure the parent directory exists
  const parentDir = path.posix.dirname(cloudreve_path) || '/';
  await cloudreve.ensureDirectory(parentDir);

  let newCloudreveId;
  try {
    newCloudreveId = await cloudreve.uploadFile({
      filePath: cloudreve_path,
      fileName,
      fileSize: buffer.length,
      mimeType,
      data:     buffer,
    });
    db.upsertMapping({
      cloudreveFileId:   newCloudreveId,
      cloudreve_path,
      telegramFileId:    mapping.telegram_file_id,
      telegramMessageId: mapping.telegram_message_id,
      fileName,
      fileSize:          buffer.length,
      mimeType,
      lastAccessed:      Math.floor(Date.now() / 1000),
      createdAt:         mapping.created_at,
      hasLocalCache:     1,
    });
    console.log(`[proxy] Restored "${fileName}" to Cloudreve (id=${newCloudreveId})`);
  } catch (uploadErr) {
    console.error('[proxy] Failed to restore file to Cloudreve:', uploadErr.message);
    // Still serve the content even if the restore failed
    db.markEvicted(cloudreve_path);
  }

  return { buffer, fileName, mimeType };
}

// ── 3. Import a Telegram message file into Cloudreve ─────────────────────────

/**
 * Download a file from a Telegram message and import it into Cloudreve.
 * Used by the Telegram bot when it receives a file from a group/user.
 *
 * @param {object} opts
 * @param {string} opts.telegramFileId   – Telegram file_id
 * @param {number} opts.telegramMessageId
 * @param {string} opts.fileName
 * @param {string} opts.mimeType
 * @param {number} opts.fileSize
 * @returns {Promise<{cloudreve_path: string, tgFileId: string, directLink: string}>}
 */
async function importFromTelegram({ telegramFileId, telegramMessageId, fileName, mimeType, fileSize }) {
  const cfg       = getConfig();
  const cloudreve = makeCloudreve();
  const telegram  = makeTelegram();

  const inboxDir  = cfg.cloudreve.inboxPath;
  const safeName  = sanitizeFileName(fileName);
  const destPath  = `${inboxDir.replace(/\/+$/, '')}/${safeName}`;

  // Skip if already imported
  const existing = db.getMappingByPath(destPath);
  if (existing) {
    return {
      cloudreve_path: destPath,
      tgFileId:       existing.telegram_file_id,
      directLink:     buildCloudreveLink(cfg.cloudreve.baseUrl, destPath),
    };
  }

  await cloudreve.ensureDirectory(inboxDir);

  // Download from Telegram (internal only – not exposed to users)
  const { buffer, mimeType: detectedMime } = await telegram.downloadFile(telegramFileId);
  const finalMime = mimeType || detectedMime;

  // Upload to Cloudreve
  const cloudreveFileId = await cloudreve.uploadFile({
    filePath: destPath,
    fileName: safeName,
    fileSize: buffer.length,
    mimeType: finalMime,
    data:     buffer,
  });

  // Persist mapping (Telegram file is already stored; this is an import)
  db.upsertMapping({
    cloudreveFileId: String(cloudreveFileId),
    cloudreve_path:  destPath,
    telegramFileId,
    telegramMessageId,
    fileName:        safeName,
    fileSize:        fileSize || buffer.length,
    mimeType:        finalMime,
    lastAccessed:    Math.floor(Date.now() / 1000),
    createdAt:       Math.floor(Date.now() / 1000),
    hasLocalCache:   1,
  });

  console.log(`[import] Imported "${safeName}" from Telegram → Cloudreve ${destPath}`);

  return {
    cloudreve_path: destPath,
    tgFileId:       telegramFileId,
    directLink:     buildCloudreveLink(cfg.cloudreve.baseUrl, destPath),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFileName(name) {
  return String(name || 'file')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

function buildCloudreveLink(baseUrl, filePath) {
  // Return a Cloudreve share path, not a Telegram CDN URL
  return `${baseUrl}/s${filePath}`;
}

module.exports = {
  syncNewUploads,
  downloadProxy,
  importFromTelegram,
};
