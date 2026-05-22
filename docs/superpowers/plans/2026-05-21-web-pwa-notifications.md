# Web PWA Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push notifications for ZaloCRM web and installed PWA users, covering new chat messages and existing computed system notifications.

**Architecture:** Store browser push subscriptions per user and organization, expose authenticated push subscription routes, send best-effort Web Push payloads from chat/system notification sources, and add a custom service worker plus Vue composable/UI for explicit permission enablement. Foreground app sessions use toasts and existing bell state; background/closed PWA sessions use service worker notifications.

**Tech Stack:** Fastify 5, Prisma 7, PostgreSQL, `web-push`, Vue 3, Vite, `vite-plugin-pwa`, Workbox injectManifest, Vuetify, Vitest, Docker Compose.

---

## File Structure

- Modify `backend/package.json` and lockfile: add `web-push` and `@types/web-push` if package types require it.
- Modify `backend/prisma/schema.prisma`: add `WebPushSubscription` relation arrays and model.
- Create `backend/src/modules/notifications/notification-service.ts`: reusable computed notification function and URL mapping.
- Create `backend/src/modules/notifications/web-push-service.ts`: VAPID config, payload types, send/upsert/delete helpers, expired cleanup.
- Modify `backend/src/modules/notifications/notification-routes.ts`: use shared computation and add push config/subscription/test routes.
- Modify incoming message path in `backend/src/modules/zalo/zalo-listener-factory.ts`: send push after non-self incoming messages persist.
- Create `backend/src/modules/notifications/system-notification-push-job.ts`: periodic deduped push for computed system notifications.
- Modify `backend/src/app.ts`: start system notification push job.
- Modify `backend/src/config/index.ts` and `backend/.env.example`: document `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT`.
- Create backend tests under `backend/tests/notification-push-routes.test.ts` and `backend/tests/web-push-service.test.ts`.
- Modify `frontend/vite.config.ts`: switch PWA config to injectManifest while preserving current manifest/runtime caching behavior.
- Create `frontend/src/pwa/sw.ts`: custom service worker with precache, runtime fallback, `push`, and `notificationclick` handlers.
- Modify `frontend/src/pwa/register-service-worker.ts`: keep current registration/update behavior and expose service worker readiness only via `navigator.serviceWorker.ready` in composable.
- Create `frontend/src/composables/use-web-push.ts`: browser support detection, permission request, subscribe, unsubscribe, test notification.
- Modify `frontend/src/components/NotificationBell.vue`: add push controls and rename local notification type to avoid browser global shadowing.
- Modify `frontend/src/layouts/MobileLayout.vue`: mount `ToastContainer` so mobile push actions can show feedback.
- Create `frontend/tests/web-push-static.test.mjs`: static assertions for PWA service worker and UI integration.

---

## Task 1: Dependencies and Prisma Schema

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/prisma/schema.prisma:10-87`

- [ ] **Step 1: Install Web Push dependency**

Run:

```bash
npm --prefix backend install web-push @types/web-push
```

Expected: `backend/package.json` and `backend/package-lock.json` include `web-push` and `@types/web-push`.

- [ ] **Step 2: Add Prisma relations and model**

In `backend/prisma/schema.prisma`, add `webPushSubscriptions WebPushSubscription[]` to `Organization` near the other relation arrays:

```prisma
  webPushSubscriptions WebPushSubscription[]
```

Add the same relation array to `User` near `preferences`:

```prisma
  webPushSubscriptions     WebPushSubscription[]
```

Add this model near `UserPreference`:

```prisma
model WebPushSubscription {
  id        String   @id @default(uuid())
  orgId     String   @map("org_id")
  userId    String   @map("user_id")
  endpoint  String   @unique
  p256dh    String
  auth      String
  userAgent String?  @map("user_agent")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([userId])
  @@index([orgId, userId])
  @@map("web_push_subscriptions")
}
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
npm --prefix backend exec prisma generate
```

Expected: command exits 0 and generated client includes `webPushSubscription`.

- [ ] **Step 4: Commit dependency and schema work**

```bash
git add backend/package.json backend/package-lock.json backend/prisma/schema.prisma
git commit -m "feat(notifications): add web push subscription schema"
```

---

## Task 2: Backend Notification Computation Service

**Files:**
- Create: `backend/src/modules/notifications/notification-service.ts`
- Modify: `backend/src/modules/notifications/notification-routes.ts`

- [ ] **Step 1: Write failing service route behavior test**

Create `backend/tests/notification-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const conversationCount = vi.fn();
const appointmentFindMany = vi.fn();
const appointmentCount = vi.fn();
const zaloAccountFindMany = vi.fn();
const getStatus = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    conversation: { count: conversationCount },
    appointment: { findMany: appointmentFindMany, count: appointmentCount },
    zaloAccount: { findMany: zaloAccountFindMany },
  },
}));

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getStatus },
}));

