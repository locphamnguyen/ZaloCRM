# ZaloCRM — Onboarding Guide

> Auto-generated from the project knowledge graph (`/understand`) on the **cayenne** worktree, commit `807bebb`.
> Source: `.understand-anything/knowledge-graph.json` — 1199 nodes, 1374 edges, 10 layers, 11-step tour.

## Project Overview

**ZaloCRM v3.3** (`zalo-sales-crm`) is a centralized web platform to manage **multiple personal Zalo accounts** from one interface. Core capabilities:

- **Real-time chat** across many Zalo accounts (Socket.io), media via **MinIO/S3/R2**
- **Facebook Lead Ingestion** (Meta OAuth, webhook verify + HMAC, lead queue, auto-discover forms → Customer Lists)
- **Automation / bot framework** (blocks, sequences, triggers, broadcasts) sending via the real Zalo SDK
- **Lead scoring**, **RBAC** by department, **Privacy PIN**, and **PWA** mobile delivery

### Tech stack

| Side | Stack |
|---|---|
| **Backend** | Fastify 5 · Prisma 7 (Postgres) · Socket.io · BullMQ + Redis (ioredis) · MinIO · **zca-js** (Zalo SDK) · JWT + bcrypt · node-cron · TypeScript (tsx/tsc) · Vitest |
| **Frontend** | Vue 3 · Vuetify 4 · Pinia · Vue Router · vue-i18n · axios · socket.io-client · Chart.js · TipTap · Vite 8 + PWA |
| **Infra** | Docker / Docker Compose (app, Postgres, Redis, MinIO, backup) |

**Languages:** TypeScript, Vue, SQL/Prisma, JavaScript, HTML/CSS, YAML, Markdown.

It's a **monorepo**: `backend/` (Fastify API) and `frontend/` (Vue SPA), plus `docker/`, `docs/`, `plans/`, `scripts/`.

---

## Architecture Layers

The codebase is organized into 10 logical layers (file counts in brackets):

| Layer | Files | What lives here |
|---|---|---|
| **Frontend UI** | 183 | Vue SFCs, page views, layouts — chat workspace, CRM dashboards, automation builder, RBAC/admin screens |
| **Frontend State & Data Access** | 65 | Pinia stores, composables (`use-*`), axios API clients, router, plugins, global CSS |
| **Backend API & Routes** | 60 | Fastify route handlers, serializers, auth/RBAC/zalo-access middleware (HTTP + socket endpoints) |
| **Backend Domain Services** | 92 | Business logic: automation engine, lead scoring, analytics, AI prompt services, friend-sync, crons/workers, app bootstrap |
| **Backend Integrations** | 37 | Multi-account Zalo pool/SDK/socket/listener stack; Facebook/Telegram/Zapier/Google-Sheets connectors; sync engine |
| **Data & Persistence** | 47 | Prisma schema, SQL migrations, DB table/schema nodes |
| **Shared Utilities** | 16 | Crypto (AES-GCM), Prisma/Redis/MinIO clients, SSRF guard, video processor, VN phone normalization, logging |
| **Infrastructure & Config** | 47 | Dockerfiles, compose stacks, dev/deploy/migration scripts, PWA assets, build configs |
| **Documentation & Planning** | 49 | Docs, install/usage guides, README/CHANGELOG, plans, brand assets, HTML mockups |
| **Tests** | 31 | Vitest backend suites (routes, services, serializers, crons, security guards) |

> **Note on the dependency graph:** the codebase uses ESM `.js`-extension imports and `@/` path aliases that the static resolver can't fully map, so layer assignment leans on **directory structure + tags** more than import edges. Layers are accurate; the inter-file edge web is lighter than the code's true coupling.

---

## Key Concepts & Design Patterns

- **Multi-account Zalo abstraction.** `zalo-pool.ts` is a singleton managing a pool of authenticated zca-js sessions (QR login, reconnect, credential persistence). The rest of the app treats many accounts as one uniform interface. `zalo-operations.ts` wraps the SDK with retry/reconnect resilience.
- **Event-driven chat pipeline.** `zalo-listener-factory.ts` attaches per-account listeners → `message-handler.ts` normalizes/persists/mirrors media → `zalo-socket.ts` streams to the frontend `use-chat` composable. Transient events (typing, reaction echoes) are buffered in Redis via `event-buffer.ts`.
- **Prisma schema as the hub.** `schema.prisma` is the single most depended-upon node (highest fan-in) — organizations, users/RBAC, Zalo accounts, contacts, conversations, messages, automation, scoring.
- **Automation engine.** `automation-service` orchestrates campaigns; an `action-dispatcher` routes each step to concrete `action-handlers` (send-message, request-friend, update-status) that call the Zalo layer.
- **Lead lifecycle.** Facebook lead-gen → `facebook-lead-worker` (BullMQ) → contact creation → `lead-scoring`/`score-engine` assign quality scores → feeds chat & automation.
- **Frontend composable pattern.** Feature state lives in `use-*` composables (e.g. `use-chat`, `use-contacts`, `use-zalo-accounts`) that combine REST calls + Socket.io subscriptions; Pinia stores hold cross-cutting state (auth, privacy, rbac).
- **Background jobs:** BullMQ workers + node-cron (appointment reminders, interaction crons, contact intelligence, token refresh, friend sync).

