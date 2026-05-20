/**
 * automation/lists/list-enrichment-service.ts — Background Zalo UID lookup.
 *
 * Khi list được create, mọi entry valid bắt đầu ở status='validated' với
 * hasZalo=null. Worker này:
 *   1. Pick batch entry pending (phoneValid=true, hasZalo=null)
 *   2. Cho mỗi entry, check Friend table xem có nick nào đã friend phone này chưa
 *      → nếu có: copy UID + nickId + globalId + displayName về entry, hasZalo=true
 *      → nếu KHÔNG: hasZalo=false (chưa scan thực tế qua Zalo SDK)
 *   3. Recompute parent list counters
 *
 * v1: ENRICHMENT KHÔNG GỌI Zalo SDK trực tiếp — chỉ match với Friend table
 * có sẵn (data đã được nick sync trước đó). Lý do:
 *   - Zalo SDK findUser cost RTT + rate limit per nick
 *   - Quét 5000 SĐT × 5s/req = 7h chỉ với 1 nick
 *   - Sale chủ động trigger "Rescan via campaign" → action handler request-friend
 *     mới thực sự gọi SDK
 *
 * v2 sẽ thêm option "Force scan via SDK" cho admin.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { recomputeListCounters } from './list-entry-routes.js';

const CHUNK_SIZE = 200;
const TICK_INTERVAL_MS = 30 * 1000; // 30 seconds

let workerTimer: NodeJS.Timeout | null = null;
let inFlight = false;

/**
 * Kick off enrichment cho 1 list cụ thể — chạy 1 lần ngay, KHÔNG schedule.
 * Caller: list-routes after create.
 */
export async function kickoffEnrichment(listId: string): Promise<void> {
  try {
    await enrichListOnce(listId);
  } catch (err) {
    logger.error({ err, listId }, '[list-enrichment] kickoff failed');
  }
}

/**
 * Enrich 1 list — process all validated entries có hasZalo=null.
 * Idempotent: gọi nhiều lần OK.
 */
async function enrichListOnce(listId: string): Promise<{ processed: number; enriched: number }> {
  const start = Date.now();
  let processed = 0;
  let enriched = 0;

  // Tìm list orgId
  const list = await prisma.customerList.findUnique({
    where: { id: listId },
    select: { orgId: true },
  });
  if (!list) return { processed: 0, enriched: 0 };

  // Process in chunks until no more pending
  while (true) {
    const pending = await prisma.customerListEntry.findMany({
      where: {
        customerListId: listId,
        phoneValid: true,
        hasZalo: null,
      },
      select: { id: true, phoneE164: true, phoneLocal: true },
      take: CHUNK_SIZE,
    });

    if (pending.length === 0) break;

    // Resolve canonical (no +) for Contact.phoneNormalized match.
    // Friend KHÔNG có phoneNormalized direct — phải join qua Contact.
    const phoneNoPlus = pending
      .map((e) => e.phoneE164?.replace(/^\+/, ''))
      .filter((p): p is string => !!p);

    const contacts = phoneNoPlus.length
      ? await prisma.contact.findMany({
          where: {
            orgId: list.orgId,
            phoneNormalized: { in: phoneNoPlus },
          },
          select: {
            id: true,
            phoneNormalized: true,
            friends: {
              select: {
                zaloUidInNick: true,
                zaloGlobalId: true,
                zaloDisplayName: true,
                zaloAccountId: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' }, // earliest nick first
            },
          },
        })
      : [];

    // Map phoneNormalized → friends[] (sorted by earliest)
    const phoneToFriends = new Map<string, Array<{
      zaloUidInNick: string;
      zaloGlobalId: string | null;
      zaloDisplayName: string | null;
      zaloAccountId: string;
    }>>();
    for (const c of contacts) {
      if (!c.phoneNormalized || c.friends.length === 0) continue;
      phoneToFriends.set(
        c.phoneNormalized,
        c.friends.map((f) => ({
          zaloUidInNick: f.zaloUidInNick,
          zaloGlobalId: f.zaloGlobalId,
          zaloDisplayName: f.zaloDisplayName,
          zaloAccountId: f.zaloAccountId,
        })),
      );
    }

    // Update entries
    for (const entry of pending) {
      processed++;
      const noPlus = entry.phoneE164?.replace(/^\+/, '');
      const matches = noPlus ? phoneToFriends.get(noPlus) : null;

      if (matches && matches.length > 0) {
        const first = matches[0];
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: {
            hasZalo: true,
            zaloUid: first.zaloUidInNick,
            zaloGlobalId: first.zaloGlobalId,
            zaloName: first.zaloDisplayName,
            resolvedByNickId: first.zaloAccountId,
            multiNickCount: matches.length - 1,
            status: 'enriched',
            enrichedAt: new Date(),
          },
        });
        enriched++;
      } else {
        // No friend match → hasZalo=false (KH này chưa từng được nick nào trong org add friend)
        // Future: nếu sale chủ động scan via campaign, action handler sẽ override
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: {
            hasZalo: false,
            status: 'enriched',
            enrichedAt: new Date(),
          },
        });
      }
    }

    // Throttle giữa chunks
    if (pending.length === CHUNK_SIZE) {
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  // Recompute parent counters
  await recomputeListCounters(listId);

  logger.info(
    { listId, processed, enriched, ms: Date.now() - start },
    '[list-enrichment] list done',
  );
  return { processed, enriched };
}

/**
 * Background tick: scan all org's lists có status='processing' + pending entries.
 * Pick first list, enrich 1 chunk, return.
 */
async function backgroundTick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const stale = await prisma.customerList.findMany({
      where: { status: 'processing', pendingLookupEntries: { gt: 0 } },
      select: { id: true },
      take: 5, // process up to 5 lists in parallel per tick
      orderBy: { startedAt: 'asc' }, // FIFO
    });

    if (stale.length === 0) return;

    await Promise.allSettled(stale.map((l) => enrichListOnce(l.id)));
  } catch (err) {
    logger.error({ err }, '[list-enrichment] tick failed');
  } finally {
    inFlight = false;
  }
}

/**
 * Start scheduler. Idempotent. Call at app boot.
 */
export function startListEnrichmentWorker(): void {
  if (workerTimer) return;
  logger.info('[list-enrichment] worker starting (tick 30s)');
  workerTimer = setInterval(() => {
    void backgroundTick();
  }, TICK_INTERVAL_MS);
}

export function stopListEnrichmentWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    logger.info('[list-enrichment] worker stopped');
  }
}
