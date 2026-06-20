// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * telegram-bot.ts — Send CRM notifications via Telegram Bot API.
 * Config shape: { botToken: string, chatId: string }
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

export async function sendTelegramNotification(
  orgId: string,
  config: TelegramConfig,
): Promise<{ direction: 'export'; recordCount: number; status: 'success' | 'failed'; errorMessage?: string }> {
  const { botToken, chatId } = config;

  if (!botToken || !chatId) {
    return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: 'Missing botToken or chatId' };
  }

  // Build daily summary
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [newContacts, todayMessages, pendingAppointments] = await Promise.all([
    prisma.contact.count({ where: { orgId, createdAt: { gte: today } } }),
    prisma.message.count({
      where: { conversation: { orgId }, createdAt: { gte: today } },
    }),
    prisma.appointment.count({
      where: { orgId, status: 'scheduled', appointmentDate: { gte: today } },
    }),
  ]);

  const text = [
    '📊 *ZaloCRM — Tóm tắt hôm nay*',
    '',
    `👤 Khách hàng mới: ${newContacts}`,
    `💬 Tin nhắn: ${todayMessages}`,
    `📅 Lịch hẹn chờ: ${pendingAppointments}`,
    '',
    `🕐 ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
  ].join('\n');

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error('[telegram-bot] API error:', body);
      return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: `Telegram API ${response.status}: ${body.slice(0, 200)}` };
    }

    logger.info(`[telegram-bot] Sent daily summary to chat ${chatId}`);
    return { direction: 'export', recordCount: 1, status: 'success' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { direction: 'export', recordCount: 0, status: 'failed', errorMessage: msg };
  }
}
