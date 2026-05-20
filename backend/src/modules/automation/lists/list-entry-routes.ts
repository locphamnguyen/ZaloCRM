/**
 * automation/lists/list-entry-routes.ts — Entries query + bulk action + CRUD.
 *
 * Endpoints:
 *   GET    /api/v1/customer-lists/:id/entries           — paginated entries with tab filter
 *   POST   /api/v1/customer-lists/:id/entries           — append entries (single line or bulk paste)
 *   POST   /api/v1/customer-lists/:id/entries/bulk      — bulk resolve dup (skip/overwrite/keep)
 *   PATCH  /api/v1/customer-lists/:id/entries/:entryId  — edit phoneRaw/nameRaw/personalNote
 *   DELETE /api/v1/customer-lists/:id/entries/:entryId  — delete 1 entry
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { revalidatePhone, parseAndDedup } from './list-import-service.js';
import { kickoffEnrichment } from './list-enrichment-service.js';
import { randomUUID } from 'node:crypto';

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
      // v1 semantic: "Chưa quét SDK" = đã check Friend (status='enriched') nhưng
      // không match (hasZalo=null). Tab name vẫn 'no_zalo' để compat URL, UI label
      // hiển thị "Chưa quét SDK".
      where.hasZalo = null;
      where.status = 'enriched';
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

  // ─── PATCH /customer-lists/:id/entries/:entryId — edit + re-validate + re-dedup ───
  // Cells editable: phoneRaw (re-parse + re-dedup + reset enrichment), nameRaw, personalNote.
  // Cột phoneE164/phoneLocal auto-derive — KHÔNG cho client gửi.
  app.patch<{
    Params: { id: string; entryId: string };
    Body: { phoneRaw?: string; nameRaw?: string | null; personalNote?: string | null };
  }>('/api/v1/customer-lists/:id/entries/:entryId', async (request, reply) => {
    const user = request.user!;
    const { id, entryId } = request.params;
    const { phoneRaw, nameRaw, personalNote } = request.body ?? {};

    const list = await prisma.customerList.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, orgId: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    const existing = await prisma.customerListEntry.findFirst({
      where: { id: entryId, customerListId: id },
    });
    if (!existing) return reply.status(404).send({ error: 'entry_not_found' });

    try {
      const data: Record<string, unknown> = {};
      let dupWithListName: string | null = null;
      let conflictWarn = false;

      // ── phoneRaw edit: re-parse + re-dedup + reset enrichment ──
      if (typeof phoneRaw === 'string' && phoneRaw !== existing.phoneRaw) {
        const re = await revalidatePhone(phoneRaw, list.orgId, id, entryId);
        data.phoneRaw = phoneRaw.slice(0, 500);
        data.phoneE164 = re.parsed.phoneE164;
        data.phoneLocal = re.parsed.phoneLocal;
        data.phoneValid = re.parsed.valid;
        data.invalidReason = re.parsed.invalidReason;
        data.status = re.status;
        data.dupInListWithEntryId = re.dupInListWithEntryId;
        data.dupWithListId = re.dupWithListId;
        data.dupWithListEntryId = re.dupWithListEntryId;
        data.dupWithContactId = re.dupWithContactId;
        // Reset enrichment — số mới chưa biết Zalo gì
        data.hasZalo = null;
        data.zaloUid = null;
        data.zaloGlobalId = null;
        data.zaloName = null;
        data.resolvedByNickId = null;
        data.multiNickCount = 0;
        data.enrichedAt = null;
        data.contactId = null;
        dupWithListName = re.dupWithListName;
        conflictWarn = re.status.startsWith('dup_') || re.status === 'invalid';
      }

      if (nameRaw !== undefined) {
        data.nameRaw = nameRaw ? String(nameRaw).slice(0, 200) : null;
      }
      if (personalNote !== undefined) {
        data.personalNote = personalNote ? String(personalNote).slice(0, 2000) : null;
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'no_fields' });
      }

      const updated = await prisma.customerListEntry.update({
        where: { id: entryId },
        data,
      });

      // Recompute counters + re-kick enrichment nếu phone đổi
      await recomputeListCounters(id);
      if ('phoneRaw' in data && updated.phoneValid && updated.status === 'validated') {
        void kickoffEnrichment(id);
      }

      return {
        entry: updated,
        conflictWarn,
        dupWithListName,
      };
    } catch (err) {
      logger.error({ err, id, entryId }, '[list-entries] patch failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ─── POST /customer-lists/:id/entries — append entries (single or bulk paste) ───
  // Body: { rawText } — sale paste 1 hoặc nhiều dòng vào ô "Thêm SĐT".
  //   - Mỗi dòng được parse + dedup tương tự create-list path.
  //   - rowIndex tiếp theo MAX(rowIndex) + 1.
  //   - Enrichment kick off async.
  app.post<{
    Params: { id: string };
    Body: { rawText: string };
  }>('/api/v1/customer-lists/:id/entries', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    const { rawText } = request.body ?? { rawText: '' };

    if (!rawText?.trim()) {
      return reply.status(400).send({ error: 'rawText_required' });
    }

    const list = await prisma.customerList.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, orgId: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    try {
      const { lines, internalDup, crossListDup, crmContactDup } = await parseAndDedup(
        rawText,
        list.orgId,
      );
      if (lines.length === 0) {
        return reply.status(400).send({ error: 'no_lines_parsed' });
      }

      // Find next rowIndex
      const lastRow = await prisma.customerListEntry.findFirst({
        where: { customerListId: id },
        select: { rowIndex: true },
        orderBy: { rowIndex: 'desc' },
      });
      const baseIdx = (lastRow?.rowIndex ?? 0);

      // Cũng phải check dup với entries hiện có trong CHÍNH list này (parseAndDedup
      // chỉ check internal-batch + cross-list). Build map phoneE164 → existingEntryId.
      const validPhones = lines.filter((l) => l.valid && l.phoneE164).map((l) => l.phoneE164!);
      const existingInList = validPhones.length
        ? await prisma.customerListEntry.findMany({
            where: { customerListId: id, phoneE164: { in: validPhones } },
            select: { id: true, phoneE164: true },
            orderBy: { createdAt: 'asc' },
          })
        : [];
      const existingByPhone = new Map<string, string>();
      for (const e of existingInList) {
        if (e.phoneE164 && !existingByPhone.has(e.phoneE164)) {
          existingByPhone.set(e.phoneE164, e.id);
        }
      }

      const rowsToInsert: Array<Record<string, unknown>> = [];
      for (const line of lines) {
        let status: string = line.valid ? 'validated' : 'invalid';
        let dupInListWithEntryId: string | null = null;
        let dupWithListId: string | null = null;
        let dupWithListEntryId: string | null = null;
        let dupWithContactId: string | null = null;

        if (line.valid && line.phoneE164) {
          // Dup with existing in-list entry (ưu tiên cao nhất)
          const sameList = existingByPhone.get(line.phoneE164);
          if (sameList) {
            status = 'dup_in_list';
            dupInListWithEntryId = sameList;
          } else if (internalDup.has(line.rowIndex)) {
            status = 'dup_in_list';
            // resolve trong second pass
          } else if (crossListDup.has(line.rowIndex)) {
            status = 'dup_cross_list';
            const ref = crossListDup.get(line.rowIndex)!;
            dupWithListId = ref.dupListId;
            dupWithListEntryId = ref.dupEntryId;
          } else if (crmContactDup.has(line.rowIndex)) {
            status = 'dup_with_crm';
            dupWithContactId = crmContactDup.get(line.rowIndex)!;
          }
        }

        rowsToInsert.push({
          id: randomUUID(),
          customerListId: id,
          rowIndex: baseIdx + line.rowIndex,
          phoneRaw: line.phoneRaw.slice(0, 500),
          nameRaw: line.nameRaw,
          personalNote: line.personalNote ? line.personalNote.slice(0, 2000) : null,
          phoneE164: line.phoneE164,
          phoneLocal: line.phoneLocal,
          phoneValid: line.valid,
          invalidReason: line.invalidReason,
          status,
          dupInListWithEntryId,
          dupWithListId,
          dupWithListEntryId,
          dupWithContactId,
          hasZalo: null,
          multiNickCount: 0,
        });
      }

      await prisma.customerListEntry.createMany({ data: rowsToInsert as never });

      // Resolve internal dup references — cùng batch
      if (internalDup.size > 0) {
        const created = await prisma.customerListEntry.findMany({
          where: { customerListId: id, rowIndex: { in: rowsToInsert.map((r) => r.rowIndex as number) } },
          select: { id: true, rowIndex: true },
        });
        const rowIdxToEntryId = new Map(created.map((e) => [e.rowIndex, e.id]));
        for (const [dupRowIdx, firstRowIdx] of internalDup) {
          const dupEntryId = rowIdxToEntryId.get(baseIdx + dupRowIdx);
          const firstEntryId = rowIdxToEntryId.get(baseIdx + firstRowIdx);
          if (dupEntryId && firstEntryId) {
            await prisma.customerListEntry.update({
              where: { id: dupEntryId },
              data: { dupInListWithEntryId: firstEntryId },
            });
          }
        }
      }

      await recomputeListCounters(id);
      void kickoffEnrichment(id);

      return reply.status(201).send({
        ok: true,
        added: rowsToInsert.length,
        valid: lines.filter((l) => l.valid).length,
        invalid: lines.filter((l) => !l.valid).length,
      });
    } catch (err) {
      logger.error({ err, id }, '[list-entries] add failed');
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
    // hasZalo counter semantic:
    //   true  → đã CONFIRM có Zalo (match Friend HOẶC SDK lookup trả OK)
    //   false → CHỈ Phase 7 Campaign SDK confirm "phone này không có Zalo"
    //   null  → chưa biết / chưa quét SDK (kể cả status='enriched' đã check Friend)
    if (g.hasZalo === true) hasZalo += count;
    else if (g.hasZalo === false) noZalo += count;
    // Pending = entries chưa được worker visit Friend table (status='validated').
    // Entries hasZalo=null + status='enriched' nghĩa là worker đã check Friend xong
    // nhưng KHÔNG match — cần Campaign SDK scan để biết chắc → KHÔNG count vào pending.
    // → List auto-promote done sau khi worker xử lý xong tất cả entry.
    if (g.status === 'validated') pendingLookup += count;
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
