// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * duplicate-detector.ts — Detect & auto-merge duplicate contacts per org.
 *
 * Policy (anh chốt LẠI 2026-06-16 — CHỈ gộp theo globalId + phone):
 *   Hard match → auto-merge:
 *     - zaloGlobalId (Zalo toàn cục, source-of-truth) — khối (1)
 *     - phone (normalized), kèm conflict-guard globalId — khối (3)
 *   Conflict guard: group có ≥2 globalId khác nhau → KHÔNG merge, flag chờ sale.
 *   Legacy zaloUid match (per-account) → DuplicateGroup chờ sale — khối (5).
 *   Parent candidates (name+phone trùng, globalId khác) → gợi ý cha-con — khối (7).
 *
 * ĐÃ BỎ (gây gộp loạn 51 Contact, gồm 2 người trùng tên "Trọng Ngoán"):
 *   - (2) zaloUsername: Zalo trả placeholder rác dùng chung (t_ggzbdcmi80=55 người).
 *   - (4) Soft match theo TÊN: tên VN trùng + privacy blur ▒ ghi đè tên hàng loạt.
 *   - (6) Fuzzy name (Levenshtein): tên gần-giống → gợi ý rác.
 *   Chi tiết: docs/DESIGN-DEDUPE-BANNER-TRONG-CHAT-20260616.md.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { mergeContacts } from './merge-service.js';
import { followMergedInto } from './resolve-contact.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';

interface ContactLite {
  id: string;
  phone: string | null;
  zaloUid: string | null;
  zaloGlobalId: string | null;
  zaloUsername: string | null;
  fullName: string | null;
  birthDate: Date | null;
  lastActivity: Date | null;
  notes: string | null;
  createdAt: Date;
}

// Bỏ helper levenshteinRatio/normNotes/sameDate (anh chốt 2026-06-16): chỉ phục vụ
// khối gộp-theo-tên (4) + fuzzy-name (6) đã bỏ. normPhone + normName giữ lại vì khối
// (3) phone + (7) parent-candidate còn dùng.
function normPhone(phone: string): string {
  return phone.replace(/[\s\-\.]/g, '').toLowerCase();
}

/**
 * THUẦN (test được): chọn globalId để backfill từ Friend của 1 contact.
 * CHỈ trả khi Friend cho ĐÚNG 1 globalId. ≥2 globalId khác nhau = mơ hồ (Friend trỏ nhiều
 * Zalo identity) → null (KHÔNG backfill/merge, tránh gộp nhầm 2 người). 0 → null.
 */
export function pickBackfillGlobalId(gids: Set<string> | undefined): string | null {
  if (!gids || gids.size !== 1) return null;
  return [...gids][0];
}

function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function saveGroup(
  orgId: string,
  contactIds: string[],
  matchType: string,
  confidence: number,
): Promise<void> {
  const sorted = [...contactIds].sort();
  const existing = await prisma.duplicateGroup.findFirst({
    where: { orgId, resolved: false, contactIds: { equals: sorted } },
  });
  if (existing) return;
  await prisma.duplicateGroup.create({
    data: { orgId, contactIds: sorted, matchType, confidence },
  });
}

/** Try to auto-merge a hard-match group. Honor conflict guards: if differing globalIds
 *  hoặc usernames trong group → skip auto-merge, save DuplicateGroup. */
