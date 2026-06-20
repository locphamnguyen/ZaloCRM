// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * privacy-routes.ts — Phase Riêng Tư (OTP-only 2026-06-06)
 *
 * Anh chốt 2026-06-06: bỏ PIN hoàn toàn, chỉ unlock qua OTP gửi Zalo nick nội bộ.
 *
 * Endpoints:
 *   GET    /api/v1/privacy/otp/status            → canRequestOtp + blockedReason + lockedUntil
 *   POST   /api/v1/privacy/otp/request           { durationMinutes }           → gửi OTP qua Zalo
 *   POST   /api/v1/privacy/otp/verify            { tokenId, code }             → set HttpOnly cookie + expiresAt
 *   POST   /api/v1/privacy/lock                                                → revoke current session
 *   GET    /api/v1/privacy/status                                             → active sessions
 *   GET    /api/v1/privacy/my-nicks                                           → nicks user owner
 *   PATCH  /api/v1/zalo-accounts/:id/privacy-mode  { mode }                   → flip nick main/sub
 *   POST   /api/v1/admin/privacy/reset-lock/:userId                           → owner reset lock (sai OTP nhiều)
 *   GET    /api/v1/admin/privacy/audit?userId=                                → audit log unlock events
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import {
  lock,
  getStatus,
  revokeAllSessions,
  adminResetLock,
  type SessionDuration,
} from './session-service.js';
import {
  requestOtp,
  verifyOtp,
  getOtpStatus,
  PrivacyOtpError,
} from './otp-service.js';

const COOKIE_NAME = 'priv_session';

function setSessionCookie(reply: any, token: string, expiresAt: Date): void {
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  reply.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
}

