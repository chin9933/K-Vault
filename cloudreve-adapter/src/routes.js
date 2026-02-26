'use strict';

/**
 * Express HTTP routes.
 *
 * Endpoints:
 *   GET  /health                   – liveness check
 *   GET  /api/mappings             – list all file mappings (admin)
 *   POST /api/sync                 – trigger a manual upload-sync pass
 *   POST /api/evict                – trigger a manual cache-eviction pass
 *   GET  /api/file/*               – download-proxy (serves file to client)
 *   POST /telegram/webhook         – Telegram bot update receiver
 *   POST /cloudreve/webhook        – Cloudreve upload-complete webhook
 */

const express  = require('express');
const { syncNewUploads, downloadProxy } = require('./sync');
const { handleUpdate }                  = require('./bot');
const { runEviction }                   = require('./cache');
const db                                = require('./db');
const { getConfig }                     = require('./config');

const router = express.Router();

// ── Liveness / readiness ─────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ── Admin API ────────────────────────────────────────────────────────────────

router.get('/api/mappings', requireWebhookSecret, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 1000);
  const offset = parseInt(req.query.offset || '0',   10);
  const rows   = db.listMappings(limit, offset);
  res.json({ ok: true, total: rows.length, mappings: rows });
});

router.post('/api/sync', requireWebhookSecret, async (req, res) => {
  try {
    const dir    = req.body?.path || undefined;
    const result = await syncNewUploads(dir);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[routes] sync error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/evict', requireWebhookSecret, async (_req, res) => {
  try {
    const result = await runEviction();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[routes] evict error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Download proxy ────────────────────────────────────────────────────────────

/**
 * GET /api/file/*path
 *
 * Proxies file downloads.  The Telegram CDN URL is NEVER returned to the
 * client; all file bytes are fetched server-side and piped to the response.
 */
router.get('/api/file/*', async (req, res) => {
  // Express wildcard puts the rest of the path in req.params[0]
  const filePath = '/' + (req.params[0] || '');

  try {
    const { buffer, fileName, mimeType } = await downloadProxy(filePath);

    res.set({
      'Content-Type':        mimeType || 'application/octet-stream',
      'Content-Length':      String(buffer.length),
      // RFC 6266: provide both ASCII fallback and UTF-8 encoded filename*
      'Content-Disposition': `inline; filename="${encodeRFC5987(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control':       'private, no-store',
    });
    res.end(buffer);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// ── Telegram webhook ──────────────────────────────────────────────────────────

router.post('/telegram/webhook', verifyTelegramSecret, async (req, res) => {
  // Always acknowledge immediately (Telegram expects 200 within 5 s)
  res.json({ ok: true });

  try {
    await handleUpdate(req.body);
  } catch (err) {
    console.error('[routes] Telegram webhook error:', err.message);
  }
});

// ── Cloudreve upload-complete webhook ─────────────────────────────────────────

/**
 * POST /cloudreve/webhook
 *
 * Cloudreve can be configured to call this endpoint after a successful upload
 * (via its "callback" storage policy or a custom script hook).
 *
 * Expected body: { path: "/TelegramInbox/file.pdf", ... }
 */
router.post('/cloudreve/webhook', requireWebhookSecret, async (req, res) => {
  const filePath = req.body?.path;
  if (!filePath) {
    return res.status(400).json({ ok: false, error: 'Missing path in request body' });
  }

  res.json({ ok: true, message: 'Sync queued' });

  // Fire-and-forget: sync just this directory
  const dir = filePath.replace(/\/[^/]+$/, '') || '/';
  syncNewUploads(dir).catch((err) =>
    console.error('[routes] Cloudreve webhook sync error:', err.message)
  );
});

// ── Middleware helpers ────────────────────────────────────────────────────────

function requireWebhookSecret(req, res, next) {
  const cfg    = getConfig();
  const secret = cfg.webhookSecret;
  if (!secret) return next(); // no secret configured → open

  const provided = req.headers['x-webhook-secret'];
  if (provided !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function verifyTelegramSecret(req, res, next) {
  const cfg    = getConfig();
  const secret = cfg.telegram.webhookSecret;
  if (!secret) return next(); // no secret configured

  const header = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (header !== secret) {
    return res.status(401).json({ ok: false, error: 'Invalid Telegram webhook secret' });
  }
  next();
}

/**
 * Encode a string for use as the ASCII filename parameter in Content-Disposition.
 * Replaces characters not safe in quoted-string with underscores.
 */
function encodeRFC5987(str) {
  return String(str || '').replace(/[^\w\s.\-]/g, '_');
}

module.exports = router;
