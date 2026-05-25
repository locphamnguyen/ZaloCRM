/**
 * facebook-form-discovery-worker.ts — BullMQ worker for form auto-discovery.
 *
 * Job data: { orgId, pageConnectionId, pageId }
 * Queue: fb-form-discovery
 *
 * Pipeline:
 *   1. Load FacebookPageConnection by ID, decrypt token
 *   2. Call Graph: getLeadgenForms(pageId, pageToken)
 *   3. For each form:
 *      a. Skip if FacebookFormMapping exists AND enabled=true (idempotent)
 *      b. If exists but disabled → re-enable
 *      c. Normalize form name (NFKC + trim + lowercase)
 *      d. Match existing CustomerList by LOWER(BTRIM(name))
 *      e. If no match → create new CustomerList (sourceType='api', iconEmoji='📘')
 *      f. Create FacebookFormMapping
 *   4. Mark forms no longer returned by Graph as enabled=false
 */

import { Worker, Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { getRedis } from '../../../../shared/redis-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { decrypt } from '../../../../shared/crypto/aes-gcm.js';
import { getLeadgenForms } from './facebook-graph-client.js';
import { randomUUID } from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────────────────

export const FORM_DISCOVERY_QUEUE = 'fb-form-discovery';

/**
 * Default heuristic field map for FB lead forms → Contact fields.
 * Keys are normalized Vietnamese/English field names from FB form.
 */
export const DEFAULT_FIELD_MAP: Record<string, string> = {
  tên_đầy_đủ: 'name',
  họ_và_tên: 'name',
  họ_tên: 'name',
  full_name: 'name',
  name: 'name',
  số_điện_thoại: 'phone',
  phone_number: 'phone',
  phone: 'phone',
  email: 'email',
  email_address: 'email',
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface FormDiscoveryJobData {
  orgId: string;
  pageConnectionId: string;
  pageId: string;
}

interface DiscoverySummary {
  pageId: string;
  discovered: number;
  matched: number;
  created: number;
  disabled: number;
  skipped: number;
}

// ── Normalize ────────────────────────────────────────────────────────────────

export function normalizeName(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase();
}

// ── Core logic ───────────────────────────────────────────────────────────────

export async function processFormDiscoveryJob(
  job: Job<FormDiscoveryJobData>,
): Promise<DiscoverySummary> {
  const { orgId, pageConnectionId, pageId } = job.data;

  const summary: DiscoverySummary = {
    pageId,
    discovered: 0,
    matched: 0,
    created: 0,
    disabled: 0,
    skipped: 0,
  };

  // ── Step 1: Load page connection + decrypt token ──────────────────────────
  const pageConn = await prisma.facebookPageConnection.findUnique({
    where: { id: pageConnectionId },
    select: { accessTokenEnc: true, status: true, orgId: true },
  });

  if (!pageConn || pageConn.orgId !== orgId) {
    logger.warn('[fb-discovery] pageConnectionId=%s not found for orgId=%s', pageConnectionId, orgId);
    return summary;
  }

  if (!pageConn.accessTokenEnc || pageConn.status !== 'connected') {
    logger.warn('[fb-discovery] page %s not connected (status=%s) — skipping', pageId, pageConn.status);
    return summary;
  }

  let pageToken: string;
  try {
    pageToken = decrypt(pageConn.accessTokenEnc);
  } catch (err) {
    logger.error('[fb-discovery] token decrypt failed for pageId=%s: %s', pageId, (err as Error).message);
    return summary;
  }

  // ── Step 2: Fetch forms from Graph ───────────────────────────────────────
  let forms: Awaited<ReturnType<typeof getLeadgenForms>>;
  try {
    forms = await getLeadgenForms(pageId, pageToken);
  } catch (err) {
    logger.error('[fb-discovery] getLeadgenForms failed for pageId=%s: %s', pageId, (err as Error).message);
    throw err; // re-throw for BullMQ retry
  }

  summary.discovered = forms.length;
  const discoveredFormIds = new Set(forms.map((f) => f.id));

  // ── Step 3: Process each form ─────────────────────────────────────────────
  for (const form of forms) {
    try {
      // Check if already mapped
      const existingMapping = await prisma.facebookFormMapping.findUnique({
        where: { orgId_formId: { orgId, formId: form.id } },
        select: { id: true, enabled: true, customerListId: true },
      });

      if (existingMapping) {
        if (existingMapping.enabled) {
          // Already mapped and active — skip
          summary.skipped++;
          continue;
        } else {
          // Re-enable disabled mapping
          await prisma.facebookFormMapping.update({
            where: { id: existingMapping.id },
            data: { enabled: true, formName: form.name },
          });
          summary.matched++;
          continue;
        }
      }

      // ── Find or create CustomerList ──────────────────────────────────────
      const normalizedName = normalizeName(form.name);

      // Raw query for BTRIM+LOWER match (Prisma mode:'insensitive' doesn't trim/NFKC)
      const matchResult = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM customer_lists
        WHERE org_id = ${orgId}
        AND archived_at IS NULL
        AND LOWER(BTRIM(name)) = ${normalizedName}
        LIMIT 1
      `;

      let customerListId: string;

      if (matchResult.length > 0) {
        customerListId = matchResult[0].id;
        summary.matched++;
      } else {
        // No match — find org owner to set createdById
        const orgOwner = await prisma.user.findFirst({
          where: { orgId, role: 'owner' },
          select: { id: true },
        });

        // Fallback: any active user in org
        const fallbackUser = orgOwner ?? await prisma.user.findFirst({
          where: { orgId, isActive: true },
          select: { id: true },
        });

        if (!fallbackUser) {
          logger.warn('[fb-discovery] no user found for orgId=%s — cannot create list for form %s', orgId, form.id);
          continue;
        }

        const newList = await prisma.customerList.create({
          data: {
            id: randomUUID(),
            orgId,
            createdById: fallbackUser.id,
            name: form.name,
            iconEmoji: '📘',
            sourceType: 'api',
            status: 'processing',
          },
          select: { id: true },
        });
        customerListId = newList.id;
        summary.created++;
      }

      // ── Create FacebookFormMapping ────────────────────────────────────────
      await prisma.facebookFormMapping.create({
        data: {
          orgId,
          pageConnectionId,
          formId: form.id,
          formName: form.name,
          customerListId,
          fieldMap: DEFAULT_FIELD_MAP as object,
          enabled: true,
        },
      });
    } catch (err) {
      logger.error(
        '[fb-discovery] error processing form %s for pageId=%s: %s',
        form.id,
        pageId,
        (err as Error).message,
      );
      // Continue with other forms — don't let one form failure abort the whole job
    }
  }

  // ── Step 4: Mark deleted/archived forms as disabled ───────────────────────
  const staleMappings = await prisma.facebookFormMapping.findMany({
    where: {
      orgId,
      pageConnectionId,
      enabled: true,
      formId: { notIn: [...discoveredFormIds] },
    },
    select: { id: true, formId: true, formName: true },
  });

  if (staleMappings.length > 0) {
    await prisma.facebookFormMapping.updateMany({
      where: { id: { in: staleMappings.map((m) => m.id) } },
      data: { enabled: false },
    });
    summary.disabled = staleMappings.length;
    logger.info(
      '[fb-discovery] disabled %d stale mappings for pageId=%s (forms removed from FB)',
      staleMappings.length,
      pageId,
    );
  }

  logger.info('[fb-discovery] summary: %o', summary);
  return summary;
}

// ── Worker bootstrap ──────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;
let workerRedis: Redis | null = null;

export async function startFormDiscoveryWorker(): Promise<void> {
  const shared = await getRedis();
  if (!shared) {
    logger.warn('[fb-discovery] Redis unavailable — form discovery worker NOT started');
    return;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('[fb-discovery] REDIS_URL not set — worker not started');
    return;
  }

  workerRedis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  workerInstance = new Worker<FormDiscoveryJobData>(
    FORM_DISCOVERY_QUEUE,
    async (job) => {
      try {
        return await processFormDiscoveryJob(job);
      } catch (err) {
        logger.error(
          '[fb-discovery] job %s failed (attempt %d): %s',
          job.id,
          job.attemptsMade,
          (err as Error).message,
        );
        throw err;
      }
    },
    {
      connection: workerRedis,
      concurrency: 3,
    },
  );

  workerInstance.on('completed', (job, result) => {
    logger.debug('[fb-discovery] job %s completed: %o', job.id, result);
  });

  workerInstance.on('failed', (job, err) => {
    if (job) {
      logger.error('[fb-discovery] job %s permanently failed: %s', job.id, err.message);
    }
  });

  logger.info('[fb-discovery] worker started (concurrency=3)');
}

export async function stopFormDiscoveryWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
  if (workerRedis) {
    await workerRedis.quit();
    workerRedis = null;
  }
  logger.info('[fb-discovery] worker stopped');
}

// ── Queue producer (shared) ───────────────────────────────────────────────────

let producerQueue: Queue | null = null;

export async function getFormDiscoveryQueue(): Promise<Queue | null> {
  if (producerQueue) return producerQueue;

  const redis = await getRedis();
  if (!redis) return null;

  producerQueue = new Queue(FORM_DISCOVERY_QUEUE, { connection: redis });
  return producerQueue;
}

export async function enqueueFormDiscovery(data: FormDiscoveryJobData): Promise<string | undefined> {
  const queue = await getFormDiscoveryQueue();
  if (!queue) {
    logger.warn('[fb-discovery] Redis not available — cannot enqueue discovery for pageId=%s', data.pageId);
    return undefined;
  }
  const job = await queue.add('discover', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
  logger.info('[fb-discovery] enqueued job %s for pageId=%s orgId=%s', job.id, data.pageId, data.orgId);
  return job.id ?? undefined;
}
