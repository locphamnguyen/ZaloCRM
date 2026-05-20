/**
 * automation/lists/list-entry-routes.ts — Entries query + bulk action.
 *
 * Endpoints:
 *   GET    /api/v1/customer-lists/:id/entries           — paginated entries with tab filter
 *   POST   /api/v1/customer-lists/:id/entries/bulk      — bulk resolve dup (skip/overwrite/keep)
 *   DELETE /api/v1/customer-lists/:id/entries/:entryId  — delete 1 entry
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { logger } from '../../../shared/utils/logger.js';

type EntryStatusTab =
  | 'all'
  | 'valid'
  | 'invalid'
  | 'dup'
  | 'dup_in_list'
  | 'dup_cross_list'
  | 'dup_with_crm'
  | 'has_zalo'
  | 'no_zalo';

export async function customerListEntryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ─── GET /customer-lists/:id/entries ───
  app.get<{
    Params: { id: string };
    Querystring: { tab?: EntryStatusTab; page?: string; limit?: string; search?: string };
  }>('/api/v1/customer-lists/:id/entries', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    const { tab = 'all', page = '1', limit = '50', search = '' } = request.query;

    // Verify list belongs to org
    const list = await prisma.customerList.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const where: any = { customerListId: id };

    // Tab filter
    if (tab === 'valid') {
      where.phoneValid = true;
      where.status = { notIn: ['invalid'] };
    } else if (tab === 'invalid') {
      where.status = 'invalid';
    } else if (tab === 'dup') {
      where.status = { in: ['dup_in_list', 'dup_cross_list', 'dup_with_crm'] };
    } else if (tab === 'dup_in_list' || tab === 'dup_cross_list' || tab === 'dup_with_crm') {
      where.status = tab;
    } else if (tab === 'has_zalo') {
      where.hasZalo = true;
    } else if (tab === 'no_zalo') {
      where.hasZalo = false;
    }
    // tab === 'all' → no filter

    if (search.trim()) {
      const q = search.trim();
      where.OR = [
        { phoneRaw: { contains: q, mode: 'insensitive' } },
        { phoneE164: { contains: q } },
        { phoneLocal: { contains: q } },
        { nameRaw: { contains: q, mode: 'insensitive' } },
        { zaloName: { contains: q, mode: 'insensitive' } },
        { zaloUid: { equals: q } },
      ];
    }

    try {
      const [entries, total] = await Promise.all([
        prisma.customerListEntry.findMany({
          where,
          orderBy: { rowIndex: 'asc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.customerListEntry.count({ where }),
      ]);

      // Enrich resolvedByNickId → displayName + initials
      const nickIds = [...new Set(entries.map((e) => e.resolvedByNickId).filter((x): x is string => !!x))];
      const nicks = nickIds.length
        ? await prisma.zaloAccount.findMany({
            where: { id: { in: nickIds } },
            select: { id: true, displayName: true, phone: true },
          })
        : [];
      const nickMap = new Map(nicks.map((n) => [n.id, n]));

      // Cross-list reference info — fetch list names for dup_with_list_id
      const dupListIds = [...new Set(entries.map((e) => e.dupWithListId).filter((x): x is string => !!x))];
      const dupLists = dupListIds.length
        ? await prisma.customerList.findMany({
            where: { id: { in: dupListIds }, orgId: user.orgId },
            select: { id: true, name: true },
          })
        : [];
      const dupListMap = new Map(dupLists.map((l) => [l.id, l.name]));

      return {
        entries: entries.map((e) => ({
          ...e,
          resolvedByNick: e.resolvedByNickId ? nickMap.get(e.resolvedByNickId) ?? null : null,
          dupWithListName: e.dupWithListId ? dupListMap.get(e.dupWithListId) ?? null : null,
        })),
        total,
        page: pageNum,
        limit: limitNum,
      };
    } catch (err) {
      logger.error({ err, id }, '[list-entries] list failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ─── POST /customer-lists/:id/entries/bulk ───
  // Body: { entryIds: string[], action: 'skip' | 'overwrite' | 'keep_both' | 'delete' }
  //   skip: mark status='skipped' (won't be enriched/used in campaigns)
  //   overwrite: update CRM Contact với data từ entry (chỉ áp dụng cho dup_with_crm)
  //   keep_both: clear dup flag, treat as new contact (allow re-create)
  //   delete: hard delete entries
  app.post<{
    Params: { id: string };
    Body: { entryIds: string[]; action: 'skip' | 'overwrite' | 'keep_both' | 'delete' };
  }>('/api/v1/customer-lists/:id/entries/bulk', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    const { entryIds, action } = request.body ?? { entryIds: [], action: 'skip' };

    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      return reply.status(400).send({ error: 'entryIds_required' });
    }

    const list = await prisma.customerList.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    try {
      let affected = 0;
      switch (action) {
        case 'skip':
          affected = (await prisma.customerListEntry.updateMany({
            where: { id: { in: entryIds }, customerListId: id },
            data: { status: 'skipped' },
          })).count;
          break;
        case 'keep_both':
          affected = (await prisma.customerListEntry.updateMany({
            where: { id: { in: entryIds }, customerListId: id },
            data: {
              status: 'validated',
              dupWithContactId: null,
              dupInListWithEntryId: null,
              dupWithListId: null,
              dupWithListEntryId: null,
            },
          })).count;
          break;
        case 'delete':
          affected = (await prisma.customerListEntry.deleteMany({
            where: { id: { in: entryIds }, customerListId: id },
          })).count;
          break;
        case 'overwrite':
          // For dup_with_crm: chuyển nameRaw/phone từ entry → Contact existing
          // TODO Phase 2: merge logic chi tiết hơn (handle full Contact field set)
          affected = 0;
          break;
        default:
          return reply.status(400).send({ error: 'invalid_action' });
      }

      // Recompute list counters sau bulk action
      await recomputeListCounters(id);

      return { ok: true, affected };
    } catch (err) {
      logger.error({ err, id, action }, '[list-entries] bulk failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ─── DELETE /customer-lists/:id/entries/:entryId ───
  app.delete<{ Params: { id: string; entryId: string } }>(
    '/api/v1/customer-lists/:id/entries/:entryId',
    async (request, reply) => {
      const user = request.user!;
      const { id, entryId } = request.params;
      const list = await prisma.customerList.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!list) return reply.status(404).send({ error: 'list_not_found' });
      try {
        const deleted = await prisma.customerListEntry.deleteMany({
          where: { id: entryId, customerListId: id },
        });
        if (deleted.count === 0) return reply.status(404).send({ error: 'entry_not_found' });
        await recomputeListCounters(id);
        return reply.status(204).send();
      } catch (err) {
        logger.error({ err, id, entryId }, '[list-entries] delete failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );
}

/**
 * Recompute counters on parent CustomerList from current entry states.
 * Called sau bulk action / delete / enrichment update.
 */
