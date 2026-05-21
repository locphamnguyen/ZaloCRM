# Agent Onboarding Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and maintain a compact documentation suite that lets future agents understand ZaloCRM quickly before upgrading UI, UX, and features.

**Architecture:** Keep `CLAUDE.md` as the top-level agent operating guide and add focused docs under `docs/agent/` for architecture, feature inventory, UI/UX map, API/data model, and upgrade workflow. Each doc has a single responsibility and links to source files that agents must verify before code changes.

**Tech Stack:** Markdown docs, existing Node/Fastify/Prisma backend, existing Vue/Vite/Vuetify frontend, Docker Compose services.

---

## File Structure

- Modify: `CLAUDE.md` — root Claude Code guide with common commands and high-level architecture.
- Create: `docs/agent/README.md` — index and reading order for future agents.
- Create: `docs/agent/architecture.md` — cross-file runtime architecture and backend/frontend boundaries.
- Create: `docs/agent/features.md` — product capability inventory by domain.
- Create: `docs/agent/ui-ux-map.md` — route/view/composable map for UI upgrade work.
- Create: `docs/agent/api-data-model.md` — API conventions, auth, realtime, Prisma model relationships.
- Create: `docs/agent/upgrade-workflow.md` — safe sequence for future UI/UX/feature upgrades.

### Task 1: Verify Claude Code bootstrap

**Files:**
- Modify: `CLAUDE.md`
- Inspect: `AGENTS.md`
- Inspect: `README.md`
- Inspect: `backend/package.json`
- Inspect: `frontend/package.json`

- [ ] **Step 1: Confirm `CLAUDE.md` starts with required header**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
text = Path('CLAUDE.md').read_text()
required = '# CLAUDE.md\n\nThis file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.'
assert text.startswith(required), text[:160]
print('CLAUDE.md header OK')
PY
```
Expected: `CLAUDE.md header OK`

- [ ] **Step 2: Confirm key commands exist in `CLAUDE.md`**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
text = Path('CLAUDE.md').read_text()
for needle in [
    'cd backend && npm run dev',
    'cd backend && npm run build',
    'cd backend && npm test',
    'cd frontend && npm run dev',
    'cd frontend && npm run build',
    'docker compose up -d --build',
    'cd backend && npx vitest run path/to/file.test.ts',
]:
    assert needle in text, needle
print('CLAUDE.md commands OK')
PY
```
Expected: `CLAUDE.md commands OK`

- [ ] **Step 3: Commit bootstrap doc**

```bash
git add CLAUDE.md
git commit -m "docs: add Claude Code project guide"
```

### Task 2: Create agent docs index

**Files:**
- Create: `docs/agent/README.md`

- [ ] **Step 1: Write docs index**

Create `docs/agent/README.md` with:

```markdown
# Agent Documentation

This directory helps future coding agents understand ZaloCRM before changing UI, UX, or product features.

## Reading order

1. `../../CLAUDE.md` — commands, repo shape, architecture summary, validation expectations.
2. `architecture.md` — runtime flow across backend, frontend, Socket.IO, Zalo, storage, and background jobs.
3. `features.md` — product capability inventory and domain boundaries.
4. `ui-ux-map.md` — frontend routes, views, composables, layouts, and design-system entry points.
5. `api-data-model.md` — backend route conventions, auth, realtime events, Prisma model relationships.
6. `upgrade-workflow.md` — safe process for new UI/UX/features.

## Rules for agents

- Verify current code before acting on these docs; docs describe known structure, not proof of current behavior.
- Keep docs compact and cross-linked to source files.
- Update only docs affected by the code change.
- Preserve Vietnamese product language unless user asks for another language.
```

- [ ] **Step 2: Verify docs index links resolve as files**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
base = Path('docs/agent')
for name in ['README.md']:
    assert (base / name).exists(), name
print('agent README exists')
PY
```
Expected: `agent README exists`

- [ ] **Step 3: Commit docs index**

```bash
git add docs/agent/README.md
git commit -m "docs: add agent documentation index"
```

### Task 3: Create architecture guide

**Files:**
- Create: `docs/agent/architecture.md`

- [ ] **Step 1: Write architecture guide**

Create `docs/agent/architecture.md` with:

```markdown
# Architecture Guide

## Runtime composition

