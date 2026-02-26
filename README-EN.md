<div align="center">

# K-Vault

> File hosting solution using Cloudreve as the frontend and a Telegram channel as permanent storage backend.

**English** | [中文](README.md)

<br>

![GitHub stars](https://img.shields.io/github/stars/katelya77/K-Vault?style=flat-square)
![GitHub forks](https://img.shields.io/github/forks/katelya77/K-Vault?style=flat-square)
![GitHub license](https://img.shields.io/github/license/katelya77/K-Vault?style=flat-square)

</div>

---

## Architecture Overview

All upload/download operations are performed through **Cloudreve**'s interface and API. The **K-Vault Adapter** handles permanent synchronization of files to a **Telegram channel** in the background.

```
User (all operations via Cloudreve)
  ▼
Cloudreve ──── webhook/polling ────▶ K-Vault Adapter ──▶ Telegram Channel (permanent storage)
  ▲                                        │
  └────── Cache restore (on cache miss) ◀──┘
```

| Layer | Role |
| :--- | :--- |
| Cloudreve | Single user entry point (upload / download / share) |
| Adapter | Middleware layer (sync, download proxy, cache management) |
| Telegram | Permanent object storage (never deleted) |

## Features

- **Upload Sync** - Polls Cloudreve directories and automatically uploads new files to Telegram
- **Group File Ingestion** - Telegram Bot receives files from groups and syncs them to Cloudreve, replying with direct links
- **Download Proxy** - Transparent proxy — cache hit returns directly; on cache miss, restores from Telegram automatically
- **Cache Eviction** - Periodically removes long-idle Cloudreve local copies to save local storage

---

## Quick Deployment

```bash
cd cloudreve-adapter
cp .env.example .env
# Edit .env and fill in TG_BOT_TOKEN, TG_CHANNEL_ID, CLOUDREVE_URL, etc.
docker compose up -d
```

For detailed configuration, see [`cloudreve-adapter/README.md`](cloudreve-adapter/README.md).

---

## Related Links

- [Cloudreve Website](https://cloudreve.org)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Issue Tracker](https://github.com/katelya77/K-Vault/issues)

---

## License

MIT License

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=katelya77/K-Vault&type=Date)](https://star-history.com/#katelya77/K-Vault&Date)
