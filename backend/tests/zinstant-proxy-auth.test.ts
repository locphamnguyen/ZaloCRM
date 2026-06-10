/**
 * zinstant-proxy-auth.test.ts — Regression test for phase 03 auth fix.
 *
 * Verifies:
 *  1. PII routes (`/zalo-user-info/*`) reject unauthenticated requests with 401.
 *  2. Public routes (`/zalo-bankcard`, `/zalo-sticker*`) skip auth and behave
 *     according to their own logic (400/403 on bad input, no 401).
 *  3. Authenticated batch lookup caps unique UIDs at 50.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Auth middleware mock — flip behaviour per test via `authShouldPass`.
let authShouldPass = true;
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any, reply: any) => {
    if (authShouldPass) {
      req.user = { id: 'user-1', orgId: 'org-1', role: 'admin', email: 't@x' };
      return;
    }
    reply.status(401).send({ error: 'Unauthorized' });
  },
}));

// Prisma mock — return no connected Zalo accounts so handlers exit early
// and we can observe HTTP response without exercising real provider.
vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getInstance: vi.fn().mockReturnValue(undefined) },
}));

const { zinstantProxyRoutes } = await import('../src/modules/contacts/zinstant-proxy-routes.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(zinstantProxyRoutes);
  await app.ready();
  return app;
}

describe('zinstant-proxy-routes auth gate', () => {
  beforeEach(() => {
    authShouldPass = true;
  });

  it('returns 401 on POST /zalo-user-info/batch when unauthenticated', async () => {
    authShouldPass = false;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/zalo-user-info/batch',
      payload: { uids: ['111', '222'] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 401 on GET /zalo-user-info/:uid when unauthenticated', async () => {
    authShouldPass = false;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/zalo-user-info/12345' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('does NOT 401 on GET /zalo-bankcard (public)', async () => {
    authShouldPass = false;
    const app = await buildApp();
    // Missing `url` query → 400, not 401. That proves auth hook was skipped.
    const res = await app.inject({ method: 'GET', url: '/api/v1/zalo-bankcard' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('401 on GET /zalo-sticker-list khi chưa auth (nhánh này chặt hơn main)', async () => {
    // private-hs cố ý gắn preHandler authMiddleware riêng cho /zalo-sticker-list
    // (picker chỉ dùng khi đã đăng nhập) → KHÁC main (coi sticker-list là public).
    // Giữ chính sách chặt hơn này; test phản ánh đúng hành vi nhánh.
    authShouldPass = false;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/zalo-sticker-list' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('caps batch lookup at 50 unique UIDs even when 200 sent', async () => {
    // Authenticated path — prisma.findMany returns empty so handler short-
    // circuits with all-null users. We just need to observe the response
    // length matches the cap.
    const uids = Array.from({ length: 200 }, (_, i) => `uid-${i}`);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/zalo-user-info/batch',
      payload: { uids },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { users: Record<string, unknown> };
    expect(Object.keys(body.users).length).toBeLessThanOrEqual(50);
    await app.close();
  });
});
