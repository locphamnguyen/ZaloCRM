// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * otp-service.ts — Phase Privacy OTP 2026-05-27
 *
 * Replace PIN tự setup bằng OTP 4 số gửi Zalo qua nick liên lạc nội bộ của sale.
 * Reuse: DURATIONS_MIN + IDLE_TIMEOUT_MS từ pin-service. UserPrivacySession giữ nguyên.
 *
 * Flow:
 *   1. requestOtp(userId, durationMinutes) → gen 4 số, lưu hash, gửi Zalo nick nội bộ
 *   2. verifyOtp(tokenId, code) → match hash → tạo UserPrivacySession + gửi tin confirm
 *   3. Sai 5 lần liên tiếp → User.privacyLockedUntil = now+30p (KHÔNG cho request mới)
 *
 * Rate limit:
 *   - 5s giữa 2 lần request OTP cùng user
 *   - Bị lock → reject cả request lẫn verify
 */
import { randomInt, createHash } from 'node:crypto';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { formatMessage } from '../../shared/text-formatter.js';
import { toZaloStyles } from '../system-notifications/welcome-message-builder.js';
import { DURATIONS_MIN, genSessionToken, hashIp, type SessionDuration } from './session-service.js';

const OTP_EXPIRES_MS = 5 * 60 * 1000;          // 5 phút
const OTP_RESEND_COOLDOWN_MS = 5 * 1000;       // 5s giữa 2 lần request
const OTP_LOCK_DURATION_MS = 30 * 60 * 1000;   // 5 sai liên tiếp → lock 30 phút
const OTP_MAX_VERIFY_ATTEMPTS = 5;

function generateOtp4(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Parse User-Agent string → friendly Vietnamese browser name.
 * Lưu ý: CocCoc xuất hiện trước Chrome trong UA string nên check trước.
 */
export function parseBrowserName(ua: string | null | undefined): string {
  if (!ua) return 'Trình duyệt khác';
  const s = ua.toLowerCase();
  if (s.includes('coc_coc') || s.includes('coccoc')) return 'Cốc Cốc';
  if (s.includes('edg/') || s.includes('edge')) return 'Edge';
  if (s.includes('opr/') || s.includes('opera')) return 'Opera';
  if (s.includes('firefox')) return 'Firefox';
  if (s.includes('chrome')) return 'Chrome';
  if (s.includes('safari')) return 'Safari';
  return 'Trình duyệt khác';
}

function formatDurationText(min: number): string {
  if (min >= 60) {
    const h = min / 60;
    return Number.isInteger(h) ? `${h} giờ` : `${h.toFixed(1)} giờ`;
  }
  return `${min} phút`;
}

function formatVnTime(d: Date): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

// ── Resolve user's internal contact target (UID Zalo) ──────────────────────

interface ZaloTarget {
  senderId: string;          // nick hệ thống id
  targetUid: string;         // UID Zalo của sale
}

async function resolveZaloTarget(userId: string, orgId: string): Promise<ZaloTarget | null> {
  const [org, recipient] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        systemNotifyZaloAccountId: true,
        systemNotifyNick: { select: { status: true } },
      },
    }),
    prisma.systemNotifyRecipient.findFirst({
      where: { orgId, targetUserId: userId, status: 'ready' },
      select: { threadIdInSenderView: true, senderZaloAccountId: true },
    }),
  ]);
  if (!org?.systemNotifyZaloAccountId || org.systemNotifyNick?.status !== 'connected') {
    return null;
  }
  if (!recipient?.threadIdInSenderView) return null;
  return { senderId: org.systemNotifyZaloAccountId, targetUid: recipient.threadIdInSenderView };
}

