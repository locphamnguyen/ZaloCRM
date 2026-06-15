// Unit test — schedule-calculator (Luật 1 giờ + Luật 2 giãn cách). PURE, không DB.
// Sequence recode Đợt 1 (eng-review TEST#1=A).

import { describe, it, expect } from 'vitest';
import {
  sendGapToMs,
  stepDelayMs,
  nextAllowedTime,
  etaCompleteAt,
} from '../src/modules/automation/engine/schedule-calculator.js';
import type { SequenceStep } from '../src/modules/automation/sequences/types.js';

describe('sendGapToMs — luật 2 quy đơn vị ra ms', () => {
  it('giây → ms', () => expect(sendGapToMs({ value: 30, unit: 'second' })).toBe(30_000));
  it('phút → ms', () => expect(sendGapToMs({ value: 2, unit: 'minute' })).toBe(120_000));
  it('giờ → ms', () => expect(sendGapToMs({ value: 1, unit: 'hour' })).toBe(3_600_000));
  it('ngày → ms', () => expect(sendGapToMs({ value: 1, unit: 'day' })).toBe(86_400_000));
  it('value 0 hoặc undefined → 0', () => {
    expect(sendGapToMs({ value: 0, unit: 'day' })).toBe(0);
    expect(sendGapToMs(undefined)).toBe(0);
  });
});

describe('sendGapToMs — RANDOM [min,max] (anh chốt 2026-06-15)', () => {
  it('rand=0 → min', () => expect(sendGapToMs({ min: 15, max: 30, unit: 'minute' }, () => 0)).toBe(15 * 60_000));
  it('rand=1 (cận trên) → ~max', () => {
    // rand()=1 hiếm (Math.random < 1) nhưng test biên: 15 + 1*(30-15) = 30 phút.
    expect(sendGapToMs({ min: 15, max: 30, unit: 'minute' }, () => 1)).toBe(30 * 60_000);
  });
  it('rand=0.5 → điểm giữa (22.5 phút)', () => {
    expect(sendGapToMs({ min: 15, max: 30, unit: 'minute' }, () => 0.5)).toBe(Math.round(22.5 * 60_000));
  });
  it('min=max → cố định (không random)', () => {
    expect(sendGapToMs({ min: 5, max: 5, unit: 'minute' }, () => 0.7)).toBe(5 * 60_000);
  });
  it('giá trị nằm TRONG [min,max] với rand bất kỳ', () => {
    const ms = sendGapToMs({ min: 15, max: 30, unit: 'minute' }, () => 0.33);
    expect(ms).toBeGreaterThanOrEqual(15 * 60_000);
    expect(ms).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe('stepDelayMs — ưu tiên sendGap, fallback delayMinutes', () => {
  it('legacy value → dùng sendGap cố định (KHÔNG dùng delayMinutes)', () => {
    expect(stepDelayMs({ sendGap: { value: 10, unit: 'second' } }, 99)).toBe(10_000);
  });
  it('random min/max → pick trong khoảng (rand inject)', () => {
    expect(stepDelayMs({ sendGap: { min: 1, max: 3, unit: 'minute' } }, 99, () => 0)).toBe(60_000);
    expect(stepDelayMs({ sendGap: { min: 1, max: 3, unit: 'minute' } }, 99, () => 1)).toBe(180_000);
  });
  it('không sendGap → fallback delayMinutes', () => {
    expect(stepDelayMs({}, 5)).toBe(300_000);
    expect(stepDelayMs(null, 1)).toBe(60_000);
  });
});

describe('nextAllowedTime — luật 1 né ngoài giờ (giờ VN UTC+7)', () => {
  it('không có range → giữ nguyên', () => {
    const at = new Date('2026-06-13T10:00:00Z');
    expect(nextAllowedTime(at, undefined).getTime()).toBe(at.getTime());
  });
  it('trong khung [6,22] VN → giữ nguyên', () => {
    // 03:00 UTC = 10:00 VN → trong khung 6-22 → giữ.
    const at = new Date('2026-06-13T03:00:00Z');
    expect(nextAllowedTime(at, [6, 22]).getTime()).toBe(at.getTime());
  });
  it('ngoài khung (đêm) → dời tới đầu khung kế', () => {
    // 18:00 UTC = 01:00 VN ngày 14 → ngoài khung 6-22 → dời tới 06:00 VN = 23:00 UTC ngày 13.
    const at = new Date('2026-06-13T18:00:00Z');
    const r = nextAllowedTime(at, [6, 22]);
    // 06:00 VN = 23:00 UTC hôm trước (cùng "ngày VN" của at). Phải > at và rơi vào giờ VN 6.
    expect(r.getTime()).toBeGreaterThan(at.getTime());
    const vnHour = (r.getUTCHours() + 7) % 24;
    expect(vnHour).toBe(6);
  });
});

describe('etaCompleteAt — cộng dồn delay bước còn lại', () => {
  const steps: SequenceStep[] = [
    { stepId: '1', blockId: 'b1', delayMinutes: 0 },
    { stepId: '2', blockId: 'b2', delayMinutes: 1 },
    { stepId: '3', blockId: 'b3', delayMinutes: 1 },
  ];
  it('đã ở bước cuối → null', () => {
    expect(etaCompleteAt(steps, 2, new Date('2026-06-13T03:00:00Z'), {})).toBeNull();
  });
  it('từ bước 0, sendGap 1 phút, 2 bước còn lại → +2 phút (trong giờ)', () => {
    const from = new Date('2026-06-13T03:00:00Z'); // 10:00 VN, trong khung
    const eta = etaCompleteAt(steps, 0, from, { sendGap: { value: 1, unit: 'minute' }, allowedHourRange: [6, 22] });
    expect(eta).not.toBeNull();
    expect(eta!.getTime()).toBe(from.getTime() + 2 * 60_000);
  });
});
