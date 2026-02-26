# K-Vault Cloudreve Adapter

中间件服务：以 **Cloudreve** 为唯一用户入口，以 **Telegram 频道** 为永久存储后端，Cloudreve 本地存储作为缓存层。

---

## 架构概览

```
用户
  │  （所有操作通过 Cloudreve）
  ▼
Cloudreve ──── webhook/轮询 ────▶ K-Vault Adapter ──▶ Telegram 频道
  ▲                                     │                  （永久存储）
  │                                     │
  └────── 缓存恢复（文件不存在时）◀────────┘
```

| 层         | 角色                         |
|------------|------------------------------|
| Cloudreve  | 唯一用户入口（上传 / 下载 / 分享）|
| Adapter    | 中间层（同步、下载代理、缓存管理）|
| Telegram   | 永久对象存储（永不删除）         |

**严格禁止：**
- ❌ 用户直接访问 Telegram CDN 链接
- ❌ Telegram 文件 URL 暴露给任何外部请求
- ❌ 修改 Cloudreve 源码

---

## 核心功能

### 1. 上传同步（Cloudreve → Telegram）
- 轮询 Cloudreve 指定目录，检测新文件
- 自动下载并上传至 Telegram 存储频道
- 记录 `Telegram file_id` ↔ `Cloudreve 路径` 映射（SQLite）

### 2. 群组文件入库（Telegram → Cloudreve）
- Telegram Bot 接收群组/用户发送的文件
- 自动下载并上传至 Cloudreve（`CLOUDREVE_INBOX_PATH` 目录）
- 保留 Telegram 副本，向发送者回复 Cloudreve 链接

### 3. 下载代理（缓存命中 / 缓存恢复）
```
GET /api/file/<cloudreve-path>
```
1. 若 Cloudreve 本地有缓存 → 直接返回
2. 若缓存已被淘汰 → 从 Telegram 下载 → 重新上传至 Cloudreve → 返回给用户
> Telegram CDN URL 仅在服务端内部使用，**绝不返回给客户端**

### 4. 缓存淘汰
- 每天 02:00 UTC 自动运行
- 超过 `CACHE_IDLE_DAYS` 天未访问的文件 → 删除 Cloudreve 本地副本
- 保留 `telegram_file_id`，下次下载时自动恢复

---

## 快速部署

### 前置要求
- Docker & Docker Compose
- 已安装并运行的 Cloudreve 实例（或使用 `docker-compose.yml` 一键部署）
- Telegram Bot Token（[@BotFather](https://t.me/BotFather)）
- Telegram 存储频道 ID

### 步骤

```bash
# 1. 进入 adapter 目录
cd cloudreve-adapter

# 2. 复制并填写配置
cp .env.example .env
$EDITOR .env

# 3. 启动（仅 adapter，Cloudreve 已单独运行）
docker compose up -d adapter

# 或：一键启动完整栈（Cloudreve + Adapter）
docker compose up -d
```

Cloudreve 默认访问地址：`http://localhost:5212`

Adapter API 地址：`http://localhost:3000`

---

## 环境变量

| 变量名 | 必需 | 默认值 | 说明 |
|--------|:----:|--------|------|
| `TG_BOT_TOKEN` | ✅ | — | Telegram Bot Token |
| `TG_CHANNEL_ID` | ✅ | — | Telegram 存储频道 ID（负数） |
| `CLOUDREVE_URL` | ✅ | — | Cloudreve 地址（如 `http://cloudreve:5212`） |
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

## HTTP API

### 健康检查
```
GET /health
```

### 下载代理（核心接口）
```
GET /api/file/<cloudreve-path>
```
示例：`GET /api/file/TelegramInbox/document.pdf`

服务端内部从 Telegram 获取文件，**绝不返回 Telegram CDN URL**。

### 手动触发同步（需 `X-Webhook-Secret` 头）
```
POST /api/sync
Body: { "path": "/TelegramInbox" }   # 可选，默认使用 CLOUDREVE_INBOX_PATH
```

### 手动触发缓存淘汰
```
POST /api/evict
```

### 查看所有映射记录
```
GET /api/mappings?limit=100&offset=0
```

### Telegram Webhook 接入
```
POST /telegram/webhook
```
在 [@BotFather](https://t.me/BotFather) 设置 Webhook 指向此端点。

### Cloudreve 上传回调
```
POST /cloudreve/webhook
Body: { "path": "/TelegramInbox/newfile.pdf" }
```
在 Cloudreve 上传策略中配置此回调地址。

---

## Telegram Bot 配置

### 设置 Webhook
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-adapter-domain.com/telegram/webhook", "secret_token": "your-secret"}'
```

将 Bot 添加到 Telegram 群组后，用户发送文件时，Bot 会自动将文件导入 Cloudreve 并回复文件链接。

---

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器（文件变更自动重启）
npm run dev

# 运行测试
npm test
```

---

## 许可证

与主项目相同，遵循 [LICENSE](../LICENSE)。
