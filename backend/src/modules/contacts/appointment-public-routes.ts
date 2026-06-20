// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * appointment-public-routes.ts — endpoint CÔNG KHAI (không cần đăng nhập) để sale bấm
 * link từ tin Zalo đánh dấu Lịch hẹn Hoàn thành / Huỷ. Xác thực bằng token HMAC (JWT_SECRET),
 * KHÔNG addHook authMiddleware. (2026-06-16)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { verifyActionToken, signActionToken, removeAppointmentReminder } from './appointment-zalo-service.js';

export async function appointmentPublicRoutes(app: FastifyInstance): Promise<void> {
  // 2026-06-18 — SHORT-LINK: GET /a/:code → tra bảng → kiểm hết hạn → mint token (exp ≤ link)
  // → 302 sang trang action. Route gốc (non-/api) chạy được dù fastifyStatic mount trước:
  // Fastify radix ưu tiên route cụ thể; setNotFoundHandler chỉ bắn khi không khớp (tiền lệ /health).
  app.get('/a/:code', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = request.params as { code?: string };
    const base = '/appointments/action';
    const link = code
      ? await prisma.appointmentActionLink.findUnique({
          where: { code },
          select: { appointmentId: true, userId: true, orgId: true, expiresAt: true },
        })
      : null;
    // Hết hạn / không có → đẩy sang trang action với token rỗng → FE hiện "Link đã hết hạn".
    if (!link || link.expiresAt.getTime() <= Date.now()) {
      return reply.redirect(`${base}?t=expired`, 302);
    }
    // Nguồn chân lý hết-hạn = expiresAt của link; token sống ≤ link (không kéo dài vô hạn).
    const exp = Math.min(Date.now() + 7 * 24 * 3600_000, link.expiresAt.getTime());
    const token = signActionToken({ a: link.appointmentId, u: link.userId, o: link.orgId, exp });
    return reply.redirect(`${base}?t=${encodeURIComponent(token)}`, 302);
  });

  // Thông tin lịch hẹn để trang xác nhận hiển thị (token trong query).
  app.get('/api/public/appointments/action', async (request: FastifyRequest, reply: FastifyReply) => {
    const { t } = request.query as { t?: string };
    const p = verifyActionToken(t ?? '');
    if (!p) return reply.status(400).send({ error: 'invalid_or_expired_token' });
    const appt = await prisma.appointment.findFirst({
      where: { id: p.a, orgId: p.o },
      select: {
        id: true, status: true, appointmentDate: true, appointmentTime: true, title: true,
        contact: { select: { fullName: true } },
        assignedUser: { select: { fullName: true } },
      },
    });
    if (!appt) return reply.status(404).send({ error: 'not_found' });
    return {
      id: appt.id,
      status: appt.status,
      appointmentDate: appt.appointmentDate,
      appointmentTime: appt.appointmentTime,
      title: appt.title,
      contactName: appt.contact?.fullName ?? null,
      ownerName: appt.assignedUser?.fullName ?? null,
    };
  });

  // Đánh dấu hoàn thành / huỷ.
  app.post('/api/public/appointments/action', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { token?: string; action?: string };
    const p = verifyActionToken(body.token ?? '');
    if (!p) return reply.status(400).send({ error: 'invalid_or_expired_token' });
    const action = body.action;
    if (action !== 'completed' && action !== 'cancelled') {
      return reply.status(400).send({ error: 'invalid_action' });
    }
    const appt = await prisma.appointment.findFirst({
      where: { id: p.a, orgId: p.o },
      select: { id: true, status: true },
    });
    if (!appt) return reply.status(404).send({ error: 'not_found' });
    // Đã đóng rồi → idempotent (sale bấm lại link cũ).
    if (['completed', 'cancelled', 'no_show'].includes(appt.status)) {
      return { ok: true, status: appt.status, alreadyClosed: true };
    }
    await prisma.appointment.update({
      where: { id: p.a },
      data: { status: action, statusChangedByUserId: p.u, statusChangedAt: new Date() },
    });
    void removeAppointmentReminder(p.a).catch(() => {});
    logger.info(`[appt-public] appt ${p.a} → ${action} qua token (user ${p.u})`);
    return { ok: true, status: action };
  });
}
