// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * friend-event-handler.ts — persists zca-js `friend_event` to the Friend table.
 *
 * Maps zca-js FriendEventType into our state machine:
 *   ADD             → friendshipStatus='accepted', relationshipKind='friend'
 *   REMOVE          → friendshipStatus='removed',  relationshipKind='ghost'
 *   REQUEST         → friendshipStatus='pending_received' (someone sent ME a request)
 *   REJECT_REQUEST  → friendshipStatus='rejected', relationshipKind='ghost'
 *   UNDO_REQUEST    → friendshipStatus='none' (request retracted, Friend row stays)
 *   BLOCK / BLOCK_CALL   → friendshipStatus='blocked'
 *   UNBLOCK / UNBLOCK_CALL → revert to prior state if known, else 'none'
 *   SEEN_FRIEND_REQUEST, PIN_*, UNKNOWN — ignored
 *
 * Updates Contact.{accepted,pending,chatting}NicksCount on every transition.
 */
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { zaloPool } from './zalo-pool.js';
import { resolveOrCreateContact } from '../contacts/resolve-contact.js';
import { logEvent } from '../../shared/ee-registry/automation.js';
import { isListeningState } from '../../shared/ee-registry/automation.js';

// zca-js FriendEventType numeric values (mirrored from models/FriendEvent.d.ts)
export const FriendEventType = {
  ADD: 0,
  REMOVE: 1,
  REQUEST: 2,
  UNDO_REQUEST: 3,
  REJECT_REQUEST: 4,
  SEEN_FRIEND_REQUEST: 5,
  BLOCK: 6,
  UNBLOCK: 7,
  BLOCK_CALL: 8,
  UNBLOCK_CALL: 9,
  PIN_UNPIN: 10,
  PIN_CREATE: 11,
  UNKNOWN: 12,
} as const;

type RelationshipKind = 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost' | 'none';

/**
 * Counter delta for a Contact when a Friend row's relationshipKind transitions.
 * Returns increments to apply to (acceptedNicksCount, pendingNicksCount, chattingNicksCount).
 */
export function counterDelta(from: RelationshipKind, to: RelationshipKind): {
  accepted: number;
  pending: number;
  chatting: number;
} {
  const sub = (k: RelationshipKind) => ({
    accepted: k === 'friend' ? 1 : 0,
    pending: k === 'pending_friend' ? 1 : 0,
    chatting: k === 'chatting_stranger' ? 1 : 0,
  });
  const a = sub(to);
  const b = sub(from);
  return {
    accepted: a.accepted - b.accepted,
    pending: a.pending - b.pending,
    chatting: a.chatting - b.chatting,
  };
}

/** Derive relationshipKind from friendshipStatus + hasConversation. */
export function deriveRelationshipKind(
  friendshipStatus: string,
  hasConversation: boolean,
): RelationshipKind {
  if (friendshipStatus === 'accepted') return 'friend';
  if (friendshipStatus === 'pending_sent' || friendshipStatus === 'pending_received') return 'pending_friend';
  if (friendshipStatus === 'rejected' || friendshipStatus === 'removed' || friendshipStatus === 'blocked') return 'ghost';
  if (hasConversation) return 'chatting_stranger';
  return 'none';
}

interface ContactRef {
  id: string;
  orgId: string;
}

/**
 * Resolve (or create) the Contact row matching a Zalo uid in a given nick.
 * Wave 1.5-B: delegates to central resolveOrCreateContact helper.
 * Helper handles Friend reverse-lookup, getUserInfo enrichment, globalId/username/phone match,
 * and race-safe ON CONFLICT stub creation.
 */
async function resolveContact(
  zaloAccountId: string,
  uid: string,
  orgId: string,
  fallbackName?: string | null,
): Promise<ContactRef | null> {
  if (!uid) return null;
  const result = await resolveOrCreateContact({
    orgId,
    zaloAccountId,
    zaloUidInNick: uid,
    fallbackFullName: fallbackName,
    enrichViaGetUserInfo: true,
  });
  return { id: result.id, orgId: result.orgId };
}

/**
 * Apply a state transition to the Friend row for (zaloAccountId, contactId, uid):
 *   - upsert Friend with the new friendshipStatus + computed relationshipKind
 *   - update Contact counters by delta
 *   - update FriendshipAttempt status if a row exists
 *
 * All in a single transaction to keep counters consistent.
 */
