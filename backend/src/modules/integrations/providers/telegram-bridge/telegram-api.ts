// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * telegram-api.ts — Bot API client mỏng cho Cầu Telegram (Phase 1).
 * Dùng fetch trực tiếp (cùng kiểu telegram-bot.ts). Token đọc qua telegram-bridge-config.
 *
 * Có RETRY: 'fetch failed' (nghẽn mạng thoáng qua) thử lại 1 lần → 1 cú nghẽn không làm
 * rớt tin (quan trọng cho cầu). Lỗi Telegram trả về (ok:false) thì KHÔNG retry (lỗi thật).
 */
import { writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getTelegramBotToken } from '../../../../shared/telegram-bridge-config.js';
import { logger } from '../../../../shared/utils/logger.js';

const BASE = 'https://api.telegram.org';
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= 3; attempt++) {
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
      if (attempt < 3) {
        await delay(attempt * 700); // mạng chập chờn → backoff tăng dần (0.7s, 1.4s) rồi thử lại
        continue;
      }
      logger.warn(`[telegram-bridge] ${method} exception (sau 3 lần): ${String(err)}`);
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

export interface TgMessageUpdate {
  update_id: number;
  message?: {
    message_id: number;
    message_thread_id?: number;
    chat: { id: number; type: string };
    from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
    document?: { file_id: string; file_name?: string; mime_type?: string };
    video?: { file_id: string; file_name?: string };
    voice?: { file_id: string };
    audio?: { file_id: string; file_name?: string };
    sticker?: { file_id: string };
  };
}

/**
 * Tải 1 file Telegram (theo file_id) về path tạm → trả đường dẫn local (null nếu lỗi).
 * zca-js gửi media cần LOCAL PATH (không nhận URL). Caller tự xoá file sau khi gửi.
 */
export async function downloadTelegramFile(fileId: string, filename: string): Promise<string | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  try {
    const info = await call<{ file_path?: string }>('getFile', { file_id: fileId });
    const fp = info?.file_path;
    if (!fp) return null;
    const res = await fetch(`${BASE}/file/bot${token}/${fp}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // GIỮ TÊN GỐC làm basename (Zalo lấy basename làm tên hiển thị cho khách + CRM). Đặt trong
    // thư mục con ngẫu nhiên để tránh trùng tên. Lọc ký tự nguy hiểm + ép có đuôi.
    let safeName = (filename || 'file').replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'file';
    if (!path.extname(safeName)) safeName += path.extname(fp) || '';
    const dir = path.join(os.tmpdir(), 'tg-bridge', randomUUID());
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, safeName);
    await writeFile(tmp, buf);
    return tmp;
  } catch (err) {
    logger.warn(`[telegram-bridge] tải file Telegram lỗi: ${String(err)}`);
    return null;
  }
}

/** Xoá file tạm + thư mục con chứa nó (gọi sau khi gửi Zalo xong). */
export async function cleanupTempFile(tmp: string): Promise<void> {
  await rm(path.dirname(tmp), { recursive: true, force: true }).catch(() => {});
}

/**
 * Long-poll getUpdates (chiều RA — nhận tin sale gõ trong topic). offset=-1 lấy update mới
 * nhất (dùng để drain update cũ lúc boot). timeoutSec = thời gian Telegram giữ kết nối chờ.
 */
export async function getUpdates(offset: number, timeoutSec = 25): Promise<TgMessageUpdate[] | null> {
  const token = getTelegramBotToken();
  if (!token) return [];
  try {
    const url = `${BASE}/bot${token}/getUpdates?offset=${offset}&timeout=${timeoutSec}&allowed_updates=${encodeURIComponent('["message"]')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeoutSec + 20) * 1000) });
    const data = (await res.json()) as { ok: boolean; result?: TgMessageUpdate[] };
    return data.ok ? data.result ?? [] : [];
  } catch (err) {
    // null = lỗi mạng (long-poll tới api.telegram.org chập chờn) → loop tự backoff + retry.
    logger.debug(`[telegram-bridge] getUpdates lỗi (sẽ retry): ${String(err)}`);
    return null;
  }
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
  for (let attempt = 1; attempt <= 3; attempt++) {
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
      if (attempt < 3) {
        await delay(attempt * 900); // mạng chập chờn → backoff (0.9s, 1.8s) rồi thử lại
        continue;
      }
      logger.warn(`[telegram-bridge] ${method} exception (sau 3 lần): ${String(err)}`);
      return false;
    }
  }
  return false;
}