describe('notification-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationCount.mockResolvedValue(1);
    appointmentFindMany.mockResolvedValue([
      {
        id: 'apt-1',
        appointmentDate: new Date('2026-05-21T03:00:00.000Z'),
        appointmentTime: '10:00',
        notes: 'Tái khám',
        contact: { fullName: 'Nguyễn Văn A' },
      },
    ]);
    appointmentCount.mockResolvedValue(2);
    zaloAccountFindMany.mockResolvedValue([{ id: 'za-1', displayName: 'Shop A' }]);
    getStatus.mockReturnValue('disconnected');
  });

  it('computes current organization notifications and click urls', async () => {
    const { getCurrentNotifications } = await import('../src/modules/notifications/notification-service.js');

    const notifications = await getCurrentNotifications('org-1');

    expect(notifications.map((item) => item.id)).toEqual(['unreplied', 'apt-apt-1', 'tmr-apts', 'zalo-za-1']);
    expect(notifications[0]).toMatchObject({ url: '/chat', priority: 'high' });
    expect(notifications[1]).toMatchObject({ url: '/appointments', title: 'Lịch hẹn: Nguyễn Văn A' });
    expect(notifications[3]).toMatchObject({ url: '/zalo-accounts', type: 'error' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix backend exec vitest run tests/notification-service.test.ts
```

Expected: FAIL because `notification-service.js` does not exist.

- [ ] **Step 3: Create shared notification service**

Create `backend/src/modules/notifications/notification-service.ts`:

```ts
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from '../zalo/zalo-pool.js';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: 'low' | 'medium' | 'high' | string;
  createdAt: string;
  url: string;
}

export function getNotificationUrl(id: string): string {
  if (id === 'unreplied') return '/chat';
  if (id.startsWith('apt-')) return '/appointments';
  if (id === 'tmr-apts') return '/appointments';
  if (id.startsWith('zalo-')) return '/zalo-accounts';
  return '/';
}

export async function getCurrentNotifications(orgId: string): Promise<NotificationItem[]> {
  const notifications: NotificationItem[] = [];
  const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
  const unreplied = await prisma.conversation.count({
    where: { orgId, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
  });

  if (unreplied > 0) {
    notifications.push({
      id: 'unreplied',
      type: 'warning',
      priority: 'high',
      title: `${unreplied} cuộc trò chuyện chưa trả lời`,
      detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
      createdAt: new Date().toISOString(),
      url: getNotificationUrl('unreplied'),
    });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todayApts = await prisma.appointment.findMany({
    where: { orgId, appointmentDate: { gte: todayStart, lt: todayEnd }, status: 'scheduled' },
    include: { contact: { select: { fullName: true } } },
    take: 5,
  });

  for (const apt of todayApts) {
    const id = `apt-${apt.id}`;
    notifications.push({
      id,
      type: 'info',
      priority: 'medium',
      title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
      detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
      createdAt: apt.appointmentDate.toISOString(),
      url: getNotificationUrl(id),
    });
  }

  const tomorrowStart = new Date(todayEnd);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  const tmrApts = await prisma.appointment.count({
    where: { orgId, appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd }, status: 'scheduled' },
  });

  if (tmrApts > 0) {
    notifications.push({
      id: 'tmr-apts',
      type: 'info',
      priority: 'low',
      title: `${tmrApts} lịch hẹn ngày mai`,
      detail: 'Chuẩn bị cho ngày mai',
      createdAt: new Date().toISOString(),
      url: getNotificationUrl('tmr-apts'),
    });
  }

  const accounts = await prisma.zaloAccount.findMany({
    where: { orgId },
    select: { id: true, displayName: true },
  });

  for (const acc of accounts) {
    const status = zaloPool.getStatus(acc.id);
    if (status !== 'connected') {
      const id = `zalo-${acc.id}`;
      notifications.push({
        id,
        type: 'error',
        priority: 'high',
        title: `Zalo "${acc.displayName}" mất kết nối`,
        detail: `Trạng thái: ${status}`,
        createdAt: new Date().toISOString(),
        url: getNotificationUrl(id),
      });
    }
  }

  return notifications;
}
```

- [ ] **Step 4: Refactor route to use service**

Replace `backend/src/modules/notifications/notification-routes.ts` with:

```ts
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { getCurrentNotifications } from './notification-service.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications = await getCurrentNotifications(user.orgId);
    return { notifications };
  });
}
```

- [ ] **Step 5: Verify service test passes**

Run:

```bash
npm --prefix backend exec vitest run tests/notification-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared computation**

```bash
git add backend/src/modules/notifications/notification-service.ts backend/src/modules/notifications/notification-routes.ts backend/tests/notification-service.test.ts
git commit -m "refactor(notifications): share computed notification service"
```

---

## Task 3: Web Push Backend Service and Routes

**Files:**
- Create: `backend/src/modules/notifications/web-push-service.ts`
- Modify: `backend/src/modules/notifications/notification-routes.ts`
- Modify: `backend/src/config/index.ts`
- Modify: `backend/.env.example`
- Create: `backend/tests/web-push-service.test.ts`
- Create: `backend/tests/notification-push-routes.test.ts`

- [ ] **Step 1: Write Web Push service tests**

Create `backend/tests/web-push-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
const deleteMany = vi.fn();

vi.mock('web-push', () => ({
  default: { sendNotification, setVapidDetails },
  sendNotification,
  setVapidDetails,
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { webPushSubscription: { deleteMany } },
}));

describe('web-push-service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.VAPID_PUBLIC;
    delete process.env.VAPID_PRIVATE;
    delete process.env.VAPID_SUBJECT;
  });

  it('reports disabled config when VAPID keys are missing', async () => {
    const { getWebPushConfig } = await import('../src/modules/notifications/web-push-service.js');

    expect(getWebPushConfig()).toEqual({ enabled: false, publicKey: '' });
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it('sends payload and deletes expired subscriptions', async () => {
    process.env.VAPID_PUBLIC = 'public-key';
    process.env.VAPID_PRIVATE = 'private-key';
    process.env.VAPID_SUBJECT = 'mailto:admin@example.com';
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    const { sendPushToSubscriptions } = await import('../src/modules/notifications/web-push-service.js');

    const result = await sendPushToSubscriptions([
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p256dh', auth: 'auth' },
    ], {
      title: 'Tin nhắn mới',
      body: 'Khách hàng gửi tin nhắn',
      url: '/chat',
      tag: 'chat-conv-1',
      type: 'chat',
      priority: 'high',
      createdAt: '2026-05-21T00:00:00.000Z',
    });

    expect(setVapidDetails).toHaveBeenCalledWith('mailto:admin@example.com', 'public-key', 'private-key');
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sub-1'] } } });
    expect(result).toEqual({ attempted: 1, sent: 0, expired: 1, failed: 0, enabled: true });
  });
});
```

- [ ] **Step 2: Run service test to verify it fails**

```bash
npm --prefix backend exec vitest run tests/web-push-service.test.ts
```

Expected: FAIL because service file does not exist.

- [ ] **Step 3: Create Web Push service**

Create `backend/src/modules/notifications/web-push-service.ts`:

```ts
import webPush from 'web-push';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/logger.js';

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  type: string;
  priority: string;
  createdAt: string;
}

export interface WebPushSendResult {
  attempted: number;
  sent: number;
  expired: number;
  failed: number;
  enabled: boolean;
}

let configuredFor = '';

export function getWebPushConfig() {
  const publicKey = process.env.VAPID_PUBLIC || '';
  const privateKey = process.env.VAPID_PRIVATE || '';
  return { enabled: Boolean(publicKey && privateKey), publicKey };
}

function ensureVapidConfigured(): boolean {
  const { enabled, publicKey } = getWebPushConfig();
  const privateKey = process.env.VAPID_PRIVATE || '';
  if (!enabled) return false;

  const subject = process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:admin@zalocrm.local';
  const key = `${subject}:${publicKey}:${privateKey}`;
  if (configuredFor !== key) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    configuredFor = key;
  }
  return true;
}

export async function sendPushToSubscriptions(
  subscriptions: StoredPushSubscription[],
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  if (!ensureVapidConfigured()) {
    return { attempted: subscriptions.length, sent: 0, expired: 0, failed: 0, enabled: false };
  }

  const expiredIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        expiredIds.push(subscription.id);
        return;
      }
      failed += 1;
      logger.warn({ err: error, endpoint: subscription.endpoint }, 'web push delivery failed');
    }
  }));

  if (expiredIds.length > 0) {
    await prisma.webPushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
  }

  return { attempted: subscriptions.length, sent, expired: expiredIds.length, failed, enabled: true };
}

export async function sendPushToUser(userId: string, orgId: string, payload: WebPushPayload) {
  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { userId, orgId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return sendPushToSubscriptions(subscriptions, payload);
}

export async function sendPushToOrg(orgId: string, payload: WebPushPayload) {
  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { orgId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  return sendPushToSubscriptions(subscriptions, payload);
}
```

- [ ] **Step 4: Add config documentation**

In `backend/src/config/index.ts`, add a `webPush` section inside `config`:

```ts
  webPush: {
    publicKey: process.env.VAPID_PUBLIC || '',
    privateKey: process.env.VAPID_PRIVATE || '',
    subject: process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:admin@zalocrm.local',
  },
```

In `backend/.env.example`, add:

```dotenv
# Web Push / PWA notifications
VAPID_PUBLIC=
VAPID_PRIVATE=
VAPID_SUBJECT=mailto:admin@zalocrm.local
```

- [ ] **Step 5: Write push route tests**

Create `backend/tests/notification-push-routes.test.ts`:

```ts
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockUser } from './test-helpers.js';

const upsert = vi.fn();
const deleteMany = vi.fn();
const findMany = vi.fn();
const sendPushToSubscriptions = vi.fn();

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (request: any) => {
    request.user = mockUser({ id: 'user-1', orgId: 'org-1' });
  },
}));

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    webPushSubscription: { upsert, deleteMany, findMany },
  },
}));

vi.mock('../src/modules/notifications/notification-service.js', () => ({
  getCurrentNotifications: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/modules/notifications/web-push-service.js', () => ({
  getWebPushConfig: () => ({ enabled: true, publicKey: 'public-key' }),
  sendPushToSubscriptions,
}));

describe('notification push routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsert.mockResolvedValue({ id: 'sub-1' });
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p256dh', auth: 'auth' }]);
    sendPushToSubscriptions.mockResolvedValue({ attempted: 1, sent: 1, expired: 0, failed: 0, enabled: true });
  });

  async function buildApp() {
    const { notificationRoutes } = await import('../src/modules/notifications/notification-routes.js');
    const app = Fastify({ logger: false });
    await app.register(notificationRoutes);
    return app;
  }

  it('returns push config', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications/push/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, publicKey: 'public-key' });
  });

  it('upserts the authenticated user subscription', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/push/subscriptions',
      payload: {
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
      headers: { 'user-agent': 'vitest' },
    });

    expect(res.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/1' },
      update: { orgId: 'org-1', userId: 'user-1', p256dh: 'p256dh', auth: 'auth', userAgent: 'vitest' },
      create: { orgId: 'org-1', userId: 'user-1', endpoint: 'https://push.example/1', p256dh: 'p256dh', auth: 'auth', userAgent: 'vitest' },
    });
    expect(res.json()).toEqual({ ok: true });
  });

  it('deletes the authenticated user subscription endpoint', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/notifications/push/subscriptions',
      payload: { endpoint: 'https://push.example/1' },
    });

    expect(res.statusCode).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', orgId: 'org-1', endpoint: 'https://push.example/1' } });
    expect(res.json()).toEqual({ ok: true });
  });

  it('sends a test notification to the authenticated user', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/push/test' });

    expect(res.statusCode).toBe(200);
    expect(sendPushToSubscriptions).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ title: 'ZaloCRM thông báo thử', url: '/' }));
    expect(res.json()).toEqual({ ok: true, result: { attempted: 1, sent: 1, expired: 0, failed: 0, enabled: true } });
  });
});
```

- [ ] **Step 6: Run route test to verify it fails**

```bash
npm --prefix backend exec vitest run tests/notification-push-routes.test.ts
```

Expected: FAIL because routes are not implemented.

- [ ] **Step 7: Add push routes**

Update `backend/src/modules/notifications/notification-routes.ts` to include:

```ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { getCurrentNotifications } from './notification-service.js';
import { getWebPushConfig, sendPushToSubscriptions } from './web-push-service.js';

interface PushSubscriptionBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

interface DeleteSubscriptionBody {
  endpoint?: string;
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications = await getCurrentNotifications(user.orgId);
    return { notifications };
  });

  app.get('/api/v1/notifications/push/config', async () => getWebPushConfig());

  app.post<{ Body: PushSubscriptionBody }>('/api/v1/notifications/push/subscriptions', async (request, reply) => {
    const user = request.user!;
    const { endpoint, keys } = request.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Subscription không hợp lệ' });
    }

    const userAgent = request.headers['user-agent'];
    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      update: { orgId: user.orgId, userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
      create: { orgId: user.orgId, userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    });
    return { ok: true };
  });

  app.delete<{ Body: DeleteSubscriptionBody }>('/api/v1/notifications/push/subscriptions', async (request, reply) => {
    const user = request.user!;
    const endpoint = request.body?.endpoint;
    if (!endpoint) return reply.status(400).send({ error: 'Thiếu endpoint' });

    await prisma.webPushSubscription.deleteMany({ where: { userId: user.id, orgId: user.orgId, endpoint } });
    return { ok: true };
  });

  app.post('/api/v1/notifications/push/test', async (request) => {
    const user = request.user!;
    const subscriptions = await prisma.webPushSubscription.findMany({
      where: { userId: user.id, orgId: user.orgId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const result = await sendPushToSubscriptions(subscriptions, {
      title: 'ZaloCRM thông báo thử',
      body: 'Thông báo Web Push đã sẵn sàng.',
      url: '/',
      tag: `test-${user.id}`,
      type: 'test',
      priority: 'low',
      createdAt: new Date().toISOString(),
    });
    return { ok: true, result };
  });
}
```

- [ ] **Step 8: Verify push service and route tests pass**

```bash
npm --prefix backend exec vitest run tests/web-push-service.test.ts tests/notification-push-routes.test.ts tests/notification-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit backend push service and routes**

```bash
git add backend/src/modules/notifications backend/src/config/index.ts backend/.env.example backend/tests/web-push-service.test.ts backend/tests/notification-push-routes.test.ts
git commit -m "feat(notifications): add web push routes"
```

---

## Task 4: Chat and System Push Triggers

**Files:**
- Modify: `backend/src/modules/zalo/zalo-listener-factory.ts`
- Create: `backend/src/modules/notifications/system-notification-push-job.ts`
- Modify: `backend/src/app.ts`
- Create: `backend/tests/system-notification-push-job.test.ts`

- [ ] **Step 1: Locate persisted incoming message hook**

Run:

```bash
grep -n "chat:message\|senderType\|create" backend/src/modules/zalo/zalo-listener-factory.ts
```

Expected: find the branch that persists incoming live Zalo messages and emits `chat:message`.

- [ ] **Step 2: Add chat push after non-self message persistence**

In `backend/src/modules/zalo/zalo-listener-factory.ts`, import:

```ts
import { sendPushToOrg } from '../notifications/web-push-service.js';
```

After a non-self incoming message is persisted and before/after the existing socket emit, add:

```ts
if (message.senderType !== 'self') {
  void sendPushToOrg(conversation.orgId, {
    title: conversation.displayName || 'Tin nhắn mới',
    body: message.content || 'Bạn có tin nhắn mới trên ZaloCRM',
    url: `/chat?conversationId=${conversation.id}`,
    tag: `chat-${conversation.id}`,
    type: 'chat',
    priority: 'high',
    createdAt: message.createdAt.toISOString(),
  });
}
```

Adjust variable names to the exact persisted `message` and `conversation` identifiers found in Step 1. Keep the call best-effort with `void` so push failure cannot block message handling.

- [ ] **Step 3: Write system push job test**

Create `backend/tests/system-notification-push-job.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const getCurrentNotifications = vi.fn();
const sendPushToOrg = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: { organization: { findMany } },
}));