async function autoMergeHardMatch(
  orgId: string,
  systemUserId: string,
  group: ContactLite[],
  matchType: 'zalo_global_id' | 'zalo_username' | 'phone',
  autoMergedIds: Set<string>,
  conflictGroupsRef: { count: number },
): Promise<boolean> {
  if (group.length < 2) return false;

  // Conflict guard (chỉ áp với phone/username — globalId match thì globalId obviously cùng nhau).
  if (matchType !== 'zalo_global_id') {
    const distinctGlobalIds = new Set(group.filter(c => c.zaloGlobalId).map(c => c.zaloGlobalId!));
    if (distinctGlobalIds.size > 1) {
      await saveGroup(orgId, group.map(c => c.id), `${matchType}_conflict_globalId`, 0.5);
      conflictGroupsRef.count++;
      return false;
    }
  }
  if (matchType === 'phone') {
    const distinctUsernames = new Set(group.filter(c => c.zaloUsername).map(c => c.zaloUsername!));
    if (distinctUsernames.size > 1) {
      await saveGroup(orgId, group.map(c => c.id), 'phone_conflict_username', 0.5);
      conflictGroupsRef.count++;
      return false;
    }
  }

  const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const primary = sorted[0];
  const secondaries = sorted.slice(1).map(c => c.id);
  try {
    await mergeContacts(orgId, systemUserId, primary.id, secondaries);
    autoMergedIds.add(primary.id);
    secondaries.forEach(id => autoMergedIds.add(id));
    logger.info(`[duplicate-detector] Auto-merged ${secondaries.length + 1} contacts via ${matchType} (primary=${primary.id})`);
    return true;
  } catch (err) {
    logger.error(`[duplicate-detector] Auto-merge ${matchType} failed:`, err);
    await saveGroup(orgId, group.map(c => c.id), matchType, 1.0);
    return false;
  }
}

