// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AI Agent 24/7 — các hàm thuần (không I/O) để quyết định KHI NÀO agent được trả lời.
 * Tách riêng để unit test dễ.
 */

export type AgentMode = 'off_hours' | 'always';

/** "HH:MM" → số phút từ 00:00. Sai format → null. */
export function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Phút trong ngày theo múi giờ IANA (vd Asia/Ho_Chi_Minh). */
export function minutesInTimezone(now: Date, timezone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** Đang trong giờ làm? Hỗ trợ ca qua đêm (vd 20:00 → 02:00). start==end → coi như làm cả ngày. */
export function isWithinWorkHours(now: Date, workStart: string, workEnd: string, timezone: string): boolean {
  const start = parseHm(workStart);
  const end = parseHm(workEnd);
  if (start === null || end === null) return true; // cấu hình hỏng → coi như trong giờ (an toàn: ít tự gửi hơn)
  if (start === end) return true;
  const cur = minutesInTimezone(now, timezone);
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** Delay ngẫu nhiên trong [minSec, maxSec] (ms) — giả lập thời gian người gõ. */
export function randomDelayMs(minSec: number, maxSec: number, rand: () => number = Math.random): number {
  const lo = Math.max(1, Math.min(minSec, maxSec));
  const hi = Math.max(lo, Math.max(minSec, maxSec));
  return Math.round((lo + rand() * (hi - lo)) * 1000);
}

/**
 * Bao lâu sau tin cuối của khách thì agent mới trả lời.
 *  - always: chỉ delay "gõ phím".
 *  - off_hours: ngoài giờ → delay gõ phím; trong giờ → chờ sale staffGraceMinutes trước.
 */
export function computeReplyDelayMs(input: {
  mode: AgentMode | string;
  now: Date;
  workStart: string;
  workEnd: string;
  timezone: string;
  staffGraceMinutes: number;
  minDelaySec: number;
  maxDelaySec: number;
  rand?: () => number;
}): number {
  const typing = randomDelayMs(input.minDelaySec, input.maxDelaySec, input.rand);
  if (input.mode === 'always') return typing;
  if (!isWithinWorkHours(input.now, input.workStart, input.workEnd, input.timezone)) return typing;
  return Math.max(0, input.staffGraceMinutes) * 60_000 + typing;
}

/** Khách có nói từ khoá cần người thật không. keywords = "a|b|c" (không phân biệt hoa thường). */
export function matchesHandoff(text: string, keywords: string): boolean {
  const list = String(keywords || '')
    .split('|')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  const t = String(text || '').toLowerCase();
  return list.some((k) => t.includes(k));
}

export const HANDOFF_TOKEN = '[HANDOFF]';

/** Chuẩn hoá output AI: bỏ token handoff, cắt độ dài, bỏ dấu ngoặc kép bọc ngoài. */
export function parseAgentOutput(raw: string, maxLen = 900): { text: string; handoff: boolean } {
  let text = String(raw || '').trim();
  const handoff = text.includes(HANDOFF_TOKEN);
  text = text.split(HANDOFF_TOKEN).join('').trim();
  if (/^".*"$/s.test(text)) text = text.slice(1, -1).trim();
  if (text.length > maxLen) text = text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return { text, handoff: handoff || text.length === 0 };
}