`backend/src/app.ts` is the backend composition root. It creates Fastify, registers plugins, attaches Socket.IO, registers route modules, starts background jobs, starts the event buffer, then reconnects saved Zalo sessions.

`frontend/src/main.ts` is the frontend composition root. It creates Vue, installs Pinia, router, and Vuetify, then mounts `App.vue`.

`docker-compose.yml` runs the production-like stack: app, PostgreSQL, MinIO, optional Redis profile, MinIO bucket init, and database backups.

## Backend module boundaries

- `backend/src/modules/auth/`: setup, login, profile, users, orgs, teams, roles, preferences.
- `backend/src/modules/zalo/`: account QR login, reconnect, zca-js pool, listener lifecycle, Zalo labels, friend/group/profile actions, account ACL.
- `backend/src/modules/chat/`: conversations, message operations, attachments.
- `backend/src/modules/contacts/`: CRM contacts, statuses, notes, tags, appointments, duplicate and merge logic, interaction cron.
- `backend/src/modules/activity/`: timeline and activity log routes.
- `backend/src/modules/dashboard/`, `analytics/`: dashboards, saved reports, metrics.
- `backend/src/modules/api/`: public API and webhooks.
- `backend/src/modules/automation/`: automation rules and message templates.
- `backend/src/modules/integrations/`: integration setup and sync.
- `backend/src/modules/ai/`: AI routes, provider registry, appointment fallback parser.

Shared infrastructure is in `backend/src/shared/`: Prisma client, logger, Redis/event buffer, MinIO, media helpers, and Zalo operation helpers.

## Realtime/Zalo flow

1. Browser connects to Socket.IO.
2. `app.ts` decorates Fastify with `io` and passes it into `zaloPool`.
3. Zalo login starts from route/socket handlers and enters `zaloPool.loginQR()`.
4. `zaloPool` emits QR, scanned, connected, disconnected, and error events.
5. On connect/reconnect, `zaloPool` attaches listeners, persists credentials, starts history/label backfills, and emits webhooks.
6. Listener/message modules write Prisma records, update aggregates, emit Socket.IO updates, and trigger configured webhooks.

## Frontend boundaries

- `frontend/src/router/index.ts` owns route table and auth guard.
- `frontend/src/api/index.ts` owns axios base URL, JWT request header, and 401 redirect behavior.
- `frontend/src/stores/auth.ts` owns auth token and profile state.
- `frontend/src/views/` contains route screens.
- `frontend/src/composables/` contains feature state/API orchestration used by views.
- `frontend/src/components/` contains shared UI widgets.
- `frontend/src/assets/tokens.css` and `frontend/src/assets/main.css` define design tokens and global styles.

## Data and storage

`backend/prisma/schema.prisma` is the data model source. `Organization` is top-level; most records carry `orgId`. Preserve org scoping and Zalo account ACL when adding backend code.

Attachments use MinIO through `backend/src/shared/storage/minio-client.ts`. `S3_PUBLIC_URL` must be reachable by the browser, not only inside Docker.
```

- [ ] **Step 2: Verify architecture guide references existing files**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
for path in [
    'backend/src/app.ts',
    'frontend/src/main.ts',
    'frontend/src/router/index.ts',
    'frontend/src/api/index.ts',
    'frontend/src/stores/auth.ts',
    'backend/prisma/schema.prisma',
    'backend/src/shared/storage/minio-client.ts',
]:
    assert Path(path).exists(), path
print('architecture references OK')
PY
```
Expected: `architecture references OK`

- [ ] **Step 3: Commit architecture guide**

```bash
git add docs/agent/architecture.md
git commit -m "docs: add agent architecture guide"
```

### Task 4: Create feature inventory

**Files:**
- Create: `docs/agent/features.md`

- [ ] **Step 1: Write feature inventory**

Create `docs/agent/features.md` with:

