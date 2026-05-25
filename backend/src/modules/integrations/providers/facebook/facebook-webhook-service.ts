/**
 * facebook-webhook-service.ts — Meta webhook verification, HMAC validation,
 * lead event extraction and BullMQ enqueue.
 *
 * Security: HMAC verify MUST be called before any parsing (DoS/injection gate).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { getRedis } from '../../../../shared/redis-client.js';
import { logger } from '../../../../shared/utils/logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LeadgenEvent {
  leadgenId: string;
  formId: string;
  pageId: string;
  createdTime: number; // unix timestamp from FB
}

interface WebhookQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

// ── BullMQ queue (producer only — worker in Phase 04) ────────────────────────

let _queue: Queue | null = null;

async function getQueue(): Promise<Queue | null> {
  if (_queue) return _queue;
  const redis = await getRedis();
  if (!redis) {
    logger.warn('[fb-webhook] Redis unavailable — cannot enqueue lead events');
    return null;
  }
  _queue = new Queue('lead-ingestion', {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 86_400 },  // keep 24h for debugging
      removeOnFail: { age: 7 * 86_400 },  // keep 7d for manual replay
    },
  });
  return _queue;
}

// ── Webhook challenge (GET) ───────────────────────────────────────────────────

/**
 * Verify Meta's webhook subscription challenge.
 * Returns hub.challenge string on success, null on failure.
 */
export function verifyChallenge(query: WebhookQuery): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (!mode || !token || !challenge) return null;
  if (mode !== 'subscribe') return null;

  const expected = process.env.FB_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    logger.warn('[fb-webhook] FB_WEBHOOK_VERIFY_TOKEN not set');
    return null;
  }

  // Constant-time compare to prevent timing attacks
  try {
    const eBuf = Buffer.from(expected);
    const tBuf = Buffer.from(token);
    if (eBuf.length !== tBuf.length) return null;
    if (!timingSafeEqual(eBuf, tBuf)) return null;
  } catch {
    return null;
  }

  return challenge;
}

// ── HMAC signature verification (POST) ───────────────────────────────────────

/**
 * Verify X-Hub-Signature-256 header using FB_APP_SECRET.
 * Must receive raw body bytes — do NOT parse JSON first.
 */
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const secret = process.env.FB_APP_SECRET;
  if (!secret) {
    logger.warn('[fb-webhook] FB_APP_SECRET not set — rejecting all webhook POSTs');
    return false;
  }
  if (!signatureHeader) return false;

  // Header format: "sha256=<hex>"
  if (!signatureHeader.startsWith('sha256=')) return false;
  const receivedHex = signatureHeader.slice(7);

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    const expBuf = Buffer.from(expected, 'hex');
    const recBuf = Buffer.from(receivedHex, 'hex');
    if (expBuf.length !== recBuf.length) return false;
    return timingSafeEqual(expBuf, recBuf);
  } catch {
    return false;
  }
}

// ── Lead event extraction ─────────────────────────────────────────────────────

/**
 * Parse Meta webhook POST body into typed lead events.
 * Safe to call after verifySignature passes.
 * Silently skips malformed entries to avoid crashing the webhook on partial data.
 */
export function extractLeadgenEvents(body: unknown): LeadgenEvent[] {
  const events: LeadgenEvent[] = [];

  if (!body || typeof body !== 'object') return events;
  const b = body as Record<string, unknown>;
  const entries = Array.isArray(b['entry']) ? b['entry'] : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const changes = Array.isArray(e['changes']) ? e['changes'] : [];
    const pageId = typeof e['id'] === 'string' ? e['id'] : '';

    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const c = change as Record<string, unknown>;
      if (c['field'] !== 'leadgen') continue;

      const value = c['value'];
      if (!value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;

      const leadgenId = typeof v['leadgen_id'] === 'string' ? v['leadgen_id'] : '';
      const formId = typeof v['form_id'] === 'string' ? v['form_id'] : '';
      const createdTime = typeof v['created_time'] === 'number' ? v['created_time'] : 0;
      // page_id may come from change.value or from entry.id
      const eventPageId =
        typeof v['page_id'] === 'string' ? v['page_id'] : pageId;

      if (!leadgenId || !formId) continue; // skip malformed

      events.push({ leadgenId, formId, pageId: eventPageId, createdTime });
    }
  }

  return events;
}

// ── BullMQ enqueue ────────────────────────────────────────────────────────────

/**
 * Enqueue lead events into the 'lead-ingestion' BullMQ queue.
 * Uses jobId = leadgenId for deduplication (BullMQ skips duplicate jobIds).
 */
export async function enqueueAll(events: LeadgenEvent[]): Promise<void> {
  if (events.length === 0) return;
  const queue = await getQueue();
  if (!queue) {
    logger.error('[fb-webhook] Queue unavailable, dropping %d events', events.length);
    return;
  }

  await Promise.all(
    events.map((ev) =>
      queue.add('process-lead', ev, {
        jobId: ev.leadgenId, // BullMQ deduplication: same jobId = no-op
      }),
    ),
  );
  logger.info('[fb-webhook] Enqueued %d lead events', events.length);
}
