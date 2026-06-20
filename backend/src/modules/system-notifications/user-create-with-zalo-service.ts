// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * user-create-with-zalo-service.ts — Phase user-create-with-zalo 2026-05-27
 *
 * Service layer cho flow tạo user gộp Zalo handshake. Tách khỏi routes để testable.
 *
 * 3 ops chính:
 *   - checkZaloByPhone()       : findUser + getFriendRequestStatus + dedup warnings
 *   - createUserAndSendLogin() : tạo User + upsert SystemNotifyRecipient + auto-accept + send tin
 *   - resendLoginMessage()     : retry gửi tin (admin trigger, dùng lại pass đã có hash trong DB)
 *
 * Lưu ý quan trọng:
 *   - Password lưu DB là hash bcrypt; password gốc CHỈ trả về 1 lần trong response create
 *     (admin copy ngay), không lưu plaintext. Resend = phải generate password mới.
 *   - lookupUidByPhone cache forever (UID Zalo không đổi). Cache theo orgId+phone.
 *   - PhoneSearchEvent log mỗi lookup (đã có sẵn pattern trong system-notify-routes).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import {
  buildAdminFallbackMessage,
  buildWelcomeMessage,
  toZaloStyles,
  type WelcomeVariant,
} from './welcome-message-builder.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type FriendRelation = 'friend' | 'received_from_them' | 'sent_by_me' | 'none';

export interface ZaloPreview {
  uid: string;
  displayName: string;
  zaloName: string;
  avatar: string;
  gender: number | string;
  dob: number;
  sdob: string;
  globalId: string;
}

export interface CheckZaloResult {
  found: boolean;
  preview: ZaloPreview | null;
  relation: FriendRelation;
  rawStatus: {
    is_friend: number;
    is_requested: number;
    is_requesting: number;
    addFriendPrivacy: number;
    isSeenFriendReq: boolean;
  } | null;
  warnings: string[];
  /** Lỗi user-facing nếu lookup fail. */
  error: string | null;
}

export interface CreateUserInput {
  orgId: string;
  currentUserId: string;
  fullName: string;
  phone: string;            // user input raw, sẽ normalize
  email?: string | null;
  /** FIX codex MED-6: đây là Department.id, BE sẽ tạo DepartmentMember mapping mới. */
  departmentId?: string | null;
  permissionGroupId?: string | null;
  role?: string;            // legacy: 'member' default
  /** UID admin đã confirm trong Step 2 preview (BE re-verify bằng findUser trước khi tạo). */
  confirmedUid: string;
}

export class UserCreateWithZaloError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
  }
}

// ── Password generator ──────────────────────────────────────────────────────

/**
 * Sinh password 6 ký tự [a-z0-9] (entropy ~31 bits — yếu nhưng force-change-first-login mitigates).
 * Dùng crypto.randomBytes thay vì Math.random để không predictable.
 */
export function generateTempPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

// ── Phone lookup cache ──────────────────────────────────────────────────────

const phoneUidCache = new Map<string, ZaloPreview>(); // key = orgId|normalizedPhone

function cacheKey(orgId: string, phone: string) {
  return `${orgId}|${phone}`;
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim()).digest('hex');
}

async function logPhoneSearch(args: {
  orgId: string;
  accountId: string;
  userId: string;
  phone: string;
  result: string;
  foundUid: string | null;
  errorCode: string | null;
}) {
  try {
    await prisma.phoneSearchEvent.create({
      data: {
        orgId: args.orgId,
        accountId: args.accountId,
        userId: args.userId,
        phoneHash: hashPhone(args.phone),
        result: args.result,
        foundUid: args.foundUid,
        errorCode: args.errorCode,
      },
    });
  } catch (err) {
    logger.warn(`[user-create-with-zalo] phone-search-log failed: ${String(err)}`);
  }
}

function mapRelation(status: {
  is_friend: number;
  is_requested: number;
  is_requesting: number;
}): FriendRelation {
  if (status.is_friend === 1) return 'friend';
  if (status.is_requesting === 1) return 'received_from_them';
  if (status.is_requested === 1) return 'sent_by_me';
  return 'none';
}

// ── Op 1: Check phone ───────────────────────────────────────────────────────

