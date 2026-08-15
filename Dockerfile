# syntax=docker/dockerfile:1

# ── Stage 1: install deps + build ──────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma's query engine at generate & runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching — only reinstalls when
# package.json/lock actually change, not on every source edit)
COPY package.json package-lock.json ./
RUN npm ci

# Now copy source and build
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src

# Generates the Prisma client into node_modules/.prisma, then compiles
# TypeScript to CommonJS and rewrites @/ path aliases to relative paths
# (see tsc-alias in package.json's build script) — both are required for
# `node dist/server.js` to run at all.
RUN npx prisma generate
RUN npm run build

# Drop dev dependencies now that the build is done, so the final image
# only ships what's needed at runtime.
RUN npm prune --omit=dev

# ── Stage 2: minimal runtime image ─────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 expressjs

ENV NODE_ENV=production

COPY --from=builder --chown=expressjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=expressjs:nodejs /app/dist ./dist
COPY --from=builder --chown=expressjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=expressjs:nodejs /app/package.json ./package.json

USER expressjs

# Cloud Run injects PORT at runtime and expects the container to listen
# on it — src/config/env.ts already reads process.env.PORT, so no
# hardcoded EXPOSE value is required, but 8080 is Cloud Run's default.
EXPOSE 8080

# Cloud Run's own health checks hit whatever port the container reports
# listening on; this HEALTHCHECK is for local `docker run` / Compose use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/server.js"]
