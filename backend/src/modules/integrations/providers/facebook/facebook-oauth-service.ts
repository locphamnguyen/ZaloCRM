/**
 * facebook-oauth-service.ts — Meta OAuth flow: code exchange, page listing,
 * token encryption + persistence, page subscription management, and disconnect.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { encrypt, decrypt } from '../../../../shared/crypto/aes-gcm.js';
import {
  exchangeCodeForUserToken,
  exchangeUserTokenForLongLived,
  getManagedPages,
  subscribePage,
  unsubscribePage,
  type FacebookCreds,
} from './facebook-graph-client.js';
import { logActivity } from '../../../activity/activity-logger.js';
import { enqueueFormDiscovery } from './facebook-form-discovery-worker.js';
import { getFacebookConfig, getTokenEncKey } from './facebook-config-service.js';
import { encryptToken, decryptToken } from '../../_shared/token-encryption.util.js';

export type FacebookOAuthFlow = 'campaign' | 'form';

/** Lấy creds (appId/appSecret/version) per-org cho graph client. */
async function loadCreds(orgId: string): Promise<{
  creds: FacebookCreds;
  redirectUri: string;
  webhookVerifyToken: string | null;
  appSecret: string;
}> {
  const cfg = await getFacebookConfig(orgId);
  if (!cfg.appId || !cfg.appSecret) {
    throw new Error('Facebook App chưa được cấu hình (appId/appSecret). Vào ⚙ để điền.');
  }
  return {
    creds: { appId: cfg.appId, appSecret: cfg.appSecret, graphApiVersion: cfg.graphApiVersion },
    redirectUri: cfg.oauthRedirectUri ?? process.env.FB_OAUTH_REDIRECT_URI ?? '',
    webhookVerifyToken: cfg.webhookVerifyToken,
    appSecret: cfg.appSecret,
  };
}

const OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'leads_retrieval',
].join(',');

// ── CSRF state helpers ────────────────────────────────────────────────────────

/**
 * Build OAuth start URL + signed state. State = HMAC("<orgId>:<flow>:<ts>", appSecret).
 * Format: "<orgId>:<flow>:<timestamp>:<hmac_hex>". Dùng appId/appSecret/redirectUri per-org.
 */
export async function buildAuthUrl(
  orgId: string,
  flow: FacebookOAuthFlow = 'form',
): Promise<{ url: string; state: string }> {
  const { creds, redirectUri, appSecret } = await loadCreds(orgId);
  const state = signState(orgId, flow, appSecret);
  const params = new URLSearchParams({
    client_id: creds.appId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    state,
  });
  return { url: `https://www.facebook.com/dialog/oauth?${params.toString()}`, state };
}

function signState(orgId: string, flow: FacebookOAuthFlow, secret: string): string {
  const timestamp = Date.now().toString();
  const payload = `${orgId}:${flow}:${timestamp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

/**
 * Verify state. Parse orgId trước (để load config org đó), rồi verify HMAC bằng appSecret org.
 * Returns {orgId, flow} on success, null on tamper/expiry. State expires after 10 minutes.
 * Format: "<orgId>:<flow>:<timestamp>:<hmac_hex>".
 */
export async function verifyState(
  state: string,
): Promise<{ orgId: string; flow: FacebookOAuthFlow } | null> {
  try {
    const parts = state.split(':');
    if (parts.length !== 4) return null;
    const [orgId, flowRaw, timestamp, sig] = parts;
    const flow: FacebookOAuthFlow = flowRaw === 'campaign' ? 'campaign' : 'form';
    if (flowRaw !== 'campaign' && flowRaw !== 'form') return null;

    const cfg = await getFacebookConfig(orgId);
    const secret = cfg.appSecret ?? '';
    if (!secret) return null;

    const payload = `${orgId}:${flowRaw}:${timestamp}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (sig !== expected) return null;
    // Reject state older than 10 minutes
    const age = Date.now() - parseInt(timestamp, 10);
    if (age > 10 * 60 * 1_000) return null;
    return { orgId, flow };
  } catch {
    return null;
  }
}

// ── OAuth callback handler ────────────────────────────────────────────────────

/**
 * Full OAuth callback flow:
 * 1. Exchange code → short-lived user token
 * 2. Exchange → long-lived user token (60d)
 * 3. Fetch managed pages (tokens returned are already long-lived page tokens)
 * 4. Encrypt each page token, upsert FacebookPageConnection, subscribe page
 */
