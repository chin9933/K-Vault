'use strict';

/**
 * Configuration module – reads all settings from environment variables.
 * All required vars are validated at startup.
 */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, defaultValue = '') {
  return process.env[name] ?? defaultValue;
}

function intEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * Validate and export the complete configuration object.
 * Call `getConfig()` once at startup; the result is cached.
 */
let _config = null;

function getConfig() {
  if (_config) return _config;

  _config = {
    // HTTP server
    port: intEnv('PORT', 3000),

    // Telegram Bot API
    telegram: {
      botToken: requireEnv('TG_BOT_TOKEN'),
      channelId: requireEnv('TG_CHANNEL_ID'),
      // Optional custom Bot API server (e.g. local telegram-bot-api)
      apiBase: optionalEnv('TG_API_BASE', 'https://api.telegram.org'),
      // Webhook secret to verify incoming Telegram updates
      webhookSecret: optionalEnv('TG_WEBHOOK_SECRET'),
    },

    // Cloudreve instance
    cloudreve: {
      baseUrl: requireEnv('CLOUDREVE_URL').replace(/\/+$/, ''),
      user: requireEnv('CLOUDREVE_USER'),
      password: requireEnv('CLOUDREVE_PASSWORD'),
      // Folder path inside Cloudreve where bot-forwarded files are stored
      inboxPath: optionalEnv('CLOUDREVE_INBOX_PATH', '/TelegramInbox'),
      // Optional admin token (skips session login when set)
      adminToken: optionalEnv('CLOUDREVE_ADMIN_TOKEN'),
    },

    // SQLite database file path
    dbPath: optionalEnv('DB_PATH', './data/mappings.db'),

    // Cache eviction: delete Cloudreve local copy after this many idle days
    cacheIdleDays: intEnv('CACHE_IDLE_DAYS', 7),

    // How often (in minutes) to poll Cloudreve for new unsynced files
    pollIntervalMinutes: intEnv('POLL_INTERVAL_MINUTES', 5),

    // Secret token to authenticate webhook calls from Cloudreve (optional)
    webhookSecret: optionalEnv('WEBHOOK_SECRET'),
  };

  return _config;
}

module.exports = { getConfig };
