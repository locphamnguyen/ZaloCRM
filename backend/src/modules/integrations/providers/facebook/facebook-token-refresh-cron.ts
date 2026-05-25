/**
 * facebook-token-refresh-cron.ts — Daily cron that validates and refreshes
 * Facebook Page Tokens before they expire.
 *
 * Schedule: daily at 03:00 server time (low-traffic window).
 * Strategy (MVP): call GET /{pageId}?fields=access_token using the stored Page Token.
 *   - 200 → token still live; extend tokenExpiresAt by 50d (conservative).
 *   - 4xx (401/190) → token dead; mark status='error', log + write ActivityLog.
 *   - 5xx / network error → don't change status; retry next daily run.
 *
 * Page tokens derived from /me/accounts are "permanent" (don't expire) for pages.
 * However, if the User revokes app access the token becomes invalid (API returns 190).
 * This cron detects that case early and alerts the admin.
 *
 * Idempotency: mutex flag prevents overlap if a run takes > 24h (impossible in practice).
 * Batch size: 50 pages per run with 100ms stagger to avoid rate-limit bursts.
 */

import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { decrypt, encrypt } from '../../../../shared/crypto/aes-gcm.js';
import { logActivity } from '../../../activity/activity-logger.js';

const CRON_SCHEDULE = '0 3 * * *'; // daily at 03:00
const BATCH_SIZE = 50;
const STAGGER_MS = 100;
// 7-day safety window: refresh (or detect dead) when expiry < now + 7d
const EXPIRY_WINDOW_DAYS = 7;
// If token is still alive, extend expiry by 50 days
const EXTEND_DAYS = 50;

const GRAPH_BASE = () =>
  `https://graph.facebook.com/${process.env.FB_GRAPH_API_VERSION ?? 'v23.0'}`;

let cronRunning = false;
let cronTask: ReturnType<typeof cron.schedule> | null = null;

// ── Public lifecycle ─────────────────────────────────────────────────────────

/** Start daily token-refresh cron. Idempotent. */
export function startFacebookTokenRefreshCron(): void {
  if (cronTask) {
    logger.info('[fb-token-cron] Already started, skipping');
    return;
  }
  cronTask = cron.schedule(CRON_SCHEDULE, async () => {
    if (cronRunning) {
      logger.warn('[fb-token-cron] Previous run still in progress, skipping tick');
      return;
    }
    cronRunning = true;
    const startedAt = Date.now();
    try {
      await runRefreshCycle();
    } catch (err) {
      logger.error('[fb-token-cron] Unexpected cycle error:', err);
    } finally {
      cronRunning = false;
      logger.info(`[fb-token-cron] Cycle completed in ${Date.now() - startedAt}ms`);
    }
  });
  logger.info(`[fb-token-cron] Started, schedule="${CRON_SCHEDULE}"`);
}

/** Stop cron (test cleanup / graceful shutdown). */
export function stopFacebookTokenRefreshCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('[fb-token-cron] Stopped');
  }
}

/** Exported for manual trigger endpoint — runs cycle directly for a specific org. */
export async function runRefreshForOrg(orgId: string): Promise<RefreshSummary> {
  return runRefreshCycle(orgId);
}

