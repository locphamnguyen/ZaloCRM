// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * list-models.ts — Lấy DANH SÁCH MODEL trực tiếp từ API của từng provider.
 * Trả về [{title, value}]. Có cache in-memory theo orgId:provider (TTL 5 phút)
 * để tránh gọi mạng mỗi lần mở dialog. Ném lỗi khi provider không trả được
 * (route sẽ bắt và trả {models:[],error} cho UI fallback gõ tay).
 */
import { logger } from '../../../shared/utils/logger.js';

export type ProviderModel = { title: string; value: string };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; models: ProviderModel[] }>();

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function toModels(ids: string[]): ProviderModel[] {
  return Array.from(new Set(ids))
    .filter(Boolean)
    .sort()
    .map((id) => ({ title: id, value: id }));
}

async function listOpenaiCompat(baseUrl: string, apiKey: string, path: string): Promise<ProviderModel[]> {
  const data = (await fetchJson(`${baseUrl}${path}`, { authorization: `Bearer ${apiKey}` })) as {
    data?: Array<{ id?: string }>;
  };
  return toModels((data.data ?? []).map((m) => m.id || ''));
}

async function listAnthropic(baseUrl: string, apiKey: string): Promise<ProviderModel[]> {
  const data = (await fetchJson(`${baseUrl}/v1/models`, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  })) as { data?: Array<{ id?: string }> };
  return toModels((data.data ?? []).map((m) => m.id || ''));
}

async function listGemini(baseUrl: string, apiKey: string): Promise<ProviderModel[]> {
  const data = (await fetchJson(
    `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    {},
  )) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  const ids = (data.models ?? [])
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''));
  return toModels(ids);
}

/**
 * Liệt kê model cho provider. baseUrl/apiKey đã resolve per-org trước khi gọi.
 */
export async function listProviderModels(
  provider: string,
  baseUrl: string,
  apiKey: string,
  orgId: string,
): Promise<ProviderModel[]> {
  const cacheKey = `${orgId}:${provider}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.models;

  let models: ProviderModel[];
  switch (provider) {
    case 'openai':
    case 'kimi':
      models = await listOpenaiCompat(baseUrl, apiKey, '/v1/models');
      break;
    case 'qwen':
      models = await listOpenaiCompat(baseUrl, apiKey, '/compatible-mode/v1/models');
      break;
    case 'anthropic':
      models = await listAnthropic(baseUrl, apiKey);
      break;
    case 'gemini':
      models = await listGemini(baseUrl, apiKey);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  cache.set(cacheKey, { at: Date.now(), models });
  logger.info('[ai-list-models] provider=%s org=%s count=%d', provider, orgId, models.length);
  return models;
}

/** Xoá cache khi key/baseUrl thay đổi (route gọi sau khi PUT) */
export function invalidateModelCache(orgId: string, provider: string): void {
  cache.delete(`${orgId}:${provider}`);
}
