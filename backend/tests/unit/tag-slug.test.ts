import { describe, it, expect } from 'vitest';
import { slugifyTag, stripEmojiPrefix } from '../../src/shared/tag-slug';

describe('slugifyTag', () => {
  it('normalize Vietnamese diacritics', () => {
    expect(slugifyTag('Tiềm năng')).toBe('tiem-nang');
    expect(slugifyTag('Khách hàng')).toBe('khach-hang');
    expect(slugifyTag('Đã chốt')).toBe('da-chot');
    expect(slugifyTag('Ưu tiên')).toBe('uu-tien');
  });

  it('strip emoji prefix Zalo-style', () => {
    expect(slugifyTag('🔵 VIP')).toBe('vip');
    expect(slugifyTag('🟢 Tiềm năng')).toBe('tiem-nang');
    expect(slugifyTag('🔴 Lạnh')).toBe('lanh');
    expect(slugifyTag('⭐ Khách Q4')).toBe('khach-q4');
  });

  it('trim + collapse whitespace and special chars', () => {
    expect(slugifyTag('  Hot Lead 2026  ')).toBe('hot-lead-2026');
    expect(slugifyTag('Khách Q4!@#')).toBe('khach-q4');
    expect(slugifyTag('VIP--Plus')).toBe('vip-plus');
    expect(slugifyTag('  ---   ')).toBe('');
  });

  it('handle empty + null-like input', () => {
    expect(slugifyTag('')).toBe('');
    expect(slugifyTag('   ')).toBe('');
    expect(slugifyTag('🔵')).toBe('');
  });

  it('preserve numbers', () => {
    expect(slugifyTag('Dự án EGV 2026')).toBe('du-an-egv-2026');
    expect(slugifyTag('Q4-2025')).toBe('q4-2025');
  });

  it('lowercase mixed case', () => {
    expect(slugifyTag('VIP Plus')).toBe('vip-plus');
    expect(slugifyTag('CRM-Lead')).toBe('crm-lead');
  });
});

describe('stripEmojiPrefix', () => {
  it('keeps Vietnamese accent + casing', () => {
    expect(stripEmojiPrefix('🔵 VIP')).toBe('VIP');
    expect(stripEmojiPrefix('🟢 Tiềm năng')).toBe('Tiềm năng');
    expect(stripEmojiPrefix('⭐ Khách Q4')).toBe('Khách Q4');
  });

  it('handle text without emoji', () => {
    expect(stripEmojiPrefix('VIP')).toBe('VIP');
    expect(stripEmojiPrefix('Tiềm năng')).toBe('Tiềm năng');
  });

  it('handle empty', () => {
    expect(stripEmojiPrefix('')).toBe('');
    expect(stripEmojiPrefix('🔵')).toBe('');
  });
});
