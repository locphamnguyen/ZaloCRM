// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * telegram-bridge-config.ts — Cấu hình Cầu Telegram (Phase 0, tối thiểu).
 *
 * - Bot token: đọc từ env TELEGRAM_BRIDGE_BOT_TOKEN (anh tạo bot qua BotFather + đưa token).
 *   Phase 3 sẽ chuyển sang lưu per-org trong DB; giờ 1 token/triển khai là đủ cho wedge.
 * - Cờ "bật cầu theo nick" + telegramChatId: nằm ở bảng TelegramBridgeConfig (per nick).
 *
 * Phase 0 chỉ là khung đọc config — chưa kết nối Telegram (Phase 1 mới connect).
 */
import { prisma } from './database/prisma-client.js';

/** Token bot Telegram (null nếu chưa cấu hình → cầu coi như tắt). */
export function getTelegramBotToken(): string | null {
  const t = process.env.TELEGRAM_BRIDGE_BOT_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

/** Cầu Telegram có khả dụng ở mức hệ thống không (đã có token chưa). */
export function isTelegramBridgeConfigured(): boolean {
  return getTelegramBotToken() !== null;
}

/**
 * Đọc cấu hình cầu của 1 nick. Trả null nếu nick chưa có cấu hình.
 * enabled=false hoặc telegramChatId=null → chưa sẵn sàng mirror.
 */
export async function getNickBridgeConfig(zaloAccountId: string) {
  return prisma.telegramBridgeConfig.findUnique({
    where: { zaloAccountId },
    select: { enabled: true, telegramChatId: true, orgId: true },
  });
}

/** Nick này có đang bật cầu + đã provision group chưa (sẵn sàng mirror). */
export async function isNickBridgeReady(zaloAccountId: string): Promise<boolean> {
  if (!isTelegramBridgeConfigured()) return false;
  const cfg = await getNickBridgeConfig(zaloAccountId);
  return !!(cfg?.enabled && cfg.telegramChatId);
}
