// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * tag-service.ts — Tag Taxonomy v2 service layer.
 *
 * Wave 3 /plan-eng-review M57 2026-05-31.
 *
 * Public API:
 *   - addFriendTag(...) / removeFriendTag(...)
 *   - addCrmTag(...) / removeCrmTag(...)
 *   - getFriendTags(friendId) / getCrmTags(contactId)
 *   - mergeTags(orgId, sourceTagId, targetTagId, mergedBy) — 3-guard (Issue 7A)
 *   - searchTags(...) — paginated autocomplete
 *   - recountUsage(orgId, scope?) — on-demand recount (Issue 4A)
 *
 * Dual-write window Wave 3-5: ghi junction (primary) + legacy cols (mirror) trong
 * `prisma.$transaction` (Issue 3A — atomic, no orphan). Read-modify-write dedup
 * Set tránh duplicate slug (Issue 5A). recomputeContactAutoTagsAggregate deferred
 * qua Redis dirty set (Issue 6A) tránh N+1.
 *
 * Scope+source invariant enforce ở DB CHECK constraint (Issue 1A).
 */

import type { Tag, TagScope, TagSource } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { slugifyTag } from '../../shared/tag-slug.js';
import { markContactAutoTagsDirty } from './contact-autotags-dirty.js';
import { logActivity } from '../activity/activity-logger.js';

// Chỉ log activity cho tag THỦ CÔNG (sale tự gắn). KHÔNG log auto_* (bot scoring/detect
// chạy liên tục → ngập timeline). Anh chốt 2026-06-06.
const MANUAL_TAG_SOURCES: TagSource[] = ['manual_per_nick', 'manual_crm', 'zalo_real'];

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<TagSource, number> = {
  zalo_real: 1,
  manual_per_nick: 2,
  auto_detect: 3,
  auto_score: 4,
  auto_engagement: 5,
  segment_rule: 6,
  manual_crm: 7,
  ai_suggest: 8,
  status: 9,
  import: 10,
};

const FRIEND_SOURCES: TagSource[] = ['zalo_real', 'manual_per_nick', 'auto_detect', 'auto_score', 'auto_engagement'];
const CRM_SOURCES: TagSource[] = ['manual_crm', 'ai_suggest', 'segment_rule', 'status', 'import'];

const RETRY_BACKOFF_MS = [100, 500, 2000];

// ─────────────────────────────────────────────────────────────────────────
// Helpers — retry P2002 (Issue N5 + 5.3)
// ─────────────────────────────────────────────────────────────────────────

