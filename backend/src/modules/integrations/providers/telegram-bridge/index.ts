// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * telegram-bridge/index.ts — Cầu Zalo → Telegram (Phase 1: chiều VÀO / mirror).
 *
 * Lắng nghe bridge-bus 'message.persisted' (phát hậu-commit từ message-handler) → với mỗi
 * tin mới trên nick ĐÃ BẬT cầu, format + gửi sang Telegram, mỗi hội thoại = 1 forum topic.
 *
 * Phase 1.4: media THẬT — tải bytes từ minio (qua getObjectBuffer) rồi upload thẳng lên
 * Telegram (multipart), vì URL kho nội bộ (localhost:9000) Telegram không fetch được. Tải/
 * upload lỗi → fallback gửi nhãn loại ([Ảnh]/[Tệp]...). Chiều RA + chống lặp = Phase 2.
 */
import { bridgeBus, type MessagePersistedEvent } from '../../../../shared/bridge-bus.js';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { isTelegramBridgeConfigured } from '../../../../shared/telegram-bridge-config.js';
import { getObjectBuffer, keyFromPublicUrl } from '../../../../shared/storage/minio-client.js';
import {
  createForumTopic,
  sendMessage,
  sendMedia,
  type SendMediaMethod,
  type SendMediaField,
} from './telegram-api.js';
import { startTelegramReceiver, wasSentByBridge } from './receiver.js';

let started = false;