export async function handleCallback(
  code: string,
  orgId: string,
): Promise<{ connectedPages: number }> {
  const { creds, redirectUri } = await loadCreds(orgId);

  // Step 1: short-lived user token
  const { accessToken: shortToken } = await exchangeCodeForUserToken(code, redirectUri, creds);

  // Step 2: long-lived user token
  const { accessToken: longUserToken, expiresIn } =
    await exchangeUserTokenForLongLived(shortToken, creds);

  // Token expiry: expiresIn is in seconds from now
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1_000);

  // Step 3: list managed pages
  const pages = await getManagedPages(longUserToken);
  logger.info('[fb-oauth] Found %d managed pages for org %s', pages.length, orgId);

  // Khoá mã hoá page token per-org (UI ⚙) → fallback env. Resolve 1 lần cho cả vòng lặp.
  const tokenEncKey = await getTokenEncKey(orgId);

  let connectedPages = 0;

  for (const page of pages) {
    try {
      const tokenEnc = encrypt(page.access_token, tokenEncKey);

      // Step 4a: upsert connection
      await prisma.facebookPageConnection.upsert({
        where: { orgId_pageId: { orgId, pageId: page.id } },
        create: {
          orgId,
          pageId: page.id,
          pageName: page.name,
          accessTokenEnc: tokenEnc,
          tokenExpiresAt,
          subscribedAt: new Date(),
          status: 'connected',
        },
        update: {
          pageName: page.name,
          accessTokenEnc: tokenEnc,
          tokenExpiresAt,
          subscribedAt: new Date(),
          status: 'connected',
          lastError: null,
        },
      });

      // Step 4b: subscribe page to leadgen events
      await subscribePage(page.id, page.access_token);
      connectedPages++;

      // Step 4c: enqueue form discovery (fire-and-forget — don't block OAuth callback)
      // Fetch the connection record's ID for the worker
      const connRecord = await prisma.facebookPageConnection.findUnique({
        where: { orgId_pageId: { orgId, pageId: page.id } },
        select: { id: true },
      });
      if (connRecord) {
        void enqueueFormDiscovery({ orgId, pageConnectionId: connRecord.id, pageId: page.id });
      }

      logger.info('[fb-oauth] Connected page %s (%s) for org %s', page.name, page.id, orgId);
    } catch (err) {
      logger.error('[fb-oauth] Failed to connect page %s: %s', page.id, (err as Error).message);
      // Mark page as error but continue with others
      await prisma.facebookPageConnection
        .upsert({
          where: { orgId_pageId: { orgId, pageId: page.id } },
          create: {
            orgId,
            pageId: page.id,
            pageName: page.name,
            accessTokenEnc: '',
            status: 'error',
            lastError: (err as Error).message,
          },
          update: {
            status: 'error',
            lastError: (err as Error).message,
          },
        })
        .catch(() => {}); // best effort
    }
  }

  // Audit log (fire-and-forget — logActivity returns void)
  logActivity({
    orgId,
    systemSource: 'facebook-oauth',
    action: 'fb_oauth_connect',
    details: { connectedPages, totalPages: pages.length },
  });

  return { connectedPages };
}

// ── Campaign OAuth callback handler ────────────────────────────────────────────

/**
 * CAMPAIGN flow OAuth callback. Mirror handleCallback nhưng:
 *  - Lưu vào FacebookPageAccount (campaign model), token mã hoá bằng encryptToken
 *    (TOKEN_ENCRYPTION_KEY) — KHÔNG dùng aes-gcm.
 *  - webhookVerifyToken lấy từ config, hoặc sinh random hex nếu chưa có.
 *  - subscribePage để nhận leadgen webhook.
 */
