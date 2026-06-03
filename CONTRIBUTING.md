# Contributing to ZaloCRM

Thanks for taking the time to contribute! This guide explains how to propose
changes and what we expect from contributions.

## Before you start

By submitting a contribution you agree to the
[Contributor License Agreement (CLA)](CLA.md). This is required before any
pull request can be merged. You can accept it by adding a sign-off line to your
commits:

```
Signed-off-by: Your Name <your@email>
```

(use `git commit -s` to add it automatically), or by stating in your pull
request that you have read and agree to the CLA.

## Reporting bugs

Open a GitHub issue and include:

- What you expected to happen vs. what actually happened.
- Steps to reproduce (smallest possible case).
- Environment: OS, Node version, browser, and relevant `.env` settings
  (never paste real secrets).
- Logs or screenshots if helpful.

## Proposing changes

1. **Open an issue first** for anything non-trivial, so we can align on the
   approach before you write code.
2. **Fork** the repository and create a branch from `main`:
   `git checkout -b feat/short-description`.
3. Make focused commits with clear messages (Conventional Commits preferred:
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
4. Keep pull requests small and single-purpose. Large, mixed PRs are hard to
   review and slow to merge.

## Development

- Backend: `backend/` (Fastify + Prisma + Socket.IO, TypeScript).
- Frontend: `frontend/` (Vue 3 + Vuetify + Pinia + Vite).
- Install: `npm install` in each of `backend/` and `frontend/`.
- Type-check before pushing: `npx tsc --noEmit` (backend),
  `npx vue-tsc --noEmit -p tsconfig.app.json` (frontend).
- Run tests: `npm test` (backend).

## Code standards

- Keep changes consistent with the surrounding code (naming, structure, style).
- Prefer small, focused modules over large files.
- Handle errors and edge cases; don't commit broken or commented-out code.
- Add or update tests for behavior you change.
- Do **not** commit secrets (`.env`, keys, tokens) or generated artifacts.

## Pull request checklist

- [ ] Linked to an issue (for non-trivial changes).
- [ ] CLA accepted (sign-off or statement).
- [ ] Type-check and tests pass locally.
- [ ] Commits are focused with clear messages.
- [ ] No secrets or unrelated files included.

## Review

A maintainer will review your PR. Be ready to discuss and revise. Whether a
contribution is merged is at the maintainer's discretion.

Thank you for helping improve ZaloCRM!
