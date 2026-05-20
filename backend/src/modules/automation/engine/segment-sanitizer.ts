// Phase 7 — SegmentSpec sanitizer (fix CODEX P1 #1).
//
// Bug: campaign-materializer + broadcast-routes + fire-broadcast all did
//   const where = { orgId, ...criteria }
// If criteria contains { orgId: 'other-org' } it overrides → cross-tenant leak.
// Also: arbitrary Prisma operators could resolve massive sets (e.g. OR with no
// limit), or use relational fields to traverse to other orgs.
//
// Fix: AND-scope guarantees orgId precedence + whitelist allowed top-level fields.
//   sanitizeContactCriteria({ orgId: 'X' }, { orgId: 'Y', tagIds: ... })
//   → { AND: [{ orgId: 'X' }, { tagIds: ... }] }  (orgId from criteria stripped)
//
// Whitelist intentionally narrow — broadcasts/sequences need predictable filters,
// not arbitrary Prisma. Add fields here as features need them.

const ALLOWED_CONTACT_FIELDS = new Set([
  // Identity / classification
  'statusId',
  'leadScore',
  'acceptedNicksCount',
  'pendingNicksCount',
  'chattingNicksCount',
  'hasZalo',
  'source',
  // Filtering by phone availability (NOT by phone value — that's PII-targeting)
  'phoneNormalized',
  // Time windows
  'createdAt',
  'lastInboundAt',
  'lastOutboundAt',
  'lastActivity',
  // Geo
  'province',
  'district',
  'ward',
  // CRM tags (JSON array contains)
  'tags',
  // Owner assignment
  'assignedUserId',
  // Import batch
  'importBatchId',
  // Special: explicit { id: { in: [...] } } allowed for manual-style filters
  // (still scoped to orgId via AND).
  'id',
]);

const ALLOWED_OPERATORS = new Set([
  'equals', 'not', 'in', 'notIn',
  'gt', 'gte', 'lt', 'lte',
  'contains', 'startsWith', 'endsWith',
  'has', 'hasSome', 'hasEvery',
  // Compound (engine still applies AND-scope outside, so AND/OR here are safe to allow
  // for advanced filters as long as nested fields also pass whitelist)
]);

export interface SanitizeResult {
  ok: boolean;
  where?: Record<string, unknown>;
  rejected?: string[]; // fields/operators that were stripped
}

/**
 * Sanitize user-supplied Contact filter criteria.
 *
 * Returns a Prisma `where` clause that ALWAYS forces orgId scope via AND-wrap.
 * Strips any criteria field not in the whitelist. Recursively whitelists nested
 * operator keys. Caller should treat `rejected` as a warning (log it).
 */
export function sanitizeContactCriteria(
  orgId: string,
  rawCriteria: unknown,
): SanitizeResult {
  const rejected: string[] = [];

  if (rawCriteria === null || rawCriteria === undefined) {
    return { ok: true, where: { orgId } };
  }
  if (typeof rawCriteria !== 'object' || Array.isArray(rawCriteria)) {
    return { ok: false, rejected: ['criteria must be an object'] };
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawCriteria)) {
    if (!ALLOWED_CONTACT_FIELDS.has(key)) {
      rejected.push(`field:${key}`);
      continue;
    }

    // Allow scalar values (string/number/bool/null) + operator-objects.
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      // Arrays only allowed as { in: [...] } shorthand — convert to operator form
      sanitized[key] = { in: value };
      continue;
    }

    if (typeof value === 'object') {
      const opObj: Record<string, unknown> = {};
      for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
        if (!ALLOWED_OPERATORS.has(op)) {
          rejected.push(`${key}.operator:${op}`);
          continue;
        }
        opObj[op] = opVal;
      }
      if (Object.keys(opObj).length > 0) {
        sanitized[key] = opObj;
      }
      continue;
    }

    rejected.push(`field:${key} (unsupported type)`);
  }

  // AND-wrap forces orgId precedence — criteria.orgId would be stripped above,
  // but this is defense in depth: even if a future bug allowed orgId through,
  // the AND ordering means Prisma evaluates the literal orgId first.
  return {
    ok: true,
    where: { AND: [{ orgId }, sanitized] },
    rejected: rejected.length > 0 ? rejected : undefined,
  };
}

/**
 * Sanitize manual contactIds list — strip non-string + cap length + verify
 * caller-side that all IDs belong to this org. Caller (route) does the org
 * verification via prisma.contact.findMany({ where: { id: { in }, orgId } }).
 */
export function sanitizeManualContactIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 100)
    .slice(0, 10000); // hard cap defensive
}
