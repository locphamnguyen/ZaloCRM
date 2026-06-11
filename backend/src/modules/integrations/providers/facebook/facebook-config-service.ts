/**
 * facebook-config-service.ts — Config FB App per-org (Phase FB 2-tab 2026-06-10).
 *
 * 4 biến (appId, appSecret, webhookVerifyToken, tokenEncKey) điền qua UI (nút ⚙ ở
 * cả 2 tab) → lưu DB per-org. Code đọc: DB per-org → fallback process.env.
 * appSecret + tokenEncKey MÃ HOÁ at-rest bằng env TOKEN_ENCRYPTION_KEY (token-encryption.util).
 * Trả về UI thì CHE secret (chỉ báo đã-có/chưa-có, không lộ giá trị).
 */
import { prisma } from '../../../../shared/database/prisma-client.js';
import { runSystemQuery } from '../../../../shared/tenant/tenant-context.js';
import { encryptToken, decryptToken } from '../../_shared/token-encryption.util.js';
import { logger } from '../../../../shared/utils/logger.js';

export interface ResolvedFacebookConfig {
  appId: string | null;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  tokenEncKey: string | null;
  graphApiVersion: string;
  oauthRedirectUri: string | null;
}

export interface MaskedFacebookConfig {
  appId: string | null;
  webhookVerifyToken: string | null;
  hasAppSecret: boolean;
  hasTokenEncKey: boolean;
  oauthRedirectUri: string | null;
  graphApiVersion: string;
  // True nếu đang dùng giá trị từ env (chưa cấu hình UI) — FE hiển thị nhãn.
  fromEnvFallback: boolean;
}

function safeDecrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    return decryptToken(blob);
  } catch (err) {
    logger.error(`[fb-config] decrypt fail: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Đọc config đã giải mã cho 1 org. Mỗi field: DB per-org (nếu có) → fallback env.
 * Dùng ở OAuth/webhook/aes — KHÔNG trả ra UI (chứa secret thật).
 */
export async function getFacebookConfig(orgId: string): Promise<ResolvedFacebookConfig> {
  const row = await runSystemQuery(() =>
    prisma.facebookAppConfig.findUnique({ where: { orgId } }),
  );
  return {
    appId: row?.appId || process.env.FB_APP_ID || null,
    appSecret: safeDecrypt(row?.appSecretEnc) || process.env.FB_APP_SECRET || null,
    webhookVerifyToken:
      row?.webhookVerifyToken || process.env.FB_WEBHOOK_VERIFY_TOKEN || null,
    tokenEncKey: safeDecrypt(row?.tokenEncKeyEnc) || process.env.FB_TOKEN_ENC_KEY || null,
    graphApiVersion: process.env.FB_GRAPH_API_VERSION || 'v21.0',
    oauthRedirectUri: process.env.FB_OAUTH_REDIRECT_URI || null,
  };
}

/**
 * Khoá AES-256-GCM mã hoá page token luồng Form: DB per-org (UI ⚙) → fallback env.
 * Trả null nếu chưa cấu hình ở cả 2 nơi (aes-gcm sẽ throw khi dùng — fail-safe).
 */
export async function getTokenEncKey(orgId: string): Promise<string | null> {
  const cfg = await getFacebookConfig(orgId);
  return cfg.tokenEncKey;
}

/** Bản che secret để trả ra UI. */
export async function getFacebookConfigMasked(orgId: string): Promise<MaskedFacebookConfig> {
  const row = await runSystemQuery(() =>
    prisma.facebookAppConfig.findUnique({ where: { orgId } }),
  );
  const hasAppSecret = !!(row?.appSecretEnc || process.env.FB_APP_SECRET);
  const hasTokenEncKey = !!(row?.tokenEncKeyEnc || process.env.FB_TOKEN_ENC_KEY);
  return {
    appId: row?.appId || process.env.FB_APP_ID || null,
    webhookVerifyToken: row?.webhookVerifyToken || process.env.FB_WEBHOOK_VERIFY_TOKEN || null,
    hasAppSecret,
    hasTokenEncKey,
    oauthRedirectUri: process.env.FB_OAUTH_REDIRECT_URI || null,
    graphApiVersion: process.env.FB_GRAPH_API_VERSION || 'v21.0',
    fromEnvFallback: !row,
  };
}

/**
 * Webhook GET verify là APP-LEVEL (Meta không gửi orgId). Chấp nhận nếu `token` khớp
 * webhookVerifyToken đã cấu hình UI của BẤT KỲ org nào (DB) → fallback env.
 * Trả về true nếu hợp lệ. Dùng cho verifyChallenge của luồng Form.
 */
export async function isWebhookVerifyTokenValid(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await runSystemQuery(() =>
    prisma.facebookAppConfig.findFirst({ where: { webhookVerifyToken: token }, select: { id: true } }),
  );
  if (row) return true;
  const envToken = process.env.FB_WEBHOOK_VERIFY_TOKEN;
  return !!envToken && envToken === token;
}

export interface SetFacebookConfigInput {
  appId?: string | null;
  appSecret?: string | null; // plaintext; '' = giữ nguyên, null = không đổi
  webhookVerifyToken?: string | null;
  tokenEncKey?: string | null; // plaintext; '' = giữ nguyên
}

/**
 * Upsert config per-org. Secret rỗng/undefined → GIỮ nguyên giá trị cũ (không ghi đè).
 * tokenEncKey nếu set phải 64 hex (validate sớm để báo lỗi rõ).
 */
export async function setFacebookConfig(
  orgId: string,
  input: SetFacebookConfigInput,
): Promise<void> {
  if (input.tokenEncKey && !/^[0-9a-fA-F]{64}$/.test(input.tokenEncKey.trim())) {
    throw new Error('FB_TOKEN_ENC_KEY phải là 64 ký tự hex (32 bytes). Tạo: openssl rand -hex 32');
  }
  const data: Record<string, string | null> = {};
  if (input.appId !== undefined) data.appId = input.appId?.trim() || null;
  if (input.webhookVerifyToken !== undefined)
    data.webhookVerifyToken = input.webhookVerifyToken?.trim() || null;
  // Secret: chỉ ghi khi có giá trị mới (non-empty). Rỗng → bỏ qua (giữ cũ).
  if (input.appSecret) data.appSecretEnc = encryptToken(input.appSecret.trim());
  if (input.tokenEncKey) data.tokenEncKeyEnc = encryptToken(input.tokenEncKey.trim());

  await runSystemQuery(() =>
    prisma.facebookAppConfig.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    }),
  );
  logger.info(`[fb-config] org ${orgId} cập nhật config FB App (fields: ${Object.keys(data).join(',')})`);
}
