/**
 * facebook-aes-gcm.test.ts — Unit tests for AES-256-GCM crypto helper.
 * Tests: roundtrip, tamper detection, invalid key formats.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// 32-byte key expressed as 64 hex chars
const VALID_KEY = 'a'.repeat(64);

async function importModule() {
  // Re-import fresh each time so env changes take effect
  return import('../../src/shared/crypto/aes-gcm.js');
}

describe('aes-gcm encrypt/decrypt', () => {
  beforeEach(() => {
    process.env.FB_TOKEN_ENC_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.FB_TOKEN_ENC_KEY;
  });

  it('roundtrip: decrypt(encrypt(plain)) === plain', async () => {
    const { encrypt, decrypt } = await importModule();
    const plain = 'EAABcd1234XYZ_page_token';
    const cipher = encrypt(plain);
    expect(decrypt(cipher)).toBe(plain);
  });

  it('produces different ciphertext each call (random IV)', async () => {
    const { encrypt } = await importModule();
    const plain = 'same-plaintext';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it('ciphertext format is iv:tag:data (3 base64 segments)', async () => {
    const { encrypt } = await importModule();
    const parts = encrypt('hello').split(':');
    expect(parts).toHaveLength(3);
    // Each segment is valid base64
    for (const p of parts) {
      expect(() => Buffer.from(p, 'base64')).not.toThrow();
    }
  });

  it('throws on tampered ciphertext (auth tag mismatch)', async () => {
    const { encrypt, decrypt } = await importModule();
    const cipher = encrypt('sensitive-token');
    const parts = cipher.split(':');
    // Flip one byte in the ciphertext segment
    const dataBytes = Buffer.from(parts[2], 'base64');
    dataBytes[0] ^= 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${dataBytes.toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on tampered auth tag', async () => {
    const { encrypt, decrypt } = await importModule();
    const cipher = encrypt('sensitive-token');
    const parts = cipher.split(':');
    const tagBytes = Buffer.from(parts[1], 'base64');
    tagBytes[0] ^= 0xff;
    const tampered = `${parts[0]}:${tagBytes.toString('base64')}:${parts[2]}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws when FB_TOKEN_ENC_KEY is not set', async () => {
    delete process.env.FB_TOKEN_ENC_KEY;
    const { encrypt } = await importModule();
    expect(() => encrypt('test')).toThrow(/FB_TOKEN_ENC_KEY/);
  });

  it('throws when FB_TOKEN_ENC_KEY is wrong length', async () => {
    process.env.FB_TOKEN_ENC_KEY = 'tooshort';
    const { encrypt } = await importModule();
    expect(() => encrypt('test')).toThrow(/FB_TOKEN_ENC_KEY/);
  });

  it('throws on malformed ciphertext (wrong segment count)', async () => {
    const { decrypt } = await importModule();
    expect(() => decrypt('onlyone')).toThrow(/Invalid ciphertext format/);
    expect(() => decrypt('one:two')).toThrow(/Invalid ciphertext format/);
  });

  it('roundtrip with unicode/emoji plaintext', async () => {
    const { encrypt, decrypt } = await importModule();
    const plain = 'tên: Nguyễn Văn A 🎉';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });
});
