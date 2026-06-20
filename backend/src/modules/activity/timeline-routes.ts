// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * timeline-routes.ts — Compact timeline + full activity log endpoints.
 *
 * 3 endpoints:
 *  1. GET /customers/:id/timeline — compact view (Notes + Activity unified) cho
 *     panel Ghi chú ở cột 4. Cursor pagination, filter categories.
 *  2. GET /customers/:id/activity-log — full filter cho activity log page.
 *     Categories, actors, date range, search trong details JSON.
 *  3. GET /timeline/export — CSV export với range custom.
 *
 * Cursor pagination dùng `createdAt` ISO string (immutable, monotonic).
 * UNION giữa Notes + ActivityLog ở JS layer (over-fetch limit*2 từ mỗi table
 * → merge sort → slice limit). Acceptable performance với composite indexes
 * đã có ở PR1 (entityType+entityId+createdAt DESC).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { assertContactVisible } from '../contacts/contact-scope.js';

type TimelineItem =
  | { type: 'note'; createdAt: Date; data: unknown }
  | { type: 'activity'; createdAt: Date; data: unknown };

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/customers/:id/timeline — compact unified stream ─────────
  //   Query: cursor (ISO date), limit, categories (csv: note|customer_info|...)
  app.get('/api/v1/customers/:id/timeline', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { cursor?: string; limit?: string; categories?: string };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: contactId } = request.params;

      // Phase Contact Scope Hybrid 2026-05-27: scope gate
      const visible = await assertContactVisible({
        userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId,
      });
      if (!visible) return reply.status(404).send({ error: 'Contact not found' });
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId: user.orgId },
        select: { id: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const limit = Math.min(parseInt(request.query.limit || '50') || 50, 200);
      const cursorDate = request.query.cursor ? new Date(request.query.cursor) : null;
      if (cursorDate && Number.isNaN(cursorDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid cursor' });
      }

      const categoriesArr = request.query.categories
        ? request.query.categories.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      const includeNotes = !categoriesArr || categoriesArr.includes('note');
      const activityCategoriesFilter = categoriesArr
        ? categoriesArr.filter(c => c !== 'note')
        : null;
      // Tab matrix (categoriesArr → behavior):
      //   null (no param)            → notes + all activities (default xem mọi thứ)
      //   ['note']                   → notes ONLY (tab "Ghi chú")
      //   ['customer_info', ...]     → activities ONLY (tab "Hoạt động", filter category)
      //   ['note', 'customer_info']  → notes + filtered activities (tab "Tất cả")
      //
      // Activity query SKIP nếu user chỉ muốn 'note' (categoriesArr === ['note']):
      //   fetchActivities = không có filter (null) HOẶC có activity category nào đó.
      const fetchActivities =
        !categoriesArr || (activityCategoriesFilter !== null && activityCategoriesFilter.length > 0);

      // Over-fetch để handle merge interleaving (lưu ý: edge case mất pagination
      // nếu 1 table có quá nhiều rows trước cursor → next cursor có thể skip)
      const overfetch = limit * 2;

      const cursorWhere = cursorDate ? { createdAt: { lt: cursorDate } } : {};

      const [notes, activities] = await Promise.all([
        includeNotes
          ? prisma.note.findMany({
              where: {
                orgId: user.orgId,
                contactId,
                parentNoteId: null,
                ...cursorWhere,
              },
              include: {
                author: { select: { id: true, fullName: true, email: true } },
                reactions: {
                  select: { emoji: true, userId: true, user: { select: { fullName: true } } },
                },
                replies: {
                  include: { author: { select: { id: true, fullName: true } } },
                  orderBy: { createdAt: 'asc' },
                },
                appointment: { select: { id: true, appointmentDate: true, status: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: overfetch,
            })
          : Promise.resolve([]),
        fetchActivities
          ? prisma.activityLog.findMany({
              where: {
                orgId: user.orgId,
                entityType: 'contact',
                entityId: contactId,
                ...(activityCategoriesFilter && activityCategoriesFilter.length
                  ? { category: { in: activityCategoriesFilter } }
                  : {}),
                ...cursorWhere,
              },
              include: {
                user: { select: { id: true, fullName: true, email: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: overfetch,
            })
          : Promise.resolve([]),
      ]);

      // Merge sort DESC by createdAt
      const merged: TimelineItem[] = [
        ...notes.map(n => ({ type: 'note' as const, createdAt: n.createdAt, data: n })),
        ...activities.map(a => ({ type: 'activity' as const, createdAt: a.createdAt, data: a })),
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);

      const nextCursor = merged.length === limit
        ? merged[merged.length - 1].createdAt.toISOString()
        : null;

      return { items: merged, nextCursor };
    } catch (err) {
      logger.error('[timeline] Compact error:', err);
      return reply.status(500).send({ error: 'Failed to load timeline' });
    }
  });

  // ── GET /api/v1/customers/:id/activity-log — full filter page ───────────
  //   Query: cursor, limit, categories, actors, from, to, search
  app.get('/api/v1/customers/:id/activity-log', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: {
      cursor?: string; limit?: string;
      categories?: string; actors?: string;
      from?: string; to?: string; search?: string;
    };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: contactId } = request.params;

      // Phase Contact Scope Hybrid 2026-05-27: scope gate
      const visible = await assertContactVisible({
        userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId,
      });
      if (!visible) return reply.status(404).send({ error: 'Contact not found' });
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId: user.orgId },
        select: { id: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const limit = Math.min(parseInt(request.query.limit || '100') || 100, 500);
      const cursorDate = request.query.cursor ? new Date(request.query.cursor) : null;
      if (cursorDate && Number.isNaN(cursorDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid cursor' });
      }

      // Parse filters
      const categoriesArr = request.query.categories
        ? request.query.categories.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      const actorsArr = request.query.actors
        ? request.query.actors.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      // actors có thể chứa: 'user:<userId>', 'bot', 'system', hoặc raw userId
      const actorTypes = new Set<string>();
      const actorUserIds: string[] = [];
      if (actorsArr) {
        for (const a of actorsArr) {
          if (a === 'bot' || a === 'system' || a === 'user') actorTypes.add(a);
          else if (a.startsWith('user:')) actorUserIds.push(a.slice(5));
          else actorUserIds.push(a);
        }
      }

      const fromDate = request.query.from ? new Date(request.query.from) : null;
      const toDate = request.query.to ? new Date(request.query.to) : null;
      const search = (request.query.search || '').trim();

      // Build where clause
      const where: Record<string, unknown> = {
        orgId: user.orgId,
        entityType: 'contact',
        entityId: contactId,
      };
      if (categoriesArr && categoriesArr.length) where.category = { in: categoriesArr };
      if (actorUserIds.length || actorTypes.size > 0) {
        const orClauses: Record<string, unknown>[] = [];
        if (actorUserIds.length) orClauses.push({ userId: { in: actorUserIds } });
        if (actorTypes.size > 0) orClauses.push({ actorType: { in: [...actorTypes] } });
        where.OR = orClauses;
      }
      const dateConditions: Record<string, Date> = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) dateConditions.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) dateConditions.lte = toDate;
      if (cursorDate) dateConditions.lt = cursorDate;
      if (Object.keys(dateConditions).length) where.createdAt = dateConditions;

      // Search: scan action + details JSON (Postgres native jsonb_path_query
      // would be ideal but Prisma support limited — fall back to string contains
      // on action + post-filter details. Worst-case slow if large dataset.)
      if (search) {
        where.OR = [
          ...((where.OR as Record<string, unknown>[]) || []),
          { action: { contains: search, mode: 'insensitive' } },
          { details: { string_contains: search } },  // Prisma JSON filter
        ];
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activities = await prisma.activityLog.findMany({
        where: where as any,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const nextCursor = activities.length === limit
        ? activities[activities.length - 1].createdAt.toISOString()
        : null;

      return { items: activities, nextCursor };
    } catch (err) {
      logger.error('[timeline] Activity log error:', err);
      return reply.status(500).send({ error: 'Failed to load activity log' });
    }
  });

  // ── GET /api/v1/timeline/export — CSV download ──────────────────────────
  //   Query: customerId, format (csv default), from, to, categories
  app.get('/api/v1/timeline/export', async (request: FastifyRequest<{
    Querystring: {
      customerId?: string;
      format?: string;
      from?: string;
      to?: string;
      categories?: string;
    };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { customerId, from, to, categories } = request.query;
      const format = (request.query.format || 'csv').toLowerCase();
      if (format !== 'csv') return reply.status(400).send({ error: 'Only CSV format supported' });

      if (!customerId) return reply.status(400).send({ error: 'customerId required' });
      const contact = await prisma.contact.findFirst({
        where: { id: customerId, orgId: user.orgId },
        select: { id: true, fullName: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      const categoriesArr = categories ? categories.split(',').map(s => s.trim()).filter(Boolean) : null;

      const where: Record<string, unknown> = {
        orgId: user.orgId,
        entityType: 'contact',
        entityId: customerId,
      };
      if (categoriesArr && categoriesArr.length) where.category = { in: categoriesArr };
      const dateConditions: Record<string, Date> = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) dateConditions.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) dateConditions.lte = toDate;
      if (Object.keys(dateConditions).length) where.createdAt = dateConditions;

      // Cap export 10K rows to prevent runaway
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await prisma.activityLog.findMany({
        where: where as any,
        include: { user: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10_000,
      });

      // Build CSV
      const header = ['Thời gian', 'Category', 'Action', 'Actor type', 'Actor name', 'Details'];
      const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
      const lines = [header.map(escape).join(',')];
      for (const r of rows) {
        const actorName = r.actorType === 'user'
          ? (r.user?.fullName || r.user?.email || '—')
          : r.actorType === 'bot' ? (r.botName || 'Bot')
          : (r.systemSource || 'System');
        lines.push([
          r.createdAt.toISOString(),
          r.category || '',
          r.action,
          r.actorType,
          actorName,
          JSON.stringify(r.details),
        ].map(escape).join(','));
      }
      const csv = '﻿' + lines.join('\n');  // BOM cho Excel hiểu UTF-8

      const filename = `timeline-${contact.fullName || customerId}-${new Date().toISOString().slice(0, 10)}.csv`;
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    } catch (err) {
      logger.error('[timeline] Export error:', err);
      return reply.status(500).send({ error: 'Failed to export' });
    }
  });
}
