// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * api-key-hash.ts — P2 (H1): hash SHA-256 cho public API key.
 * Xác thực so khớp hash (không lưu key thật ở DB). Dùng chung cho route xác thực
 * (public-api-routes) và route tạo/xoay key (webhook-settings-routes) + backfill.
 */
import { createHash } from 'node:crypto';

/** SHA-256 hex của API key. Cùng key → cùng hash → so khớp hằng-số theo giá trị. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Hint hiển thị (đã mask) cho GET api-key — không phải secret dùng được. */
export function maskApiKeyHint(key: string): string {
  return key.length > 12 ? `${key.slice(0, 12)}****${key.slice(-4)}` : `${key.slice(0, 4)}****`;
}
