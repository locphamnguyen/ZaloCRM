// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Minimal structured logger.
 * Prefixes every message with timestamp (giờ Việt Nam UTC+7) and level.
 * Debug output is suppressed in production.
 *
 * 2026-06-02 (memory feedback_timezone_vietnam.md): trước đây dùng new Date().toISOString()
 * → LUÔN trả UTC bất kể TZ env. Sale + Anh phải tự cộng +7 mỗi lần đọc log. Fix bằng
 * Intl.DateTimeFormat với timeZone='Asia/Ho_Chi_Minh' — output format giống ISO nhưng
 * giờ VN, thêm "+07" hậu tố để rõ ràng KHÔNG nhầm UTC.
 */
function vnTimestamp(): string {
  const now = new Date();
  // 'sv-SE' Sweden locale trả "YYYY-MM-DD HH:MM:SS" — gần ISO, chỉ space thay T.
  const s = now.toLocaleString('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  // Convert "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS.mmm+07:00"
  return `${s.replace(' ', 'T')}.${ms}+07:00`;
}

export const logger = {
  info: (...args: unknown[]) =>
    console.log(`[${vnTimestamp()}] [INFO]`, ...args),

  error: (...args: unknown[]) =>
    console.error(`[${vnTimestamp()}] [ERROR]`, ...args),

  warn: (...args: unknown[]) =>
    console.warn(`[${vnTimestamp()}] [WARN]`, ...args),

  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${vnTimestamp()}] [DEBUG]`, ...args);
    }
  },
};
