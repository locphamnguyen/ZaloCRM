// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * aes-gcm.ts — AES-256-GCM symmetric encryption for sensitive tokens at rest.
 * Key sourced from FB_TOKEN_ENC_KEY env (32-byte hex = 64 hex chars).
 * Output format (all base64): "<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;    // 96-bit IV recommended for GCM
const TAG_BYTES = 16;   // 128-bit auth tag

// keyHex: khoá per-org từ config (UI ⚙) — nếu rỗng thì fallback env FB_TOKEN_ENC_KEY.
function getKey(keyHex?: string | null): Buffer {
  const hex = keyHex || process.env.FB_TOKEN_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('[aes-gcm] FB_TOKEN_ENC_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext string. Returns "<iv>:<authTag>:<ciphertext>" (base64 segments).
 * keyHex tùy chọn (per-org DB-config) → fallback env.
 */
export function encrypt(plain: string, keyHex?: string | null): string {
  const key = getKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt ciphertext produced by encrypt(). Throws on tampered data or wrong key.
 */
export function decrypt(ciphertext: string, keyHex?: string | null): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('[aes-gcm] Invalid ciphertext format');
  const [ivB64, tagB64, dataB64] = parts;
  const key = getKey(keyHex);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_BYTES) throw new Error('[aes-gcm] Invalid IV length');
  if (tag.length !== TAG_BYTES) throw new Error('[aes-gcm] Invalid auth tag length');

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
