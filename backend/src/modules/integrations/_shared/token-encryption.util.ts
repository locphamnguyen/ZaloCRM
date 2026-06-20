// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * token-encryption.util.ts — AES-256-GCM cho secrets (FB Page access token, App secret).
 *
 * Eng review Issue 4: token encrypt at rest. Master key trong env `TOKEN_ENCRYPTION_KEY`
 * (32 bytes hex = 64 chars). Random per-message IV. GCM auth tag chống tampering.
 *
 * Format encrypted blob: base64(IV[12] + AUTH_TAG[16] + CIPHERTEXT[N])
 *
 * Generate key 1 lần khi setup:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   → add vào .env: TOKEN_ENCRYPTION_KEY=<64 chars hex>
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error('TOKEN_ENCRYPTION_KEY env var missing. Generate via: node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))"');
  if (hex.length !== 64) throw new Error(`TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes), got ${hex.length}`);
  return Buffer.from(hex, 'hex');
}

/** Encrypt plaintext → base64 blob. */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== 'string') throw new Error('encryptToken: plaintext must be string');
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Pack: IV + AUTH_TAG + CIPHERTEXT
  return Buffer.concat([iv, authTag, ct]).toString('base64');
}

/** Decrypt base64 blob → plaintext. Throw nếu auth tag mismatch (tampered or wrong key). */
export function decryptToken(blob: string): string {
  if (typeof blob !== 'string' || !blob) throw new Error('decryptToken: blob must be non-empty string');
  const key = getKey();
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + AUTH_TAG_LEN + 1) throw new Error('decryptToken: blob too short / corrupted');
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ct = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Generate random webhook verify token (Meta yêu cầu khi subscribe).
 * Anh dán string này vào FB App config khi setup webhook.
 */
export function generateWebhookVerifyToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}
