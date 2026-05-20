/**
 * automation/lists/list-import-service.ts — Parse + validate + dedup logic.
 *
 * Pipeline khi POST /customer-lists:
 *   1. parseRawText(rawText) → ParsedLine[] (split lines, strip noise, normalize)
 *   2. detectInternalDup(lines) → mark dup_in_list nội bộ
 *   3. detectCrossListDup(lines, orgId) → mark dup_cross_list với entry list khác
 *   4. detectCrmContactDup(lines, orgId) → mark dup_with_crm với Contact hiện có
 *   5. createListWithEntries(orgId, userId, parsed) → persist
 *   6. async kick off enrichment (Zalo UID lookup)
 *
 * Idempotent: gọi 2 lần với cùng rawText sẽ tạo 2 list riêng (chủ ý — sale chủ
 * động import lại). Dedup check là level entry, KHÔNG block toàn list.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { normalizePhone } from '../../../shared/utils/phone.js';
import type { ParsedLine, ImportResult, InvalidReason } from './types.js';

/**
 * Convert canonical "84908123456" → local "0908123456" (VN).
 * Khác country code → return null (chỉ support VN trong v1).
 */
export function toLocalFormat(e164OrCanonical: string | null): string | null {
  if (!e164OrCanonical) return null;
  const digits = e164OrCanonical.replace(/^\+/, '');
  if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) {
    return '0' + digits.slice(2);
  }
  return null;
}

/**
 * Format E164 with leading "+".
 */
export function toE164Format(canonical: string | null): string | null {
  if (!canonical) return null;
  if (canonical.startsWith('+')) return canonical;
  return '+' + canonical;
}

/**
 * Parse raw text (paste / csv content) thành ParsedLine[].
 *
 * Format hỗ trợ trong v1:
 *   "0908123456"
 *   "0908 123 456"
 *   "0908.123.456"
 *   "+84908123456"
 *   "0908-123-456 Nguyễn Văn A"           ← name sau số
 *   "0908 123 456 Nguyễn Văn A (note)"    ← cắt note phía sau
 *   "0908123456,nva@gmail.com"            ← cắt cột thứ 2 (email)
 *
 * Cho CSV: caller phải pre-process tách comma cells trước khi gọi parseRawText.
 * v1 nuốt tất cả format paste-textarea.
 */
export function parseRawText(rawText: string): ParsedLine[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.split(/\r?\n/);
  const results: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue; // skip blank lines (rowIndex KHÔNG tăng)

    const rowIndex = results.length + 1;
    const parsed = parseSingleLine(trimmed, rowIndex);
    results.push(parsed);
  }

  return results;
}

function parseSingleLine(line: string, rowIndex: number): ParsedLine {
  // Cắt phần phone (digits + space + dot + dash + paren + plus) ở đầu line
  // Match: optional +, digits separated by space/dot/dash/paren
  const phoneMatch = line.match(/^[\s]*(\+?[\d\s.\-()]+)/);
  if (!phoneMatch) {
    return {
      rowIndex,
      phoneRaw: line,
      phoneE164: null,
      phoneLocal: null,
      nameRaw: null,
      valid: false,
      invalidReason: 'invalid_format' satisfies InvalidReason,
    };
  }

  const phonePart = phoneMatch[1].trim();
  const restRaw = line.slice(phoneMatch[0].length).trim();

  // Cắt note trong dấu ngoặc cuối line + cắt cột phía sau dấu phẩy/tab
  let nameRaw: string | null = null;
  if (restRaw) {
    // Lấy phần đầu trước comma/tab nếu có
    const namePart = restRaw.split(/[,\t]/)[0].trim();
    // Strip dấu ngoặc cuối
    nameRaw = namePart.replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
  }

  // Normalize qua util sẵn có (84xxx canonical) + invalidate nếu null
  const canonical = normalizePhone(phonePart);
  if (!canonical) {
    // Phân loại lý do invalid
    const digits = phonePart.replace(/[^\d]/g, '');
    let reason: InvalidReason = 'invalid_format';
    if (digits.length === 0) reason = 'empty';
    else if (digits.length < 9) reason = 'too_short';
    else if (digits.length > 13) reason = 'too_long';
    return {
      rowIndex,
      phoneRaw: line,
      phoneE164: null,
      phoneLocal: null,
      nameRaw,
      valid: false,
      invalidReason: reason,
    };
  }

  // VN local format chỉ valid cho prefix 84xxx
  const local = toLocalFormat(canonical);
  if (!local) {
    return {
      rowIndex,
      phoneRaw: line,
      phoneE164: toE164Format(canonical),
      phoneLocal: null,
      nameRaw,
      valid: false,
      invalidReason: 'invalid_prefix' satisfies InvalidReason,
    };
  }

  return {
    rowIndex,
    phoneRaw: line,
    phoneE164: toE164Format(canonical),
    phoneLocal: local,
    nameRaw,
    valid: true,
    invalidReason: null,
  };
}