// ── OTP context: nêu rõ hành động trong tin OTP (anh chốt 2026-06-06) ───────
// Khi sale gạt 1 nick Thường↔Riêng tư, tin OTP phải nêu CỤ THỂ nick nào + bật/tắt
// + nhân viên owner thao tác. Khi chỉ mở khoá để xem → tin mặc định.
export interface OtpContext {
  action: 'enable' | 'disable' | 'unlock';
  nickName?: string;   // tên nick đang được gạt
  ownerName?: string;  // tên nhân viên owner thao tác
}

// ── Send OTP message via Zalo ──────────────────────────────────────────────

async function sendOtpMessage(args: {
  senderId: string;
  targetUid: string;
  otp: string;
  durationMinutes: number;
  context?: OtpContext;
}): Promise<void> {
  const durationText = formatDurationText(args.durationMinutes);
  const ctx = args.context;

  // Dòng tiêu đề + dòng mô tả hành động theo context.
  let heading = '🔐 Mã mở khóa Riêng tư:';
  let actionLine = '';
  if (ctx && (ctx.action === 'enable' || ctx.action === 'disable') && ctx.nickName) {
    const verb = ctx.action === 'enable' ? 'BẬT' : 'TẮT';
    const verbColor = ctx.action === 'enable' ? 'red' : 'orange';
    heading = ctx.action === 'enable'
      ? '🔒 Mã xác nhận BẬT chế độ Riêng tư:'
      : '🔓 Mã xác nhận TẮT chế độ Riêng tư:';
    actionLine = `Thao tác: {${verbColor}}${verb} Riêng tư{/${verbColor}} cho nick **${ctx.nickName}**`;
    if (ctx.ownerName) actionLine += `\nNhân viên thực hiện: **${ctx.ownerName}**`;
    actionLine += '\n';
  }

  const markup = `${heading}
${actionLine}
# {red}${args.otp}{/red}

Có hiệu lực {orange}5 phút{/orange}.
Thời gian mở khoá đã chọn: **${durationText}**

> *Nếu không phải anh/chị yêu cầu, vui lòng bỏ qua tin này.*`;
  const formatted = formatMessage(markup);
  const styles = toZaloStyles(formatted.styles);

  const limits = await zaloRateLimiter.checkLimits(args.senderId, 'message');
  if (!limits.allowed) {
    throw new Error(`Nick hệ thống đang rate-limit: ${limits.reason}`);
  }
  await zaloRateLimiter.recordSend(args.senderId, 'message');

  const api = zaloPool.getApi(args.senderId);
  if (!api) throw new Error('Nick hệ thống chưa connected trong pool');

  const payload: Record<string, unknown> = { msg: formatted.text };
  if (styles.length > 0) payload.styles = styles;
  await api.sendMessage(payload, args.targetUid, 0);
}

async function sendUnlockConfirmation(args: {
  senderId: string;
  targetUid: string;
  unlockedAt: Date;
  expiresAt: Date;
  durationMinutes: number;
  browser: string;
  ipAddress: string;
}): Promise<void> {
  const durationText = formatDurationText(args.durationMinutes);
  const markup = `✅ Đã mở khóa Riêng tư

📅 **Phiên làm việc:**
   Từ: ${formatVnTime(args.unlockedAt)}
   Đến: ${formatVnTime(args.expiresAt)}
   (${durationText})

🌐 **Trình duyệt:** ${args.browser}
🌍 **IP:** ${args.ipAddress}

> *⚠️ Nếu không phải anh/chị, hãy {red}khóa ngay{/red} tại /settings/privacy/sessions.*`;
  const formatted = formatMessage(markup);
  const styles = toZaloStyles(formatted.styles);

  const limits = await zaloRateLimiter.checkLimits(args.senderId, 'message');
  if (!limits.allowed) {
    logger.warn(`[privacy-otp] confirm message rate-limited: ${limits.reason}`);
    return;
  }
  await zaloRateLimiter.recordSend(args.senderId, 'message');
  const api = zaloPool.getApi(args.senderId);
  if (!api) return;

  const payload: Record<string, unknown> = { msg: formatted.text };
  if (styles.length > 0) payload.styles = styles;
  try {
    await api.sendMessage(payload, args.targetUid, 0);
  } catch (err) {
    // Không throw — confirm message fail KHÔNG block unlock (admin có thể check qua audit log)
    logger.warn(`[privacy-otp] confirm message send fail: ${String(err)}`);
  }
}