---

## Guided Tour (recommended reading order)

1. **Project Overview** — `README.md`. The map of all subsystems and how frontend/backend fit together.
2. **Frontend Boot & Routing** — `frontend/src/main.ts`, `App.vue`, `router/index.ts`, `plugins/vuetify.ts`. How a URL resolves into a rendered, auth-guarded view.
3. **Backend Server Bootstrap** — `backend/src/app.ts`. The backend's table of contents: config, middleware, all feature route modules + Socket.io handlers.
4. **Data Model** — `backend/prisma/schema.prisma`. The core entities every module speaks in. Read this early.
5. **Real-Time Chat — Backend** — `chat/chat-routes.ts`, `chat/message-handler.ts`, `zalo/zalo-socket.ts`. HTTP layer → message processing → live socket.
6. **Real-Time Chat — Frontend** — `composables/use-chat.ts`, `components/chat/MessageThread.vue`, `api/index.ts`. The reactive client mirror.
7. **Zalo Integration Layer** — `zalo/zalo-pool.ts`, `zalo/zalo-routes.ts`, `zalo/zalo-socket.ts`. The heart of the product: the multi-account abstraction over zca-js.
8. **Automation & Bot Framework** — `automation/automation-service.ts`, `engine/action-dispatcher.ts`, `engine/action-handlers/send-message.ts`. How scheduled broadcasts and rule-driven replies execute.
9. **Facebook Lead Ingestion & Lead Scoring** — `integrations/providers/facebook/facebook-lead-worker.ts`, `contacts/lead-scoring.ts`, `scoring/score-engine.ts`. How external leads enter and get scored.
10. **Auth, RBAC & Privacy** — `auth/auth-service.ts`, `auth/auth-middleware.ts`, `rbac/rbac-middleware.ts`, `privacy/privacy-routes.ts`, `frontend/src/stores/auth.ts`. The gate on every route.
11. **Containerization & Deployment** — `docker/Dockerfile`, `docker-compose.yml` (db, minio). How every subsystem runs together in production.

---

## File Map (key files by layer)

### Frontend UI
- `frontend/src/components/chat/ChatContactPanel.vue` — Right-hand contact detail panel: profile, appointments, automation, engagement heatmap, lead score.
- `frontend/src/components/chat/ConversationList.vue` — Scrollable conversation list with previews, unread badges, new-message launcher.
- `frontend/src/components/chat/ConversationFilterSidebar.vue` — Advanced filtering by workspace, folder, tags, privacy.
- `frontend/src/components/chat/MessageThread.vue` — The scrolling message thread (reactions, reply UI).
- `frontend/src/components/chat/FolderManagePopup.vue` — Create/rename/reorder/delete conversation folders.

### Frontend State & Data Access
- `frontend/src/composables/use-chat.ts` — Conversation lists, message caching/merging, realtime socket sync.
- `frontend/src/composables/use-zalo-accounts.ts` — Zalo account CRUD, login/QR/reconnect, real-time status (Socket.io).
- `frontend/src/composables/use-zalo-accounts-dashboard.ts` — Stats, enrichment, uptime, bulk actions, search/filter/sort on top of the base composable.
- `frontend/src/composables/use-contacts.ts` — Contact list management + contact intelligence.
- `frontend/src/router/index.ts` — All routes (lazy-loaded), auth navigation guard, legacy redirects.

### Backend API & Routes
- `backend/src/modules/chat/chat-routes.ts` — Core chat: conversation listing, message history, sending, reply quoting (largest chat surface).
- `backend/src/modules/chat/chat-operations-routes.ts` — Forwarding, reactions, media download, Socket.io handler registration.
- `backend/src/modules/contacts/contact-routes.ts` — Contacts CRUD, search, filtering, tag management.
- `backend/src/modules/ai/ai-routes.ts` — AI provider/config management, per-conversation generation, rich-text formatting.
- `backend/src/modules/api/public-api-routes.ts` — API-key-authenticated public REST API.

