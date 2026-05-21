# Mobile PWA v1 Design

## Goal

Make ZaloCRM work well as a mobile PWA by prioritizing installability, recent-page offline access, and queued text chat messages. This version improves mobile reliability without claiming that the whole CRM works offline.

## Scope

Mobile PWA v1 includes:

- Installable PWA metadata and service worker setup.
- App shell precaching for the Vue/Vuetify frontend.
- Recent frontend routes reopening offline via cached app shell where available.
- Vietnamese offline fallback for uncached navigation.
- Queued simple text chat messages while offline.
- Visible pending state for queued messages.
- Docker-based validation as the acceptance path.

Out of scope for v1:

- Explicit offline caching of CRM API/business data.
- Offline editing for contacts, notes, tags, appointments, reports, settings, or account configuration.
- Offline attachments, voice messages, stickers, reactions, or rich media sends.
- Conflict resolution for CRM mutations.
- Full mobile UI redesign beyond PWA/offline states needed by this work.

## PWA foundation

The frontend should become a practical installable PWA on top of the existing Vue/Vuetify app.

The implementation should upgrade the existing `frontend/public/manifest.json` and add a service worker setup through Vite PWA tooling or an equivalent first-party service worker implementation. The manifest should support mobile installability with standalone display, portrait orientation, dark/golden theme color, maskable icons, and useful shortcuts such as Chat and Contacts.

The service worker should precache the app shell: HTML entry, JS/CSS bundles, and brand/icon assets. This keeps the installed app launchable even when the network is unavailable.

Offline support in v1 is intentionally bounded. The app can open offline, recently visited frontend screens can reopen when cached, and simple text chat messages can queue. Other CRM writes remain online-only.

## Recent pages offline

Recent-page offline support should focus on frontend routes and static app assets, not business data persistence.

Expected behavior:

- Static bundles and brand assets are served from cache when possible.
- Navigation requests use a network-first strategy with fallback to cached app shell or the offline fallback.
- Previously visited frontend routes can reopen offline where the service worker has cached the app shell.
- Uncached navigations show a Vietnamese offline fallback instead of a browser error.
- API-dependent screen content should show clear offline, empty, or retry states rather than crashing.

The service worker should not explicitly cache authenticated CRM API responses in v1. This avoids stale customer/contact/conversation data being mistaken as current and avoids expanding the security surface around org-scoped data.

## Queued chat messages

Queued chat should build on the existing `frontend/src/composables/use-offline-queue.ts` concept.

Expected behavior:

- When the user sends a simple text chat message while offline, the message is saved locally as pending.
- The chat UI shows the queued message so the user can see it has not been delivered yet.
- The offline banner uses clear Vietnamese copy, such as `Mất kết nối — tin nhắn sẽ tự gửi khi có mạng`.
- When the app returns online, queued messages flush in creation order.
- If one queued message fails during flushing, flushing stops and leaves the failed and remaining messages queued.
- v1 queues only simple text chat messages.

Online-only actions in v1 include attachments, voice messages, stickers, reactions, rich media, CRM notes, tags, appointments, and contact edits.

## User-facing mobile PWA UX

The mobile PWA should feel like an installed app while staying consistent with the future dark/golden theme direction.

UX requirements:

- Preserve the existing mobile app bar and bottom navigation pattern.
- Ensure bottom navigation, floating actions, offline banner, and chat composer respect mobile safe areas.
- Use dark graphite surfaces, gold primary accents, high-contrast text, and restrained motion.
- Avoid heavy neon, glitch effects, and low-contrast gold body text.
- Provide a user-friendly offline fallback with Vietnamese copy and a retry action.
- Show pending queue visibility through the chat composer, message list, or offline banner.

## Testing and acceptance

Docker is the primary acceptance path.

Acceptance criteria:

- Docker stack builds and starts successfully.
- Frontend is served through the containerized app, not only Vite dev mode.
- PWA manifest is reachable from the served app.
- Service worker registers correctly from the Docker-served frontend.
- App can be installed from Chrome/Android when opened from the Docker URL.
- Offline simulation in browser devtools shows that the app shell still opens.
- Recently visited frontend routes reopen offline through the cached app shell where available.
- Uncached routes show the Vietnamese offline fallback.
- API-dependent sections show offline, empty, or retry states instead of crashing; their authenticated API data is not explicitly cached in v1.
- Sending a simple text chat message offline creates a visible pending message.
- Returning online flushes queued text messages in order.
- Failed flush leaves remaining messages queued.
- Mobile viewport checks pass for bottom nav, safe-area padding, offline banner, and chat composer.

Primary validation commands:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Production-like validation when feasible:

```bash
docker compose up -d --build
curl http://localhost:3080/health
```

A frontend build can be used as a faster pre-check:

```bash
cd frontend && npm run build
```

## Implementation notes

Prefer the smallest implementation that satisfies the v1 scope. Avoid adding offline CRM data caching or broad mutation sync until the PWA foundation and chat queue behavior are proven reliable in Docker-served builds.