// ── Op 1: Request OTP ──────────────────────────────────────────────────────

export class PrivacyOtpError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
  }
}

export interface RequestOtpResult {
  tokenId: string;
  expiresAt: Date;
  /** Set khi user đang trong cooldown 5s giữa 2 lần. */
  retryAfterSeconds?: number;
}

export async function requestOtp(args: {
  userId: string;
  orgId: string;
  durationMinutes: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Context hành động (gạt nick) để tin OTP nêu cụ thể — anh chốt 2026-06-06. */
  context?: { action: 'enable' | 'disable' | 'unlock'; nickName?: string; nickId?: string };
}): Promise<RequestOtpResult> {
  const action = args.context?.action ?? 'unlock';
  // 'unlock' (mở khoá XEM) cần duration hợp lệ; 'enable'/'disable' (gạt) KHÔNG dùng duration
  // → bỏ qua guard, lưu sessionDurationMinutes=0.
  if (action === 'unlock' && !(DURATIONS_MIN as readonly number[]).includes(args.durationMinutes)) {
    throw new PrivacyOtpError(400, 'INVALID_DURATION', 'Thời gian session phải là 5/15/480/720 phút');
  }

  // Check user lock state (reuse User.privacyLockedUntil từ PIN cũ) + lấy tên owner cho tin OTP.
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { privacyLockedUntil: true, fullName: true },
  });
  if (!user) throw new PrivacyOtpError(404, 'USER_NOT_FOUND', 'User không tồn tại');
  if (user.privacyLockedUntil && user.privacyLockedUntil > new Date()) {
    const secs = Math.ceil((user.privacyLockedUntil.getTime() - Date.now()) / 1000);
    throw new PrivacyOtpError(423, 'LOCKED', `Tài khoản đang khóa ${Math.ceil(secs / 60)} phút do nhập sai nhiều lần`);
  }

  // Rate limit 5s — tìm token mới nhất chưa expire
  const recent = await prisma.privacyOtpToken.findFirst({
    where: { userId: args.userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSentAt: 'desc' },
    select: { id: true, lastSentAt: true },
  });
  if (recent) {
    const elapsedMs = Date.now() - recent.lastSentAt.getTime();
    if (elapsedMs < OTP_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      throw new PrivacyOtpError(429, 'COOLDOWN', `Vui lòng đợi ${retryAfterSeconds} giây trước khi gửi lại`);
    }
  }

  // Resolve Zalo target
  const target = await resolveZaloTarget(args.userId, args.orgId);
  if (!target) {
    throw new PrivacyOtpError(
      400,
      'NO_INTERNAL_CONTACT',
      'Anh chưa setup Liên lạc nội bộ. Vào /settings/channels/zalo → tab Sửa nick nhận thông báo',
    );
  }

  // Generate + persist + send. Invalidate previous unused tokens cùng user
  // → tránh trường hợp user nhận 2 OTP đồng thời, dùng OTP cũ vẫn pass.
  const otp = generateOtp4();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS);

  const token = await tenantTransaction(async (tx) => {
    // Mark previous unused tokens as used (gắn flag, không dùng được nữa)
    await tx.privacyOtpToken.updateMany({
      where: { userId: args.userId, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date(), verifyAttempts: OTP_MAX_VERIFY_ATTEMPTS }, // invalidate
    });
    return tx.privacyOtpToken.create({
      data: {
        userId: args.userId,
        otpHash,
        // Gạt (enable/disable) không dùng session → lưu duration=0 cho rõ.
        sessionDurationMinutes: action === 'unlock' ? args.durationMinutes : 0,
        expiresAt,
        lastSentAt: new Date(),
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        // 2026-06-06 — persist action + nickId để verifyOtp rẽ nhánh đúng + bind nick.
        action,
        nickId: args.context?.nickId ?? null,
      },
      select: { id: true },
    });
  });

  // Send via Zalo (outside tx — không block DB nếu Zalo chậm)
  try {
    await sendOtpMessage({
      senderId: target.senderId,
      targetUid: target.targetUid,
      otp,
      durationMinutes: args.durationMinutes,
      context: args.context
        ? { action: args.context.action, nickName: args.context.nickName, ownerName: user.fullName ?? undefined }
        : undefined,
    });
  } catch (err) {
    logger.error(`[privacy-otp] send OTP fail user=${args.userId}: ${String(err)}`);
    // Token đã tạo nhưng tin không gửi được. User sẽ thấy lỗi + có thể resend sau 5s.
    throw new PrivacyOtpError(503, 'SEND_FAILED', `Gửi OTP qua Zalo thất bại: ${(err as Error)?.message}`);
  }

  logger.info(`[privacy-otp] OTP sent user=${args.userId} duration=${args.durationMinutes}m token=${token.id}`);
  return { tokenId: token.id, expiresAt };
}

