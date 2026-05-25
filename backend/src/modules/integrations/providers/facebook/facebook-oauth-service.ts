/**
 * facebook-oauth-service.ts — Meta OAuth flow: code exchange, page listing,
 * token encryption + persistence, page subscription management, and disconnect.
 */
import { createHmac } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { encrypt, decrypt } from '../../../../shared/crypto/aes-gcm.js';
import {
  exchangeCodeForUserToken,
  exchangeUserTokenForLongLived,
  getManagedPages,
  subscribePage,
  unsubscribePage,
} from './facebook-graph-client.js';
import { logActivity } from '../../../activity/activity-logger.js';
import { enqueueFormDiscovery } from './facebook-form-discovery-worker.js';

const OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'leads_retrieval',
].join(',');

// ── CSRF state helpers ────────────────────────────────────────────────────────

/**
 * Build OAuth start URL. State = HMAC-signed "<orgId>:<timestamp>" to prevent CSRF.
 */
export function buildAuthUrl(orgId: string, state: string): string {
  const appId = process.env.FB_APP_ID ?? '';
  const redirectUri = process.env.FB_OAUTH_REDIRECT_URI ?? '';
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/dialog/oauth?${params.toString()}`;
}

/**
 * Generate CSRF state token: HMAC-SHA256("<orgId>:<timestamp>", FB_APP_SECRET).
 * Format stored/passed: "<orgId>:<timestamp>:<hmac_hex>".
 */
export function generateState(orgId: string): string {
  const secret = process.env.FB_APP_SECRET ?? '';
  const timestamp = Date.now().toString();
  const payload = `${orgId}:${timestamp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${sig}`;
}

/**
 * Verify state param. Returns orgId on success, null on tamper/expiry.
 * State expires after 10 minutes.
 */
export function verifyState(state: string): string | null {
  try {
    const parts = state.split(':');
    if (parts.length !== 3) return null;
    const [orgId, timestamp, sig] = parts;
    const secret = process.env.FB_APP_SECRET ?? '';
    const payload = `${orgId}:${timestamp}`;
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (sig !== expected) return null;
    // Reject state older than 10 minutes
    const age = Date.now() - parseInt(timestamp, 10);
    if (age > 10 * 60 * 1_000) return null;
    return orgId;
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
  const redirectUri = process.env.FB_OAUTH_REDIRECT_URI ?? '';

  // Step 1: short-lived user token
  const { accessToken: shortToken } = await exchangeCodeForUserToken(code, redirectUri);

  // Step 2: long-lived user token
  const { accessToken: longUserToken, expiresIn } =
    await exchangeUserTokenForLongLived(shortToken);

  // Token expiry: expiresIn is in seconds from now
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1_000);

  // Step 3: list managed pages
  const pages = await getManagedPages(longUserToken);
  logger.info('[fb-oauth] Found %d managed pages for org %s', pages.length, orgId);

  let connectedPages = 0;

  for (const page of pages) {
    try {
      const tokenEnc = encrypt(page.access_token);

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
      const pageToken = decrypt(conn.accessTokenEnc);
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
