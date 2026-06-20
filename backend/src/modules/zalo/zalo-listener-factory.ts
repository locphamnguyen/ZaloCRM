// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-listener-factory.ts — sets up zca-js listener events for one Zalo account.
 * Handles message routing, user-info caching, group detection, and undo events.
 * Extracted from ZaloAccountPool to keep zalo-pool.ts under 200 lines.
 */
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { handleIncomingMessage, handleMessageUndo } from '../chat/message-handler.js';
import { detectContentType, extractAlbumInfo, updateContactAvatar } from './zalo-message-helpers.js';
import { handleFriendEvent } from './friend-event-handler.js';
import { consumeIfExpected as consumeReactionEcho } from '../chat/reaction-echo-cache.js';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { notifyNewInboundMessage } from '../push/push-service.js';

// Map Zalo Reactions enum code → display emoji (cùng map với chat-operations-routes)
const ZALO_REACTION_DISPLAY: Record<string, string> = {
  '/-heart': '❤️',
  '/-strong': '👍',
  ':>': '😆',
  ':o': '😮',
  ':-((': '😭',
  ':-h': '😡',
  '/-rose': '🌹',
  '/-break': '💔',
  '/-weak': '👎',
};

async function handleZaloReaction(accountId: string, io: Server | null, reaction: any) {
  try {
    const data = reaction?.data;
    const threadId = reaction?.threadId;
    if (!data || !threadId) return;

    // Reactor info: uidFrom là Zalo UID của người thả; rIcon là emoji code, rType=0 thường nghĩa "add"
    const reactorZaloUid: string = String(data.uidFrom || '');
    const rawIcon: string = String(data.content?.rIcon || '');
    const rType: number = Number(data.content?.rType || 0);
    // Target message: gMsgID là Zalo msgId của tin bị react
    const targetZaloMsgId: string = String(data.content?.rMsg?.[0]?.gMsgID || data.msgId || '');
    if (!targetZaloMsgId || !reactorZaloUid) return;

    // Tìm conversation theo externalThreadId + accountId
    const conversation = await prisma.conversation.findFirst({
      where: { zaloAccountId: accountId, externalThreadId: threadId },
      select: {
        id: true, contactId: true, orgId: true, threadType: true,
        // PRIVACY 2026-06-11: cần privacyMode để strip danh tính KH khi nick main.
        zaloAccount: { select: { privacyMode: true, ownerUserId: true } },
      },
    });
    if (!conversation) return;

    // Tìm Message theo zaloMsgId
    const message = await prisma.message.findFirst({
      where: { conversationId: conversation.id, zaloMsgId: targetZaloMsgId },
      select: { id: true, senderType: true, zaloMsgId: true, seenAt: true, createdAt: true },
    });
    if (!message) return;

    const displayEmoji = ZALO_REACTION_DISPLAY[rawIcon] || rawIcon || '👍';
    // 2026-06-20 (anh báo popup cảm xúc nhóm chỉ hiện "Người dùng" + thiếu avatar): Zalo event
    // không kèm tên/avatar người thả (data.dName rỗng) → tra Friend của nick để có tên + AVATAR
    // thật rồi lưu + emit (tin LIVE hiện đúng tên + avatar, khỏi đợi reload).
    let reactorName = String(data.dName || '');
    let reactorAvatar: string | null = null;
    {
      const fr = await prisma.friend.findFirst({
        where: { zaloAccountId: accountId, zaloUidInNick: reactorZaloUid },
        select: { aliasInNick: true, zaloDisplayName: true, zaloAvatarUrl: true },
      });
      if (!reactorName) reactorName = fr?.aliasInNick || fr?.zaloDisplayName || '';
      reactorAvatar = fr?.zaloAvatarUrl || null;
    }

    // Phase A v3 (2026-05-21) — selective self-echo guard via reaction-echo-cache.
    // BAD fix cũ: skip tất cả reactorUid === ownNickUid → SAI vì cũng skip genuine
    // reaction từ Zalo App của anh (cùng UID).
    // GOOD fix: chỉ skip nếu (zaloMsgId, emoji, reactorUid) match expected echo
    // được mark trong POST /reactions handler (5s window). Genuine app reaction
    // KHÔNG có matching mark → proceed bình thường → sync vào CRM.
    if (consumeReactionEcho(targetZaloMsgId, displayEmoji, reactorZaloUid)) {
      return; // confirmed CRM self-echo, POST handler đã ghi DB + emit socket
    }

    // rIcon rỗng = remove, có icon = add (Zalo gửi cùng 1 event cho cả 2 — phân biệt qua rIcon empty)
    if (!rawIcon || rType < 0) {
      // Remove tất cả emoji của reactor này trên message (Zalo client chỉ giữ 1 emoji per user)
      await prisma.messageReaction.deleteMany({
        where: { messageId: message.id, reactorId: reactorZaloUid, reactorSource: 'zalo' },
      });
    } else {
      await prisma.messageReaction.upsert({
        where: {
          messageId_reactorId_emoji: {
            messageId: message.id,
            reactorId: reactorZaloUid,
            emoji: displayEmoji,
          },
        },
        update: { reactorName: reactorName || undefined },
        create: {
          id: randomUUID(),
          messageId: message.id,
          reactorId: reactorZaloUid,
          reactorSource: 'zalo',
          reactorName: reactorName || null,
          emoji: displayEmoji,
        },
      });
    }

    // ANTI-DRIFT FIX 2026-05-22: emit authoritative totalCount từ DB sau upsert/delete.
    // Trước fix: Zalo gửi 10 reaction events liên tiếp → 10 socket emits với action='add'
    // → FE increment +1 mỗi event → count=10 realtime. Refresh page → REST trả 1 (DB chỉ
    // 1 row do composite key msg×reactor×emoji) → UI "rollback" về 1 → drift confused user.
    // Fix: query messageReaction.count({where: msg×emoji}) → emit totalCount. FE set thay
    // vì increment → realtime count = persisted count luôn.
    const newCount = await prisma.messageReaction.count({
      where: { messageId: message.id, emoji: displayEmoji },
    });

    // PRIVACY 2026-06-11: scope org (chặn cross-tenant) + với nick main thì KHÔNG
    // lộ danh tính người thả (userId=UID KH, userName=tên KH) ra room org — chỉ giữ
    // totalCount (metadata). Chính chủ vẫn thấy đủ qua REST đã gate.
    const reactIsMain = conversation.zaloAccount?.privacyMode === 'main';
    io?.to(`org:${conversation.orgId}`).emit('chat:reactions', {
      conversationId: conversation.id,
      messageId: message.id,
      msgId: message.id,
      reactions: [{
        userId: reactIsMain ? null : reactorZaloUid,
        userName: reactIsMain ? null : reactorName,
        avatar: reactIsMain ? null : reactorAvatar,
        reaction: displayEmoji,
        action: (!rawIcon || rType < 0) ? 'remove' : 'add',
        source: 'zalo',
        totalCount: newCount, // authoritative count post-mutation
      }],
    });

    // Phase 8 — Engagement aggregate: count only KH-on-Sale reactions
    // (KH thả ❤️ vào tin sale gửi). Skip nếu sale thả vào tin KH (không phải signal).
    const isAddAction = !!rawIcon && rType >= 0;
    if (isAddAction && conversation.contactId && message.senderType === 'self') {
      void (async () => {
        try {
          const { incrementDailyAggregate } = await import('../engagement/engagement-service.js');
          await incrementDailyAggregate({
            contactId: conversation.contactId!,
            orgId: conversation.orgId,
            reaction: 1,
          });
        } catch {
          // silent — engagement best-effort
        }
      })();

      // ── I5 FIX 2026-06-03 — Nối reaction vào automation luồng bám đuổi ──
      // Trước fix: handleZaloReaction chỉ lưu emoji + engagement, KHÔNG gọi
      // onCustomerReaction (hàm mồ côi) → KH thả 😡 vào tin sequence vẫn bị gửi tin
      // tiếp (không pause 48h), không trừ điểm, không báo nội bộ. Anh chốt 2026-06-03:
      // tích cực báo dạng tích cực, tiêu cực báo dạng tiêu cực.
      //
      // handleZaloReaction KHÔNG có sẵn triggerId → tra Mục tiêu đang chạy của contact
      // qua FriendRequestOutbox (pattern friend-event-handler.ts:470). Nếu KH không
      // thuộc Mục tiêu nào → skip (reaction chat thường, không phải signal automation).
      void (async () => {
        try {
          const outbox = await prisma.friendRequestOutbox.findFirst({
            where: { contactId: conversation.contactId!, nickId: accountId, kind: 'FRIEND_REQUEST' },
            select: { triggerId: true },
            orderBy: { createdAt: 'desc' },
          });
          if (!outbox?.triggerId) return; // KH không thuộc Mục tiêu — bỏ qua signal
          const { onCustomerReaction } = await import('../../shared/ee-registry/automation.js');
          await onCustomerReaction({
            orgId: conversation.orgId,
            triggerId: outbox.triggerId,
            contactId: conversation.contactId!,
            nickId: accountId,
            emoji: displayEmoji,
            messageId: message.id,
          });
        } catch (err) {
          logger.warn(`[zalo:${accountId}] onCustomerReaction hook failed:`, err);
        }
      })();
    }

    // Phase v3 2026-05-29 (anh chốt sau workflow audit): KH thả tim self message → đã đọc.
    // SWEEP-TO-MSGID: KH react msg N → KH đã đọc CẢ msg ≤ N (Zalo native behavior).
    // Guard seenAt:null + createdAt ≤ message.createdAt chống ghi đè timestamp cũ + chỉ
    // sweep msg trước đó trong cùng conv.
    if (isAddAction
        && message.senderType === 'self'
        && conversation.threadType === 'user'
        && !message.seenAt
    ) {
      const seenAt = new Date();
      const seenUpdate = await prisma.message.updateMany({
        where: {
          conversationId: conversation.id,
          senderType: 'self',
          seenAt: null,
          createdAt: { lte: message.createdAt },
        },
        data: { seenAt, deliveredAt: seenAt },
      });
      if (seenUpdate.count > 0) {
        const rows = await prisma.message.findMany({
          where: { conversationId: conversation.id, senderType: 'self', seenAt },
          select: { id: true, conversationId: true, zaloMsgId: true, deliveredAt: true, seenAt: true },
        });
        logger.info(`[zalo:${accountId}] 💚 REACTION→SEEN swept ${seenUpdate.count} msg(s) ≤ anchor=${message.id} (KH ${reactorZaloUid} react ${displayEmoji})`);
        for (const r of rows) {
          // PRIVACY 2026-06-11: scope org (metadata seen/delivered, không cross-tenant).
          io?.to(`org:${conversation.orgId}`).emit('zalo:message-status', {
            accountId,
            conversationId: r.conversationId,
            messageId: r.id,
            zaloMsgId: r.zaloMsgId,
            deliveredAt: r.deliveredAt,
            seenAt: r.seenAt,
          });
        }
      }
    }
  } catch (err) {
    logger.warn(`[zalo:${accountId}] reaction handler error:`, err);
  }
}

