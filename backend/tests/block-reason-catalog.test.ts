// Unit test (thuần) — block-reason-catalog (Observability "vì sao không gửi" 2026-06-18).
import { describe, it, expect } from 'vitest';
import {
  resolveBlockReason,
  categoryOf,
  allBlockCodes,
  ALL_BLOCK_CATEGORIES,
} from '../src/modules/automation/shared/block-reason-catalog.js';

describe('resolveBlockReason — tách token đầu khỏi hậu tố worker/guard', () => {
  it('outside_hour_window kèm hậu tố → đúng category + nhãn', () => {
    const i = resolveBlockReason('outside_hour_window (VN 22h, allowed 8-22)');
    expect(i.category).toBe('outside_hour_window');
    expect(i.label).toBe('Ngoài giờ gửi');
    expect(i.kind).toBe('defer');
  });
  it('nick_gap (Xms remaining) → nick_gap', () => {
    expect(resolveBlockReason('nick_gap (1234ms remaining)').category).toBe('nick_gap');
  });
  it('quota_capped → gom về quota_message_exhausted (ngữ cảnh gửi tin)', () => {
    expect(resolveBlockReason('quota_capped (200/day reached)').category).toBe('quota_message_exhausted');
  });
  it('RATE_LIMITED (ca e7ade24c) → quota_message_exhausted, nhãn "Hết 200 tin/ngày"', () => {
    const i = resolveBlockReason('RATE_LIMITED');
    expect(i.category).toBe('quota_message_exhausted');
    expect(i.label).toBe('Hết 200 tin/ngày');
    expect(i.hint).toBe('Tự chạy lại 00:00');
  });
  it('multi_nick (… >= threshold …) → multi_nick, kind=skip', () => {
    const i = resolveBlockReason('multi_nick (3 >= threshold 2)');
    expect(i.category).toBe('multi_nick');
    expect(i.kind).toBe('skip');
  });
  it('sequence_disabled (ca 1c76de9b) → kind=skip, ưu tiên cao', () => {
    const i = resolveBlockReason('sequence_disabled');
    expect(i.category).toBe('sequence_disabled');
    expect(i.priority).toBeGreaterThanOrEqual(90);
  });
  it('unsupported_action_request_friend → chuẩn hoá prefix', () => {
    expect(resolveBlockReason('unsupported_action_request_friend').category).toBe('config_error');
  });
  it('nick_* lạ → coi như nick_offline', () => {
    expect(resolveBlockReason('nick_weird_status').category).toBe('nick_offline');
  });
  it('null / rỗng / lạ → UNKNOWN (không bao giờ undefined)', () => {
    expect(resolveBlockReason(null).category).toBe('unknown');
    expect(resolveBlockReason('').category).toBe('unknown');
    expect(resolveBlockReason('totally_unknown_xyz').category).toBe('unknown');
  });
});

describe('categoryOf', () => {
  it('trả category từ raw code', () => {
    expect(categoryOf('outside_hour_window (...)')).toBe('outside_hour_window');
    expect(categoryOf(null)).toBe('unknown');
  });
});

describe('completeness — mọi code có nhãn; category nằm trong danh sách', () => {
  it('mọi code đã khai báo có label không rỗng + category hợp lệ', () => {
    for (const code of allBlockCodes()) {
      const i = resolveBlockReason(code);
      expect(i.label.length, `code=${code} thiếu nhãn`).toBeGreaterThan(0);
      expect(ALL_BLOCK_CATEGORIES, `category lạ cho code=${code}`).toContain(i.category);
    }
  });
  it('code showToSale=true (trừ internal) có gợi ý hành động', () => {
    for (const code of allBlockCodes()) {
      const i = resolveBlockReason(code);
      if (i.showToSale && i.category !== 'internal') {
        expect(i.hint.length, `code=${code} thiếu gợi ý`).toBeGreaterThan(0);
      }
    }
  });
});
