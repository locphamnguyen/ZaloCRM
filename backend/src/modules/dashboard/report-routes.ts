// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * report-routes.ts — Detailed reports for messages, contacts, appointments, and Excel export.
 * All routes require JWT auth, scoped to user's orgId.
 * Sheet builders are in excel-sheet-builders.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import {
  buildMessagesSheet,
  buildContactsSheet,
  buildAppointmentsSheet,
} from './excel-sheet-builders.js';
import { getContactScope } from '../contacts/contact-scope.js';
import { getZaloScope } from '../zalo/zalo-scope.js';

type QueryParams = Record<string, string>;

/**
 * Phase Marketing+Analytics Scope 2026-05-27 — gate report routes:
 * - admin/owner → full org
 * - leader/deputy → dept-subtree (qua getContactScope/getZaloScope cascade)
 * - member thường → 403 (sale không cần xem report team-wide)
 */
async function gateReportAccess(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = request.user!;
  if (user.role === 'owner' || user.role === 'admin') return true;
  const cScope = await getContactScope(user.id, user.orgId, user.role);
  if (cScope.isOrgAdmin) return true;
  // Leader/deputy: visibleUserIds.size > 1 (có người dưới dept)
  if (cScope.visibleUserIds.size > 1) return true;
  reply.status(403).send({
    error: 'Sale member không có quyền xem báo cáo team. Liên hệ trưởng phòng.',
    code: 'reports_member_forbidden',
  });
  return false;
}

function defaultDateRange() {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  return { from, to };
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/reports/messages?from=&to=
  app.get('/api/v1/reports/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const rows = await prisma.$queryRaw<
        Array<{ date: Date; sent: bigint; received: bigint; total: bigint }>
      >`
        SELECT
          DATE(m.sent_at) AS date,
          COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
          COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received,
          COUNT(*) AS total
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.org_id = ${orgId}
          AND m.sent_at >= ${from}::date
          AND m.sent_at < (${to}::date + interval '1 day')
        GROUP BY DATE(m.sent_at)
        ORDER BY date ASC
      `;

      const data = rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        sent: Number(r.sent),
        received: Number(r.received),
        total: Number(r.total),
      }));

      return { from, to, data };
    } catch (err) {
      logger.error('[reports] Messages error:', err);
      return reply.status(500).send({ error: 'Failed to fetch message report' });
    }
  });

  // GET /api/v1/reports/contacts?from=&to= — contacts by status distribution
  app.get('/api/v1/reports/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const [newPerDay, statusDist] = await Promise.all([
        prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
          SELECT DATE(created_at) AS date, COUNT(*) AS count
          FROM contacts
          WHERE org_id = ${orgId}
            AND created_at >= ${from}::date
            AND created_at < (${to}::date + interval '1 day')
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `,
        prisma.contact.groupBy({
          by: ['status'],
          where: { orgId, status: { not: null } },
          _count: true,
        }),
      ]);

      return {
        from,
        to,
        newPerDay: newPerDay.map((r) => ({
          date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
          count: Number(r.count),
        })),
        byStatus: statusDist.map((s) => ({
          status: s.status,
          count: s._count,
        })),
      };
    } catch (err) {
      logger.error('[reports] Contacts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact report' });
    }
  });

  // GET /api/v1/reports/appointments?from=&to=
  app.get('/api/v1/reports/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const dateFilter = { gte: new Date(from), lte: new Date(to) };
      const [byStatus, byType] = await Promise.all([
        prisma.appointment.groupBy({
          by: ['status'],
          where: { orgId, appointmentDate: dateFilter },
          _count: true,
        }),
        prisma.appointment.groupBy({
          by: ['type'],
          where: { orgId, appointmentDate: dateFilter },
          _count: true,
        }),
      ]);

      return {
        from,
        to,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
        byType: byType.map((t) => ({ type: t.type, count: t._count })),
      };
    } catch (err) {
      logger.error('[reports] Appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment report' });
    }
  });

  // GET /api/v1/reports/export?type=messages&from=&to=
  app.get('/api/v1/reports/export', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const type = query.type || 'messages';
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const workbook = new ExcelJS.Workbook();

      if (type === 'messages') {
        await buildMessagesSheet(workbook, orgId, from, to);
      } else if (type === 'contacts') {
        await buildContactsSheet(workbook, orgId, from, to);
      } else if (type === 'appointments') {
        await buildAppointmentsSheet(workbook, orgId, from, to);
      } else {
        return reply.status(400).send({ error: 'Invalid export type. Use: messages, contacts, appointments' });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename=${type}-report.xlsx`);
      return reply.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err) {
      logger.error('[reports] Export error:', err);
      return reply.status(500).send({ error: 'Failed to export report' });
    }
  });
}