export async function applyFriendTransition(args: {
  orgId: string;
  zaloAccountId: string;
  contactId: string;
  zaloUidInNick: string;
  newFriendshipStatus: string;
  attemptStateOnAccept?: string; // 'accepted' | 'rejected' | 'cancelled' | 'expired'
  /** 'event' = real Zalo event (acceptFriendRequest…) → reliable becameFriendAt;
   *  'sync' = bulk sync from getAllFriends → KHÔNG set becameFriendAt
   *           (Zalo không trả ngày kết bạn thực, sync time = today gây "Đã KB hôm nay" sai). */
  source?: 'event' | 'sync';
}): Promise<void> {
  const { orgId, zaloAccountId, contactId, zaloUidInNick, newFriendshipStatus } = args;
  const source = args.source ?? 'event';

  await tenantTransaction(async (tx) => {
    const existing = await tx.friend.findUnique({
      where: { zaloAccountId_zaloUidInNick: { zaloAccountId, zaloUidInNick } },
      select: {
        relationshipKind: true,
        hasConversation: true,
        becameFriendAt: true,  // B1 — cần để biết đã set chưa, tránh reset
      },
    });

    const fromKind = (existing?.relationshipKind as RelationshipKind) ?? 'none';
    const hasConversation = existing?.hasConversation ?? false;
    const toKind = deriveRelationshipKind(newFriendshipStatus, hasConversation);

    const now = new Date();
    const data: any = {
      friendshipStatus: newFriendshipStatus,
      relationshipKind: toKind,
    };
    // B1 + Phase B fix — chỉ set becameFriendAt khi:
    //   1. source = 'event' (REAL Zalo acceptFriendRequest event) — reliable
    //   2. AND becameFriendAt còn NULL (chưa set bao giờ)
    //
    // BULK SYNC (source='sync') KHÔNG set vì Zalo getAllFriends KHÔNG trả ngày
    // KB thực — sync time = today → mọi KH cũ hiện "Đã KB hôm nay" sai. Để null
    // trong DB và FE hiển thị "✓ Đã kết bạn" không kèm date label.
    if (source === 'event' && newFriendshipStatus === 'accepted' && !existing?.becameFriendAt) {
      data.becameFriendAt = now;
    }
    // removedAt cũng phải tương tự — chỉ set khi transition NEW, không overwrite ngày ngắt cũ
    if ((newFriendshipStatus === 'removed' || newFriendshipStatus === 'blocked') && !existing?.relationshipKind) {
      data.removedAt = now;
    } else if (
      (newFriendshipStatus === 'removed' || newFriendshipStatus === 'blocked')
      && existing?.relationshipKind !== 'ghost'
    ) {
      // Transition non-ghost → ghost: set removedAt lần đầu
      data.removedAt = now;
    }

    await tx.friend.upsert({
      where: { zaloAccountId_zaloUidInNick: { zaloAccountId, zaloUidInNick } },
      create: {
        id: randomUUID(),
        orgId,
        contactId,
        zaloAccountId,
        zaloUidInNick,
        ...data,
      },
      update: data,
    });

    // Counter delta on Contact
    const delta = counterDelta(fromKind, toKind);
    if (delta.accepted !== 0 || delta.pending !== 0 || delta.chatting !== 0) {
      await tx.contact.update({
        where: { id: contactId },
        data: {
          acceptedNicksCount: { increment: delta.accepted },
          pendingNicksCount: { increment: delta.pending },
          chattingNicksCount: { increment: delta.chatting },
        },
      });
    }

    // First-accepted-wins: claim assignedUserId on Contact for the nick's owner
    if (newFriendshipStatus === 'accepted') {
      const nick = await tx.zaloAccount.findUnique({
        where: { id: zaloAccountId },
        select: { ownerUserId: true },
      });
      if (nick) {
        await tx.contact.updateMany({
          where: { id: contactId, assignedUserId: null },
          data: { assignedUserId: nick.ownerUserId },
        });
        // Phase Contact Scope Hybrid 2026-05-27 — upsert ContactAccess collaborator
        // (or primary nếu chưa có ContactAccess role=primary). 2 sale có nick riêng
        // cùng chăm 1 KH → mỗi sale tự thành collaborator qua kết bạn.
        if (nick.ownerUserId) {
          await tx.contactAccess.upsert({
            where: { contactId_userId: { contactId, userId: nick.ownerUserId } },
            update: {}, // giữ role hiện tại nếu đã có
            create: {
              orgId,
              contactId,
              userId: nick.ownerUserId,
              role: 'collaborator',
              source: 'auto_from_friend',
            },
          });
        }
      }
    }

    // Update audit row in FriendshipAttempt if present
    if (args.attemptStateOnAccept) {
      await tx.friendshipAttempt.updateMany({
        where: { zaloAccountId, contactId },
        data: { state: args.attemptStateOnAccept, decidedAt: now },
      });
    }
  });

  // Phase 7 — emit AutomationEvent so engine can fire triggers bound to this
  // event. Imported lazily to avoid circular dep (engine imports prisma helpers).
  if (newFriendshipStatus === 'accepted' || newFriendshipStatus === 'pending_received') {
    try {
      const { automationEventBus } = await import('../../shared/ee-registry/event-bus.js');
      automationEventBus.emit({
        type: newFriendshipStatus === 'accepted' ? 'friendship_accepted' : 'friendship_received',
        orgId,
        occurredAt: new Date(),
        contactId,
        payload: { zaloAccountId, zaloUidInNick },
      });
    } catch (err) {
      // Engine not loaded (e.g. in tests) — silent fail
    }
  }

  // Phase Internal Contact 2-method 2026-05-23 — nếu accept này là pending handshake
  // setup của sale → trigger gửi verify code. Lazy import + best-effort, silent fail.
  if (newFriendshipStatus === 'accepted') {
    try {
      const { onFriendAcceptedForInternalContact } = await import(
        '../system-notifications/internal-contact-handshake-hook.js'
      );
      await onFriendAcceptedForInternalContact({ orgId, zaloAccountId, zaloUidInNick });
    } catch (err: any) {
      // Hook không phải hot path — log debug, không block friend transition
      logger.debug(`[internal-contact-hook] skipped: ${err?.message || err}`);
    }
  }
}

