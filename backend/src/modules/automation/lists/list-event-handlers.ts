/**
 * automation/lists/list-event-handlers.ts — Reverse-update từ 3 nguồn event.
 *
 * Khi 1 trong 3 nguồn dưới đây emit thông tin về phone↔UID resolve, handler này
 * tìm CustomerListEntry có phoneE164 match → update zaloUid/globalId/nickId/...
 *
 * 3 nguồn:
 *   1. Phase 7 action handler request-friend → SDK findUserByPhone(phone) resolved
 *   2. Nick friend sync (alias-sync / full-sync) → Friend.phoneNormalized newly set
 *   3. Contact create với phone (manual hoặc CSV import) — check Friend table
 *
 * Tất cả 3 đều idempotent: gọi N lần với cùng payload → cùng kết quả.
 *
 * v1: handler chỉ subscribe friendship_accepted + friend.upserted events qua
 * automationEventBus + thêm 1 listener manual cho contact phone changes.
 * Future: thêm message_received cho fast first-msg detection.
 */

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { automationEventBus } from '../engine/event-bus.js';
import { recomputeListCounters } from './list-entry-routes.js';

/**
 * Core reverse-update: phone resolves → UID khá đầy đủ thông tin.
 * Tìm tất cả CustomerListEntry phoneE164=phone, hasZalo=null hoặc !uid → update.
 */
export async function onPhoneUidResolved(payload: {
  orgId: string;
  phoneNormalized: string; // "84xxx" (no +)
  zaloUidInNick: string;
  zaloAccountId: string;
  zaloGlobalId?: string | null;
  zaloDisplayName?: string | null;
}): Promise<void> {
  const phoneE164 = '+' + payload.phoneNormalized;
  try {
    // Tìm entries match — gồm cả hasZalo=null (chưa scan) và hasZalo=true (đã có 1 nick, ghi nhận multi-nick)
    const entries = await prisma.customerListEntry.findMany({
      where: {
        phoneE164,
        customerList: { orgId: payload.orgId, archivedAt: null },
      },
      select: {
        id: true,
        customerListId: true,
        hasZalo: true,
        resolvedByNickId: true,
        multiNickCount: true,
      },
    });

    if (entries.length === 0) return;

    const affectedListIds = new Set<string>();
    for (const entry of entries) {
      // Trường hợp 1: entry chưa biết hasZalo (lần đầu match)
      if (entry.hasZalo !== true || !entry.resolvedByNickId) {
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: {
            hasZalo: true,
            zaloUid: payload.zaloUidInNick,
            zaloGlobalId: payload.zaloGlobalId,
            zaloName: payload.zaloDisplayName,
            resolvedByNickId: payload.zaloAccountId,
            multiNickCount: 0,
            status: 'enriched',
            enrichedAt: new Date(),
          },
        });
        affectedListIds.add(entry.customerListId);
      } else if (entry.resolvedByNickId !== payload.zaloAccountId) {
        // Trường hợp 2: entry đã có nick khác resolve → tăng multiNickCount
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: { multiNickCount: { increment: 1 } },
        });
        // KHÔNG override resolvedByNickId — giữ nick đầu tiên
      }
    }

    // Recompute counters cho parent lists bị ảnh hưởng
    for (const listId of affectedListIds) {
      await recomputeListCounters(listId);
    }

    if (affectedListIds.size > 0) {
      logger.info(
        { phoneE164, listsAffected: affectedListIds.size, entriesUpdated: entries.length },
        '[list-events] phone→UID resolved, lists updated',
      );
    }
  } catch (err) {
    logger.error({ err, phoneE164 }, '[list-events] onPhoneUidResolved failed');
  }
}

/**
 * Register listeners on automation event bus.
 * Call once at app boot.
 */
export function registerCustomerListEventHandlers(): void {
  // Source 1+2 unified: friendship_accepted + first_message_received đều imply Friend.phone đã match
  // Trigger lookup Friend record để get full info
  automationEventBus.onType(['friendship_accepted', 'first_message_received'], async (event) => {
    if (!event.contactId) return;
    try {
      // Lookup contact phoneNormalized
      const contact = await prisma.contact.findUnique({
        where: { id: event.contactId },
        select: { phoneNormalized: true, orgId: true },
      });
      if (!contact?.phoneNormalized) return;

      // Find Friend(s) for this contact — pick earliest nick
      const friend = await prisma.friend.findFirst({
        where: { orgId: contact.orgId, contactId: event.contactId },
        select: {
          zaloUidInNick: true,
          zaloAccountId: true,
          zaloGlobalId: true,
          zaloDisplayName: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!friend) return;

      await onPhoneUidResolved({
        orgId: contact.orgId,
        phoneNormalized: contact.phoneNormalized,
        zaloUidInNick: friend.zaloUidInNick,
        zaloAccountId: friend.zaloAccountId,
        zaloGlobalId: friend.zaloGlobalId,
        zaloDisplayName: friend.zaloDisplayName,
      });
    } catch (err) {
      logger.error({ err, contactId: event.contactId }, '[list-events] handler error');
    }
  });

  logger.info('[list-events] CustomerList event handlers registered');
}
