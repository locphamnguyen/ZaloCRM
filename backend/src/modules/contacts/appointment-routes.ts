/**
 * appointment-routes.ts — REST API for appointment management.
 * Supports list, detail, create, update, delete, today, and upcoming endpoints.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity, computeDiff } from '../activity/activity-logger.js';

type QueryParams = Record<string, string>;

const APPOINTMENT_INCLUDE = {
  contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
  assignedUser: { select: { id: true, fullName: true } },
  statusChangedBy: { select: { id: true, fullName: true, email: true } },
} as const;

export async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/appointments/today — today's appointments ─────────────────
  app.get('/api/v1/appointments/today', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      const appointments = await prisma.appointment.findMany({
        where: { orgId: user.orgId, appointmentDate: { gte: start, lte: end } },
        include: APPOINTMENT_INCLUDE,
        orderBy: [{ appointmentTime: 'asc' }, { appointmentDate: 'asc' }],
      });

      return { appointments, total: appointments.length };
    } catch (err) {
      logger.error('[appointments] Today error:', err);
      return reply.status(500).send({ error: 'Failed to fetch today appointments' });
    }
  });

  // ── GET /api/v1/appointments/upcoming — next 7 days ───────────────────────
  app.get('/api/v1/appointments/upcoming', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const now = new Date();
      const in7Days = new Date(now);
      in7Days.setDate(in7Days.getDate() + 7);

      const appointments = await prisma.appointment.findMany({
        where: {
          orgId: user.orgId,
          appointmentDate: { gte: now, lte: in7Days },
          status: 'scheduled',
        },
        include: APPOINTMENT_INCLUDE,
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
      });

      return { appointments, total: appointments.length };
    } catch (err) {
      logger.error('[appointments] Upcoming error:', err);
      return reply.status(500).send({ error: 'Failed to fetch upcoming appointments' });
    }
  });

  // ── GET /api/v1/appointments — list with filters ──────────────────────────
  // Hỗ trợ filter source ('zalo' | 'manual' | 'all'); trả counts per source cho filter chip.
  app.get('/api/v1/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        page = '1',
        limit = '50',
        status = '',
        contactId = '',
        dateFrom = '',
        dateTo = '',
        source = '',
      } = request.query as QueryParams;

      const where: any = { orgId: user.orgId };
      if (status) where.status = status;
      if (contactId) where.contactId = contactId;
      if (source && source !== 'all') where.source = source;
      if (dateFrom || dateTo) {
        where.appointmentDate = {};
        if (dateFrom) where.appointmentDate.gte = new Date(dateFrom);
        if (dateTo) where.appointmentDate.lte = new Date(dateTo);
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const [appointments, total, sourceCounts] = await Promise.all([
        prisma.appointment.findMany({
          where,
          include: APPOINTMENT_INCLUDE,
          orderBy: [{ appointmentDate: 'desc' }, { appointmentTime: 'asc' }],
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.appointment.count({ where }),
        // Counts per source — ignore current source filter để chip luôn show số đầy đủ
        prisma.appointment.groupBy({
          by: ['source'],
          where: { orgId: user.orgId },
          _count: true,
        }),
      ]);

      // Resolve conversationId từ zaloMessageId cho deep-link
      const zaloMsgIds = appointments
        .filter((a) => a.zaloMessageId)
        .map((a) => a.zaloMessageId as string);
      let convMap: Record<string, string> = {};
      if (zaloMsgIds.length > 0) {
        const msgs = await prisma.message.findMany({
          where: { id: { in: zaloMsgIds } },
          select: { id: true, conversationId: true },
        });
        convMap = Object.fromEntries(msgs.map((m) => [m.id, m.conversationId]));
      }

      return {
        appointments: appointments.map((a) => ({
          ...a,
          conversationId: a.zaloMessageId ? convMap[a.zaloMessageId] || null : null,
        })),
        total,
        page: pageNum,
        limit: limitNum,
        counts: Object.fromEntries(sourceCounts.map((c) => [c.source, c._count])),
      };
    } catch (err) {
      logger.error('[appointments] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  // ── GET /api/v1/appointments/:id — detail ─────────────────────────────────
  app.get('/api/v1/appointments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const appointment = await prisma.appointment.findFirst({
        where: { id, orgId: user.orgId },
        include: APPOINTMENT_INCLUDE,
      });

      if (!appointment) return reply.status(404).send({ error: 'Appointment not found' });
      return appointment;
    } catch (err) {
      logger.error('[appointments] Detail error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment' });
    }
  });

  // ── POST /api/v1/appointments — create ────────────────────────────────────
  app.post('/api/v1/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      if (!body.contactId || !body.appointmentDate) {
        return reply.status(400).send({ error: 'contactId and appointmentDate are required' });
      }

      // Deduplication: prevent same contact + same date within org
      const existing = await prisma.appointment.findFirst({
        where: {
          contactId: body.contactId,
          appointmentDate: new Date(body.appointmentDate),
          orgId: user.orgId,
        },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Lịch hẹn đã tồn tại cho ngày này' });
      }

      const appointment = await prisma.appointment.create({
        data: {
          orgId: user.orgId,
          contactId: body.contactId,
          assignedUserId: body.assignedUserId ?? user.id,
          appointmentDate: new Date(body.appointmentDate),
          appointmentTime: body.appointmentTime,
          type: body.type,
          status: body.status ?? 'scheduled',
          notes: body.notes,
        },
        include: APPOINTMENT_INCLUDE,
      });

      // ── ACTIVITY LOG — appointment_create — entity = contact để timeline KH có log
      logActivity({
        orgId: user.orgId,
        userId: user.id,
        action: 'appointment_create',
        entityType: 'contact',
        entityId: appointment.contactId,
        details: {
          appointmentId: appointment.id,
          appointmentDate: appointment.appointmentDate,
          appointmentTime: appointment.appointmentTime,
          type: appointment.type,
          notes: appointment.notes,
        },
      });

      return reply.status(201).send(appointment);
    } catch (err) {
      logger.error('[appointments] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create appointment' });
    }
  });

  // ── PUT /api/v1/appointments/:id — update ─────────────────────────────────
  // Khi body.status đổi so với existing.status → set statusChangedByUserId + statusChangedAt
  // để track sale nào ra quyết định (cron auto-flip overdue KHÔNG đi qua route này).
  app.put('/api/v1/appointments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.appointment.findFirst({
        where: { id, orgId: user.orgId },
        select: {
          id: true, status: true, contactId: true,
          appointmentDate: true, appointmentTime: true, type: true, notes: true,
        },
      });
      if (!existing) return reply.status(404).send({ error: 'Appointment not found' });

      const statusChanging = body.status !== undefined && body.status !== existing.status;
      const dateChanging = body.appointmentDate && new Date(body.appointmentDate).getTime() !== existing.appointmentDate.getTime();

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          contactId: body.contactId,
          assignedUserId: body.assignedUserId,
          appointmentDate: body.appointmentDate ? new Date(body.appointmentDate) : undefined,
          appointmentTime: body.appointmentTime,
          type: body.type,
          status: body.status,
          notes: body.notes,
          ...(statusChanging ? { statusChangedByUserId: user.id, statusChangedAt: new Date() } : {}),
        },
        include: APPOINTMENT_INCLUDE,
      });

      // ── ACTIVITY LOG — pick action based on what changed ────────────────
      if (statusChanging) {
        const statusToAction: Record<string, string> = {
          completed: 'appointment_complete',
          cancelled: 'appointment_cancel',
          no_show: 'appointment_no_show',
        };
        const action = statusToAction[body.status] || 'appointment_update';
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action,
          entityType: 'contact',
          entityId: updated.contactId,
          details: { appointmentId: updated.id, oldStatus: existing.status, newStatus: body.status, notes: body.notes },
        });
      } else if (dateChanging) {
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'appointment_reschedule',
          entityType: 'contact',
          entityId: updated.contactId,
          details: {
            appointmentId: updated.id,
            oldDate: existing.appointmentDate,
            newDate: updated.appointmentDate,
            oldTime: existing.appointmentTime,
            newTime: updated.appointmentTime,
          },
        });
      } else {
        // Other field changes → generic update
        const diff = computeDiff(
          existing as Record<string, unknown>,
          updated as Record<string, unknown>,
          ['type', 'notes', 'appointmentTime'],
        );
        if (Object.keys(diff).length > 0) {
          logActivity({
            orgId: user.orgId,
            userId: user.id,
            action: 'appointment_update',
            entityType: 'contact',
            entityId: updated.contactId,
            details: { appointmentId: updated.id, changes: diff },
          });
        }
      }

      return updated;
    } catch (err) {
      logger.error('[appointments] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update appointment' });
    }
  });

  // ── PATCH /api/v1/appointments/:id/status — quick status change ───────────
  // Endpoint riêng cho 1-click action buttons trên row (Hoàn thành / Huỷ / Không đến)
  app.patch('/api/v1/appointments/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };
      const VALID = ['scheduled', 'overdue', 'completed', 'cancelled', 'no_show'];
      if (!VALID.includes(status)) return reply.status(400).send({ error: 'Invalid status' });

      const existing = await prisma.appointment.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, status: true, contactId: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Appointment not found' });

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          status,
          statusChangedByUserId: user.id,
          statusChangedAt: new Date(),
        },
        include: APPOINTMENT_INCLUDE,
      });
      logger.info(`[appointments] User ${user.email} changed appt ${id} status: ${existing.status} → ${status}`);

      // ── ACTIVITY LOG ────────────────────────────────────────────────────
      const statusToAction: Record<string, string> = {
        completed: 'appointment_complete',
        cancelled: 'appointment_cancel',
        no_show: 'appointment_no_show',
      };
      logActivity({
        orgId: user.orgId,
        userId: user.id,
        action: statusToAction[status] || 'appointment_update',
        entityType: 'contact',
        entityId: existing.contactId,
        details: { appointmentId: id, oldStatus: existing.status, newStatus: status },
      });

      return updated;
    } catch (err) {
      logger.error('[appointments] Status update error:', err);
      return reply.status(500).send({ error: 'Failed to update status' });
    }
  });

  // ── DELETE /api/v1/appointments/:id — delete ──────────────────────────────
  app.delete('/api/v1/appointments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.appointment.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Appointment not found' });

      await prisma.appointment.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[appointments] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete appointment' });
    }
  });
}
