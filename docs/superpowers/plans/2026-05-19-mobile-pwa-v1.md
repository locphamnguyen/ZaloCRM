# Mobile PWA v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable mobile PWA for ZaloCRM with Docker-validated app shell caching, recent-route offline reopening, Vietnamese offline fallback, and queued simple text chat messages.

**Architecture:** Use `vite-plugin-pwa` in `generateSW` mode to register and build the service worker from the existing Vue/Vuetify frontend. Keep authenticated CRM API data out of explicit service-worker caching; only cache static app shell assets and use navigation fallback behavior. Reuse and harden the existing offline queue composable for simple text messages, then surface pending state in the mobile chat UI.

**Tech Stack:** Vue 3, Vite 8, Vuetify 4, TypeScript, vite-plugin-pwa, Workbox generated service worker, Docker Compose.

---

## File map

- Modify `frontend/vite.config.ts` — add `VitePWA` plugin, manifest metadata, app-shell precache, navigation fallback, and cache rules that exclude `/api` and `/socket.io`.
- Create `frontend/src/pwa/register-service-worker.ts` — register the generated service worker and expose simple update/error logging.
- Modify `frontend/src/main.ts` — import the service-worker registration module once at app startup.
- Create `frontend/src/views/OfflineFallbackView.vue` — Vietnamese offline fallback page with retry behavior.
- Modify `frontend/src/router/index.ts` — add `/offline` route using `OfflineFallbackView`.
- Modify `frontend/src/components/OfflineIndicator.vue` — show offline message and pending chat count.
- Modify `frontend/src/composables/use-offline-queue.ts` — add metadata needed for pending visibility and safe flush behavior.
- Modify `frontend/src/views/MobileChatView.vue` — queue text messages offline, merge pending messages into the selected conversation, and flush on reconnect.
- Modify `frontend/src/components/chat/MessageThread.vue` — render `_pending` messages with a visible pending label.
- Modify `frontend/src/composables/use-chat.ts` — keep send behavior online-only and compatible with queued flush.
- Validate with Docker using `docker compose -f docker-compose.dev.yml up --build` and browser offline simulation.

---

### Task 1: Add PWA build configuration

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Replace `frontend/vite.config.ts` with PWA-enabled config**

