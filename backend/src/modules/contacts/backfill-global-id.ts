// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * backfill-global-id.ts — One-off (idempotent) migration tool.
 *
 * Resolves zaloGlobalId + zaloUsername cho mọi Contact đã có zaloUid nhưng
 * thiếu globalId. Sau khi backfill xong, chạy detectDuplicates() để auto-merge
 * những Contact có cùng globalId (nhiều CRM account thấy cùng person với UID
 * per-account khác nhau).
 *
 * Loop qua TẤT CẢ connected Zalo accounts cho mỗi UID — vì UID là per-viewer,
 * chỉ account đã từng tương tác mới resolve được profile.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { detectDuplicates } from './duplicate-detector.js';
import { mergeContacts } from './merge-service.js';

interface ZaloProfile {
  globalId: string;
  username: string;
  zaloName: string;
  avatar: string;
}

// Cache placeholder usernames (xuất hiện >5 lần trong DB → là default Zalo trả về
// cho group UIDs hoặc entity không có username thực). KHÔNG store các giá trị này.
let placeholderUsernamesCache: Set<string> | null = null;
async function getPlaceholderUsernames(): Promise<Set<string>> {
  if (placeholderUsernamesCache) return placeholderUsernamesCache;
  try {
    const rows = await prisma.$queryRaw<{ username: string }[]>`
      SELECT zalo_username AS username
      FROM contacts
      WHERE zalo_username IS NOT NULL
      GROUP BY zalo_username
      HAVING COUNT(*) > 5
    `;
    placeholderUsernamesCache = new Set(rows.map(r => r.username));
  } catch {
    placeholderUsernamesCache = new Set();
  }
  return placeholderUsernamesCache;
}

async function resolveProfile(uid: string, accountIds: string[]): Promise<ZaloProfile | null> {
  const placeholders = await getPlaceholderUsernames();
  for (const accId of accountIds) {
    const instance = zaloPool.getInstance(accId);
    const userApi = instance?.api as {
      getUserInfo?: (uid: string) => Promise<{ changed_profiles?: Record<string, Record<string, unknown>> }>;
    } | undefined;
    if (!userApi?.getUserInfo) continue;
    try {
      const result = await userApi.getUserInfo(uid);
      const profiles = result?.changed_profiles || {};
      const p = profiles[uid] || profiles[`${uid}_0`];
      if (p && (p.globalId || p.username || p.zaloName || p.displayName || p.avatar)) {
        const username = String(p.username || '');
        // Reject placeholder username (Zalo SDK default cho group / entity ko có username)
        const cleanUsername = (username && !placeholders.has(username)) ? username : '';
        return {
          globalId: String(p.globalId || ''),
          username: cleanUsername,
          zaloName: String(p.zaloName || p.zalo_name || p.displayName || p.display_name || ''),
          avatar: String(p.avatar || ''),
        };
      }
    } catch (err) {
      logger.warn(`[backfill] account ${accId} failed for ${uid}:`, err);
    }
  }
  return null;
}

export interface BackfillResult {
  totalScanned: number;
  resolved: number;
  failed: number;
  autoMergedGroups: number;
}

