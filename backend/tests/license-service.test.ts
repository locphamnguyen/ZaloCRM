/**
 * LicenseService — test verify JWT RS256 + grace period + fallback.
 * Dùng keypair tạm sinh trong test (không commit key nào).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { loadLicense } from '../src/core/license-service.js';

let privateKey: string;
let publicKey: string;

function sign(payload: Record<string, unknown>): string {
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

afterEach(() => {
  delete process.env.ZALOCRM_LICENSE_KEY;
  delete process.env.ZALOCRM_LICENSE_PUBLIC_KEY;
  delete process.env.ZALOCRM_LICENSE_FEATURES;
  delete process.env.NODE_ENV;
});

function useEphemeralPublicKey() {
  process.env.ZALOCRM_LICENSE_PUBLIC_KEY = publicKey;
}

describe('loadLicense', () => {
  it('không có key → community', () => {
    const lic = loadLicense();
    expect(lic.edition()).toBe('community');
    expect(lic.has('x')).toBe(false);
    expect(lic.features()).toEqual([]);
  });

  it('license hợp lệ → enterprise + feature đúng', () => {
    useEphemeralPublicKey();
    process.env.ZALOCRM_LICENSE_KEY = sign({
      features: ['chat.ai_suggest', 'audit.log'],
      seats: 10,
      exp: now() + 30 * DAY,
    });
    const lic = loadLicense();
    expect(lic.edition()).toBe('enterprise');
    expect(lic.has('chat.ai_suggest')).toBe(true);
    expect(lic.has('not.licensed')).toBe(false);
    expect(lic.features()).toContain('audit.log');
    expect(lic.seats()).toBe(10);
  });

  it('hết hạn nhưng trong grace 14 ngày → vẫn enterprise', () => {
    useEphemeralPublicKey();
    process.env.ZALOCRM_LICENSE_KEY = sign({
      features: ['a'],
      exp: now() - 3 * DAY, // hết hạn 3 ngày trước
    });
    expect(loadLicense().edition()).toBe('enterprise');
  });

  it('hết hạn quá grace → community', () => {
    useEphemeralPublicKey();
    process.env.ZALOCRM_LICENSE_KEY = sign({
      features: ['a'],
      exp: now() - 20 * DAY, // quá 14 ngày grace
    });
    expect(loadLicense().edition()).toBe('community');
  });

  it('sai chữ ký (key lạ) → community', () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    useEphemeralPublicKey(); // verify bằng publicKey của ta
    process.env.ZALOCRM_LICENSE_KEY = jwt.sign(
      { features: ['a'], exp: now() + DAY },
      other.privateKey,
      { algorithm: 'RS256' },
    ); // nhưng ký bằng private key khác
    expect(loadLicense().edition()).toBe('community');
  });

  it('dev backdoor ngoài production → enterprise', () => {
    process.env.NODE_ENV = 'development';
    process.env.ZALOCRM_LICENSE_FEATURES = 'chat.ai_suggest';
    expect(loadLicense().has('chat.ai_suggest')).toBe(true);
  });

  it('dev backdoor BỊ CHẶN ở production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ZALOCRM_LICENSE_FEATURES = 'chat.ai_suggest';
    expect(loadLicense().edition()).toBe('community');
  });
});
