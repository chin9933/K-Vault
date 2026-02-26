'use strict';

/**
 * Telegram Bot API client.
 *
 * Wraps the HTTP Bot API (no MTProto required) for:
 *   - Sending files to a storage channel
 *   - Downloading files by file_id
 *   - Sending reply messages
 */

const fetch = require('node-fetch');
const FormData = require('form-data');
const { Readable } = require('stream');

// Map MIME type → Bot API method + field name
const UPLOAD_METHOD_MAP = [
  { test: (t) => t.startsWith('image/'),  method: 'sendPhoto',    field: 'photo' },
  { test: (t) => t.startsWith('audio/'),  method: 'sendAudio',    field: 'audio' },
  { test: (t) => t.startsWith('video/'),  method: 'sendVideo',    field: 'video' },
];

function getUploadMethod(mimeType = '') {
  const type = mimeType.toLowerCase();
  for (const entry of UPLOAD_METHOD_MAP) {
    if (entry.test(type)) return entry;
  }
  return { method: 'sendDocument', field: 'document' };
}

class TelegramClient {
  /**
   * @param {object} opts
   * @param {string} opts.botToken  – Telegram Bot token
   * @param {string} opts.channelId – Destination channel/chat ID
   * @param {string} [opts.apiBase] – Custom Bot API server base URL
   */
  constructor({ botToken, channelId, apiBase = 'https://api.telegram.org' }) {
    this.botToken  = botToken;
    this.channelId = channelId;
    this.apiBase   = apiBase.replace(/\/+$/, '');
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  _url(method) {
    return `${this.apiBase}/bot${this.botToken}/${method}`;
  }

  async _call(method, body, isFormData = false) {
    const options = { method: 'POST' };
    if (isFormData) {
      options.body = body;
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body    = JSON.stringify(body);
    }
    const res  = await fetch(this._url(method), options);
    const json = await res.json().catch(() => ({}));
    if (!json.ok) {
      throw new Error(`Telegram API error [${method}]: ${json.description || 'unknown'}`);
    }
    return json.result;
  }

  // ── File operations ─────────────────────────────────────────────────────

  /**
   * Upload a file (Buffer or Readable stream) to the storage channel.
   *
   * @param {object} opts
   * @param {Buffer|Readable} opts.data      – file content
   * @param {string}          opts.fileName  – file name (with extension)
   * @param {string}          opts.mimeType  – MIME type
   * @param {number}          opts.fileSize  – size in bytes
   * @param {string}          [opts.caption] – optional caption
   * @returns {Promise<{fileId: string, messageId: number}>}
   */
  async uploadFile({ data, fileName, mimeType, fileSize, caption = '' }) {
    const { method, field } = getUploadMethod(mimeType);
    const form = new FormData();
    form.append('chat_id', this.channelId);
    form.append(field, data, {
      filename:    fileName,
      contentType: mimeType || 'application/octet-stream',
      knownLength: fileSize,
    });
    if (caption) form.append('caption', caption.slice(0, 1024));

    let result;
    try {
      result = await this._call(method, form, true);
    } catch (firstErr) {
      // Fall back to sendDocument when sendPhoto/sendAudio fails
      if (method !== 'sendDocument') {
        const fallbackForm = new FormData();
        fallbackForm.append('chat_id', this.channelId);
        fallbackForm.append('document', data, {
          filename:    fileName,
          contentType: mimeType || 'application/octet-stream',
          knownLength: fileSize,
        });
        if (caption) fallbackForm.append('caption', caption.slice(0, 1024));
        result = await this._call('sendDocument', fallbackForm, true);
      } else {
        throw firstErr;
      }
    }

    const fileId = extractFileId(result);
    if (!fileId) throw new Error('Telegram upload succeeded but no file_id found in response');

    return { fileId, messageId: result.message_id };
  }

  /**
   * Retrieve the file path on Telegram's CDN for a given file_id.
   * @param {string} fileId
   * @returns {Promise<string>} file path (e.g. "documents/file_XYZ.pdf")
   */
  async getFilePath(fileId) {
    const result = await this._call('getFile', { file_id: fileId });
    if (!result.file_path) throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
    return result.file_path;
  }

  /**
   * Build the direct CDN URL for a file path.
   * NOTE: this URL must NEVER be returned to end-users.
   * It is used internally to download files for re-upload to Cloudreve.
   * @param {string} filePath
   * @returns {string}
   */
  _cdnUrl(filePath) {
    return `${this.apiBase}/file/bot${this.botToken}/${filePath}`;
  }

  /**
   * Download a file from Telegram by file_id and return a Buffer.
   * The Telegram CDN URL is used only internally; it is never exposed to users.
   *
   * @param {string} fileId
   * @returns {Promise<{buffer: Buffer, mimeType: string}>}
   */
  async downloadFile(fileId) {
    const filePath = await this.getFilePath(fileId);
    const url      = this._cdnUrl(filePath);
    const res      = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download file from Telegram CDN (${res.status})`);
    }
    const buffer   = await res.buffer();
    const mimeType = res.headers.get('content-type') || 'application/octet-stream';
    return { buffer, mimeType };
  }

  // ── Messaging ───────────────────────────────────────────────────────────

  /**
   * Send a text message, optionally as a reply.
   */
  async sendMessage({ chatId, text, replyToMessageId } = {}) {
    const payload = {
      chat_id:                  chatId || this.channelId,
      text:                     String(text || '').slice(0, 4096),
      disable_web_page_preview: true,
    };
    if (replyToMessageId) {
      payload.reply_to_message_id          = Number(replyToMessageId);
      payload.allow_sending_without_reply  = true;
    }
    return this._call('sendMessage', payload);
  }

  /**
   * Set a webhook URL for incoming updates.
   * @param {string} url          – public HTTPS URL (must include path)
   * @param {string} [secret]     – optional X-Telegram-Bot-Api-Secret-Token
   */
  async setWebhook(url, secret) {
    const payload = { url };
    if (secret) payload.secret_token = secret;
    return this._call('setWebhook', payload);
  }

  /**
   * Remove the currently configured webhook.
   */
  async deleteWebhook() {
    return this._call('deleteWebhook', {});
  }
}

// ── Helper ──────────────────────────────────────────────────────────────────

function extractFileId(result) {
  if (!result) return null;
  if (Array.isArray(result.photo) && result.photo.length) {
    return result.photo.reduce((a, b) =>
      (a.file_size || 0) > (b.file_size || 0) ? a : b
    ).file_id;
  }
  return (
    result.document?.file_id  ||
    result.video?.file_id     ||
    result.audio?.file_id     ||
    result.voice?.file_id     ||
    result.animation?.file_id ||
    null
  );
}

module.exports = { TelegramClient };
