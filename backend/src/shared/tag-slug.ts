// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// Tag normalization helper — Wave 0 spec /plan-eng-review M57 2026-05-31.
// Slugify Vietnamese tag name → URL-safe slug cho Tag.slug unique constraint.
// Strip emoji prefix (Zalo-style "🔵 VIP") không ăn vào slug.

const VIETNAMESE_MAP: Record<string, string> = {
  à: 'a', á: 'a', ạ: 'a', ả: 'a', ã: 'a',
  â: 'a', ầ: 'a', ấ: 'a', ậ: 'a', ẩ: 'a', ẫ: 'a',
  ă: 'a', ằ: 'a', ắ: 'a', ặ: 'a', ẳ: 'a', ẵ: 'a',
  è: 'e', é: 'e', ẹ: 'e', ẻ: 'e', ẽ: 'e',
  ê: 'e', ề: 'e', ế: 'e', ệ: 'e', ể: 'e', ễ: 'e',
  ì: 'i', í: 'i', ị: 'i', ỉ: 'i', ĩ: 'i',
  ò: 'o', ó: 'o', ọ: 'o', ỏ: 'o', õ: 'o',
  ô: 'o', ồ: 'o', ố: 'o', ộ: 'o', ổ: 'o', ỗ: 'o',
  ơ: 'o', ờ: 'o', ớ: 'o', ợ: 'o', ở: 'o', ỡ: 'o',
  ù: 'u', ú: 'u', ụ: 'u', ủ: 'u', ũ: 'u',
  ư: 'u', ừ: 'u', ứ: 'u', ự: 'u', ử: 'u', ữ: 'u',
  ỳ: 'y', ý: 'y', ỵ: 'y', ỷ: 'y', ỹ: 'y',
  đ: 'd',
};

// Emoji whitelist hay gặp ở Zalo label tag prefix (8 màu tròn + sao + chấm).
// Regex bắt mọi emoji unicode để strip an toàn.
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

/**
 * Normalize tag name → slug.
 * Examples:
 *   "Tiềm năng"        → "tiem-nang"
 *   "🔵 VIP"           → "vip"
 *   "  Hot Lead 2026 " → "hot-lead-2026"
 *   "Khách Q4!@#"      → "khach-q4"
 */
export function slugifyTag(input: string): string {
  if (!input) return '';

  let s = input.normalize('NFC');

  // 1. Strip emoji + leading/trailing spaces
  s = s.replace(EMOJI_REGEX, '').trim();

  // 2. Lowercase + strip Vietnamese diacritics
  s = s.toLowerCase();
  s = s
    .split('')
    .map((ch) => VIETNAMESE_MAP[ch] ?? ch)
    .join('');

  // 3. Replace non-alphanumeric with `-`
  s = s.replace(/[^a-z0-9]+/g, '-');

  // 4. Collapse multiple `-` + trim leading/trailing `-`
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');

  return s;
}

/**
 * Strip emoji prefix (giữ original casing + accent), trả về display name sạch.
 * Examples:
 *   "🔵 VIP"          → "VIP"
 *   "🟢 Tiềm năng"    → "Tiềm năng"
 */
export function stripEmojiPrefix(input: string): string {
  if (!input) return '';
  return input.normalize('NFC').replace(EMOJI_REGEX, '').trim();
}