vi.mock('../src/modules/notifications/notification-service.js', () => ({ getCurrentNotifications }));
vi.mock('../src/modules/notifications/web-push-service.js', () => ({ sendPushToOrg }));

describe('system notification push job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([{ id: 'org-1' }]);
    getCurrentNotifications.mockResolvedValue([
      { id: 'unreplied', title: '1 cuộc trò chuyện chưa trả lời', detail: 'Có tin nhắn chưa phản hồi quá 30 phút', type: 'warning', priority: 'high', createdAt: '2026-05-21T00:00:00.000Z', url: '/chat' },
    ]);
    sendPushToOrg.mockResolvedValue({ enabled: true, attempted: 1, sent: 1, expired: 0, failed: 0 });
  });

  it('sends each current notification once per bucket', async () => {
    const { runSystemNotificationPushOnce } = await import('../src/modules/notifications/system-notification-push-job.js');

    await runSystemNotificationPushOnce(1234567890);
    await runSystemNotificationPushOnce(1234567890);

    expect(sendPushToOrg).toHaveBeenCalledTimes(1);
    expect(sendPushToOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ title: '1 cuộc trò chuyện chưa trả lời', tag: 'system-unreplied' }));
  });
});
```

- [ ] **Step 4: Run job test to verify it fails**

```bash
npm --prefix backend exec vitest run tests/system-notification-push-job.test.ts
```

Expected: FAIL because job file does not exist.

- [ ] **Step 5: Create system push job**

Create `backend/src/modules/notifications/system-notification-push-job.ts`:

```ts
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/logger.js';
import { getCurrentNotifications } from './notification-service.js';
import { sendPushToOrg } from './web-push-service.js';

