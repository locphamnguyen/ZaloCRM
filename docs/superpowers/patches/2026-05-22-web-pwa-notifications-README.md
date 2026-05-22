# Web/PWA Notifications Patch Bundle

## Purpose

This bundle preserves the Web Push + PWA notification work merged in PR #2 so it can be re-applied during future core upgrades without depending on the original worktree.

The feature adds:

1. Backend Web Push subscription storage, VAPID config, authenticated push endpoints, and delivery helpers.
2. System notification push delivery with generic preview text for safer lock-screen notifications.
3. Incoming Zalo chat push delivery scoped to active users with access to the related Zalo account.
4. A custom PWA service worker with push/click handling and NotificationBell controls.

## Files

- `2026-05-22-web-pwa-notifications.patch` — two-commit patch from `8a6793b..78d1dfb`.

## Source commits

- `c1f4673` — `feat(notifications): add Web Push PWA notifications`
- `78d1dfb` — `fix(notifications): tighten Web Push delivery scope`
- Merge commit on `main`: `b68d6e0` from PR #2.

## Apply

From a future branch based on a compatible ZaloCRM baseline:

```bash
git apply --check docs/superpowers/patches/2026-05-22-web-pwa-notifications.patch
git am docs/superpowers/patches/2026-05-22-web-pwa-notifications.patch
```

If `git am` conflicts because the target branch changed nearby files, abort and use a three-way apply:

```bash
git am --abort
git apply --3way docs/superpowers/patches/2026-05-22-web-pwa-notifications.patch
```

## Required environment

Set VAPID keys wherever the backend runs:

```dotenv
VAPID_PUBLIC=
VAPID_PRIVATE=
VAPID_SUBJECT=mailto:admin@zalocrm.local
```

Production already uses `VAPID_PUBLIC` and `VAPID_PRIVATE` in the production root `.env`.

## Verification after applying

Run the strongest available validation for the target branch:

```bash
npm --prefix backend run build
npm --prefix backend exec vitest run tests/web-push-service.test.ts tests/notification-push-routes.test.ts tests/system-notification-push-job.test.ts
npm --prefix frontend run build
npm --prefix frontend exec node tests/web-push-static.test.mjs
docker compose build app
```

For a local Docker smoke, verify the authenticated endpoint returns enabled Web Push config:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3080/api/v1/notifications/push/config
```

Expected shape:

```json
{"enabled":true,"publicKey":"<VAPID_PUBLIC>"}
```

## Notes

- `.claude` and `.codex` local artifacts are intentionally excluded.
- The patch includes the Prisma migration `20260522073000_add_web_push_subscriptions`.
- Chat pushes are filtered to active users with account access; system pushes are filtered to active org users and use generic preview text.
