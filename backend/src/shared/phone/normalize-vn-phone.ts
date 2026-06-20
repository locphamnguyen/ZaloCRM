// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * normalize-vn-phone.ts — Normalize VN phone numbers from Facebook Lead Ads.
 *
 * Reuse: existing normalizeVnMobile() từ shared/utils/phone.ts cho canonical form.
 * Thêm: trả về { phoneE164, phoneLocal, valid, invalidReason } cho worker.
 *
 * FB sample prefix "p:+84..." — strip trước khi normalize.
 *
 * NOTE: Deliberately NOT importing from list-import-service.ts to avoid
 * transitive Prisma import (which requires DATABASE_URL at module load time).
 * The two helpers below are local copies of the same logic.
 */
import { normalizeVnMobile } from '../utils/phone.js';

/** "+84XXXXXXXXX" from canonical "84XXXXXXXXX" */
function toE164Format(canonical: string | null): string | null {
  if (!canonical) return null;
  if (canonical.startsWith('+')) return canonical;
  return '+' + canonical;
}

/** "0XXXXXXXXX" from canonical "84XXXXXXXXX" */
function toLocalFormat(canonical: string | null): string | null {
  if (!canonical) return null;
  const digits = canonical.replace(/^\+/, '');
  if (digits.length === 11 && digits.startsWith('84') && /^[35789]/.test(digits.slice(2, 3))) {
    return '0' + digits.slice(2);
  }
  return null;
}

export type PhoneInvalidReason = 'empty' | 'too_short' | 'invalid_format' | 'invalid_prefix';

export interface NormalizedPhone {
  phoneE164: string | null;
  phoneLocal: string | null;
  valid: boolean;
  invalidReason?: PhoneInvalidReason;
}

/**
 * Strip FB/Zalo copy-paste prefixes: "p:+84...", "tel:", "sdt:", etc.
 */
function stripPrefix(raw: string): string {
  return raw.replace(/^\s*(?:p|tel|sđt|sdt|phone|đt|dt)\s*[:：]\s*/i, '').trim();
}

/**
 * Normalize raw phone string (possibly from Facebook Lead form) into E164 + local.
 *
 * Returns phoneE164 as "+84XXXXXXXXX" (with leading +), phoneLocal as "0XXXXXXXXX".
 *
 * VN mobile valid: +84[3-9]XXXXXXXX (10 mobile digits after country code).
 */
export function normalizeVnPhone(raw: string | null | undefined): NormalizedPhone {
  if (!raw || !raw.trim()) {
    return { phoneE164: null, phoneLocal: null, valid: false, invalidReason: 'empty' };
  }

  const cleaned = stripPrefix(raw.trim());
  if (!cleaned) {
    return { phoneE164: null, phoneLocal: null, valid: false, invalidReason: 'empty' };
  }

  const digits = cleaned.replace(/[^\d]/g, '');

  if (digits.length === 0) {
    return { phoneE164: null, phoneLocal: null, valid: false, invalidReason: 'empty' };
  }
  if (digits.length < 9) {
    return { phoneE164: null, phoneLocal: null, valid: false, invalidReason: 'too_short' };
  }

  // normalizeVnMobile returns "84XXXXXXXXX" canonical (no +) or null
  const canonical = normalizeVnMobile(cleaned);
  if (!canonical) {
    const len = digits.length;
    const reason: PhoneInvalidReason = len < 9 ? 'too_short' : 'invalid_prefix';
    return { phoneE164: null, phoneLocal: null, valid: false, invalidReason: reason };
  }

  const e164 = toE164Format(canonical);   // "+84XXXXXXXXX"
  const local = toLocalFormat(canonical); // "0XXXXXXXXX"

  if (!e164 || !local) {
    return { phoneE164: e164, phoneLocal: local, valid: false, invalidReason: 'invalid_prefix' };
  }

  return { phoneE164: e164, phoneLocal: local, valid: true };
}
