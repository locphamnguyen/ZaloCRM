// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * backfill-friend-display-name.ts — One-off (idempotent) backfill.
 *
 * Resolves Friend.zaloDisplayName + Friend.zaloAvatarUrl per (zaloAccount, UID)
 * cho các Friend đã tồn tại trước khi snapshot per-identity được thêm vào.
 *
 * Tại sao: trước PR 2g, Friend không lưu tên/avatar Zalo riêng — UI fallback
 * sang contact.fullName, dẫn đến sau khi merge vào KH Cha thì tên Cha leak vào
 * mọi Friend con. Backfill này lấp lại snapshot per-identity từ Zalo API.
 *
 * Pattern: giống backfill-global-id — group Friend theo zaloAccountId, gọi
 * getUserInfo trên đúng account đã friend với UID đó (per-viewer Zalo API).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';

interface ResolvedProfile {
  zaloName: string | null;
  avatar: string | null;
}

async function resolveOne(uid: string, accountId: string): Promise<ResolvedProfile | null> {
  const instance = zaloPool.getInstance(accountId);
  const userApi = instance?.api as {
    getUserInfo?: (uid: string) => Promise<{ changed_profiles?: Record<string, Record<string, unknown>> }>;
  } | undefined;
  if (!userApi?.getUserInfo) return null;
  try {
    const result = await userApi.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const p = profiles[uid] || profiles[`${uid}_0`];
    if (!p) return null;
    const zaloName = String(p.zaloName || p.zalo_name || p.displayName || p.display_name || '') || null;
    const avatar = String(p.avatar || '') || null;
    if (!zaloName && !avatar) return null;
    return { zaloName, avatar };
  } catch (err) {
    logger.warn(`[backfill-friend-name] account ${accountId} failed for ${uid}:`, err);
    return null;
  }
}

export interface FriendDisplayNameResult {
  totalScanned: number;
  resolved: number;
  failed: number;
}

export async function backfillFriendDisplayName(batchSize: number = 50): Promise<FriendDisplayNameResult> {
  // Quét Friend rows thiếu zaloDisplayName HOẶC zaloAvatarUrl (any missing → resolve lại).
  const friends = await prisma.friend.findMany({
    where: {
      OR: [
        { zaloDisplayName: null },
        { zaloAvatarUrl: null },
      ],
    },
    select: { id: true, zaloUidInNick: true, zaloAccountId: true },
  });

  logger.info(`[backfill-friend-name] Found ${friends.length} Friend row(s) needing per-identity snapshot`);

  let resolved = 0;
  let failed = 0;
  for (let i = 0; i < friends.length; i += batchSize) {
    const batch = friends.slice(i, i + batchSize);
    for (const f of batch) {
      const profile = await resolveOne(f.zaloUidInNick, f.zaloAccountId);
      if (!profile) { failed++; continue; }
      try {
        await prisma.friend.update({
          where: { id: f.id },
          data: {
            zaloDisplayName: profile.zaloName,
            zaloAvatarUrl: profile.avatar,
          },
        });
        resolved++;
      } catch (err) {
        logger.error(`[backfill-friend-name] update Friend ${f.id} failed:`, err);
        failed++;
      }
    }
    logger.info(`[backfill-friend-name] Progress: ${Math.min(i + batchSize, friends.length)}/${friends.length}`);
  }

  logger.info(`[backfill-friend-name] Complete: scanned=${friends.length} resolved=${resolved} failed=${failed}`);
  return { totalScanned: friends.length, resolved, failed };
}
