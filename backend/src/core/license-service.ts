/**
 * LicenseService — verify license key (JWT RS256) offline, không cần internet.
 *
 * Cơ chế:
 * - Đọc env ZALOCRM_LICENSE_KEY (chuỗi JWT). Không có → community (has() = false).
 * - Verify chữ ký RS256 bằng public key nhúng sẵn (hoặc override qua
 *   ZALOCRM_LICENSE_PUBLIC_KEY). Private key tương ứng giữ bí mật, không nằm trong repo.
 * - Hết hạn: cho grace GRACE_DAYS ngày rồi mới về community (không tắt đột ngột).
 * - Sai chữ ký / lỗi parse → community.
 *
 * Public key dưới đây là key MẪU. Production: thay bằng public key của bạn
 * (đổi hằng số hoặc set ZALOCRM_LICENSE_PUBLIC_KEY).
 */
import jwt from 'jsonwebtoken';
import { logger } from '../shared/utils/logger.js';
import type { LicenseService } from '../plugin-api/index.js';

const GRACE_DAYS = 14;

const EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqviWc/2D+JKJ1eNNPuUx
AElxldng6M7XhU9bV3rT37y5/QiXy8X4S3IaFHJNMQ1U+NXbAC5U40M5wp5vKZF2
S3W+a3EAqu00sLdK0agPRppGLZHDmMI3kT0iRKCkzv+dcq/kpM0+cqj1nLErsLzP
1LwgKnUJY5MnAEmrXLvWQ1GRV+ufLo0vw5TAvHDKQ5GKBQucHnwGVCaloWQsT37S
LpvfV34a303BaHsWhPiOPYWNiHz1zUYuHTY/4esHspQ6dYzqzdxhL/wqMACcT4pX
GTJJUv9XAWENVinzndlt62OQUcdUrGW9fP+IuGJ2QknVQy/GUIgapquaUa4hlGAK
EwIDAQAB
-----END PUBLIC KEY-----`;

interface LicensePayload {
  features?: string[];
  seats?: number;
  customer?: string;
  exp?: number; // unix seconds
}

function publicKey(): string {
  const fromEnv = process.env.ZALOCRM_LICENSE_PUBLIC_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.replace(/\\n/g, '\n');
  return EMBEDDED_PUBLIC_KEY;
}

function communityLicense(): LicenseService {
  return {
    has: () => false,
    features: () => [],
    edition: () => 'community',
    expiresAt: () => null,
    seats: () => null,
  };
}

function enterpriseLicense(payload: LicensePayload): LicenseService {
  const set = new Set(payload.features ?? []);
  const list = [...set];
  return {
    has: (f) => set.has(f),
    features: () => list,
    edition: () => 'enterprise',
    expiresAt: () => (payload.exp ? new Date(payload.exp * 1000) : null),
    seats: () => payload.seats ?? null,
  };
}

/** Backdoor CHỈ cho dev/test local (không bao giờ ở production). */
function devOverride(): LicenseService | null {
  if (process.env.NODE_ENV === 'production') return null;
  const raw = process.env.ZALOCRM_LICENSE_FEATURES?.trim();
  if (!raw) return null;
  const features = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return features.length ? enterpriseLicense({ features }) : null;
}

export function loadLicense(): LicenseService {
  const key = process.env.ZALOCRM_LICENSE_KEY?.trim();
  if (!key) return devOverride() ?? communityLicense();

  try {
    // Verify chữ ký nhưng tự xử lý hết hạn để áp grace period.
    const payload = jwt.verify(key, publicKey(), {
      algorithms: ['RS256'],
      ignoreExpiration: true,
    }) as LicensePayload;

    if (payload.exp) {
      const nowSec = Math.floor(Date.now() / 1000);
      const graceEnd = payload.exp + GRACE_DAYS * 86400;
      if (nowSec > graceEnd) {
        logger.warn('[license] expired past grace period → community');
        return communityLicense();
      }
      if (nowSec > payload.exp) {
        logger.warn(`[license] expired but within ${GRACE_DAYS}-day grace — renew soon`);
      }
    }
    return enterpriseLicense(payload);
  } catch (err) {
    logger.warn(`[license] invalid license key → community (${(err as Error).message})`);
    return communityLicense();
  }
}
