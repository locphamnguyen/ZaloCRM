// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * phone.ts — Canonical SĐT normalization.
 *
 * Tại sao: VN có 3+ format cùng số: 0xxx (local), 84xxx (intl), +84xxx (e164).
 * DB lưu `phoneNormalized` canonical (84xxx no leading + no spaces) + index để:
 *   - Dedup chính xác (cùng SĐT chỉ 1 row, bất kể user nhập format gì)
 *   - Search exact match indexed O(log n) thay vì OR contains O(n)
 *   - Cross-system compare ổn định
 *
 * 2 mức strict:
 *   - normalizePhone()      — LOOSE: chấp nhận mọi format không hỏng (số bàn, 11-digit
 *                              legacy, mobile, country khác). Dùng cho Contact/Friend
 *                              vì sale có thể nhập số bất kỳ (kể cả landline).
 *   - normalizeVnMobile()   — STRICT: CHỈ VN mobile 10-digit + prefix [35789].
 *                              Dùng cho CustomerListEntry parsing (Zalo target only).
 *
 * Chính sách 2026-05-20: tách 2 mức để không phá Contact existing data.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Strip mọi ký tự không phải digit
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 9 || digits.length > 13) return null;

  // VN 0xxx (10 digit total): 0 → 84
  if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
    return '84' + digits.slice(1);
  }
  // VN 84xxx (11-12 digit): keep
  if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) {
    return digits;
  }
  // Mobile-only 9 digit (vd 936668266): assume VN, prepend 84
  if (digits.length === 9) return '84' + digits;
  // Other country / unknown: keep digits as-is (best effort)
  return digits;
}

/**
 * STRICT VN mobile normalizer (10-digit prefix [35789]).
 *
 * Returns canonical "84[35789]xxxxxxxx" (11 digit, no +) hoặc null.
 *
 * Accept:
 *   0[35789]xxxxxxxx         (10 digit local)
 *   84[35789]xxxxxxxx        (11 digit, prefix 84)
 *   +84[35789]xxxxxxxx       (E.164)
 *   [35789]xxxxxxxx          (9 digit mobile, không có 0 đầu)
 *
 * Reject:
 *   - 11-digit legacy (0xxxxxxxxxx, 2018 VN bỏ prefix 011/0120/0121/...)
 *   - 02xxxxxxxx (số bàn HCM/HN/...)
 *   - 04/06xxx (prefix chưa cấp)
 *   - Country khác VN (+886, +1, ...)
 *   - Length lạ (< 9 hoặc > 11)
 *
 * Dùng cho: CustomerListEntry import (Zalo personal target only).
 */
const VN_MOBILE_PREFIX = /^[35789]/;
export function normalizeVnMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 0) return null;

  // 10 digit bắt đầu 0 + mobile prefix → strip 0, prepend 84
  if (digits.length === 10 && digits[0] === '0' && VN_MOBILE_PREFIX.test(digits.slice(1, 2))) {
    return '84' + digits.slice(1);
  }
  // 11 digit bắt đầu 84 + mobile prefix → giữ
  if (digits.length === 11 && digits.startsWith('84') && VN_MOBILE_PREFIX.test(digits.slice(2, 3))) {
    return digits;
  }
  // 9 digit không leading 0, đầu là mobile prefix → assume thiếu 0, prepend 84
  if (digits.length === 9 && VN_MOBILE_PREFIX.test(digits)) {
    return '84' + digits;
  }
  return null;
}

/**
 * Sinh các variant phổ biến từ canonical 84xxx để hiển thị / cross-check.
 * Ít dùng — chủ yếu cho hiển thị fallback hoặc legacy matching.
 */
export function phoneVariants(input: string | null | undefined): string[] {
  const canon = normalizePhone(input);
  if (!canon) return [];
  const variants = new Set<string>([canon]);
  if (canon.startsWith('84')) {
    variants.add('+' + canon);            // +84xxx
    variants.add('0' + canon.slice(2));   // 0xxx
  }
  return [...variants];
}