export function initTelegramBridge(): void {
  if (started) return;
  if (!isTelegramBridgeConfigured()) {
    logger.info('[telegram-bridge] chưa cấu hình TELEGRAM_BRIDGE_BOT_TOKEN → cầu TẮT.');
    return;
  }
  started = true;
  bridgeBus.on('message.persisted', (ev: MessagePersistedEvent) => {
    void forwardMessage(ev); // fire-and-forget; lỗi nuốt bên trong
  });
  startTelegramReceiver(); // Phase 2 — chiều ra (long-poll getUpdates)
  logger.info('[telegram-bridge] BẬT — đang lắng nghe message.persisted + nhận chiều ra.');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Ánh xạ loại tin Zalo → method + field upload của Telegram.
const MEDIA_MAP: Record<string, { method: SendMediaMethod; field: SendMediaField; tag: string }> = {
  image: { method: 'sendPhoto', field: 'photo', tag: '🖼 [Ảnh]' },
  sticker: { method: 'sendPhoto', field: 'photo', tag: '🩷 [Sticker]' },
  video: { method: 'sendVideo', field: 'video', tag: '🎬 [Video]' },
  voice: { method: 'sendAudio', field: 'audio', tag: '🎤 [Tin thoại]' },
  file: { method: 'sendDocument', field: 'document', tag: '📎 [Tệp]' },
};

type ForwardMessage = {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderName: string | null;
  sentVia: string;
  metadata: unknown;
  sentAt: Date;
};
type ForwardConv = {
  zaloAccount: { displayName: string | null; owner: { fullName: string } };
};

async function forwardMessage(ev: MessagePersistedEvent): Promise<void> {
  try {
    const message = await prisma.message.findUnique({
      where: { id: ev.messageId },
      select: {
        id: true,
        zaloMsgId: true,
        content: true,
        contentType: true,
        senderType: true,
        senderName: true,
        sentVia: true,
        metadata: true,
        sentAt: true,
        conversation: {
          select: {
            id: true,
            threadType: true,
            contact: { select: { crmName: true, fullName: true } },
            zaloAccount: {
              select: {
                displayName: true,
                owner: { select: { fullName: true } },
                telegramBridge: { select: { enabled: true, telegramChatId: true } },
              },
            },
          },
        },
      },
    });
    if (!message) return;
    // Chống lặp: tin GỐC TỪ TELEGRAM (sentVia='bridge') hoặc msgId cầu vừa gửi → khỏi
    // re-forward về Telegram (sale đã gõ ở Telegram rồi).
    if (message.sentVia === 'bridge' || wasSentByBridge(message.zaloMsgId)) return;
    const conv = message.conversation;

    if (conv.threadType !== 'user') return; // chỉ chat 1-1 (bỏ nhóm Zalo)
    const cfg = conv.zaloAccount.telegramBridge;
    if (!cfg?.enabled || !cfg.telegramChatId) return;

    const chatId = cfg.telegramChatId;
    const customerName =
      conv.contact?.crmName || conv.contact?.fullName || message.senderName || 'Khách';
    const topicId = await getOrCreateTopic(conv.id, chatId, customerName);
    const label = buildLabel(message, conv, customerName);
    await sendToTelegram(chatId, message, label, topicId ?? undefined);
  } catch (err) {
    logger.warn(`[telegram-bridge] forward lỗi msg=${ev.messageId}: ${String(err)}`);
  }
}

async function getOrCreateTopic(
  conversationId: string,
  chatId: string,
  customerName: string,
): Promise<number | null> {
  const existing = await prisma.telegramTopicMap.findUnique({
    where: { conversationId },
    select: { telegramTopicId: true },
  });
  if (existing) {
    void prisma.telegramTopicMap
      .update({ where: { conversationId }, data: { lastActiveAt: new Date() } })
      .catch(() => {});
    return existing.telegramTopicId;
  }
  const topicId = await createForumTopic(chatId, customerName);
  if (topicId == null) return null;
  await prisma.telegramTopicMap
    .create({ data: { conversationId, telegramChatId: chatId, telegramTopicId: topicId } })
    .catch(() => {}); // race 2 tin cùng lúc → 1 cái thua unique, bỏ qua
  return topicId;
}

/** Dòng nhãn hướng + người gửi + giờ (bù cho việc bot = 1 người gửi). */
function buildLabel(message: ForwardMessage, conv: ForwardConv, customerName: string): string {
  let who: string;
  if (message.senderType === 'contact') {
    who = `👤 <b>${escapeHtml(customerName)}</b>`;
  } else if (message.sentVia === 'automation') {
    who = '🤖 <b>Tự động</b>';
  } else if (message.sentVia === 'system') {
    who = '🔔 <b>Hệ thống</b>';
  } else {
    const senderMeta = (message.metadata as { sender?: { name?: string } } | null)?.sender;
    const saleName =
      senderMeta?.name || conv.zaloAccount.owner.fullName || conv.zaloAccount.displayName || 'Sale';
    who = `✅ <b>${escapeHtml(saleName)}</b>`;
  }
  const time = new Date(message.sentAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return `${who} · ${time}`;
}

/** content của tin media là JSON {href,title}; tin text là chuỗi thường. */
function parseMediaContent(content: string | null): { href?: string; title?: string } | null {
  if (!content) return null;
  try {
    const o = JSON.parse(content) as { href?: string; title?: string };
    if (o && typeof o === 'object' && o.href) return { href: o.href, title: o.title };
  } catch {
    /* không phải JSON */
  }
  if (/^https?:\/\//.test(content)) return { href: content };
  return null;
}

async function sendToTelegram(
  chatId: string,
  message: ForwardMessage,
  label: string,
  threadId?: number,
): Promise<void> {
  const ct = message.contentType;

  // Text/link → gửi text kèm nhãn.
  if (ct === 'text' || ct === 'link') {
    await sendMessage(chatId, `${label}\n${escapeHtml(message.content || '')}`, threadId);
    return;
  }

  // Media → tải bytes từ minio rồi upload thẳng lên Telegram (caption = nhãn).
  const media = MEDIA_MAP[ct];
  if (media) {
    const parsed = parseMediaContent(message.content);
    if (parsed?.href) {
      const key = keyFromPublicUrl(parsed.href);
      const buffer = key ? await getObjectBuffer(key) : null;
      if (buffer) {
        const ok = await sendMedia(
          chatId,
          media.method,
          media.field,
          buffer,
          parsed.title || 'file',
          label,
          threadId,
        );
        if (ok) return;
      }
    }
    // Fallback: tải/upload lỗi → gửi nhãn loại.
    await sendMessage(chatId, `${label}\n${media.tag}`, threadId);
    return;
  }

  // Loại khác → text fallback.
  await sendMessage(chatId, `${label}\n${escapeHtml(message.content || `[${ct}]`)}`, threadId);
}