const sentBuckets = new Set<string>();

function bucketFor(nowMs: number) {
  return Math.floor(nowMs / (30 * 60 * 1000));
}

export async function runSystemNotificationPushOnce(nowMs = Date.now()) {
  const bucket = bucketFor(nowMs);
  const orgs = await prisma.organization.findMany({
    where: { webPushSubscriptions: { some: {} } },
    select: { id: true },
  });

  for (const org of orgs) {
    const notifications = await getCurrentNotifications(org.id);
    for (const notification of notifications) {
      const dedupeKey = `${bucket}:${org.id}:${notification.id}`;
      if (sentBuckets.has(dedupeKey)) continue;
      sentBuckets.add(dedupeKey);
      await sendPushToOrg(org.id, {
        title: notification.title,
        body: notification.detail,
        url: notification.url,
        tag: `system-${notification.id}`,
        type: notification.type,
        priority: notification.priority,
        createdAt: notification.createdAt,
      });
    }
  }

  if (sentBuckets.size > 5000) sentBuckets.clear();
}

export function startSystemNotificationPushJob() {
  cron.schedule('*/5 * * * *', () => {
    runSystemNotificationPushOnce().catch((error) => {
      logger.warn({ err: error }, 'system notification push job failed');
    });
  });
}
```

- [ ] **Step 6: Register system push job**

In `backend/src/app.ts`, import:

```ts
import { startSystemNotificationPushJob } from './modules/notifications/system-notification-push-job.js';
```

After other background jobs start, add:

```ts
startSystemNotificationPushJob();
```

- [ ] **Step 7: Verify trigger tests and backend build**

```bash
npm --prefix backend exec vitest run tests/system-notification-push-job.test.ts tests/notification-service.test.ts tests/web-push-service.test.ts tests/notification-push-routes.test.ts
npm --prefix backend run build
```

Expected: tests and build PASS.

- [ ] **Step 8: Commit backend triggers**

```bash
git add backend/src/modules/zalo/zalo-listener-factory.ts backend/src/modules/notifications/system-notification-push-job.ts backend/src/app.ts backend/tests/system-notification-push-job.test.ts
git commit -m "feat(notifications): send push for chat and system alerts"
```

---

## Task 5: PWA Service Worker and Push Composable

**Files:**
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/pwa/sw.ts`
- Create: `frontend/src/composables/use-web-push.ts`
- Create: `frontend/tests/web-push-static.test.mjs`