```markdown
# Feature Inventory

## Core CRM

- Multi-tenant organization/team/user model with owner/admin/member roles.
- Contact management with CRM name, Zalo identity, phone normalization, lifecycle statuses, source fields, lead score, demographic fields, consent fields, and parent-child contact grouping.
- Appointments, reminders, notes, activity timeline, CRM tags, and Zalo labels.
- Duplicate/merge workflows based on Zalo global identity, phone, and parent-child relationships.

## Zalo account operations

- Multiple personal Zalo accounts per organization.
- QR login and saved-session reconnect through zca-js.
- Per-account proxy support.
- Account ACL with read/chat/admin permissions.
- Friend, group, profile, label, history, and credential operations.
- Health checks and reconnect/background sync behavior.

## Chat and realtime

- Realtime chat via Socket.IO.
- Conversations and messages stored in PostgreSQL.
- Send/receive text, images, videos, files, stickers, reactions, mentions, reply previews, bank/QR cards, and special Zalo message types.
- Attachment mirroring through MinIO with browser-visible public URLs.
- Event buffering through Redis/shared event buffer when configured.

## Sales and productivity

- Dashboard, reports, analytics, saved reports, Excel export.
- Automation rules and message templates.
- Public API and webhooks with API key authentication.
- Integration hub and sync engine.
- AI suggestions, summaries, sentiment or appointment parsing through provider registry and fallback parser.

## Frontend product areas

Main route screens include Dashboard, Chat, Contacts, Friends, Groups, Zalo Accounts, Appointments, Reports, Analytics, Settings, API Settings, Integrations, Automation, Profile, Login, Setup, and customer activity log.

## Release context

README describes v3.0 and v3.1 capabilities and upgrade/rollback steps. Before removing or renaming any feature, check README and Vietnamese user guides for user-facing commitments.
```

- [ ] **Step 2: Verify feature doc mentions key domains**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
text = Path('docs/agent/features.md').read_text()
for needle in ['Core CRM', 'Zalo account operations', 'Chat and realtime', 'Sales and productivity', 'Frontend product areas']:
    assert needle in text, needle
print('feature inventory OK')
PY
```
Expected: `feature inventory OK`

- [ ] **Step 3: Commit feature inventory**

```bash
git add docs/agent/features.md
git commit -m "docs: add agent feature inventory"
```

### Task 5: Create UI/UX map

**Files:**
- Create: `docs/agent/ui-ux-map.md`

- [ ] **Step 1: Write UI/UX map**

Create `docs/agent/ui-ux-map.md` with:

```markdown
# UI/UX Map

## Frontend entry points

- `frontend/src/main.ts`: installs Pinia, router, Vuetify, and global CSS.
- `frontend/src/App.vue`: top-level application shell.
- `frontend/src/router/index.ts`: route table and auth guard.
- `frontend/src/plugins/vuetify.ts`: Vuetify setup.
- `frontend/src/assets/tokens.css`: design tokens.
- `frontend/src/assets/main.css`: global UI styles.

## Route-level views

- `/`: `DashboardView.vue`
- `/chat/:convId?`: `ChatView.vue`
- `/contacts`: `ContactsView.vue`
- `/friends`: `FriendsView.vue`
- `/groups`: `GroupsView.vue`
- `/zalo-accounts`: `ZaloAccountsView.vue`
- `/appointments`: `AppointmentsView.vue`
- `/reports`: `ReportsView.vue`
- `/analytics`: `AnalyticsView.vue`
- `/settings`: `SettingsView.vue`
- `/api-settings`: `ApiSettingsView.vue`
- `/integrations`: `IntegrationsView.vue`
- `/automation`: `AutomationView.vue`
- `/profile`: `ProfileView.vue`
- `/login`: `LoginView.vue`
- `/setup`: `SetupView.vue`
- `/customers/:id/activity`: `CustomerActivityLogView.vue`

## State and API pattern

- Use `frontend/src/api/index.ts` for authenticated REST calls to `/api/v1`.
- Use Pinia store `frontend/src/stores/auth.ts` for login/setup/profile state.
- Prefer feature composables in `frontend/src/composables/` for screen-specific API calls, loading state, filters, pagination, and mutation helpers.
- Keep view components focused on layout, user interactions, and binding composable state.

## UI upgrade workflow

