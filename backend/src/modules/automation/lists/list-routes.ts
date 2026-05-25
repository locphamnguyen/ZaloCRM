/**
 * automation/lists/list-routes.ts — CustomerList CRUD + archive + dry-run.
 *
 * Endpoints:
 *   GET    /api/v1/customer-lists                    — list all (filter status: active/archived/all)
 *   POST   /api/v1/customer-lists                    — create + parse + dedup + persist + kick off enrichment
 *   POST   /api/v1/customer-lists/dry-run            — parse only, return preview stats, NO persist
 *   GET    /api/v1/customer-lists/:id                — get 1 list with counters
 *   POST   /api/v1/customer-lists/:id/archive        — mark archived
 *   POST   /api/v1/customer-lists/:id/unarchive      — restore
 *   POST   /api/v1/customer-lists/:id/rescan-zalo    — trigger background enrichment lại
 *   DELETE /api/v1/customer-lists/:id                — hard delete (cascade entries, KHÔNG cascade Contact)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { parseAndDedup, parseRawText, detectInternalDup } from './list-import-service.js';
import { kickoffEnrichment } from './list-enrichment-service.js';
import { buildMessagesFromState, type SystemMessage } from './list-system-messages.js';
import { randomUUID } from 'node:crypto';

export async function customerListRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ─── GET /customer-lists — list all (filter active|archived|all) ───
  app.get<{ Querystring: { status?: string; page?: string; limit?: string; search?: string } }>(
    '/api/v1/customer-lists',
    async (request, reply) => {
      const user = request.user!;
      const { status = 'active', page = '1', limit = '20', search = '' } = request.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

      const where: any = { orgId: user.orgId };
      if (status === 'active') where.archivedAt = null;
      else if (status === 'archived') where.archivedAt = { not: null };
      // status === 'all' → no filter

      if (search.trim()) {
        where.name = { contains: search.trim(), mode: 'insensitive' };
      }

      try {
        const [lists, total] = await Promise.all([
          prisma.customerList.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
            select: {
              id: true,
              name: true,
              iconEmoji: true,
              sourceType: true,
              status: true,
              archivedAt: true,
              startedAt: true,
              endedAt: true,
              createdAt: true,
              createdById: true,
              totalEntries: true,
              validEntries: true,
              invalidEntries: true,
              dupInListEntries: true,
              dupCrossListEntries: true,
              dupWithContactEntries: true,
              hasZaloEntries: true,
              noZaloEntries: true,
              pendingLookupEntries: true,
            },
          }),
          prisma.customerList.count({ where }),
        ]);

        // Fetch creator info (join manual để giảm payload)
        const creatorIds = [...new Set(lists.map((l) => l.createdById))];
        const creators = await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, fullName: true, email: true },
        });
        const creatorMap = new Map(creators.map((c) => [c.id, c]));

        // Fetch FB source info for all lists in 2 queries (avoid N+1)
        const listIds = lists.map((l) => l.id);
        const [fbMappings, fbLeadStats] = await Promise.all([
          prisma.facebookFormMapping.findMany({
            where: { customerListId: { in: listIds }, enabled: true },
            select: {
              customerListId: true,
              formId: true,
              formName: true,
              pageConnection: { select: { pageName: true } },
            },
          }),
          prisma.facebookLeadEvent.groupBy({
            by: ['formId'],
            where: {
              formId: {
                in: await prisma.facebookFormMapping.findMany({
                  where: { customerListId: { in: listIds }, enabled: true },
                  select: { formId: true },
                }).then((rows) => rows.map((r) => r.formId)),
              },
              processedAt: { not: null },
            },
            _count: { id: true },
            _max: { createdAt: true },
          }),
        ]);

        // Build lookup: listId → fbSource
        const fbStatsByFormId = new Map(
          fbLeadStats.map((s) => [s.formId, { count: s._count.id, lastLeadAt: s._max.createdAt }]),
        );
        const fbSourceByListId = new Map<string, {
          formId: string;
          formName: string;
          pageName: string | null;
          lastLeadAt: Date | null;
          totalFbLeads: number;
        }>();
        for (const m of fbMappings) {
          // Use first enabled mapping per list (rare to have multiple forms → same list)
          if (!fbSourceByListId.has(m.customerListId)) {
            const stat = fbStatsByFormId.get(m.formId);
            fbSourceByListId.set(m.customerListId, {
              formId: m.formId,
              formName: m.formName,
              pageName: m.pageConnection?.pageName ?? null,
              lastLeadAt: stat?.lastLeadAt ?? null,
              totalFbLeads: stat?.count ?? 0,
            });
          }
        }

        return {
          lists: lists.map((l) => ({
            ...l,
            createdBy: creatorMap.get(l.createdById) ?? null,
            facebookSource: fbSourceByListId.get(l.id) ?? null,
          })),
          total,
          page: pageNum,
          limit: limitNum,
        };
      } catch (err) {
        logger.error({ err }, '[customer-lists] list failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );

  // ─── POST /customer-lists/dry-run — preview parse stats, NO persist ───
  // Body: { rawText } (paste path) HOẶC { rows: MappedRow[] } (CSV/Excel path)
  app.post<{
    Body: { rawText?: string; rows?: Array<{ phone: string; name?: string | null; personalNote?: string | null }> };
  }>(
    '/api/v1/customer-lists/dry-run',
    async (request, reply) => {
      const user = request.user!;
      const body = request.body ?? {};
      const input = body.rows && body.rows.length ? body.rows : (body.rawText ?? '');
      if (typeof input === 'string' ? !input.trim() : input.length === 0) {
        return reply.status(400).send({ error: 'rawText_or_rows_required' });
      }
      try {
        const { lines, internalDup, crossListDup, crmContactDup } = await parseAndDedup(
          input,
          user.orgId,
        );
        return {
          total: lines.length,
          valid: lines.filter((l) => l.valid).length,
          invalid: lines.filter((l) => !l.valid).length,
          dupInList: internalDup.size,
          dupCrossList: crossListDup.size,
          dupWithCrm: crmContactDup.size,
          sample: lines.slice(0, 10),
        };
      } catch (err) {
        logger.error({ err }, '[customer-lists] dry-run failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );

  // ─── POST /customer-lists — create + persist + async enrichment ───
  // Body: 1 trong 2 dạng:
  //   { name?, iconEmoji?, sourceType: 'paste', rawText }      ← paste path
  //   { name?, iconEmoji?, sourceType: 'csv'|'excel', rows[] } ← CSV/Excel column-mapped
  app.post<{
    Body: {
      name?: string;
      iconEmoji?: string;
      sourceType?: string;
      rawText?: string;
      rows?: Array<{ phone: string; name?: string | null; personalNote?: string | null }>;
    };
  }>('/api/v1/customer-lists', async (request, reply) => {
    const user = request.user!;
    const { name, iconEmoji, sourceType = 'paste', rawText, rows } = request.body ?? {};

    const hasRows = Array.isArray(rows) && rows.length > 0;
    const hasText = typeof rawText === 'string' && rawText.trim().length > 0;
    if (!hasRows && !hasText) {
      return reply.status(400).send({ error: 'rawText_or_rows_required' });
    }

    try {
      const parseInput = hasRows ? rows! : rawText!;
      const { lines, internalDup, crossListDup, crmContactDup } = await parseAndDedup(
        parseInput,
        user.orgId,
      );

      if (lines.length === 0) {
        return reply.status(400).send({ error: 'no_lines_parsed' });
      }

      // Auto-name: "Tệp {dd/MM HH:mm}"
      const finalName =
        name?.trim() ||
        `Tệp ${new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;

      // Compute counters before insert
      let valid = 0, invalid = 0;
      let dupInList = 0, dupCross = 0, dupCrm = 0;
      for (const line of lines) {
        if (!line.valid) { invalid++; continue; }
        valid++;
        if (internalDup.has(line.rowIndex)) dupInList++;
        else if (crossListDup.has(line.rowIndex)) dupCross++;
        else if (crmContactDup.has(line.rowIndex)) dupCrm++;
      }
      // Pending lookup = mọi entry valid (kể cả dup_*) vì advisory model — worker
      // enrich tất cả. dup_in_list cũng tính (số trùng vẫn cần biết có Zalo không
      // cho Campaign target picker).
      const pendingLookup = valid;

      // Single transaction: create list + insert all entries
      const list = await prisma.$transaction(async (tx) => {
        const created = await tx.customerList.create({
          data: {
            id: randomUUID(),
            orgId: user.orgId,
            createdById: user.id,
            name: finalName,
            iconEmoji: iconEmoji ?? null,
            sourceType,
            // rawText: cap 100KB. CSV/Excel path KHÔNG có raw paste, lưu JSON các mapped rows
            // để debug/re-import sau này.
            rawText: hasText
              ? rawText!.slice(0, 100_000)
              : JSON.stringify(rows ?? []).slice(0, 100_000),
            status: 'processing',
            totalEntries: lines.length,
            validEntries: valid,
            invalidEntries: invalid,
            dupInListEntries: dupInList,
            dupCrossListEntries: dupCross,
            dupWithContactEntries: dupCrm,
            pendingLookupEntries: pendingLookup,
            hasZaloEntries: 0,
            noZaloEntries: 0,
            startedAt: new Date(),
          },
        });

        // entries — use createMany cho perf (no FK validation overhead).
        // 2026-05-20: status mới chỉ còn lifecycle 2-state (validated | invalid),
        // dup_* moved sang dup_*_id fields + systemMessages JSON. Worker enrich
        // tất cả entries valid (kể cả có dup_*_id).
        const entryRows = lines.map((line) => {
          const status: string = line.valid ? 'validated' : 'invalid';
          let dupInListWithEntryId: string | null = null;
          let dupWithListId: string | null = null;
          let dupWithListEntryId: string | null = null;
          let dupWithContactId: string | null = null;
          let dupWithListName: string | null = null;

          if (line.valid) {
            const internalDupRowIdx = internalDup.get(line.rowIndex);
            if (internalDupRowIdx != null) {
              // dupInListWithEntryId resolve ở second pass (cùng batch chưa có ID)
            } else if (crossListDup.has(line.rowIndex)) {
              const ref = crossListDup.get(line.rowIndex)!;
              dupWithListId = ref.dupListId;
              dupWithListEntryId = ref.dupEntryId;
            } else if (crmContactDup.has(line.rowIndex)) {
              dupWithContactId = crmContactDup.get(line.rowIndex)!;
            }
          }

          // Build initial system messages từ dedup + invalid state
          const initialMsgs = buildMessagesFromState({
            invalidReason: line.invalidReason,
            dupInListWithEntryId,
            dupWithListId,
            dupWithListEntryId,
            dupWithListName,
            dupWithContactId,
          });
          // Mark internal dup placeholder — sẽ rewrite ở second pass với entryId thực
          if (line.valid && internalDup.get(line.rowIndex) != null) {
            initialMsgs.push({
              type: 'DUP_IN_LIST',
              text: 'Trùng dòng khác trong tệp này',
              payload: { rowIndex: internalDup.get(line.rowIndex) },
            });
          }
          const now = new Date().toISOString();
          const fullMsgs: SystemMessage[] = initialMsgs.map((m) => ({ ...m, ts: now }));

          return {
            id: randomUUID(),
            customerListId: created.id,
            rowIndex: line.rowIndex,
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
            systemMessages: fullMsgs as unknown as object,
          };
        });

        await tx.customerListEntry.createMany({ data: entryRows });

        // Second pass: resolve dupInListWithEntryId references (need ID of first-seen entry)
        // Build lookup: rowIndex → entryId
        if (internalDup.size > 0) {
          const created2 = await tx.customerListEntry.findMany({
            where: { customerListId: created.id, rowIndex: { in: lines.map((l) => l.rowIndex) } },
            select: { id: true, rowIndex: true },
          });
          const rowIdxToEntryId = new Map(created2.map((e) => [e.rowIndex, e.id]));
          for (const [dupRowIdx, firstRowIdx] of internalDup) {
            const dupEntryId = rowIdxToEntryId.get(dupRowIdx);
            const firstEntryId = rowIdxToEntryId.get(firstRowIdx);
            if (dupEntryId && firstEntryId) {
              await tx.customerListEntry.update({
                where: { id: dupEntryId },
                data: { dupInListWithEntryId: firstEntryId },
              });
            }
          }
        }

        return created;
      });

      // Kick off async enrichment (non-blocking)
      void kickoffEnrichment(list.id);

      return reply.status(201).send({ id: list.id, name: list.name, totalEntries: lines.length });
    } catch (err) {
      logger.error({ err }, '[customer-lists] create failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ─── GET /customer-lists/:id ───
  app.get<{ Params: { id: string } }>('/api/v1/customer-lists/:id', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    try {
      const list = await prisma.customerList.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!list) return reply.status(404).send({ error: 'not_found' });

      const creator = await prisma.user.findUnique({
        where: { id: list.createdById },
        select: { id: true, fullName: true, email: true },
      });
      return { ...list, createdBy: creator };
    } catch (err) {
      logger.error({ err, id }, '[customer-lists] get failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ─── PATCH /customer-lists/:id — rename / update icon ───
  app.patch<{
    Params: { id: string };
    Body: { name?: string; iconEmoji?: string | null };
  }>('/api/v1/customer-lists/:id', async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    const { name, iconEmoji } = request.body ?? {};

    const data: { name?: string; iconEmoji?: string | null } = {};
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return reply.status(400).send({ error: 'name_empty' });
      if (trimmed.length > 200) return reply.status(400).send({ error: 'name_too_long' });
      data.name = trimmed;
    }
    if (iconEmoji !== undefined) data.iconEmoji = iconEmoji || null;
    if (Object.keys(data).length === 0) return reply.status(400).send({ error: 'no_fields' });

    try {
      // Block rename for auto-managed lists (source_type in api/webhook)
      if (data.name !== undefined) {
        const existingList = await prisma.customerList.findFirst({
          where: { id, orgId: user.orgId },
          select: { sourceType: true },
        });
        if (existingList && ['api', 'webhook'].includes(existingList.sourceType)) {
          return reply.status(403).send({
            error: 'CANNOT_RENAME_AUTO_MANAGED',
            message: 'Tệp này được liên kết tự động từ Facebook (hoặc nền tảng khác). Không thể đổi tên.',
          });
        }
      }

      const updated = await prisma.customerList.updateMany({
        where: { id, orgId: user.orgId },
        data,
      });
      if (updated.count === 0) return reply.status(404).send({ error: 'not_found' });
      return { ok: true };
    } catch (err) {
      logger.error({ err, id }, '[customer-lists] patch failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ─── POST /customer-lists/:id/archive ───
  app.post<{ Params: { id: string } }>(
    '/api/v1/customer-lists/:id/archive',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      try {
        const updated = await prisma.customerList.updateMany({
          where: { id, orgId: user.orgId, archivedAt: null },
          data: { archivedAt: new Date(), status: 'archived' },
        });
        if (updated.count === 0) return reply.status(404).send({ error: 'not_found_or_already_archived' });
        return { ok: true };
      } catch (err) {
        logger.error({ err, id }, '[customer-lists] archive failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );

  // ─── POST /customer-lists/:id/unarchive ───
  app.post<{ Params: { id: string } }>(
    '/api/v1/customer-lists/:id/unarchive',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      try {
        const updated = await prisma.customerList.updateMany({
          where: { id, orgId: user.orgId, archivedAt: { not: null } },
          data: { archivedAt: null, status: 'done' },
        });
        if (updated.count === 0) return reply.status(404).send({ error: 'not_found_or_not_archived' });
        return { ok: true };
      } catch (err) {
        logger.error({ err, id }, '[customer-lists] unarchive failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );

  // ─── POST /customer-lists/:id/rescan-zalo ───
  app.post<{ Params: { id: string } }>(
    '/api/v1/customer-lists/:id/rescan-zalo',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      try {
        const list = await prisma.customerList.findFirst({
          where: { id, orgId: user.orgId },
          select: { id: true },
        });
        if (!list) return reply.status(404).send({ error: 'not_found' });

        // Reset hasZalo=null cho entries valid không phải invalid/skipped → worker
        // enrich lại. 2026-05-20 advisory model: dup_* entries vẫn được enrich
        // (dup chỉ là system message, không terminal).
        await prisma.customerListEntry.updateMany({
          where: {
            customerListId: id,
            phoneValid: true,
            status: { notIn: ['skipped', 'invalid'] },
          },
          data: { hasZalo: null, status: 'validated', enrichedAt: null },
        });
        await prisma.customerList.update({
          where: { id },
          data: {
            hasZaloEntries: 0,
            noZaloEntries: 0,
            pendingLookupEntries: list.id ? undefined : undefined, // recompute below
          },
        });
        // Recompute pendingLookup
        const pending = await prisma.customerListEntry.count({
          where: { customerListId: id, phoneValid: true },
        });
        await prisma.customerList.update({
          where: { id },
          data: { pendingLookupEntries: pending, status: 'processing' },
        });

        void kickoffEnrichment(id);
        return { ok: true, pendingLookup: pending };
      } catch (err) {
        logger.error({ err, id }, '[customer-lists] rescan failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );

  // ─── DELETE /customer-lists/:id ───
  app.delete<{ Params: { id: string } }>(
    '/api/v1/customer-lists/:id',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      try {
        const deleted = await prisma.customerList.deleteMany({
          where: { id, orgId: user.orgId },
        });
        if (deleted.count === 0) return reply.status(404).send({ error: 'not_found' });
        return reply.status(204).send();
      } catch (err) {
        logger.error({ err, id }, '[customer-lists] delete failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );
}
