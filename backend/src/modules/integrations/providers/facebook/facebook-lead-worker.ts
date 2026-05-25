/**
 * facebook-lead-worker.ts — BullMQ worker for lead-ingestion queue.
 *
 * Job data: { leadgenId, formId, pageId, createdTime?, orgId? }
 * Concurrency: 5 (tuned for 1000 leads/day @ ~3s/job)
 * Attempts: 5, backoff exponential 2s (configured on producer in webhook-service)
 *
 * Pipeline:
 *   1. Resolve orgId from FacebookPageConnection
 *   2. Idempotency: insert FacebookLeadEvent (unique leadgenId) — P2002 → ack
 *   3. Load FacebookFormMapping — missing → error=UNMAPPED, ack
 *   4. Load + decrypt page token — revoked/error → error=PAGE_DISCONNECTED, ack
 *   5. Fetch lead from Graph API — 4xx → error=GRAPH_4XX_xxx, ack; 5xx → throw (retry)
 *   6. Update rawPayload with full Graph response
 *   7. Apply fieldMap → { name, phone, email, customFields }
 *   8. Normalize phone → { phoneE164, phoneLocal, valid }
 *   9. Dedup/create Contact
 *  10. Insert CustomerListEntry
 *  11. Assign sale (if Contact.assignedUserId IS NULL)
 *  12. Update FacebookLeadEvent processedAt + contactId + listEntryId
 */

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { getRedis } from '../../../../shared/redis-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { decrypt } from '../../../../shared/crypto/aes-gcm.js';
import { getLeadById } from './facebook-graph-client.js';
import { applyFieldMap } from './lead-field-mapper.js';
import { normalizeVnPhone } from '../../../../shared/phone/normalize-vn-phone.js';
import { assignSale } from './round-robin-assigner.js';
import { notifySaleAssigned } from './notification-dispatcher.js';
import { normalizePhone } from '../../../../shared/utils/phone.js';
import { enqueueFormDiscovery } from './facebook-form-discovery-worker.js';

