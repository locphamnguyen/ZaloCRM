// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * cung-cham-tag-service.ts — Auto-tag "Cùng chăm" cho KH có ≥2 sale.
 *
 * /plan-eng-review M57 v2 2026-06-01 — anh chốt: bỏ badge avatar 🤝 N ở
 * ConversationList, thay bằng auto-tag "Cùng chăm" hiển thị ở TagCrmBar
 * (Friend scope) + ContactProfile (CRM scope). Không gỡ được — tự auto
 * dựa vào ContactAccess.count.
 *
 * Trigger:
 *   - Sau khi attachContactCollaboratorByUser() (ContactAccess thêm)
 *   - Sau khi remove ContactAccess (defer — chưa có endpoint hiện tại)
 *   - Cron daily 03:00 reconcile toàn org (defense in depth)
 *
 * Logic:
 *   - Count ContactAccess.role IN ('primary', 'collaborator') WHERE contactId = X
 *   - Nếu count >= 2 → add Tag(scope=friend, source=auto_detect, slug='cung-cham')
 *     cho ALL friends của Contact + add Tag(scope=crm, source=segment_rule,
 *     slug='cung-cham') cho Contact
 *   - Nếu count < 2 → soft-remove tag (set removedAt)
 *
 * Tag definitions tự upsert lần đầu run (idempotent).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

const CUNG_CHAM_SLUG = 'cung-cham';
const CUNG_CHAM_FRIEND_NAME = '🤝 Cùng chăm';
const CUNG_CHAM_CRM_NAME = '🤝 Cùng chăm';
const CUNG_CHAM_COLOR = '#0068FF'; // Zalo blue

/**
 * Ensure Tag definitions tồn tại cho org. Upsert idempotent.
 * Return { friendTagId, crmTagId }.
 */
async function ensureCungChamTagDefs(orgId: string): Promise<{ friendTagId: string; crmTagId: string }> {
  // Friend scope — source=auto_detect, slug='cung-cham', zaloAccountId=NULL
  let friendTag = await prisma.tag.findFirst({
    where: { orgId, scope: 'friend', source: 'auto_detect', slug: CUNG_CHAM_SLUG, zaloAccountId: null },
  });
  if (!friendTag) {
    friendTag = await prisma.tag.create({
      data: {
        orgId,
        name: CUNG_CHAM_FRIEND_NAME,
        slug: CUNG_CHAM_SLUG,
        color: CUNG_CHAM_COLOR,
        scope: 'friend',
        source: 'auto_detect',
        priority: 3,
        autoRule: 'ContactAccess.count >= 2',
        description: 'Tự gắn khi KH có ≥2 sale đang/đã chăm (cùng tài khoản org).',
      },
    }).catch(async () => {
      // Race: lookup lại
      return prisma.tag.findFirstOrThrow({
        where: { orgId, scope: 'friend', source: 'auto_detect', slug: CUNG_CHAM_SLUG, zaloAccountId: null },
      });
    });
  }

  // CRM scope — source=segment_rule, slug='cung-cham'
  let crmTag = await prisma.tag.findFirst({
    where: { orgId, scope: 'crm', source: 'segment_rule', slug: CUNG_CHAM_SLUG, zaloAccountId: null },
  });
  if (!crmTag) {
    crmTag = await prisma.tag.create({
      data: {
        orgId,
        name: CUNG_CHAM_CRM_NAME,
        slug: CUNG_CHAM_SLUG,
        color: CUNG_CHAM_COLOR,
        scope: 'crm',
        source: 'segment_rule',
        priority: 6,
        autoRule: 'ContactAccess.count >= 2',
        description: 'Tự gắn khi KH có ≥2 sale đang/đã chăm.',
      },
    }).catch(async () => {
      return prisma.tag.findFirstOrThrow({
        where: { orgId, scope: 'crm', source: 'segment_rule', slug: CUNG_CHAM_SLUG, zaloAccountId: null },
      });
    });
  }

  return { friendTagId: friendTag.id, crmTagId: crmTag.id };
}

/**
 * Recompute tag "Cùng chăm" cho 1 contact.
 * Idempotent — gọi nhiều lần OK, chỉ ghi DB khi state đổi.
 */
export async function recomputeCungChamTag(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, orgId: true },
  });
  if (!contact) return;

  const accessCount = await prisma.contactAccess.count({
    where: { contactId, role: { in: ['primary', 'collaborator'] } },
  });
  const shouldHaveTag = accessCount >= 2;

  const { friendTagId, crmTagId } = await ensureCungChamTagDefs(contact.orgId);

  if (shouldHaveTag) {
    // ADD: insert hoặc re-activate (clear removedAt nếu soft-deleted).
    // CRM side: 1 row ContactTag.
    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId: crmTagId } },
      create: { contactId, tagId: crmTagId, addedVia: 'segment_rule', addedBy: null },
      update: { removedAt: null, removedBy: null },
    });

    // Friend side: 1 row FriendTag per friend của Contact.
    const friends = await prisma.friend.findMany({
      where: { contactId },
      select: { id: true },
    });
    for (const f of friends) {
      await prisma.friendTag.upsert({
        where: { friendId_tagId: { friendId: f.id, tagId: friendTagId } },
        create: { friendId: f.id, tagId: friendTagId, addedVia: 'auto_detect', addedBy: null },
        update: { removedAt: null, removedBy: null },
      });
    }
    logger.debug(`[cung-cham] ADD tag cho contact ${contactId} (${friends.length} friends, accessCount=${accessCount})`);
  } else {
    // REMOVE: soft-delete ContactTag + tất cả FriendTag tương ứng.
    await prisma.contactTag.updateMany({
      where: { contactId, tagId: crmTagId, removedAt: null },
      data: { removedAt: new Date(), removedBy: 'system:cung-cham-recompute' },
    });
    await prisma.friendTag.updateMany({
      where: { tagId: friendTagId, removedAt: null, friend: { contactId } },
      data: { removedAt: new Date(), removedBy: 'system:cung-cham-recompute' },
    });
    logger.debug(`[cung-cham] REMOVE tag cho contact ${contactId} (accessCount=${accessCount})`);
  }
}

/**
 * Cron worker reconcile toàn org. Chạy daily 03:00 (Asia/HCM) defense in depth.
 * Scan tất cả Contact có ContactAccess record, recompute.
 */
export async function reconcileCungChamTagsAllOrgs(): Promise<{ processed: number }> {
  // Find unique contactIds có ContactAccess
  const rows = await prisma.contactAccess.findMany({
    select: { contactId: true },
    distinct: ['contactId'],
  });
  let processed = 0;
  for (const r of rows) {
    try {
      await recomputeCungChamTag(r.contactId);
      processed += 1;
    } catch (err) {
      logger.warn(`[cung-cham] recompute failed for ${r.contactId}: ${(err as Error).message}`);
    }
  }
  logger.info(`[cung-cham] Daily reconcile DONE. processed=${processed}`);
  return { processed };
}
