<div align="center">

# K-Vault

> 以 Cloudreve 为前端、Telegram 频道为永久存储后端的文件托管解决方案

[English](README-EN.md) | **中文**

<br>

![GitHub stars](https://img.shields.io/github/stars/katelya77/K-Vault?style=flat-square)
![GitHub forks](https://img.shields.io/github/forks/katelya77/K-Vault?style=flat-square)
![GitHub license](https://img.shields.io/github/license/katelya77/K-Vault?style=flat-square)

</div>

---

## 架构概览

所有上传/下载操作均通过 **Cloudreve** 的界面和 API 完成，底层由 **K-Vault Adapter** 负责将文件永久同步到 **Telegram 频道**。

```
用户（通过 Cloudreve 操作）
  ▼
Cloudreve ──── webhook/轮询 ────▶ K-Vault Adapter ──▶ Telegram 频道（永久存储）
  ▲                                     │
  └────── 缓存恢复（文件不存在时）◀────────┘
```

| 层 | 角色 |
| :--- | :--- |
| Cloudreve | 唯一用户入口（上传 / 下载 / 分享） |
| Adapter | 中间层（同步、下载代理、缓存管理） |
| Telegram | 永久对象存储（永不删除） |

## 功能特性

- **上传同步** - 轮询 Cloudreve 目录，检测新文件后自动上传至 Telegram
- **群组文件入库** - Telegram Bot 接收群组文件，自动同步到 Cloudreve 并回复直链
- **下载代理** - 透明代理，缓存命中直接返回，缓存淘汰时从 Telegram 自动恢复
- **缓存淘汰** - 定时清理长期未访问的 Cloudreve 本地副本，节省本地存储

---

## 快速部署

```bash
cd cloudreve-adapter
cp .env.example .env
# 编辑 .env，填写 TG_BOT_TOKEN、TG_CHANNEL_ID、CLOUDREVE_URL 等必填项
docker compose up -d
```

详细配置请参阅 [`cloudreve-adapter/README.md`](cloudreve-adapter/README.md)。

---

## 相关链接

- [Cloudreve 官网](https://cloudreve.org)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [问题反馈](https://github.com/katelya77/K-Vault/issues)

---

## 许可证

MIT License

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=katelya77/K-Vault&type=Date)](https://star-history.com/#katelya77/K-Vault&Date)
