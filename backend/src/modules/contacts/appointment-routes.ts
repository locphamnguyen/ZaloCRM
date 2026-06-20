// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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
import { getContactScope, assertContactVisible } from './contact-scope.js';

type QueryParams = Record<string, string>;

const APPOINTMENT_INCLUDE = {
  contact: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      avatarUrl: true,
      // Per-nick Zalo avatar fallback — Contact.avatarUrl thường null cho KH import từ Zalo,
      // avatar thật ở Friend.zaloAvatarUrl. FE resolveAvatarUrl chọn cái nào có trước.
      friends: {
        select: { id: true, zaloAvatarUrl: true, zaloDisplayName: true, lastInboundAt: true },
        orderBy: { lastInboundAt: { sort: 'desc' as const, nulls: 'last' as const } },
        take: 5,
      },
    },
  },
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

      // Phase Contact Scope Hybrid 2026-05-27: filter theo KH visible
      const cScope = await getContactScope(user.id, user.orgId, user.role);
      const whereToday: any = { orgId: user.orgId, appointmentDate: { gte: start, lte: end } };
      if (!cScope.isOrgAdmin && cScope.accessibleContactIds !== null) {
        whereToday.contactId = { in: cScope.accessibleContactIds };
      }
      const appointments = await prisma.appointment.findMany({
        where: whereToday,
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

      // Phase Contact Scope Hybrid 2026-05-27
      const cScope = await getContactScope(user.id, user.orgId, user.role);
      const whereUpcoming: any = {
        orgId: user.orgId,
        appointmentDate: { gte: now, lte: in7Days },
        status: 'scheduled',
      };
      if (!cScope.isOrgAdmin && cScope.accessibleContactIds !== null) {
        whereUpcoming.contactId = { in: cScope.accessibleContactIds };
      }
      const appointments = await prisma.appointment.findMany({
        where: whereUpcoming,
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
      // Phase Contact Scope Hybrid 2026-05-27
      const cScope = await getContactScope(user.id, user.orgId, user.role);
      if (!cScope.isOrgAdmin && cScope.accessibleContactIds !== null) {
        // Intersect với contactId filter nếu đã có
        if (where.contactId) {
          if (!cScope.accessibleContactIds.includes(where.contactId)) {
            return reply.status(404).send({ error: 'Contact not found' });
          }
        } else {
          where.contactId = { in: cScope.accessibleContactIds };
        }
      }
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
      // Phase Contact Scope Hybrid 2026-05-27
      if (appointment.contactId) {
        const visible = await assertContactVisible({
          userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId: appointment.contactId,
        });
        if (!visible) return reply.status(404).send({ error: 'Appointment not found' });
      }
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

      // Chống trùng (anh chốt 2026-06-16): CHỈ chặn khi cùng KH + cùng NGÀY + cùng GIỜ và lịch
      // CÒN HIỆU LỰC (bỏ qua Hoàn thành/Huỷ/Vắng). Khác giờ trong ngày → cho phép. Khi trùng:
      // báo RÕ lịch đang vướng (tên/giờ/ngày/phụ trách) để sale biết xử lý.
      const conflict = await prisma.appointment.findFirst({
        where: {
          contactId: body.contactId,
          appointmentDate: new Date(body.appointmentDate),
          appointmentTime: body.appointmentTime ?? null,
          orgId: user.orgId,
          status: { in: ['scheduled', 'overdue'] },
        },
        select: {
          id: true, title: true, appointmentTime: true, appointmentDate: true,
          contact: { select: { fullName: true } },
          assignedUser: { select: { fullName: true } },
        },
      });
      if (conflict) {
        const kh = conflict.contact?.fullName?.trim() || 'Khách này';
        const dateLabel = new Intl.DateTimeFormat('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
        }).format(conflict.appointmentDate);
        const sale = conflict.assignedUser?.fullName ? ` · phụ trách ${conflict.assignedUser.fullName}` : '';
        return reply.status(409).send({
          error: 'appointment_conflict',
          message: `${kh} đã có lịch "${conflict.title || 'Lịch hẹn'}" lúc ${conflict.appointmentTime || '—'} ngày ${dateLabel}${sale}. Chọn GIỜ khác hoặc xử lý lịch cũ trước.`,
          conflictId: conflict.id,
        });
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
          // 2026-05-21 "Nhắc hẹn" refactor
          title: body.title ?? null,
          durationMin: typeof body.durationMin === 'number' ? body.durationMin : 15,
          location: body.location ?? null,
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

      // Phase 6 — apply scoring signal cho mọi Friend của contact (per-pair).
      // Sale có thể book lịch cho 1 nick cụ thể, nhưng signal apply lên all Friend
      // vì appointment thuộc Contact-level (KH lớn), aggregate sẽ MAX về Contact.
      void (async () => {
        try {
          const friends = await prisma.friend.findMany({
            where: { contactId: appointment.contactId, orgId: user.orgId },
            select: { id: true },
          });
          const { onAppointmentCreate } = await import('../scoring/scoring-hooks.js');
          for (const f of friends) onAppointmentCreate(user.orgId, f.id);
        } catch {
          /* silent */
        }
      })();

      // 2026-06-16 — đẩy Nhắc hẹn Zalo (nick hệ thống) cho sale: tin báo + createReminder.
      // Fire-and-forget, lỗi Zalo KHÔNG ảnh hưởng tạo lịch (service tự nuốt lỗi).
      void import('./appointment-zalo-service.js')
        .then((m) => m.pushAppointmentOnCreate(appointment.id))
        .catch(() => {});

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
      // 2026-06-18 — dời lịch = đổi NGÀY hoặc GIỜ → reset chu kỳ nhắc 3 lần + mốc digest.
      const timeChanging = body.appointmentTime !== undefined && body.appointmentTime !== existing.appointmentTime;
      const rescheduled = Boolean(dateChanging) || timeChanging;

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          // FIX 2026-06-09 (Anh báo "Failed to update appointment"): contactId là relation FK
          // BẮT BUỘC — truyền null (editor gửi khi KH chưa link / đã gỡ link) làm Prisma ném
          // "Unknown argument contactId" → 500. Chỉ update khi có giá trị thật; KHÔNG cho null
          // hoá contact của lịch hẹn (mỗi lịch luôn thuộc 1 KH).
          ...(body.contactId ? { contactId: body.contactId } : {}),
          assignedUserId: body.assignedUserId,
          appointmentDate: body.appointmentDate ? new Date(body.appointmentDate) : undefined,
          appointmentTime: body.appointmentTime,
          type: body.type,
          status: body.status,
          notes: body.notes,
          // 2026-05-21 nhắc hẹn fields
          ...(body.title !== undefined ? { title: body.title || null } : {}),
          ...(typeof body.durationMin === 'number' ? { durationMin: body.durationMin } : {}),
          ...(body.location !== undefined ? { location: body.location || null } : {}),
          ...(statusChanging ? { statusChangedByUserId: user.id, statusChangedAt: new Date() } : {}),
          // Dời lịch → nhắc lại từ đầu theo mốc mới (Luật mutation). Sửa nội dung khác KHÔNG reset.
          ...(rescheduled
            ? { actionPromptCount: 0, lastActionPromptAt: null, managerDigestedAt: null, managerDigestFirstAt: null }
            : {}),
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

        // Phase 6 — appointment_complete trigger scoring signal (+35 Intent)
        if (body.status === 'completed' && updated.contactId) {
          void (async () => {
            try {
              const friends = await prisma.friend.findMany({
                where: { contactId: updated.contactId, orgId: user.orgId },
                select: { id: true },
              });
              const { onAppointmentComplete } = await import('../scoring/scoring-hooks.js');
              for (const f of friends) onAppointmentComplete(user.orgId, f.id);
            } catch {
              /* silent */
            }
          })();
        }
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

      // 2026-06-16 — sync Nhắc hẹn Zalo: đóng lịch → xoá nhắc; đổi giờ → sửa nhắc.
      if (statusChanging && ['completed', 'cancelled', 'no_show'].includes(body.status)) {
        void import('./appointment-zalo-service.js').then((m) => m.removeAppointmentReminder(id)).catch(() => {});
      } else if (dateChanging) {
        void import('./appointment-zalo-service.js').then((m) => m.syncReminderOnReschedule(id)).catch(() => {});
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

      // 2026-06-16 — đóng lịch (hoàn thành/huỷ/vắng) → xoá Nhắc hẹn Zalo (khỏi báo thừa).
      if (status === 'completed' || status === 'cancelled' || status === 'no_show') {
        void import('./appointment-zalo-service.js').then((m) => m.removeAppointmentReminder(id)).catch(() => {});
      }

      return updated;
    } catch (err) {
      logger.error('[appointments] Status update error:', err);
      return reply.status(500).send({ error: 'Failed to update status' });
    }
  });

  // ── Cài đặt Lịch hẹn → Nhắc hẹn Zalo (2026-06-16) ─────────────────────────
  // GET trả cấu hình org; PUT (admin/owner) lưu bật/tắt + delay (phút) gửi link đánh dấu.
  app.get('/api/v1/appointments/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: {
          appointmentZaloReminderEnabled: true, appointmentActionDelayMinutes: true,
          appointmentReminderOffsetsHours: true, appointmentDigestStopDays: true,
          systemNotifyZaloAccountId: true,
        },
      });
      const offsets = org?.appointmentReminderOffsetsHours;
      return {
        enabled: org?.appointmentZaloReminderEnabled ?? false,
        actionDelayMinutes: org?.appointmentActionDelayMinutes ?? 15,
        reminderOffsetsHours: Array.isArray(offsets) ? offsets : [1, 3, 6],
        digestStopDays: org?.appointmentDigestStopDays ?? 7,
        hasSystemNotifyNick: !!org?.systemNotifyZaloAccountId,
      };
    } catch (err) {
      logger.error('[appointments] settings get error:', err);
      return reply.status(500).send({ error: 'Failed to load settings' });
    }
  });
  app.put('/api/v1/appointments/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!['owner', 'admin'].includes(user.role)) return reply.status(403).send({ error: 'forbidden' });
      const body = (request.body ?? {}) as {
        enabled?: boolean; actionDelayMinutes?: number;
        reminderOffsetsHours?: unknown; digestStopDays?: number;
      };
      const data: Record<string, unknown> = {};
      if (typeof body.enabled === 'boolean') data.appointmentZaloReminderEnabled = body.enabled;
      if (body.actionDelayMinutes !== undefined) {
        const v = Number(body.actionDelayMinutes);
        if (!Number.isFinite(v) || v < 0 || v > 1440) {
          return reply.status(400).send({ error: 'actionDelayMinutes_invalid', hint: 'Phải từ 0 đến 1440 phút' });
        }
        data.appointmentActionDelayMinutes = Math.round(v);
      }
      // 2026-06-18 — 3 mốc giờ nhắc (interval). Đúng 3 phần tử, mỗi giá trị 0 < v ≤ 168 giờ.
      if (body.reminderOffsetsHours !== undefined) {
        const arr = body.reminderOffsetsHours;
        if (!Array.isArray(arr) || arr.length !== 3
            || !arr.every((x) => Number.isFinite(Number(x)) && Number(x) > 0 && Number(x) <= 168)) {
          return reply.status(400).send({ error: 'reminderOffsetsHours_invalid', hint: 'Cần đúng 3 số, mỗi số từ 1 đến 168 (giờ)' });
        }
        data.appointmentReminderOffsetsHours = arr.map((x) => Number(x));
      }
      // Số ngày dừng digest (0 = không bao giờ dừng).
      if (body.digestStopDays !== undefined) {
        const v = Number(body.digestStopDays);
        if (!Number.isFinite(v) || v < 0 || v > 365) {
          return reply.status(400).send({ error: 'digestStopDays_invalid', hint: 'Phải từ 0 đến 365 ngày' });
        }
        data.appointmentDigestStopDays = Math.round(v);
      }
      const org = await prisma.organization.update({
        where: { id: user.orgId },
        data,
        select: {
          appointmentZaloReminderEnabled: true, appointmentActionDelayMinutes: true,
          appointmentReminderOffsetsHours: true, appointmentDigestStopDays: true,
        },
      });
      const savedOffsets = org.appointmentReminderOffsetsHours;
      return {
        enabled: org.appointmentZaloReminderEnabled,
        actionDelayMinutes: org.appointmentActionDelayMinutes,
        reminderOffsetsHours: Array.isArray(savedOffsets) ? savedOffsets : [1, 3, 6],
        digestStopDays: org.appointmentDigestStopDays,
      };
    } catch (err) {
      logger.error('[appointments] settings put error:', err);
      return reply.status(500).send({ error: 'Failed to save settings' });
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
