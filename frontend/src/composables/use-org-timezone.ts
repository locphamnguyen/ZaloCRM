// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Org timezone — offset cố định (không DST), format "+07:00" / "-05:00".
 * Source of truth: Organization.timezone (xem OrgSettings).
 *
 * Singleton ref `orgTimezone` được auth store / OrgSettings cập nhật.
 * Mọi helper trong file này áp dụng offset BẰNG TAY (tránh phụ thuộc Intl IANA)
 * → đảm bảo mọi nơi: UI, log decode, bug report đều ra cùng 1 wall-clock.
 *
 * Quy ước nội bộ: ta tạo "shifted Date" = `new Date(d.getTime() + offsetMin * 60_000)`,
 * rồi đọc bằng `.getUTC*()` để lấy wall-clock của org TZ. KHÔNG dùng `.getTime()`
 * của shifted Date cho bất kỳ phép so sánh nào.
 */
import { ref, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const DEFAULT_TZ = '+07:00';

const orgTimezoneRef = ref<string>(DEFAULT_TZ);

/** Cập nhật từ ngoài (sau khi PUT /organization hoặc fetchProfile). */
export function refreshOrgTimezone(tz: string | undefined | null): void {
  orgTimezoneRef.value = tz || DEFAULT_TZ;
}

/** Parse "+07:00" → tổng số phút lệch UTC. Trả 0 nếu sai format. */
function parseOffsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const h = parseInt(m[2], 10);
  const mm = parseInt(m[3], 10);
  return sign * (h * 60 + mm);
}