// Resolve "system" user cho audit log khi cron/backfill chạy: dùng owner của org.
// FK activity_logs.user_id yêu cầu user UUID hợp lệ; 'system' literal sẽ fail.
async function resolveSystemUserId(orgId: string): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { orgId, role: 'owner', isActive: true },
    select: { id: true },
  });
  if (owner) return owner.id;
  const anyAdmin = await prisma.user.findFirst({
    where: { orgId, isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return anyAdmin?.id ?? null;
}

export async function detectDuplicates(): Promise<void> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let totalGroups = 0;
  let totalAutoMerged = 0;
  let totalConflictGroups = 0;

  // Phase 1a RLS (Giai đoạn 0.2): mỗi org chạy trong tenant context riêng để mọi
  // org-scoped query (contact/duplicateGroup/parentCandidate...) set đúng app.current_org.
  for (const org of orgs) await withTenant(org.id, async () => {
    const systemUserId = await resolveSystemUserId(org.id);
    if (!systemUserId) {
      logger.warn(`[duplicate-detector] org ${org.id} không có user active → skip auto-merge, chỉ flag DuplicateGroup`);
    }

    const contacts = await prisma.contact.findMany({
      where: { orgId: org.id, mergedInto: null },
      select: {
        id: true, phone: true, zaloUid: true, zaloGlobalId: true, zaloUsername: true,
        fullName: true, birthDate: true, lastActivity: true, notes: true, createdAt: true,
      },
    });

    const autoMergedIds = new Set<string>();
    const conflictRef = { count: 0 };
    const filterRemaining = () => contacts.filter(c => !autoMergedIds.has(c.id));

    // ── (0) BACKFILL globalId từ FRIEND (FIX 2026-06-20 dedup globalId↔phone) ──
    // Hồ sơ import-SĐT đẻ contact phone-KHÔNG-globalId; friend-sync đã lưu globalId trên
    // Friend → dùng nó nối với hồ sơ gốc-Zalo (globalId-KHÔNG-phone). backfill-global-id.ts
    // cũ CHỈ chạy contact có hội thoại user-thread → bỏ sót hồ sơ import 0-hội-thoại, nên làm ở đây.
    // LƯU Ý unique(orgId, zaloGlobalId): nếu đã có contact giữ globalId đó → MERGE thẳng
    // (import vào hồ sơ gốc = primary), KHÔNG set (tránh P2002). Conflict-guard: Friend cho
    // ≥2 globalId khác nhau → bỏ qua (mơ hồ).
    const noGid = contacts.filter(c => !c.zaloGlobalId);
    if (noGid.length) {
      const friends = await prisma.friend.findMany({
        where: { contactId: { in: noGid.map(c => c.id) }, zaloGlobalId: { not: null } },
        select: { contactId: true, zaloGlobalId: true },
      });
      const gidsByContact = new Map<string, Set<string>>();
      for (const f of friends) {
        if (!f.zaloGlobalId) continue;
        if (!gidsByContact.has(f.contactId)) gidsByContact.set(f.contactId, new Set());
        gidsByContact.get(f.contactId)!.add(f.zaloGlobalId);
      }
      for (const c of noGid) {
        if (autoMergedIds.has(c.id)) continue;
        const gid = pickBackfillGlobalId(gidsByContact.get(c.id)); // null nếu 0 hoặc ≥2 (mơ hồ)
        if (!gid) continue;
        // Tìm holder kể cả ĐÃ-merged: unique(org_id, zalo_global_id) NON-partial → contact
        // merged-away VẪN giữ globalId trong index → KHÔNG lọc mergedInto, dùng followMergedInto
        // về gốc alive (nếu chỉ lọc alive sẽ set đè → P2002 với holder đã-merged).
        const holder = await prisma.contact.findFirst({
          where: { orgId: org.id, zaloGlobalId: gid, id: { not: c.id } },
          select: { id: true },
        });
        if (holder) {
          const root = (await followMergedInto(holder.id)).id; // holder có thể đã merged → về gốc
          if (root === c.id) continue;
          // Hồ sơ gốc-Zalo (root) = primary; import (c) = secondary gộp vào.
          if (systemUserId) {
            try {
              await mergeContacts(org.id, systemUserId, root, [c.id]);
              autoMergedIds.add(c.id);
              totalAutoMerged++;
              logger.info(`[duplicate-detector] merge import ${c.id} → gốc ${root} via Friend.globalId`);
            } catch (err) {
              logger.warn(`[duplicate-detector] merge-via-friend-globalId failed ${c.id}→${root}:`, err);
              await saveGroup(org.id, [root, c.id], 'globalId_from_friend_mergefail', 0.5);
            }
          } else {
            await saveGroup(org.id, [root, c.id], 'globalId_from_friend', 1.0);
          }
        } else {
          // Chưa ai giữ globalId này → set lên contact (an toàn, để lần sau match được).
          c.zaloGlobalId = gid;
          await prisma.contact.update({ where: { id: c.id }, data: { zaloGlobalId: gid } })
            .catch((err) => logger.warn(`[duplicate-detector] backfill globalId set ${c.id} failed:`, err));
        }
      }
    }

    // ── (1) Hard match: zaloGlobalId ──────────────────────────────────────
    const byGlobalId = new Map<string, ContactLite[]>();
    for (const c of contacts) {
      if (!c.zaloGlobalId) continue;
      if (!byGlobalId.has(c.zaloGlobalId)) byGlobalId.set(c.zaloGlobalId, []);
      byGlobalId.get(c.zaloGlobalId)!.push(c);
    }
    for (const group of byGlobalId.values()) {
      if (systemUserId && await autoMergeHardMatch(org.id, systemUserId, group, 'zalo_global_id', autoMergedIds, conflictRef)) {
        totalAutoMerged++;
      }
    }

    // ── (2) ĐÃ BỎ: Hard match zaloUsername (anh chốt 2026-06-16) ──────────
    // Zalo trả username placeholder KHÔNG duy nhất (vd 't_ggzbdcmi80' bị 55 contact
    // dùng chung) → gộp hàng chục người khác nhau vào 1 (nguồn "hố đen" như contact
    // "Linh" gom 159 người). Username KHÔNG còn là khóa auto-merge. Chỉ gộp theo
    // globalId (1) + phone (3). Xem docs/DESIGN-DEDUPE-BANNER-TRONG-CHAT-20260616.md.

    // ── (3) Hard match: phone (normalized) ────────────────────────────────
    const byPhone = new Map<string, ContactLite[]>();
    for (const c of filterRemaining()) {
      if (!c.phone) continue;
      const key = normPhone(c.phone);
      if (!key) continue;
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key)!.push(c);
    }
    for (const group of byPhone.values()) {
      if (systemUserId && await autoMergeHardMatch(org.id, systemUserId, group, 'phone', autoMergedIds, conflictRef)) {
        totalAutoMerged++;
      }
    }

    // ── (4) ĐÃ BỎ: Soft match theo TÊN (anh chốt 2026-06-16) ─────────────
    // Trước đây gộp khi fullName trùng-exact + 1 tín hiệu phụ (cùng birthDate HOẶC
    // cùng-ngày lastActivity HOẶC notes trùng). Đây là GỐC RỄ gộp loạn: tên VN trùng
    // nhiều (Linh/Huy/Dung) + privacy blur ▒ từng ghi đè hàng loạt tên thành giống hệt
    // → tự gộp 2+ người KHÁC NHAU (vd "Nguyễn Trọng Ngoán" 2 người gộp làm 1). TÊN
    // KHÔNG còn là khóa gộp (cả auto lẫn gợi ý). Chỉ gộp theo globalId (1) + phone (3).

    // ── (5) zaloUid match (per-account, legacy) → DuplicateGroup manual ──
    const byZalo = new Map<string, string[]>();
    for (const c of filterRemaining()) {
      if (!c.zaloUid) continue;
      if (!byZalo.has(c.zaloUid)) byZalo.set(c.zaloUid, []);
      byZalo.get(c.zaloUid)!.push(c.id);
    }
    for (const ids of byZalo.values()) {
      if (ids.length >= 2) {
        await saveGroup(org.id, ids, 'zalo_uid', 1.0);
        totalGroups++;
      }
    }

    // ── (6) ĐÃ BỎ: Fuzzy name Levenshtein > 0.9 (anh chốt 2026-06-16) ────
    // Trước đây tạo DuplicateGroup gợi ý cho contact tên gần-giống (không identifier).
    // Bỏ vì TÊN không còn là tín hiệu gộp (kể cả gợi ý) — tên VN trùng/gần-giống nhiều
    // → gợi ý toàn rác, sale bỏ qua. Nhất quán với việc bỏ khối (4). Helper
    // levenshteinRatio đã xóa luôn vì không còn caller.

    // ── (7) Parent candidates: name+phone TRÙNG nhưng globalId KHÁC ────
    //     → suggest user as cha-con (cross-Zalo-identity human-level link).
    //     NOT auto-merge; save ParentCandidate cho sale duyệt.
    const parentBy = new Map<string, ContactLite[]>();
    for (const c of filterRemaining()) {
      if (!c.fullName || !c.phone) continue;
      const key = `${normName(c.fullName)}|${normPhone(c.phone)}`;
      if (!parentBy.has(key)) parentBy.set(key, []);
      parentBy.get(key)!.push(c);
    }
    for (const group of parentBy.values()) {
      if (group.length < 2) continue;
      // Cần có ít nhất 2 globalId khác nhau (cross-identity), nếu cùng globalId thì đã auto-merge ở (1)
      const distinctGlobalIds = new Set(group.filter(c => c.zaloGlobalId).map(c => c.zaloGlobalId!));
      if (distinctGlobalIds.size < 2) continue;
      const ids = [...group].map(c => c.id).sort();
      // Skip nếu đã có ParentCandidate chưa dismiss cho cùng cụm
      const existing = await prisma.parentCandidate.findFirst({
        where: { orgId: org.id, dismissed: false, contactIds: { equals: ids } },
      });
      if (existing) continue;
      await prisma.parentCandidate.create({
        data: { orgId: org.id, contactIds: ids, matchType: 'name_phone', confidence: 0.9 },
      });
    }

    totalConflictGroups += conflictRef.count;
  });

  logger.info(
    `[duplicate-detector] auto-merged=${totalAutoMerged} group(s); ` +
    `flagged=${totalGroups} group(s); conflicts=${totalConflictGroups} across ${orgs.length} org(s)`,
  );
}
