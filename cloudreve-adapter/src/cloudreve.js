'use strict';

/**
 * Cloudreve v3 API client.
 *
 * Handles authentication (cookie-based session), file listing,
 * uploading, downloading and deletion via the REST API.
 *
 * Ref: https://cloudreve.org/docs/
 */

const fetch = require('node-fetch');
const FormData = require('form-data');
const { Readable } = require('stream');

class CloudreveClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  – e.g. "http://cloudreve:5212"
   * @param {string} opts.user     – login e-mail / username
   * @param {string} opts.password – password
   */
  constructor({ baseUrl, user, password }) {
    this.baseUrl  = baseUrl.replace(/\/+$/, '');
    this.user     = user;
    this.password = password;
    // Cookie jar: store the session cookie returned by Cloudreve
    this._cookie  = null;
    this._cookieExpiry = 0;
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  /**
   * Log in and persist the session cookie.
   * Re-uses the cookie while it is still valid (24 h TTL).
   */
  async ensureAuth() {
    const now = Date.now();
    if (this._cookie && now < this._cookieExpiry) return;

    const res = await this._rawFetch('/api/v3/user/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: this.user, Password: this.password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloudreve login failed (${res.status}): ${text}`);
    }

    // Extract Set-Cookie header
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/cloudreve-session=[^;]+/);
    if (!match) {
      throw new Error('Cloudreve login succeeded but no session cookie returned');
    }

    this._cookie = match[0];
    // Refresh 23 hours from now (Cloudreve default session TTL is 24 h)
    this._cookieExpiry = now + 23 * 60 * 60 * 1000;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  _rawFetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    return fetch(url, options);
  }

  async _authFetch(path, options = {}) {
    await this.ensureAuth();
    const headers = Object.assign({ Cookie: this._cookie }, options.headers || {});
    return this._rawFetch(path, { ...options, headers });
  }

  async _authJson(path, options = {}) {
    const res = await this._authFetch(path, options);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.code !== 0) {
      throw new Error(
        `Cloudreve API error [${path}] (${res.status}) code=${json.code}: ${json.msg || ''}`
      );
    }
    return json.data;
  }

  // ── File / directory operations ────────────────────────────────────────

  /**
   * List directory contents.
   * @param {string} dirPath  – Cloudreve directory path, e.g. "/TelegramInbox"
   * @returns {Promise<{objects: Array, parent: string}>}
   */
  async listDirectory(dirPath = '/') {
    const encoded = encodeURIComponent(dirPath);
    return this._authJson(`/api/v3/directory${encoded}`);
  }

  /**
   * Create a directory (and any missing parent directories).
   * @param {string} dirPath
   */
  async createDirectory(dirPath) {
    return this._authJson('/api/v3/directory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dirPath }),
    });
  }

  /**
   * Ensure a directory path exists (creates it if absent).
   * @param {string} dirPath
   */
  async ensureDirectory(dirPath) {
    try {
      await this.createDirectory(dirPath);
    } catch {
      // Ignore "already exists" errors
    }
  }

  /**
   * Get direct download URL for a file.
   * @param {string} fileId  – Cloudreve file ID (returned in directory listing)
   * @returns {Promise<string>} Signed download URL
   */
  async getDownloadUrl(fileId) {
    const data = await this._authJson(`/api/v3/file/download/${fileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 0 }),
    });
    return data; // data is the URL string
  }

  /**
   * Download a file and return the response (stream).
   * @param {string} fileId
   * @returns {Promise<Response>}
   */
  async downloadFile(fileId) {
    const url = await this.getDownloadUrl(fileId);
    return fetch(url);
  }

  /**
   * Upload a file to Cloudreve using the chunked upload API.
   *
   * For files ≤ 5 MB we use a single-chunk upload; for larger files the
   * caller should split the buffer and call `uploadChunk` directly.
   *
   * @param {object}  opts
   * @param {string}  opts.filePath    – destination path in Cloudreve, e.g. "/TelegramInbox/file.pdf"
   * @param {string}  opts.fileName    – original file name
   * @param {number}  opts.fileSize    – total file size in bytes
   * @param {string}  opts.mimeType    – MIME type
   * @param {Buffer|Readable} opts.data – file content
   * @returns {Promise<string>} Cloudreve file ID of the uploaded file
   */
  async uploadFile({ filePath, fileName, fileSize, mimeType, data }) {
    // Step 1: initialise upload session
    const initData = await this._authJson('/api/v3/file/upload', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path:           filePath.replace(/\/[^/]+$/, '') || '/',
        size:           fileSize,
        name:           fileName,
        chunk_size:     fileSize,
        mime_type:      mimeType || 'application/octet-stream',
        last_modified:  Date.now(),
      }),
    });

    const sessionId = initData.sessionID;
    if (!sessionId) throw new Error('Cloudreve did not return a session ID for upload');

    // Step 2: upload chunk(s) – single chunk for simplicity
    const chunkRes = await this._authFetch(`/api/v3/file/upload/${sessionId}/0`, {
      method: 'POST',
      headers: {
        'Content-Type':   mimeType || 'application/octet-stream',
        'Content-Length': String(fileSize),
      },
      body: data,
    });

    if (!chunkRes.ok) {
      const text = await chunkRes.text().catch(() => '');
      throw new Error(`Cloudreve chunk upload failed (${chunkRes.status}): ${text}`);
    }

    const chunkJson = await chunkRes.json().catch(() => ({}));
    if (chunkJson.code !== 0) {
      throw new Error(`Cloudreve chunk upload error: ${chunkJson.msg}`);
    }

    return chunkJson.data; // file ID string
  }

  /**
   * Delete a file by path.
   * @param {string} filePath – full Cloudreve path, e.g. "/TelegramInbox/file.pdf"
   */
  async deleteFile(filePath) {
    await this._authJson('/api/v3/object', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [], dirs: [], files: [filePath] }),
    });
  }

  /**
   * Search for files whose name matches a pattern.
   * @param {string} keyword
   * @returns {Promise<Array>}
   */
  async searchFiles(keyword) {
    const encoded = encodeURIComponent(keyword);
    const data = await this._authJson(`/api/v3/file/search/keyword/${encoded}`);
    return data?.objects ?? [];
  }

  /**
   * Return metadata for a single file.
   * @param {string} filePath – full Cloudreve path
   * @returns {Promise<object|null>}
   */
  async statFile(filePath) {
    const dir  = filePath.replace(/\/[^/]+$/, '') || '/';
    const name = filePath.split('/').pop();
    try {
      const data = await this.listDirectory(dir);
      const objects = data?.objects ?? [];
      return objects.find((o) => o.name === name) ?? null;
    } catch {
      return null;
    }
  }
}

module.exports = { CloudreveClient };