function toDateOrNull(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Internal — Date "đã trượt" offset, đọc qua `.getUTC*()` để ra wall-clock org.
 * KHÔNG expose ra ngoài — dễ nhầm là Date thật và gọi `.getTime()` sai.
 */
function shifted(d: Date, tz: string): Date {
  return new Date(d.getTime() + parseOffsetMinutes(tz) * 60_000);
}

interface FormatOptions {
  /** Hiển thị giây (HH:mm:ss). Mặc định false. */
  withSeconds?: boolean;
  /** Chỉ ngày (không có giờ). Mặc định false. */
  dateOnly?: boolean;
  /** Chỉ giờ. Mặc định false. */
  timeOnly?: boolean;
}

const WEEKDAY_LONG_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const WEEKDAY_SHORT_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/**
 * Format 1 Date / ISO string sang wall-clock của org timezone.
 * Output dạng "dd/MM/yyyy HH:mm" (vi-VN convention) — KHÔNG kèm offset (UI tự bọc).
 */
export function formatInOrgTz(
  input: Date | string | number | null | undefined,
  tz: string = orgTimezoneRef.value,
  options: FormatOptions = {},
): string {
  const d = toDateOrNull(input);
  if (!d) return '—';

  const s = shifted(d, tz);
  const dd = String(s.getUTCDate()).padStart(2, '0');
  const MM = String(s.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = s.getUTCFullYear();
  const HH = String(s.getUTCHours()).padStart(2, '0');
  const mm = String(s.getUTCMinutes()).padStart(2, '0');
  const ss = String(s.getUTCSeconds()).padStart(2, '0');

  if (options.dateOnly) return `${dd}/${MM}/${yyyy}`;
  if (options.timeOnly) return options.withSeconds ? `${HH}:${mm}:${ss}` : `${HH}:${mm}`;
  return options.withSeconds
    ? `${dd}/${MM}/${yyyy} ${HH}:${mm}:${ss}`
    : `${dd}/${MM}/${yyyy} ${HH}:${mm}`;
}

/** Tên thứ tiếng Việt theo org TZ. `"long"` = "Thứ Hai", `"short"` = "T2". */
export function weekdayInOrgTz(
  input: Date | string | number | null | undefined,
  tz: string = orgTimezoneRef.value,
  variant: 'long' | 'short' = 'long',
): string {
  const d = toDateOrNull(input);
  if (!d) return '';
  const dow = shifted(d, tz).getUTCDay();
  return variant === 'long' ? WEEKDAY_LONG_VI[dow] : WEEKDAY_SHORT_VI[dow];
}

/** Trả các phần wall-clock của org TZ. Dùng khi cần component (vd layout calendar). */
export function getOrgParts(
  input: Date | string | number | null | undefined,
  tz: string = orgTimezoneRef.value,
): { year: number; month: number; day: number; hour: number; minute: number; second: number; dayOfWeek: number } | null {
  const d = toDateOrNull(input);
  if (!d) return null;
  const s = shifted(d, tz);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1, // 1-12 (giống convention người Việt đọc)
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    second: s.getUTCSeconds(),
    dayOfWeek: s.getUTCDay(), // 0=CN, 1=T2, ..., 6=T7
  };
}

/** Key ngày "YYYY-MM-DD" theo org TZ — dùng group/compare ngày. */
export function orgDayKey(
  input: Date | string | number | null | undefined,
  tz: string = orgTimezoneRef.value,
): string {
  const p = getOrgParts(input, tz);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** UTC time tương ứng 00:00:00 wall-clock org TZ của ngày chứa `input`. */
export function startOfOrgDay(
  input: Date | string | number | null | undefined,
  tz: string = orgTimezoneRef.value,
): Date | null {
  const d = toDateOrNull(input);
  if (!d) return null;
  const offsetMin = parseOffsetMinutes(tz);
  const s = new Date(d.getTime() + offsetMin * 60_000);
  // Set wall-clock của shifted về 00:00:00 UTC
  s.setUTCHours(0, 0, 0, 0);
  // Trả về UTC time thực = wall-clock midnight − offset
  return new Date(s.getTime() - offsetMin * 60_000);
}

/** Date object đại diện "bây giờ" — luôn UTC time hiện tại (Date thực). */
export function nowInOrgTz(): Date {
  return new Date();
}

/**
 * Dựng Date (UTC instant THẬT) từ wall-clock org TZ: ngày "YYYY-MM-DD" + giờ "HH:mm".
 * Ngược của getOrgParts — đọc lại bằng getOrgParts(result) sẽ ra đúng day/hour/minute đã truyền.
 *
 * Dùng cho lịch hẹn: appointmentDate lưu ngày (timestamp 00:00), appointmentTime lưu
 * giờ thật dạng text "HH:mm" theo wall-clock org. Trước đây appointmentStart() chỉ
 * `new Date(appointmentDate)` → bỏ giờ → mọi event dán cứng 07:00 (midnight UTC +7).
 *
 * @param dayKey  "YYYY-MM-DD" (org-local calendar day)
 * @param hhmm    "HH:mm" (org-local wall-clock); rỗng/sai → coi như 00:00
 */
export function orgWallClockToUtc(
  dayKey: string,
  hhmm: string | null | undefined,
  tz: string = orgTimezoneRef.value,
): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!dm) return null;
  const y = parseInt(dm[1], 10);
  const mo = parseInt(dm[2], 10); // 1-12
  const d = parseInt(dm[3], 10);
  let h = 0;
  let mi = 0;
  const tmatch = /^(\d{1,2}):(\d{2})/.exec((hhmm || '').trim());
  if (tmatch) {
    h = Math.min(23, parseInt(tmatch[1], 10) || 0);
    mi = Math.min(59, parseInt(tmatch[2], 10) || 0);
  }
  const offsetMin = parseOffsetMinutes(tz);
  // Wall-clock org → coi như UTC, rồi trừ offset để ra UTC instant thật.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  return new Date(asUtc - offsetMin * 60_000);
}

/**
 * Composable cho component — exposes reactive orgTimezone + format helpers
 * (giữ closure binding với ref hiện tại để dùng trong template).
 */
export function useOrgTimezone() {
  const authStore = useAuthStore();

  // Sync 1 lần từ auth store nếu chưa được set.
  if (orgTimezoneRef.value === DEFAULT_TZ && authStore.user?.orgTimezone) {
    orgTimezoneRef.value = authStore.user.orgTimezone;
  }

  const orgTimezone = computed(() => orgTimezoneRef.value);
  const orgTimezoneLabel = computed(() => `UTC${orgTimezoneRef.value}`);

  function format(
    input: Date | string | number | null | undefined,
    options?: FormatOptions,
  ): string {
    return formatInOrgTz(input, orgTimezoneRef.value, options);
  }

  function weekday(
    input: Date | string | number | null | undefined,
    variant: 'long' | 'short' = 'long',
  ): string {
    return weekdayInOrgTz(input, orgTimezoneRef.value, variant);
  }

  return {
    orgTimezone,
    orgTimezoneLabel,
    format,
    weekday,
    refreshOrgTimezone,
  };
}
