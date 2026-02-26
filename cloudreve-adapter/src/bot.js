'use strict';

/**
 * Telegram bot update handler.
 *
 * Receives webhook updates from Telegram and imports any media files
 * sent to the bot (or forwarded from groups) into Cloudreve.
 *
 * Supported message types: photo, document, video, audio, voice,
 * animation, video_note, sticker.
 */

const { importFromTelegram } = require('./sync');
const { TelegramClient }     = require('./telegram');
const { getConfig }          = require('./config');

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Process a single Telegram update object.
 * @param {object} update – parsed JSON from Telegram
 */
async function handleUpdate(update) {
  const message = update?.message || update?.channel_post;
  if (!message) return; // ignore non-message updates (callback_query, etc.)

  const media = extractMedia(message);
  if (!media) return; // no file in this message

  const cfg      = getConfig();
  const telegram = new TelegramClient(cfg.telegram);

  try {
    const result = await importFromTelegram({
      telegramFileId:    media.fileId,
      telegramMessageId: message.message_id,
      fileName:          media.fileName,
      mimeType:          media.mimeType,
      fileSize:          media.fileSize,
    });

    // Reply with the Cloudreve link (not a Telegram CDN link)
    const replyText = [
      '✅ File imported successfully',
      `Name: ${media.fileName}`,
      `Cloudreve path: ${result.cloudreve_path}`,
      `Link: ${result.directLink}`,
    ].join('\n');

    await telegram.sendMessage({
      chatId:            message.chat?.id,
      text:              replyText,
      replyToMessageId:  message.message_id,
    });
  } catch (err) {
    console.error('[bot] Failed to import file from Telegram:', err.message);

    await telegram.sendMessage({
      chatId:           message.chat?.id,
      text:             `❌ Import failed: ${err.message}`,
      replyToMessageId: message.message_id,
    }).catch(() => {});
  }
}

// ── Media extraction ─────────────────────────────────────────────────────────

function extractMedia(message) {
  if (!message) return null;

  // Photo – pick the largest size
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo.reduce((a, b) =>
      (a.file_size || 0) > (b.file_size || 0) ? a : b
    );
    return {
      fileId:    photo.file_id,
      fileName:  `photo_${message.message_id || Date.now()}.jpg`,
      mimeType:  'image/jpeg',
      fileSize:  photo.file_size || 0,
    };
  }

  const candidates = [
    { key: 'document',   fallbackMime: 'application/octet-stream', fallbackExt: 'bin'  },
    { key: 'video',      fallbackMime: 'video/mp4',                fallbackExt: 'mp4'  },
    { key: 'audio',      fallbackMime: 'audio/mpeg',               fallbackExt: 'mp3'  },
    { key: 'voice',      fallbackMime: 'audio/ogg',                fallbackExt: 'ogg'  },
    { key: 'animation',  fallbackMime: 'video/mp4',                fallbackExt: 'mp4'  },
    { key: 'video_note', fallbackMime: 'video/mp4',                fallbackExt: 'mp4'  },
    { key: 'sticker',    fallbackMime: 'image/webp',               fallbackExt: 'webp' },
  ];

  for (const { key, fallbackMime, fallbackExt } of candidates) {
    const data = message[key];
    if (!data?.file_id) continue;

    const mimeType = data.mime_type || fallbackMime;
    const ext      = (data.file_name || '').split('.').pop() || fallbackExt;
    const fileName = data.file_name ||
                     `${key}_${message.message_id || Date.now()}.${ext}`;

    return {
      fileId:   data.file_id,
      fileName,
      mimeType,
      fileSize: data.file_size || 0,
    };
  }

  return null;
}

module.exports = { handleUpdate };
