// ════════════════════════════════════════════════════════════════════════
// schedule-calculator — Luật 1 (giờ) + Luật 2 (giãn cách) — PURE, không DB
// ════════════════════════════════════════════════════════════════════════
//
// Sequence recode Đợt 1 (2026-06-13). Codex #11: TÁCH calculator dùng CHUNG cho
// engine (worker tính delay bước kế) VÀ ETA (đợt 2 cộng dồn delay) → tránh tính 2
// kiểu rồi lệch nhau. File pure (không import prisma) để unit-test không cần DB.
//
// Hai phép tính:
//   1. sendGapMs(rules)      — luật 2: giãn cách bước kế ra milliseconds.
//   2. nextAllowedTime(from) — luật 1: dời 1 mốc vào trong khung giờ hoạt động.
//   3. etaCompleteAt(...)    — cộng dồn delay các bước CÒN LẠI + né ngoài giờ (ETA).

import type { SendGap, SequenceRuntimeRules, SequenceStep } from '../sequences/types.js';

const MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

/**
 * Quy sendGap ra milliseconds. RANDOM trong [min, max] (cùng đơn vị) — pick mỗi lần
 * gọi (anh chốt 2026-06-15: gửi xong step N → pick ngẫu nhiên → lưu trong job step N+1).
 * Legacy { value } → cố định. Giá trị ≤0 → 0 (gửi ngay).
 *
 * @param rand hàm random [0,1) — inject để test ổn định (default Math.random).
 */
export function sendGapToMs(gap: SendGap | undefined, rand: () => number = Math.random): number {
  if (!gap) return 0;
  const unitMs = MS[gap.unit];
  // Khoảng random [min, max].
  if (typeof gap.min === 'number' && typeof gap.max === 'number') {
    if (gap.max <= 0) return 0;
    const lo = Math.max(0, gap.min);
    const hi = Math.max(lo, gap.max);
    const picked = lo + rand() * (hi - lo); // đơn vị nguyên (vd 15..30 phút)
    return Math.round(picked * unitMs);
  }
  // Legacy cố định.
  if (typeof gap.value === 'number' && gap.value > 0) return Math.round(gap.value * unitMs);
  return 0;
}

/**
 * Delay bước kế (ms): ưu tiên rules.sendGap (luật 2, random [min,max]); fallback
 * step.delayMinutes (data cũ chưa set sendGap). Worker dùng để enqueue bước N+1.
 *
 * @param rand inject random để test (default Math.random).
 */
export function stepDelayMs(
  rules: SequenceRuntimeRules | null | undefined,
  fallbackDelayMinutes: number,
  rand: () => number = Math.random,
): number {
  const gap = rules?.sendGap;
  if (gap) {
    const ms = sendGapToMs(gap, rand);
    // sendGap có cấu hình (min/max/value) → dùng kết quả random (kể cả 0 nếu min=max=0).
    if ((typeof gap.min === 'number' && typeof gap.max === 'number') || (typeof gap.value === 'number' && gap.value > 0)) {
      return ms;
    }
  }
  return Math.max(0, (fallbackDelayMinutes ?? 0) * MS.minute);
}

/**
 * Dời `at` vào trong khung giờ hoạt động (luật 1). Nếu `at` rơi ngoài [start, end)
 * theo GIỜ ĐỊA PHƯƠNG VN (UTC+7) → trả mốc đầu khung kế tiếp; nếu trong khung → giữ.
 *
 * @param at        mốc cần kiểm (Date)
 * @param range     [startHour, endHour] giờ VN (0-23). undefined = không giới hạn.
 * @param nowMs     "hiện tại" để test xác định (mặc định Date.now ở caller, KHÔNG gọi
 *                  Date.now() trong file pure để test ổn định — caller truyền vào).
 * @returns Date đã dời vào khung (hoặc nguyên `at` nếu không có range / đã trong khung)
 */
export function nextAllowedTime(at: Date, range: [number, number] | undefined): Date {
  if (!range) return at;
  const [start, end] = range;
  if (start >= end) return at; // range vô nghĩa → bỏ qua gate

  // Giờ VN (UTC+7). getUTCHours + 7, wrap 24.
  const vnHour = (at.getUTCHours() + 7) % 24;

  if (vnHour >= start && vnHour < end) return at; // trong khung → giữ

  // Ngoài khung → dời tới `start` giờ của khung kế tiếp (cùng ngày nếu chưa tới, mai nếu đã qua).
  const result = new Date(at.getTime());
  // Đưa về đầu giờ `start` VN. Quy ra UTC: startUtcHour = (start - 7 + 24) % 24.
  const startUtcHour = (start - 7 + 24) % 24;
  result.setUTCMinutes(0, 0, 0);
  result.setUTCHours(startUtcHour);
  // Nếu kết quả ≤ at (đã qua khung hôm nay) → sang ngày mai.
  if (result.getTime() <= at.getTime()) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

/**
 * ETA hoàn tất luồng (đợt 2 dùng để hiện "bao lâu nữa xong"): cộng dồn delay các bước
 * CÒN LẠI từ `fromStepIdx`+1 tới cuối, mỗi bước né ngoài giờ. KHÔNG scan queue.
 *
 * @param steps        toàn bộ steps của sequence
 * @param fromStepIdx  bước hiện tại (đã/đang gửi); cộng từ bước kế
 * @param fromTime     mốc bắt đầu cộng (thường nextRunAt của bước kế, hoặc now)
 * @param rules        runtimeRules (sendGap + allowedHourRange)
 * @returns Date dự kiến gửi xong bước cuối, hoặc null nếu đã ở bước cuối.
 */
export function etaCompleteAt(
  steps: SequenceStep[],
  fromStepIdx: number,
  fromTime: Date,
  rules: SequenceRuntimeRules | null | undefined,
): Date | null {
  if (fromStepIdx >= steps.length - 1) return null; // đã ở/qua bước cuối
  let t = fromTime;
  const range = rules?.allowedHourRange;
  // ETA dùng ĐIỂM GIỮA của khoảng random (rand=0.5) → ổn định, không nhảy mỗi lần mở
  // panel. Thực tế mỗi step pick random riêng nên ETA là ước lượng (hiển thị "dự kiến").
  const midRand = () => 0.5;
  for (let i = fromStepIdx + 1; i < steps.length; i++) {
    const gapMs = stepDelayMs(rules, steps[i].delayMinutes, midRand);
    t = new Date(t.getTime() + gapMs);
    t = nextAllowedTime(t, range);
  }
  return t;
}
