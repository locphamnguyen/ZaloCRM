/**
 * org-branding-routes.test.ts — Login branding feature (2026-06-12).
 *
 * Bao phủ:
 *  - GET /api/v1/public/org-branding (public, pre-auth): allowlist 5 trường,
 *    chạy không cần auth, no-org → defaults 200, null fields → defaults,
 *    Cache-Control header.
 *  - PUT /api/v1/organization (T4): lưu 4 trường branding, regression name/timezone,
 *    RBAC grant settings:edit, validation logoUrl/emailDomain, rỗng → xóa (null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser } from './test-helpers.js';

// ── Hoisted mock state ────────────────────────────────────────────────────────
const prismaMock = {
  organization: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
let grantAllowed = true;

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({
  requireGrant: () => async (_req: any, reply: any) => {
    if (!grantAllowed) return reply.status(403).send({ error: 'forbidden' });
  },
}));

const { orgBrandingRoutes, resetOrgBrandingCache } = await import('../src/modules/branding/org-branding-routes.js');
const { orgRoutes } = await import('../src/modules/auth/org-routes.js');

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(orgBrandingRoutes);
  app.register(orgRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  grantAllowed = true;
  resetOrgBrandingCache(); // cache cấp module → reset để case không nhiễu nhau
});

// ── GET /api/v1/public/org-branding ───────────────────────────────────────────
describe('GET /api/v1/public/org-branding (public)', () => {
  const PUB = '/api/v1/public/org-branding';

  it('trả đúng 5 trường allowlist, không lộ trường khác', async () => {
    prismaMock.organization.findFirst.mockResolvedValue({
      name: 'HS Holding', logoUrl: '/brand/hs.png',
      slogan: 'Bền vững', copyright: '© 2026 HS', emailDomain: 'hs.com',
    });
    const res = await buildApp().inject({ method: 'GET', url: PUB });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Object.keys(body).sort()).toEqual(
      ['copyright', 'emailDomain', 'logoUrl', 'name', 'slogan'],
    );
    // select chỉ lấy 5 trường branding — không có id/timezone/token...
    const select = prismaMock.organization.findFirst.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(
      ['copyright', 'emailDomain', 'logoUrl', 'name', 'slogan'],
    );
  });

  it('chạy KHÔNG cần auth header', async () => {
    prismaMock.organization.findFirst.mockResolvedValue({
      name: 'HS', logoUrl: null, slogan: null, copyright: null, emailDomain: null,
    });
    const res = await buildApp().inject({ method: 'GET', url: PUB }); // không Authorization
    expect(res.statusCode).toBe(200);
  });

  it('chưa có org → trả defaults 200 (không 404/500)', async () => {
    prismaMock.organization.findFirst.mockResolvedValue(null);
    const res = await buildApp().inject({ method: 'GET', url: PUB });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('HS Holding');
    expect(body.logoUrl).toBeNull();
    expect(body.emailDomain).toBeNull();
  });

  it('org tồn tại + trường null → trả null (KHÔNG leak default)', async () => {
    prismaMock.organization.findFirst.mockResolvedValue({
      name: 'Acme', logoUrl: null, slogan: null, copyright: null, emailDomain: null,
    });
    const res = await buildApp().inject({ method: 'GET', url: PUB });
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Acme');     // giữ name thật (cột NOT NULL)
    expect(body.slogan).toBeNull();     // null → null, login tự ẩn (fix slogan leak)
    expect(body.copyright).toBeNull();
    expect(body.logoUrl).toBeNull();
  });

  it('lỗi DB → vẫn trả defaults 200', async () => {
    prismaMock.organization.findFirst.mockRejectedValue(new Error('db down'));
    const res = await buildApp().inject({ method: 'GET', url: PUB });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('HS Holding');
  });

  it('set Cache-Control 60s', async () => {
    prismaMock.organization.findFirst.mockResolvedValue(null);
    const res = await buildApp().inject({ method: 'GET', url: PUB });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('cache RAM — gọi 2 lần chỉ query DB 1 lần (chống DB amplifier #8)', async () => {
    prismaMock.organization.findFirst.mockResolvedValue({
      name: 'HS', logoUrl: null, slogan: null, copyright: null, emailDomain: null,
    });
    const app = buildApp();
    await app.inject({ method: 'GET', url: PUB });
    await app.inject({ method: 'GET', url: PUB });
    expect(prismaMock.organization.findFirst).toHaveBeenCalledTimes(1);
  });
});

// ── PUT /api/v1/organization — branding fields + regression + RBAC ────────────
describe('PUT /api/v1/organization (branding)', () => {
  const PUT = '/api/v1/organization';

  it('lưu 4 trường branding', async () => {
    prismaMock.organization.update.mockResolvedValue({
      id: 'org-1', name: 'HS', timezone: '+07:00',
      logoUrl: '/brand/x.png', slogan: 'S', copyright: 'C', emailDomain: 'hs.com',
    });
    const res = await buildApp().inject({
      method: 'PUT', url: PUT,
      payload: { logoUrl: '/brand/x.png', slogan: 'S', copyright: 'C', emailDomain: 'HS.com' },
    });
    expect(res.statusCode).toBe(200);
    const data = prismaMock.organization.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      logoUrl: '/brand/x.png', slogan: 'S', copyright: 'C', emailDomain: 'hs.com', // lowercased
    });
  });

  it('regression — name + timezone vẫn lưu được', async () => {
    prismaMock.organization.update.mockResolvedValue({
      id: 'org-1', name: 'New', timezone: '+08:00',
      logoUrl: null, slogan: null, copyright: null, emailDomain: null,
    });
    const res = await buildApp().inject({
      method: 'PUT', url: PUT, payload: { name: 'New', timezone: '+08:00' },
    });
    expect(res.statusCode).toBe(200);
    const data = prismaMock.organization.update.mock.calls[0][0].data;
    expect(data).toEqual({ name: 'New', timezone: '+08:00' });
  });

  it('RBAC — không có grant settings:edit → 403', async () => {
    grantAllowed = false;
    const res = await buildApp().inject({
      method: 'PUT', url: PUT, payload: { slogan: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('validation — emailDomain sai → 400', async () => {
    const res = await buildApp().inject({
      method: 'PUT', url: PUT, payload: { emailDomain: 'không-phải-domain' },
    });
    expect(res.statusCode).toBe(400);
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('validation — logoUrl http:// ngoài (mixed-content) → 400', async () => {
    const res = await buildApp().inject({
      method: 'PUT', url: PUT, payload: { logoUrl: 'http://evil.com/pixel.png' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('validation — logoUrl protocol-relative //evil.com → 400', async () => {
    const res = await buildApp().inject({
      method: 'PUT', url: PUT, payload: { logoUrl: '//evil.com/pixel.png' },
    });
    expect(res.statusCode).toBe(400);
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('validation — logoUrl http://localhost (kho media nội bộ) → OK', async () => {
    prismaMock.organization.update.mockResolvedValue({
      id: 'org-1', name: 'HS', timezone: '+07:00',
      logoUrl: 'http://localhost:9100/zalocrm-attachments/media/x.webp',
      slogan: null, copyright: null, emailDomain: null,
    });
    const res = await buildApp().inject({
      method: 'PUT', url: PUT,
      payload: { logoUrl: 'http://localhost:9100/zalocrm-attachments/media/x.webp' },
    });
    expect(res.statusCode).toBe(200);
    expect(prismaMock.organization.update.mock.calls[0][0].data.logoUrl)
      .toBe('http://localhost:9100/zalocrm-attachments/media/x.webp');
  });

  it('chuỗi rỗng → xóa (null)', async () => {
    prismaMock.organization.update.mockResolvedValue({
      id: 'org-1', name: 'HS', timezone: '+07:00',
      logoUrl: null, slogan: null, copyright: null, emailDomain: null,
    });
    const res = await buildApp().inject({
      method: 'PUT', url: PUT, payload: { logoUrl: '', slogan: '', emailDomain: '' },
    });
    expect(res.statusCode).toBe(200);
    const data = prismaMock.organization.update.mock.calls[0][0].data;
    expect(data.logoUrl).toBeNull();
    expect(data.slogan).toBeNull();
    expect(data.emailDomain).toBeNull();
  });
});
