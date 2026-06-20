// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Central AI provider registry.
 *
 * Catalog (id/name/default baseUrl/env token) đến từ .env, dựng 1 lần lúc boot.
 * Nhưng API key + base URL + danh sách model giờ quản lý PER-ORG trên UI:
 *   - key  : app_settings.value_encrypted (AES-GCM, key UI override .env)
 *   - url  : app_settings.value_plain (override .env)
 *   - model: lấy động từ provider (xem providers/list-models.ts), KHÔNG hardcode ở đây.
 */
import { config } from '../../config/index.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { encryptToken, decryptToken } from '../integrations/_shared/token-encryption.util.js';
import { logger } from '../../shared/utils/logger.js';

export type ProviderModel = { title: string; value: string };

/** Catalog entry tĩnh (env-based) */
export type ProviderDef = {
  id: string;
  name: string;
  baseUrl: string;
  authToken: string;
};

/** Thông tin provider trả về UI (KHÔNG kèm key thật) */
export type ProviderInfo = {
  id: string;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  keyMask: string;
};

const PROVIDER_IDS = ['anthropic', 'gemini', 'openai', 'qwen', 'kimi'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Build catalog tĩnh từ config (env) */
function buildCatalog(): ProviderDef[] {
  return [
    { id: 'anthropic', name: 'Anthropic', baseUrl: config.anthropicBaseUrl, authToken: config.anthropicAuthToken },
    { id: 'gemini', name: 'Gemini', baseUrl: config.geminiBaseUrl, authToken: config.geminiAuthToken },
    { id: 'openai', name: 'OpenAI', baseUrl: config.openaiBaseUrl, authToken: config.openaiAuthToken },
    { id: 'qwen', name: 'Qwen', baseUrl: config.qwenBaseUrl, authToken: config.qwenAuthToken },
    { id: 'kimi', name: 'Kimi', baseUrl: config.kimiBaseUrl, authToken: config.kimiAuthToken },
  ];
}

const catalog = buildCatalog();

/** Catalog entry (env defaults) cho 1 provider */
export function getProviderConfig(providerId: string): ProviderDef | undefined {
  return catalog.find((p) => p.id === providerId);
}

function isValidProvider(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

const keySettingKey = (provider: string) => `ai_${provider}_api_key`;
const urlSettingKey = (provider: string) => `ai_${provider}_base_url`;

/** Mask key để hiển thị UI: "••••1234" */
function maskKey(key: string): string {
  if (!key) return '';
  return `••••${key.slice(-4)}`;
}

/**
 * Resolve API key per-org theo thứ tự ưu tiên:
 *   1. DB value_encrypted (giải mã)  ← key nhập trên UI
 *   2. DB value_plain (legacy)
 *   3. env authToken (.env fallback)
 */
export async function resolveProviderApiKey(orgId: string, provider: string): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: keySettingKey(provider) } },
  });
  if (setting?.valueEncrypted) {
    try {
      return decryptToken(Buffer.from(setting.valueEncrypted).toString('utf8'));
    } catch (err) {
      logger.error('[ai-registry] decrypt key fail provider=%s: %s', provider, (err as Error).message);
    }
  }
  if (setting?.valuePlain) return setting.valuePlain;
  return getProviderConfig(provider)?.authToken || '';
}

/** Resolve base URL per-org: DB value_plain → env default */
export async function getProviderBaseUrl(orgId: string, provider: string): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId, settingKey: urlSettingKey(provider) } },
  });
  return setting?.valuePlain || getProviderConfig(provider)?.baseUrl || '';
}

/** Set/xoá API key per-org (apiKey rỗng/null = xoá → quay về env fallback) */
export async function setProviderApiKey(orgId: string, provider: string, apiKey: string | null): Promise<void> {
  if (!isValidProvider(provider)) throw new Error(`Unknown provider: ${provider}`);
  const settingKey = keySettingKey(provider);
  if (!apiKey) {
    await prisma.appSetting.deleteMany({ where: { orgId, settingKey } });
    return;
  }
  const blob = Buffer.from(encryptToken(apiKey), 'utf8');
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey } },
    create: { orgId, settingKey, valueEncrypted: blob },
    update: { valueEncrypted: blob, valuePlain: null },
  });
}

/** Set/xoá base URL per-org (rỗng/null = xoá → quay về env) */
export async function setProviderBaseUrl(orgId: string, provider: string, baseUrl: string | null): Promise<void> {
  if (!isValidProvider(provider)) throw new Error(`Unknown provider: ${provider}`);
  const settingKey = urlSettingKey(provider);
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    await prisma.appSetting.deleteMany({ where: { orgId, settingKey } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey } },
    create: { orgId, settingKey, valuePlain: trimmed },
    update: { valuePlain: trimmed },
  });
}

/**
 * Danh sách provider cho UI (cả 5), kèm baseUrl + trạng thái key per-org.
 * Một provider "khả dụng" khi có key (DB hoặc .env).
 */
export async function getAvailableProviders(orgId: string): Promise<ProviderInfo[]> {
  return Promise.all(
    catalog.map(async (p) => {
      const [key, baseUrl] = await Promise.all([
        resolveProviderApiKey(orgId, p.id),
        getProviderBaseUrl(orgId, p.id),
      ]);
      return { id: p.id, name: p.name, baseUrl, hasKey: !!key, keyMask: maskKey(key) };
    }),
  );
}
