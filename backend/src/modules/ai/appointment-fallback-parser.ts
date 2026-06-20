// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * appointment-fallback-parser.ts — Rule-based parser cho ghi chú lịch hẹn.
 *
 * Backup khi Gemini bị rate-limit (429) hoặc lỗi. Detect 80% các pattern phổ biến
 * tiếng Việt KHÔNG cần gọi AI:
 *  - "mai", "kia", "hôm nay"
 *  - "thứ 2/T2/thứ hai" (1-7), "thứ X tuần tới/sau"
 *  - "N ngày nữa", "N tuần nữa"
 *  - "DD/MM" hoặc "ngày DD/MM" hoặc "ngày DD tháng MM"
 *  - "Xh tối/sáng/chiều", "lúc HH:MM", "HHh"
 *  - "tuần sau/tuần tới", "tháng sau"
 *  - Type detection: gọi → call, nhắn → message, gặp/cafe/đi xem → meeting
 *  - Location: "ở/tại [địa điểm]", "VP", "café/cafe", "showroom"
 */

export type ParsedAppointment = {
  date: string | null;
  time: string | null;
  type: 'call' | 'message' | 'meeting' | 'follow_up' | null;
  location: string | null;
  summary: string;
  hasIntent: boolean;
  missingFields: string[];
  confidence: number;
};

