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
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { zaloPool } from './zalo-pool.js';

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
 * Tries Friend.zaloUidInNick first, then Contact.zaloUid global, then creates a stub.
 */
async function resolveContact(
  zaloAccountId: string,
  uid: string,
  orgId: string,
  fallbackName?: string | null,
): Promise<ContactRef | null> {
  if (!uid) return null;

  const existingFriend = await prisma.friend.findFirst({
    where: { zaloAccountId, zaloUidInNick: uid },
    select: { contactId: true, contact: { select: { orgId: true } } },
  });
  if (existingFriend) return { id: existingFriend.contactId, orgId: existingFriend.contact.orgId };

  const byGlobalUid = await prisma.contact.findFirst({
    where: { orgId, zaloUid: uid },
    select: { id: true, orgId: true },
  });
  if (byGlobalUid) return byGlobalUid;

  // Cross-nick contact matching — UID này từ POV nick mới, có thể đã là Contact
  // dưới UID khác (per-account UID rule). Hỏi Zalo getUserInfo để lấy globalId/
  // username/phone → match Contact đã có thay vì tạo stub mới. Tránh trường hợp
  // friend:updated event emit cho contactId stub mới mà UI conv bind contactId cũ.
  let resolvedGlobalId: string | null = null;
  let resolvedUsername: string | null = null;
  let resolvedPhone: string | null = null;
  let resolvedName: string | null = null;
  let resolvedAvatar: string | null = null;
  try {
    const instance = zaloPool.getInstance(zaloAccountId);
    if (instance?.api?.getUserInfo && instance.status === 'connected') {
      const result: any = await instance.api.getUserInfo(uid);
      const profiles = result?.changed_profiles || {};
      const profile = profiles[uid] || profiles[`${uid}_0`];
      if (profile) {
        resolvedGlobalId = String(profile.globalId || '').trim() || null;
        resolvedUsername = String(profile.username || '').trim() || null;
        resolvedPhone = String(profile.phoneNumber || '').trim() || null;
        resolvedName = (profile.zaloName || profile.zalo_name || profile.displayName || profile.display_name || '').trim() || null;
        resolvedAvatar = (profile.avatar || '').trim() || null;
      }
    }
  } catch (err) {
    logger.debug(`[friend-event] getUserInfo(${uid}) failed in resolveContact:`, err);
  }

  if (resolvedGlobalId || resolvedUsername) {
    const byIdentity = await prisma.contact.findFirst({
      where: {
        orgId,
        OR: [
          ...(resolvedGlobalId ? [{ zaloGlobalId: resolvedGlobalId }] : []),
          ...(resolvedUsername ? [{ zaloUsername: resolvedUsername }] : []),
        ],
      },
      select: { id: true, orgId: true },
    });
    if (byIdentity) {
      logger.info(`[friend-event] Cross-nick match: uid=${uid} → existing contact=${byIdentity.id} via globalId/username`);
      return byIdentity;
    }
  }

  if (resolvedPhone) {
    const { normalizePhone } = await import('../../shared/utils/phone.js');
    const phoneNormalized = normalizePhone(resolvedPhone);
    if (phoneNormalized) {
      const byPhone = await prisma.contact.findFirst({
        where: { orgId, phoneNormalized },
        select: { id: true, orgId: true },
      });
      if (byPhone) {
        logger.info(`[friend-event] Cross-nick match: uid=${uid} → existing contact=${byPhone.id} via phone`);
        return byPhone;
      }
    }
  }

  // Fresh — create stub Contact với data fetch được từ Zalo (avatar/name/globalId/etc)
  const created = await prisma.contact.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloUid: uid,
      fullName: resolvedName || fallbackName || 'Unknown',
      zaloGlobalId: resolvedGlobalId,
      zaloUsername: resolvedUsername,
      avatarUrl: resolvedAvatar,
      phone: resolvedPhone,
    },
    select: { id: true, orgId: true },
  });
  return created;
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

  await prisma.$transaction(async (tx) => {
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
      const { automationEventBus } = await import('../automation/engine/event-bus.js');
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
  } catch (err) {
    logger.error(`[friend-event:${accountId}] apply error:`, err);
  }
}
