// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-labels-routes.ts — Sync và quản lý Zalo native labels (thẻ Zalo Real) per nick.
 *
 * Zalo SDK exposes:
 *  - api.getLabels() → returns { labelData: [{ id, text, textKey, color, emoji, offset, conversations[] }], version }
 *  - api.updateLabels({ labelData, version }) → write back (replace whole structure)
 *
 * CRM model:
 *  - ZaloLabel: per (zaloAccountId, zaloLabelId). Mirror of SDK shape.
 *  - Friend.zaloLabels JSON: array of {id, name, color} — the labels assigned to that friend.
 *    Recomputed on every sync by walking ZaloLabel.conversations[] and matching externalThreadId.
 *
 * Realtime: sync-now endpoint + periodic cron (every 60s for connected accounts).
 * Socket broadcast on change so UI auto-refresh.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from './zalo-pool.js';
import { logActivity } from '../activity/activity-logger.js';
import { getZaloScope, requireAccountManagement, requireAccountVisible } from './zalo-scope.js';

type LabelDataFromSdk = {
  id: number | string;
  text: string;
  textKey: string;
  color: string;
  emoji?: string;
  offset?: number;
  conversations?: string[];
  createTime?: number;
};

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const x of a) if (!setB.has(x)) return false;
  return true;
}

/**
 * Pull labels from a Zalo account via SDK, upsert into DB, then recompute Friend.zaloLabels
 * for every friend of that account. Returns { labels, friendsUpdated }.
 *
 * Delta mode: pass `affectedUidsOnly` để chỉ rebuild Friend rows tương ứng (1-2 friends
 * thay vì toàn bộ 5000). Dùng cho assign-thread / friends/:id/zalo-label — nơi chỉ có
 * 1 friend đổi label. Skip CrmTag upsert + archive vì label definitions không đổi khi
 * user chỉ gán/gỡ tag. Full sync path (cron / manual button) vẫn rebuild all.
 */