- [ ] **Step 1: Write static frontend test**

Create `frontend/tests/web-push-static.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../src/pwa/sw.ts', import.meta.url), 'utf8');
const composable = readFileSync(new URL('../src/composables/use-web-push.ts', import.meta.url), 'utf8');

assert.match(viteConfig, /strategies:\s*['"]injectManifest['"]/);
assert.match(viteConfig, /swSrc:\s*['"]src\/pwa\/sw\.ts['"]/);
assert.match(sw, /self\.addEventListener\(['"]push['"]/);
assert.match(sw, /self\.addEventListener\(['"]notificationclick['"]/);
assert.match(composable, /Notification\.requestPermission\(\)/);
assert.match(composable, /pushManager\.subscribe/);
assert.match(composable, /\/notifications\/push\/subscriptions/);

console.log('web push static checks passed');
```

- [ ] **Step 2: Run static test to verify it fails**

```bash
node frontend/tests/web-push-static.test.mjs
```

Expected: FAIL because files/config are not implemented.

- [ ] **Step 3: Switch VitePWA to injectManifest**

In `frontend/vite.config.ts`, update the `VitePWA` options to include:

```ts
strategies: 'injectManifest',
srcDir: 'src/pwa',
filename: 'sw.ts',
injectManifest: {
  globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
},
```

