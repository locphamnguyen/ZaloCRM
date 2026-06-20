// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * refresh-token-service.ts — Phase 2 token hardening (Bảo mật xác thực 2026-06-08)
 *
 * Refresh token rotation + reuse-detection + grace window.
 *
 *   issue      -> sinh token opaque random, LƯU sha256 hash (không lưu plaintext)
 *   rotate     -> single-use: cấp token mới cùng family, đánh dấu token cũ usedAt
 *   reuse      -> token đã dùng/đã revoke (ngoài grace) bị gửi lại => đánh cắp
 *                 => revoke CẢ family (đá mọi thiết bị của session đó)
 *   grace      -> token vừa xoay trong refreshGraceMs bị gửi lại (race đa tab)
 *                 => cấp token mới, KHÔNG coi là reuse
 *
 *   login ──issue──▶ T1(family F)
 *   refresh(T1) ──rotate──▶ T2(F), T1.usedAt=now
 *   refresh(T1 lần 2, trong grace) ──▶ T3(F)  (benign race)
 *   refresh(T1 lần 2, ngoài grace) ──▶ REUSE => revoke family F
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';
import { config } from '../../config/index.js';
import { auditSecurityCritical } from './security-audit.js';

export interface DeviceMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Token cấp cho client (plaintext) + metadata. Plaintext CHỈ trả về một lần. */
export interface IssuedRefreshToken {
  id: string;
  token: string;
  familyId: string;
  expiresAt: Date;
}

export class RefreshReuseError extends Error {
  code = 'refresh_reuse' as const;
  constructor() {
    super('Refresh token đã bị dùng lại — session bị thu hồi. Đăng nhập lại.');
  }
}
export class RefreshInvalidError extends Error {
  code = 'refresh_invalid' as const;
  constructor() {
    super('Refresh token không hợp lệ hoặc đã hết hạn.');
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Sinh token opaque 32 byte base64url. */
function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Cấp refresh token mới. familyId mới nếu không truyền (login mới); truyền lại
 * familyId khi rotate để giữ cùng chuỗi.
 */
export async function issueRefreshToken(
  userId: string,
  meta: DeviceMeta = {},
  familyId?: string,
  expiresAtOverride?: Date,
): Promise<IssuedRefreshToken> {
  const token = newOpaqueToken();
  const fam = familyId ?? randomUUID();
  // Grace path kế thừa hạn token gốc (không gia hạn) -> chống kéo dài lifetime.
  const expiresAt = expiresAtOverride ?? new Date(Date.now() + config.refreshTokenTtlMs);

  const rec = await runSystemQuery(() =>
    prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        familyId: fam,
        expiresAt,
        createdIp: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      select: { id: true },
    }),
  );

  return { id: rec.id, token, familyId: fam, expiresAt };
}

/** Thu hồi toàn bộ token còn sống của một family (reuse-detection / logout). */
export async function revokeFamily(familyId: string): Promise<void> {
  await runSystemQuery(() =>
    prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
}

/**
 * Logout: revoke family chứa rawToken. Im lặng nếu token không tồn tại (idempotent,
 * không lộ thông tin). Trả về true nếu tìm thấy + revoke.
 */
export async function logoutByToken(rawToken: string): Promise<{ userId: string } | null> {
  const rec = await runSystemQuery(() =>
    prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true, userId: true },
    }),
  );
  if (!rec) return null;
  await revokeFamily(rec.familyId);
  return { userId: rec.userId };
}

/**
 * Xoay refresh token. Trả về token mới (cùng family) + userId.
 * Throw RefreshReuseError (đã revoke family) hoặc RefreshInvalidError.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: DeviceMeta = {},
): Promise<IssuedRefreshToken & { userId: string }> {
  const rec = await runSystemQuery(() =>
    prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } }),
  );

  if (!rec) {
    throw new RefreshInvalidError();
  }

  const reuse = async (reason: string): Promise<never> => {
    await revokeFamily(rec.familyId);
    await auditSecurityCritical({
      action: 'refresh_reuse',
      userId: rec.userId,
      details: { familyId: rec.familyId, reason, ip: meta.ip ?? null },
    });
    throw new RefreshReuseError();
  };

  // 1. Token đã thu hồi -> trình lại = đánh cắp -> revoke family.
  if (rec.revokedAt) {
    return reuse('revoked_token_presented');
  }

  // 2. Token đã xoay (usedAt) — CHECK TRƯỚC expiry: used+expired replay vẫn là
  //    dấu hiệu đánh cắp, không được phân loại nhầm thành "invalid".
  if (rec.usedAt) {
    const sinceUsed = Date.now() - rec.usedAt.getTime();
    if (sinceUsed <= config.refreshGraceMs && rec.expiresAt.getTime() > Date.now()) {
      // Race đa tab benign: cấp token mới cùng family, KẾ THỪA hạn gốc (không
      // gia hạn, không nhánh fresh-TTL né reuse-detection).
      const issued = await issueRefreshToken(rec.userId, meta, rec.familyId, rec.expiresAt);
      return { ...issued, userId: rec.userId };
    }
    return reuse('used_token_replayed');
  }

  // 3. Hết hạn tự nhiên (token chưa dùng) -> invalid (không phải đánh cắp).
  if (rec.expiresAt.getTime() <= Date.now()) {
    throw new RefreshInvalidError();
  }

  // 4. Tuổi thọ tuyệt đối family: rotate liên tục không vượt refreshFamilyMaxMs.
  const oldest = await runSystemQuery(() =>
    prisma.refreshToken.findFirst({
      where: { familyId: rec.familyId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  );
  if (oldest && Date.now() - oldest.createdAt.getTime() > config.refreshFamilyMaxMs) {
    await revokeFamily(rec.familyId);
    throw new RefreshInvalidError();
  }

  // 5. Đường bình thường: cấp token mới cùng family + đánh dấu token cũ đã dùng.
  const issued = await issueRefreshToken(rec.userId, meta, rec.familyId);
  await runSystemQuery(() =>
    prisma.refreshToken.update({
      where: { id: rec.id },
      data: { usedAt: new Date(), replacedById: issued.id },
    }),
  );

  return { ...issued, userId: rec.userId };
}
