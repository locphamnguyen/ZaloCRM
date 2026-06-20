// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * engagement-tag-service.ts — Làm tag Auto Engagement "sống" (tự cập nhật).
 *
 * /office-hours 2026-06-06 (Anh chốt gom auto-tag 3→2): Auto Engagement (Hot/Cold)
 * trước đây chỉ do backfill tạo TĨNH, không tự đổi khi Contact.engagementPattern đổi.
 * Service này nối engagement-cron → mỗi đêm tự add/remove tag Hot/Cold theo pattern mới,
 * giống cách auto-tag.ts làm cho Auto Detect.
 *
 * ⚠️ Slug engagement là SYNTHETIC (`engagement-{pattern}`), KHÔNG round-trip từ name.
 * addFriendTag(autoCreate) tự slugifyTag(name) → 'hot' ≠ 'engagement-hot' → tạo tag trùng.
 * → PHẢI seed tag def với slug tường minh + add/remove bằng tagId (KHÔNG autoCreate).
 *
 * Concurrency: cron gọi syncEngagementTagForOrg() chạy TUẦN TỰ (await từng contact),
 * mỗi contact 1 transaction. KHÔNG fire-and-forget từ trong vòng lặp recompute (tránh
 * bung hàng nghìn promise rời → cạn connection pool ở scale 4784 friend).
 */

import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import type { EngagementPattern } from './engagement-service.js';

// Map pattern → tag definition. Slug TƯỜNG MINH khớp backfill cũ (backfill-tag-taxonomy.ts).
// Màu #F44336 (đỏ engagement) khớp backfill. Priority 5 (auto_engagement trong PRIORITY_MAP).
// Việt hóa 100% — PA1 theo mức nhiệt (Anh chốt 2026-06-06). Nhóm AUTO ENGAGEMENT tả ĐỘ CHĂM/
// cường độ tương tác (KHÔNG dùng từ "nguội/nhắn" của nhóm Detect → tránh lẫn). slug GIỮ nguyên.
const PATTERN_DEFS: Record<EngagementPattern, { name: string; slug: string }> = {
  hot: { name: '🔥 Rất tích cực', slug: 'engagement-hot' },
  champion: { name: '🏆 Tương tác đỉnh', slug: 'engagement-champion' },
  stable: { name: '✅ Đều đặn', slug: 'engagement-stable' },
  cooling: { name: '❄️ Đang giảm', slug: 'engagement-cooling' },
  cold: { name: '🧊 Ít tương tác', slug: 'engagement-cold' },
  noise: { name: '🔇 Chưa rõ', slug: 'engagement-noise' },
};
const ENGAGEMENT_COLOR = '#F44336';
const ENGAGEMENT_PRIORITY = 5;

// Anh chốt 2026-06-06: ẩn Noise (KH chưa đủ data) khỏi thanh tag cho gọn.
const HIDE_NOISE = true;

const ALL_PATTERNS = Object.keys(PATTERN_DEFS) as EngagementPattern[];

/**
 * Đảm bảo 6 tag def engagement tồn tại cho org (idempotent). Trả về Map pattern→tagId.
 * Tạo với slug TƯỜNG MINH để không tạo trùng với tag backfill cũ.
 */
async function ensureEngagementTagDefs(orgId: string): Promise<Map<EngagementPattern, string>> {
  const map = new Map<EngagementPattern, string>();
  for (const pattern of ALL_PATTERNS) {
    const def = PATTERN_DEFS[pattern];
    let tag = await prisma.tag.findFirst({
      where: { orgId, scope: 'friend', source: 'auto_engagement', slug: def.slug, zaloAccountId: null },
      select: { id: true, archivedAt: true },
    });
    if (tag?.archivedAt) {
      // Reactivate nếu từng bị archive
      await prisma.tag.update({ where: { id: tag.id }, data: { archivedAt: null } });
    }
    if (!tag) {
      const created = await prisma.tag
        .create({
          data: {
            orgId,
            name: def.name,
            slug: def.slug,
            color: ENGAGEMENT_COLOR,
            scope: 'friend',
            source: 'auto_engagement',
            priority: ENGAGEMENT_PRIORITY,
          },
          select: { id: true },
        })
        .catch(async () => {
          // Race-safe: lần create đồng thời hit unique → re-find
          const again = await prisma.tag.findFirst({
            where: { orgId, scope: 'friend', source: 'auto_engagement', slug: def.slug, zaloAccountId: null },
            select: { id: true },
          });
          return again;
        });
      if (created) map.set(pattern, created.id);
      continue;
    }
    map.set(pattern, tag.id);
  }
  return map;
}