Keep the existing `registerType`, `includeAssets`, `manifest`, and `devOptions`. Move current Workbox runtime behavior into the custom worker in the next step.

- [ ] **Step 4: Create custom service worker**

Create `frontend/src/pwa/sw.ts`:

```ts
/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(
    async () => {
      const cache = await caches.open('zalocrm-pages');
      const cached = await cache.match('/index.html');
      return cached || fetch('/index.html');
    },
    { denylist: [/^\/api\//, /^\/socket\.io\//] },
  ),
);

registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({ cacheName: 'zalocrm-pages' }),
);

registerRoute(
  ({ request }) => ['style', 'script', 'worker'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'zalocrm-assets' }),
);

registerRoute(
  ({ request }) => ['image', 'font'].includes(request.destination),
  new CacheFirst({
    cacheName: 'zalocrm-static',
    plugins: [new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  type?: string;
  priority?: string;
  createdAt?: string;
}

function parsePushPayload(event: PushEvent): PushPayload {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { title: 'ZaloCRM', body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || 'ZaloCRM';
  const url = payload.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'Bạn có thông báo mới',
      icon: '/pwa-192x192.svg',
      badge: '/pwa-192x192.svg',
      tag: payload.tag,
      data: { url, type: payload.type, createdAt: payload.createdAt },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(targetUrl);
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
```

- [ ] **Step 5: Create push composable**

Create `frontend/src/composables/use-web-push.ts`:

