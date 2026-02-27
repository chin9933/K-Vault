# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm install --omit=dev --frozen-lockfile 2>/dev/null || npm install --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine

# better-sqlite3 requires Python + build tools at install time,
# but runs without them at runtime (pre-built binary is copied from deps).
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

# Data directory for the SQLite database
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

# Use tini as init process (proper signal handling)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
