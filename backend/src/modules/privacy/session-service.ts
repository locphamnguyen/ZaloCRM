// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * session-service.ts — Phase Riêng Tư (OTP migration 2026-06-06)
 *
 * Quản lý UserPrivacySession: tạo bởi OTP verify (otp-service.ts), resolve/revoke/idle ở đây.
 * Đổi tên từ pin-service.ts: gỡ toàn bộ logic PIN (setup/verify/change/unlock-by-pin),
 * giữ lại helper session độc lập với cách unlock. Anh chốt 2026-06-06: bỏ PIN, chỉ dùng OTP.
 *
 * Session 4 mức thời hạn + idle timeout 30 phút.
 */
import { randomBytes, createHash } from 'node:crypto';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';

// Anh chốt 2026-05-22: 4 mốc thời hạn session:
// 5p (test/nhanh), 15p (khuyến nghị), 8h (ca làm việc), 12h (nửa ngày)
export const DURATIONS_MIN = [5, 15, 480, 720] as const;
export type SessionDuration = (typeof DURATIONS_MIN)[number];

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_TOKEN_BYTES = 32;

export function genSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashIp(ip?: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/** Revoke 1 session by token (sale chủ động lock). */
export async function lock(sessionToken: string): Promise<void> {
  await prisma.userPrivacySession.updateMany({
    where: { sessionToken, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke ALL active sessions của user (vd: owner reset, đổi unlock method). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.userPrivacySession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Resolve session token → user nếu active, valid, idle <30 phút.
 * Hot path: cache layer ở redact để giảm DB load.
 * Update lastActivityAt với throttle 60s (không write mọi req).
 */
const lastActivityCache = new Map<string, number>(); // token → last update timestamp
const ACTIVITY_UPDATE_THROTTLE_MS = 60 * 1000;

export async function resolveSession(sessionToken: string): Promise<{
  userId: string;
  expiresAt: Date;
} | null> {
  if (!sessionToken) return null;
  const now = new Date();

  // CODEX REVIEW P2 #4 FIX: atomic conditional read — re-verify active status
  // ngay tại thời điểm decide. Tránh race với /lock hoặc revokeAll giữa read và return.
  const session = await prisma.userPrivacySession.findFirst({
    where: {
      sessionToken,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      userId: true,
      expiresAt: true,
      lastActivityAt: true,
    },
  });
  if (!session) return null;

  // Idle timeout check
  const idleMs = now.getTime() - session.lastActivityAt.getTime();
  if (idleMs > IDLE_TIMEOUT_MS) {
    // Auto-revoke stale session — conditional update để không đè revoke khác
    await prisma.userPrivacySession.updateMany({
      where: { sessionToken, revokedAt: null },
      data: { revokedAt: now },
    }).catch(() => {});
    return null;
  }

  // Throttled last_activity update (60s) — conditional để tránh resurrect session đã revoke
  const lastUpdate = lastActivityCache.get(sessionToken) ?? 0;
  if (now.getTime() - lastUpdate > ACTIVITY_UPDATE_THROTTLE_MS) {
    lastActivityCache.set(sessionToken, now.getTime());
    void prisma.userPrivacySession.updateMany({
      where: { sessionToken, revokedAt: null, expiresAt: { gt: now } },
      data: { lastActivityAt: now },
    }).catch(() => {});
  }

  return { userId: session.userId, expiresAt: session.expiresAt };
}

/**
 * Status of user privacy session — đang lock (do sai OTP), session active nào.
 * (Bỏ hasPin — OTP không có khái niệm "đã setup PIN".)
 */
export async function getStatus(userId: string): Promise<{
  hasPin: boolean;
  lockedUntil: Date | null;
  activeSessionCount: number;
  activeSessions: Array<{
    id: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
    unlockedAt: Date;
  }>;
}> {
  const [user, sessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { privacyLockedUntil: true },
    }),
    prisma.userPrivacySession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, expiresAt: true, userAgent: true, ipAddress: true, unlockedAt: true },
      orderBy: { unlockedAt: 'desc' },
    }),
  ]);

  return {
    // hasPin: OTP-only → coi như luôn "có cơ chế" (true) để FE không hiện trạng thái "chưa setup".
    // Giữ field cho tương thích shape cũ; FE sẽ dùng canRequestOtp từ /otp/status để quyết flow.
    hasPin: true,
    lockedUntil: user?.privacyLockedUntil ?? null,
    activeSessionCount: sessions.length,
    activeSessions: sessions,
  };
}

/**
 * hasActivePrivacySession — user có phiên mở khóa Riêng tư đang hiệu lực không?
 * Dùng cho emit realtime per-recipient (emit-chat.ts): chỉ owner ĐÃ unlock mới nhận
 * bản nội dung thật của nick main qua socket.
 *
 * Cache ngắn 5s theo userId để không query DB mỗi tin nhắn đến (hot path). Đủ tươi
 * vì idle/expiry tính bằng phút; trễ tối đa 5s khi vừa unlock/lock là chấp nhận được.
 */
const activeSessionCache = new Map<string, { value: boolean; at: number }>();
const ACTIVE_SESSION_CACHE_MS = 5 * 1000;

export async function hasActivePrivacySession(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = activeSessionCache.get(userId);
  if (cached && now - cached.at < ACTIVE_SESSION_CACHE_MS) return cached.value;

  const session = await prisma.userPrivacySession.findFirst({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { lastActivityAt: true },
  });
  // Tôn trọng idle timeout: session quá hạn idle coi như không active.
  let active = false;
  if (session) {
    active = now - session.lastActivityAt.getTime() <= IDLE_TIMEOUT_MS;
  }
  activeSessionCache.set(userId, { value: active, at: now });
  return active;
}

/**
 * Owner reset lock cho user (forgot/offline Zalo recovery).
 * Clear fail counter + lockout + revoke sessions. (Không còn PIN hash để clear.)
 */
export async function adminResetLock(targetUserId: string): Promise<void> {
  await tenantTransaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        privacyFailedCount: 0,
        privacyLockedUntil: null,
      },
    });
    await tx.userPrivacySession.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}
