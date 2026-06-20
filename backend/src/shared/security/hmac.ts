// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * hmac.ts — Phase 5 (Bảo mật xác thực 2026-06-08)
 *
 * HMAC-SHA256 dùng chung cho webhook + service-to-service (Premise 5, Codex #11).
 * Rút từ pattern verify webhook Facebook (fb-adapter) thành util tái dùng.
 *
 *   verifyHmacSignature  — so chữ ký thô (timing-safe). Dùng cho webhook bên thứ 3
 *                          theo format của họ (vd FB 'sha256=<hex>').
 *   verifyHmacRequest    — full cho s2s nội bộ: ký `${timestamp}.${nonce}.${body}`,
 *                          kiểm timestamp trong cửa sổ (chống replay) + trả nonce
 *                          để caller dedup (chống gửi lại request cũ).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256(rawBody, secret) -> hex. */
export function computeHmacHex(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** So sánh hex chữ ký timing-safe (chống timing attack). */
export function verifyHmacSignature(
  rawBody: Buffer | string,
  providedHex: string | undefined,
  secret: string,
): boolean {
  if (!providedHex) return false;
  const expected = computeHmacHex(rawBody, secret);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(providedHex, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface HmacRequestInput {
  rawBody: Buffer | string;
  /** Header chữ ký, hex (không prefix). */
  signature: string | undefined;
  secret: string;
  /** Header timestamp (ms epoch dạng chuỗi). */
  timestamp: string | undefined;
  /** Header nonce/event_id (caller dedup chống replay). */
  nonce?: string | undefined;
  /** Cửa sổ chấp nhận lệch thời gian (ms). Mặc định 5 phút. */
  toleranceMs?: number;
  /** "Giờ hiện tại" — inject cho test. Mặc định Date.now(). */
  now?: number;
}

export interface HmacRequestResult {
  valid: boolean;
  reason?: 'missing_fields' | 'bad_signature' | 'timestamp_out_of_window';
  /** Nonce hợp lệ — caller PHẢI kiểm tra chưa dùng + lưu lại để chống replay. */
  nonce?: string;
}

/**
 * Verify request s2s nội bộ: chữ ký ký trên `${timestamp}.${nonce}.${body}`.
 * KHÔNG tự lưu nonce — caller chịu trách nhiệm dedup (cần storage). Hàm này lo
 * chữ ký + cửa sổ thời gian.
 */
export function verifyHmacRequest(input: HmacRequestInput): HmacRequestResult {
  const { rawBody, signature, secret, timestamp, nonce, toleranceMs = 5 * 60 * 1000 } = input;
  if (!signature || !timestamp || !nonce) {
    return { valid: false, reason: 'missing_fields' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'timestamp_out_of_window' };
  }
  const now = input.now ?? Date.now();
  if (Math.abs(now - ts) > toleranceMs) {
    return { valid: false, reason: 'timestamp_out_of_window' };
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signedPayload = `${timestamp}.${nonce}.${body}`;
  if (!verifyHmacSignature(signedPayload, signature, secret)) {
    return { valid: false, reason: 'bad_signature' };
  }

  return { valid: true, nonce };
}
