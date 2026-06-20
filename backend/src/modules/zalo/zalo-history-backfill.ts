// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-history-backfill.ts — initial history seeding for fresh accounts.
 *
 * On first connect (or via manual sync endpoint) fetches:
 *   - All friends → upsert contacts (no message history; zca-js has no 1-1 history API)
 *   - All groups → upsert contact-stub + conversation + recent message history
 *
 * Idempotent: re-running is safe — message-handler dedup guards prevent duplicates.
 * Fire-and-forget callable: errors are logged, not propagated.
 */
import { randomUUID } from 'node:crypto';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage } from '../chat/message-handler.js';
import { detectContentType, extractAlbumInfo } from './zalo-message-helpers.js';

const MAX_GROUPS = 50;
const MESSAGES_PER_GROUP = 50;
const DM_MAX_PAGES = 50;
const DM_PAGE_TIMEOUT_MS = 15_000;

/**
 * Multi-cursor strategy ported from openzca CLI `getRecentPageCursors`.
 * Tries oldest-by-ts / last-in-array / first-in-array — different cursors
 * sometimes unlock different next-page slices from Zalo.
 */
function pickNextCursors(messages: any[]): string[] {
  const cursors: string[] = [];
  const seen = new Set<string>();
  const add = (c: string) => {
    const v = c.trim();
    if (!v || seen.has(v)) return;
    seen.add(v); cursors.push(v);
  };
  const cursorOf = (m: any): string => String(m?.data?.msgId || m?.data?.actionId || m?.data?.cliMsgId || '');

  // Oldest by timestamp
  let oldest: any = null;
  for (const m of messages) {
    const ts = parseInt(m?.data?.ts || '0');
    if (!oldest || ts < parseInt(oldest?.data?.ts || '0')) oldest = m;
  }
  if (oldest) add(cursorOf(oldest));
  add(cursorOf(messages[messages.length - 1]));
  add(cursorOf(messages[0]));
  return cursors;
}

// ThreadType from zca-js: 0 = User (DM), 1 = Group
const THREAD_TYPE_USER = 0;

export interface BackfillResult {
  friendsSynced: number;
  groupsSynced: number;
  messagesBackfilled: number;
  dmPagesRequested: number;
  errors: number;
}

interface PumpStats { pagesRequested: number; messagesInserted: number; messagesReceived: number; }

/**
 * Drives Zalo's `requestOldMessages` pagination AND directly persists each
 * incoming batch via `handleIncomingMessage`. This bypasses the main listener's
 * `old_messages` handler so insertion is deterministic and counted.
 */
async function pumpOldMessages(api: any, threadType: number, accountId: string): Promise<PumpStats> {
  return new Promise((resolve) => {
    const stats: PumpStats = { pagesRequested: 0, messagesInserted: 0, messagesReceived: 0 };
    const requestedCursors = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try { api.listener.off?.('old_messages', onPage); } catch {}
      if (timer) clearTimeout(timer);
      resolve(stats);
    };

    const resetIdleTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(finish, DM_PAGE_TIMEOUT_MS);
    };

    const requestPage = (cursor: string | null): boolean => {
      const c = (cursor ?? '').trim();
      if (c && requestedCursors.has(c)) return false;
      if (c) requestedCursors.add(c);
      try {
        api.listener.requestOldMessages(threadType, c || null);
        stats.pagesRequested++;
        resetIdleTimer();
        return true;
      } catch (err) {
        logger.warn(`[backfill:${accountId}] requestOldMessages failed:`, err);
        return false;
      }
    };

    const onPage = async (messages: any[], type: number) => {
      if (finished) return;
      if (type !== threadType) return;
      if (!Array.isArray(messages) || messages.length === 0) { finish(); return; }

      const threadTypeLabel = threadType === THREAD_TYPE_USER ? 'user' : 'group';
      stats.messagesReceived += messages.length;
      logger.info(`[backfill:${accountId}] DM page received: ${messages.length} message(s) (received total=${stats.messagesReceived})`);

      // Persist each message directly. Use senderUid as fallback threadId for
      // self messages, since Zalo's payload puts the peer in idTo.
      for (const m of messages) {
        try {
          const isSelf = Boolean(m?.isSelf);
          const senderUid = String(m?.data?.uidFrom || '');
          const threadId = String(m?.threadId || (isSelf ? m?.data?.idTo : senderUid) || '');
          if (!threadId) continue;

          const rawContent = m?.data?.content;
          const content =
            typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
          const contentType = detectContentType(m?.data?.msgType, rawContent);
          const album = extractAlbumInfo(contentType, rawContent);

          const inserted = await handleIncomingMessage({
            accountId,
            senderUid,
            senderName: m?.data?.dName || '',
            content,
            contentType,
            msgId: String(m?.data?.msgId || m?.data?.cliMsgId || ''),
            timestamp: parseInt(m?.data?.ts || String(Date.now())),
            isSelf,
            threadId,
            threadType: threadTypeLabel as 'user' | 'group',
            attachments: [],
            quote: m?.data?.quote,
            albumKey: album.albumKey,
            albumIndex: album.albumIndex,
            albumTotal: album.albumTotal,
            isBackfill: true,
          });
          if (inserted) stats.messagesInserted++;
        } catch (err) {
          logger.warn(`[backfill:${accountId}] DM insert failed:`, err);
        }
      }

      if (stats.pagesRequested >= DM_MAX_PAGES) { finish(); return; }

      // Try multi-cursor candidates — different cursors may unlock different
      // page slices (oldest-by-ts / last / first).
      const candidates = pickNextCursors(messages);
      let requested = false;
      for (const c of candidates) {
        if (requestPage(c)) { requested = true; break; }
      }
      if (!requested) finish();
    };

    api.listener.on('old_messages', onPage);
    if (!requestPage(null)) finish();
  });
}