export async function checkZaloByPhone(args: {
  orgId: string;
  currentUserId: string;
  phone: string;
}): Promise<CheckZaloResult> {
  const normalized = normalizePhone(args.phone);
  if (!normalized) {
    return {
      found: false,
      preview: null,
      relation: 'none',
      rawStatus: null,
      warnings: [],
      error: 'SĐT không hợp lệ',
    };
  }

  // Load org + system notify sender nick
  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: {
      systemNotifyZaloAccountId: true,
      systemNotifyNick: { select: { id: true, status: true, displayName: true } },
    },
  });
  if (!org?.systemNotifyZaloAccountId || !org.systemNotifyNick) {
    return {
      found: false,
      preview: null,
      relation: 'none',
      rawStatus: null,
      warnings: [],
      error: 'Org chưa setup nick gửi thông báo hệ thống. Vào Cài đặt → Thông báo hệ thống.',
    };
  }
  if (org.systemNotifyNick.status !== 'connected') {
    return {
      found: false,
      preview: null,
      relation: 'none',
      rawStatus: null,
      warnings: [],
      error: `Nick "${org.systemNotifyNick.displayName}" đang offline. Vui lòng kết nối lại trước khi check.`,
    };
  }

  const senderId = org.systemNotifyZaloAccountId;

  // Cache hit?
  const cached = phoneUidCache.get(cacheKey(args.orgId, normalized));
  let preview: ZaloPreview;
  if (cached) {
    preview = cached;
  } else {
    // findUser
    try {
      const result = (await zaloOps.findUser(senderId, normalized)) as Record<string, unknown>;
      const uid = String(result?.uid || '');
      if (!uid) {
        await logPhoneSearch({
          orgId: args.orgId, accountId: senderId, userId: args.currentUserId,
          phone: normalized, result: 'no_zalo', foundUid: null, errorCode: 'UID_EMPTY',
        });
        return {
          found: false,
          preview: null,
          relation: 'none',
          rawStatus: null,
          warnings: [],
          error: 'SĐT này không tìm thấy tài khoản Zalo nào',
        };
      }
      preview = {
        uid,
        displayName: String(result?.display_name ?? ''),
        zaloName: String(result?.zalo_name ?? ''),
        avatar: String(result?.avatar ?? ''),
        gender: (result?.gender as number) ?? 0,
        dob: Number(result?.dob ?? 0),
        sdob: String(result?.sdob ?? ''),
        globalId: String(result?.globalId ?? ''),
      };
      phoneUidCache.set(cacheKey(args.orgId, normalized), preview);
      await logPhoneSearch({
        orgId: args.orgId, accountId: senderId, userId: args.currentUserId,
        phone: normalized, result: 'found', foundUid: uid, errorCode: null,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const result = e?.code === 'NOT_CONNECTED' || e?.code === 'RATE_LIMITED'
        ? 'rate_limited'
        : 'lookup_failed';
      await logPhoneSearch({
        orgId: args.orgId, accountId: senderId, userId: args.currentUserId,
        phone: normalized, result, foundUid: null, errorCode: e?.code ?? null,
      });
      return {
        found: false,
        preview: null,
        relation: 'none',
        rawStatus: null,
        warnings: [],
        error: e?.message || 'Lookup Zalo thất bại',
      };
    }
  }

  // getFriendRequestStatus
  let rawStatus: CheckZaloResult['rawStatus'] = null;
  let relation: FriendRelation = 'none';
  try {
    const status = (await zaloOps.getFriendRequestStatus(senderId, preview.uid)) as Record<string, unknown>;
    rawStatus = {
      is_friend: Number(status?.is_friend ?? 0),
      is_requested: Number(status?.is_requested ?? 0),
      is_requesting: Number(status?.is_requesting ?? 0),
      addFriendPrivacy: Number(status?.addFriendPrivacy ?? 0),
      isSeenFriendReq: Boolean(status?.isSeenFriendReq ?? false),
    };
    relation = mapRelation(rawStatus);
  } catch (err) {
    logger.warn(`[user-create-with-zalo] getFriendRequestStatus failed: ${String(err)}`);
    // Không fatal — admin vẫn có thể tạo user, chỉ là không hiển thị relation chính xác.
  }

  // Warnings (dedup checks)
  const warnings: string[] = [];

  // 1. UID đã map cho user khác trong org?
  const existingRecipient = await prisma.systemNotifyRecipient.findFirst({
    where: {
      orgId: args.orgId,
      threadIdInSenderView: preview.uid,
      senderZaloAccountId: senderId,
    },
    select: { targetUser: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  if (existingRecipient?.targetUser) {
    warnings.push(
      `🧑 NHÂN VIÊN khác trong org đã dùng UID Zalo này: "${existingRecipient.targetUser.fullName}"` +
      (existingRecipient.targetUser.phone ? ` (${existingRecipient.targetUser.phone})` : ''),
    );
  }

  // 2. SĐT trùng với contact KH hiện có?
  // FIX 2026-05-27: Contact.phone lưu raw (vd "0931536109"), phoneNormalized lưu canonical (84xxx).
  // Trước đây em chỉ lookup theo phone normalized → miss vì format khác. Lookup cả 2 chiều.
  const matchContact = await prisma.contact.findFirst({
    where: {
      orgId: args.orgId,
      OR: [
        { phoneNormalized: normalized },
        { phone: normalized },
        { phone: args.phone },
      ],
    },
    select: { id: true, fullName: true, phone: true },
  });
  if (matchContact) {
    warnings.push(
      `📇 KHÁCH HÀNG đang có SĐT này: "${matchContact.fullName}" — chắc chắn đây là nhân viên chứ?`,
    );
  }

  // 3. SĐT đã có User khác?
  const matchUser = await prisma.user.findFirst({
    where: { orgId: args.orgId, phone: normalized },
    select: { id: true, fullName: true },
  });
  if (matchUser) {
    warnings.push(
      `🧑 NHÂN VIÊN khác đã có SĐT này: "${matchUser.fullName}" — nếu tiếp tục sẽ bị duplicate phone error`,
    );
  }

  return {
    found: true,
    preview,
    relation,
    rawStatus,
    warnings,
    error: null,
  };
}

// ── Op 2: Create user + send login ──────────────────────────────────────────

export interface CreateUserResult {
  user: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string;
    role: string;
  };
  /** Plaintext password — admin copy ngay, BE không lưu plaintext. */
  tempPassword: string;
  zalo: {
    relation: FriendRelation;
    /** Đã accept friend request từ sale không (chỉ true nếu relation='received_from_them'). */
    autoAccepted: boolean;
    /** Tin login đã gửi sale thành công (channel='zalo') hay fail (channel='crm_panel'). */
    messageSent: boolean;
    /** Channel mà sale nhận tin: 'inbox' = hộp chat chính, 'strangers' = tab Người lạ. */
    deliveryChannel: 'inbox' | 'strangers' | 'failed';
    /** Tin fallback đã gửi admin (nếu tin chính fail và org có adminFallbackPhone). */
    fallbackSentToAdmin: boolean;
    error: string | null;
  };
}

// ── Shared: send welcome to sale + fallback to admin ───────────────────────

/**
 * FIX bug 2026-05-27 "File not found": zca-js sendMessage attachments chỉ accept LOCAL FILE PATH
 * hoặc Buffer object, KHÔNG accept URL string. Em download URL từ MinIO → Buffer trước khi pass.
 * Return null nếu URL invalid/fetch fail → tin gửi không kèm ảnh (vẫn deliver text).
 */
async function fetchImageAsAttachment(
  url: string | null | undefined,
): Promise<{ data: Buffer; filename: `${string}.${string}`; metadata: { totalSize: number } } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`[user-create-with-zalo] welcome image fetch ${res.status}: ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Extract extension từ URL hoặc Content-Type
    const ctype = (res.headers.get('content-type') || '').split(';')[0].trim();
    const extFromMime =
      ctype === 'image/jpeg' ? 'jpg' :
      ctype === 'image/png' ? 'png' :
      ctype === 'image/webp' ? 'webp' :
      ctype === 'image/gif' ? 'gif' : '';
    const urlExt = (url.match(/\.([a-zA-Z0-9]+)(\?|$)/)?.[1] || '').toLowerCase();
    const ext = (urlExt && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(urlExt))
      ? (urlExt === 'jpeg' ? 'jpg' : urlExt)
      : (extFromMime || 'jpg');
    return {
      data: buf,
      filename: `welcome.${ext}` as `${string}.${string}`,
      metadata: { totalSize: buf.length },
    };
  } catch (err) {
    logger.warn(`[user-create-with-zalo] welcome image fetch err: ${(err as Error)?.message}`);
    return null;
  }
}

interface SendLoginParams {
  org: {
    name: string;
    systemNotifyZaloAccountId: string;
    welcomeMessageTemplate: string | null;
    welcomeImageUrl: string | null;
    adminFallbackPhone: string | null;
  };
  user: { id: string; fullName: string; email: string | null; phone: string; role: string };
  targetUid: string;
  finalRelation: FriendRelation;
  tempPassword: string;
  departmentName: string | null;
  roleName: string | null;
}

async function sendWelcomeAndFallback(p: SendLoginParams): Promise<CreateUserResult['zalo']> {
  const senderId = p.org.systemNotifyZaloAccountId;
  // Ưu tiên CRM_LOGIN_URL (override), rồi APP_URL (domain thật của deployment),
  // cuối cùng mới fallback hardcode (chỉ là phương án chót).
  const loginUrl = process.env.CRM_LOGIN_URL || process.env.APP_URL || 'https://zalo.hsholding.vn';

  const variant: WelcomeVariant = p.finalRelation === 'friend' ? 'friend' : 'stranger';
  // Build text trước (không cần attachment ở builder nữa — em xử attachment riêng dưới)
  const welcome = buildWelcomeMessage(p.org.welcomeMessageTemplate, {
    fullName: p.user.fullName,
    email: p.user.email,
    phone: p.user.phone,
    password: p.tempPassword,
    loginUrl,
    orgName: p.org.name,
    departmentName: p.departmentName,
    roleName: p.roleName,
    adminPhone: p.org.adminFallbackPhone,
    variant,
  });
  // FIX 2026-05-27 "File not found": download ảnh welcome qua HTTP → Buffer attachment
  // (zca-js không accept URL string trong attachments).
  const imageAttachment = await fetchImageAsAttachment(p.org.welcomeImageUrl);

  const limits = await zaloRateLimiter.checkLimits(senderId, 'message');
  if (!limits.allowed) {
    return {
      relation: p.finalRelation,
      autoAccepted: false,
      messageSent: false,
      deliveryChannel: 'failed',
      fallbackSentToAdmin: false,
      error: limits.reason || 'Rate limit',
    };
  }

  let messageSent = false;
  let deliveryChannel: 'inbox' | 'strangers' | 'failed' = 'failed';
  let sendError: string | null = null;
  try {
    const api = zaloPool.getApi(senderId);
    if (!api) throw new Error('Nick gửi hệ thống chưa connected trong pool');
    await zaloRateLimiter.recordSend(senderId, 'message');
    const payload: Record<string, unknown> = { msg: welcome.formatted.text };
    // FIX 2026-05-27 bug "tin login plain text": convert text-formatter format → zca-js Style
    const zaloStyles = toZaloStyles(welcome.formatted.styles);
    if (zaloStyles.length > 0) payload.styles = zaloStyles;
    if (imageAttachment) payload.attachments = imageAttachment;
    await api.sendMessage(payload, p.targetUid, 0);
    messageSent = true;
    deliveryChannel = p.finalRelation === 'friend' ? 'inbox' : 'strangers';
  } catch (err) {
    sendError = (err as Error)?.message || String(err);
    logger.warn(`[user-create-with-zalo] send to sale fail: ${sendError}`);
  }

  let fallbackSentToAdmin = false;
  if (!messageSent && p.org.adminFallbackPhone) {
    try {
      const adminPhoneNorm = normalizePhone(p.org.adminFallbackPhone);
      if (adminPhoneNorm) {
        const adminLookup = (await zaloOps.findUser(senderId, adminPhoneNorm)) as Record<string, unknown>;
        const adminUid = String(adminLookup?.uid || '');
        if (adminUid) {
          const fallbackText = buildAdminFallbackMessage({
            saleName: p.user.fullName,
            salePhone: p.user.phone,
            failureReason: sendError || 'Tin gửi sale thất bại',
            credentials: { email: p.user.email, phone: p.user.phone, password: p.tempPassword, loginUrl },
          });
          await zaloRateLimiter.recordSend(senderId, 'message');
          const api = zaloPool.getApi(senderId);
          if (api) {
            await api.sendMessage({ msg: fallbackText }, adminUid, 0);
            fallbackSentToAdmin = true;
          }
        }
      }
    } catch (fallbackErr) {
      logger.error(`[user-create-with-zalo] fallback to admin also fail: ${String(fallbackErr)}`);
    }
  }

  return {
    relation: p.finalRelation,
    autoAccepted: false,
    messageSent,
    deliveryChannel,
    fallbackSentToAdmin,
    error: sendError,
  };
}

/**
 * FIX codex MED-5 2026-05-27: thay 2s fixed sleep bằng poll getFriendRequestStatus
 * cho đến khi is_friend=1, timeout 10s. Nếu không kịp → fallback relation='none' (Strangers).
 */
async function waitForFriendshipPropagation(senderId: string, uid: string, maxMs = 10000): Promise<boolean> {
  const start = Date.now();
  const interval = 800;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const status = (await zaloOps.getFriendRequestStatus(senderId, uid)) as Record<string, unknown>;
      if (Number(status?.is_friend ?? 0) === 1) return true;
    } catch (err) {
      logger.debug(`[user-create-with-zalo] poll friend status err: ${String(err)}`);
    }
  }
  return false;
}

export async function createUserAndSendLogin(input: CreateUserInput): Promise<CreateUserResult> {
  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone) {
    throw new UserCreateWithZaloError(400, 'INVALID_PHONE', 'SĐT không hợp lệ');
  }
  if (!input.fullName?.trim()) {
    throw new UserCreateWithZaloError(400, 'INVALID_NAME', 'Họ tên bắt buộc');
  }
  if (!input.confirmedUid) {
    throw new UserCreateWithZaloError(400, 'MISSING_CONFIRMED_UID', 'Phải confirm UID trước khi tạo');
  }

  // Re-check phone uniqueness (org-scoped + global). FIX codex MED-7: pre-check global cũng
  // để 409 sạch thay vì Prisma P2002 unhandled (User.phone @unique global trong schema).
  const dup = await prisma.user.findFirst({
    where: { phone: normalizedPhone },
    select: { id: true, orgId: true },
  });
  if (dup) {
    throw new UserCreateWithZaloError(
      409,
      'DUPLICATE_PHONE',
      dup.orgId === input.orgId
        ? 'SĐT đã được dùng cho user khác trong org'
        : 'SĐT đã được dùng cho user ở tổ chức khác',
    );
  }

  // Load org + system notify sender
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: {
      name: true,
      systemNotifyZaloAccountId: true,
      welcomeMessageTemplate: true,
      welcomeImageUrl: true,
      adminFallbackPhone: true,
      systemNotifyNick: { select: { id: true, status: true, displayName: true } },
    },
  });
  if (!org?.systemNotifyZaloAccountId || !org.systemNotifyNick) {
    throw new UserCreateWithZaloError(400, 'NO_SYSTEM_NOTIFY_SENDER', 'Org chưa setup nick gửi thông báo hệ thống');
  }
  if (org.systemNotifyNick.status !== 'connected') {
    throw new UserCreateWithZaloError(400, 'SENDER_DISCONNECTED', `Nick "${org.systemNotifyNick.displayName}" đang offline`);
  }
  const senderId = org.systemNotifyZaloAccountId;

  // FIX codex HIGH-2 2026-05-27: BE phải re-verify confirmedUid khớp với phone admin nhập.
  // Tránh attack: admin/MITM swap confirmedUid → credentials gửi cho người khác.
  // findUser cache forever nên không tốn thêm SDK call nếu đã check phone trước đó.
  // UI refactor 2026-05-27: cũng lưu avatar Zalo từ findUser response → User.avatarUrl.
  let serverUid: string;
  let zaloAvatar: string | null = null;
  try {
    const lookup = (await zaloOps.findUser(senderId, normalizedPhone)) as Record<string, unknown>;
    serverUid = String(lookup?.uid || '');
    zaloAvatar = String(lookup?.avatar || '') || null;
    if (!serverUid) {
      throw new UserCreateWithZaloError(400, 'UID_NOT_FOUND', 'Không tìm thấy UID Zalo từ SĐT này');
    }
  } catch (err) {
    if (err instanceof UserCreateWithZaloError) throw err;
    throw new UserCreateWithZaloError(503, 'LOOKUP_FAILED', `Re-verify UID thất bại: ${(err as Error)?.message}`);
  }
  if (serverUid !== input.confirmedUid) {
    throw new UserCreateWithZaloError(
      409,
      'UID_MISMATCH',
      'UID đã thay đổi từ lúc anh check. Vui lòng quay lại Step 1 check lại SĐT.',
    );
  }

  // FIX codex HIGH-1 reinforce: app-level precheck (race vẫn có thể, DB unique index ở migration là backstop)
  const existingUidRecipient = await prisma.systemNotifyRecipient.findFirst({
    where: { senderZaloAccountId: senderId, threadIdInSenderView: input.confirmedUid },
    select: { targetUserId: true, targetUser: { select: { fullName: true } } },
  });
  if (existingUidRecipient) {
    throw new UserCreateWithZaloError(
      409,
      'UID_TAKEN',
      `UID Zalo này đã được map cho user "${existingUidRecipient.targetUser?.fullName ?? '???'}"`,
    );
  }

  // FIX codex HIGH-3 + MED-6 2026-05-27: validate permissionGroupId + departmentId in-org + active.
  if (input.permissionGroupId) {
    const group = await prisma.permissionGroup.findFirst({
      where: { id: input.permissionGroupId, orgId: input.orgId, archivedAt: null },
      select: { id: true },
    });
    if (!group) {
      throw new UserCreateWithZaloError(400, 'INVALID_PERMISSION_GROUP', 'Nhóm quyền không tồn tại trong tổ chức');
    }
  }
  if (input.departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: input.departmentId, orgId: input.orgId, archivedAt: null },
      select: { id: true },
    });
    if (!dept) {
      throw new UserCreateWithZaloError(400, 'INVALID_DEPARTMENT', 'Phòng ban không tồn tại trong tổ chức');
    }
  }

  // Generate password + hash
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  // Email uniqueness pre-check (sạch hơn handle P2002 thô)
  const trimmedEmail = input.email ? input.email.toLowerCase().trim() : null;
  if (trimmedEmail) {
    const dupEmail = await prisma.user.findUnique({ where: { email: trimmedEmail } });
    if (dupEmail) {
      throw new UserCreateWithZaloError(409, 'DUPLICATE_EMAIL', 'Email đã tồn tại');
    }
  }

  // FIX codex MED-4 2026-05-27: tạo User + SystemNotifyRecipient + optional DepartmentMember
  // TRONG 1 transaction TRƯỚC khi gọi Zalo SDK (acceptFriendRequest). Tránh trạng thái
  // "đã accept friend nhưng user không tồn tại" nếu DB fail.
  const userId = randomUUID();
  let user: { id: string; fullName: string; email: string | null; phone: string | null; role: string };
  try {
    const txResult = await tenantTransaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          id: userId,
          orgId: input.orgId,
          email: trimmedEmail,
          phone: normalizedPhone,
          fullName: input.fullName.trim(),
          passwordHash,
          role: input.role ?? 'member',
          permissionGroupId: input.permissionGroupId ?? null,
          passwordChangedAt: null,
          // UI refactor 2026-05-27 — avatar Zalo lấy lúc findUser, lưu để render UsersRbacView
          avatarUrl: zaloAvatar,
          onboardingStepsCompleted: undefined as never,
        },
        select: { id: true, fullName: true, email: true, phone: true, role: true },
      });
      // FIX codex MED-6: tạo DepartmentMember nếu admin chọn department.
      if (input.departmentId) {
        await tx.departmentMember.create({
          data: {
            id: randomUUID(),
            userId: u.id,
            departmentId: input.departmentId,
            deptRole: 'member',
          },
        });
      }
      // Upsert SystemNotifyRecipient — DB unique (senderZaloAccountId, threadIdInSenderView) là backstop race.
      await tx.systemNotifyRecipient.upsert({
        where: {
          targetUserId_senderZaloAccountId: { targetUserId: userId, senderZaloAccountId: senderId },
        },
        create: {
          orgId: input.orgId,
          targetUserId: userId,
          senderZaloAccountId: senderId,
          threadIdInSenderView: input.confirmedUid,
          status: 'ready',
          lastVerifiedAt: new Date(),
        },
        update: {
          threadIdInSenderView: input.confirmedUid,
          status: 'ready',
          lastVerifiedAt: new Date(),
          error: null,
        },
      });
      return u;
    });
    user = txResult;
  } catch (err) {
    // FIX codex MED-7: catch Prisma race errors → 409 sạch
    const code = (err as { code?: string })?.code;
    if (code === 'P2002') {
      throw new UserCreateWithZaloError(
        409,
        'RACE_UNIQUE_VIOLATION',
        'Có admin khác vừa tạo user/UID trùng. Vui lòng kiểm tra danh sách rồi thử lại.',
      );
    }
    throw err;
  }

  // FIX codex MED-4 cont: auto-accept friend SAU khi DB committed. Nếu accept fail,
  // user vẫn tồn tại trong DB — admin có thể resend sau (tin sẽ vào Strangers).
  let autoAccepted = false;
  let finalRelation: FriendRelation = 'none';
  // Re-check current relation lúc gửi tin (admin click confirm sau N giây, có thể đổi).
  try {
    const status = (await zaloOps.getFriendRequestStatus(senderId, input.confirmedUid)) as Record<string, unknown>;
    finalRelation = mapRelation({
      is_friend: Number(status?.is_friend ?? 0),
      is_requested: Number(status?.is_requested ?? 0),
      is_requesting: Number(status?.is_requesting ?? 0),
    });
  } catch {
    /* keep 'none' */
  }

  if (finalRelation === 'received_from_them') {
    try {
      await zaloOps.acceptFriendRequest(senderId, input.confirmedUid);
      // FIX codex MED-5: poll thay vì sleep fixed.
      const propagated = await waitForFriendshipPropagation(senderId, input.confirmedUid);
      if (propagated) {
        autoAccepted = true;
        finalRelation = 'friend';
      } else {
        // accept thành công nhưng relation chưa "friend" sau 10s → fallback relation='none'
        logger.warn(`[user-create-with-zalo] friend propagation timeout uid=${input.confirmedUid}, falling back to Strangers delivery`);
        finalRelation = 'none';
      }
    } catch (err) {
      logger.warn(`[user-create-with-zalo] acceptFriendRequest fail uid=${input.confirmedUid}: ${String(err)}`);
      finalRelation = 'none';
    }
  }

  // Resolve names cho template (best effort)
  const deptMember = input.departmentId
    ? await prisma.department.findUnique({
        where: { id: input.departmentId },
        select: { name: true },
      })
    : null;
  const permGroup = input.permissionGroupId
    ? await prisma.permissionGroup.findUnique({
        where: { id: input.permissionGroupId },
        select: { name: true },
      })
    : null;

  const zaloResult = await sendWelcomeAndFallback({
    org: {
      name: org.name,
      systemNotifyZaloAccountId: senderId,
      welcomeMessageTemplate: org.welcomeMessageTemplate,
      welcomeImageUrl: org.welcomeImageUrl,
      adminFallbackPhone: org.adminFallbackPhone,
    },
    user: { ...user, phone: input.phone, email: user.email },
    targetUid: input.confirmedUid,
    finalRelation,
    tempPassword,
    departmentName: deptMember?.name ?? null,
    roleName: permGroup?.name ?? null,
  });
  zaloResult.autoAccepted = autoAccepted;

  logger.info(
    `[user-create-with-zalo] user=${user.id} (${user.fullName}, ${input.phone}) ` +
      `relation=${finalRelation} autoAccepted=${autoAccepted} ` +
      `sent=${zaloResult.messageSent} delivery=${zaloResult.deliveryChannel} fallback=${zaloResult.fallbackSentToAdmin}`,
  );

  return {
    user: { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone!, role: user.role },
    tempPassword,
    zalo: zaloResult,
  };
}

// ── Op 3: Resend login message ──────────────────────────────────────────────

/**
 * Admin retry gửi tin login khi tin trước đó fail (sale chưa nhận được hoặc tin lạc).
 * Phải GENERATE PASSWORD MỚI (BE không lưu plaintext, không thể resend pass cũ).
 * User cũng được update passwordChangedAt=null để force-change-on-next-login.
 */
export async function resendLoginMessage(args: {
  orgId: string;
  currentUserId: string;
  targetUserId: string;
}): Promise<CreateUserResult> {
  const target = await prisma.user.findFirst({
    where: { id: args.targetUserId, orgId: args.orgId },
    select: {
      id: true, fullName: true, email: true, phone: true, role: true,
      permissionGroupId: true,
      permissionGroup: { select: { name: true } },
      departmentMember: { select: { id: true, deptRole: true, department: { select: { name: true } } } },
    },
  });
  if (!target) {
    throw new UserCreateWithZaloError(404, 'USER_NOT_FOUND', 'User không tồn tại trong org');
  }
  if (!target.phone) {
    throw new UserCreateWithZaloError(400, 'USER_NO_PHONE', 'User không có SĐT để gửi lại login');
  }

  const recipient = await prisma.systemNotifyRecipient.findFirst({
    where: { orgId: args.orgId, targetUserId: target.id },
    select: { threadIdInSenderView: true, senderZaloAccountId: true },
  });
  if (!recipient?.threadIdInSenderView) {
    throw new UserCreateWithZaloError(400, 'USER_NO_ZALO_LINK', 'User chưa có UID Zalo — vào Sửa nick nhận thông báo để setup');
  }

  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: {
      name: true,
      systemNotifyZaloAccountId: true,
      welcomeMessageTemplate: true,
      welcomeImageUrl: true,
      adminFallbackPhone: true,
    },
  });
  if (!org?.systemNotifyZaloAccountId) {
    throw new UserCreateWithZaloError(400, 'NO_SYSTEM_NOTIFY_SENDER', 'Org đã bỏ nick gửi thông báo hệ thống');
  }
  const senderId = org.systemNotifyZaloAccountId;

  // Generate new password + update user
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash, passwordChangedAt: null, jwtTokenVersion: { increment: 1 } },
  });

  // Re-check relation + auto-accept if pending
  let relation: FriendRelation = 'none';
  let autoAccepted = false;
  try {
    const status = (await zaloOps.getFriendRequestStatus(senderId, recipient.threadIdInSenderView)) as Record<string, unknown>;
    relation = mapRelation({
      is_friend: Number(status?.is_friend ?? 0),
      is_requested: Number(status?.is_requested ?? 0),
      is_requesting: Number(status?.is_requesting ?? 0),
    });
  } catch {
    /* keep relation='none' */
  }
  if (relation === 'received_from_them') {
    try {
      await zaloOps.acceptFriendRequest(senderId, recipient.threadIdInSenderView);
      // FIX codex MED-5: poll thay vì sleep fixed.
      const propagated = await waitForFriendshipPropagation(senderId, recipient.threadIdInSenderView);
      if (propagated) {
        relation = 'friend';
        autoAccepted = true;
      } else {
        relation = 'none';
      }
    } catch {
      relation = 'none';
    }
  }

  const zaloResult = await sendWelcomeAndFallback({
    org: {
      name: org.name,
      systemNotifyZaloAccountId: senderId,
      welcomeMessageTemplate: org.welcomeMessageTemplate,
      welcomeImageUrl: org.welcomeImageUrl,
      adminFallbackPhone: org.adminFallbackPhone,
    },
    user: { id: target.id, fullName: target.fullName, email: target.email, phone: target.phone, role: target.role },
    targetUid: recipient.threadIdInSenderView,
    finalRelation: relation,
    tempPassword,
    departmentName: target.departmentMember?.department?.name ?? null,
    roleName: target.permissionGroup?.name ?? target.departmentMember?.deptRole ?? null,
  });
  zaloResult.autoAccepted = autoAccepted;

  logger.info(
    `[user-create-with-zalo] RESEND user=${target.id} (${target.fullName}) ` +
      `relation=${relation} sent=${zaloResult.messageSent} delivery=${zaloResult.deliveryChannel}`,
  );

  return {
    user: { id: target.id, fullName: target.fullName, email: target.email, phone: target.phone!, role: target.role },
    tempPassword,
    zalo: zaloResult,
  };
}
