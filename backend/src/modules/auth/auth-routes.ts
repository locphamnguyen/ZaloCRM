// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Auth routes — setup, login, profile, refresh, logout.
 * Registered as a Fastify plugin via app.register(authRoutes).
 *
 * Phase 2 token hardening 2026-06-08:
 *   - login/setup cấp ACCESS token ngắn (typ:'access', 15') + REFRESH token (rotation).
 *   - POST /auth/refresh: xoay refresh -> cấp access mới + refresh mới.
 *   - POST /auth/logout: revoke family refresh token.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authMiddleware } from './auth-middleware.js';
import {
  checkSetupStatus,
  setup,
  login,
  getProfile,
  buildAccessPayload,
  type JwtPayload,
} from './auth-service.js';
import {
  issueRefreshToken,
  rotateRefreshToken,
  logoutByToken,
  RefreshReuseError,
  RefreshInvalidError,
} from './refresh-token-service.js';
import { auditSecurityAsync } from './security-audit.js';
import { seedScoringDefaults } from '../scoring/seed-defaults.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';

function autoSeedScoringIfNeeded(orgId: string): void {
  seedScoringDefaults(orgId).catch((err) => {
    logger.warn({ orgId, err: err?.message }, '[auto-seed-scoring] failed silently');
  });
}

/** Ký access token ngắn hạn (typ:'access', expiresIn 15'). */
function signAccess(app: FastifyInstance, payload: JwtPayload): string {
  return app.jwt.sign({ ...payload, typ: 'access' }, { expiresIn: config.accessTokenTtl });
}

/** Trích metadata thiết bị từ request để gắn vào refresh token (#7). */
function deviceMeta(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/setup/status — check if first-run setup is needed
  app.get('/api/v1/setup/status', async () => {
    return checkSetupStatus();
  });

  // POST /api/v1/setup — create org + owner user, return access + refresh
  app.post<{
    Body: { orgName: string; fullName: string; email: string; password: string };
  }>('/api/v1/setup', async (request, reply) => {
    const { orgName, fullName, email, password } = request.body;
    if (!orgName || !fullName || !email || !password) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }
    const payload = await setup(orgName, fullName, email, password);
    const token = signAccess(app, payload);
    const refresh = await issueRefreshToken(payload.id, deviceMeta(request));
    autoSeedScoringIfNeeded(payload.orgId);
    return { token, refreshToken: refresh.token, user: payload };
  });

  // POST /api/v1/auth/login — verify credentials, return access + refresh
  app.post<{
    Body: { email?: string; identifier?: string; password: string };
  }>('/api/v1/auth/login', async (request, reply) => {
    const { email, identifier, password } = request.body;
    const id = (identifier ?? email ?? '').trim();
    if (!id || !password) {
      return reply.status(400).send({ error: 'Thiếu email/SĐT hoặc mật khẩu' });
    }
    const payload = await login(id, password);
    const token = signAccess(app, payload);
    const refresh = await issueRefreshToken(payload.id, deviceMeta(request));
    autoSeedScoringIfNeeded(payload.orgId);
    auditSecurityAsync({
      action: 'login_success',
      orgId: payload.orgId,
      userId: payload.id,
      details: { ip: request.ip },
    });
    // Fix 2026-06-07: login response kèm passwordChangedAt + onboarding fields để router guard
    // force /setup-password lần đầu. + Phase 2: kèm refreshToken (rotation).
    const profile = await getProfile(payload.id);
    return { token, refreshToken: refresh.token, user: { ...payload, ...profile } };
  });

  // POST /api/v1/auth/refresh — xoay refresh token -> access + refresh mới
  app.post<{ Body: { refreshToken?: string } }>(
    '/api/v1/auth/refresh',
    async (request, reply) => {
      const raw = (request.body?.refreshToken ?? '').trim();
      if (!raw) {
        return reply.status(400).send({ error: 'Thiếu refreshToken' });
      }
      try {
        const rotated = await rotateRefreshToken(raw, deviceMeta(request));
        const payload = await buildAccessPayload(rotated.userId);
        const token = signAccess(app, payload);
        auditSecurityAsync({
          action: 'refresh_rotate',
          orgId: payload.orgId,
          userId: rotated.userId,
          details: { ip: request.ip },
        });
        return { token, refreshToken: rotated.token, user: payload };
      } catch (err) {
        if (err instanceof RefreshReuseError) {
          return reply.status(401).send({ error: err.message, code: 'refresh_reuse' });
        }
        if (err instanceof RefreshInvalidError) {
          return reply.status(401).send({ error: err.message, code: 'refresh_invalid' });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/auth/logout — revoke family refresh token (idempotent)
  app.post<{ Body: { refreshToken?: string } }>(
    '/api/v1/auth/logout',
    async (request) => {
      const raw = (request.body?.refreshToken ?? '').trim();
      if (raw) {
        const res = await logoutByToken(raw);
        if (res) auditSecurityAsync({ action: 'logout', userId: res.userId, details: { ip: request.ip } });
      }
      return { ok: true };
    },
  );

  // GET /api/v1/profile — return current user (requires auth)
  app.get('/api/v1/profile', { preHandler: authMiddleware }, async (request) => {
    const user = request.user as { id: string; email: string; role: string; orgId: string };
    return getProfile(user.id);
  });
}