### Backend Domain Services
- `backend/src/app.ts` — Fastify bootstrap: registers all plugins, routes, Socket.io handlers, global error handling.
- `backend/src/modules/chat/message-handler.ts` — Inbound message processing: media mirror, contact/conversation upsert, undo events.
- `backend/src/modules/ai/ai-service.ts` — Provider selection, context building, reply/summary/sentiment, appointment parsing.
- `backend/src/modules/contacts/contact-aggregate.ts` — Merges message/interaction/friend data into unified contact aggregates.
- `backend/src/modules/contacts/duplicate-detector.ts` — Phone/name fuzzy matching (Levenshtein) + auto-merge.

### Backend Integrations
- `backend/src/modules/zalo/zalo-pool.ts` — Singleton managing active Zalo account instances (QR login, reconnect, lifecycle).
- `backend/src/modules/zalo/zalo-listener-factory.ts` — Per-session event listeners (messages, reactions, receipts, undo, friend events).
- `backend/src/modules/zalo/zalo-history-backfill.ts` — Backfills historical conversations/messages by paging old messages.
- `backend/src/modules/integrations/providers/facebook/facebook-lead-worker.ts` — BullMQ worker ingesting Lead Ads events → contacts + rep assignment.
- `backend/src/modules/integrations/providers/facebook/facebook-graph-client.ts` — Typed Graph API client (token exchange, page subscription, lead fetch).

### Data & Persistence
- `backend/prisma/schema.prisma` — **The authoritative data model** for the entire backend (all models, enums, relations, indexes).
- `backend/prisma/migrations/**` — SQL migrations (contact intelligence, Phase 7 automation framework, RBAC, the new `add_zalo_account_archived_at`).

### Shared Utilities
- `backend/src/shared/zalo-operations.ts` — Resilient wrapper around zca-js (send/forward/undo/reconnect/friend/group) with retry.
- `backend/src/shared/event-buffer.ts` — Buffers transient realtime events (typing, reaction echoes) in Redis/memory.
- `backend/src/shared/video-processor.ts` — ffmpeg probe/thumbnail/send-mode for native video messages.
- `backend/src/shared/database/prisma-client.ts` — Shared singleton Prisma client with normalized-phone query extension.
- `backend/src/shared/storage/minio-client.ts` — MinIO/S3 client + upload/bucket-provisioning helpers.

### Infrastructure & Config
- `.env.example` — Runtime env template (JWT/encryption, Postgres, Redis, S3/MinIO, AI keys, …).
- `docker/Dockerfile` — Multi-stage build (frontend + backend) → minimal node-alpine runtime.
- `docker-compose.yml` — Prod stack: app, Postgres, Redis, MinIO (+ init), backup.
- `scripts/deploy-local.sh` — Hot-deploy: compile backend (tsc) + frontend (vite), copy into running container.

### Tests
- `backend/tests/*.test.ts` — Vitest integration/unit suites: chat operations, friend routes, friend-sync, groups, profile media, security guards.

---

## Complexity Hotspots — approach with care

192 file-level nodes are rated **complex**. The biggest ones a newcomer should not refactor lightly:

| File | Why it's heavy |
|---|---|
| `backend/prisma/schema.prisma` | The whole data model; nearly everything depends on it. |
| `backend/src/modules/contacts/contact-routes.ts` | ~1620 lines — full contact CRUD/search/tags surface. |
| `backend/src/modules/chat/chat-routes.ts` | ~1085 lines — core chat surface. |
| `backend/src/modules/chat/chat-operations-routes.ts` | ~900 lines — forwarding/reactions/media + socket registration. |
| `backend/src/modules/chat/message-handler.ts` | ~822 lines — central inbound pipeline. |
| `backend/src/modules/zalo/zalo-pool.ts` | Multi-account session lifecycle — subtle reconnect/credential logic. |
| `backend/src/modules/zalo/zalo-listener-factory.ts` | Event fan-out from the Zalo SDK. |
| `backend/src/modules/ai/ai-service.ts` | Multi-provider orchestration + prompt building. |
| `backend/src/modules/contacts/contact-aggregate.ts` | Cross-source aggregation with backfill. |
| `frontend/src/views/ContactsView.vue`, `ListDetailView.vue` | ~1500+ lines each — decomposition candidates. |
| `frontend/src/composables/use-zalo-accounts-dashboard.ts` | Layered stats/uptime/bulk/selection composable. |

### Other notes for new devs
- 🔐 **Security:** `scripts/test-phase7-runner.sh` contains a **hardcoded JWT** — scrub before relying on it.
- Several root `.*-mockup.html` / `.automation-explorer.html` files are **design prototypes**, not app code.

---

*Regenerate this guide after significant changes: run `/understand` (auto-incremental) then `/understand-onboard`.*