export async function recomputeListCounters(listId: string): Promise<void> {
  const grouped = await prisma.customerListEntry.groupBy({
    by: ['status', 'hasZalo'],
    where: { customerListId: listId },
    _count: true,
  });

  let total = 0,
    valid = 0,
    invalid = 0,
    dupInList = 0,
    dupCross = 0,
    dupCrm = 0,
    hasZalo = 0,
    noZalo = 0,
    pendingLookup = 0;

  for (const g of grouped) {
    const count = g._count;
    total += count;
    switch (g.status) {
      case 'invalid':
        invalid += count;
        break;
      case 'dup_in_list':
        dupInList += count;
        valid += count;
        break;
      case 'dup_cross_list':
        dupCross += count;
        valid += count;
        break;
      case 'dup_with_crm':
        dupCrm += count;
        valid += count;
        break;
      case 'validated':
      case 'contact_created':
      case 'enriched':
        valid += count;
        break;
    }
    if (g.hasZalo === true) hasZalo += count;
    else if (g.hasZalo === false) noZalo += count;
    else if (g.status !== 'invalid') pendingLookup += count;
  }

  await prisma.customerList.update({
    where: { id: listId },
    data: {
      totalEntries: total,
      validEntries: valid,
      invalidEntries: invalid,
      dupInListEntries: dupInList,
      dupCrossListEntries: dupCross,
      dupWithContactEntries: dupCrm,
      hasZaloEntries: hasZalo,
      noZaloEntries: noZalo,
      pendingLookupEntries: pendingLookup,
      // Auto-promote status to 'done' khi không còn pending
      ...(pendingLookup === 0 && { status: 'done', endedAt: new Date() }),
    },
  });
}
