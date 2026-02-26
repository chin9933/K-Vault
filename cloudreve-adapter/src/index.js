'use strict';

/**
 * Application entry point.
 *
 * Starts the Express HTTP server, initialises the SQLite database,
 * starts the cache-eviction scheduler, and optionally kicks off an
 * initial upload-sync pass.
 */

const express = require('express');
const { getConfig }               = require('./config');
const { initDb }                  = require('./db');
const { startEvictionScheduler }  = require('./cache');
const { syncNewUploads }          = require('./sync');
const routes                      = require('./routes');

async function main() {
  // ── 1. Validate configuration ──────────────────────────────────────────
  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    console.error('[startup] Configuration error:', err.message);
    process.exit(1);
  }

  // ── 2. Initialise database ─────────────────────────────────────────────
  try {
    initDb(cfg.dbPath);
    console.log(`[startup] Database initialised at ${cfg.dbPath}`);
  } catch (err) {
    console.error('[startup] Failed to initialise database:', err.message);
    process.exit(1);
  }

  // ── 3. Start HTTP server ───────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(routes);

  const server = app.listen(cfg.port, () => {
    console.log(`[startup] Server listening on port ${cfg.port}`);
  });

  // ── 4. Start cache-eviction cron ───────────────────────────────────────
  startEvictionScheduler();

  // ── 5. Run an initial sync pass ────────────────────────────────────────
  if (process.env.SKIP_INITIAL_SYNC !== 'true') {
    syncNewUploads().then(({ synced, errors }) => {
      console.log(`[startup] Initial sync: synced=${synced} errors=${errors}`);
    }).catch((err) => {
      console.warn('[startup] Initial sync failed:', err.message);
    });
  }

  // ── 6. Start periodic polling ──────────────────────────────────────────
  const intervalMs = cfg.pollIntervalMinutes * 60 * 1000;
  const poll = setInterval(() => {
    syncNewUploads().catch((err) =>
      console.error('[poll] Sync error:', err.message)
    );
  }, intervalMs);

  console.log(`[startup] Polling Cloudreve every ${cfg.pollIntervalMinutes} minute(s)`);

  // ── Graceful shutdown ──────────────────────────────────────────────────
  function shutdown(signal) {
    console.log(`[shutdown] Received ${signal}, shutting down…`);
    clearInterval(poll);
    server.close(() => {
      console.log('[shutdown] HTTP server closed');
      process.exit(0);
    });
    // Force-exit after 10 s if shutdown hangs
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main();