export async function handleCampaignCallback(
  code: string,
  orgId: string,
): Promise<{ connectedPages: number }> {
  const { creds, redirectUri, webhookVerifyToken } = await loadCreds(orgId);

  const { accessToken: shortToken } = await exchangeCodeForUserToken(code, redirectUri, creds);
  const { accessToken: longUserToken } = await exchangeUserTokenForLongLived(shortToken, creds);

  const pages = await getManagedPages(longUserToken);
  logger.info('[fb-oauth] (campaign) Found %d managed pages for org %s', pages.length, orgId);

  const verifyToken = webhookVerifyToken || randomBytes(24).toString('hex');
  let connectedPages = 0;

  for (const page of pages) {
    try {
      const tokenEnc = encryptToken(page.access_token);

      await prisma.facebookPageAccount.upsert({
        where: { pageId: page.id },
        create: {
          orgId,
          pageId: page.id,
          pageName: page.name,
          encryptedAccessToken: tokenEnc,
          webhookVerifyToken: verifyToken,
          isActive: true,
        },
        update: {
          orgId,
          pageName: page.name,
          encryptedAccessToken: tokenEnc,
          isActive: true,
        },
      });

      await subscribePage(page.id, page.access_token);
      connectedPages++;

      logger.info('[fb-oauth] (campaign) Connected page %s (%s) for org %s', page.name, page.id, orgId);
    } catch (err) {
      logger.error(
        '[fb-oauth] (campaign) Failed to connect page %s: %s',
        page.id,
        (err as Error).message,
      );
    }
  }

  logActivity({
    orgId,
    systemSource: 'facebook-oauth',
    action: 'fb_oauth_connect_campaign',
    details: { connectedPages, totalPages: pages.length },
  });

  return { connectedPages };
}

// ── Disconnect page ───────────────────────────────────────────────────────────

/**
 * Disconnect a Facebook page:
 * 1. Fetch current token before wipe (needed for unsubscribe call)
 * 2. Wipe accessTokenEnc, set status=revoked
 * 3. Best-effort call to FB unsubscribe
 */
export async function disconnectPage(orgId: string, pageId: string): Promise<void> {
  const conn = await prisma.facebookPageConnection.findUnique({
    where: { orgId_pageId: { orgId, pageId } },
  });

  if (!conn) {
    throw new Error(`[fb-oauth] Page connection ${pageId} not found for org ${orgId}`);
  }

  // Wipe token + set revoked
  await prisma.facebookPageConnection.update({
    where: { orgId_pageId: { orgId, pageId } },
    data: {
      accessTokenEnc: '',
      status: 'revoked',
    },
  });

  // Best-effort unsubscribe using the token we had before wipe
  if (conn.accessTokenEnc) {
    try {
      const pageToken = decrypt(conn.accessTokenEnc, await getTokenEncKey(orgId));
      await unsubscribePage(pageId, pageToken);
    } catch (err) {
      logger.warn('[fb-oauth] Unsubscribe failed for page %s (best effort): %s', pageId, (err as Error).message);
    }
  }

  // Audit log (fire-and-forget)
  logActivity({
    orgId,
    systemSource: 'facebook-oauth',
    action: 'fb_page_disconnect',
    details: { pageId, pageName: conn.pageName },
  });

  logger.info('[fb-oauth] Disconnected page %s for org %s', pageId, orgId);
}

// ── Campaign disconnect ─────────────────────────────────────────────────────────

/**
 * CAMPAIGN flow disconnect: set FacebookPageAccount.isActive=false cho org+pageId,
 * best-effort unsubscribe bằng token đã giải mã (encryptToken/decryptToken).
 */
export async function disconnectCampaignPage(orgId: string, pageId: string): Promise<void> {
  const conn = await prisma.facebookPageAccount.findFirst({
    where: { orgId, pageId },
  });
  if (!conn) {
    throw new Error(`[fb-oauth] Campaign page ${pageId} not found for org ${orgId}`);
  }

  await prisma.facebookPageAccount.update({
    where: { id: conn.id },
    data: { isActive: false },
  });

  // Best-effort unsubscribe
  if (conn.encryptedAccessToken) {
    try {
      const pageToken = decryptToken(conn.encryptedAccessToken);
      await unsubscribePage(pageId, pageToken);
    } catch (err) {
      logger.warn(
        '[fb-oauth] (campaign) Unsubscribe failed for page %s (best effort): %s',
        pageId,
        (err as Error).message,
      );
    }
  }

  logActivity({
    orgId,
    systemSource: 'facebook-oauth',
    action: 'fb_page_disconnect',
    details: { pageId, pageName: conn.pageName, flow: 'campaign' },
  });

  logger.info('[fb-oauth] (campaign) Disconnected page %s for org %s', pageId, orgId);
}