// Cached user info entry with 5-minute TTL
export interface UserInfoCacheEntry {
  zaloName: string;
  avatar: string;
  phone?: string;
  globalId: string;   // Zalo toàn cục, không đổi giữa các viewer account — khóa dedup chính
  username: string;   // Zalo handle (t_xxx) — cũng toàn cục, debug-friendly
  cachedAt: number;
}

const USER_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Fetch zaloName + avatar + globalId + username from API with a per-pool in-memory cache
async function resolveZaloName(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
): Promise<{ zaloName: string; avatar: string; globalId: string; username: string }> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.cachedAt < USER_INFO_CACHE_TTL_MS) {
    return { zaloName: cached.zaloName, avatar: cached.avatar, globalId: cached.globalId, username: cached.username };
  }

  try {
    const result = await api.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const profile = profiles[uid] || profiles[`${uid}_0`];
    if (profile) {
      const entry: UserInfoCacheEntry = {
        zaloName:
          profile.zaloName ||
          profile.zalo_name ||
          profile.displayName ||
          profile.display_name ||
          '',
        avatar: profile.avatar || '',
        phone: profile.phoneNumber || '',
        globalId: String(profile.globalId || ''),
        username: String(profile.username || ''),
        cachedAt: Date.now(),
      };
      cache.set(uid, entry);
      return { zaloName: entry.zaloName, avatar: entry.avatar, globalId: entry.globalId, username: entry.username };
    }
  } catch (err) {
    logger.warn(`[zalo] getUserInfo failed for ${uid}:`, err);
  }
  return { zaloName: '', avatar: '', globalId: '', username: '' };
}