export async function syncLabelsForAccount(
  accountId: string,
  orgId: string,
  opts?: { seedLabelData?: LabelDataFromSdk[]; seedVersion?: number; affectedUidsOnly?: string[] },
): Promise<{
  labels: Array<{ id: number; text: string; color: string; emoji: string | null; assignedCount: number }>;
  friendsUpdated: number;
  aliasesUpdated: number;
  version: number;
}> {
  const isDelta = Array.isArray(opts?.affectedUidsOnly);
  const api = zaloPool.getApi(accountId);
  if (!api) throw new Error('Zalo account chưa kết nối — không thể đồng bộ label');
  if (typeof api.getLabels !== 'function') throw new Error('SDK không hỗ trợ getLabels()');

  // Seed: dùng labelData từ updateLabels response (authoritative, không lag).
  // Nếu không có seed → fall back getLabels (có thể stale do Zalo eventual consistency).
  let labelData: LabelDataFromSdk[];
  let version: number;
  if (opts?.seedLabelData && opts.seedLabelData.length >= 0) {
    labelData = opts.seedLabelData;
    version = opts.seedVersion ?? 0;
    logger.info(`[zalo-labels] Using SEED labelData (${labelData.length} labels, v=${version}) — skip re-pull, avoid eventual-consistency race`);
  } else {
    logger.info(`[zalo-labels] Pulling from Zalo SDK for account ${accountId}...`);
    const res = await api.getLabels();
    labelData = res?.labelData || res?.data?.labelData || [];
    version = res?.version || res?.data?.version || 0;
    logger.info(`[zalo-labels] Got ${labelData.length} labels from Zalo (version=${version}) for account ${accountId}`);
  }

  // Upsert all labels from SDK → DB.
  // Optimization: bulk read first, skip upsert nếu mọi field khớp với seed (delta path
  // thường chỉ có 1-2 labels thay đổi conversations[]).
  const upserted = await tenantTransaction(async (tx) => {
    // Delta mode KHÔNG delete: user assign chỉ thêm/bỏ uid khỏi conversations,
    // không xoá label. Full sync mới handle label deletion (catches external changes).
    if (!isDelta) {
      const incomingIds = labelData.map(l => Number(l.id));
      await tx.zaloLabel.deleteMany({
        where: { zaloAccountId: accountId, zaloLabelId: { notIn: incomingIds.length ? incomingIds : [-1] } },
      });
    }

    const existing = await tx.zaloLabel.findMany({
      where: { zaloAccountId: accountId },
    });
    const byLabelId = new Map(existing.map(l => [l.zaloLabelId, l]));

    const rows = [];
    for (const lbl of labelData) {
      const id = Number(lbl.id);
      const prev = byLabelId.get(id);
      const nextConvs = lbl.conversations || [];
      const nextText = lbl.text || '';
      const nextTextKey = lbl.textKey || '';
      const nextColor = lbl.color || '#999999';
      const nextEmoji = lbl.emoji || null;
      const nextOffset = lbl.offset ?? 0;

      if (prev
        && prev.text === nextText
        && prev.textKey === nextTextKey
        && prev.color === nextColor
        && prev.emoji === nextEmoji
        && prev.offset === nextOffset
        && sameStringSet(Array.isArray(prev.conversations) ? prev.conversations as string[] : [], nextConvs)
      ) {
        rows.push(prev);  // No change — reuse existing row
        continue;
      }

      const row = await tx.zaloLabel.upsert({
        where: { zaloAccountId_zaloLabelId: { zaloAccountId: accountId, zaloLabelId: id } },
        create: {
          orgId,
          zaloAccountId: accountId,
          zaloLabelId: id,
          textKey: nextTextKey,
          text: nextText,
          color: nextColor,
          emoji: nextEmoji,
          offset: nextOffset,
          version,
          conversations: nextConvs,
          createTime: lbl.createTime ? BigInt(lbl.createTime) : null,
        },
        update: {
          text: nextText,
          textKey: nextTextKey,
          color: nextColor,
          emoji: nextEmoji,
          offset: nextOffset,
          version,
          conversations: nextConvs,
          syncedAt: new Date(),
        },
      });
      rows.push(row);
    }
    return rows;
  });

  // Rebuild Friend.zaloLabels JSON: per friend, find all labels whose conversations[] includes friend.zaloUidInNick.
  const friends = await prisma.friend.findMany({
    where: { zaloAccountId: accountId },
    select: { id: true, zaloUidInNick: true },
  });

  // Build reverse index: uid → labels[]
  const uidToLabels = new Map<string, Array<{ id: number; name: string; color: string; emoji: string | null }>>();
  for (const lbl of upserted) {
    const convs: unknown = lbl.conversations;
    const arr = Array.isArray(convs) ? (convs as string[]) : [];
    for (const uid of arr) {
      const list = uidToLabels.get(uid) || [];
      list.push({ id: lbl.zaloLabelId, name: lbl.text, color: lbl.color, emoji: lbl.emoji });
      uidToLabels.set(uid, list);
    }
  }

  // Bulk update friend.zaloLabels + mirror sang CrmTagsPerNick + log diff.
  // Mirror naming: "🔵 {labelText}" prefix. CrmTagGroup auto-tạo per Zalo account.
  // CrmTag.managedBy='zalo_sync' + sourceZaloLabelId để read-only enforcement.
  //
  // Delta mode SKIP toàn bộ CrmTag block: assign không đổi label name/color/emoji,
  // chỉ đổi conversations[]. CrmTag definitions giữ nguyên. Full sync (cron/manual)
  // sẽ reconcile CrmTag cho external changes (label tạo/xoá/đổi tên trên Zalo Real).
  if (!isDelta) {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { displayName: true, phone: true },
    });
    const groupName = `Zalo - ${account?.displayName || 'Nick'}${account?.phone ? ` (${account.phone})` : ''}`;

    // Upsert CrmTagGroup for this Zalo account (managedBy='zalo_sync').
    // 2026-06-11 FIX (Bug Zalo native không hiện cột 2): collision-safe.
    // Nick re-QR tạo account row MỚI cùng displayName → groupName trùng, nhưng group cũ
    // thuộc nick cũ (đã archived) → upsert hit create-branch → đụng unique (orgId, name)
    // → P2002 CRASH giữa full sync → friend.zaloLabels KHÔNG được rebuild (bước sau).
    // Fix: nếu lookup theo (zaloAccountId, managedBy) miss → tìm theo (orgId, name) →
    // CLAIM (reassign sang account hiện tại) thay vì create. Giống pattern CrmTag 3-bước.
    let group = await prisma.crmTagGroup.findUnique({
      where: { zaloAccountId_managedBy: { zaloAccountId: accountId, managedBy: 'zalo_sync' } },
    });
    if (group) {
      if (group.name !== groupName) {
        group = await prisma.crmTagGroup.update({ where: { id: group.id }, data: { name: groupName } });
      }
    } else {
      const byName = await prisma.crmTagGroup.findFirst({ where: { orgId, name: groupName } });
      if (byName) {
        group = await prisma.crmTagGroup.update({
          where: { id: byName.id },
          data: { zaloAccountId: accountId, managedBy: 'zalo_sync' },
        });
      } else {
        group = await prisma.crmTagGroup.create({
          data: { orgId, name: groupName, managedBy: 'zalo_sync', zaloAccountId: accountId },
        });
      }
    }

    // Upsert CrmTag per label — 3-step để xử lý legacy data từ PR2:
    //  1. Find theo sourceZaloLabelId (PR3+ rows) → update
    //  2. Else find theo (orgId, name) (legacy PR2 rows hoặc orphan) → claim + update fields
    //  3. Else create mới
    // Tránh upsert(where=sourceZaloLabelId) hit create branch khi legacy có same name
    // → fail unique constraint (orgId, name).
    for (const l of upserted) {
      const tagName = `🔵 ${l.text}`;
      const baseData = {
        color: l.color || '#1976D2',
        emoji: l.emoji || null,
        groupId: group.id,
        category: groupName,
        managedBy: 'zalo_sync',
        sourceZaloLabelId: l.zaloLabelId,
        description: `Auto-sync từ Zalo label ID ${l.zaloLabelId}`,
        archivedAt: null,
      };

      const bySource = await prisma.crmTag.findUnique({
        where: { sourceZaloLabelId: l.zaloLabelId },
      });
      if (bySource) {
        try {
          await prisma.crmTag.update({
            where: { id: bySource.id },
            data: { name: tagName, ...baseData },
          });
        } catch (err: any) {
          // Race: another sync claimed (orgId, name) trong khi mình tính update
          // → skip, row đã được đồng bộ bởi caller khác.
          if (err?.code !== 'P2002') throw err;
        }
        continue;
      }

      const byName = await prisma.crmTag.findUnique({
        where: { orgId_name: { orgId, name: tagName } },
      });
      if (byName) {
        // Claim legacy row (sourceZaloLabelId=null từ PR2) → upgrade managedBy
        try {
          await prisma.crmTag.update({
            where: { id: byName.id },
            data: baseData,
          });
        } catch (err: any) {
          // Race: another sync vừa set sourceZaloLabelId cho row này → skip
          if (err?.code !== 'P2002') throw err;
        }
        continue;
      }

      // Race-condition safe: 2 concurrent sync requests cho cùng 1 label
      // có thể cả 2 cùng pass bySource=null + byName=null. Khi create lần 2
      // sẽ hit P2002 unique(orgId, name) hoặc unique(sourceZaloLabelId).
      // Fix: catch P2002 → retry find + update thay vì error toàn bộ sync.
      try {
        await prisma.crmTag.create({
          data: { orgId, name: tagName, ...baseData },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const winnerBySrc = await prisma.crmTag.findUnique({
            where: { sourceZaloLabelId: l.zaloLabelId },
          });
          const winnerByName = winnerBySrc
            ? null
            : await prisma.crmTag.findUnique({ where: { orgId_name: { orgId, name: tagName } } });
          const winner = winnerBySrc ?? winnerByName;
          if (winner) {
            await prisma.crmTag.update({
              where: { id: winner.id },
              data: { name: tagName, ...baseData },
            });
          }
        } else {
          throw err;
        }
      }
    }

    // Archive CrmTag tương ứng với label bị xoá (không còn trong upserted set)
    const currentLabelIds = upserted.map(l => l.zaloLabelId);
    await prisma.crmTag.updateMany({
      where: {
        orgId,
        managedBy: 'zalo_sync',
        groupId: group.id,
        sourceZaloLabelId: { notIn: currentLabelIds.length ? currentLabelIds : [-1] },
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });

    // M57 Wave 3 dual-write — sync Tag v2 (scope=friend, source=zalo_real) definitions.
    // Khi Zalo thêm label mới hoặc đổi name/color → upsert Tag.
    // Khi Zalo xoá label → archive Tag tương ứng.
    for (const l of upserted) {
      const tagSlug = (await import('../../shared/tag-slug.js')).slugifyTag(l.text);
      if (!tagSlug) continue;
      const existingTag = await prisma.tag.findFirst({
        where: { orgId, zaloAccountId: accountId, sourceZaloLabelId: l.zaloLabelId },
      });
      if (existingTag) {
        // Update name/color/emoji nếu Zalo đổi
        if (existingTag.name !== l.text || existingTag.color !== l.color || existingTag.emoji !== l.emoji) {
          await prisma.tag.update({
            where: { id: existingTag.id },
            data: { name: l.text, slug: tagSlug, color: l.color || '#1976D2', emoji: l.emoji ?? null, archivedAt: null },
          });
        } else if (existingTag.archivedAt) {
          await prisma.tag.update({ where: { id: existingTag.id }, data: { archivedAt: null } });
        }
      } else {
        // Tag mới (Zalo vừa thêm label, hoặc backfill bỏ lỡ)
        await prisma.tag.create({
          data: {
            orgId,
            name: l.text,
            slug: tagSlug,
            color: l.color || '#1976D2',
            emoji: l.emoji ?? null,
            scope: 'friend',
            source: 'zalo_real',
            priority: 1,
            zaloAccountId: accountId,
            sourceZaloLabelId: l.zaloLabelId,
          },
        }).catch(() => { /* race-safe */ });
      }
    }
    // Archive Tag v2 zalo_real khi Zalo xoá label
    await prisma.tag.updateMany({
      where: {
        orgId,
        zaloAccountId: accountId,
        source: 'zalo_real',
        sourceZaloLabelId: { notIn: currentLabelIds.length ? currentLabelIds : [-1] },
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });
  }

  // Bulk update friend.zaloLabels + diff log.
  // Delta mode: chỉ touch friend rows có zaloUidInNick trong affectedUidsOnly
  // (thường 1 friend cho assign-thread). Full mode: rebuild tất cả friends của account.
  const friendsFull = await prisma.friend.findMany({
    where: isDelta
      ? { zaloAccountId: accountId, zaloUidInNick: { in: opts!.affectedUidsOnly! } }
      : { zaloAccountId: accountId },
    select: { id: true, zaloUidInNick: true, contactId: true, zaloLabels: true, crmTagsPerNick: true },
  });
  let friendsUpdated = 0;
  for (const f of friendsFull) {
    const newLabels = uidToLabels.get(f.zaloUidInNick) || [];
    const oldLabels = Array.isArray(f.zaloLabels) ? (f.zaloLabels as Array<{ name?: string }>) : [];
    const oldNames = new Set(oldLabels.map(l => l.name).filter(Boolean) as string[]);
    const newNames = new Set(newLabels.map(l => l.name).filter(Boolean));
    const addedLabels = [...newNames].filter(n => !oldNames.has(n));
    const removedLabels = [...oldNames].filter(n => !newNames.has(n));

    // Mirror sang crmTagsPerNick: strip all "🔵 ..." cũ + add "🔵 {name}" cho TẤT CẢ
    // labels hiện tại. Phải mirror toàn bộ (không chỉ addedLabels) để handle case
    // legacy data: friend đã có zaloLabels nhưng crmTagsPerNick chưa mirror — sync
    // chạy lại thấy addedLabels=[] (không có label mới) → không add mirror → bug.
    //
    // Lưu ý: emoji 🔵 (U+1F535) là surrogate pair — JS string length = 2 code units,
    // cộng dấu cách = 3 ký tự. PHẢI dùng prefix constant để strip; slice(2) sẽ để lại
    // dấu cách → labelName = " 1688" → never matches newNames → strip toàn bộ mirror tag.
    const MIRROR_PREFIX = '🔵 ';
    const oldCrmTags = Array.isArray(f.crmTagsPerNick) ? (f.crmTagsPerNick as string[]) : [];
    // Giữ lại các tag user-CRM (không phải Zalo-mirror), strip toàn bộ mirror cũ
    const newCrmTags = oldCrmTags.filter(t => !t.startsWith(MIRROR_PREFIX));
    // Add mirror cho TẤT CẢ Zalo labels hiện tại (không chỉ added)
    for (const labelName of newNames) {
      const mirroredTag = `🔵 ${labelName}`;
      if (!newCrmTags.includes(mirroredTag)) newCrmTags.push(mirroredTag);
    }

    await prisma.friend.update({
      where: { id: f.id },
      data: {
        zaloLabels: newLabels,
        zaloLabelsSyncedAt: new Date(),
        crmTagsPerNick: newCrmTags,
      },
    });
    friendsUpdated++;

    // 2026-06-06 (Anh chốt) — emit 'friend:updated' patch.zaloLabels để sync realtime tag Zalo Real
    // cross-device: cột 2 conv list + TagCrmBar + /friends. Dùng getIo() (không phải truyền io 5 call-site).
    if (f.contactId) {
      try {
        const { getIo } = await import('../../shared/event-buffer.js');
        const io = getIo();
        if (io) {
          io.to(`org:${orgId}`).emit('friend:updated', {
            friendId: f.id,
            contactId: f.contactId,
            zaloAccountId: accountId,
            zaloUidInNick: f.zaloUidInNick,
            patch: { zaloLabels: newLabels },
          });
        }
      } catch (err) {
        logger.warn(`[zalo-labels] emit friend:updated (zaloLabels) failed for ${f.id}: ${(err as Error).message}`);
      }
    }

    // M57 Wave 3 /plan-eng-review dual-write: sync vào FriendTag(source=zalo_real).
    // Lookup Tag(scope=friend, source=zalo_real, zaloAccountId=accountId, sourceZaloLabelId)
    // → upsert FriendTag với @@unique(friend_id, tag_id). Re-activate nếu đã soft-removed.
    // Wave 5 sẽ remove block legacy update phía trên + đổi reader sang FriendTag JOIN.
    try {
      // Build set ID Zalo label hiện đang gắn vào friend (sau sync).
      const currentLabelIds = new Set(newLabels.map((l) => l.id));
      const previousLabelIds = new Set(oldLabels.map((l) => (l as { id?: number }).id).filter((id): id is number => typeof id === 'number'));

      // Add: label mới được gắn
      for (const labelId of currentLabelIds) {
        if (previousLabelIds.has(labelId)) continue; // không đổi
        const tagRow = await prisma.tag.findFirst({
          where: { orgId, zaloAccountId: accountId, sourceZaloLabelId: labelId },
          select: { id: true },
        });
        if (!tagRow) continue; // chưa backfill Tag → bỏ qua, lần sync sau sẽ catch
        const existing = await prisma.friendTag.findUnique({
          where: { friendId_tagId: { friendId: f.id, tagId: tagRow.id } },
        });
        if (existing) {
          if (existing.removedAt) {
            await prisma.friendTag.update({
              where: { id: existing.id },
              data: { removedAt: null, removedBy: null, addedVia: 'zalo_real', addedAt: new Date() },
            });
          }
        } else {
          await prisma.friendTag.create({
            data: { friendId: f.id, tagId: tagRow.id, addedVia: 'zalo_real', addedBy: null },
          }).catch(() => { /* race-safe absorb P2002 */ });
        }
      }
      // Remove: label cũ không còn gắn nữa → soft remove FriendTag
      for (const labelId of previousLabelIds) {
        if (currentLabelIds.has(labelId)) continue;
        const tagRow = await prisma.tag.findFirst({
          where: { orgId, zaloAccountId: accountId, sourceZaloLabelId: labelId },
          select: { id: true },
        });
        if (!tagRow) continue;
        await prisma.friendTag.updateMany({
          where: { friendId: f.id, tagId: tagRow.id, removedAt: null },
          data: { removedAt: new Date(), removedBy: null },
        });
      }
    } catch (err) {
      logger.warn(`[zalo-labels] FriendTag dual-write skipped for friend ${f.id}: ${(err as Error).message}`);
    }

    // ── ACTIVITY LOG — gộp tag_change_zalo nếu có CẢ remove + add cùng sync.
    //  Single-select Zalo tag (1 label/friend) → đổi A→B thường có 1 remove + 1 add.
    //  Edge case nhiều add/remove cùng lúc → fallback log riêng từng action. ──
    if (f.contactId) {
      const baseDetails = { friendId: f.id, accountId, trigger: 'sync' };
      if (removedLabels.length === 1 && addedLabels.length === 1) {
        // Case phổ biến nhất: đổi tag A→B
        logActivity({
          orgId,
          systemSource: 'zalo_label_sync',
          action: 'tag_change_zalo',
          entityType: 'contact',
          entityId: f.contactId,
          details: { ...baseDetails, from: removedLabels[0], to: addedLabels[0] },
        });
      } else {
        // Fallback: log riêng từng add/remove (multi-add hoặc multi-remove)
        for (const labelName of addedLabels) {
          logActivity({
            orgId,
            systemSource: 'zalo_label_sync',
            action: 'tag_add_zalo',
            entityType: 'contact',
            entityId: f.contactId,
            details: { ...baseDetails, tag: labelName },
          });
        }
        for (const labelName of removedLabels) {
          logActivity({
            orgId,
            systemSource: 'zalo_label_sync',
            action: 'tag_remove_zalo',
            entityType: 'contact',
            entityId: f.contactId,
            details: { ...baseDetails, tag: labelName },
          });
        }
      }
    }
  }

  // Alias sync (Tên gợi nhớ): chỉ ở full-sync path. Delta path (assign-thread) bỏ qua
  // vì user assign tag không liên quan đến alias. Fire-and-forget — không block label
  // sync nếu alias pull lỗi (alias là enrichment, không critical).
  let aliasesUpdated = 0;
  if (!isDelta) {
    try {
      const { syncAliasesForAccount } = await import('./alias-sync.js');
      const r = await syncAliasesForAccount(accountId, orgId);
      aliasesUpdated = r.updated;
    } catch (err) {
      logger.warn(`[zalo-labels] Alias sync skipped for ${accountId}:`, err);
    }
  }

  return {
    labels: upserted.map(l => ({
      id: l.zaloLabelId,
      text: l.text,
      color: l.color,
      emoji: l.emoji,
      assignedCount: Array.isArray(l.conversations) ? (l.conversations as string[]).length : 0,
    })),
    friendsUpdated,
    aliasesUpdated,
    version,
  };
}

export async function zaloLabelsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/zalo-accounts/:id/labels — list từ DB.
  //    Query ?threadId=xxx → mỗi label kèm flag assignedTo (current thread có gán không).
  app.get('/api/v1/zalo-accounts/:id/labels', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { threadId?: string };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, displayName: true, avatarUrl: true, status: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const threadId = request.query.threadId || '';
      const labels = await prisma.zaloLabel.findMany({
        where: { zaloAccountId: account.id },
        orderBy: { offset: 'asc' },
      });
      return {
        account,
        labels: labels.map(l => {
          const convs = Array.isArray(l.conversations) ? (l.conversations as string[]) : [];
          return {
            id: l.zaloLabelId,
            dbId: l.id,
            text: l.text,
            textKey: l.textKey,
            color: l.color,
            emoji: l.emoji,
            offset: l.offset,
            syncedAt: l.syncedAt,
            assignedCount: convs.length,
            assignedTo: threadId ? convs.includes(threadId) : false,
          };
        }),
      };
    } catch (err) {
      logger.error('[zalo-labels] List error:', err);
      return reply.status(500).send({ error: 'Failed to list labels' });
    }
  });

  // ── GET /api/v1/zalo-accounts/labels-overview — all accounts user has access ─
  app.get('/api/v1/zalo-accounts/labels-overview', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      // Phase Zalo Account Mutation Gate 2026-05-27: migrate sang getZaloScope
      // để trưởng phòng thấy labels của nick cấp dưới (cascade dept tree).
      const scope = await getZaloScope(user.id, user.orgId, user.role);
      const accounts = await prisma.zaloAccount.findMany({
        where: {
          orgId: user.orgId,
          ...(scope.isOrgAdmin ? {} : { id: { in: scope.accessibleIds } }),
        },
        select: {
          id: true, displayName: true, avatarUrl: true, status: true,
          zaloLabelsList: {
            select: { zaloLabelId: true, text: true, color: true, emoji: true, conversations: true, syncedAt: true, offset: true },
            orderBy: { offset: 'asc' },
          },
        },
      });
      return {
        accounts: accounts.map(a => ({
          id: a.id, displayName: a.displayName, avatarUrl: a.avatarUrl,
          // 2026-06-11: trả status SỐNG từ pool (như GET /zalo-accounts.liveStatus) thay vì
          // DB status — DB hay kẹt 'qr_pending' sau re-QR dù pool đang connected → FE hiện
          // "đang quét" + DISABLE nút Đồng bộ (acc.status!=='connected') dù sync chạy được.
          status: zaloPool.getStatus(a.id),
          labels: a.zaloLabelsList.map(l => ({
            id: l.zaloLabelId,
            text: l.text,
            color: l.color,
            emoji: l.emoji,
            offset: l.offset,
            syncedAt: l.syncedAt,
            assignedCount: Array.isArray(l.conversations) ? (l.conversations as string[]).length : 0,
          })),
        })),
      };
    } catch (err) {
      logger.error('[zalo-labels] Overview error:', err);
      return reply.status(500).send({ error: 'Failed to load labels overview' });
    }
  });

  // ── POST /api/v1/zalo-accounts/:id/labels/sync — pull từ Zalo SDK (force, bỏ cooldown).
  //    Settings page "Đồng bộ ngay" + manual user click.
  app.post('/api/v1/zalo-accounts/:id/labels/sync', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      // Phase Zalo Account Mutation Gate 2026-05-27: gate write trên nick
      const account = await requireAccountManagement(request, reply, request.params.id);
      if (!account) return reply;
      const result = await syncLabelsForAccount(account.id, account.orgId);
      return result;
    } catch (err) {
      logger.error('[zalo-labels] Sync error:', err);
      const msg = err instanceof Error ? err.message : 'Sync failed';
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/v1/zalo-accounts/:id/labels/touch — sync nếu stale (cooldown 5s).
  //    Frontend trigger khi switch conversation / load tab. No-op nếu vừa sync gần đây.
  app.post('/api/v1/zalo-accounts/:id/labels/touch', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      // Phase Zalo Account Mutation Gate 2026-05-27: gate (touch là write side-effect)
      const account = await requireAccountManagement(request, reply, request.params.id);
      if (!account) return reply;
      const result = await syncLabelsIfStale(account.id, account.orgId);
      if (!result) return { ok: true, skipped: true, reason: 'cooldown' };
      return { ok: true, ...result };
    } catch (err) {
      // Mềm: không trả 500 cho touch vì đây là trigger background — chỉ log + 200 ok=false
      const msg = err instanceof Error ? err.message : 'Touch failed';
      logger.warn('[zalo-labels] Touch sync warn:', msg);
      return { ok: false, error: msg };
    }
  });

  // ── POST /api/v1/zalo-accounts/:id/labels/assign-thread — assign label cho thread (user UID hoặc group ID).
  //    Body: { threadId: string, labelId: number | null }
  //    Single-select: strip threadId khỏi mọi label, add vào label mới. Push qua SDK updateLabels().
  //    Supports BOTH user threads + group threads.
  app.post('/api/v1/zalo-accounts/:id/labels/assign-thread', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { threadId: string; labelId: number | null };
  }>, reply: FastifyReply) => {
    try {
      // Phase Zalo Account Mutation Gate 2026-05-27: gate write (label thread)
      const account = await requireAccountManagement(request, reply, request.params.id);
      if (!account) return reply;

      const threadId = (request.body?.threadId || '').trim();
      const newLabelId = request.body?.labelId ?? null;
      if (!threadId) return reply.status(400).send({ error: 'threadId is required' });

      const api = zaloPool.getApi(account.id);
      if (!api || typeof api.updateLabels !== 'function') {
        return reply.status(503).send({ error: 'Zalo account chưa kết nối — không thể gán tag' });
      }

      const current = await api.getLabels();
      const labelData: LabelDataFromSdk[] = (current?.labelData || []).map((l: LabelDataFromSdk) => ({
        ...l,
        conversations: Array.isArray(l.conversations) ? [...l.conversations] : [],
      }));
      const version: number = current?.version || 0;

      // Strip threadId khỏi mọi label (single-select cleanup)
      for (const l of labelData) {
        l.conversations = (l.conversations || []).filter(c => c !== threadId);
      }

      // Add to new label if provided
      if (newLabelId !== null) {
        const target = labelData.find(l => Number(l.id) === newLabelId);
        if (!target) return reply.status(400).send({ error: 'Label ID không tồn tại' });
        target.conversations = target.conversations || [];
        if (!target.conversations.includes(threadId)) target.conversations.push(threadId);
      }

      logger.info(`[zalo-labels] Pushing labelData (${labelData.length} labels, v=${version}) → Zalo for thread ${threadId}, newLabelId=${newLabelId}`);
      let writeRes: { labelData?: LabelDataFromSdk[]; version?: number } | undefined;
      try {
        writeRes = await api.updateLabels({ labelData, version });
        logger.info(`[zalo-labels] Zalo updateLabels success → new version=${writeRes?.version}`);
      } catch (sdkErr: unknown) {
        const msg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
        logger.error(`[zalo-labels] Zalo updateLabels FAILED: ${msg}`);
        return reply.status(502).send({ error: `Zalo từ chối: ${msg}` });
      }

      // ── Critical: dùng response từ updateLabels làm seed cho sync.
      // KHÔNG re-pull getLabels() vì Zalo có eventual consistency (1-3s lag) →
      // getLabels có thể trả state CŨ chưa bao gồm label vừa update → strip tag
      // mới khỏi Friend.crmTagsPerNick → UI flicker tag mất.
      //
      // Delta mode: chỉ rebuild Friend row của threadId vừa đổi (1 friend thay vì
      // toàn bộ 5000) → assign-thread response < 100ms thay vì 25-50s. Loại bỏ race
      // window mà fetchConversations có thể đè optimistic UI. ──
      const seedLabelData = Array.isArray(writeRes?.labelData) ? writeRes!.labelData : labelData;
      const seedVersion = writeRes?.version ?? version;
      recentAssignAt.set(account.id, Date.now());  // grace window cho touch sau này
      const result = await syncLabelsForAccount(account.id, account.orgId, {
        seedLabelData: seedLabelData as LabelDataFromSdk[],
        seedVersion,
        affectedUidsOnly: [threadId],
      });
      return { ok: true, assignedLabelId: newLabelId, ...result };
    } catch (err) {
      logger.error('[zalo-labels] Assign-thread error:', err);
      const msg = err instanceof Error ? err.message : 'Assign failed';
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/v1/friends/:friendId/zalo-label — assign 1 label cho friend (single-select).
  //    Body: { labelId: number | null }. null = remove all labels.
  //    Logic: tìm tất cả label hiện đang chứa externalThreadId → remove, rồi add vào label mới.
  //    Cập nhật toàn bộ qua SDK updateLabels({labelData, version}).
  app.post('/api/v1/friends/:friendId/zalo-label', async (request: FastifyRequest<{
    Params: { friendId: string };
    Body: { labelId: number | null };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const friend = await prisma.friend.findFirst({
        where: { id: request.params.friendId, orgId: user.orgId },
        select: { id: true, zaloAccountId: true, zaloUidInNick: true, orgId: true },
      });
      if (!friend) return reply.status(404).send({ error: 'Friend not found' });

      const newLabelId = request.body?.labelId ?? null;
      const api = zaloPool.getApi(friend.zaloAccountId);
      if (!api || typeof api.updateLabels !== 'function') {
        return reply.status(503).send({ error: 'Zalo account chưa kết nối — không thể gán tag' });
      }

      // Pull current label data from Zalo (authoritative source)
      const current = await api.getLabels();
      const labelData: LabelDataFromSdk[] = (current?.labelData || []).map((l: LabelDataFromSdk) => ({
        ...l,
        conversations: Array.isArray(l.conversations) ? [...l.conversations] : [],
      }));
      const version: number = current?.version || 0;
      const uid = friend.zaloUidInNick;

      // Remove uid khỏi mọi label đang chứa nó (single-select cleanup)
      for (const l of labelData) {
        l.conversations = (l.conversations || []).filter(c => c !== uid);
      }

      // Add uid vào label được chọn (nếu có)
      if (newLabelId !== null) {
        const target = labelData.find(l => Number(l.id) === newLabelId);
        if (!target) {
          return reply.status(400).send({ error: 'Label ID không tồn tại trong tài khoản này' });
        }
        target.conversations = target.conversations || [];
        if (!target.conversations.includes(uid)) target.conversations.push(uid);
      }

      // Push back to Zalo
      const writeRes = await api.updateLabels({ labelData, version }) as { labelData?: LabelDataFromSdk[]; version?: number } | undefined;

      // Re-sync DB dùng seed từ updateLabels response (authoritative, no eventual-consistency lag).
      // Delta mode: chỉ rebuild friend này (cùng lý do với assign-thread).
      const seedLabelData = Array.isArray(writeRes?.labelData) ? writeRes!.labelData : labelData;
      recentAssignAt.set(friend.zaloAccountId, Date.now());
      const result = await syncLabelsForAccount(friend.zaloAccountId, friend.orgId, {
        seedLabelData: seedLabelData as LabelDataFromSdk[],
        seedVersion: writeRes?.version ?? version,
        affectedUidsOnly: [uid],
      });
      return { ok: true, assignedLabelId: newLabelId, ...result };
    } catch (err) {
      logger.error('[zalo-labels] Assign error:', err);
      const msg = err instanceof Error ? err.message : 'Assign failed';
      return reply.status(500).send({ error: msg });
    }
  });

  // ── PATCH /api/v1/zalo-accounts/:id/labels/:labelId — edit color/text → write back qua SDK ─
  app.patch('/api/v1/zalo-accounts/:id/labels/:labelId', async (request: FastifyRequest<{
    Params: { id: string; labelId: string };
    Body: { color?: string; text?: string; emoji?: string };
  }>, reply: FastifyReply) => {
    try {
      // Phase Zalo Account Mutation Gate 2026-05-27: gate edit label nick
      const account = await requireAccountManagement(request, reply, request.params.id);
      if (!account) return reply;

      const labelId = Number(request.params.labelId);
      const label = await prisma.zaloLabel.findUnique({
        where: { zaloAccountId_zaloLabelId: { zaloAccountId: account.id, zaloLabelId: labelId } },
      });
      if (!label) return reply.status(404).send({ error: 'Label not found' });

      const api = zaloPool.getApi(account.id);
      if (!api || typeof api.updateLabels !== 'function') {
        return reply.status(503).send({ error: 'Zalo account chưa kết nối — không thể cập nhật' });
      }

      // Fetch full current labelData, mutate the target, then push back via SDK
      const current = await api.getLabels();
      const labelData = (current?.labelData || []).map((l: LabelDataFromSdk) => {
        if (Number(l.id) !== labelId) return l;
        return {
          ...l,
          text: request.body.text ?? l.text,
          color: request.body.color ?? l.color,
          emoji: request.body.emoji ?? l.emoji,
        };
      });
      await api.updateLabels({ labelData, version: current?.version || 0 });

      // Re-sync to capture the new server state
      const result = await syncLabelsForAccount(account.id, account.orgId);
      return { ok: true, ...result };
    } catch (err) {
      logger.error('[zalo-labels] Patch error:', err);
      const msg = err instanceof Error ? err.message : 'Update failed';
      return reply.status(500).send({ error: msg });
    }
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * On-demand sync với rate-limit per-account (cooldown 5s).
 * Gọi từ frontend khi switch conversation hoặc reload tab — không poll định kỳ.
 *
 * Grace window: khi user vừa assign/đổi tag (recentAssignAt), passive touch
 * skip sync để tránh ghi đè state của user bằng dữ liệu có thể stale từ
 * Zalo getLabels (eventual consistency 1-3s).
 * ──────────────────────────────────────────────────────────────────────── */
const lastSyncedAt = new Map<string, number>();
const SYNC_COOLDOWN_MS = 5_000;

// Recent user action timestamp per account — block passive touch sync.
// assign-thread sets this; touch reads.
export const recentAssignAt = new Map<string, number>();
const ASSIGN_GRACE_MS = 30_000;

/**
 * Sync nếu lần gần nhất > 5s VÀ chưa có user action gần đây (30s grace).
 * Returns sync result hoặc null nếu skipped do cooldown / grace.
 */
export async function syncLabelsIfStale(accountId: string, orgId: string): Promise<Awaited<ReturnType<typeof syncLabelsForAccount>> | null> {
  // Skip nếu user vừa assign — trust their authoritative result, không re-pull stale
  const lastAssign = recentAssignAt.get(accountId) || 0;
  if (Date.now() - lastAssign < ASSIGN_GRACE_MS) {
    logger.info(`[zalo-labels] Skip passive sync — user assigned recently (${Math.round((Date.now() - lastAssign) / 1000)}s ago)`);
    return null;
  }

  const last = lastSyncedAt.get(accountId) || 0;
  if (Date.now() - last < SYNC_COOLDOWN_MS) return null;
  lastSyncedAt.set(accountId, Date.now());
  try {
    return await syncLabelsForAccount(accountId, orgId);
  } catch (e) {
    // Reset cooldown nếu failed → lần sau retry sớm hơn
    lastSyncedAt.delete(accountId);
    throw e;
  }
}

// Compat exports — đã bỏ background interval, giữ stub để app.ts không break
export function startLabelsBackgroundSync(_intervalMs?: number): void {
  logger.info('[zalo-labels] On-demand sync mode (no background interval, 5s cooldown per account)');
}
export function stopLabelsBackgroundSync(): void {}
