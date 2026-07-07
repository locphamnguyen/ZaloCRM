// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * session-crypto.ts — Mã hoá at-rest cho ZaloAccount.sessionData (cookie đăng nhập Zalo).
 *
 * Dùng ENCRYPTION_KEY sẵn có (bắt buộc ≥32 ký tự ở production, xem config/index.ts, trước
 * đây validate nhưng chưa nơi nào dùng) làm khoá gốc — hash SHA-256 ra đúng 32 byte cho
 * AES-256-GCM. Không ép ENCRYPTION_KEY phải đúng 64 hex như FB_TOKEN_ENC_KEY vì đây là
 * secret chung của app, định dạng thực tế trên server có thể không phải hex thuần.
 *
 * TƯƠNG THÍCH NGƯỢC (quan trọng): sessionData cũ (trước khi có file này) lưu dạng object
 * JSON thô, chưa mã hoá. decryptSessionData() nhận diện qua kiểu dữ liệu — string có tiền
 * tố "enc1:" = đã mã hoá; object = dữ liệu cũ, dùng nguyên. Nick đang kết nối KHÔNG bị rớt
 * khi deploy; session cũ tự chuyển sang mã hoá ở lần ghi kế tiếp (login lại / reconnect).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'enc1:';

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('[session-crypto] ENCRYPTION_KEY env var missing');
  return createHash('sha256').update(raw).digest(); // luôn đúng 32 byte bất kể định dạng đầu vào
}

/** Mã hoá credentials Zalo (cookie/imei/userAgent) → chuỗi "enc1:<iv>:<tag>:<ciphertext>" (base64). */
export function encryptSessionData(credentials: unknown): string {
  const plain = JSON.stringify(credentials);
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Giải mã sessionData đọc từ DB (Prisma Json field). Nhận cả 2 dạng:
 *   - string "enc1:..." → đã mã hoá, giải mã ra object credentials
 *   - object thô (dữ liệu cũ trước khi có mã hoá) → trả nguyên, KHÔNG throw
 * Trả null nếu rỗng hoặc giải mã lỗi (sai key/dữ liệu hỏng) — coi như chưa có session để
 * luồng gọi tự xử lý (thường là yêu cầu quét QR lại), không làm crash app.
 */
export function decryptSessionData<T = any>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw as T; // object cũ chưa mã hoá — tương thích ngược
  if (!raw.startsWith(PREFIX)) return raw as unknown as T; // string không đúng định dạng mình — trả nguyên, an toàn

  try {
    const [ivB64, tagB64, dataB64] = raw.slice(PREFIX.length).split(':');
    const key = getKey();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (err) {
    logger.error('[session-crypto] decryptSessionData failed — treating as invalid session', err);
    return null;
  }
}