/** Exported for tests — runs full cycle without scheduling. */
export async function runRefreshCycleNow(): Promise<RefreshSummary> {
  return runRefreshCycle();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RefreshSummary {
  checked: number;
  refreshed: number;
  errors: number;
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function runRefreshCycle(filterOrgId?: string): Promise<RefreshSummary> {
  const expiryThreshold = new Date(Date.now() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1_000);

  // Query connections where token is expiring soon or has no recorded expiry
  const whereClause: Prisma.FacebookPageConnectionWhereInput = {
    status: 'connected',
    OR: [
      { tokenExpiresAt: null },
      { tokenExpiresAt: { lte: expiryThreshold } },
    ],
  };
  if (filterOrgId) {
    whereClause.orgId = filterOrgId;
  }

  const connections = await prisma.facebookPageConnection.findMany({
    where: whereClause,
    select: {
      id: true,
      orgId: true,
      pageId: true,
      pageName: true,
      accessTokenEnc: true,
      tokenExpiresAt: true,
    },
    take: BATCH_SIZE,
    orderBy: { tokenExpiresAt: 'asc' }, // process most-urgent first
  });

  if (connections.length === 0) {
    logger.info('[fb-token-cron] No connections need refresh, skipping');
    return { checked: 0, refreshed: 0, errors: 0 };
  }

  logger.info(`[fb-token-cron] Checking ${connections.length} connection(s) for token validity`);

  let refreshed = 0;
  let errors = 0;

  for (const conn of connections) {
    try {
      const outcome = await refreshConnection(conn);
      if (outcome === 'alive') refreshed++;
    } catch (err) {
      errors++;
      logger.error(
        `[fb-token-cron] Failed to process connection ${conn.id} (page: ${conn.pageName}):`,
        err,
      );
    }

    if (STAGGER_MS > 0) {
      await new Promise((r) => setTimeout(r, STAGGER_MS));
    }
  }

  logger.info(
    `[fb-token-cron] Cycle: checked=${connections.length} refreshed=${refreshed} errors=${errors}`,
  );
  return { checked: connections.length, refreshed, errors };
}

interface ConnectionRow {
  id: string;
  orgId: string;
  pageId: string;
  pageName: string;
  accessTokenEnc: string;
  tokenExpiresAt: Date | null;
}

type RefreshOutcome = 'alive' | 'dead' | 'transient' | 'skipped';

async function refreshConnection(conn: ConnectionRow): Promise<RefreshOutcome> {
  if (!conn.accessTokenEnc) {
    logger.warn('[fb-token-cron] Connection %s has empty token, skipping', conn.id);
    return 'skipped';
  }

  let pageToken: string;
  try {
    pageToken = decrypt(conn.accessTokenEnc);
  } catch (err) {
    // Decryption failure = key rotation or corruption — treat as token dead
    const errMsg = `Decrypt failed: ${(err as Error).message}`;
    logger.error('[fb-token-cron] Decrypt failed for connection %s: %s', conn.id, errMsg);
    await markConnectionError(conn, errMsg);
    return 'dead';
  }

  const result = await probePageToken(conn.pageId, pageToken);

  if (result.alive) {
    // Token is still alive — extend expiry
    const newExpiry = new Date(Date.now() + EXTEND_DAYS * 24 * 60 * 60 * 1_000);
    // Re-encrypt to persist the unchanged token (in case key was rotated)
    const newEnc = encrypt(pageToken);
    await prisma.facebookPageConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: newEnc,
        tokenExpiresAt: newExpiry,
        lastError: null,
      },
    });
    logger.info(
      '[fb-token-cron] Token OK for page %s (%s), extended to %s',
      conn.pageName,
      conn.pageId,
      newExpiry.toISOString(),
    );
    return 'alive';
  } else if (result.dead) {
    // Token is revoked / expired — mark error and notify
    const errMsg = result.error ?? 'Token invalid (4xx from Graph API)';
    await markConnectionError(conn, errMsg);
    return 'dead';
  } else {
    // 5xx or network error — don't change status, log only, retry next run
    logger.warn(
      '[fb-token-cron] Transient error for page %s (%s): %s — will retry next run',
      conn.pageName,
      conn.pageId,
      result.error,
    );
    return 'transient';
  }
}

interface ProbeResult {
  alive?: boolean;
  dead?: boolean;
  transient?: boolean;
  error?: string;
}

/**
 * Probe page token validity via GET /{pageId}?fields=access_token.
 * Returns:
 *   { alive: true } — token OK
 *   { dead: true }  — token invalid (4xx/190)
 *   { transient: true } — 5xx or network error, retry next run
 */
async function probePageToken(pageId: string, pageToken: string): Promise<ProbeResult> {
  const url = `${GRAPH_BASE()}/${pageId}?fields=access_token&access_token=${encodeURIComponent(pageToken)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      return { alive: true };
    }

    const status = res.status;
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore body parse error
    }

    // 4xx → token is dead (401, 403, or Graph error 190/200)
    if (status >= 400 && status < 500) {
      return { dead: true, error: `Graph ${status}: ${body.slice(0, 200)}` };
    }

    // 5xx or other → transient
    return { transient: true, error: `Graph ${status}: ${body.slice(0, 200)}` };
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).message;
    // AbortError = timeout → transient
    return { transient: true, error: `Network error: ${msg}` };
  }
}

async function markConnectionError(conn: ConnectionRow, errMsg: string): Promise<void> {
  await prisma.facebookPageConnection.update({
    where: { id: conn.id },
    data: {
      status: 'error',
      lastError: errMsg.slice(0, 500),
    },
  });

  // Write ActivityLog for admin visibility
  logActivity({
    orgId: conn.orgId,
    systemSource: 'fb_token_refresh_cron',
    action: 'page_token_expired',
    entityType: 'facebook_page_connection',
    entityId: conn.id,
    details: {
      pageId: conn.pageId,
      pageName: conn.pageName,
      error: errMsg.slice(0, 300),
    },
  });

  logger.error(
    '[fb-token-cron] Token DEAD for page %s (%s) org=%s: %s',
    conn.pageName,
    conn.pageId,
    conn.orgId,
    errMsg,
  );
}