/**
 * Sync tag Auto Engagement cho 1 Contact theo engagementPattern hiện tại.
 *
 * - pattern null → remove hết engagement tag, add none (KH chưa classify).
 * - pattern = noise + HIDE_NOISE → remove hết, add none.
 * - else → cho MỌI friend: active tag của pattern hiện tại, soft-remove các pattern khác.
 *
 * 1 transaction / contact (batch các friend trong cùng tx) — tránh write amplification.
 */
export async function syncEngagementTag(contactId: string): Promise<void> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, orgId: true, engagementPattern: true },
    });
    if (!contact) return;

    const pattern = contact.engagementPattern as EngagementPattern | null;
    const defs = await ensureEngagementTagDefs(contact.orgId);

    // tagId nên ACTIVE (pattern hiện tại, trừ noise-ẩn). Nếu null → không có tag nào active.
    const wantTagId =
      pattern && !(pattern === 'noise' && HIDE_NOISE) ? defs.get(pattern) ?? null : null;

    const allTagIds = ALL_PATTERNS.map((p) => defs.get(p)).filter((id): id is string => !!id);
    if (allTagIds.length === 0) return;

    const friends = await prisma.friend.findMany({
      where: { contactId },
      select: { id: true },
    });
    if (friends.length === 0) return;

    await tenantTransaction(async (tx) => {
        for (const f of friends) {
          // 1. Soft-remove mọi engagement tag KHÁC wantTagId đang active.
          await tx.friendTag.updateMany({
            where: {
              friendId: f.id,
              tagId: { in: allTagIds, ...(wantTagId ? { not: wantTagId } : {}) },
              removedAt: null,
            },
            data: { removedAt: new Date(), removedBy: null },
          });

          // 2. Active wantTagId (nếu có): upsert junction, re-activate nếu đã soft-removed.
          if (wantTagId) {
            const existing = await tx.friendTag.findUnique({
              where: { friendId_tagId: { friendId: f.id, tagId: wantTagId } },
            });
            if (!existing) {
              await tx.friendTag
                .create({
                  data: { friendId: f.id, tagId: wantTagId, addedBy: null, addedVia: 'auto_engagement' },
                })
                .catch(() => {
                  /* race-safe absorb P2002 */
                });
            } else if (existing.removedAt) {
              await tx.friendTag.update({
                where: { id: existing.id },
                data: { removedAt: null, removedBy: null, addedVia: 'auto_engagement', addedAt: new Date() },
              });
            }
          }
        }
      },
      { timeout: 15000 },
    );

    // CareSession 2026-06-07: tag engagement gắn xong → đóng phiên nếu ∈ closeConditions.
    if (wantTagId) {
      try {
        const { onTagAdded } = await import('../../shared/ee-registry/automation.js');
        await onTagAdded({ orgId: contact.orgId, contactId, tagKind: 'friendTag', tagId: wantTagId });
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    logger.warn('[engagement-tag] syncEngagementTag failed', {
      contactId,
      err: (err as Error).message,
    });
  }
}

/**
 * Cron pass (1 org): sync engagement tag cho mọi contact có engagement data (28 ngày)
 * thuộc orgId. Chạy TUẦN TỰ sau classification trong engagement-cron — tự bound concurrency.
 *
 * Phase 1a: cron gọi hàm này TRONG withTenant(orgId, …) nên mọi query org-scoped đi qua
 * đúng tenant context. orgId được truyền tay để 2 query nguồn cũng filter theo org.
 */
export async function syncEngagementTagForOrg(orgId: string): Promise<{ synced: number; durationMs: number }> {
  const start = Date.now();
  const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

  // Nguồn 1: contact có engagement data 28 ngày (cần (re)classify tag theo pattern mới).
  const withData = await prisma.contactEngagementDaily.findMany({
    where: { orgId, date: { gte: cutoff } },
    select: { contactId: true },
    distinct: ['contactId'],
  });

  // Nguồn 2: contact ĐANG mang engagement tag active nhưng có thể KHÔNG còn data 28d
  // (pattern=noise/null hoặc đã nguội hẳn) — phải sync để DỌN tag cũ sót, nếu không tag
  // engagement đứng im mãi (gap phát hiện khi verify 2026-06-06).
  const withTag = await prisma.friendTag.findMany({
    where: { removedAt: null, tag: { source: 'auto_engagement', orgId } },
    select: { friend: { select: { contactId: true } } },
    distinct: ['friendId'],
  });

  const contactIds = new Set<string>();
  for (const c of withData) contactIds.add(c.contactId);
  for (const ft of withTag) {
    if (ft.friend?.contactId) contactIds.add(ft.friend.contactId);
  }

  let synced = 0;
  for (const contactId of contactIds) {
    await syncEngagementTag(contactId);
    synced++;
  }

  const durationMs = Date.now() - start;
  logger.info('[engagement-tag] sync pass done', { orgId, synced, durationMs });
  return { synced, durationMs };
}
