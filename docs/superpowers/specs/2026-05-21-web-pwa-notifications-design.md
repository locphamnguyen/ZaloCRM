# Web and PWA Notifications Design

## Goal

Add first-class notifications for ZaloCRM web and installed PWA users so new chat messages and existing system notifications can alert users both while the app is open and when the browser/PWA is in the background or closed.

## Approved product choices

- Message notifications should work everywhere: foreground web app, background tabs, and installed PWA where the browser/OS supports Web Push.
- System notifications should include all existing computed notifications from `GET /api/v1/notifications`: unreplied conversations, today/tomorrow appointments, and disconnected Zalo accounts.
- Notification permission must be requested from an explicit user action, not automatically on login.
- The implementation should include full Web Push support.
- Production already has Firebase Cloud Messaging config in `fmc.json` at the production root and VAPID keys in the production `.env` as `VAPID_PUBLIC` and `VAPID_PRIVATE`.

## Architecture

The implementation adds a backend Web Push subscription layer, a service worker push handler, and foreground notification orchestration in the Vue app.

Backend subscription state is stored per organization and user. The backend exposes authenticated routes for clients to fetch push configuration, subscribe, unsubscribe, and send a local test notification. Incoming Zalo messages and computed system notifications produce normalized notification payloads. Push delivery is best-effort: failures are logged, expired subscriptions are removed, and missing VAPID configuration disables push without breaking the app.

Foreground behavior remains app-native. If the app is open, Vue shows a toast and refreshes the notification bell/unread state. If the app is backgrounded or closed, the service worker displays the browser/PWA notification from Web Push and routes clicks back into the app.

## Backend components

### Prisma data model

Add `WebPushSubscription` with:

- `id`
- `orgId`
- `userId`
- `endpoint` unique
- `p256dh`
- `auth`
- `userAgent`
- `createdAt`
- `updatedAt`

The model is scoped to `Organization` and `User` with cascading cleanup. No notification table is introduced in this phase because existing system notifications are computed on demand.

### Notification routes

Add routes under the existing notifications module:

- `GET /api/v1/notifications/push/config` returns whether push is enabled and the VAPID public key if configured.
- `POST /api/v1/notifications/push/subscriptions` stores or updates the current browser subscription for the authenticated user and organization.
- `DELETE /api/v1/notifications/push/subscriptions` deletes the current endpoint for the authenticated user.
- `POST /api/v1/notifications/push/test` sends a test notification to the authenticated user’s subscriptions.

All routes require JWT auth and preserve organization scoping from the current user context.

### Push service

Create a small service responsible for:

- reading `VAPID_PUBLIC`, `VAPID_PRIVATE`, and optional contact subject from env;
- converting database rows into Web Push subscription objects;
- sending JSON payloads with title, body, url, tag, type, priority, and createdAt;
- deleting subscriptions when the push provider returns gone/expired status;
- returning no-op results when VAPID is missing.

### Chat message push trigger

Incoming live Zalo messages already emit `chat:message`. After the message is persisted, backend should send push for non-self messages to users in the same organization. Payload click target should open `/chat?conversationId=<id>` or `/chat` if the route cannot safely accept the query yet.

Outgoing messages created by the current CRM user must not generate push back to that user.

### System notification push trigger

The existing `/notifications` route computes system notifications. Extract that computation into a reusable function so both the route and a lightweight scheduler can use the same logic.

The scheduler periodically checks each organization with active push subscriptions and sends push for current high-level system notifications. It deduplicates by a stable key made from notification id, user id, and a short time bucket so the same appointment/account warning does not spam users every minute.

## Frontend/PWA components

### Service worker

Use a custom PWA service worker strategy compatible with `vite-plugin-pwa` so the app can keep current precache/offline behavior and add:

- `push` event: parse JSON payload and call `showNotification`;
- `notificationclick` event: close the notification and focus an existing app window or open the payload URL;
- safe fallbacks for malformed payloads.

### Push composable

Add a Vue composable for browser push state:

- detect service worker, Push API, and Notification API support;
- fetch backend push config;
- expose status: unsupported, unavailable, default, denied, subscribed, unsubscribed;
- request permission only when the user clicks the explicit enable button;
- subscribe with the VAPID public key;
- send subscription to backend;
- unsubscribe locally and server-side;
- send a test notification.

### Notification bell integration

Extend `NotificationBell` with a compact push control area:

- show “Bật thông báo” when supported and not subscribed;
- show “Đã bật thông báo” when subscribed;
- show “Thông báo bị chặn” when browser permission is denied;
- show “Chưa cấu hình Web Push” when backend VAPID config is missing;
- keep existing notification list and routes intact.

### Foreground notifications

Add a global foreground notification listener mounted in the authenticated layout. It should:

- listen for incoming chat events outside the chat view;
- show toast notifications for non-self messages;
- avoid duplicate toasts when the user is actively viewing the same conversation;
- refresh notification bell state after a notification event.

## Configuration

Required production env names are:

- `VAPID_PUBLIC`
- `VAPID_PRIVATE`

Optional env:

- `VAPID_SUBJECT`, defaulting to a safe `mailto:` or app URL value.

If `fmc.json` exists, this implementation does not require reading it directly unless the selected Web Push library or Firebase integration needs it. The first implementation should use standard Web Push with the provided VAPID keys because it works for browser and PWA notifications without coupling the app to Firebase-specific client SDKs.

## Error handling

- If VAPID is missing, push routes return enabled false and the UI explains that Web Push is not configured.
- If browser permission is denied, the UI shows the blocked state and does not repeatedly prompt.
- If a subscription expires or is rejected by the push service, backend deletes it and logs the cleanup.
- Push delivery failures must not block chat message persistence, socket broadcasts, or notification route responses.

## Testing and validation

Backend tests should cover:

- push config response with and without VAPID env;
- subscription upsert and delete scoped to user/org;
- payload creation for test notifications;
- no-op behavior when push is not configured;
- expired subscription cleanup.

Frontend validation should cover:

- TypeScript build;
- service worker generated with push/click handlers;
- NotificationBell states for unsupported, unavailable, denied, and subscribed paths where practical;
- PWA manifest/offline behavior still builds.

Docker validation should cover:

- production-like compose build;
- app health endpoint;
- backend route smoke for push config;
- browser smoke that loads the app, sees the notification enable control, and verifies no console/runtime crash.

## Out of scope

- Native mobile push outside browser/PWA Web Push.
- Persisted notification inbox with read/unread state.
- Per-user notification preferences by type.
- Firebase SDK-specific topic messaging unless later required by deployment constraints.
