'use strict';

/**
 * Cache eviction scheduler.
 *
 * Runs on a cron schedule and deletes Cloudreve local copies of files
 * that have not been accessed for longer than CACHE_IDLE_DAYS.
 * The Telegram file_id is preserved; the next download restores the file.
 */

const cron       = require('node-cron');
const db         = require('./db');
const { CloudreveClient } = require('./cloudreve');
const { getConfig        } = require('./config');

let _job = null;

/**
 * Start the eviction scheduler.
 * Runs once at midnight every day.
 */
function startEvictionScheduler() {
  if (_job) return; // already started

  // Run at 02:00 every day
  _job = cron.schedule('0 2 * * *', runEviction, { timezone: 'UTC' });
  console.log('[cache] Eviction scheduler started (daily at 02:00 UTC)');
}

/**
 * Stop the eviction scheduler.
 */
function stopEvictionScheduler() {
  if (_job) {
    _job.stop();
    _job = null;
  }
}

/**
 * Run one eviction pass:
 *   1. Find entries with last_accessed older than CACHE_IDLE_DAYS.
 *   2. Delete the local file from Cloudreve.
 *   3. Mark as evicted in the DB (has_local_cache = 0).
 */
async function runEviction() {
  const cfg        = getConfig();
  const idleSecs   = cfg.cacheIdleDays * 24 * 60 * 60;
  const stale      = db.getStaleEntries(idleSecs);

  if (!stale.length) {
    console.log('[cache] Eviction run: no stale entries found');
    return { evicted: 0, errors: 0 };
  }

  const cloudreve = new CloudreveClient(cfg.cloudreve);
  let evicted = 0;
  let errors  = 0;

  for (const entry of stale) {
    try {
      await cloudreve.deleteFile(entry.cloudreve_path);
      db.markEvicted(entry.cloudreve_path);
      console.log(`[cache] Evicted "${entry.file_name}" (last accessed ${new Date(entry.last_accessed * 1000).toISOString()})`);
      evicted++;
    } catch (err) {
      console.error(`[cache] Failed to evict "${entry.cloudreve_path}":`, err.message);
      errors++;
    }
  }

  console.log(`[cache] Eviction run complete: evicted=${evicted} errors=${errors}`);
  return { evicted, errors };
}

module.exports = { startEvictionScheduler, stopEvictionScheduler, runEviction };
