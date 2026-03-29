# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ───────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
RUN npm run build

# ── Stage 3: Production image ────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app

# Copy built artefacts
COPY --from=backend-builder /app/backend/dist       /app/dist
COPY --from=backend-builder /app/backend/node_modules /app/node_modules
COPY --from=backend-builder /app/backend/prisma     /app/prisma
COPY --from=backend-builder /app/backend/prisma.config.ts /app/prisma.config.ts
COPY --from=backend-builder /app/backend/package.json /app/package.json
COPY --from=frontend-builder /app/frontend/dist     /app/static

RUN mkdir -p /var/lib/zalo-crm/files

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# Push schema to DB then start server
CMD ["sh", "-c", "npx prisma db push --url \"$DATABASE_URL\" && node dist/app.js"]
