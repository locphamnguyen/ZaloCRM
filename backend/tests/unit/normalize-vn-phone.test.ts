/**
 * Unit tests for normalizeVnPhone helper.
 */
import { describe, it, expect } from 'vitest';
import { normalizeVnPhone } from '../../src/shared/phone/normalize-vn-phone.js';

describe('normalizeVnPhone', () => {
  // ── Valid VN mobile numbers ───────────────────────────────────────────────

  it('local format 0xxx → +84 E164', () => {
    const r = normalizeVnPhone('0908123456');
    expect(r.valid).toBe(true);
    expect(r.phoneE164).toBe('+84908123456');
    expect(r.phoneLocal).toBe('0908123456');
  });

  it('84xxx format → +84 E164', () => {
    const r = normalizeVnPhone('84908123456');
    expect(r.valid).toBe(true);
    expect(r.phoneE164).toBe('+84908123456');
    expect(r.phoneLocal).toBe('0908123456');
  });

  it('+84xxx E164 → same', () => {
    const r = normalizeVnPhone('+84908123456');
    expect(r.valid).toBe(true);
    expect(r.phoneE164).toBe('+84908123456');
    expect(r.phoneLocal).toBe('0908123456');
  });

  it('FB "p:" prefix stripped', () => {
    const r = normalizeVnPhone('p:+84908123456');
    expect(r.valid).toBe(true);
    expect(r.phoneE164).toBe('+84908123456');
  });

  it('spaces and dashes stripped', () => {
    const r = normalizeVnPhone('0908 123 456');
    expect(r.valid).toBe(true);
    expect(r.phoneE164).toBe('+84908123456');
  });

  it('all VN mobile prefixes [35789] accepted', () => {
    for (const prefix of ['3', '5', '7', '8', '9']) {
      const r = normalizeVnPhone(`0${prefix}08123456`);
      expect(r.valid).toBe(true);
    }
  });

  // ── Invalid cases ─────────────────────────────────────────────────────────

  it('null → empty', () => {
    const r = normalizeVnPhone(null);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('empty');
    expect(r.phoneE164).toBeNull();
  });

  it('empty string → empty', () => {
    const r = normalizeVnPhone('');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('empty');
  });

  it('whitespace-only → empty', () => {
    const r = normalizeVnPhone('   ');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('empty');
  });

  it('too short (5 digits) → too_short', () => {
    const r = normalizeVnPhone('12345');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('too_short');
  });

  it('landline 028xxxxxxx → invalid_prefix', () => {
    const r = normalizeVnPhone('02812345678');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('invalid_prefix');
  });

  it('non-VN number +1-555-000-0000 → invalid_prefix', () => {
    const r = normalizeVnPhone('+15550000000');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('invalid_prefix');
  });

  it('malformed string "abc" (no digits) → empty', () => {
    const r = normalizeVnPhone('abc');
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe('empty');
  });

  it('p: prefix with invalid number', () => {
    const r = normalizeVnPhone('p:12345');
    expect(r.valid).toBe(false);
  });
});
