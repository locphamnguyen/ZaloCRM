import { describe, it, expect } from 'vitest';
import { isBlurContaminated, PRIVACY_BLUR_TOKEN } from '../src/modules/privacy/redact.js';

// Test guard chống "blur ăn vào data" (anh báo 2026-06-15): tên KH bị ghi đè bằng ▒▒▒▒.
describe('isBlurContaminated — chặn ghi tên đã-blur vào DB', () => {
  it('BLUR_TOKEN (8 ký tự ▒) → nhiễm, từ chối', () => {
    expect(isBlurContaminated(PRIVACY_BLUR_TOKEN)).toBe(true);
  });
  it('chuỗi chứa 1 ký tự ▒ giữa tên thật → nhiễm (giá trị một phần bị blur)', () => {
    expect(isBlurContaminated('Nguyễn ▒▒▒ Lộc')).toBe(true);
  });
  it('tên thật hoàn toàn → KHÔNG nhiễm, cho ghi', () => {
    expect(isBlurContaminated('Nguyễn Trọng Ngoán')).toBe(false);
    expect(isBlurContaminated('Trần Văn Lộc - Q7 0833063545')).toBe(false);
  });
  it('null/undefined/rỗng → KHÔNG nhiễm (không chặn nhầm)', () => {
    expect(isBlurContaminated(null)).toBe(false);
    expect(isBlurContaminated(undefined)).toBe(false);
    expect(isBlurContaminated('')).toBe(false);
  });
  it('ký tự gần giống nhưng KHÁC ▒ (vd ░ U+2591) → KHÔNG nhiễm (chỉ chặn đúng ▒ U+2592)', () => {
    expect(isBlurContaminated('Tên ░ test')).toBe(false);
  });
});
