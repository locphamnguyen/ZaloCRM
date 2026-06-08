/**
 * Auth routes — setup, login, and profile endpoints.
 * Registered as a Fastify plugin via app.register(authRoutes).
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth-middleware.js';
import {
  checkSetupStatus,
  setup,
  login,
  getProfile,
} from './auth-service.js';
import { seedScoringDefaults } from '../scoring/seed-defaults.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Fire-and-forget auto-seed Phase 6 scoring config + rules nếu org chưa có.
 * Idempotent — seedScoringDefaults() tự skip khi config đã tồn tại.
 * KHÔNG await để không chặn login/setup response.
 */
function autoSeedScoringIfNeeded(orgId: string): void {
  seedScoringDefaults(orgId).catch((err) => {
    logger.warn({ orgId, err: err?.message }, '[auto-seed-scoring] failed silently');
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/setup/status — check if first-run setup is needed
  app.get('/api/v1/setup/status', async () => {
    return checkSetupStatus();
  });

  // POST /api/v1/setup — create org + owner user, return JWT
  app.post<{
    Body: { orgName: string; fullName: string; email: string; password: string };
  }>('/api/v1/setup', async (request, reply) => {
    const { orgName, fullName, email, password } = request.body;
    if (!orgName || !fullName || !email || !password) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }
    const payload = await setup(orgName, fullName, email, password);
    const token = app.jwt.sign(payload, { expiresIn: '7d' });
    // Phase 6 polish — auto-seed scoring defaults cho org mới tạo
    autoSeedScoringIfNeeded(payload.orgId);
    return { token, user: payload };
  });

  // POST /api/v1/auth/login — verify credentials, return JWT
  // Phase Onboarding v1 2026-05-24 — identifier (field 'email' historical) accept
  // cả email vừa phone. Backend auto-detect '@' hoặc digit-only.
  app.post<{
    Body: { email?: string; identifier?: string; password: string };
  }>('/api/v1/auth/login', async (request, reply) => {
    const { email, identifier, password } = request.body;
    const id = (identifier ?? email ?? '').trim();
    if (!id || !password) {
      return reply.status(400).send({ error: 'Thiếu email/SĐT hoặc mật khẩu' });
    }
    const payload = await login(id, password);
    const token = app.jwt.sign(payload, { expiresIn: '7d' });
    autoSeedScoringIfNeeded(payload.orgId);
    // Fix 2026-06-07: login response phải kèm passwordChangedAt + onboarding fields để router
    // guard force /setup-password lần đầu (trước đây chỉ trả JwtPayload thiếu → guard so
    // undefined===null = false → user mới vào thẳng dashboard, bỏ qua đổi pass).
    const profile = await getProfile(payload.id);
    return { token, user: { ...payload, ...profile } };
  });

  // GET /api/v1/profile — return current user (requires auth)
  app.get('/api/v1/profile', { preHandler: authMiddleware }, async (request) => {
    const user = request.user as { id: string; email: string; role: string; orgId: string };
    return getProfile(user.id);
  });
}
