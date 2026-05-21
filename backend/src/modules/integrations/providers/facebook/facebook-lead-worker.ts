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

async function processLeadJob(job: Job<LeadIngestionJobData>): Promise<void> {
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

  // ── Step 2: Idempotency insert ────────────────────────────────────────────
  let eventId: string;
  try {
    const event = await prisma.facebookLeadEvent.create({
      data: {
        orgId,
        leadgenId,
        formId,
        pageId,
        rawPayload: { leadgenId, formId, pageId }, // partial — updated after Graph fetch
      },
      select: { id: true },
    });
    eventId = event.id;
  } catch (err: unknown) {
    // P2002 = unique constraint violation (leadgenId already exists)
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      logger.info('[fb-lead-worker] leadgenId=%s already processed — acking', leadgenId);
      return;
    }
    throw err;
  }

  // ── Step 3: Form mapping lookup ───────────────────────────────────────────
  const mapping = await prisma.facebookFormMapping.findFirst({
    where: { orgId, formId, enabled: true },
  });
  if (!mapping) {
    logger.warn('[fb-lead-worker] no form mapping for formId=%s orgId=%s', formId, orgId);
    await prisma.facebookLeadEvent.update({
      where: { id: eventId },
      data: { error: 'UNMAPPED' },
    });
    return; // ack, no retry
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

export async function startFacebookLeadIngestionWorker(): Promise<void> {
  const redis = await getRedis();
  if (!redis) {
    logger.warn('[fb-lead-worker] Redis unavailable — lead ingestion worker NOT started');
    return;
  }

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
      connection: redis,
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
    logger.info('[fb-lead-worker] stopped');
  }
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