```ts
import { computed, ref } from 'vue';
import api from '@/api';
import { useToast } from '@/composables/use-toast';

type PushStatus = 'checking' | 'unsupported' | 'unavailable' | 'default' | 'denied' | 'subscribed' | 'unsubscribed';

interface PushConfigResponse {
  enabled: boolean;
  publicKey: string;
}

const status = ref<PushStatus>('checking');
const publicKey = ref('');
const busy = ref(false);
const initialized = ref(false);

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function browserSupportsPush() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && window.isSecureContext;
}

async function getRegistration() {
  return navigator.serviceWorker.ready;
}

async function syncLocalSubscriptionState() {
  if (!browserSupportsPush()) {
    status.value = 'unsupported';
    return;
  }
  if (!publicKey.value) {
    status.value = 'unavailable';
    return;
  }
  if (Notification.permission === 'denied') {
    status.value = 'denied';
    return;
  }
  if (Notification.permission === 'default') {
    status.value = 'default';
    return;
  }

  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  status.value = subscription ? 'subscribed' : 'unsubscribed';
}

export function useWebPush() {
  const toast = useToast();
  const canEnable = computed(() => ['default', 'unsubscribed'].includes(status.value) && !busy.value);
  const isSubscribed = computed(() => status.value === 'subscribed');

  async function init() {
    if (initialized.value) return;
    initialized.value = true;
    if (!browserSupportsPush()) {
      status.value = 'unsupported';
      return;
    }

    try {
      const { data } = await api.get<PushConfigResponse>('/notifications/push/config');
      publicKey.value = data.enabled ? data.publicKey : '';
      await syncLocalSubscriptionState();
    } catch {
      status.value = 'unavailable';
    }
  }

  async function enable() {
    busy.value = true;
    try {
      await init();
      if (!publicKey.value) {
        status.value = 'unavailable';
        toast.warning('Web Push chưa được cấu hình trên máy chủ', 5000);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        status.value = 'denied';
        toast.error('Trình duyệt đang chặn thông báo cho ZaloCRM', 5000);
        return;
      }
      if (permission !== 'granted') {
        status.value = 'default';
        return;
      }

      const registration = await getRegistration();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey.value),
      });

      await api.post('/notifications/push/subscriptions', subscription.toJSON());
      status.value = 'subscribed';
      toast.success('Đã bật thông báo Web/PWA');
    } catch {
      status.value = 'unavailable';
      toast.error('Không thể bật thông báo lúc này', 5000);
    } finally {
      busy.value = false;
    }
  }

  async function disable() {
    busy.value = true;
    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.delete('/notifications/push/subscriptions', { data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      status.value = Notification.permission === 'granted' ? 'unsubscribed' : Notification.permission;
      toast.success('Đã tắt thông báo trên thiết bị này');
    } catch {
      toast.error('Không thể tắt thông báo lúc này', 5000);
    } finally {
      busy.value = false;
    }
  }

  async function sendTest() {
    busy.value = true;
    try {
      await api.post('/notifications/push/test');
      toast.success('Đã gửi thông báo thử');
    } catch {
      toast.error('Không gửi được thông báo thử', 5000);
    } finally {
      busy.value = false;
    }
  }

  return { status, busy, canEnable, isSubscribed, init, enable, disable, sendTest };
}
```

- [ ] **Step 6: Verify static test passes**

```bash
node frontend/tests/web-push-static.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit PWA push primitives**

```bash
git add frontend/vite.config.ts frontend/src/pwa/sw.ts frontend/src/composables/use-web-push.ts frontend/tests/web-push-static.test.mjs
git commit -m "feat(pwa): add web push service worker"
```

---

## Task 6: Notification Bell UI Integration

**Files:**
- Modify: `frontend/src/components/NotificationBell.vue`
- Modify: `frontend/src/layouts/MobileLayout.vue`
- Modify: `frontend/tests/web-push-static.test.mjs`

- [ ] **Step 1: Extend static test for UI integration**

Append these assertions to `frontend/tests/web-push-static.test.mjs`:

```js
const bell = readFileSync(new URL('../src/components/NotificationBell.vue', import.meta.url), 'utf8');
const mobileLayout = readFileSync(new URL('../src/layouts/MobileLayout.vue', import.meta.url), 'utf8');

assert.match(bell, /useWebPush/);
assert.match(bell, /Bật thông báo/);
assert.doesNotMatch(bell, /interface Notification\b/);
assert.match(mobileLayout, /ToastContainer/);
```

- [ ] **Step 2: Run static test to verify it fails**

```bash
node frontend/tests/web-push-static.test.mjs
```

Expected: FAIL because UI integration is not implemented.

- [ ] **Step 3: Update NotificationBell script**

In `frontend/src/components/NotificationBell.vue`, rename the local interface from `Notification` to `AppNotification`, import and initialize push:

```ts
import { useWebPush } from '@/composables/use-web-push';

interface AppNotification {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt?: string;
  url?: string;
}

const push = useWebPush();
const notifications = ref<AppNotification[]>([]);

onMounted(() => {
  fetchNotifications();
  void push.init();
  interval = setInterval(fetchNotifications, 60000);
});
```

Update `handleClick` to use `n.url` first:

```ts
function handleClick(n: AppNotification) {
  if (n.url) router.push(n.url);
  else if (n.id === 'unreplied') router.push('/chat');
  else if (n.id.startsWith('apt-')) router.push('/appointments');
  else if (n.id.startsWith('zalo-')) router.push('/zalo-accounts');
  else if (n.id === 'tmr-apts') router.push('/appointments');
}
```

- [ ] **Step 4: Add push controls to bell menu template**

Inside the notification menu content, directly under the title row, add a compact action area:

```vue
<div class="push-panel">
  <div class="push-copy">
    <div class="push-title">Thông báo Web/PWA</div>
    <div class="push-status" v-if="push.status.value === 'unsupported'">Trình duyệt không hỗ trợ</div>
    <div class="push-status" v-else-if="push.status.value === 'unavailable'">Chưa cấu hình Web Push</div>
    <div class="push-status" v-else-if="push.status.value === 'denied'">Thông báo bị chặn</div>
    <div class="push-status" v-else-if="push.isSubscribed.value">Đã bật thông báo</div>
    <div class="push-status" v-else>Bật để nhận tin nhắn và cảnh báo khi app ở nền</div>
  </div>
  <div class="push-actions">
    <button v-if="push.canEnable.value" class="push-btn primary" :disabled="push.busy.value" @click.stop="push.enable">
      Bật thông báo
    </button>
    <button v-if="push.isSubscribed.value" class="push-btn" :disabled="push.busy.value" @click.stop="push.sendTest">
      Gửi thử
    </button>
    <button v-if="push.isSubscribed.value" class="push-btn" :disabled="push.busy.value" @click.stop="push.disable">
      Tắt
    </button>
  </div>
