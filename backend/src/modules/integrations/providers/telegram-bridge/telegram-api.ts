/**
 * telegram-api.ts — Bot API client mỏng cho Cầu Telegram (Phase 1).
 * Dùng fetch trực tiếp (cùng kiểu telegram-bot.ts). Token đọc qua telegram-bridge-config.
 *
 * Có RETRY: 'fetch failed' (nghẽn mạng thoáng qua) thử lại 1 lần → 1 cú nghẽn không làm
 * rớt tin (quan trọng cho cầu). Lỗi Telegram trả về (ok:false) thì KHÔNG retry (lỗi thật).
 */
import { getTelegramBotToken } from '../../../../shared/telegram-bridge-config.js';
import { logger } from '../../../../shared/utils/logger.js';

const BASE = 'https://api.telegram.org';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!data.ok) {
        logger.warn(`[telegram-bridge] ${method} lỗi: ${data.description}`); // lỗi Telegram → không retry
        return null;
      }
      return data.result ?? null;
    } catch (err) {
      if (attempt < 2) {
        await delay(600);
        continue; // nghẽn mạng thoáng qua → thử lại 1 lần
      }
      logger.warn(`[telegram-bridge] ${method} exception (sau retry): ${String(err)}`);
      return null;
    }
  }
  return null;
}

/** Tạo forum topic mới trong supergroup → trả message_thread_id (null nếu lỗi). */
export async function createForumTopic(chatId: string, name: string): Promise<number | null> {
  const r = await call<{ message_thread_id: number }>('createForumTopic', {
    chat_id: chatId,
    name: name.slice(0, 128) || 'Khách',
  });
  return r?.message_thread_id ?? null;
}

/** Gửi text vào group (kèm topic nếu có threadId). Trả true nếu gửi được. */
export async function sendMessage(chatId: string, text: string, threadId?: number): Promise<boolean> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (threadId) body.message_thread_id = threadId;
  return (await call('sendMessage', body)) !== null;
}

export type SendMediaMethod = 'sendPhoto' | 'sendVideo' | 'sendAudio' | 'sendDocument';
export type SendMediaField = 'photo' | 'video' | 'audio' | 'document';

/**
 * Upload bytes media lên Telegram (multipart). Dùng cho dev vì URL minio nội bộ
 * (localhost:9000) Telegram không fetch được → phải gửi thẳng bytes.
 * Retry 1 lần khi nghẽn mạng (rebuild form mỗi lần vì body đã tiêu thụ).
 */
export async function sendMedia(
  chatId: string,
  method: SendMediaMethod,
  field: SendMediaField,
  buffer: Buffer,
  filename: string,
  caption: string,
  threadId?: number,
): Promise<boolean> {
  const token = getTelegramBotToken();
  if (!token) return false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      if (threadId) form.append('message_thread_id', String(threadId));
      if (caption) {
        form.append('caption', caption.slice(0, 1024));
        form.append('parse_mode', 'HTML');
      }
      form.append(field, new Blob([new Uint8Array(buffer)]), filename || 'file');
      const res = await fetch(`${BASE}/bot${token}/${method}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        logger.warn(`[telegram-bridge] ${method} lỗi: ${data.description}`); // lỗi Telegram → không retry
        return false;
      }
      return true;
    } catch (err) {
      if (attempt < 2) {
        await delay(800);
        continue; // nghẽn mạng thoáng qua → thử lại 1 lần
      }
      logger.warn(`[telegram-bridge] ${method} exception (sau retry): ${String(err)}`);
      return false;
    }
  }
  return false;
}