export async function backfillAccountHistory(api: any, accountId: string): Promise<BackfillResult> {
  const result: BackfillResult = {
    friendsSynced: 0,
    groupsSynced: 0,
    messagesBackfilled: 0,
    dmPagesRequested: 0,
    errors: 0,
  };

  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true },
  });
  if (!account) {
    logger.warn(`[backfill:${accountId}] Account not found`);
    return result;
  }

  // ── 1. Sync friends → contacts ─────────────────────────────────────────
  try {
    const friendsRaw = await api.getAllFriends();
    const friends = Array.isArray(friendsRaw) ? friendsRaw : Object.values(friendsRaw || {});
    for (const friend of friends as any[]) {
      const uid = String(friend?.userId || friend?.uid || '');
      if (!uid) continue;

      const zaloName = friend?.zaloName || friend?.zalo_name || friend?.displayName || friend?.display_name || '';
      const avatar = friend?.avatar || '';
      const phone = friend?.phoneNumber || '';
      const globalId = friend?.globalId || '';
      const username = friend?.username || '';

      try {
        // Wave 1.5-B (B7 fix): dùng central resolver thay vì Contact.zaloUid only dedup
        const { resolveOrCreateContact } = await import('../contacts/resolve-contact.js');
        await resolveOrCreateContact({
          orgId: account.orgId,
          zaloAccountId: accountId,
          zaloUidInNick: uid,
          zaloGlobalId: globalId || null,
          zaloUsername: username || null,
          phone: phone || null,
          fallbackFullName: zaloName || null,
          fallbackAvatarUrl: avatar || null,
          enrichViaGetUserInfo: false,
        });
        result.friendsSynced++;
      } catch (err) {
        result.errors++;
        logger.warn(`[backfill:${accountId}] Friend ${uid} upsert failed:`, err);
      }
    }
  } catch (err) {
    result.errors++;
    logger.warn(`[backfill:${accountId}] getAllFriends failed:`, err);
  }

  // ── 2. Sync groups → conversations + history ───────────────────────────
  let groups: any[] = [];
  try {
    const groupsRaw = await api.getAllGroups();
    // getAllGroups returns { gridVerMap: {...}, gridInfoMap: { groupId: { groupInfo... } } }
    const gridInfoMap = groupsRaw?.gridInfoMap || groupsRaw || {};
    groups = Object.values(gridInfoMap) as any[];
  } catch (err) {
    result.errors++;
    logger.warn(`[backfill:${accountId}] getAllGroups failed:`, err);
    return result;
  }

  const groupSubset = groups.slice(0, MAX_GROUPS);
  for (const group of groupSubset) {
    const groupId = String(group?.groupId || group?.id || '');
    if (!groupId) continue;

    try {
      const groupName = group?.name || group?.groupName || 'Nhóm';
      const groupAvatar = group?.avt || group?.avatar || null;
      const membersCount = group?.totalMember ?? group?.memberCount ?? null;

      const history = await api.getGroupChatHistory(groupId, MESSAGES_PER_GROUP);
      const messages = history?.groupMsgs || history?.data?.groupMsgs || [];

      for (const msg of messages as any[]) {
        try {
          const zaloMsgId = String(msg?.data?.msgId || msg?.data?.cliMsgId || '');
          if (!zaloMsgId) continue;

          const rawContent = msg?.data?.content;
          const content =
            typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
          const contentType = detectContentType(msg?.data?.msgType, rawContent);
          const album = extractAlbumInfo(contentType, rawContent);

          const inserted = await handleIncomingMessage({
            accountId,
            senderUid: String(msg?.data?.uidFrom || ''),
            senderName: msg?.data?.dName || '',
            content,
            contentType,
            msgId: zaloMsgId,
            timestamp: parseInt(msg?.data?.ts || String(Date.now())),
            isSelf: Boolean(msg?.isSelf),
            threadId: groupId,
            threadType: 'group',
            groupName,
            groupAvatarUrl: groupAvatar || undefined,
            groupMembersCount: typeof membersCount === 'number' ? membersCount : undefined,
            attachments: [],
            quote: msg?.data?.quote,
            albumKey: album.albumKey,
            albumIndex: album.albumIndex,
            albumTotal: album.albumTotal,
            isBackfill: true,
          });
          if (inserted) result.messagesBackfilled++;
        } catch (err) {
          result.errors++;
          logger.warn(`[backfill:${accountId}] Group ${groupId} message insert failed:`, err);
        }
      }
      result.groupsSynced++;
    } catch (err) {
      result.errors++;
      logger.warn(`[backfill:${accountId}] Group ${groupId} history fetch failed:`, err);
    }
  }

  // ── 3. DM history via requestOldMessages pagination ────────────────────
  // Zalo pushes batches via `old_messages` event; the listener handler in
  // zalo-listener-factory persists them. We only drive cursor pagination.
  let dmReceived = 0;
  try {
    if (api?.listener?.requestOldMessages) {
      const stats = await pumpOldMessages(api, THREAD_TYPE_USER, accountId);
      result.dmPagesRequested = stats.pagesRequested;
      dmReceived = stats.messagesReceived;
      // Count by raw received — main listener may win the insert race, but
      // the message still ends up in DB. messagesInserted alone undercounts.
      result.messagesBackfilled += stats.messagesReceived;
    } else {
      logger.warn(`[backfill:${accountId}] api.listener.requestOldMessages unavailable — skipping DM backfill`);
    }
  } catch (err) {
    result.errors++;
    logger.warn(`[backfill:${accountId}] DM pump failed:`, err);
  }

  // Sanity check: verify what actually landed in DB for this account
  const dbCounts = await tenantTransaction(async (tx) => {
    const conversations = await tx.conversation.count({ where: { zaloAccountId: accountId } });
    const messages = await tx.message.count({
      where: { conversation: { zaloAccountId: accountId } },
    });
    return [conversations, messages] as [number, number];
  }).catch(() => [0, 0] as [number, number]);

  logger.info(
    `[backfill:${accountId}] Done — friends=${result.friendsSynced} groups=${result.groupsSynced} ` +
    `dmReceived=${dmReceived} dmPages=${result.dmPagesRequested} errors=${result.errors} ` +
    `| DB now has ${dbCounts[0]} conversation(s), ${dbCounts[1]} message(s) for this account`,
  );
  return result;
}

/**
 * Backfill only if account has no conversations yet (first-time login).
 * Returns true if backfill was triggered.
 */
export async function backfillIfEmpty(api: any, accountId: string): Promise<boolean> {
  const existing = await prisma.conversation.count({ where: { zaloAccountId: accountId } });
  if (existing > 0) return false;

  logger.info(`[backfill:${accountId}] Empty conversation set detected — starting initial backfill`);
  await backfillAccountHistory(api, accountId);
  return true;
}