function clearSessionCookie(reply: any): void {
  reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

export async function registerPrivacyRoutes(app: FastifyInstance): Promise<void> {
  // ── OTP unlock flow ────────────────────────────────────────────────────

  // GET /privacy/otp/status — FE biết user có thể xin OTP hay đang block/lock.
  app.get('/api/v1/privacy/otp/status', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    try {
      const status = await getOtpStatus(user.userId ?? user.id, user.orgId);
      return reply.send(status);
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // POST /privacy/otp/request { durationMinutes } — sinh OTP 4 số, gửi Zalo nick nội bộ.
  app.post('/api/v1/privacy/otp/request', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const body = (request.body ?? {}) as {
      durationMinutes?: number;
      context?: { action?: 'enable' | 'disable' | 'unlock'; nickName?: string };
    };
    if (!body.durationMinutes) {
      return reply.status(400).send({ error: 'Cần durationMinutes' });
    }
    try {
      const result = await requestOtp({
        userId: user.userId ?? user.id,
        orgId: user.orgId,
        durationMinutes: body.durationMinutes,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        context: body.context?.action
          ? { action: body.context.action, nickName: body.context.nickName }
          : undefined,
      });
      return reply.send(result);
    } catch (e: any) {
      if (e instanceof PrivacyOtpError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.errorCode });
      }
      return reply.status(400).send({ error: e.message });
    }
  });

  // POST /privacy/otp/verify { tokenId, code } — match → tạo session + set cookie.
  app.post('/api/v1/privacy/otp/verify', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const body = (request.body ?? {}) as { tokenId?: string; code?: string };
    if (!body.tokenId || !body.code) {
      return reply.status(400).send({ error: 'Cần tokenId + code' });
    }
    try {
      const result = await verifyOtp({
        userId: user.userId ?? user.id,
        orgId: user.orgId,
        tokenId: body.tokenId,
        code: body.code,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      // CHỈ mở khoá XEM (action='unlock') mới tạo session → set cookie. Gạt (enable/disable)
      // chỉ xác nhận mã, không có session/cookie (anh chốt 2026-06-06 — Q6).
      if (result.action === 'unlock' && result.sessionToken && result.expiresAt) {
        setSessionCookie(reply, result.sessionToken, result.expiresAt);
        return reply.send({
          ok: true,
          action: result.action,
          expiresAt: result.expiresAt,
          durationMinutes: result.durationMinutes,
        });
      }
      return reply.send({ ok: true, action: result.action });
    } catch (e: any) {
      if (e instanceof PrivacyOtpError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.errorCode });
      }
      return reply.status(400).send({ error: e.message });
    }
  });

  // POST /privacy/lock — revoke ALL active sessions cho user.
  // Anh chốt 2026-05-22: revoke ALL (không chỉ theo cookie) → lock thật sự lock dù cookie
  // thiếu/lệch hoặc có orphan session từ browser khác. activeSessionCount=0 ngay → blur kích hoạt.
  app.post('/api/v1/privacy/lock', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    const userId = user?.userId ?? user?.id;
    if (userId) {
      await revokeAllSessions(userId);
    }
    const cookieToken = (request as any).cookies?.[COOKIE_NAME] || extractCookie(request, COOKIE_NAME);
    if (cookieToken) await lock(cookieToken); // belt-and-braces (no-op nếu đã revoke ở trên)
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  // GET /privacy/status — active sessions của user.
  app.get('/api/v1/privacy/status', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const status = await getStatus(user.userId ?? user.id);
    return reply.send(status);
  });

  // GET /privacy/my-nicks — trả CHỈ nicks user là chính chủ (owner) trong org.
  // Anh chốt 2026-05-22: Privacy page chỉ thấy nick mình owner — không bao gồm
  // granted access cross-sale (vì privacy phải chính chủ flip).
  app.get('/api/v1/privacy/my-nicks', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const userId = user.userId ?? user.id;

    const nicks = await prisma.zaloAccount.findMany({
      // 2026-06-10: ẩn nick đã xóa mềm khỏi list cấu hình Riêng tư của user.
      where: { orgId: user.orgId, ownerUserId: userId, archivedAt: null },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        privacyMode: true,
        lastConnectedAt: true,
        ownerUserId: true,
        _count: { select: { friends: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const shaped = nicks.map((n) => ({
      ...n,
      friendCount: n._count?.friends ?? 0,
      _count: undefined,
    }));

    return reply.send({ nicks: shaped });
  });

  // PATCH /zalo-accounts/:id/privacy-mode — flip nick main/sub. Chỉ owner mới flip.
  app.patch('/api/v1/zalo-accounts/:id/privacy-mode', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { mode?: 'main' | 'sub' };
    if (body.mode !== 'main' && body.mode !== 'sub') {
      return reply.status(400).send({ error: 'mode phải là main hoặc sub' });
    }

    const account = await prisma.zaloAccount.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, ownerUserId: true, privacyMode: true },
    });
    if (!account) return reply.status(404).send({ error: 'Nick không tồn tại' });
    const userId = user.userId ?? user.id;
    if (account.ownerUserId !== userId) {
      return reply.status(403).send({ error: 'Chỉ owner của nick mới flip privacy mode' });
    }

    // 2026-06-11 — MỞ LẠI bật mới Riêng tư sau khi vá xong 3 đợt lỗ lộ nội dung
    // (realtime redact server-side + scope org + list/search redact + leak-guard).
    // Mặc định MỞ; chỉ khóa khẩn khi set env PRIVACY_LOCK_NEW=1 (cờ kill-switch nếu
    // phát hiện lỗ mới). Vẫn luôn cho TẮT (mode='sub').
    const privacyNewLocked = process.env.PRIVACY_LOCK_NEW === '1';
    if (privacyNewLocked && body.mode === 'main' && account.privacyMode !== 'main') {
      return reply.status(423).send({
        error: 'Tính năng Riêng tư đang tạm khóa bật mới (kill-switch bảo mật).',
        code: 'PRIVACY_FEATURE_LOCKED',
      });
    }

    // Hard cap khi flip sang 'main' (Phase Privacy v2 2026-05-23).
    if (body.mode === 'main' && account.privacyMode !== 'main') {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { maxPrivacyNicks: true },
      });
      const max = me?.maxPrivacyNicks ?? 2;
      const currentMainCount = await prisma.zaloAccount.count({
        where: { ownerUserId: userId, privacyMode: 'main' },
      });
      if (currentMainCount >= max) {
        return reply.status(400).send({
          error: `Cấu trúc ổn định hệ thống mặc định ${max} nick riêng tư. Liên hệ admin nếu phát sinh thêm.`,
          code: 'MAX_PRIVACY_NICKS_EXCEEDED',
          maxPrivacyNicks: max,
          currentCount: currentMainCount,
        });
      }
    }

    await prisma.zaloAccount.update({
      where: { id },
      data: { privacyMode: body.mode },
    });

    const io = (request.server as any).io;
    io?.emit('privacy:mode-changed', { accountId: id, mode: body.mode });

    return reply.send({ ok: true, mode: body.mode });
  });

  // POST /admin/privacy/reset-lock/:userId — owner reset lock cho sale (sai OTP nhiều lần).
  app.post('/api/v1/admin/privacy/reset-lock/:userId', {
    preHandler: [
      authMiddleware,
      async (req: any, rep: any) => {
        const u = req.user;
        if (!u) return rep.status(401).send({ error: 'unauthorized' });
        const allowed = await userHasGrant(u.userId ?? u.id, 'user', 'edit');
        if (!allowed) return rep.status(403).send({ error: 'Cần quyền user.edit để reset' });
      },
    ],
  }, async (request, reply) => {
    const user = (request as any).user;
    const { userId } = request.params as { userId: string };

    const target = await prisma.user.findFirst({
      where: { id: userId, orgId: user.orgId },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'User không tồn tại' });

    await adminResetLock(userId);
    return reply.send({ ok: true });
  });

  // GET /admin/privacy/audit?userId= — audit log unlock events.
  app.get('/api/v1/admin/privacy/audit', {
    preHandler: [
      authMiddleware,
      async (req: any, rep: any) => {
        const u = req.user;
        if (!u) return rep.status(401).send({ error: 'unauthorized' });
        const allowed = await userHasGrant(u.userId ?? u.id, 'audit_log', 'access');
        if (!allowed) return rep.status(403).send({ error: 'Cần quyền audit_log.access' });
      },
    ],
  }, async (request, reply) => {
    const user = (request as any).user;
    const query = request.query as { userId?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 200);

    const where: any = { user: { orgId: user.orgId } };
    if (query.userId) where.userId = query.userId;

    const sessions = await prisma.userPrivacySession.findMany({
      where,
      orderBy: { unlockedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        unlockedAt: true,
        expiresAt: true,
        lastActivityAt: true,
        revokedAt: true,
        ipHash: true,
        userAgent: true,
        user: { select: { fullName: true, email: true } },
      },
    });
    return reply.send({ sessions });
  });
}

function extractCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const cookies = Object.fromEntries(
    raw.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  return cookies[name] || null;
}