/**
 * Detect duplicates within the SAME parse batch.
 * Returns map: rowIndex → firstSeenRowIndex of duplicate.
 * Skips invalid lines (no phoneE164).
 */
export function detectInternalDup(lines: ParsedLine[]): Map<number, number> {
  const seen = new Map<string, number>(); // phoneE164 → firstRowIndex
  const dups = new Map<number, number>(); // rowIndex → firstRowIndex

  for (const line of lines) {
    if (!line.valid || !line.phoneE164) continue;
    const existing = seen.get(line.phoneE164);
    if (existing != null) {
      dups.set(line.rowIndex, existing);
    } else {
      seen.set(line.phoneE164, line.rowIndex);
    }
  }
  return dups;
}

/**
 * Detect duplicates with entries in OTHER CustomerLists in same org.
 * Returns map: rowIndex → { dupListId, dupEntryId }.
 *
 * Performance: batch query với IN clause. Excludes archived lists by default.
 */
export async function detectCrossListDup(
  lines: ParsedLine[],
  orgId: string,
  excludeListId?: string,
): Promise<Map<number, { dupListId: string; dupEntryId: string }>> {
  const validPhones = lines
    .filter((l) => l.valid && l.phoneE164)
    .map((l) => l.phoneE164!);
  if (validPhones.length === 0) return new Map();

  const existing = await prisma.customerListEntry.findMany({
    where: {
      phoneE164: { in: validPhones },
      customerList: { orgId, archivedAt: null, ...(excludeListId && { id: { not: excludeListId } }) },
    },
    select: {
      id: true,
      phoneE164: true,
      customerListId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' }, // earliest wins
  });

  // Map: phoneE164 → first existing entry
  const phoneToEntry = new Map<string, { entryId: string; listId: string }>();
  for (const e of existing) {
    if (e.phoneE164 && !phoneToEntry.has(e.phoneE164)) {
      phoneToEntry.set(e.phoneE164, { entryId: e.id, listId: e.customerListId });
    }
  }

  const dups = new Map<number, { dupListId: string; dupEntryId: string }>();
  for (const line of lines) {
    if (!line.valid || !line.phoneE164) continue;
    const match = phoneToEntry.get(line.phoneE164);
    if (match) {
      dups.set(line.rowIndex, { dupListId: match.listId, dupEntryId: match.entryId });
    }
  }
  return dups;
}

/**
 * Detect duplicates with existing Contact in CRM (cùng org).
 * Match by Contact.phoneNormalized = phoneE164's digits (without +).
 * Returns map: rowIndex → contactId.
 */
export async function detectCrmContactDup(
  lines: ParsedLine[],
  orgId: string,
): Promise<Map<number, string>> {
  // Contact.phoneNormalized stores "84xxx" (no leading +)
  const phonesNoPlus = lines
    .filter((l) => l.valid && l.phoneE164)
    .map((l) => l.phoneE164!.replace(/^\+/, ''));
  if (phonesNoPlus.length === 0) return new Map();

  const contacts = await prisma.contact.findMany({
    where: {
      orgId,
      phoneNormalized: { in: phonesNoPlus },
    },
    select: { id: true, phoneNormalized: true },
  });

  const phoneToContact = new Map<string, string>();
  for (const c of contacts) {
    if (c.phoneNormalized) phoneToContact.set(c.phoneNormalized, c.id);
  }

  const dups = new Map<number, string>();
  for (const line of lines) {
    if (!line.valid || !line.phoneE164) continue;
    const noPlus = line.phoneE164.replace(/^\+/, '');
    const contactId = phoneToContact.get(noPlus);
    if (contactId) dups.set(line.rowIndex, contactId);
  }
  return dups;
}

/**
 * High-level: parse rawText + run all 3 dedup checks. Returns enriched ParsedLine[]
 * with dup metadata, ready for persistence.
 */
export async function parseAndDedup(
  rawText: string,
  orgId: string,
): Promise<{
  lines: ParsedLine[];
  internalDup: Map<number, number>;
  crossListDup: Map<number, { dupListId: string; dupEntryId: string }>;
  crmContactDup: Map<number, string>;
}> {
  const lines = parseRawText(rawText);
  const internalDup = detectInternalDup(lines);
  const [crossListDup, crmContactDup] = await Promise.all([
    detectCrossListDup(lines, orgId),
    detectCrmContactDup(lines, orgId),
  ]);
  return { lines, internalDup, crossListDup, crmContactDup };
}

/**
 * Quick stats for dry-run preview before persist.
 */
export function summarizeParsed(
  lines: ParsedLine[],
  internalDup: Map<number, number>,
  crossListDup: Map<number, unknown>,
  crmContactDup: Map<number, unknown>,
): ImportResult {
  const valid = lines.filter((l) => l.valid).length;
  const invalid = lines.length - valid;
  return {
    total: lines.length,
    valid,
    invalid,
    dupInList: internalDup.size,
    parsedLines: lines,
  };
}
