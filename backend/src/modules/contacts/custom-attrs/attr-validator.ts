/**
 * attr-validator.ts — Validates contact customAttrs payload against org definitions.
 * Per-org def cache with 60s TTL. Strict mode default ON.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import type { AttrDef, AttrValidationError, AttrValidationResult } from './attr-def-types.js';

interface CacheEntry {
  defs: AttrDef[];
  loadedAt: number;
}

const CACHE_TTL_MS = 60_000;
const defCache = new Map<string, CacheEntry>();

async function loadDefs(orgId: string): Promise<AttrDef[]> {
  const now = Date.now();
  const cached = defCache.get(orgId);
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) return cached.defs;

  const rows = await prisma.customAttributeDefinition.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  const defs: AttrDef[] = rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    key: r.key,
    label: r.label,
    dataType: r.dataType as AttrDef['dataType'],
    enumValues: Array.isArray(r.enumValues) ? (r.enumValues as string[]) : null,
    required: r.required,
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  defCache.set(orgId, { defs, loadedAt: now });
  return defs;
}

/** Force-expire cache for an org (call after def mutations) */
export function invalidateDefCache(orgId: string): void {
  defCache.delete(orgId);
}

function validateValue(key: string, value: unknown, def: AttrDef): AttrValidationError | null {
  switch (def.dataType) {
    case 'string': {
      if (typeof value !== 'string') {
        return { key, code: 'invalid_type', message: `${key}: expected string` };
      }
      if (value.length > 1000) {
        return { key, code: 'value_too_long', message: `${key}: exceeds 1000 characters` };
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !isFinite(value)) {
        return { key, code: 'invalid_type', message: `${key}: expected finite number` };
      }
      return null;
    }
    case 'date': {
      if (typeof value !== 'string' || isNaN(Date.parse(value))) {
        return { key, code: 'invalid_type', message: `${key}: expected ISO 8601 date string` };
      }
      return null;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return { key, code: 'invalid_type', message: `${key}: expected boolean` };
      }
      return null;
    }
    case 'enum': {
      const allowed = def.enumValues ?? [];
      if (!allowed.includes(value as string)) {
        return {
          key,
          code: 'invalid_enum',
          message: `${key}: must be one of [${allowed.join(', ')}]`,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validate customAttrs payload against org's attribute definitions.
 * @param orgId - organization scoping
 * @param payload - incoming customAttrs object from request body
 * @param existingAttrs - current persisted attrs (used for required-field check on partial updates)
 */
export async function validateCustomAttrs(
  orgId: string,
  payload: Record<string, unknown>,
  existingAttrs?: Record<string, unknown>,
): Promise<AttrValidationResult> {
  const defs = await loadDefs(orgId);
  const defMap = new Map(defs.map((d) => [d.key, d]));
  const strict = process.env.CUSTOM_ATTR_STRICT !== 'false';
  const errors: AttrValidationError[] = [];

  // Validate each incoming key
  for (const [key, value] of Object.entries(payload)) {
    const def = defMap.get(key);
    if (!def) {
      if (strict) {
        errors.push({ key, code: 'unknown_key', message: `${key}: unknown attribute key` });
      }
      continue;
    }
    const err = validateValue(key, value, def);
    if (err) errors.push(err);
  }

  // Check required defs not present in payload OR existing attrs
  const merged = { ...(existingAttrs ?? {}), ...payload };
  for (const def of defs) {
    if (!def.required) continue;
    if (!(def.key in merged) || merged[def.key] === null || merged[def.key] === undefined) {
      errors.push({
        key: def.key,
        code: 'required_missing',
        message: `${def.key}: required attribute missing`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}