/**
 * Mark Friend(pending_sent) right after a successful sendFriendRequest call.
 * Resolves the contact (creates stub if not found). Idempotent.
 *
 * Callers:
 *   - campaign-service.ts (random outreach flow)
 *   - friend-routes.ts POST /requests (manual UI)
 */
export async function markFriendRequestSent(
  accountId: string,
  uid: string,
  contactIdOverride?: string,
): Promise<void> {
  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true },
  });
  if (!account) return;

  let contact: ContactRef | null;
  if (contactIdOverride) {
    contact = { id: contactIdOverride, orgId: account.orgId };
  } else {
    contact = await resolveContact(accountId, uid, account.orgId);
  }
  if (!contact) return;

  await applyFriendTransition({
    orgId: contact.orgId,
    zaloAccountId: accountId,
    contactId: contact.id,
    zaloUidInNick: uid,
    newFriendshipStatus: 'pending_sent',
  });
}

/**
 * Top-level entry called from zalo-listener-factory on every `friend_event`.
 * Decides what to persist based on event type + isSelf.
 */
export async function handleFriendEvent(
  accountId: string,
  event: { type: number; data: any; threadId: string; isSelf: boolean },
): Promise<void> {
  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true },
  });
  if (!account) {
    logger.warn(`[friend-event] account not found: ${accountId}`);
    return;
  }
  const orgId = account.orgId;

  // Determine the friend's uid and (optionally) the request payload.
  // For ADD/REMOVE/BLOCK/UNBLOCK: data is a string (the uid). threadId also = uid.
  // For REQUEST/REJECT_REQUEST/UNDO_REQUEST: data is { fromUid, toUid, ... }.
  let friendUid: string | null = null;
  if (typeof event.data === 'string') {
    friendUid = event.data || event.threadId || null;
  } else if (event.data && typeof event.data === 'object') {
    friendUid = event.isSelf ? event.data.toUid : event.data.fromUid;
    if (!friendUid) friendUid = event.threadId;
  } else {
    friendUid = event.threadId || null;
  }
  if (!friendUid) {
    logger.debug(`[friend-event:${accountId}] type=${event.type}: missing uid, skipping`);
    return;
  }

  const contact = await resolveContact(accountId, friendUid, orgId);
  if (!contact) return;

  let newStatus: string | null = null;
  let attemptUpdate: string | undefined;

  switch (event.type) {
    case FriendEventType.ADD:
      newStatus = 'accepted';
      attemptUpdate = 'accepted';
      break;
    case FriendEventType.REMOVE:
      newStatus = 'removed';
      break;
    case FriendEventType.REQUEST:
      // KH gửi request đến mình. Don't auto-create accepted. Mark pending_received.
      if (!event.isSelf) newStatus = 'pending_received';
      break;
    case FriendEventType.REJECT_REQUEST:
      // KH từ chối request mình gửi
      newStatus = 'rejected';
      attemptUpdate = 'rejected';
      break;
    case FriendEventType.UNDO_REQUEST:
      // Either side withdrew the pending request. Reset to none.
      newStatus = 'none';
      attemptUpdate = 'cancelled';
      break;
    case FriendEventType.BLOCK:
    case FriendEventType.BLOCK_CALL:
      newStatus = 'blocked';
      break;
    case FriendEventType.UNBLOCK:
    case FriendEventType.UNBLOCK_CALL:
      newStatus = 'none';
      break;
    case FriendEventType.SEEN_FRIEND_REQUEST:
    case FriendEventType.PIN_CREATE:
    case FriendEventType.PIN_UNPIN:
    case FriendEventType.UNKNOWN:
    default:
      return; // ignore
  }

  if (!newStatus) return;

  try {
    await applyFriendTransition({
      orgId,
      zaloAccountId: accountId,
      contactId: contact.id,
      zaloUidInNick: friendUid,
      newFriendshipStatus: newStatus,
      attemptStateOnAccept: attemptUpdate,
    });
    logger.info(
      `[friend-event:${accountId}] type=${event.type} uid=${friendUid} → ${newStatus}`,
    );

    // Wave 3 Event Log — log accept/reject vào Mục tiêu timeline.
    // Tìm trigger gốc qua FriendRequestOutbox (contact, nick) → trigger_id.
    // Nếu KH không thuộc Mục tiêu nào (chat thường) → skip log.
    if (newStatus === 'accepted' || newStatus === 'rejected') {
      void (async () => {
        try {
          const outbox = await prisma.friendRequestOutbox.findFirst({
            where: {
              contactId: contact.id,
              nickId: accountId,
              kind: 'FRIEND_REQUEST',
            },
            select: { triggerId: true },
            orderBy: { createdAt: 'desc' },
          });
          if (!outbox?.triggerId) return; // KH không thuộc Mục tiêu

          const [contactRow, nickRow] = await Promise.all([
            prisma.contact.findUnique({
              where: { id: contact.id },
              select: { fullName: true, crmName: true, phone: true },
            }),
            prisma.zaloAccount.findUnique({
              where: { id: accountId },
              select: { displayName: true },
            }),
          ]);
          const contactDisplay =
            contactRow?.crmName?.trim() ||
            contactRow?.fullName?.trim() ||
            contactRow?.phone ||
            'KH';
          const nickDisplay = nickRow?.displayName?.trim() || accountId.slice(0, 8);

          // T5 (eng-review D12, regression R2): guard log Monitor theo trigger.state.
          // Trigger completed/cancelled → KHÔNG ghi event accept/reject vào Monitor cũ.
          const fTrigger = await prisma.automationTrigger.findUnique({
            where: { id: outbox.triggerId },
            select: { state: true, followUpFriendEnabled: true },
          });
          const fListening = isListeningState(fTrigger?.state);

          if (newStatus === 'accepted') {
            if (fListening) {
              void logEvent({
                orgId,
                triggerId: outbox.triggerId,
                contactId: contact.id,
                nickId: accountId,
                eventType: 'friend_accepted',
                eventPriority: 'info',
                summary: `${contactDisplay} đã đồng ý kết bạn với nick ${nickDisplay}`,
                metadata: { friendUid },
              });
            }

            // ── #1 2026-06-06 (Anh chốt): Công tắc 2 "Bám đuổi khi ĐÃ là bạn" ──
            // Trước đây onFriendAccepted là CODE CHẾT (0 caller) → KH duyệt KB không
            // tự kích bám đuổi, chỉ luồng stranger (drainer) lo. Giờ nối lại: khi KH
            // accept thật VÀ followUpFriendEnabled → gọi onFriendAccepted (tự enqueue
            // bám đuổi + Tin 2 Cảm ơn). enqueueSequenceStart dedup theo jobId
            // (triggerId-contactId-0) nên nếu luồng stranger đã enroll thì KHÔNG double.
            // followUpFriendEnabled đã load chung ở fTrigger (T5) — không query lại.
            try {
              if (fTrigger?.followUpFriendEnabled) {
                const { onFriendAccepted } = await import('../../shared/ee-registry/automation.js');
                await onFriendAccepted({
                  orgId,
                  triggerId: outbox.triggerId,
                  contactId: contact.id,
                  nickId: accountId,
                  acceptedAt: new Date(),
                });
              }
            } catch (err) {
              logger.warn(`[friend-event:${accountId}] onFriendAccepted hook failed contact=${contact.id}:`, err);
            }
          } else {
            if (fListening) {
              void logEvent({
                orgId,
                triggerId: outbox.triggerId,
                contactId: contact.id,
                nickId: accountId,
                eventType: 'friend_rejected',
                eventPriority: 'warning',
                summary: `${contactDisplay} từ chối kết bạn — vẫn tiếp tục chuỗi bám đuổi`,
                metadata: { friendUid },
              });
            }

            // I12 2026-06-04 — Tin 4: gửi tin khi KH từ chối KB (nếu bật).
            // Gửi qua hộp người lạ (KH chưa là bạn). Đọc cờ enableRejectedFollowUp + template.
            try {
              const trg = await prisma.automationTrigger.findUnique({
                where: { id: outbox.triggerId },
                select: { enableRejectedFollowUp: true, rejectedTemplate: true },
              });
              if (trg?.enableRejectedFollowUp && trg.rejectedTemplate?.trim() && friendUid) {
                const { sendStrangerFollowUp } = await import('../../shared/ee-registry/automation.js');
                await sendStrangerFollowUp({
                  orgId,
                  triggerId: outbox.triggerId,
                  contactId: contact.id,
                  nickId: accountId,
                  uid: friendUid,
                  template: trg.rejectedTemplate,
                  eventType: 'rejected_follow_up_sent',
                });
              }
            } catch (err) {
              logger.warn(`[friend-event:${accountId}] Tin4 rejected follow-up failed contact=${contact.id}:`, err);
            }
          }
        } catch (err) {
          logger.warn(
            `[friend-event:${accountId}] event-log lookup failed contact=${contact.id}:`,
            err,
          );
        }
      })();
    }

    // Wave 3 2026-05-30 — KH block nick → log customer_block + update
    // CustomerListEntry.queueStatus='customer_block'. Filter 1-1: tìm trigger gốc qua
    // FriendRequestOutbox (contact, nick); nếu không thuộc Mục tiêu thì skip.
    // Guard whereInclude tránh ghi đè terminal state (converted_lead, cancelled);
    // customer_reply có thể bị overwrite vì block là tín hiệu mạnh hơn (KH chặn hẳn).
    if (newStatus === 'blocked') {
      void (async () => {
        try {
          const outbox = await prisma.friendRequestOutbox.findFirst({
            where: {
              contactId: contact.id,
              nickId: accountId,
              kind: 'FRIEND_REQUEST',
            },
            select: { triggerId: true },
            orderBy: { createdAt: 'desc' },
          });
          if (!outbox?.triggerId) return; // KH không thuộc Mục tiêu

          const [contactRow, nickRow] = await Promise.all([
            prisma.contact.findUnique({
              where: { id: contact.id },
              select: { fullName: true, crmName: true, phone: true },
            }),
            prisma.zaloAccount.findUnique({
              where: { id: accountId },
              select: { displayName: true },
            }),
          ]);
          const contactDisplay =
            contactRow?.crmName?.trim() ||
            contactRow?.fullName?.trim() ||
            contactRow?.phone ||
            'KH';
          const nickDisplay = nickRow?.displayName?.trim() || accountId.slice(0, 8);

          // T5 (eng-review D12, regression R2): CHỈ ghi log Monitor khi trigger nguồn
          // ĐANG nghe (active/paused). Trigger completed/cancelled vẫn ghi rác vào
          // Monitor trigger cũ = bug nghe-mãi. Guard state trước logEvent.
          const blockTrigger = await prisma.automationTrigger.findUnique({
            where: { id: outbox.triggerId },
            select: { state: true },
          });
          const triggerListening = isListeningState(blockTrigger?.state);

          if (triggerListening) {
            void logEvent({
              orgId,
              triggerId: outbox.triggerId,
              contactId: contact.id,
              nickId: accountId,
              eventType: 'customer_block',
              eventPriority: 'urgent',
              summary: `🚫 ${contactDisplay} đã chặn nick ${nickDisplay} — Mục tiêu dừng cho nick này`,
              metadata: { friendUid },
            });
          }

          try {
            // #2 2026-06-06 — queueStatus ở bảng nối per-trigger.
            await prisma.triggerQueueEntry.updateMany({
              where: {
                triggerId: outbox.triggerId,
                contactId: contact.id,
                queueStatus: {
                  notIn: ['customer_block', 'converted_lead', 'cancelled'],
                },
              },
              data: { queueStatus: 'customer_block' },
            });
          } catch (updErr) {
            logger.warn(
              `[friend-event:${accountId}] customer_block entry update failed contact=${contact.id}:`,
              updErr,
            );
          }

          // I5 FIX 2026-06-03 — Dừng chuỗi bám đuổi khi KH chặn nick.
          // Bug cũ: dừng task qua automationTask stub (no-op) → chuỗi BullMQ KHÔNG bị
          // hủy → job step tiếp theo vẫn fire dù KH đã chặn. Đổi sang onCustomerBlock
          // (event-hooks.ts) — nó cancel pending sequence-step jobs trong BullMQ +
          // set pause flag vĩnh viễn. Block là tín hiệu chấm dứt mạnh nhất.
          try {
            const { onCustomerBlock } = await import('../../shared/ee-registry/automation.js');
            await onCustomerBlock({
              orgId,
              triggerId: outbox.triggerId,
              contactId: contact.id,
              nickId: accountId,
            });
          } catch (err) {
            logger.warn('[friend-event] onCustomerBlock (cancel BullMQ jobs) failed:', err);
          }

          // I5 2026-06-03 — Bắn thông báo nội bộ cho sale chủ nick (high priority).
          // Trước fix: customer_block có log event nhưng KHÔNG báo sale → sale không
          // biết KH đã chặn (tín hiệu mạnh nhất). Anh chốt 2026-06-03 thêm notify.
          try {
            const nickOwner = await prisma.zaloAccount.findUnique({
              where: { id: accountId },
              select: { ownerUserId: true },
            });
            // I13: tôn trọng cờ notifyChannels.block (tắt = không báo chặn).
            const { shouldNotifyOwner } = await import('../../shared/ee-registry/automation.js');
            if (nickOwner?.ownerUserId && (await shouldNotifyOwner(outbox.triggerId, 'block'))) {
              const { notifyCustomerBlock } = await import('../../shared/ee-registry/automation.js');
              const triggerRow = await prisma.automationTrigger.findUnique({
                where: { id: outbox.triggerId },
                select: { name: true },
              });
              await notifyCustomerBlock({
                orgId,
                targetUserId: nickOwner.ownerUserId,
                contactId: contact.id,
                contactName: contactRow?.fullName ?? contactRow?.crmName ?? '',
                contactPhone: contactRow?.phone ?? '',
                nickId: accountId,
                nickName: nickDisplay,
                triggerId: outbox.triggerId,
                triggerName: triggerRow?.name ?? '',
              });
            }
          } catch (err) {
            logger.warn('[friend-event] notifyCustomerBlock failed:', err);
          }
        } catch (err) {
          logger.warn(
            `[friend-event:${accountId}] customer_block event-log lookup failed contact=${contact.id}:`,
            err,
          );
        }
      })();
    }
  } catch (err) {
    logger.error(`[friend-event:${accountId}] apply error:`, err);
  }
}