// Max attempts to retry an UNMAPPED lead while waiting for discovery to map the form.
// Beyond this, give up + mark UNMAPPED_AFTER_RETRY (form likely deleted in FB).
const UNMAPPED_RETRY_LIMIT = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export interface LeadIngestionJobData {
  leadgenId: string;
  formId: string;
  pageId: string;
  createdTime?: number;
  orgId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse HTTP status code from Graph API error message.
 * Error message format: "[fb-graph] GET /xxx failed 190: ..."
 */
function parseGraphStatusCode(message: string): number | null {
  const m = message.match(/failed (\d{3})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Merge customFields into existing Contact.notes JSON.
 * Existing notes string preserved; fb_form_data key updated.
 */
function mergeContactNotes(
  existing: string | null,
  fbFormData: Record<string, string>,
  fbLeadMeta: Record<string, unknown>,
): string {
  let parsed: Record<string, unknown> = {};
  if (existing) {
    try {
      const p = JSON.parse(existing);
      if (p && typeof p === 'object') parsed = p as Record<string, unknown>;
      else parsed = { legacy_notes: existing };
    } catch {
      parsed = { legacy_notes: existing };
    }
  }
  parsed.fb_form_data = fbFormData;
  parsed.fb_lead = fbLeadMeta;
  return JSON.stringify(parsed);
}

// ── Worker process function ───────────────────────────────────────────────────

export async function processLeadJob(job: Job<LeadIngestionJobData>): Promise<void> {
  const { leadgenId, formId, pageId } = job.data;
  let { orgId } = job.data;

  // ── Step 1: Resolve orgId ─────────────────────────────────────────────────
  if (!orgId) {
    const conn = await prisma.facebookPageConnection.findFirst({
      where: { pageId },
      select: { orgId: true },
    });
    if (!conn) {
      logger.warn('[fb-lead-worker] pageId=%s not connected to any org — acking', pageId);
      return;
    }
    orgId = conn.orgId;
  }

  // ── Step 2: Idempotency insert (upsert-style: tolerate retry) ──────────────
  // Lazy on-demand discovery may throw + retry this job. On retry, the event
  // row already exists from the first attempt — fetch its id instead of acking.
  // Only ack if `processedAt IS NOT NULL` (truly completed previously).
  let eventId: string;
  try {
    const event = await prisma.facebookLeadEvent.create({
      data: {
        orgId,
        leadgenId,
        formId,
        pageId,
        rawPayload: { leadgenId, formId, pageId },
      },
      select: { id: true },
    });
    eventId = event.id;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      const existing = await prisma.facebookLeadEvent.findUnique({
        where: { leadgenId },
        select: { id: true, processedAt: true },
      });
      if (!existing) throw err; // shouldn't happen but guard
      if (existing.processedAt) {
        logger.info('[fb-lead-worker] leadgenId=%s already processed — acking', leadgenId);
        return;
      }
      // Existing event row, not yet completed (retry path) — reuse its id
      eventId = existing.id;
      logger.info('[fb-lead-worker] retrying leadgenId=%s (attempt %d)', leadgenId, job.attemptsMade);
    } else {
      throw err;
    }
  }

  // ── Step 3: Form mapping lookup (lazy on-demand discovery on miss) ────────
  const mapping = await prisma.facebookFormMapping.findFirst({
    where: { orgId, formId, enabled: true },
  });
  if (!mapping) {
    // Try lazy discovery: enqueue form discovery for this page, then retry lead.
    // BullMQ exponential backoff (configured on producer: 2s, 4s, 8s...) gives
    // the discovery worker time to finish before we re-process.
    if (job.attemptsMade < UNMAPPED_RETRY_LIMIT) {
      const pageConn = await prisma.facebookPageConnection.findFirst({
        where: { orgId, pageId },
        select: { id: true, status: true },
      });
      if (pageConn && pageConn.status !== 'revoked') {
        logger.info(
          '[fb-lead-worker] UNMAPPED formId=%s — triggering lazy discovery for pageId=%s (attempt %d)',
          formId,
          pageId,
          job.attemptsMade + 1,
        );
        await enqueueFormDiscovery({
          orgId,
          pageConnectionId: pageConn.id,
          pageId,
        });
        await prisma.facebookLeadEvent.update({
          where: { id: eventId },
          data: { error: `UNMAPPED_DISCOVERING_${job.attemptsMade + 1}` },
        });
        // Throw → BullMQ retries with exponential backoff (gives discovery time)
        throw new Error(`UNMAPPED_RETRYING_FOR_DISCOVERY:${formId}`);
      }
    }
    // Exhausted retries (or page revoked) — give up
    const finalError = job.attemptsMade >= UNMAPPED_RETRY_LIMIT ? 'UNMAPPED_AFTER_RETRY' : 'UNMAPPED';
    logger.warn('[fb-lead-worker] no form mapping for formId=%s after %d attempts — giving up', formId, job.attemptsMade);
    await prisma.facebookLeadEvent.update({
      where: { id: eventId },
      data: { error: finalError },
    });
    return; // ack, no further retry
  }

  // ── Step 4: Page connection + decrypt token ───────────────────────────────
  const pageConn = await prisma.facebookPageConnection.findFirst({
    where: { orgId, pageId },
    select: { accessTokenEnc: true, status: true },
  });

  if (!pageConn || pageConn.status === 'revoked') {
    await prisma.facebookLeadEvent.update({
      where: { id: eventId },
      data: { error: 'PAGE_DISCONNECTED' },
    });
    return; // ack, no retry
  }

  let pageToken: string;
  try {
    pageToken = decrypt(pageConn.accessTokenEnc);
  } catch (err) {
    logger.error('[fb-lead-worker] token decrypt failed for pageId=%s: %s', pageId, (err as Error).message);
    await prisma.facebookLeadEvent.update({
      where: { id: eventId },
      data: { error: 'PAGE_DISCONNECTED' },
    });
    return; // ack, no retry
  }

  // ── Step 5: Graph API fetch ───────────────────────────────────────────────
  let graphLead: Awaited<ReturnType<typeof getLeadById>>;
  try {
    graphLead = await getLeadById(leadgenId, pageToken);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    const statusCode = parseGraphStatusCode(msg);

    if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
      // 4xx: permanent failure — no retry
      const errorCode = `GRAPH_4XX_${statusCode}`;
      logger.warn('[fb-lead-worker] Graph 4xx for leadgenId=%s: %s', leadgenId, errorCode);
      await prisma.facebookLeadEvent.update({
        where: { id: eventId },
        data: { error: errorCode },
      });
      return; // ack, no retry
    }

    // 5xx / network error → throw → BullMQ retry
    throw err;
  }

  // ── Step 6: Update event with full rawPayload ─────────────────────────────
  await prisma.facebookLeadEvent.update({
    where: { id: eventId },
    data: { rawPayload: graphLead as object },
  });

  // ── Step 7: Apply field map ───────────────────────────────────────────────
  const fieldMap = (mapping.fieldMap ?? {}) as Record<string, string>;
  const { name, phone, email, customFields } = applyFieldMap(
    graphLead.field_data ?? [],
    fieldMap,
  );

  // ── Step 8: Normalize phone ───────────────────────────────────────────────
  const normalized = normalizeVnPhone(phone);
  const { phoneE164, phoneLocal, valid: phoneValid, invalidReason } = normalized;

  // ── Step 9: Contact dedup / create ───────────────────────────────────────
  const fbLeadMeta = {
    leadgenId,
    formId,
    formName: mapping.formName,
    adId: graphLead.ad_id ?? null,
    campaignId: graphLead.campaign_id ?? null,
    platform: graphLead.platform ?? null,
    isOrganic: graphLead.is_organic ?? null,
    createdTime: graphLead.created_time,
  };

  let contactId: string;
  let isNewContact = false;

  if (phoneE164) {
    // phoneNormalized in DB is "84XXXXXXXXX" (no +) — match accordingly
    const phoneNormalized = phoneE164.replace(/^\+/, '');

    const existing = await prisma.contact.findFirst({
      where: { orgId, phoneNormalized },
      select: { id: true, assignedUserId: true, notes: true },
    });

    if (existing) {
      contactId = existing.id;
      // Merge fb_form_data into existing notes
      const mergedNotes = mergeContactNotes(existing.notes, customFields, fbLeadMeta);
      await prisma.contact.update({
        where: { id: contactId },
        data: { notes: mergedNotes },
      });
    } else {
      const notesJson = mergeContactNotes(null, customFields, fbLeadMeta);
      const phoneForContact = phoneE164; // store E164-style with +
      const phoneNorm = normalizePhone(phoneForContact); // "84XXXXXXXXX"
      const created = await prisma.contact.create({
        data: {
          orgId,
          fullName: name ?? null,
          email: email ?? null,
          phone: phoneForContact,
          phoneNormalized: phoneNorm,
          source: 'FB',
          sourceDate: new Date(),
          status: 'new',
          notes: notesJson,
          consentSource: 'form_landing',
        },
        select: { id: true },
      });
      contactId = created.id;
      isNewContact = true;
    }
  } else {
    // No valid phone — create phoneless Contact
    const notesJson = mergeContactNotes(null, customFields, fbLeadMeta);
    const created = await prisma.contact.create({
      data: {
        orgId,
        fullName: name ?? null,
        email: email ?? null,
        source: 'FB',
        sourceDate: new Date(),
        status: 'pending',
        notes: notesJson,
        consentSource: 'form_landing',
      },
      select: { id: true },
    });
    contactId = created.id;
    isNewContact = true;
  }

  // ── Step 10: CustomerListEntry insert ─────────────────────────────────────
  const aggregate = await prisma.customerListEntry.aggregate({
    where: { customerListId: mapping.customerListId },
    _max: { rowIndex: true },
  });
  const nextRowIndex = (aggregate._max.rowIndex ?? 0) + 1;

  const systemMessages = [
    {
      type: 'fb_lead',
      leadgenId,
      formId,
      formName: mapping.formName,
      createdAt: graphLead.created_time,
    },
  ];

  // Build fbCustomAnswers: field_data entries NOT resolved by fieldMap (custom Q&A)
  const mappedFieldNames = new Set(Object.keys(fieldMap));
  // Core identity fields that are always excluded from custom answers
  const coreFields = new Set(['phone_number', 'full_name', 'email', ...mappedFieldNames]);
  const fbCustomAnswers = (graphLead.field_data ?? [])
    .filter((f) => !coreFields.has(f.name))
    .map((f) => ({ question: f.name, answer: f.values[0] ?? '' }));

  const entry = await prisma.customerListEntry.create({
    data: {
      customerListId: mapping.customerListId,
      rowIndex: nextRowIndex,
      phoneRaw: phone ?? '',
      nameRaw: name ?? null,
      personalNote: customFields['Ghi chú'] ?? customFields['ghi_chu'] ?? null,
      phoneE164: phoneE164 ?? null,
      phoneLocal: phoneLocal ?? null,
      phoneValid,
      invalidReason: invalidReason ?? null,
      contactId,
      systemMessages: systemMessages as object[],
      status: phoneValid ? 'enriched' : 'invalid',
      // FB metadata columns
      fbLeadgenId: leadgenId,
      fbAdId: graphLead.ad_id ?? null,
      fbAdName: graphLead.ad_name ?? null,
      fbAdsetId: graphLead.adset_id ?? null,
      fbAdsetName: graphLead.adset_name ?? null,
      fbCampaignId: graphLead.campaign_id ?? null,
      fbCampaignName: graphLead.campaign_name ?? null,
      fbFormId: graphLead.form_id ?? null,
      fbFormName: graphLead.form_name ?? mapping.formName ?? null,
      fbInboxUrl: null, // not available via Graph API
      fbPlatform: graphLead.platform ?? null,
      fbIsOrganic: graphLead.is_organic ?? null,
      fbCustomAnswers: fbCustomAnswers.length > 0 ? (fbCustomAnswers as Prisma.InputJsonValue) : Prisma.DbNull,
    },
    select: { id: true },
  });

  // ── Step 11: Assign sale (only if Contact has no assignedUserId) ──────────
  // Re-fetch assignedUserId for both new and existing contacts
  const contactForAssign = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { assignedUserId: true },
  });

  if (!contactForAssign?.assignedUserId) {
    const assignedUserId = await assignSale(orgId, mapping.customerListId, contactId);
    if (assignedUserId) {
      await notifySaleAssigned(orgId, assignedUserId, contactId);
    }
  }

  // ── Step 12: Mark event processed ────────────────────────────────────────
  await prisma.facebookLeadEvent.update({
    where: { id: eventId },
    data: {
      processedAt: new Date(),
      contactId,
      listEntryId: entry.id,
      rawPayload: graphLead as object,
    },
  });

  logger.info(
    '[fb-lead-worker] leadgenId=%s → contactId=%s entryId=%s (new=%s)',
    leadgenId,
    contactId,
    entry.id,
    isNewContact,
  );
}

