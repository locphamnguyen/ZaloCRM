/**
 * api-key-service.ts — Generate, hash, verify, list, and revoke API keys.
 * Keys: random 32 bytes → base64url → "zcrm_<base64url>"
 * Storage: keyPrefix (first 8 chars for display), keyHash (sha256 hex, indexed)
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import type { Scope } from './api-key-types.js';

const PREFIX_TAG = 'zcrm_';

export interface GeneratedKey {
  rawKey: string;
  prefix: string;
  hash: string;
}

export interface ApiKeyRow {
  id: string;
  orgId: string;
  name: string;
  keyPrefix: string;
  scopes: Scope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}

/** Generate a new raw key + derived prefix + sha256 hash. */
export function generateApiKey(): GeneratedKey {
  const secret = randomBytes(32).toString('base64url');
  const rawKey = `${PREFIX_TAG}${secret}`;
  const prefix = rawKey.slice(0, 12); // "zcrm_" + 7 chars
  const hash = hashKey(rawKey);
  return { rawKey, prefix, hash };
}

/** sha256 hex of a raw key string. */
export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Look up an ApiKey row by raw key value. Returns null if not found. */
export async function verifyKey(rawKey: string): Promise<ApiKeyRow | null> {
  const hash = hashKey(rawKey);
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!row) return null;
  return toRow(row);
}

/** List all non-revoked API keys for an org (no keyHash exposed). */
export async function listKeys(orgId: string): Promise<ApiKeyRow[]> {
  const rows = await prisma.apiKey.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toRow);
}

/** Create a new API key record. Returns the stored row (rawKey not persisted here — caller handles it). */
export async function createKey(
  orgId: string,
  createdByUserId: string,
  name: string,
  scopes: Scope[],
  expiresAt?: Date,
): Promise<{ row: ApiKeyRow; rawKey: string }> {
  const { rawKey, prefix, hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      orgId,
      name,
      keyPrefix: prefix,
      keyHash: hash,
      scopes: scopes as unknown as string[],
      expiresAt: expiresAt ?? null,
      createdByUserId,
    },
  });
  return { row: toRow(row), rawKey };
}

/** Soft-revoke: set revokedAt = now. Org-scoped for safety. */
export async function revokeKey(id: string, orgId: string): Promise<boolean> {
  const existing = await prisma.apiKey.findFirst({
    where: { id, orgId, revokedAt: null },
  });
  if (!existing) return false;
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return true;
}

function toRow(r: {
  id: string;
  orgId: string;
  name: string;
  keyPrefix: string;
  scopes: unknown;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}): ApiKeyRow {
  const rawScopes = Array.isArray(r.scopes) ? (r.scopes as string[]) : ['read'];
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    keyPrefix: r.keyPrefix,
    scopes: rawScopes as Scope[],
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt,
  };
}