export async function backfillGlobalId(batchSize: number = 50): Promise<BackfillResult> {
  const accounts = await prisma.zaloAccount.findMany({
    where: { status: 'connected' },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);
  if (accountIds.length === 0) {
    logger.warn('[backfill] No connected Zalo account — skip.');
    return { totalScanned: 0, resolved: 0, failed: 0, autoMergedGroups: 0 };
  }

  // Chỉ scan contacts có ÍT NHẤT 1 user-thread conversation. Skip contacts chỉ tồn
  // tại trong group convs — getUserInfo(groupUid) trả placeholder username/globalId
  // dùng chung cho nhiều group (vd 't_ggzbdcmi80' — 79 contacts đã bị bug này).
  const contacts = await prisma.contact.findMany({
    where: {
      zaloUid: { not: null },
      zaloGlobalId: null,
      mergedInto: null,
      conversations: { some: { threadType: 'user' } },
    },
    select: { id: true, zaloUid: true, orgId: true },
  });

  logger.info(`[backfill] Found ${contacts.length} contact(s) with zaloUid but no zaloGlobalId (excluded group-only)`);

  let resolved = 0;
  let failed = 0;
  let merged = 0;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    // KHÔNG dùng Promise.all trên cùng globalId — gây race condition giữa các contact
    // có cùng globalId trong cùng batch. Tuần tự an toàn hơn (vẫn 1 batch ~ 20 contact).
    for (const c of batch) {
      const profile = await resolveProfile(c.zaloUid!, accountIds);
      if (!profile || !profile.globalId) { failed++; continue; }
      try {
        await prisma.contact.update({
          where: { id: c.id },
          data: {
            zaloGlobalId: profile.globalId,
            zaloUsername: profile.username || null,
          },
        });
        // Đồng bộ xuống Friend rows của Contact này — globalId/username là
        // property của Zalo identity, các Friend của cùng Contact (cùng identity)
        // có chung. Cross-account UID khác nhau, nhưng globalId GIỐNG.
        await prisma.friend.updateMany({
          where: { contactId: c.id },
          data: {
            zaloGlobalId: profile.globalId,
            zaloUsername: profile.username || null,
          },
        }).catch(() => {});
        resolved++;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          // Đã có Contact khác cùng org với globalId này → merge ngay.
          // Primary = contact tồn tại trước (sortable by createdAt).
          const sibling = await prisma.contact.findFirst({
            where: { orgId: c.orgId, zaloGlobalId: profile.globalId, mergedInto: null },
            select: { id: true, createdAt: true },
          });
          if (sibling && sibling.id !== c.id) {
            const selfRow = await prisma.contact.findUnique({
              where: { id: c.id }, select: { createdAt: true },
            });
            // primary = older createdAt
            const primaryId = selfRow && selfRow.createdAt < sibling.createdAt ? c.id : sibling.id;
            const secondaryId = primaryId === c.id ? sibling.id : c.id;
            try {
              // Resolve user owner làm "system" cho audit log (FK requires real user UUID)
              const owner = await prisma.user.findFirst({
                where: { orgId: c.orgId, isActive: true },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
              });
              if (!owner) {
                logger.warn(`[backfill] org ${c.orgId} không có active user → skip merge ${c.id}`);
                failed++;
                continue;
              }
              await mergeContacts(c.orgId, owner.id, primaryId, [secondaryId]);
              // Primary có thể chưa có globalId nếu trước đó nó là người khác cũng dup → patch luôn
              await prisma.contact.update({
                where: { id: primaryId },
                data: { zaloGlobalId: profile.globalId, zaloUsername: profile.username || null },
              }).catch(() => {});
              merged++;
              resolved++;
            } catch (mergeErr) {
              logger.error(`[backfill] merge ${c.id} → ${sibling.id} failed:`, mergeErr);
              failed++;
            }
          } else {
            failed++;
          }
        } else {
          logger.error(`[backfill] update contact ${c.id} failed:`, err);
          failed++;
        }
      }
    }
    logger.info(`[backfill] Progress: ${Math.min(i + batchSize, contacts.length)}/${contacts.length} (merged=${merged})`);
  }

  // Sau backfill inline merge: chạy detector để pick up các group còn sót (vd primary
  // tạo mới có globalId trùng với primary cũ đã merged) + xử lý phone/zaloUid groups.
  try {
    await detectDuplicates();
  } catch (err) {
    logger.error('[backfill] detectDuplicates after backfill failed:', err);
  }

  logger.info(`[backfill] Complete: scanned=${contacts.length} resolved=${resolved} failed=${failed} merged=${merged}`);
  return { totalScanned: contacts.length, resolved, failed, autoMergedGroups: merged };
}

/**
 * Backfill orphan Friend rows: Friend.contactId trỏ vào Contact đã merged
 * → reassign sang primary (mergedInto). Cần chạy 1 lần sau khi cập nhật
 * merge-service biết handle Friend, vì các merge trước đó để lại Friend orphan.
 */
export interface FriendBackfillResult {
  orphanFound: number;
  reassigned: number;
  deletedDup: number;
}

export async function backfillOrphanFriends(): Promise<FriendBackfillResult> {
  const result: FriendBackfillResult = { orphanFound: 0, reassigned: 0, deletedDup: 0 };

  const orphans = await prisma.friend.findMany({
    where: { contact: { mergedInto: { not: null } } },
    select: { id: true, contactId: true, zaloAccountId: true, contact: { select: { mergedInto: true } } },
  });
  result.orphanFound = orphans.length;
  if (orphans.length === 0) {
    logger.info('[backfill-friends] No orphan Friend rows found.');
    return result;
  }
  logger.info(`[backfill-friends] Found ${orphans.length} orphan Friend row(s)`);

  for (const f of orphans) {
    const primaryId = f.contact.mergedInto!;
    // Conflict check: primary đã có Friend cho cùng zaloAccount?
    const existing = await prisma.friend.findFirst({
      where: { contactId: primaryId, zaloAccountId: f.zaloAccountId },
      select: { id: true },
    });
    try {
      if (existing) {
        await prisma.friend.delete({ where: { id: f.id } });
        result.deletedDup++;
      } else {
        await prisma.friend.update({ where: { id: f.id }, data: { contactId: primaryId } });
        result.reassigned++;
      }
    } catch (err) {
      logger.warn(`[backfill-friends] failed to handle Friend ${f.id}:`, err);
    }
  }
  logger.info(`[backfill-friends] Complete: reassigned=${result.reassigned} deletedDup=${result.deletedDup}`);
  return result;
}