</div>
```

Add CSS scoped to the component:

```css
.push-panel {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}
.push-copy { min-width: 0; }
.push-title { font-size: 0.8rem; font-weight: 700; color: #f8fafc; }
.push-status { margin-top: 2px; font-size: 0.72rem; color: #94a3b8; }
.push-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.push-btn {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  padding: 5px 9px;
  color: #e5e7eb;
  background: rgba(15, 23, 42, 0.85);
  font-size: 0.72rem;
}
.push-btn.primary { color: #17120a; background: #d6a84f; border-color: #d6a84f; }
.push-btn:disabled { opacity: 0.55; cursor: wait; }
```

- [ ] **Step 5: Mount toast container in mobile layout**

In `frontend/src/layouts/MobileLayout.vue`, import:

```ts
import ToastContainer from '@/components/ui/ToastContainer.vue';
```

Add `<ToastContainer />` once near the root layout so mobile users see push feedback.

- [ ] **Step 6: Verify static test and frontend build**

```bash
node frontend/tests/web-push-static.test.mjs
npm --prefix frontend run build
```

Expected: both PASS.

- [ ] **Step 7: Commit notification bell UI**

```bash
git add frontend/src/components/NotificationBell.vue frontend/src/layouts/MobileLayout.vue frontend/tests/web-push-static.test.mjs
git commit -m "feat(notifications): add push controls to bell"
```

---

## Task 7: Full Validation and Docker Smoke

**Files:**
- Modify only if validation reveals necessary fixes.

- [ ] **Step 1: Install dependencies in fresh worktree if needed**

```bash
npm --prefix backend install
npm --prefix frontend install
```

Expected: both exit 0.

- [ ] **Step 2: Run backend tests**

```bash
npm --prefix backend test -- --runInBand
```

If Vitest rejects `--runInBand`, run:

```bash
npm --prefix backend test
```

Expected: PASS.

- [ ] **Step 3: Run frontend static test and build**

```bash
node frontend/tests/web-push-static.test.mjs
npm --prefix frontend run build
```

Expected: PASS.

- [ ] **Step 4: Run Docker production-like build**

```bash
docker compose build app
```

Expected: image builds successfully.

- [ ] **Step 5: Start Docker stack**

```bash
docker compose up -d app db minio
```

Expected: containers start. If compose service names differ, inspect `docker compose config --services` and run equivalent app/database/object storage services.

- [ ] **Step 6: Health check app**

```bash
curl -fsS http://localhost:3080/health
```

Expected: JSON health response or HTTP 200.

- [ ] **Step 7: Smoke push config route**

Login with the seeded/demo user used by this repo, then call push config:

```bash
TOKEN=$(curl -fsS -X POST http://localhost:3080/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"demo@zalocrm.local","password":"Demo@123456"}' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token||JSON.parse(s).accessToken||''))")
curl -fsS http://localhost:3080/api/v1/notifications/push/config -H "Authorization: Bearer $TOKEN"
```

Expected: returns `{ enabled: true, publicKey: ... }` if VAPID env is present, or `{ enabled: false, publicKey: '' }` without crashing.

- [ ] **Step 8: Browser smoke**

Start or use the Docker app at `http://localhost:3080`, then use browser automation to verify:

1. Login page loads.
2. After login, notification bell opens.
3. The menu contains “Thông báo Web/PWA”.
4. If VAPID is configured and the browser allows permissions, “Bật thông báo” is visible.
5. Console has no runtime errors related to service worker or Notification API.

- [ ] **Step 9: Inspect git status**

```bash
git status --short
```

Expected: only intended files changed.

- [ ] **Step 10: Commit validation fixes if any**

If validation required fixes:

```bash
git add <fixed-files>
git commit -m "fix(notifications): stabilize web push validation"
```

---

## Self-Review

- Spec coverage: backend subscription storage, push routes, VAPID config, chat push, system push, service worker, explicit enable UI, foreground feedback, and Docker validation are all mapped to tasks.
- Placeholder scan: no task uses deferred placeholders; Task 4 has one file-specific variable adjustment because the persisted message identifiers must be read from the existing file immediately before edit.
- Type consistency: backend payload fields are consistently `title`, `body`, `url`, `tag`, `type`, `priority`, `createdAt`; frontend composable and service worker use the same shape.
