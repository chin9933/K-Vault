<div align="center">

# K-Vault

> Cloudreve + Telegram Dual Storage System Adapter

**English** | [中文](README.md)

<br>

![GitHub stars](https://img.shields.io/github/stars/chin9933/K-Vault?style=flat-square)
![GitHub forks](https://img.shields.io/github/forks/chin9933/K-Vault?style=flat-square)
![GitHub license](https://img.shields.io/github/license/chin9933/K-Vault?style=flat-square)

</div>

---

## Overview

K-Vault is a **Cloudreve + Telegram dual storage system adapter** (middleware service).

- **Cloudreve V4**: The sole user entry point for uploads, downloads, and file sharing (must be self-deployed independently).
- **K-Vault Adapter**: This repository. Permanently syncs files to a Telegram channel and manages the Cloudreve local cache layer.
- **Telegram Channel**: The permanent storage layer — files synced here are never deleted.

> ⚠️ This project requires **Cloudreve V4 API**. Cloudreve V3 is not supported or compatible.

---

## Architecture

```
User (all operations via Cloudreve)
  ▼
Cloudreve V4 ──── webhook/polling ────▶ K-Vault Adapter ──▶ Telegram Channel (permanent storage)
  ▲                                           │
  └────── Cache restore (on local cache miss) ┘
```

| Layer | Role |
| :--- | :--- |
| Cloudreve V4 | Single user entry point (upload / download / share) |
| K-Vault Adapter | Middleware layer (sync, download proxy, cache management) |
| Telegram Channel | Permanent object storage (never deleted) |

---

## Features

- **Upload Sync** - Polls Cloudreve directories and automatically uploads new files to Telegram
- **Group File Ingestion** - Telegram Bot receives files from groups and syncs them to Cloudreve, replying with direct links
- **Download Proxy** - Transparent proxy — cache hit returns directly; on cache miss, restores from Telegram automatically
- **Cache Eviction** - Periodically removes long-idle Cloudreve local copies to save local storage

---

## Quick Deployment

> Prerequisites: A self-deployed **Cloudreve V4** instance already running, plus Docker & Docker Compose.

```bash
# 1. Copy and fill in the configuration
cp .env.example .env
# Edit .env and fill in TG_BOT_TOKEN, TG_CHANNEL_ID, CLOUDREVE_URL, etc.

# 2. Start the Adapter
docker compose up -d
```

The Adapter API is available at `http://localhost:3000` by default.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `TG_BOT_TOKEN` | ✅ | — | Telegram Bot Token |
| `TG_CHANNEL_ID` | ✅ | — | Telegram storage channel ID (negative number) |
| `CLOUDREVE_URL` | ✅ | — | Cloudreve V4 address (e.g. `http://cloudreve:5212`) |
| `CLOUDREVE_USER` | ✅ | — | Cloudreve admin username |
| `CLOUDREVE_PASSWORD` | ✅ | — | Cloudreve admin password |
| `PORT` | — | `3000` | Adapter listening port |
| `DB_PATH` | — | `./data/mappings.db` | SQLite database path |
| `CLOUDREVE_INBOX_PATH` | — | `/TelegramInbox` | Bot inbox directory in Cloudreve |
| `CACHE_IDLE_DAYS` | — | `7` | Days before evicting idle local cache |
| `POLL_INTERVAL_MINUTES` | — | `5` | Cloudreve polling interval (minutes) |
| `WEBHOOK_SECRET` | — | — | Token to protect the admin API (`X-Webhook-Secret` header) |
| `TG_WEBHOOK_SECRET` | — | — | Telegram Webhook Secret Token |
| `TG_API_BASE` | — | `https://api.telegram.org` | Custom Bot API server address |
| `SKIP_INITIAL_SYNC` | — | `false` | Skip the initial sync pass on startup |

---

## Related Links

- [Cloudreve Website](https://cloudreve.org)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Issue Tracker](https://github.com/chin9933/K-Vault/issues)

---

## License

MIT License

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=chin9933/K-Vault&type=Date)](https://star-history.com/#chin9933/K-Vault&Date)
