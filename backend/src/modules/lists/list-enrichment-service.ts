// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { recomputeListCounters } from './list-entry-routes.js';
import { appendSystemMessage } from './list-system-messages.js';
import { withTenant, runSystemQuery } from '../../shared/tenant/tenant-context.js';
import { automationEventBus } from '../../shared/ee-registry/event-bus.js';

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

  // Tìm list orgId — Phase 1a 2026-06-08 — lookup ở chế độ system vì chưa biết
  // org của list trước khi tra; toàn bộ enrichment org-scoped chạy trong
  // withTenant(list.orgId) bên dưới.
  const list = await runSystemQuery(() =>
    prisma.customerList.findUnique({
      where: { id: listId },
      select: { orgId: true },
    }),
  );
  if (!list) return { processed: 0, enriched: 0 };

  return withTenant(list.orgId, async () => {
  // Process in chunks until no more pending
  while (true) {
    // 2026-05-20 v2 (advisory dup model): worker enrich tất cả entries valid +
    // 'validated' status (kể cả có dup_*_id fields). Dup giờ chỉ là system message,
    // không terminal nữa. Anti-double-touch sẽ enforce ở Campaign rule engine
    // (cross_nick_friendship_recency), không phải ở enrichment layer.
    //
    // Vẫn skip:
    //   - status='invalid' (parse fail, không có phone E164)
    //   - status='skipped' (sale loại)
    //   - status='enriched' (đã processed)
    //   - hasZalo!=null (đã có verdict)
    const pending = await prisma.customerListEntry.findMany({
      where: {
        customerListId: listId,
        phoneValid: true,
        hasZalo: null,
        status: 'validated',
      },
      select: { id: true, phoneE164: true, phoneLocal: true, nameRaw: true, contactId: true },
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
        // BUG-FIX 2026-06-07 (anh chốt): enrich PHẢI nối Contact ngay. Trước đây chỉ
        // set zalo_uid + status='enriched' mà KHÔNG tạo contact_id → 1362 entry mồ côi,
        // skip rules (đã-là-bạn/recency) dùng f.contact_id=NULL → lọc sai. Giờ resolve
        // Contact tại đây để entry luôn có contactId trước khi vào pool gửi.
        let contactId = entry.contactId;
        if (!contactId) {
          try {
            const { resolveOrCreateContact } = await import('../contacts/resolve-contact.js');
            const c = await resolveOrCreateContact({
              orgId: list.orgId,
              zaloAccountId: first.zaloAccountId,
              zaloUidInNick: first.zaloUidInNick,
              zaloGlobalId: first.zaloGlobalId,
              phone: entry.phoneE164,
              fallbackFullName: entry.nameRaw ?? first.zaloDisplayName,
            });
            contactId = c.id;
          } catch (err) {
            logger.warn(
              `[list-enrich] resolveOrCreateContact failed entry=${entry.id}: ${(err as Error).message}`,
            );
          }
        }
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
            ...(contactId ? { contactId } : {}),
          },
        });
        enriched++;
        // Lead-notify Nhịp 1 (EE seam) — entry vừa có contactId (chokepoint mọi nguồn) → emit
        // lên shared-bus; EE lead-notify-listener subscribe → tự giao sale + báo. Community = no-op.
        if (contactId) {
          automationEventBus.emit({
            type: 'customer_list_entry_created',
            orgId: list.orgId,
            occurredAt: new Date(),
            contactId,
            payload: { customerListId: listId, entryId: entry.id },
          });
        }
      } else {
        // Không match Friend table → mark `enriched` (đã check Friend xong) nhưng
        // GIỮ hasZalo=null vì chưa biết thực sự có Zalo hay không.
        // Chỉ Phase 7 Campaign action handler (request-friend qua SDK) mới
        // có thẩm quyền set hasZalo=false khi Zalo trả 404.
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: {
            hasZalo: null,
            status: 'enriched',
            enrichedAt: new Date(),
          },
        });
        // Emit message để sale biết worker đã check Friend xong (idempotent skip duplicates)
        await appendSystemMessage(entry.id, {
          type: 'ENRICHED_NO_MATCH',
          text: 'Đã check Friend — không match nick nào',
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
  });
}

/**
 * Background tick: scan all org's lists có status='processing' + pending entries.
 * Pick first list, enrich 1 chunk, return.
 */
async function backgroundTick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    // Phase 1a 2026-06-08 — quét list cross-org ở chế độ system; mỗi enrichListOnce
    // tự mở tenant scope theo orgId của list.
    const stale = await runSystemQuery(() =>
      prisma.customerList.findMany({
        where: { status: 'processing', pendingLookupEntries: { gt: 0 } },
        select: { id: true },
        take: 5, // process up to 5 lists in parallel per tick
        orderBy: { startedAt: 'asc' }, // FIFO
      }),
    );

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