// ── Op 2: Verify OTP ───────────────────────────────────────────────────────

export interface VerifyOtpResult {
  action: 'enable' | 'disable' | 'unlock';
  // Chỉ có khi action='unlock' (mở khoá XEM → tạo session). Gạt (enable/disable) → undefined.
  sessionToken?: string;
  expiresAt?: Date;
  durationMinutes?: number;
}

export async function verifyOtp(args: {
  userId: string;
  orgId: string;
  tokenId: string;
  code: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<VerifyOtpResult> {
  if (!/^\d{4}$/.test(args.code)) {
    throw new PrivacyOtpError(400, 'INVALID_FORMAT', 'OTP phải là 4 chữ số');
  }

  // Re-check lock state
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { privacyLockedUntil: true },
  });
  if (!user) throw new PrivacyOtpError(404, 'USER_NOT_FOUND', 'User không tồn tại');
  if (user.privacyLockedUntil && user.privacyLockedUntil > new Date()) {
    const secs = Math.ceil((user.privacyLockedUntil.getTime() - Date.now()) / 1000);
    throw new PrivacyOtpError(423, 'LOCKED', `Tài khoản đang khóa ${Math.ceil(secs / 60)} phút`);
  }

  const token = await prisma.privacyOtpToken.findFirst({
    where: { id: args.tokenId, userId: args.userId },
    select: { id: true, otpHash: true, sessionDurationMinutes: true, expiresAt: true, verifyAttempts: true, usedAt: true, action: true, nickId: true },
  });
  if (!token) {
    throw new PrivacyOtpError(404, 'TOKEN_NOT_FOUND', 'OTP không tồn tại');
  }
  if (token.usedAt) {
    throw new PrivacyOtpError(410, 'TOKEN_USED', 'OTP đã dùng. Vui lòng gửi mã mới.');
  }
  if (token.expiresAt < new Date()) {
    throw new PrivacyOtpError(410, 'TOKEN_EXPIRED', 'OTP đã hết hạn. Vui lòng gửi mã mới.');
  }
  if (token.verifyAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    throw new PrivacyOtpError(429, 'TOO_MANY_ATTEMPTS', 'Mã này đã hết lượt thử. Vui lòng gửi mã mới.');
  }

  const valid = hashOtp(args.code) === token.otpHash;
  if (!valid) {
    // Increment attempts atomic
    const updated = await prisma.privacyOtpToken.update({
      where: { id: token.id },
      data: { verifyAttempts: { increment: 1 } },
      select: { verifyAttempts: true },
    });
    const attempts = updated.verifyAttempts;
    const left = OTP_MAX_VERIFY_ATTEMPTS - attempts;

    // 5 sai LIÊN TIẾP trên CÙNG token → lock user 30 phút
    if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      await prisma.user.update({
        where: { id: args.userId },
        data: { privacyLockedUntil: new Date(Date.now() + OTP_LOCK_DURATION_MS) },
      });
      throw new PrivacyOtpError(423, 'NOW_LOCKED', 'Đã sai 5 lần — tài khoản khóa 30 phút. Liên hệ admin nếu cần.');
    }
    throw new PrivacyOtpError(401, 'WRONG_CODE', `Mã sai. Còn ${left} lần thử.`);
  }

  // ── Mã ĐÚNG — rẽ nhánh theo action (anh chốt 2026-06-06) ──────────────────
  const tokenAction = (token.action as 'enable' | 'disable' | 'unlock') ?? 'unlock';

  // NHÁNH GẠT (enable/disable): chỉ xác nhận mã đúng → FE flip nick. KHÔNG tạo session,
  // KHÔNG revoke session đang mở (Q4 — nếu revoke thì gạt 1 nick sẽ khoá lại phiên unlock
  // của user giữa chừng), KHÔNG set cookie, KHÔNG gửi confirm.
  if (tokenAction === 'enable' || tokenAction === 'disable') {
    await prisma.$transaction(async (tx) => {
      await tx.privacyOtpToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      // Reset fail counter + clear lock (verify đúng → coi như đáng tin lại).
      await tx.user.update({
        where: { id: args.userId },
        data: { privacyFailedCount: 0, privacyLockedUntil: null },
      });
    });
    // Audit log riêng (không phải unlock) — fire-and-forget.
    void prisma.activityLog
      .create({
        data: {
          orgId: args.orgId,
          userId: args.userId,
          action: 'privacy_toggle_otp_verified',
          entityType: 'zalo_account',
          entityId: token.nickId ?? args.userId,
          category: 'security',
          details: { toggle: tokenAction, nickId: token.nickId ?? null, ip: args.ipAddress ?? null },
        },
      })
      .catch((e) => logger.warn(`[privacy-otp] toggle audit log fail: ${String(e)}`));
    logger.info(`[privacy-otp] toggle OTP verified user=${args.userId} action=${tokenAction} nick=${token.nickId ?? '-'}`);
    return { action: tokenAction };
  }

  // ── NHÁNH MỞ KHOÁ XEM (unlock): tạo UserPrivacySession + revoke prior + send confirmation ──
  const sessionToken = genSessionToken();
  const unlockedAt = new Date();
  const expiresAt = new Date(unlockedAt.getTime() + token.sessionDurationMinutes * 60 * 1000);

  await tenantTransaction(async (tx) => {
    // Mark token used
    await tx.privacyOtpToken.update({ where: { id: token.id }, data: { usedAt: unlockedAt } });
    // Reset failed count + clear lock
    await tx.user.update({
      where: { id: args.userId },
      data: { privacyFailedCount: 0, privacyLockedUntil: null },
    });
    // Revoke prior active sessions (giống PIN flow — max 1 active)
    await tx.userPrivacySession.updateMany({
      where: { userId: args.userId, revokedAt: null },
      data: { revokedAt: unlockedAt },
    });
    await tx.userPrivacySession.create({
      data: {
        userId: args.userId,
        sessionToken,
        unlockedAt,
        expiresAt,
        ipHash: hashIp(args.ipAddress ?? undefined),
        ipAddress: args.ipAddress?.slice(0, 45) ?? null,
        userAgent: args.userAgent?.slice(0, 200) ?? null,
      },
    });
  });

  // Audit log + send confirm Zalo (fire-and-forget)
  void prisma.activityLog
    .create({
      data: {
        orgId: args.orgId,
        userId: args.userId,
        action: 'privacy_unlock',
        entityType: 'user',
        entityId: args.userId,
        category: 'security',
        details: {
          method: 'otp',
          durationMinutes: token.sessionDurationMinutes,
          browser: parseBrowserName(args.userAgent),
          ip: args.ipAddress ?? null,
        },
      },
    })
    .catch((e) => logger.warn(`[privacy-otp] activity log fail: ${String(e)}`));

  const target = await resolveZaloTarget(args.userId, args.orgId);
  if (target) {
    void sendUnlockConfirmation({
      senderId: target.senderId,
      targetUid: target.targetUid,
      unlockedAt,
      expiresAt,
      durationMinutes: token.sessionDurationMinutes,
      browser: parseBrowserName(args.userAgent),
      ipAddress: args.ipAddress ?? '—',
    });
  }

  logger.info(`[privacy-otp] unlock OK user=${args.userId} duration=${token.sessionDurationMinutes}m`);
  return { action: 'unlock', sessionToken, expiresAt, durationMinutes: token.sessionDurationMinutes as SessionDuration };
}