1. Identify route view and composables for target area.
2. Read matching backend routes before changing data contracts.
3. Preserve Vietnamese product labels unless user requests another language.
4. Reuse existing Vuetify and design-token patterns before adding new styling systems.
5. Run `cd frontend && npm run build`.
6. Start dev servers and verify golden path in browser when UI behavior changes.
```

- [ ] **Step 2: Verify listed route views exist**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
views = [
'DashboardView.vue','ChatView.vue','ContactsView.vue','FriendsView.vue','GroupsView.vue','ZaloAccountsView.vue',
'AppointmentsView.vue','ReportsView.vue','AnalyticsView.vue','SettingsView.vue','ApiSettingsView.vue','IntegrationsView.vue',
'AutomationView.vue','ProfileView.vue','LoginView.vue','SetupView.vue','CustomerActivityLogView.vue'
]
missing = [v for v in views if not Path('frontend/src/views', v).exists()]
assert not missing, missing
print('UI route view references OK')
PY
```
Expected: `UI route view references OK`

- [ ] **Step 3: Commit UI/UX map**

```bash
git add docs/agent/ui-ux-map.md
git commit -m "docs: add agent UI UX map"
```

### Task 6: Create API and data model guide

**Files:**
- Create: `docs/agent/api-data-model.md`

- [ ] **Step 1: Write API/data guide**

Create `docs/agent/api-data-model.md` with:

```markdown
# API and Data Model Guide

## API conventions

- Authenticated frontend calls use axios instance `frontend/src/api/index.ts` with base URL `/api/v1`.
- JWT is stored in `localStorage` under `token` and attached as `Authorization: Bearer <token>`.
- 401 responses remove token and route user back to `/login`, except while already on `/login` or `/setup`.
- Public integration API uses `X-API-Key` per README and routes under backend public API modules.

## Backend route registration

All main route modules are registered in `backend/src/app.ts`. When adding a backend feature:

1. Add route/service code in the closest `backend/src/modules/<domain>/` directory.
2. Register new routes in `app.ts` only if no existing route module owns the path.
3. Use existing auth/role/Zalo-access middleware patterns from nearby route modules.
4. Preserve `orgId` scoping on every query/mutation touching tenant data.

## Prisma model groups

- Tenant/access: `Organization`, `Team`, `User`, `ZaloAccount`, `ZaloAccountAccess`.
- CRM: `Contact`, `Status`, `CrmTag`, `CrmTagGroup`, `Note`, `Appointment`, duplicate/merge-related models.
- Messaging: `Conversation`, `Message`, pinned/read/unread/message special-type related models.
- Zalo social graph: `Friend`, `FriendshipAttempt`, `ZaloLabel`, group-related models.
- Analytics/productivity: activity logs, daily stats, reports, integrations, automation, templates, AI config/suggestions.

## Realtime conventions

Socket.IO is initialized in `backend/src/app.ts` and shared with Zalo/chat modules. Zalo lifecycle events use `zalo:*` naming. Route handlers can emit through Fastify `io` decoration. Before adding new events, search existing frontend socket listeners and backend emitters to match naming and payload style.

## Storage conventions

Attachments use MinIO through `backend/src/shared/storage/minio-client.ts`. Store object keys and browser-visible URLs consistently. `S3_ENDPOINT` is for backend-to-MinIO access; `S3_PUBLIC_URL` is for browser access.

## Schema-change checklist

1. Read `backend/prisma/schema.prisma` and impacted route/service code.
2. Decide migration vs `db:push`; prefer migration for durable schema changes.
3. Update seed or docs only if current behavior needs it.
4. Run backend build and focused tests.
5. Explain data impact and rollback requirements in user-facing upgrade docs when release behavior changes.
```

- [ ] **Step 2: Verify API/data guide mentions required boundaries**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
text = Path('docs/agent/api-data-model.md').read_text()
for needle in ['Authorization: Bearer', 'orgId', 'backend/src/app.ts', 'backend/prisma/schema.prisma', 'S3_PUBLIC_URL']:
    assert needle in text, needle
print('API data model guide OK')
PY
```
Expected: `API data model guide OK`

- [ ] **Step 3: Commit API/data guide**

```bash
git add docs/agent/api-data-model.md
git commit -m "docs: add agent API data model guide"
```

### Task 7: Create upgrade workflow guide

**Files:**
- Create: `docs/agent/upgrade-workflow.md`

- [ ] **Step 1: Write upgrade workflow**

Create `docs/agent/upgrade-workflow.md` with:

```markdown
# Upgrade Workflow for Future Agents

Use this workflow when upgrading UI, UX, or product features.

## 1. Snapshot current behavior

- Read `CLAUDE.md` and relevant docs in `docs/agent/`.
- Read target frontend view/composables and matching backend routes.
- Check README/user guides if behavior is user-facing.
- Identify validation commands before editing.