export async function retryOnUniqueViolation<T>(fn: () => Promise<T>, label = 'op'): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isP2002 = err instanceof PrismaNS.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!isP2002 || attempt === RETRY_BACKOFF_MS.length) throw err;
      const delay = RETRY_BACKOFF_MS[attempt];
      logger.warn(`[tag-service] ${label} P2002 attempt ${attempt + 1}, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────
// Tag lookup / upsert (partial unique aware)
// ─────────────────────────────────────────────────────────────────────────

interface FindOrCreateOpts {
  orgId: string;
  scope: TagScope;
  source: TagSource;
  name: string;
  zaloAccountId?: string | null;
  sourceZaloLabelId?: number | null;
  color?: string;
  emoji?: string | null;
}

/**
 * Find existing Tag matching constraint OR create new. Partial unique:
 *   - zaloAccountId IS NULL → (orgId, scope, slug) unique
 *   - zaloAccountId NOT NULL → (orgId, zaloAccountId, sourceZaloLabelId) unique
 */
// Note: tx type là inferred từ prisma.$transaction callback. Skip explicit annotation
// để tránh xung đột giữa Prisma extension client (host) và TransactionClient default.
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function findOrCreateTag(
  tx: TxClient,
  opts: FindOrCreateOpts
): Promise<Tag> {
  const slug = slugifyTag(opts.name);
  if (!slug) throw new Error('TAG_SLUG_EMPTY');

  // Validate scope+source invariant ở app layer (DB CHECK cũng có nhưng app friendly error)
  const allowed = opts.scope === 'friend' ? FRIEND_SOURCES : CRM_SOURCES;
  if (!allowed.includes(opts.source)) {
    throw new Error(`TAG_SOURCE_INVALID_FOR_SCOPE: scope=${opts.scope} source=${opts.source}`);
  }

  // Lookup theo partial unique
  if (opts.zaloAccountId && opts.sourceZaloLabelId != null) {
    const existing = await tx.tag.findFirst({
      where: {
        orgId: opts.orgId,
        zaloAccountId: opts.zaloAccountId,
        sourceZaloLabelId: opts.sourceZaloLabelId,
      },
    });
    if (existing) return existing;
  } else {
    const existing = await tx.tag.findFirst({
      where: {
        orgId: opts.orgId,
        scope: opts.scope,
        slug,
        zaloAccountId: null,
      },
    });
    if (existing) return existing;
  }

  return tx.tag.create({
    data: {
      orgId: opts.orgId,
      name: opts.name.trim(),
      slug,
      color: opts.color ?? '#90A4AE',
      emoji: opts.emoji ?? null,
      scope: opts.scope,
      source: opts.source,
      priority: PRIORITY_MAP[opts.source],
      zaloAccountId: opts.zaloAccountId ?? null,
      sourceZaloLabelId: opts.sourceZaloLabelId ?? null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Friend Tag — add / remove
// ─────────────────────────────────────────────────────────────────────────

interface AddFriendTagInput {
  friendId: string;
  tagSlug?: string;
  tagId?: string;
  tagName?: string; // dùng khi autoCreate=true
  source: TagSource;
  addedBy: string | null;
  autoCreate?: boolean;
  color?: string;
}

export async function addFriendTag(input: AddFriendTagInput): Promise<{ tag: Tag; friendTagId: string }> {
  const friend = await prisma.friend.findUnique({
    where: { id: input.friendId },
    select: { id: true, orgId: true, contactId: true, zaloAccountId: true },
  });
  if (!friend) throw new Error('FRIEND_NOT_FOUND');

  const result = await retryOnUniqueViolation(
    () =>
      tenantTransaction(async (tx) => {
        // 1. Resolve Tag
        let tag: Tag;
        if (input.tagId) {
          const t = await tx.tag.findUnique({ where: { id: input.tagId } });
          if (!t) throw new Error('TAG_NOT_FOUND');
          tag = t;
        } else if (input.autoCreate && input.tagName) {
          tag = await findOrCreateTag(tx, {
            orgId: friend.orgId,
            scope: 'friend',
            source: input.source,
            name: input.tagName,
            color: input.color,
            zaloAccountId: input.source === 'zalo_real' ? friend.zaloAccountId : null,
          });
        } else if (input.tagSlug) {
          const t = await tx.tag.findFirst({
            where: { orgId: friend.orgId, scope: 'friend', slug: input.tagSlug, zaloAccountId: null },
          });
          if (!t) throw new Error('TAG_NOT_FOUND');
          tag = t;
        } else {
          throw new Error('TAG_INPUT_MISSING');
        }

        // 2. INSERT junction (idempotent via @@unique absorb existing)
        const existing = await tx.friendTag.findUnique({
          where: { friendId_tagId: { friendId: friend.id, tagId: tag.id } },
        });
        let friendTagId: string;
        if (existing) {
          if (existing.removedAt) {
            // re-add: clear soft delete
            await tx.friendTag.update({
              where: { id: existing.id },
              data: { removedAt: null, removedBy: null, addedBy: input.addedBy, addedVia: input.source, addedAt: new Date() },
            });
          }
          friendTagId = existing.id;
        } else {
          const created = await tx.friendTag.create({
            data: {
              friendId: friend.id,
              tagId: tag.id,
              addedBy: input.addedBy,
              addedVia: input.source,
            },
          });
          friendTagId = created.id;
        }

        // 3. Dual-write legacy cols (atomic trong cùng tx)
        await dualWriteLegacyFriend(tx, friend.id, friend.contactId, tag, input.source, 'add');

        return { tag, friendTagId };
      }, { timeout: 10000 }),
    'addFriendTag'
  );

  // 4. Activity log — CHỈ tag thủ công, ghi vào timeline KH (entityType='contact' để
  // hiện ở cột 4 panel của contact). Anh báo: gắn tag manual không lên timeline (2026-06-06).
  if (friend.contactId && MANUAL_TAG_SOURCES.includes(input.source)) {
    logActivity({
      orgId: friend.orgId,
      userId: input.addedBy,
      action: 'tag_add_crm',
      entityType: 'contact',
      entityId: friend.contactId,
      details: { tag: result.tag.name, slug: result.tag.slug, source: input.source, friendId: friend.id, level: 'friend' },
    });
  }

  return result;
}

export async function removeFriendTag(input: {
  friendId: string;
  tagId: string;
  removedBy: string | null;
}): Promise<void> {
  const friend = await prisma.friend.findUnique({
    where: { id: input.friendId },
    select: { id: true, orgId: true, contactId: true },
  });
  if (!friend) throw new Error('FRIEND_NOT_FOUND');

  const removedTag = await tenantTransaction(async (tx) => {
    const existing = await tx.friendTag.findUnique({
      where: { friendId_tagId: { friendId: friend.id, tagId: input.tagId } },
    });
    if (!existing || existing.removedAt) return null; // idempotent

    await tx.friendTag.update({
      where: { id: existing.id },
      data: { removedAt: new Date(), removedBy: input.removedBy },
    });

    const tag = await tx.tag.findUnique({ where: { id: input.tagId } });
    if (tag) {
      await dualWriteLegacyFriend(tx, friend.id, friend.contactId, tag, tag.source, 'remove');
    }
    return tag;
  });

  // Activity log — chỉ tag thủ công (giống addFriendTag). Anh chốt 2026-06-06.
  if (removedTag && friend.contactId && MANUAL_TAG_SOURCES.includes(removedTag.source)) {
    logActivity({
      orgId: friend.orgId,
      userId: input.removedBy,
      action: 'tag_remove_crm',
      entityType: 'contact',
      entityId: friend.contactId,
      details: { tag: removedTag.name, slug: removedTag.slug, source: removedTag.source, friendId: friend.id, level: 'friend' },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Dual-write helper — Friend side (Issue 3A + 5A + 6A)
// ─────────────────────────────────────────────────────────────────────────

async function dualWriteLegacyFriend(
  tx: TxClient,
  friendId: string,
  contactId: string,
  tag: Tag,
  source: TagSource,
  op: 'add' | 'remove'
): Promise<void> {
  const slug = tag.slug;

  if (source === 'manual_per_nick') {
    // Read-modify-write dedup Set (Issue 5A)
    const cur = await tx.friend.findUnique({
      where: { id: friendId },
      select: { crmTagsPerNick: true },
    });
    const slugs = new Set((cur?.crmTagsPerNick as string[]) ?? []);
    if (op === 'add') slugs.add(slug);
    else slugs.delete(slug);
    await tx.friend.update({ where: { id: friendId }, data: { crmTagsPerNick: [...slugs] } });
  } else if (source === 'zalo_real') {
    // Friend.zaloLabels = [{id,name,color}] snapshot
    const cur = await tx.friend.findUnique({
      where: { id: friendId },
      select: { zaloLabels: true },
    });
    const labels = (cur?.zaloLabels as Array<{ id?: number; name?: string; color?: string }>) ?? [];
    const id = tag.sourceZaloLabelId;
    if (op === 'add' && id != null) {
      const exists = labels.some((l) => l.id === id);
      if (!exists) labels.push({ id, name: tag.name, color: tag.color });
    } else if (op === 'remove' && id != null) {
      const idx = labels.findIndex((l) => l.id === id);
      if (idx >= 0) labels.splice(idx, 1);
    }
    await tx.friend.update({ where: { id: friendId }, data: { zaloLabels: labels } });
  } else if (source === 'auto_detect' || source === 'auto_score' || source === 'auto_engagement') {
    const cur = await tx.friend.findUnique({
      where: { id: friendId },
      select: { autoTags: true },
    });
    const slugs = new Set((cur?.autoTags as string[]) ?? []);
    if (op === 'add') slugs.add(slug);
    else slugs.delete(slug);
    await tx.friend.update({ where: { id: friendId }, data: { autoTags: [...slugs] } });
    // Aggregate deferred — Issue 6A
    void markContactAutoTagsDirty(contactId);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CRM Tag — add / remove
// ─────────────────────────────────────────────────────────────────────────

interface AddCrmTagInput {
  contactId: string;
  tagSlug?: string;
  tagId?: string;
  tagName?: string;
  source: TagSource;
  addedBy: string | null;
  autoCreate?: boolean;
  color?: string;
}

export async function addCrmTag(input: AddCrmTagInput): Promise<{ tag: Tag; contactTagId: string }> {
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { id: true, orgId: true },
  });
  if (!contact) throw new Error('CONTACT_NOT_FOUND');

  return retryOnUniqueViolation(
    () =>
      tenantTransaction(async (tx) => {
        let tag: Tag;
        if (input.tagId) {
          const t = await tx.tag.findUnique({ where: { id: input.tagId } });
          if (!t) throw new Error('TAG_NOT_FOUND');
          tag = t;
        } else if (input.autoCreate && input.tagName) {
          tag = await findOrCreateTag(tx, {
            orgId: contact.orgId,
            scope: 'crm',
            source: input.source,
            name: input.tagName,
            color: input.color,
          });
        } else if (input.tagSlug) {
          const t = await tx.tag.findFirst({
            where: { orgId: contact.orgId, scope: 'crm', slug: input.tagSlug, zaloAccountId: null },
          });
          if (!t) throw new Error('TAG_NOT_FOUND');
          tag = t;
        } else {
          throw new Error('TAG_INPUT_MISSING');
        }

        const existing = await tx.contactTag.findUnique({
          where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
        });
        let contactTagId: string;
        if (existing) {
          if (existing.removedAt) {
            await tx.contactTag.update({
              where: { id: existing.id },
              data: { removedAt: null, removedBy: null, addedBy: input.addedBy, addedVia: input.source, addedAt: new Date() },
            });
          }
          contactTagId = existing.id;
        } else {
          const created = await tx.contactTag.create({
            data: {
              contactId: contact.id,
              tagId: tag.id,
              addedBy: input.addedBy,
              addedVia: input.source,
            },
          });
          contactTagId = created.id;
        }

        // Dual-write Contact.tags
        await dualWriteLegacyContact(tx, contact.id, tag, 'add');

        return { tag, contactTagId };
      }, { timeout: 10000 }),
    'addCrmTag'
  );
}

export async function removeCrmTag(input: {
  contactId: string;
  tagId: string;
  removedBy: string | null;
}): Promise<void> {
  await tenantTransaction(async (tx) => {
    const existing = await tx.contactTag.findUnique({
      where: { contactId_tagId: { contactId: input.contactId, tagId: input.tagId } },
    });
    if (!existing || existing.removedAt) return;

    await tx.contactTag.update({
      where: { id: existing.id },
      data: { removedAt: new Date(), removedBy: input.removedBy },
    });

    const tag = await tx.tag.findUnique({ where: { id: input.tagId } });
    if (tag) {
      await dualWriteLegacyContact(tx, input.contactId, tag, 'remove');
    }
  });
}

async function dualWriteLegacyContact(
  tx: TxClient,
  contactId: string,
  tag: Tag,
  op: 'add' | 'remove'
): Promise<void> {
  const cur = await tx.contact.findUnique({
    where: { id: contactId },
    select: { tags: true },
  });
  const slugs = new Set((cur?.tags as string[]) ?? []);
  if (op === 'add') slugs.add(tag.slug);
  else slugs.delete(tag.slug);
  await tx.contact.update({ where: { id: contactId }, data: { tags: [...slugs] } });
}

// ─────────────────────────────────────────────────────────────────────────
// Read APIs
// ─────────────────────────────────────────────────────────────────────────

export async function getFriendTags(friendId: string) {
  return prisma.friendTag.findMany({
    where: { friendId, removedAt: null },
    include: { tag: true },
    orderBy: [{ tag: { priority: 'asc' } }, { addedAt: 'desc' }],
  });
}

export async function getCrmTags(contactId: string) {
  return prisma.contactTag.findMany({
    where: { contactId, removedAt: null },
    include: { tag: true },
    orderBy: [{ tag: { priority: 'asc' } }, { addedAt: 'desc' }],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Search Tags — autocomplete
// ─────────────────────────────────────────────────────────────────────────

export async function searchTags(opts: {
  orgId: string;
  scope: TagScope;
  q: string;
  limit?: number;
  cursor?: string;
}) {
  const limit = Math.min(opts.limit ?? 20, 100);
  return prisma.tag.findMany({
    where: {
      orgId: opts.orgId,
      scope: opts.scope,
      archivedAt: null,
      OR: opts.q
        ? [
            { name: { contains: opts.q, mode: 'insensitive' } },
            { slug: { contains: slugifyTag(opts.q) } },
          ]
        : undefined,
    },
    orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    take: limit,
    skip: opts.cursor ? 1 : 0,
    cursor: opts.cursor ? { id: opts.cursor } : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Merge Tags — 3-guard (Issue 7A)
// ─────────────────────────────────────────────────────────────────────────

export async function mergeTags(opts: {
  orgId: string;
  sourceTagId: string;
  targetTagId: string;
  mergedBy: string;
}): Promise<{ moved: number; skipped: string | null }> {
  return tenantTransaction(async (tx) => {
    const [src, tgt] = await Promise.all([
      tx.tag.findUnique({ where: { id: opts.sourceTagId } }),
      tx.tag.findUnique({ where: { id: opts.targetTagId } }),
    ]);

    // Guard 1: idempotent — source archived → skip
    if (!src || src.archivedAt) return { moved: 0, skipped: 'source_already_archived' };
    if (!tgt || tgt.archivedAt) return { moved: 0, skipped: 'target_archived' };

    // Guard 2: scope match
    if (src.scope !== tgt.scope) throw new Error('SCOPE_MISMATCH');

    // Guard 3: zalo_real không cho merge (mất Zalo sync link)
    if (src.source === 'zalo_real') throw new Error('ZALO_REAL_NOT_MERGEABLE');

    // Dedup conflict trước UPDATE: friend đã có cả 2 tag → soft-remove source row
    await tx.$executeRaw`
      UPDATE friend_tags
      SET removed_at = NOW(), removed_by = ${opts.mergedBy}
      WHERE tag_id = ${opts.sourceTagId}
        AND friend_id IN (
          SELECT friend_id FROM friend_tags
          WHERE tag_id = ${opts.targetTagId} AND removed_at IS NULL
        )
        AND removed_at IS NULL
    `;
    await tx.$executeRaw`
      UPDATE contact_tags
      SET removed_at = NOW(), removed_by = ${opts.mergedBy}
      WHERE tag_id = ${opts.sourceTagId}
        AND contact_id IN (
          SELECT contact_id FROM contact_tags
          WHERE tag_id = ${opts.targetTagId} AND removed_at IS NULL
        )
        AND removed_at IS NULL
    `;

    // UPDATE remaining junction rows source → target
    const movedFriend = await tx.friendTag.updateMany({
      where: { tagId: opts.sourceTagId, removedAt: null },
      data: { tagId: opts.targetTagId },
    });
    const movedContact = await tx.contactTag.updateMany({
      where: { tagId: opts.sourceTagId, removedAt: null },
      data: { tagId: opts.targetTagId },
    });

    // ARCHIVE source
    await tx.tag.update({
      where: { id: opts.sourceTagId },
      data: { archivedAt: new Date() },
    });

    return { moved: movedFriend.count + movedContact.count, skipped: null };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Recount usage — on-demand (Issue 4A)
// ─────────────────────────────────────────────────────────────────────────

export async function recountUsage(orgId: string, scope?: TagScope): Promise<{ updated: number }> {
  const where: Record<string, unknown> = { orgId, archivedAt: null };
  if (scope) where.scope = scope;

  const tags = await prisma.tag.findMany({ where, select: { id: true, scope: true } });
  let updated = 0;
  for (const t of tags) {
    const count =
      t.scope === 'friend'
        ? await prisma.friendTag.count({ where: { tagId: t.id, removedAt: null } })
        : await prisma.contactTag.count({ where: { tagId: t.id, removedAt: null } });
    await prisma.tag.update({ where: { id: t.id }, data: { usageCount: count } });
    updated += 1;
  }
  return { updated };
}
