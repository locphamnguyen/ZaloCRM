// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * alias-sync.ts — Pull "Tên gợi nhớ" (alias) từ Zalo Real → CRM Friend.aliasInNick.
 *
 * SDK exposes:
 *  - api.getAliasList(count, page) → { items: [{userId, alias}], updateTime }
 *  - api.changeFriendAlias(alias, userId) → set/update
 *  - api.removeFriendAlias(userId) → clear
 *
 * No realtime listener event (FriendEvent enum không có ALIAS_CHANGE).
 * Phải pull periodic. Gọi từ `syncLabelsForAccount` full-sync path để leverage
 * cùng triggers (on connect, on touch, on manual sync) — không tạo cron riêng.
 *
 * Pagination: SDK cap 200 items/page. Account có thể có 900+ aliases → cần loop.
 * Hard cap 20 pages (= 4000 aliases) để chống bug infinite loop.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from './zalo-pool.js';
import { logActivity } from '../activity/activity-logger.js';

const PAGE_SIZE = 200;
const MAX_PAGES = 20;

/** Pull tất cả aliases từ Zalo SDK, return Map<uidInNick, alias>. */
export async function pullAliasMap(accountId: string): Promise<Map<string, string>> {
  const api = zaloPool.getApi(accountId);
  if (!api || typeof api.getAliasList !== 'function') {
    logger.warn(`[alias-sync] Account ${accountId} chưa kết nối hoặc SDK không hỗ trợ getAliasList`);
    return new Map();
  }
  const map = new Map<string, string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let items: Array<{ userId: string; alias: string }> = [];
    try {
      const res = await api.getAliasList(PAGE_SIZE, page);
      items = (res?.items || []) as Array<{ userId: string; alias: string }>;
    } catch (err) {
      logger.warn(`[alias-sync] getAliasList page=${page} failed:`, err);
      break;
    }
    for (const it of items) {
      if (it.userId && it.alias) map.set(String(it.userId), String(it.alias));
    }
    if (items.length < PAGE_SIZE) break;
  }
  return map;
}

/** Sync alias từ Zalo → CRM cho all friends của 1 account.
 *  Diff Friend.aliasInNick với alias hiện tại trên Zalo. Update + log activity nếu khác.
 *  Returns { updated } count. */
export async function syncAliasesForAccount(accountId: string, orgId: string): Promise<{ updated: number; pulled: number }> {
  const aliasMap = await pullAliasMap(accountId);
  if (aliasMap.size === 0) return { updated: 0, pulled: 0 };

  const friends = await prisma.friend.findMany({
    where: { zaloAccountId: accountId },
    select: { id: true, zaloUidInNick: true, contactId: true, aliasInNick: true },
  });
  let updated = 0;
  for (const f of friends) {
    const newAlias = aliasMap.get(f.zaloUidInNick) || null;
    // Diff: null vs '' coerce — coi rỗng/null là không có alias
    const oldAlias = f.aliasInNick || null;
    if (newAlias === oldAlias) continue;
    // FIX 2026-06-19 (Anh báo bug): CHỈ KÉO-VÀO alias từ Zalo, KHÔNG tự XOÁ. Zalo trả rỗng
    // cho 1 UID có thể do alias nằm trên UID/danh tính KHÁC của cùng KH, hoặc getAliasList
    // chưa kịp cập nhật → clear sẽ làm MẤT tên gợi nhớ ở màn chat (xung khắc với auto-alias).
    // Muốn xoá alias thì xoá tay trong panel chat (PATCH /friends/:id alias rỗng).
    if (!newAlias) continue;

    await prisma.friend.update({
      where: { id: f.id },
      data: { aliasInNick: newAlias },
    });
    updated++;

    // Log activity với actorType='system' (sync từ Zalo Real, không phải user thao tác CRM)
    if (f.contactId) {
      logActivity({
        orgId,
        systemSource: 'zalo_alias_sync',
        action: 'friend_alias_change',
        entityType: 'contact',
        entityId: f.contactId,
        details: { old: oldAlias, new: newAlias, friendId: f.id, trigger: 'sync_from_zalo' },
      });
    }
  }
  logger.info(`[alias-sync] Account ${accountId}: pulled ${aliasMap.size} aliases, updated ${updated} friends`);
  return { updated, pulled: aliasMap.size };
}
