/**
 * api-keys-api.ts — Typed API wrappers for API Key management endpoints.
 * Routes are at /api/api-keys (no /v1 prefix) → use apiRoot instance.
 */
import { apiRoot } from '@/api/blocks-api';

// ─── Types ────────────────────────────────────────────────────────────────

export type ApiKeyScope = 'read' | 'write';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface CreateApiKeyPayload {
  name: string;
  scopes?: ApiKeyScope[];
  expiresAt?: string | null;
}

/** Only returned on creation — full key shown once */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

// ─── API functions ────────────────────────────────────────────────────────

export async function listApiKeys(): Promise<ApiKey[]> {
  const res = await apiRoot.get<{ keys: ApiKey[] }>('/api/api-keys');
  return res.data.keys;
}

export async function createApiKey(payload: CreateApiKeyPayload): Promise<CreatedApiKey> {
  const res = await apiRoot.post<CreatedApiKey>('/api/api-keys', payload);
  return res.data;
}

export async function deleteApiKey(id: string): Promise<void> {
  await apiRoot.delete(`/api/api-keys/${id}`);
}
