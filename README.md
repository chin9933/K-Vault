<div align="center">

# K-Vault

> Cloudreve + Telegram 双存储系统适配器

[English](README-EN.md) | **中文**

<br>

![GitHub stars](https://img.shields.io/github/stars/chin9933/K-Vault?style=flat-square)
![GitHub forks](https://img.shields.io/github/forks/chin9933/K-Vault?style=flat-square)
![GitHub license](https://img.shields.io/github/license/chin9933/K-Vault?style=flat-square)

</div>

---

## 项目简介

K-Vault 是一个 **Cloudreve + Telegram 双存储系统适配器**（中间件服务）。

- **Cloudreve V4**：唯一的用户入口，负责上传、下载和文件分享（需自行独立部署）
- **K-Vault Adapter**：本仓库，负责将文件永久同步至 Telegram 频道，并管理 Cloudreve 本地缓存
- **Telegram 频道**：永久存储层，文件一旦同步即永不删除

> ⚠️ 本项目仅支持 **Cloudreve V4 API**，不兼容 V3。

---

## 架构概览

```
用户（所有操作通过 Cloudreve）
  ▼
Cloudreve V4 ──── webhook/轮询 ────▶ K-Vault Adapter ──▶ Telegram 频道（永久存储）
  ▲                                        │
  └────── 缓存恢复（本地副本不存在时）◀─────┘
```

| 层 | 角色 |
| :--- | :--- |
| Cloudreve V4 | 唯一用户入口（上传 / 下载 / 分享） |
| K-Vault Adapter | 中间层（同步、下载代理、缓存管理） |
| Telegram 频道 | 永久对象存储（永不删除） |

---

## 功能特性

- **上传同步** - 轮询 Cloudreve 目录，检测新文件后自动上传至 Telegram
- **群组文件入库** - Telegram Bot 接收群组文件，自动同步到 Cloudreve 并回复直链
- **下载代理** - 透明代理，缓存命中直接返回，缓存淘汰时从 Telegram 自动恢复
- **缓存淘汰** - 定时清理长期未访问的 Cloudreve 本地副本，节省本地存储

---

## 快速部署

> 前置要求：已自行部署并运行 **Cloudreve V4** 实例，以及 Docker & Docker Compose。

```bash
# 1. 复制并填写配置
cp .env.example .env
# 编辑 .env，填写 TG_BOT_TOKEN、TG_CHANNEL_ID、CLOUDREVE_URL 等必填项

# 2. 启动 Adapter
docker compose up -d
```

Adapter API 默认地址：`http://localhost:3000`

---

## 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|:----:|--------|------|
| `TG_BOT_TOKEN` | ✅ | — | Telegram Bot Token |
| `TG_CHANNEL_ID` | ✅ | — | Telegram 存储频道 ID（负数） |
| `CLOUDREVE_URL` | ✅ | — | Cloudreve V4 地址（如 `http://cloudreve:5212`） |
| `CLOUDREVE_USER` | ✅ | — | Cloudreve 管理员用户名 |
| `CLOUDREVE_PASSWORD` | ✅ | — | Cloudreve 管理员密码 |
| `PORT` | — | `3000` | Adapter 监听端口 |
| `DB_PATH` | — | `./data/mappings.db` | SQLite 数据库路径 |
| `CLOUDREVE_INBOX_PATH` | — | `/TelegramInbox` | Bot 入库目录 |
| `CACHE_IDLE_DAYS` | — | `7` | 缓存淘汰天数 |
| `POLL_INTERVAL_MINUTES` | — | `5` | Cloudreve 轮询间隔（分钟） |
| `WEBHOOK_SECRET` | — | — | 保护管理 API 的 Token（`X-Webhook-Secret` 请求头） |
| `TG_WEBHOOK_SECRET` | — | — | Telegram Webhook Secret Token |
| `TG_API_BASE` | — | `https://api.telegram.org` | 自定义 Bot API 服务器地址 |
| `SKIP_INITIAL_SYNC` | — | `false` | 启动时跳过初始同步 |

---

## 相关链接

- [Cloudreve 官网](https://cloudreve.org)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [问题反馈](https://github.com/chin9933/K-Vault/issues)

---

## 许可证

MIT License

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=chin9933/K-Vault&type=Date)](https://star-history.com/#chin9933/K-Vault&Date)