// ── Worker bootstrap ──────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;
let workerRedis: Redis | null = null;

export async function startFacebookLeadIngestionWorker(): Promise<void> {
  // Check if shared Redis is available (probe — if main client failed, skip worker too)
  const shared = await getRedis();
  if (!shared) {
    logger.warn('[fb-lead-worker] Redis unavailable — lead ingestion worker NOT started');
    return;
  }

  // BullMQ Worker REQUIRES a dedicated connection with maxRetriesPerRequest=null
  // (uses blocking commands like BLPOP). The shared client uses retries=3 for other code.
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('[fb-lead-worker] REDIS_URL not set — worker not started');
    return;
  }
  workerRedis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  workerInstance = new Worker<LeadIngestionJobData>(
    'lead-ingestion',
    async (job) => {
      try {
        await processLeadJob(job);
      } catch (err) {
        // BullMQ will handle retry; also update retryCount on event if eventId was created
        logger.error('[fb-lead-worker] job %s failed (attempt %d): %s', job.id, job.attemptsMade, (err as Error).message);
        throw err;
      }
    },
    {
      connection: workerRedis,
      concurrency: 5,
    },
  );

  workerInstance.on('completed', (job) => {
    logger.debug('[fb-lead-worker] job %s completed', job.id);
  });

  workerInstance.on('failed', (job, err) => {
    if (job) {
      logger.error('[fb-lead-worker] job %s permanently failed: %s', job.id, err.message);
      // Update FacebookLeadEvent.error after max attempts exhausted
      void updateEventError(job.data.leadgenId, err.message);
    }
  });

  logger.info('[fb-lead-worker] started (concurrency=5)');
}

export async function stopFacebookLeadIngestionWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
  if (workerRedis) {
    await workerRedis.quit();
    workerRedis = null;
  }
  logger.info('[fb-lead-worker] stopped');
}

async function updateEventError(leadgenId: string, reason: string): Promise<void> {
  try {
    await prisma.facebookLeadEvent.updateMany({
      where: { leadgenId, processedAt: null },
      data: { error: `FAILED: ${reason.slice(0, 200)}` },
    });
  } catch (err) {
    logger.error('[fb-lead-worker] updateEventError failed: %s', (err as Error).message);
  }
}