## 2. Choose smallest feature slice

Good slices:

- One route screen UI improvement.
- One backend route plus one frontend composable/view update.
- One schema change plus one visible workflow.
- One product capability documented and tested end-to-end.

Avoid mixing unrelated UI redesign, schema changes, and infrastructure changes in one slice.

## 3. Preserve contracts unless intentionally changing them

- Frontend authenticated API calls go through `frontend/src/api/index.ts`.
- Backend tenant data stays scoped by `orgId`.
- Zalo account operations respect account access permissions.
- Realtime events keep existing naming/payload style unless a migration is documented.
- Public API/webhook changes require docs update.

## 4. Validate

Run the relevant commands:

```bash
cd backend && npm run build
cd backend && npm test
cd frontend && npm run build
docker compose -f docker-compose.dev.yml up --build
```

Run only focused commands when scope is small, but report skipped validation and exact blocker.

For UI/UX changes, start backend and frontend dev servers and verify the changed screen in a browser when feasible.

## 5. Update docs

Update the smallest relevant docs:

- `CLAUDE.md` for commands, architecture, or validation expectations.
- `docs/agent/architecture.md` for cross-file runtime flow changes.
- `docs/agent/features.md` for product capability changes.
- `docs/agent/ui-ux-map.md` for route/view/composable/design-system changes.
- `docs/agent/api-data-model.md` for API, realtime, auth, storage, or Prisma model changes.
- README/user guides for user-facing install/upgrade/usage changes.
```

- [ ] **Step 2: Verify upgrade workflow contains validation commands**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
text = Path('docs/agent/upgrade-workflow.md').read_text()
for needle in ['cd backend && npm run build', 'cd backend && npm test', 'cd frontend && npm run build', 'docker compose -f docker-compose.dev.yml up --build']:
    assert needle in text, needle
print('upgrade workflow OK')
PY
```
Expected: `upgrade workflow OK`

- [ ] **Step 3: Commit upgrade workflow**

```bash
git add docs/agent/upgrade-workflow.md
git commit -m "docs: add agent upgrade workflow"
```

### Task 8: Final documentation validation

**Files:**
- Inspect: `CLAUDE.md`
- Inspect: `docs/agent/*.md`

- [ ] **Step 1: Run documentation integrity check**

Run:
```bash
python3 - <<'PY'
from pathlib import Path
required = [
    Path('CLAUDE.md'),
    Path('docs/agent/README.md'),
    Path('docs/agent/architecture.md'),
    Path('docs/agent/features.md'),
    Path('docs/agent/ui-ux-map.md'),
    Path('docs/agent/api-data-model.md'),
    Path('docs/agent/upgrade-workflow.md'),
]
for path in required:
    assert path.exists(), f'missing {path}'
    text = path.read_text()
    assert 'TBD' not in text, f'TBD in {path}'
    assert 'TODO' not in text, f'TODO in {path}'
print('agent docs integrity OK')
PY
```
Expected: `agent docs integrity OK`

- [ ] **Step 2: Run build validations**

Run:
```bash
cd backend && npm run build
```
Expected: TypeScript build exits 0.

Run:
```bash
cd frontend && npm run build
```
Expected: Vue typecheck and Vite build exit 0.

- [ ] **Step 3: Commit final docs validation fixes if any**

```bash
git add CLAUDE.md docs/agent docs/superpowers/plans/2026-05-19-agent-onboarding-docs.md
git commit -m "docs: complete agent onboarding documentation plan"
```

## Self-Review

Spec coverage:

- Initialize Claude Code guidance: Task 1 creates and validates `CLAUDE.md`.
- Commands for build/lint/test/dev/single test: Task 1 covers existing backend/frontend/Docker commands; no lint script exists in current package files.
- High-level architecture: Task 3 covers backend, frontend, realtime, data, storage.
- Documentation for future upgrade agents: Tasks 2-7 create focused docs for architecture, features, UI/UX, API/data model, and upgrade workflow.
- Existing rules/README included: Task 1 pulls from `AGENTS.md` and `README.md`.

Placeholder scan: no `TBD`, `TODO`, or unspecified implementation placeholders in planned docs.

Type/name consistency: file names and source paths match current repo paths inspected during plan creation.