interface ResolvedGroup {
  name: string;
  avatar: string;
  membersCount: number | null;
}

// Fetch group display name + avatar + member count from the zca-js API
async function resolveGroupInfo(api: any, groupId: string): Promise<ResolvedGroup> {
  try {
    const result = await api.getGroupInfo(groupId);
    const info = result?.gridInfoMap?.[groupId];
    const members = info?.memVerList || info?.memList || info?.members;
    return {
      name: info?.name || '',
      avatar: info?.avt || info?.fullAvt || info?.avatar || '',
      membersCount: Array.isArray(members) ? members.length : (info?.totalMember || null),
    };
  } catch (err) {
    logger.warn(`[zalo] getGroupInfo failed for ${groupId}:`, err);
    return { name: '', avatar: '', membersCount: null };
  }
}

/**
 * Extract Zalo mentions từ message.data (Anh chốt 2026-06-03).
 *
 * SDK trả mention metadata qua 2 kênh — em thử cả 2:
 *   #1 message.data.mentions — TGroupMessage trực tiếp (group only),
 *      shape sẵn [{uid, pos, len, type}]
 *   #2 message.data.propertyExt.ext — JSON stringified bởi server Zalo,
 *      shape {"mentions":[{uid, pos, len, type}]}. Đây là nơi server đóng
 *      gói thực sự (xem audit workflow). Có thể bị propertyExt là object
 *      sẵn (đã parse) hoặc string.
 *
 * Trả undefined nếu không có mentions (user 1-1, hoặc tin không tag ai).
 */
function extractZaloMentions(
  messageData: any,
): Array<{ uid: string; pos: number; len: number; type: 0 | 1 }> | undefined {
  // Kênh #1: direct array trên TGroupMessage
  const direct = messageData?.mentions;
  if (Array.isArray(direct) && direct.length > 0) {
    return direct.map((m: any) => ({
      uid: String(m.uid ?? ''),
      pos: Number(m.pos ?? 0),
      len: Number(m.len ?? 0),
      type: (m.type === 1 ? 1 : 0) as 0 | 1,
    })).filter((m) => m.uid && m.len > 0);
  }
  // Kênh #2: propertyExt.ext có thể là object hoặc stringified
  try {
    let ext = messageData?.propertyExt?.ext;
    if (typeof ext === 'string') ext = JSON.parse(ext);
    const ms = ext?.mentions;
    if (Array.isArray(ms) && ms.length > 0) {
      return ms.map((m: any) => ({
        uid: String(m.uid ?? ''),
        pos: Number(m.pos ?? 0),
        len: Number(m.len ?? 0),
        type: (m.type === 1 ? 1 : 0) as 0 | 1,
      })).filter((m) => m.uid && m.len > 0);
    }
  } catch {
    // ignore parse error
  }
  return undefined;
}

