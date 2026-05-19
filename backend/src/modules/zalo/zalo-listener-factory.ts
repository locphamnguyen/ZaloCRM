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
      select: { id: true },
    });
    if (!conversation) return;

    // Tìm Message theo zaloMsgId
    const message = await prisma.message.findFirst({
      where: { conversationId: conversation.id, zaloMsgId: targetZaloMsgId },
      select: { id: true },
    });
    if (!message) return;

    const displayEmoji = ZALO_REACTION_DISPLAY[rawIcon] || rawIcon || '👍';
    const reactorName = String(data.dName || '');

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

    io?.emit('chat:reactions', {
      conversationId: conversation.id,
      messageId: message.id,
      msgId: message.id,
      reactions: [{
        userId: reactorZaloUid,
        userName: reactorName,
        reaction: displayEmoji,
        action: (!rawIcon || rType < 0) ? 'remove' : 'add',
        source: 'zalo',
      }],
    });
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

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener connected`);
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
      });

      if (result) {
        io?.emit('chat:message', {
          accountId,
          message: result.message,
          conversationId: result.conversationId,
        });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Message handler error:`, err);
    }
  });

  listener.on('undo', async (data: any) => {
    const msgId = data.data?.msgId || data.msgId;
    if (msgId) {
      await handleMessageUndo(accountId, String(msgId));
      io?.emit('chat:deleted', { accountId, msgId: String(msgId) });
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
      io?.emit('friend:event', { accountId, type: event.type, threadId: event.threadId });

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
            id: true, contactId: true, zaloAccountId: true, orgId: true,
            friendshipStatus: true, relationshipKind: true,
            becameFriendAt: true, removedAt: true,
          },
        });
        if (friend) {
          io?.to(`org:${friend.orgId}`).emit('friend:updated', {
            friendId: friend.id,
            contactId: friend.contactId,
            zaloAccountId: friend.zaloAccountId,
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
        });

        if (result) {
          io?.emit('chat:message', {
            accountId,
            message: result.message,
            conversationId: result.conversationId,
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
    io?.emit('zalo:disconnected', { accountId, code, reason });
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.start({ retryOnClose: true });
}