Use this complete file content:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/zalocrm-logo.png'],
      manifest: {
        name: 'ZaloCRM',
        short_name: 'ZaloCRM',
        description: 'Quản lý nhiều tài khoản Zalo cá nhân',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#070A12',
        theme_color: '#D6A84F',
        icons: [
          {
            src: '/brand/zalocrm-logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/brand/zalocrm-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Chat',
            short_name: 'Chat',
            description: 'Mở tin nhắn',
            url: '/chat',
            icons: [{ src: '/brand/zalocrm-logo.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Khách hàng',
            short_name: 'Khách hàng',
            description: 'Mở danh sách khách hàng',
            url: '/contacts',
            icons: [{ src: '/brand/zalocrm-logo.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'zalocrm-pages',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ request }) => ['style', 'script', 'worker', 'font', 'image'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'zalocrm-assets',
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS. The build output should include generated PWA/service-worker assets such as `sw.js` or Workbox files in `frontend/dist`.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "feat(pwa): add mobile app shell caching"
```

---

### Task 2: Register the service worker at app startup

**Files:**
- Create: `frontend/src/pwa/register-service-worker.ts`
- Modify: `frontend/src/main.ts`

- [ ] **Step 1: Create `frontend/src/pwa/register-service-worker.ts`**

```ts
import { registerSW } from 'virtual:pwa-register';

export const updateServiceWorker = registerSW({
  immediate: true,
  onRegistered(registration) {
    if (!registration) return;
    setInterval(() => {
      void registration.update();
    }, 60 * 60 * 1000);
  },
  onRegisterError(error) {
    console.error('[pwa] service worker registration failed:', error);
  },
});
```

- [ ] **Step 2: Add the virtual module type if TypeScript needs it**

If `npm run build` reports `Cannot find module 'virtual:pwa-register'`, create or update `frontend/src/vite-env.d.ts` with:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 3: Import registration in `frontend/src/main.ts`**

Add this import near the top of `frontend/src/main.ts`:

```ts
import '@/pwa/register-service-worker';
```

Do not call it inside a component; importing the module once is enough.

- [ ] **Step 4: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.ts frontend/src/pwa/register-service-worker.ts frontend/src/vite-env.d.ts
git commit -m "feat(pwa): register service worker"
```

---

### Task 3: Add Vietnamese offline fallback route

**Files:**
- Create: `frontend/src/views/OfflineFallbackView.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: Create `frontend/src/views/OfflineFallbackView.vue`**

```vue
<template>
  <div class="offline-fallback">
    <v-card class="offline-card" elevation="0" rounded="xl">
      <v-icon class="offline-icon" size="40">mdi-wifi-off</v-icon>
      <h1>Không có kết nối</h1>
      <p>
        ZaloCRM đang chạy ở chế độ offline. Hãy kiểm tra mạng rồi thử lại.
      </p>
      <v-btn color="primary" rounded="lg" @click="retry">
        Thử lại
      </v-btn>
    </v-card>
  </div>
</template>

<script setup lang="ts">
function retry() {
  window.location.reload();
}
</script>

<style scoped>
.offline-fallback {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at top, rgba(214, 168, 79, 0.18), transparent 34rem),
    #070a12;
  color: #f8fafc;
}

.offline-card {
  width: min(100%, 420px);
  padding: 28px;
  text-align: center;
  background: rgba(16, 21, 34, 0.92);
  border: 1px solid rgba(214, 168, 79, 0.22);
}

.offline-icon {
  color: #d6a84f;
  margin-bottom: 12px;
}

h1 {
  font-size: 1.5rem;
  margin: 0 0 8px;
}

p {
  color: #cbd5e1;
  margin: 0 0 20px;
  line-height: 1.6;
}
</style>
```

- [ ] **Step 2: Add route in `frontend/src/router/index.ts`**

Find the routes array and add this route object before any catch-all route:

```ts
{
  path: '/offline',
  name: 'offline',
  component: () => import('@/views/OfflineFallbackView.vue'),
  meta: { layout: 'auth' },
},
```

- [ ] **Step 3: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/OfflineFallbackView.vue frontend/src/router/index.ts
git commit -m "feat(pwa): add offline fallback screen"
```

---

### Task 4: Harden offline queue composable

**Files:**
- Modify: `frontend/src/composables/use-offline-queue.ts`

- [ ] **Step 1: Replace queue type and helpers**

Use this complete file content:

```ts
import { ref, computed, watch } from 'vue';

export interface PendingMessage {
  id: string;
  conversationId: string;
  content: string;
  createdAt: string;
  status: 'pending' | 'sending' | 'failed';
}

const STORAGE_KEY = 'zalocrm-offline-queue';

function isValidMessage(item: unknown): item is PendingMessage {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.id === 'string'
    && typeof obj.conversationId === 'string'
    && typeof obj.content === 'string'
    && typeof obj.createdAt === 'string'
    && (obj.status === 'pending' || obj.status === 'sending' || obj.status === 'failed');
}

function normalizeMessage(item: unknown): PendingMessage | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  if (
    typeof obj.id !== 'string'
    || typeof obj.conversationId !== 'string'
    || typeof obj.content !== 'string'
    || typeof obj.createdAt !== 'string'
  ) {
    return null;
  }
  const status = obj.status === 'failed' ? 'failed' : 'pending';
  return {
    id: obj.id,
    conversationId: obj.conversationId,
    content: obj.content,
    createdAt: obj.createdAt,
    status,
  };
}

function loadQueue(): PendingMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeMessage).filter(isValidMessage);
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingMessage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

const pendingMessages = ref<PendingMessage[]>(loadQueue());
let flushing = false;

watch(pendingMessages, (val) => saveQueue(val), { deep: true });

export function useOfflineQueue() {
  function enqueue(conversationId: string, content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    pendingMessages.value.push({
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      conversationId,
      content: trimmed,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
  }

  async function flush(sendFn: (conversationId: string, content: string) => Promise<void>) {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      const queue = [...pendingMessages.value].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      for (const msg of queue) {
        pendingMessages.value = pendingMessages.value.map(item => (
          item.id === msg.id ? { ...item, status: 'sending' } : item
        ));
        try {
          await sendFn(msg.conversationId, msg.content);
          pendingMessages.value = pendingMessages.value.filter(item => item.id !== msg.id);
        } catch {
          pendingMessages.value = pendingMessages.value.map(item => (
            item.id === msg.id ? { ...item, status: 'failed' } : item
          ));
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  const pendingCount = computed(() => pendingMessages.value.length);
  const failedCount = computed(() => pendingMessages.value.filter(msg => msg.status === 'failed').length);

  return { pendingMessages, pendingCount, failedCount, enqueue, flush };
}
```

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/composables/use-offline-queue.ts
git commit -m "feat(chat): harden offline text message queue"
```

---

### Task 5: Surface pending queue in mobile offline indicator

**Files:**
- Modify: `frontend/src/components/OfflineIndicator.vue`

- [ ] **Step 1: Replace `OfflineIndicator.vue` content**

```vue
<template>
  <v-banner
    v-if="!isOnline || pendingCount > 0"
    :color="bannerColor"
    :icon="bannerIcon"
    lines="one"
    density="compact"
    class="offline-indicator"
  >
    <template #text>
      {{ bannerText }}
    </template>
  </v-banner>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMobile } from '@/composables/use-mobile';
import { useOfflineQueue } from '@/composables/use-offline-queue';

const { isOnline } = useMobile();
const { pendingCount, failedCount } = useOfflineQueue();

const bannerColor = computed(() => {
  if (!isOnline.value) return 'warning';
  if (failedCount.value > 0) return 'error';
  return 'info';
});

const bannerIcon = computed(() => {
  if (!isOnline.value) return 'mdi-wifi-off';
  if (failedCount.value > 0) return 'mdi-alert-circle-outline';
  return 'mdi-send-clock-outline';
});

const bannerText = computed(() => {
  if (!isOnline.value && pendingCount.value > 0) {
    return `Mất kết nối — ${pendingCount.value} tin nhắn sẽ tự gửi khi có mạng`;
  }
  if (!isOnline.value) return 'Mất kết nối — tin nhắn sẽ tự gửi khi có mạng';
  if (failedCount.value > 0) return `${failedCount.value} tin nhắn chưa gửi được — sẽ thử lại khi có mạng`;
  return `${pendingCount.value} tin nhắn đang chờ gửi`;
});
</script>

<style scoped>
.offline-indicator {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  padding-top: env(safe-area-inset-top);
}
</style>
```

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/OfflineIndicator.vue
git commit -m "feat(pwa): show offline queue status"
```

---

### Task 6: Show pending chat messages in mobile chat

**Files:**
- Modify: `frontend/src/views/MobileChatView.vue`

- [ ] **Step 1: Update pending-message merge to include status**

In `allMessages`, replace the `.map(p => ({ ... }))` block with:

```ts
.map(p => ({
  id: p.id,
  content: p.content,
  contentType: 'text',
  senderType: 'self',
  senderName: null,
  sentAt: p.createdAt,
  isDeleted: false,
  zaloMsgId: null,
  albumKey: null,
  albumIndex: null,
  albumTotal: null,
  _pending: true,
  _pendingStatus: p.status,
}));
```

- [ ] **Step 2: Keep offline sends text-only and queued**

Confirm `handleSend` has this behavior:

```ts
async function handleSend(content: string, replyMessageId?: string | null) {
  if (!selectedConvId.value) return;
  if (!navigator.onLine) {
    enqueue(selectedConvId.value, content);
    return;
  }
  await sendMessage(content, replyMessageId);
}
```

Do not queue attachments or other message types in this task.

- [ ] **Step 3: Flush immediately if app opens online with queued messages**

Inside `onMounted`, after `window.addEventListener('online', onOnline);`, add:

```ts
if (navigator.onLine) {
  void flush(sendMessageTo);
}
```

- [ ] **Step 4: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/MobileChatView.vue
git commit -m "feat(chat): display queued mobile messages"
```

---

### Task 7: Render pending state in `MessageThread`

**Files:**
- Modify: `frontend/src/composables/use-chat.ts`
- Modify: `frontend/src/components/chat/MessageThread.vue`

- [ ] **Step 1: Extend the `Message` interface**

In `frontend/src/composables/use-chat.ts`, add these optional fields to `export interface Message`:

```ts
  _pending?: boolean;
  _pendingStatus?: 'pending' | 'sending' | 'failed';
```

- [ ] **Step 2: Add pending helper in `MessageThread.vue` script**

Near other helper functions/computed values, add:

```ts
function pendingLabel(message: Message) {
  if (!message._pending) return '';
  if (message._pendingStatus === 'sending') return 'Đang gửi...';
  if (message._pendingStatus === 'failed') return 'Chưa gửi được';
  return 'Chờ gửi';
}
```

- [ ] **Step 3: Render pending label near message timestamp**

Find the existing message timestamp display in `MessageThread.vue`. Add this span next to the timestamp for normal message rows:

```vue
<span v-if="pendingLabel(message)" class="pending-label">
  {{ pendingLabel(message) }}
</span>
```

If the template uses an item wrapper instead of a direct `message` variable, use the variable representing the single message in that block.

- [ ] **Step 4: Add pending label styles**

Add to the scoped style section in `MessageThread.vue`:

```css
.pending-label {
  margin-left: 6px;
  color: #d6a84f;
  font-size: 0.72rem;
  font-weight: 600;
}
```

- [ ] **Step 5: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/composables/use-chat.ts frontend/src/components/chat/MessageThread.vue
git commit -m "feat(chat): mark queued messages as pending"
```

---

### Task 8: Docker PWA validation

**Files:**
- No source changes expected unless validation finds a bug.

- [ ] **Step 1: Build and start Docker dev stack**

Run:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Expected: services build and frontend is reachable through the Docker-served URL defined by the compose file.

- [ ] **Step 2: Validate manifest and service worker in Chrome**

Open the Docker-served app in Chrome.

Check DevTools → Application:

- Manifest loads.
- Service worker is registered and activated.
- Installability has no blocking manifest/service-worker errors.
- Theme color is dark/golden.

- [ ] **Step 3: Validate offline recent-page behavior**

In Chrome DevTools:

1. Visit `/`, `/chat`, and `/contacts` while online.
2. Switch Network to Offline.
3. Reload `/chat`.
4. Navigate to `/contacts` if possible.

Expected:

- App shell opens instead of browser network error.
- Previously visited route shell renders where cached.
- API-dependent content shows loading/offline/empty/retry state rather than crashing.

- [ ] **Step 4: Validate queued chat messages**

In mobile viewport or on a mobile device:

1. Open a conversation while online.
2. Switch Network to Offline.
3. Send a simple text message.
4. Confirm it appears in the thread with pending state.
5. Confirm `OfflineIndicator` shows offline and pending count text.
6. Switch Network back Online.

Expected:

- The queued message flushes.
- The pending entry disappears after successful send.
- If sending fails, the message remains queued with failed state.

- [ ] **Step 5: Validate production-like stack when feasible**

Run:

```bash
docker compose up -d --build
curl http://localhost:3080/health
```

Expected: health endpoint returns success. Repeat manifest/service-worker checks against `http://localhost:3080`.

- [ ] **Step 6: Commit any validation fixes**

If validation required source fixes, commit only those changed files:

```bash
git add frontend/vite.config.ts frontend/src
 git commit -m "fix(pwa): address docker validation issues"
```

---

## Self-review

Spec coverage:

- Installable PWA metadata and service worker setup: Task 1 and Task 2.
- App shell precaching and recent route reopening: Task 1 and Task 8.
- Vietnamese offline fallback: Task 3 and Task 8.
- Queued simple text messages: Task 4, Task 6, Task 7, and Task 8.
- Visible pending state: Task 5, Task 6, and Task 7.
- Docker-based validation: Task 8.
- No explicit authenticated API data caching: Task 1 denies `/api` navigation fallback and avoids API runtime caching.

Placeholder scan: no TBD/TODO placeholders. The only conditional step is the TypeScript virtual-module type addition, with exact file content if needed.

Type consistency: `PendingMessage.status`, `Message._pendingStatus`, and pending labels use the same `pending | sending | failed` union.