const WEEKDAY_MAP: Record<string, number> = {
  'chủ nhật': 0, 'cn': 0, 'chu nhat': 0,
  'thứ 2': 1, 'thứ hai': 1, 't2': 1, 'thu 2': 1, 'thu hai': 1,
  'thứ 3': 2, 'thứ ba': 2, 't3': 2, 'thu 3': 2, 'thu ba': 2,
  'thứ 4': 3, 'thứ tư': 3, 't4': 3, 'thu 4': 3, 'thu tu': 3,
  'thứ 5': 4, 'thứ năm': 4, 't5': 4, 'thu 5': 4, 'thu nam': 4,
  'thứ 6': 5, 'thứ sáu': 5, 't6': 5, 'thu 6': 5, 'thu sau': 5,
  'thứ 7': 6, 'thứ bảy': 6, 't7': 6, 'thu 7': 6, 'thu bay': 6,
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function nextWeekday(base: Date, target: number, nextWeek = false): Date {
  // target = 0 (CN) .. 6 (T7)
  const cur = base.getDay();
  let diff = (target - cur + 7) % 7;
  if (diff === 0) diff = 7;       // cùng ngày → tuần sau
  if (nextWeek && diff < 7) diff += 7;  // "tuần tới/sau" → cộng thêm 1 tuần
  return addDays(base, diff);
}

/* ────────────────────────────────────────────────────────────────────────
 * Main parser
 * ──────────────────────────────────────────────────────────────────────── */
export function parseAppointmentRuleBased(text: string, now: Date = new Date()): ParsedAppointment {
  const lower = text.toLowerCase().trim();
  if (!lower) return emptyResult();

  let date: string | null = null;
  let time: string | null = null;
  let type: ParsedAppointment['type'] = null;
  let location: string | null = null;
  let confidence = 0;

  /* ── Date detection ───────────────────────────────────────────────── */

  // "hôm nay"
  if (/\b(hôm nay|hom nay|today)\b/i.test(lower)) {
    date = toIsoDate(now);
    confidence += 0.4;
  }
  // "mai", "ngày mai"
  else if (/\b(ngày mai|hôm mai|mai|tomorrow)\b/i.test(lower)) {
    date = toIsoDate(addDays(now, 1));
    confidence += 0.5;
  }
  // "kia", "ngày kia", "ngày mốt"
  else if (/\b(ngày kia|hôm kia|kia|mốt|mot)\b/i.test(lower)) {
    date = toIsoDate(addDays(now, 2));
    confidence += 0.5;
  }

  // "N ngày nữa", "trong N ngày" (chỉ chạy nếu chưa match)
  if (!date) {
    const mDays = lower.match(/(\d+)\s*ngày\s*nữa/i);
    if (mDays) {
      date = toIsoDate(addDays(now, parseInt(mDays[1])));
      confidence += 0.45;
    }
  }

  // "N tuần nữa", "tuần sau", "tuần tới"
  if (!date) {
    const mWeeks = lower.match(/(\d+)\s*tuần\s*(nữa|sau|tới)/i);
    if (mWeeks) {
      date = toIsoDate(addDays(now, parseInt(mWeeks[1]) * 7));
      confidence += 0.4;
    } else if (/\btuần\s*(sau|tới)\b/i.test(lower)) {
      date = toIsoDate(addDays(now, 7));
      confidence += 0.35;
    }
  }

  // "DD/MM" hoặc "ngày DD/MM" hoặc "ngày DD tháng MM"
  if (!date) {
    let mDate = lower.match(/(?:ngày\s+)?(\d{1,2})\s*[\/\-\.\s]\s*(\d{1,2})(?:\s*[\/\-\.\s]\s*(\d{2,4}))?/);
    if (!mDate) {
      mDate = lower.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{2,4}))?/);
    }
    if (mDate) {
      const day = parseInt(mDate[1]);
      const month = parseInt(mDate[2]);
      const yearRaw = mDate[3] ? parseInt(mDate[3]) : now.getFullYear();
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const candidate = new Date(year, month - 1, day);
        // Nếu ngày đã qua trong năm hiện tại và không chỉ định năm → next year
        if (!mDate[3] && candidate.getTime() < now.getTime() - 86400000) {
          candidate.setFullYear(year + 1);
        }
        date = toIsoDate(candidate);
        confidence += 0.5;
      }
    }
  }

  // "thứ X" — check nếu chưa có date
  if (!date) {
    const nextWeekHint = /\b(tuần\s*tới|tuần\s*sau|tuần\s*kế|tới\s*đây)\b/i.test(lower);
    for (const [key, val] of Object.entries(WEEKDAY_MAP)) {
      // Use word boundary check for key with spaces vs single tokens
      const pattern = new RegExp(`(^|[^a-zA-Z0-9])${key.replace(/\s+/g, '\\s+')}([^a-zA-Z0-9]|$)`, 'i');
      if (pattern.test(lower)) {
        date = toIsoDate(nextWeekday(now, val, nextWeekHint));
        confidence += nextWeekHint ? 0.45 : 0.4;
        break;
      }
    }
  }

  /* ── Time detection ───────────────────────────────────────────────── */

  // "Xh tối/sáng/chiều/trưa" hoặc "X giờ tối/...", "lúc HH:MM", "HHh", "HH:MM"
  // 1. "Xh tối" / "Xh sáng" / "Xh chiều"
  let timeMatch = lower.match(/(\d{1,2})\s*(?:h|giờ|h.|gio)\s*(tối|toi|sáng|sang|chiều|chieu|trưa|trua|đêm|dem|am|pm)/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const period = timeMatch[2].toLowerCase();
    if (/(tối|toi|chiều|chieu|đêm|dem|pm)/i.test(period) && hour < 12) hour += 12;
    if (/(am|sáng|sang)/i.test(period) && hour === 12) hour = 0;
    time = `${String(hour).padStart(2, '0')}:00`;
    confidence += 0.3;
  }

  // 2. "lúc HH:MM" hoặc "HH:MM"
  if (!time) {
    const m = lower.match(/(?:lúc\s+)?(\d{1,2}):(\d{2})/);
    if (m) {
      const h = parseInt(m[1]);
      const min = parseInt(m[2]);
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        confidence += 0.3;
      }
    }
  }

  // 3. "lúc Xh" hoặc "Xh"
  if (!time) {
    const m = lower.match(/(?:lúc\s+)?(\d{1,2})\s*(?:h|giờ)(?:\s|$|[^a-zA-Z0-9])/);
    if (m) {
      let h = parseInt(m[1]);
      if (h >= 0 && h <= 23) {
        // Heuristic: nếu < 7 và context có "tối/chiều" thì PM
        if (h < 7 && /(tối|chiều|toi|chieu)/i.test(lower)) h += 12;
        time = `${String(h).padStart(2, '0')}:00`;
        confidence += 0.2;
      }
    }
  }

  // 4. Period only without explicit hour
  if (!time) {
    if (/\bsáng\b/i.test(lower)) { time = '09:00'; confidence += 0.15; }
    else if (/\btrưa\b/i.test(lower)) { time = '12:00'; confidence += 0.15; }
    else if (/\bchiều\b/i.test(lower)) { time = '14:00'; confidence += 0.15; }
    else if (/\btối\b/i.test(lower)) { time = '19:00'; confidence += 0.15; }
  }

  /* ── Type detection ──────────────────────────────────────────────── */
  if (/\b(gọi|goi|call|điện thoại|dt|alo)\b/i.test(lower)) type = 'call';
  else if (/\b(nhắn|nhan|tin nhắn|sms|message|chat)\b/i.test(lower)) type = 'message';
  else if (/\b(gặp|gap|cafe|cà phê|ca phe|đi xem|di xem|ghé|ghe|đến|den|meeting|hẹn cafe)\b/i.test(lower)) type = 'meeting';
  else type = 'follow_up';

  if (type !== 'follow_up') confidence += 0.15;

  /* ── Location detection ──────────────────────────────────────────── */
  // "ở [location]" / "tại [location]" / specific keywords
  const locMatch = lower.match(/(?:\bở\b|\btại\b)\s+([^\.\,\;\n!?]+?)(?=\s*(?:nha|nhé|nhe|đi|đó|do|\.|,|$))/i);
  if (locMatch) {
    location = locMatch[1].trim().slice(0, 100);
    if (location.length > 1) confidence += 0.1;
    else location = null;
  }
  // Specific landmarks
  if (!location) {
    if (/\bvp\s*\d+\b/i.test(lower)) {
      const m = lower.match(/\bvp\s*\d+\b/i);
      location = m![0].toUpperCase();
      confidence += 0.1;
    } else if (/\b(showroom|văn phòng|nhà mẫu|nha mau|dự án|du an)\b/i.test(lower)) {
      const m = lower.match(/\b(showroom|văn phòng|nhà mẫu|nha mau|dự án|du an)\b\s*([^\.\,\;\n]*)/i);
      location = m![0].trim().slice(0, 100);
      confidence += 0.1;
    }
  }

  /* ── Build summary ──────────────────────────────────────────────── */
  const summary = text.slice(0, 160).replace(/\s+/g, ' ').trim();

  /* ── hasIntent: nếu detect được date HOẶC (time + type≠follow_up) → có intent ── */
  const hasIntent = !!date || (!!time && type !== 'follow_up') || /\b(gọi|gặp|nhắn|cafe|cà phê|đi xem|ghé)\b/i.test(lower);

  if (!hasIntent) return emptyResult();

  /* ── Missing fields ─────────────────────────────────────────────── */
  const missing: string[] = [];
  if (!date) missing.push('date');
  if (!time) missing.push('time');
  if (!location) missing.push('location');

  // Confidence cap & floor
  confidence = Math.min(1, Math.max(0.35, confidence));

  return {
    date,
    time,
    type,
    location,
    summary,
    hasIntent: true,
    missingFields: missing,
    confidence,
  };
}

function emptyResult(): ParsedAppointment {
  return {
    date: null, time: null, type: null, location: null,
    summary: '', hasIntent: false, missingFields: [], confidence: 0,
  };
}
