# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
#  Build stage — compiles TypeScript, then is thrown away
# ─────────────────────────────────────────────────────────────
FROM node:24-slim AS builder

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ─────────────────────────────────────────────────────────────
#  Runtime stage
# ─────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime

# fonts-dejavu-core: @napi-rs/canvas draws text through the system font stack,
#   and the slim image ships none — without this the welcome card renders blank
#   glyphs. ~1 MB.
# ca-certificates: needed to fetch avatars over HTTPS.
RUN apt-get update \
 && apt-get install --no-install-recommends -y fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATABASE_PATH=/data/bot.db \
    HTTP_PORT=8080 \
    # node:sqlite is stable but still flagged experimental; the warning would
    # otherwise be printed on every start.
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY assets ./assets

# The SQLite file lives on a mounted volume, not in the image layer.
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 8080

# Requires status:"ok", not merely a 200. /health answers 200 with
# status:"starting" while the gateway is still connecting, so checking only the
# status code would report a bot with a bad token as healthy forever — and the
# automatic rollback in deploy/update-bot.sh gates on exactly this verdict.
HEALTHCHECK --interval=60s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||8080)+'/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
