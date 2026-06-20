// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * appointment-reminder.ts — Cron job that emits Socket.IO reminders
 * for appointments scheduled tomorrow.
 * Runs daily at 08:00 Vietnam time (01:00 UTC).
 */
import cron from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Parse `Organization.appointmentReminderOffsetsHours` (JSON) → mảng KHOẢNG CÁCH giờ.
 * Sai định dạng / rỗng → mặc định [1,3,6]. Lọc giá trị > 0, tối đa 3 phần tử.
 */
export function parseOffsetsHours(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    const nums = raw.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
    if (nums.length > 0) return nums.slice(0, 3);
  }
  return [1, 3, 6];
}

/**
 * Mốc (epoch ms) gửi nhắc lần (alreadySent+1) = giờ hẹn + TỔNG offsets[0..alreadySent].
 * Trả null nếu đã gửi hết số lần cấu hình. (Pure — test được không cần DB.)
 */
export function reminderDueMs(startMs: number, offsets: number[], alreadySent: number): number | null {
  if (alreadySent >= offsets.length) return null;
  const cumulativeHours = offsets.slice(0, alreadySent + 1).reduce((s, h) => s + h, 0);
  return startMs + cumulativeHours * 3600_000;
}

export function startAppointmentReminder(io: Server): void {
  // 01:00 UTC = 08:00 Vietnam time (UTC+7)
  cron.schedule('0 1 * * *', async () => {
    logger.info('[reminder] Checking tomorrow appointments...');

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
      const endOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999);

      const appointments = await prisma.appointment.findMany({
        where: {
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          status: 'scheduled',
          reminderSent: false,
        },
        include: {
          contact: { select: { fullName: true, phone: true } },
          assignedUser: { select: { id: true, fullName: true } },
        },
      });

      for (const apt of appointments) {
        io.emit('appointment:reminder', {
          appointmentId: apt.id,
          contactName: apt.contact.fullName,
          contactPhone: apt.contact.phone,
          date: apt.appointmentDate,
          time: apt.appointmentTime,
          type: apt.type,
          assignedUserId: apt.assignedUserId,
          assignedUserName: apt.assignedUser?.fullName,
        });

        await withTenant(apt.orgId, () =>
          prisma.appointment.update({
            where: { id: apt.id },
            data: { reminderSent: true },
          })
        );
      }

      logger.info(`[reminder] Sent ${appointments.length} reminder(s)`);
    } catch (err) {
      logger.error('[reminder] Cron job error:', err);
    }
  });

  logger.info('[reminder] Appointment reminder cron started (daily 01:00 UTC)');

  // Auto-flip scheduled → overdue mỗi 5 phút khi appointmentDate < now.
  // (Trước: 30 min — quá lag. Frontend giờ tính effectiveStatus client-side nhưng
  // cron vẫn cần để DB đồng bộ cho query filter / report.)
  async function flipOverdue() {
    try {
      const now = new Date();
      const result = await prisma.appointment.updateMany({
        where: { status: 'scheduled', appointmentDate: { lt: now } },
        data: { status: 'overdue' },
      });
      if (result.count > 0) {
        logger.info(`[appointment] Auto-flipped ${result.count} scheduled → overdue`);
      }
    } catch (err) {
      logger.error('[appointment] Overdue auto-flip error:', err);
    }
  }

  cron.schedule('*/5 * * * *', flipOverdue);
  // Catch-up ngay khi container start — fix rows quá hạn lúc server xuống
  void flipOverdue();

  logger.info('[appointment] Overdue auto-flip cron started (every 5 min + on-boot)');

  // 2026-06-18 — Nhắc HOÀN THÀNH tối đa 3 lần, giãn cách `appointmentReminderOffsetsHours` (giờ,
  // org cấu hình). Mốc lần (n+1) = giờ hẹn + TỔNG offsets[0..n]. Mỗi nhịp đọc lịch TƯƠI nên an
  // toàn khi sale sửa/đổi giờ/xoá. Overlap guard chống nhịp chồng; count-sau-gửi-OK (Luật D4).
  let actionPromptsRunning = false;
  async function sendActionPrompts() {
    if (actionPromptsRunning) {
      logger.info('[appointment] action-prompt đang chạy, skip nhịp này (overlap guard)');
      return;
    }
    actionPromptsRunning = true;
    try {
      const now = new Date();
      // Prefilter rộng (buffer 12h): appointmentDate là 00:00 UTC của NGÀY; lọc chính xác bằng dueMs.
      const prefilterMax = new Date(now.getTime() + 12 * 60 * 60_000);
      const candidates = await prisma.appointment.findMany({
        where: {
          status: { in: ['scheduled', 'overdue'] },
          actionPromptCount: { lt: 3 },
          assignedUserId: { not: null },
          assignedUser: { is: { isActive: true } }, // sale nghỉ việc → ngừng bắn tin (Luật D3)
          appointmentDate: { lte: prefilterMax },
        },
        select: { id: true, orgId: true, appointmentDate: true, appointmentTime: true, actionPromptCount: true },
        take: 200,
      });
      if (!candidates.length) return;
      const orgIds = [...new Set(candidates.map((c) => c.orgId))];
      const orgs = await prisma.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, appointmentZaloReminderEnabled: true, appointmentReminderOffsetsHours: true, timezone: true },
      });
      const orgMap = new Map(orgs.map((o) => [o.id, o]));
      const { sendAppointmentActionPrompt, appointmentStartMs } = await import('./appointment-zalo-service.js');
      let sent = 0;
      for (const c of candidates) {
        const o = orgMap.get(c.orgId);
        if (!o?.appointmentZaloReminderEnabled) continue;
        const offsets = parseOffsetsHours(o.appointmentReminderOffsetsHours);
        const n = c.actionPromptCount; // đã gửi n lần → tính mốc lần kế (n+1)
        const startMs = appointmentStartMs(c.appointmentDate, c.appointmentTime, o.timezone || '+07:00');
        const dueMs = reminderDueMs(startMs, offsets, n);
        if (dueMs === null) continue; // đã gửi hết số lần cấu hình
        if (now.getTime() < dueMs) continue; // chưa tới mốc nhắc lần (n+1)
        const result = await sendAppointmentActionPrompt(c.id, n + 1);
        // Luật D4: CHỈ tăng count khi gửi Zalo OK. 'failed' → giữ count, nhịp sau thử lại (không mất nhắc).
        if (result === 'sent') {
          await withTenant(c.orgId, () =>
            prisma.appointment.update({
              where: { id: c.id },
              data: { actionPromptCount: { increment: 1 }, lastActionPromptAt: new Date(), actionPromptSent: true },
            }),
          );
          sent++;
        }
      }
      if (sent > 0) logger.info(`[appointment] Đã gửi ${sent} nhắc hoàn thành`);
    } catch (err) {
      logger.error('[appointment] action-prompt cron error:', err);
    } finally {
      actionPromptsRunning = false;
    }
  }
  cron.schedule('*/5 * * * *', sendActionPrompts);
  logger.info('[appointment] Nhắc hoàn thành cron started (every 5 min, 3 lần)');
}
