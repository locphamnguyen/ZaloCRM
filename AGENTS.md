# Codex Project Guide

## Project Shape
- Product: Zalo Sales CRM, Vietnamese-first full-stack app.
- Frontend: Vue 3 + Vite + TypeScript + Vuetify in `frontend/`.
- Backend: Fastify + TypeScript + Prisma/Postgres in `backend/`.
- Infra/docs/assets: Docker files in `docker/`, compose files at root, docs in `docs/`, planning notes in `plans/`.

## Work Rules
- Keep changes surgical and scoped to requested task.
- Do not commit, branch, or rewrite history unless user asks.
- Do not edit generated/build output such as `dist/`, `build/`, `.vite/`, `node_modules/`, or coverage folders.
- Prefer existing architecture, naming, route style, and Vietnamese product language.
- Keep secrets out of repo. Use `.env.example` for documented environment variables only.

## Commands
- Backend install: `cd backend && npm install`
- Backend dev: `cd backend && npm run dev`
- Backend build: `cd backend && npm run build`
- Backend tests: `cd backend && npm test`
- Backend Prisma migrate: `cd backend && npm run db:migrate`
- Frontend install: `cd frontend && npm install`
- Frontend dev: `cd frontend && npm run dev`
- Frontend build: `cd frontend && npm run build`
- Full stack Docker dev: `docker compose -f docker-compose.dev.yml up --build`
- Full stack Docker prod-like: `docker compose up -d --build`

## Validation
- For backend TypeScript/API changes, run `cd backend && npm run build` and relevant `npm test` when practical.
- For frontend UI/TypeScript changes, run `cd frontend && npm run build` when practical.
- For Prisma/schema changes, include migration or explain why `db:push` is intended.
- If validation cannot run due missing services/env, report exact command and blocker.

## Coding Notes
- Backend uses ESM TypeScript (`type: module`), Fastify routes, and Prisma models.
- Frontend uses Vue SFCs, Pinia, vue-router, Vuetify, and Vite.
- Use `rg` for searches and keep file references precise.
- Avoid broad refactors during bug fixes.
