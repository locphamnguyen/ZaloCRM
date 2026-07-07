// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * broadcast-service.ts — Broadcast tự động: helpers thuần (không I/O Zalo).
 *
 *   - renderMessage(): thay biến {{ten}} {{sdt}} trong nội dung tin
 *   - computeNextRunAt(): tính lần chạy kế tiếp theo lịch once/daily/weekly
 *     (giờ VN, UTC+7 cố định — VN không có DST)
 *   - randomDelayMs(): giãn cách ngẫu nhiên giữa 2 tin (chống block)
 */

export type ScheduleType = 'once' | 'daily' | 'weekly';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, VN không đổi giờ mùa
const SEND_WINDOW_START_HOUR = 8;
const SEND_WINDOW_END_HOUR = 21;

export interface RecipientVars {
  name?: string | null;
  phone?: string | null;
}

/** Thay biến trong nội dung tin. Hỗ trợ: {{ten}}, {{ten_khach}}, {{sdt}}, {{phone}}. */
export function renderMessage(template: string, vars: RecipientVars): string {
  const name = (vars.name ?? '').trim() || 'bạn';
  const phone = (vars.phone ?? '').trim();
  return template
    .replace(/\{\{\s*(ten_khach|ten)\s*\}\}/gi, name)
    .replace(/\{\{\s*(sdt|phone)\s*\}\}/gi, phone);
}

/** Parse "HH:mm" → {h, m}. Trả null nếu sai format. */
export function parseTimeOfDay(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  if (!match) return null;
  return { h: parseInt(match[1], 10), m: parseInt(match[2], 10) };
}

/**
 * Tính thời điểm chạy kế tiếp (UTC Date) SAU thời điểm `after`.
 *   - once   : scheduledAt nếu còn trong tương lai, ngược lại null (hết lịch)
 *   - daily  : giờ timeOfDay (VN) hôm nay hoặc ngày mai
 *   - weekly : giờ timeOfDay (VN) vào ngày daysOfWeek gần nhất (0=CN..6=T7)
 */
export function computeNextRunAt(args: {
  scheduleType: ScheduleType;
  scheduledAt?: Date | null;
  timeOfDay?: string | null;
  daysOfWeek?: number[];
  after?: Date;
}): Date | null {
  const after = args.after ?? new Date();

  if (args.scheduleType === 'once') {
    if (!args.scheduledAt) return null;
    return args.scheduledAt.getTime() > after.getTime() ? args.scheduledAt : null;
  }

  const tod = parseTimeOfDay(args.timeOfDay);
  if (!tod) return null;

  // Làm việc trong "giờ VN ảo": shift UTC +7h rồi dùng các hàm getUTC*.
  const vnNow = new Date(after.getTime() + VN_OFFSET_MS);

  for (let addDays = 0; addDays <= 7; addDays++) {
    const candidate = new Date(Date.UTC(
      vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + addDays,
      tod.h, tod.m, 0, 0,
    ));
    const candidateUtc = new Date(candidate.getTime() - VN_OFFSET_MS);
    if (candidateUtc.getTime() <= after.getTime()) continue;

    if (args.scheduleType === 'daily') return candidateUtc;

    // weekly — candidate.getUTCDay() chính là thứ theo giờ VN (đã shift)
    const dows = args.daysOfWeek ?? [];
    if (dows.length === 0) return null;
    if (dows.includes(candidate.getUTCDay())) return candidateUtc;
  }
  return null;
}

/** Giãn cách ngẫu nhiên [min..max] giây → ms. Clamp an toàn ≥5s. */
export function randomDelayMs(minSec: number, maxSec: number): number {
  const lo = Math.max(5, Math.min(minSec, maxSec));
  const hi = Math.max(lo, Math.max(minSec, maxSec));
  return (lo + Math.random() * (hi - lo)) * 1000;
}

/** Khung giờ gửi cho phép: 8h–21h giờ VN (tránh phiền khách ban đêm). */
export function isWithinSendWindow(at: Date = new Date()): boolean {
  const vnHour = new Date(at.getTime() + VN_OFFSET_MS).getUTCHours();
  return vnHour >= SEND_WINDOW_START_HOUR && vnHour < SEND_WINDOW_END_HOUR;
}
