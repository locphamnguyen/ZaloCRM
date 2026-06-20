/**
 * link.ts — Phase 3.1: gắn tài khoản Telegram ↔ user CRM.
 *
 * CRM sinh mã ngắn (TTL 10') → sale gõ `/link <mã>` cho bot trong Telegram → tạo
 * TelegramUserLink. Mã lưu in-memory (mất khi restart — không sao, mã ngắn hạn, xin lại).
 * Dùng cho enforce quyền (Phase 3.2): biết "ai gõ" → checkZaloAccess.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';

interface PendingCode {
  userId: string;
  orgId: string;
  expiry: number;
}
const codes = new Map<string, PendingCode>();
const TTL_MS = 60 * 60 * 1000; // 60' — đủ thoáng cho luồng bấm-nút-CRM rồi gõ /link

/** Sinh mã liên kết 6 ký tự cho 1 user CRM (TTL 10 phút). */
export function generateLinkCode(userId: string, orgId: string): string {
  const now = Date.now();
  for (const [c, v] of codes) if (now > v.expiry) codes.delete(c); // dọn mã hết hạn
  const code = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  codes.set(code, { userId, orgId, expiry: now + TTL_MS });
  return code;
}

/** Sale gõ /link <mã> → gắn telegramUserId với user CRM. */
export async function redeemLinkCode(code: string, telegramUserId: string): Promise<boolean> {
  const key = code.trim().toUpperCase();
  const entry = codes.get(key);
  if (!entry || Date.now() > entry.expiry) return false;
  codes.delete(key);
  await prisma.telegramUserLink.upsert({
    where: { telegramUserId },
    create: { telegramUserId, userId: entry.userId, orgId: entry.orgId },
    update: { userId: entry.userId, orgId: entry.orgId },
  });
  logger.info(`[telegram-bridge] đã gắn telegram ${telegramUserId} → user CRM ${entry.userId}`);
  return true;
}

/** Tra user CRM theo telegramUserId (null nếu chưa /link). */
export async function getLinkedUser(
  telegramUserId: string,
): Promise<{ userId: string; orgId: string } | null> {
  return prisma.telegramUserLink.findUnique({
    where: { telegramUserId },
    select: { userId: true, orgId: true },
  });
}