// ── Op 3: Admin reset lock ─────────────────────────────────────────────────

/** Owner/admin clear lock for sale (forgot/offline Zalo recovery). */
export async function adminResetOtpLock(targetUserId: string): Promise<void> {
  await tenantTransaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { privacyFailedCount: 0, privacyLockedUntil: null },
    });
    // Invalidate pending tokens
    await tx.privacyOtpToken.updateMany({
      where: { userId: targetUserId, usedAt: null },
      data: { usedAt: new Date(), verifyAttempts: OTP_MAX_VERIFY_ATTEMPTS },
    });
  });
  logger.info(`[privacy-otp] admin reset lock user=${targetUserId}`);
}

// ── Op 4: Status (cho FE biết user có thể unlock hay đang lock) ───────────

export interface OtpStatus {
  /** User có internal contact ready để nhận OTP không */
  canRequestOtp: boolean;
  /** Lý do nếu canRequestOtp=false */
  blockedReason: 'no_internal_contact' | 'locked' | null;
  /** Còn bao lâu mới hết lock */
  lockedUntil: Date | null;
  /** 2026-06-11 (rule badge): user đã đặt ≥1 nick Riêng tư (privacyMode='main') chưa.
   *  FE dùng để phân biệt: chưa bật → dialog mời cài đặt; đã bật → dialog mở khoá. */
  hasPrivateNick: boolean;
  /** Thông tin nick nhận OTP để FE hiển thị "gửi qua Zalo {SĐT} - {Tên}" — đây là
   *  Zalo CHÍNH của user (SĐT user đặt liên lạc nội bộ + tên nick nội bộ). */
  internalContact: { phone: string | null; nickName: string | null } | null;
}

