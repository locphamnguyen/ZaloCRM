/**
 * api-key-hash.test.ts — P2 (H1) regression.
 * API key public phải xác thực bằng SHA-256 hash, không lưu/không so plaintext.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { hashApiKey, maskApiKeyHint } from '../src/shared/crypto/api-key-hash.js';

describe('api-key hashing (P2)', () => {
  it('hashApiKey = SHA-256 hex xác định, khớp chuẩn Node crypto', () => {
    const key = 'zcrm_deadbeef';
    const expected = createHash('sha256').update(key, 'utf8').digest('hex');
    expect(hashApiKey(key)).toBe(expected);
    expect(hashApiKey(key)).toBe(hashApiKey(key)); // xác định
    expect(hashApiKey(key)).toHaveLength(64);
  });

  it('key khác → hash khác', () => {
    expect(hashApiKey('zcrm_a')).not.toBe(hashApiKey('zcrm_b'));
  });

  it('maskApiKeyHint không lộ phần giữa của key', () => {
    const key = 'zcrm_0123456789abcdef0123456789abcdef';
    const hint = maskApiKeyHint(key);
    expect(hint.startsWith('zcrm_0123456')).toBe(true);
    expect(hint.endsWith('cdef')).toBe(true);
    expect(hint).toContain('****');
    // Không chứa nguyên văn key (không thể dùng lại)
    expect(hint).not.toBe(key);
    expect(key.includes(hint)).toBe(false);
  });
});
