# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

ZaloCRM is a Vietnamese-first full-stack CRM for managing multiple personal Zalo accounts from one web app. The stack is:

- `backend/`: Node.js 20, Fastify 5, TypeScript ESM, Prisma 7, PostgreSQL 16, Socket.IO, zca-js.
- `frontend/`: Vue 3, Vite, TypeScript, Vuetify, Pinia, vue-router, axios, Socket.IO client.
- Root Docker Compose runs app, PostgreSQL, MinIO, optional Redis, and backups.
- Product docs live in `README.md`, `HUONG-DAN-CAI-DAT.md`, `HUONG-DAN-SU-DUNG.md`, and `docs/`.
- Planning notes live in `plans/`; superpowers implementation plans live in `docs/superpowers/plans/`.

## Common commands

### Install

```bash
cd backend && npm install
cd frontend && npm install
```

### Backend

```bash
cd backend && npm run dev          # tsx watch src/app.ts, API on port 3000 by default
cd backend && npm run build        # TypeScript compile to dist/
cd backend && npm start            # run compiled dist/app.js
cd backend && npm test             # vitest run
cd backend && npm run test:watch   # vitest watch mode
cd backend && npm run test:coverage
cd backend && npx vitest run path/to/file.test.ts
cd backend && npx vitest run path/to/file.test.ts -t "test name"
```

### Database / Prisma

```bash
cd backend && npm run db:migrate   # prisma migrate dev
cd backend && npm run db:push      # prisma db push
cd backend && npm run db:seed      # tsx prisma/seed.ts
cd backend && npm run db:studio
```

Prisma schema is `backend/prisma/schema.prisma`. Existing production upgrade docs sometimes use `prisma db push --accept-data-loss` from Docker entrypoint; for development, prefer migrations unless user explicitly wants db push.

### Frontend

```bash
cd frontend && npm run dev         # Vite dev server on port 5173
cd frontend && npm run build       # vue-tsc -b && vite build
cd frontend && npm run preview
```

Frontend dev server proxies `/api` and `/socket.io` to `http://localhost:3000` via `frontend/vite.config.ts`.

### Full stack

```bash
docker compose -f docker-compose.dev.yml up --build
docker compose up -d --build
curl http://localhost:3080/health
```

Production-like compose exposes app at `http://localhost:3080`, PostgreSQL on `127.0.0.1:5433`, MinIO on `9000`, MinIO console on `127.0.0.1:9001`, Redis on `127.0.0.1:6379` when profile enabled.

## Backend architecture

`backend/src/app.ts` is composition root. It creates Fastify, registers CORS/JWT/rate-limit/multipart/static serving, attaches Socket.IO, registers all route modules, starts background jobs, starts `eventBuffer`, then reconnects saved Zalo sessions.

Backend uses feature modules under `backend/src/modules/`:

- `auth/`: setup/login/profile/users/org/team, role and JWT middleware, preferences.
- `zalo/`: QR login, reconnect, account pool, listener lifecycle, Zalo socket handlers, labels sync, friend/group/profile operations, access middleware.
- `chat/`: conversations, message operations, attachment upload/send paths.
- `contacts/`: contacts, appointments, statuses, notes, CRM tags, merge/duplicate logic, interaction cron, contact intelligence.
- `activity/`: timeline/activity logging.
- `dashboard/`, `analytics/`, `reports/`: metrics, saved reports, Excel exports.
- `api/`: public API and webhook settings/emission.
- `automation/`, `integrations/`, `ai/`, `notifications/`, `search/`, `branding/`: separate product areas.

Shared infrastructure lives under `backend/src/shared/`: Prisma client, logger/utilities, Redis/event buffer, MinIO client, Zalo operation helpers, media helpers.

Important runtime flow:

1. `app.ts` creates Socket.IO and decorates Fastify with `io`.
2. `zaloPool.setIO(io)` lets Zalo account lifecycle emit realtime events.
3. `registerZaloSocketHandlers(io)` and `registerChatSocketHandlers(io)` bind client socket events.
4. `zaloPool.loginQR()` / `reconnect()` creates zca-js API instances, persists credentials, attaches listeners, emits `zalo:*` events, starts label/history backfills.
5. Listener/message modules write Prisma rows and broadcast updates/webhooks.

Data is strongly org-scoped. `Organization` sits at top of `schema.prisma`; most product records carry `orgId`. Preserve org scoping and Zalo account ACL checks when adding routes.

Attachments use `backend/src/shared/storage/minio-client.ts`. Uploads write to MinIO bucket and return public URLs based on `S3_PUBLIC_URL`; browser access requires that URL to be reachable by users, not only by Docker containers.

## Frontend architecture

`frontend/src/main.ts` creates Vue app with Pinia, router, and Vuetify. `frontend/src/App.vue` chooses layouts. `frontend/src/router/index.ts` defines authenticated routes and redirects unauthenticated users to `/login`.

Frontend organization:

- `views/`: route-level screens such as Dashboard, Chat, Contacts, Friends, Groups, Settings, Analytics, Automation.
- `components/`: shared layout/UI widgets.
- `composables/`: feature state and API orchestration, usually one per backend resource or screen area.
- `stores/auth.ts`: Pinia auth state, setup/login/profile loading, token persistence.
- `api/index.ts`: axios instance with `/api/v1` base URL, JWT request interceptor, 401 redirect handling.
- `plugins/vuetify.ts`, `assets/tokens.css`, `assets/main.css`: design system and Vuetify setup.

For new UI work, follow existing Vietnamese product language and screen patterns. Prefer adding feature logic in composables and keeping view components focused on layout/state binding. If editing UI, run the frontend dev server and verify behavior in browser when possible.

## Current product concepts

Core product areas include multi-Zalo account QR login/reconnect, realtime chat, contacts/friends/groups, CRM tags, Zalo label sync, notes, appointments, duplicate/merge review, dashboards/analytics/reports, automation templates, public API/webhooks, AI assistants, MinIO attachments, and role/team-based access.

README documents release behavior through v3.1.2. Treat README upgrade/rollback commands as user-facing release docs; verify against current code before changing them.

## Existing agent guidance

`AGENTS.md` contains Codex guidance: keep changes surgical, avoid committing/branching unless asked, do not edit generated output, prefer existing architecture/naming/Vietnamese product language, keep secrets out of repo, and validate backend/frontend builds when practical. Follow same guidance here.

No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` were present during initialization.

## Validation expectations

- Backend API/TypeScript changes: run `cd backend && npm run build`; run focused Vitest when tests exist or new tests are added.
- Frontend UI/TypeScript changes: run `cd frontend && npm run build`; for UI behavior, use browser/dev server when feasible.
- Prisma changes: include migration unless user explicitly chooses `db:push`; explain data impact for schema changes.
- Docker/deploy changes: validate with relevant compose command when feasible and report any env/service blocker exactly.

## Notes for future upgrades

This repo is evolving toward new UI/UX/features. Before large upgrades, write or update project docs that capture current behavior first; then change code against those docs. Prefer small feature slices that preserve existing backend route/module boundaries and frontend view/composable boundaries.