export async function getOtpStatus(userId: string, orgId: string): Promise<OtpStatus> {
  const [user, target, privateNickCount, internalNick] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { privacyLockedUntil: true, phone: true },
    }),
    resolveZaloTarget(userId, orgId),
    // Đếm nick Riêng tư của chính user (owner) — quyết định hasPrivateNick.
    prisma.zaloAccount.count({
      where: { orgId, ownerUserId: userId, privacyMode: 'main', archivedAt: null },
    }),
    // Tên nick liên lạc nội bộ của org (nick hệ thống gửi OTP đi).
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { systemNotifyNick: { select: { displayName: true } } },
    }),
  ]);

  const hasPrivateNick = privateNickCount > 0;
  const internalContact = {
    phone: user?.phone ?? null,
    nickName: internalNick?.systemNotifyNick?.displayName ?? null,
  };

  if (user?.privacyLockedUntil && user.privacyLockedUntil > new Date()) {
    return { canRequestOtp: false, blockedReason: 'locked', lockedUntil: user.privacyLockedUntil, hasPrivateNick, internalContact };
  }
  if (!target) {
    return { canRequestOtp: false, blockedReason: 'no_internal_contact', lockedUntil: null, hasPrivateNick, internalContact };
  }
  return { canRequestOtp: true, blockedReason: null, lockedUntil: null, hasPrivateNick, internalContact };
}
