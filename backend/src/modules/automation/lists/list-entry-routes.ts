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
import {
  appendSystemMessage,
  buildMessagesFromState,
  replaceSystemMessages,
  type SystemMessage,
} from './list-system-messages.js';
import { randomUUID } from 'node:crypto';
import { getOwnerScope, applyOwnerScope } from '../../rbac/owner-scope.js';
import { onPhoneUidResolved } from './list-event-handlers.js';
import { zaloOps } from '../../../shared/zalo-operations.js';

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

    // Phase Marketing Scope 2026-05-27: scope list theo owner trước khi tải entries
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'customer_list',
    });
    const lWhere: any = { id, orgId: user.orgId };
    Object.assign(lWhere, applyOwnerScope(ownerScope));
    const list = await prisma.customerList.findFirst({
      where: lWhere,
      select: { id: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const where: any = { customerListId: id };

    // Tab filter — 2026-05-20 refactor: dup filter dùng dup_*_id fields (KHÔNG
    // còn status='dup_*'). Advisory model: entries trùng vẫn được enrich.
    if (tab === 'valid') {
      where.phoneValid = true;
    } else if (tab === 'invalid') {
      where.status = 'invalid';
    } else if (tab === 'dup') {
      where.OR = [
        { dupInListWithEntryId: { not: null } },
        { dupWithListId: { not: null } },
        { dupWithContactId: { not: null } },
      ];
    } else if (tab === 'dup_in_list') {
      where.dupInListWithEntryId = { not: null };
    } else if (tab === 'dup_cross_list') {
      where.dupWithListId = { not: null };
    } else if (tab === 'dup_with_crm') {
      where.dupWithContactId = { not: null };
    } else if (tab === 'has_zalo') {
      where.hasZalo = true;
    } else if (tab === 'no_zalo') {
      // "Đang chờ Quét" tab = đã check Friend (status='enriched') nhưng hasZalo=null.
      // Tab name vẫn 'no_zalo' để compat URL, UI label đã đổi "Đang chờ Quét".
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

    const _ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'customer_list',
    });
    const _lWhere: any = { id, orgId: user.orgId };
    Object.assign(_lWhere, applyOwnerScope(_ownerScope));
    const list = await prisma.customerList.findFirst({
      where: _lWhere,
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
          // Append SKIPPED_BY_SALE message cho mỗi entry
          await Promise.all(entryIds.map((eid) =>
            appendSystemMessage(eid, { type: 'SKIPPED_BY_SALE', text: 'Sale loại' })
          ));
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
      let rebuildMessages = false;
      let rebuiltMessages: Omit<SystemMessage, 'ts'>[] = [];
      if (typeof phoneRaw === 'string' && phoneRaw !== existing.phoneRaw) {
        const re = await revalidatePhone(phoneRaw, list.orgId, id, entryId);
        data.phoneRaw = phoneRaw.slice(0, 500);
        data.phoneE164 = re.parsed.phoneE164;
        data.phoneLocal = re.parsed.phoneLocal;
        data.phoneValid = re.parsed.valid;
        data.invalidReason = re.parsed.invalidReason;
        // 2026-05-20: status mới chỉ 'validated' | 'invalid' (dup moved sang fields + messages)
        data.status = re.parsed.valid ? 'validated' : 'invalid';
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
        conflictWarn = !!(re.dupWithListId || re.dupInListWithEntryId || re.dupWithContactId) || !re.parsed.valid;

        // Rebuild system messages: clear stack cũ, add PHONE_EDITED + dup/invalid mới
        rebuildMessages = true;
        rebuiltMessages = [
          { type: 'PHONE_EDITED', text: `Sale chỉnh số (từ ${existing.phoneRaw} → ${phoneRaw.slice(0, 50)})` },
          ...buildMessagesFromState({
            invalidReason: re.parsed.invalidReason,
            dupInListWithEntryId: re.dupInListWithEntryId,
            dupWithListId: re.dupWithListId,
            dupWithListEntryId: re.dupWithListEntryId,
            dupWithListName: re.dupWithListName,
            dupWithContactId: re.dupWithContactId,
          }),
        ];
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

      // Rewrite system messages stack (clear cũ, add mới)
      if (rebuildMessages) {
        await replaceSystemMessages(entryId, rebuiltMessages);
      }

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

      // Fetch dup list names cho cross-list messages
      const dupListIds = [...new Set(
        Array.from(crossListDup.values()).map((v) => v.dupListId)
      )];
      const dupListNameMap = new Map<string, string>();
      if (dupListIds.length > 0) {
        const lists = await prisma.customerList.findMany({
          where: { id: { in: dupListIds } },
          select: { id: true, name: true },
        });
        for (const l of lists) dupListNameMap.set(l.id, l.name);
      }

      const rowsToInsert: Array<Record<string, unknown>> = [];
      for (const line of lines) {
        const status: string = line.valid ? 'validated' : 'invalid';
        let dupInListWithEntryId: string | null = null;
        let dupWithListId: string | null = null;
        let dupWithListEntryId: string | null = null;
        let dupWithContactId: string | null = null;
        let dupWithListName: string | null = null;

        if (line.valid && line.phoneE164) {
          const sameList = existingByPhone.get(line.phoneE164);
          if (sameList) {
            dupInListWithEntryId = sameList;
          } else if (internalDup.has(line.rowIndex)) {
            // resolve trong second pass
          } else if (crossListDup.has(line.rowIndex)) {
            const ref = crossListDup.get(line.rowIndex)!;
            dupWithListId = ref.dupListId;
            dupWithListEntryId = ref.dupEntryId;
            dupWithListName = dupListNameMap.get(ref.dupListId) ?? null;
          } else if (crmContactDup.has(line.rowIndex)) {
            dupWithContactId = crmContactDup.get(line.rowIndex)!;
          }
        }

        const initialMsgs = buildMessagesFromState({
          invalidReason: line.invalidReason,
          dupInListWithEntryId,
          dupWithListId,
          dupWithListEntryId,
          dupWithListName,
          dupWithContactId,
        });
        if (line.valid && internalDup.get(line.rowIndex) != null) {
          initialMsgs.push({
            type: 'DUP_IN_LIST',
            text: 'Trùng dòng khác trong tệp này',
            payload: { rowIndex: internalDup.get(line.rowIndex) },
          });
        }
        const now = new Date().toISOString();
        const fullMsgs: SystemMessage[] = initialMsgs.map((m) => ({ ...m, ts: now }));

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
          // Wave 1.5-B (B5 fix): link entry.contactId ngay khi import phát hiện dup_with_crm.
          // Tránh downstream nick-worker re-resolve qua phone (có thể tạo stub tách rời Contact cha).
          contactId: dupWithContactId,
          hasZalo: null,
          multiNickCount: 0,
          systemMessages: fullMsgs,
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

  // ─── POST /customer-lists/:id/entries/:entryId/find-zalo ───
  // Phase 2026-05-30 — Sale bấm "Tìm Zalo" thủ công cho 1 lead bằng nick chọn từ popup.
  // HỢP LỆ (thủ công 1 KH/1 click, KHÔNG vi phạm cấm auto-quét). Tìm ra → update entry
  // qua onPhoneUidResolved. Không ra → đánh dấu hasZalo=false (anh chốt 2026-05-30).
  app.post<{ Params: { id: string; entryId: string }; Body: { zaloAccountId?: string } }>(
    '/api/v1/customer-lists/:id/entries/:entryId/find-zalo',
    async (request, reply) => {
      const user = request.user!;
      const { id, entryId } = request.params;
      const { zaloAccountId } = request.body ?? {};
      if (!zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId required' });

      const entry = await prisma.customerListEntry.findFirst({
        where: { id: entryId, customerListId: id, customerList: { orgId: user.orgId } },
        select: { id: true, phoneE164: true, phoneRaw: true, phoneValid: true },
      });
      if (!entry) return reply.status(404).send({ error: 'entry_not_found' });
      if (!entry.phoneValid || !entry.phoneE164) {
        return reply.status(400).send({ error: 'phone_invalid', detail: 'SĐT chưa hợp lệ, sửa số trước khi tìm Zalo' });
      }

      // Check quyền nick: nick phải thuộc org user (zaloOps.findUser tự verify connect)
      const nick = await prisma.zaloAccount.findFirst({
        where: { id: zaloAccountId, orgId: user.orgId },
        select: { id: true },
      });
      if (!nick) return reply.status(403).send({ error: 'nick_not_allowed', detail: 'Bạn không có quyền dùng nick này' });

      const phone = entry.phoneE164.replace(/[^\d]/g, ''); // "84xxx"
      try {
        const result = await zaloOps.findUser(zaloAccountId, phone);
        const u = (result as Record<string, unknown>) || {};
        const uid = String(u.uid || u.userId || '') || null;

        if (!uid) {
          // Không ra Zalo → đánh dấu hasZalo=false (anh chốt). Chỉ entry này + status.
          await prisma.customerListEntry.updateMany({
            where: { id: entryId, customerListId: id },
            data: { hasZalo: false, status: 'enriched', enrichedAt: new Date() },
          });
          await recomputeListCounters(id);
          return reply.send({ found: false, reason: 'no_zalo', detail: 'SĐT này không có Zalo' });
        }

        // Tìm ra → update tất cả entry cùng SĐT qua handler có sẵn (idempotent)
        await onPhoneUidResolved({
          orgId: user.orgId,
          phoneNormalized: phone,
          zaloUidInNick: uid,
          zaloAccountId,
          zaloGlobalId: String(u.globalId || '') || null,
          zaloDisplayName: String(u.zaloName || u.displayName || u.display_name || '') || null,
        });
        return reply.send({
          found: true,
          uid,
          zaloName: String(u.zaloName || u.displayName || '') || null,
          avatar: String(u.avatar || '') || null,
        });
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e?.code === 'NOT_CONNECTED' || e?.code === 'RATE_LIMITED') {
          const isNotConnected = e.code === 'NOT_CONNECTED';
          return reply.status(503).send({
            error: e.code,
            detail: isNotConnected
              ? 'Nick Zalo chưa kết nối. Vào "Quản lý nick" kết nối lại.'
              : 'Đã đạt giới hạn tra cứu Zalo, thử lại sau vài phút.',
            userFriendly: isNotConnected ? 'Nick Zalo chưa kết nối' : 'Đã đạt giới hạn tra cứu Zalo',
          });
        }
        // Lỗi khác = coi như không tìm thấy
        logger.warn({ err, entryId, zaloAccountId }, '[find-zalo] lookup failed');
        return reply.send({ found: false, reason: 'lookup_failed', detail: String(e?.message || err) });
      }
    },
  );

  // ─── GET /customer-list-entries/:entryId/lead-detail ───
  // Phase Multi-Source Lead Ads Phase 2 2026-05-27 — full Lead detail panel.
  // Trả về entry + list + webhookLog (timing) + campaignStats. Adaptive: section
  // nào không có data → frontend skip render (LeadDetailPanel v-if).
  app.get<{ Params: { entryId: string } }>(
    '/api/v1/customer-list-entries/:entryId/lead-detail',
    async (request, reply) => {
      const user = request.user!;
      const { entryId } = request.params;
      try {
        const entry = await prisma.customerListEntry.findUnique({
          where: { id: entryId },
          include: { customerList: { select: { id: true, orgId: true, name: true, integrationKey: true, sourceType: true } } },
        });
        if (!entry || entry.customerList.orgId !== user.orgId) {
          return reply.status(404).send({ error: 'entry_not_found' });
        }

        // sourceMeta.externalLeadId → join WebhookLog cho timing
        const externalLeadId =
          entry.sourceMeta && typeof entry.sourceMeta === 'object'
            ? ((entry.sourceMeta as Record<string, unknown>).externalLeadId as string | undefined)
            : undefined;

        const webhookLog = externalLeadId
          ? await prisma.webhookLog.findUnique({
              where: { externalLeadId },
              select: {
                id: true,
                source: true,
                status: true,
                attempts: true,
                signature: true,
                processingSteps: true,
                createdAt: true,
                processedAt: true,
                errorMessage: true,
              },
            })
          : null;

        // Campaign stats: bao nhiêu lead khác cùng campaignId vào CRM. JSON match
        // dùng raw SQL (Prisma Json @> filter giới hạn).
        const campaignId =
          entry.sourceMeta && typeof entry.sourceMeta === 'object'
            ? ((entry.sourceMeta as Record<string, unknown>).campaignId as string | undefined)
            : undefined;

        let campaignStats: { totalLeads: number; routedLeads: number; unroutedLeads: number } | null = null;
        if (campaignId) {
          const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count
             FROM customer_list_entries
             WHERE source_meta->>'campaignId' = $1`,
            campaignId,
          );
          const total = Number(rows[0]?.count ?? 0n);
          // routed = entry trong list có integrationKey không phải __UNROUTED__
          const routedRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count
             FROM customer_list_entries e
             JOIN customer_lists l ON l.id = e.customer_list_id
             WHERE e.source_meta->>'campaignId' = $1
               AND l.integration_key IS NOT NULL
               AND l.integration_key <> '__UNROUTED__'`,
            campaignId,
          );
          const routed = Number(routedRows[0]?.count ?? 0n);
          campaignStats = { totalLeads: total, routedLeads: routed, unroutedLeads: total - routed };
        }

        return {
          entry: {
            id: entry.id,
            rowIndex: entry.rowIndex,
            phoneRaw: entry.phoneRaw,
            nameRaw: entry.nameRaw,
            phoneE164: entry.phoneE164,
            phoneLocal: entry.phoneLocal,
            phoneValid: entry.phoneValid,
            personalNote: entry.personalNote,
            customFields: entry.customFields,
            sourceMeta: entry.sourceMeta,
            status: entry.status,
            hasZalo: entry.hasZalo,
            zaloUid: entry.zaloUid,
            zaloName: entry.zaloName,
            zaloGlobalId: entry.zaloGlobalId,
            resolvedByNickId: entry.resolvedByNickId,
            contactId: entry.contactId,
            createdAt: entry.createdAt,
            enrichedAt: entry.enrichedAt,
          },
          list: entry.customerList,
          webhookLog,
          campaignStats,
        };
      } catch (err) {
        logger.error({ err, entryId }, '[list-entries] lead-detail failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    },
  );
}

/**
 * Recompute counters on parent CustomerList from current entry states.
 *
 * 2026-05-20 refactor: dup_* không còn ở `status`. Counters đọc từ dup_*_id
 * fields (advisory model — entries dup vẫn được worker enrich).
 *   - dup_in_list_entries  = COUNT WHERE dup_in_list_with_entry_id IS NOT NULL
 *   - dup_cross_list_entries = COUNT WHERE dup_with_list_id IS NOT NULL
 *   - dup_with_contact_entries = COUNT WHERE dup_with_contact_id IS NOT NULL
 *   - has_zalo_entries / no_zalo_entries = COUNT BY has_zalo flag
 *   - pending_lookup = COUNT WHERE status='validated' (worker chưa xử lý)
 *
 * Lưu ý: dup counters đếm theo dup_*_id fields độc lập — 1 entry có thể đồng thời
 * trùng list + trùng CRM (cả 2 fields set) → count vào cả 2.
 */
export async function recomputeListCounters(listId: string): Promise<void> {
  const [counts, grouped] = await Promise.all([
    // Aggregate counters đọc trực tiếp từ DB
    prisma.customerListEntry.aggregate({
      where: { customerListId: listId },
      _count: { _all: true },
    }),
    // Group by status để separate counters
    prisma.customerListEntry.groupBy({
      by: ['status', 'hasZalo'],
      where: { customerListId: listId },
      _count: true,
    }),
  ]);

  const total = counts._count._all;

  const [dupInList, dupCross, dupCrm, valid] = await Promise.all([
    prisma.customerListEntry.count({
      where: { customerListId: listId, dupInListWithEntryId: { not: null } },
    }),
    prisma.customerListEntry.count({
      where: { customerListId: listId, dupWithListId: { not: null } },
    }),
    prisma.customerListEntry.count({
      where: { customerListId: listId, dupWithContactId: { not: null } },
    }),
    prisma.customerListEntry.count({
      where: { customerListId: listId, phoneValid: true },
    }),
  ]);

  let invalid = 0,
    hasZalo = 0,
    noZalo = 0,
    pendingLookup = 0;

  for (const g of grouped) {
    const count = g._count;
    if (g.status === 'invalid') invalid += count;
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