export interface ListenerContext {
  accountId: string;
  api: any;
  io: Server | null;
  userInfoCache: Map<string, UserInfoCacheEntry>;
  onDisconnected: (accountId: string) => void;
}

/**
 * Attach all zca-js listener events for the given account.
 * Calls listener.start() with retryOnClose at the end.
 */
export function attachZaloListener(ctx: ListenerContext): void {
  const { accountId, api, io, userInfoCache, onDisconnected } = ctx;
  const listener = api.listener;

  // PRIVACY 2026-06-11: orgId của nick (cache 1 lần) để scope MỌI socket event theo
  // room org → chặn rò cross-tenant. Account thuộc đúng 1 org nên cache an toàn.
  let cachedOrgId: string | null = null;
  async function resolveOrgId(): Promise<string | null> {
    if (cachedOrgId) return cachedOrgId;
    const acc = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { orgId: true },
    });
    cachedOrgId = acc?.orgId ?? null;
    return cachedOrgId;
  }
  /** Emit 1 event metadata theo room org (fallback bare nếu chưa resolve được orgId). */
  async function emitOrg(event: string, payload: any): Promise<void> {
    if (!io) return;
    const orgId = await resolveOrgId();
    if (orgId) io.to(`org:${orgId}`).emit(event, payload);
    else io.emit(event, payload); // fallback hiếm: chưa biết org → giữ hành vi cũ
  }

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener connected`);
  });

  // DEBUG 2026-05-22: catch-all log để verify ListenerEvents nào fire trong thực tế.
  // Wrap listener.emit để intercept TẤT CẢ event names. Bỏ sau khi xác minh xong.
  const _origEmit = (listener as any).emit?.bind(listener);
  if (_origEmit) {
    (listener as any).emit = function (eventName: string, ...args: any[]) {
      if (eventName !== 'message' && eventName !== 'old_messages' && eventName !== 'connected') {
        try {
          logger.info(`[zalo:${accountId}] 🎯 SDK emit '${eventName}' — args[0]=`, JSON.stringify(args[0])?.slice(0, 300));
        } catch { /* ignore log error */ }
      }
      return _origEmit(eventName, ...args);
    };
  }

  // ─── WAVE 1+2 (2026-05-21) — typing / seen / delivered / disconnected ───────
  // Trước đây SDK fire 4 events này mà code không subscribe → bỏ phí payload.
  // Mục đích: bubble status icon (sent/delivered/seen) + typing dots realtime.

  // KH đang gõ tin nhắn (chỉ user threads, không group). Auto-clear FE sau 5s
  // không có event mới. SDK fire mỗi ~2s khi KH còn gõ.
  listener.on('typing', async (typing: any) => {
    try {
      // DEBUG 2026-05-22: log raw payload để verify SDK fire event đúng shape.
      // Anh đã test 2026-05-22 không thấy typing dots — cần xác minh event arrival.
      logger.info(`[zalo:${accountId}] 🔵 TYPING event:`, JSON.stringify({
        threadId: typing?.threadId, type: typing?.type, data: typing?.data, isSelf: typing?.isSelf,
      }));
      await emitOrg('zalo:typing', {
        accountId,
        threadId: typing?.threadId || '',
        threadType: typing?.type === 1 ? 'group' : 'user',
        ts: typing?.data?.ts ? Number(typing.data.ts) : Date.now(),
      });
    } catch (err) {
      logger.warn(`[zalo:${accountId}] typing event error:`, err);
    }
  });

  // KH đã đọc tin → set seen_at + emit socket bubble update.
  // Payload: SeenMessage[] — mỗi item {msgId, idTo} cho user threads (verified zca-js 2.1.2).
  // KH đọc tới msg N → tất cả msg ≤ N của ta đều được đánh dấu seen (Zalo behavior).
  // v3 2026-05-29 (workflow audit anh chốt): SWEEP-TO-MSGID — Zalo CHỈ fire seen_messages
  // cho msg cuối cùng KH đọc tới (anchor). BE phải tự sweep các msg cũ hơn trong cùng conv.
  listener.on('seen_messages', async (messages: any[]) => {
    try {
      logger.info(`[zalo:${accountId}] 🟢 SEEN_MESSAGES event:`, JSON.stringify(
        (messages || []).slice(0, 3).map(m => ({ threadId: m?.threadId, type: m?.type, data: m?.data })),
      ));
      if (!messages?.length) return;
      const now = new Date();
      // Sweep per anchor msg — resolve conversation từ anchor → mark all self msg ≤ anchor.createdAt
      for (const m of messages) {
        const anchorMsgId = String(m?.data?.msgId || '');
        if (!anchorMsgId) continue;
        const anchor = await prisma.message.findFirst({
          where: { zaloMsgId: anchorMsgId, senderType: 'self' },
          select: { id: true, conversationId: true, createdAt: true },
        });
        if (!anchor) {
          logger.info(`[zalo:${accountId}] 🟢 SEEN anchor not found msgId=${anchorMsgId} threadId=${m?.threadId}`);
          continue;
        }
        const updated = await prisma.message.updateMany({
          where: {
            conversationId: anchor.conversationId,
            senderType: 'self',
            seenAt: null,
            createdAt: { lte: anchor.createdAt },
          },
          data: { seenAt: now, deliveredAt: now },
        });
        if (updated.count > 0) {
          // Lấy chính xác các msg vừa được sweep (filter seenAt=now để khớp atomic update)
          const rows = await prisma.message.findMany({
            where: {
              conversationId: anchor.conversationId,
              senderType: 'self',
              seenAt: now,
            },
            select: { id: true, conversationId: true, zaloMsgId: true, deliveredAt: true, seenAt: true },
          });
          logger.info(`[zalo:${accountId}] 🟢 SEEN swept ${updated.count} msg(s) ≤ anchor=${anchorMsgId} conv=${anchor.conversationId}`);
          for (const r of rows) {
            await emitOrg('zalo:message-status', {
              accountId,
              conversationId: r.conversationId,
              messageId: r.id,
              zaloMsgId: r.zaloMsgId,
              deliveredAt: r.deliveredAt,
              seenAt: r.seenAt,
            });
          }
        } else {
          logger.info(`[zalo:${accountId}] 🟢 SEEN anchor=${anchorMsgId} updated=0 (already seen or stale)`);
        }
      }
    } catch (err) {
      logger.warn(`[zalo:${accountId}] seen_messages error:`, err);
    }
  });

  // KH device nhận packet (chưa đọc). Set delivered_at nếu chưa seen.
  // 2026-05-29 v2 (anh báo case tin "123"): Zalo SDK đôi khi merge "delivered + seen"
  // thành 1 event delivered_messages{seen=1, seenUids=[KH]} thay vì fire seen_messages riêng.
  // → BE phải parse flag seen=1 trong delivered payload để set seenAt cho kịp.
  listener.on('delivered_messages', async (messages: any[]) => {
    try {
      // DEBUG 2026-05-22: log raw payload
      logger.info(`[zalo:${accountId}] 🟡 DELIVERED_MESSAGES event:`, JSON.stringify(
        (messages || []).slice(0, 3).map(m => ({ threadId: m?.threadId, type: m?.type, data: m?.data })),
      ));
      const deliveredIds: string[] = [];
      const seenIds: string[] = [];
      for (const m of messages || []) {
        const msgId = String(m?.data?.msgId || '');
        if (!msgId) continue;
        deliveredIds.push(msgId);
        // Detect Zalo merged 'delivered + seen' event: data.seen=1 hoặc seenUids non-empty.
        const hasSeenFlag = m?.data?.seen === 1
          || m?.data?.seen === true
          || (Array.isArray(m?.data?.seenUids) && m.data.seenUids.length > 0);
        if (hasSeenFlag) seenIds.push(msgId);
      }
      if (!deliveredIds.length) return;
      const now = new Date();
      // Nhánh 1: nếu payload có seen=1 → set seenAt + deliveredAt + SWEEP các msg cũ.
      // v3 2026-05-29: workflow audit confirm field 'seen' + 'seenUids' có thật nhưng raw log
      // 4/4 sample đều seen=0/seenUids=[] → nhánh này hiếm khi trigger, nhưng vẫn xử lý đúng.
      if (seenIds.length > 0) {
        for (const anchorMsgId of seenIds) {
          const anchor = await prisma.message.findFirst({
            where: { zaloMsgId: anchorMsgId, senderType: 'self' },
            select: { id: true, conversationId: true, createdAt: true },
          });
          if (!anchor) continue;
          const updatedSeen = await prisma.message.updateMany({
            where: {
              conversationId: anchor.conversationId,
              senderType: 'self',
              seenAt: null,
              createdAt: { lte: anchor.createdAt },
            },
            data: { seenAt: now, deliveredAt: now },
          });
          if (updatedSeen.count > 0) {
            const rows = await prisma.message.findMany({
              where: { conversationId: anchor.conversationId, senderType: 'self', seenAt: now },
              select: { id: true, conversationId: true, zaloMsgId: true, deliveredAt: true, seenAt: true },
            });
            logger.info(`[zalo:${accountId}] 🟢 DELIVERED→SEEN merged swept ${updatedSeen.count} ≤ anchor=${anchorMsgId}`);
            for (const r of rows) {
              await emitOrg('zalo:message-status', {
                accountId, conversationId: r.conversationId, messageId: r.id,
                zaloMsgId: r.zaloMsgId, deliveredAt: r.deliveredAt, seenAt: r.seenAt,
              });
            }
          }
        }
      }
      // Nhánh 2: msgId chưa seen (hoặc seen=0) → chỉ set deliveredAt.
      const deliveryOnlyIds = deliveredIds.filter((id) => !seenIds.includes(id));
      if (deliveryOnlyIds.length > 0) {
        const updated = await prisma.message.updateMany({
          where: {
            zaloMsgId: { in: deliveryOnlyIds },
            senderType: 'self',
            deliveredAt: null,
            seenAt: null,
          },
          data: { deliveredAt: now },
        });
        if (updated.count > 0) {
          const rows = await prisma.message.findMany({
            where: { zaloMsgId: { in: deliveryOnlyIds }, senderType: 'self' },
            select: { id: true, conversationId: true, zaloMsgId: true, deliveredAt: true, seenAt: true },
          });
          logger.info(`[zalo:${accountId}] 🟡 DELIVERED → updated=${updated.count}, emit ${rows.length} row(s), io=${!!io}`);
          for (const r of rows) {
            await emitOrg('zalo:message-status', {
              accountId, conversationId: r.conversationId, messageId: r.id,
              zaloMsgId: r.zaloMsgId, deliveredAt: r.deliveredAt, seenAt: r.seenAt,
            });
          }
        } else if (seenIds.length === 0) {
          logger.info(`[zalo:${accountId}] 🟡 DELIVERED → updateMany count=0 (ids=${deliveryOnlyIds.join(',')})`);
        }
      }
    } catch (err) {
      logger.warn(`[zalo:${accountId}] delivered_messages error:`, err);
    }
  });

  // Sớm hơn `closed` ~vài giây. Hiện chỉ log; reconnect logic vẫn ở `closed`.
  // Nếu cần buffer outgoing messages giữa disconnected → reconnected, mở rộng ở đây.
  listener.on('disconnected', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener disconnected (early): ${code} ${reason}`);
    void emitOrg('zalo:disconnected', { accountId, code, reason, phase: 'early' });
  });

  listener.on('message', async (message: any) => {
    try {
      // ThreadType in zca-js: 0 = User, 1 = Group
      const isGroup = message.type === 1;
      const senderUid = String(message.data?.uidFrom || '');

      // Resolve display name — prefer zaloName from API over dName.
      // Self msg gửi cho người lạ: resolve theo threadId để biết tên người NHẬN
      // → recipientName được dùng trong upsertContact thay vì 'Unknown'.
      // Đồng thời resolve globalId + username (Zalo toàn cục) để dedup parent contact.
      let senderName: string = message.data?.dName || '';
      let recipientName: string = '';
      let contactGlobalId: string = '';
      let contactUsername: string = '';
      // Snapshot tên + avatar Zalo của KH nhìn từ nick này (lưu vào Friend.zaloDisplayName/AvatarUrl)
      let contactZaloDisplayName: string = '';
      let contactZaloAvatarUrl: string = '';
      if (senderUid && api.getUserInfo) {
        const resolveUid = message.isSelf ? (message.threadId || '') : senderUid;
        if (resolveUid) {
          const userInfo = await resolveZaloName(api, resolveUid, userInfoCache);
          contactGlobalId = userInfo.globalId;
          contactUsername = userInfo.username;
          contactZaloDisplayName = userInfo.zaloName;
          contactZaloAvatarUrl = userInfo.avatar;
          if (message.isSelf) {
            if (userInfo.zaloName) recipientName = userInfo.zaloName;
            if (userInfo.avatar && message.threadId) updateContactAvatar(message.threadId, userInfo.avatar);
          } else {
            if (userInfo.zaloName) senderName = userInfo.zaloName;
            if (userInfo.avatar) updateContactAvatar(senderUid, userInfo.avatar);
          }
        }
      }

      // Resolve group info for group threads (name + avatar + members count)
      let groupName: string | undefined;
      let groupAvatarUrl: string | undefined;
      let groupMembersCount: number | undefined;
      if (isGroup && message.threadId) {
        const groupInfo = await resolveGroupInfo(api, message.threadId);
        groupName = groupInfo.name || undefined;
        groupAvatarUrl = groupInfo.avatar || undefined;
        groupMembersCount = groupInfo.membersCount ?? undefined;
      }

      const rawContent = message.data?.content;
      const content =
        typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
      const contentType = detectContentType(message.data?.msgType, rawContent);
      const album = extractAlbumInfo(contentType, rawContent);

      const result = await handleIncomingMessage({
        accountId,
        senderUid,
        senderName,
        content,
        contentType,
        msgId: String(message.data?.msgId || ''),
        // FIX 2026-05-21: capture cliMsgId — bắt buộc cho api.undo (zalo server check cả 2).
        // Tin cũ trước fix này có cliMsgId=null → undo trả 400.
        ...(message.data?.cliMsgId ? { cliMsgId: String(message.data.cliMsgId) } : {}) as any,
        timestamp: parseInt(message.data?.ts || String(Date.now())),
        isSelf: message.isSelf || false,
        threadId: message.threadId || '',
        threadType: isGroup ? 'group' : 'user',
        recipientName: recipientName || undefined,
        contactGlobalId: contactGlobalId || undefined,
        contactUsername: contactUsername || undefined,
        contactZaloDisplayName: contactZaloDisplayName || undefined,
        contactZaloAvatarUrl: contactZaloAvatarUrl || undefined,
        groupName,
        groupAvatarUrl,
        groupMembersCount,
        attachments: [],
        quote: message.data?.quote,
        albumKey: album.albumKey,
        albumIndex: album.albumIndex,
        albumTotal: album.albumTotal,
        // Anh chốt 2026-06-03 — capture mentions từ TGroupMessage qua 2 kênh:
        //   #1 message.data.mentions (TGroupMessage trực tiếp, group only)
        //   #2 message.data.propertyExt.ext JSON stringified (server Zalo
        //      đóng gói tại đây, fallback nếu kênh #1 rỗng)
        // SDK: type TMention = { uid, pos, len, type }
        // (zca-js/dist/models/Message.d.ts:65-70)
        mentions: extractZaloMentions(message.data),
      });

      if (result) {
        // PRIVACY 2026-06-11: redact server-side per-recipient + scope org (emit-chat).
        // Nick main → room org nhận bản mờ, chính chủ đã unlock nhận bản thật.
        const accInfo = await prisma.zaloAccount.findUnique({
          where: { id: accountId },
          select: { privacyMode: true, ownerUserId: true },
        });
        await emitChatMessage({
          io,
          orgId: result.orgId,
          accountId,
          conversationId: result.conversationId,
          message: result.message,
          privacyMode: accInfo?.privacyMode ?? 'sub',
          ownerUserId: accInfo?.ownerUserId ?? null,
        });

        // Push mobile (FCM/APNs) — CHỈ tin KHÁCH gửi đến (inbound). Tin tự gửi/self bỏ qua.
        // Fire-and-forget: push fail KHÔNG được ảnh hưởng nhận/lưu/emit tin.
        if (!message.isSelf) {
          void notifyNewInboundMessage({
            orgId: result.orgId,
            conversationId: result.conversationId,
            zaloAccountId: accountId,
            privacyMode: accInfo?.privacyMode ?? 'sub',
            ownerUserId: accInfo?.ownerUserId ?? null,
            message: result.message,
            senderName,
          }).catch((err) =>
            logger.error(`[zalo:${accountId}] push notify error:`, err),
          );
        }
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Message handler error:`, err);
    }
  });

  // FIX 2026-05-21: zca-js Undo object có shape { data: TUndo, threadId, isSelf, isGroup }.
  // TUndo.msgId là id của PACKET undo, KHÔNG phải tin bị thu hồi. Tin gốc nằm ở:
  //   data.data.content.globalMsgId (Snowflake server-side) → match Message.zaloMsgIdNum
  //   data.data.content.cliMsgId    (client counter)        → fallback nếu globalMsgId null
  // Trước đây code đọc data.data.msgId → 0 row update vì không match được zaloMsgId nào.
  listener.on('undo', async (data: any) => {
    const undoContent = data?.data?.content || {};
    const globalMsgId = undoContent.globalMsgId;
    const cliMsgIdNum = undoContent.cliMsgId;
    if (!globalMsgId && !cliMsgIdNum) {
      logger.warn(`[zalo:${accountId}] Undo event missing globalMsgId/cliMsgId`, undoContent);
      return;
    }
    const updatedIds = (await (handleMessageUndo as any)(accountId, {
      globalMsgIdNum: globalMsgId ? BigInt(globalMsgId) : null,
      cliMsgIdNum: cliMsgIdNum ? BigInt(cliMsgIdNum) : null,
    })) as string[] | undefined ?? [];
    // FIX B1 round-2: emit MULTIPLE messageId nếu match nhiều rows (event broadcast tới mọi nick).
    // FE composable matches by zaloMsgId/messageId → update isDeleted live ở cột 3.
    const zaloMsgIdStr = globalMsgId ? String(globalMsgId) : (cliMsgIdNum ? String(cliMsgIdNum) : null);
    for (const messageId of updatedIds) {
      await emitOrg('chat:deleted', {
        accountId,
        messageId,
        zaloMsgId: zaloMsgIdStr,
      });
    }
    // Fallback emit bằng zaloMsgId nếu không update được row nào (FE tự match ở cache).
    if (updatedIds.length === 0 && zaloMsgIdStr) {
      await emitOrg('chat:deleted', { accountId, zaloMsgId: zaloMsgIdStr });
    }
  });

  // Reactions thả từ Zalo client → sync vào DB + emit socket
  listener.on('reaction', async (reaction: any) => {
    await handleZaloReaction(accountId, io, reaction);
  });

  // Backfill reactions trên reconnect (đã thả khi CRM offline)
  listener.on('old_reactions', async (reactions: any[]) => {
    if (!Array.isArray(reactions)) return;
    logger.info(`[zalo:${accountId}] Backfill ${reactions.length} old reactions`);
    for (const r of reactions) {
      await handleZaloReaction(accountId, io, r);
    }
  });

  listener.on('friend_event', async (event: any) => {
    try {
      await handleFriendEvent(accountId, event);
      // Coarse event (giữ backward-compat — không ai mới subscribe nhưng cũ có thể vẫn dùng)
      // PRIVACY 2026-06-11: scope org (chặn cross-tenant).
      await emitOrg('friend:event', { accountId, type: event.type, threadId: event.threadId });

      // Granular patch event cho FE composable use-friend-socket.ts → live update
      // FriendsView + ContactsView child row mà không cần refetch.
      // Lookup Friend row vừa bị handleFriendEvent mutate để lấy patch payload.
      try {
        const threadId = String(event?.threadId || event?.data?.fromUid || event?.data?.toUid || '');
        if (!threadId) return;
        const friend = await prisma.friend.findUnique({
          where: {
            zaloAccountId_zaloUidInNick: { zaloAccountId: accountId, zaloUidInNick: threadId },
          },
          select: {
            id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true, orgId: true,
            friendshipStatus: true, relationshipKind: true,
            becameFriendAt: true, removedAt: true,
          },
        });
        if (friend) {
          io?.to(`org:${friend.orgId}`).emit('friend:updated', {
            friendId: friend.id,
            contactId: friend.contactId,
            zaloAccountId: friend.zaloAccountId,
            zaloUidInNick: friend.zaloUidInNick, // FE filter: phân biệt Friend rows cùng nick (per-account UID)
            patch: {
              friendshipStatus: friend.friendshipStatus,
              relationshipKind: friend.relationshipKind,
              becameFriendAt: friend.becameFriendAt,
              removedAt: friend.removedAt,
            },
          });
        }
      } catch (emitErr) {
        logger.warn(`[zalo:${accountId}] friend:updated emit failed:`, emitErr);
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] friend_event handler error:`, err);
    }
  });

  // Backfill messages delivered on reconnect (missed while disconnected)
  listener.on('old_messages', async (messages: any[], type: number) => {
    const threadType = type === 1 ? 'group' : 'user';
    logger.info(`[zalo:${accountId}] Received ${messages.length} old ${threadType} messages`);

    for (const message of messages) {
      try {
        const senderUid = String(message.data?.uidFrom || '');
        // For DM messages from requestOldMessages, the peer UID (thread id)
        // may not appear on the top-level `threadId` field. Derive it from
        // payload: for self → data.idTo (peer); for incoming → uidFrom (peer).
        const peerFallback = message.isSelf
          ? String(message.data?.idTo || '')
          : senderUid;
        const resolvedThreadId = String(message.threadId || peerFallback || '');
        let senderName = message.data?.dName || '';
        let recipientName = '';
        let contactGlobalId = '';
        let contactUsername = '';

        // Resolve display name — non-self: senderName; self user-thread: recipientName từ threadId.
        // Đồng thời capture globalId + username để dedup parent contact.
        if (api.getUserInfo) {
          if (!message.isSelf && senderUid) {
            const userInfo = await resolveZaloName(api, senderUid, userInfoCache);
            if (userInfo.zaloName) senderName = userInfo.zaloName;
            contactGlobalId = userInfo.globalId;
            contactUsername = userInfo.username;
          } else if (message.isSelf && threadType === 'user' && resolvedThreadId) {
            const userInfo = await resolveZaloName(api, resolvedThreadId, userInfoCache);
            if (userInfo.zaloName) recipientName = userInfo.zaloName;
            if (userInfo.avatar) updateContactAvatar(resolvedThreadId, userInfo.avatar);
            contactGlobalId = userInfo.globalId;
            contactUsername = userInfo.username;
          }
        }

        let groupName: string | undefined;
        let groupAvatarUrl: string | undefined;
        let groupMembersCount: number | undefined;
        if (threadType === 'group' && resolvedThreadId) {
          const groupInfo = await resolveGroupInfo(api, resolvedThreadId);
          groupName = groupInfo.name || undefined;
          groupAvatarUrl = groupInfo.avatar || undefined;
          groupMembersCount = groupInfo.membersCount ?? undefined;
        }

        const rawContent = message.data?.content;
        const content =
          typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
        const contentType = detectContentType(message.data?.msgType, rawContent);
        const album = extractAlbumInfo(contentType, rawContent);

        const result = await handleIncomingMessage({
          accountId,
          senderUid,
          senderName,
          content,
          contentType,
          msgId: String(message.data?.msgId || ''),
          timestamp: parseInt(message.data?.ts || String(Date.now())),
          isSelf: message.isSelf || false,
          threadId: resolvedThreadId,
          threadType,
          recipientName: recipientName || undefined,
          contactGlobalId: contactGlobalId || undefined,
          contactUsername: contactUsername || undefined,
          groupName,
          groupAvatarUrl,
          groupMembersCount,
          attachments: [],
          quote: message.data?.quote,
          albumKey: album.albumKey,
          albumIndex: album.albumIndex,
          albumTotal: album.albumTotal,
          isBackfill: true,
          // Anh chốt 2026-06-03 — mentions cho old_messages backfill
          mentions: extractZaloMentions(message.data),
        });

        if (result) {
          // PRIVACY 2026-06-11: backfill cũng qua emit-chat (redact + scope org).
          // Trước đây emit raw + THIẾU cả _privacyMeta → non-owner thấy thẳng nội dung.
          const accInfo = await prisma.zaloAccount.findUnique({
            where: { id: accountId },
            select: { privacyMode: true, ownerUserId: true },
          });
          await emitChatMessage({
            io,
            orgId: result.orgId,
            accountId,
            conversationId: result.conversationId,
            message: result.message,
            privacyMode: accInfo?.privacyMode ?? 'sub',
            ownerUserId: accInfo?.ownerUserId ?? null,
          });
        }
      } catch (err) {
        logger.warn(`[zalo:${accountId}] old_messages processing error:`, err);
      }
    }
  });

  // Group system events: member join/leave/kick, name change, etc.
  listener.on('group_event', (event: any) => {
    logger.info(`[zalo:${accountId}] Group event: type=${event?.type ?? 'unknown'}`, {
      groupId: event?.groupId,
      actorId: event?.actorId,
      members: event?.members,
    });
    // Future: store as system message in the group conversation
  });

  // Note: duplicate 'friend_event' listener đã xoá ở chỗ này (legacy stub).
  // Listener thực ở line ~307 — đã wire handleFriendEvent + emit 'friend:updated'.

  listener.on('closed', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener closed: ${code} ${reason}`);
    onDisconnected(accountId);
    void emitOrg('zalo:disconnected', { accountId, code, reason });
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.start({ retryOnClose: true });
}
