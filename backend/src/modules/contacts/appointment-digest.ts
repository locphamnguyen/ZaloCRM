// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * appointment-digest.ts — Digest hằng ngày cho TRƯỞNG PHÒNG (2026-06-18).
 *
 * Sau khi sale bỏ lỡ đủ 3 lần nhắc (actionPromptCount >= 3) mà lịch chưa Hoàn thành/Huỷ,
 * mỗi sáng (cron 08:00 VN) gom các lịch đó theo TRƯỞNG PHÒNG quản lý sale → gửi 1 checklist.
 *
 * Luật đã chốt (/plan-eng-review 2026-06-18):
 *   D2 — lặp mỗi ngày nhưng DỪNG sau Organization.appointmentDigestStopDays ngày (mặc định 7,
 *        0 = không dừng) kể từ lần digest đầu (managerDigestFirstAt).
 *   D3 — BATCH resolve trưởng phòng: nạp DepartmentMember + Department của org 1 lần/nhịp, dựng
 *        map, resolve trong RAM (O(1) query) thay vì getManagerOfUser mỗi lịch (N+1).
 *        Sale đã nghỉ (isActive=false) VẪN báo trưởng phòng để giao lại (chỉ ngừng BẮN TIN cho sale).
 *   D4 — overlap guard + chỉ mark managerDigestedAt SAU khi gửi Zalo OK (gửi lỗi → ngày sau gửi lại).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { sendSystemNotificationToUser } from '../system-notifications/system-notify-service.js';

/** Offset phút từ chuỗi tz "+07:00". Sai → +07:00 (VN). */
function parseOffsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz || '');
  if (!m) return 420;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/** Mốc 00:00 hôm nay theo MÚI GIỜ org (epoch ms) — để lọc "đã digest hôm nay chưa". */
function startOfTodayOrgMs(tz: string): number {
  const offsetMin = parseOffsetMinutes(tz);
  const local = new Date(Date.now() + offsetMin * 60_000);
  const startWallUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0);
  return startWallUtc - offsetMin * 60_000;
}

/** Hiển thị "HH:mm DD/MM" (tz VN) cho dòng checklist. */
function fmtWhen(date: Date, timeStr: string | null): string {
  const dmy = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(date);
  const t = timeStr?.trim()
    || new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${t} ${dmy}`;
}

let digestRunning = false;

/**
 * Quét toàn hệ thống (mọi org), gửi digest lịch-chưa-hoàn-thành cho trưởng phòng.
 * Gọi từ cron 08:00 VN trong cron-event-scheduler.
 */
export async function sendManagerAppointmentDigest(): Promise<{ sent: number }> {
  if (digestRunning) {
    logger.info('[appt-digest] đang chạy, skip nhịp này (overlap guard)');
    return { sent: 0 };
  }
  digestRunning = true;
  let totalSent = 0;
  try {
    const orgs = await runSystemQuery(() =>
      prisma.organization.findMany({
        select: { id: true, timezone: true, appointmentDigestStopDays: true, appointmentZaloReminderEnabled: true },
      }),
    );
    for (const org of orgs) {
      if (!org.appointmentZaloReminderEnabled) continue;
      try {
        const sent = await digestForOrg(org.id, org.timezone || '+07:00', org.appointmentDigestStopDays ?? 7);
        totalSent += sent;
      } catch (err) {
        logger.warn(`[appt-digest] org=${org.id} lỗi: ${(err as Error).message}`);
      }
    }
    if (totalSent > 0) logger.info(`[appt-digest] đã gửi ${totalSent} digest trưởng phòng`);
    return { sent: totalSent };
  } catch (err) {
    logger.error('[appt-digest] sweep error:', err);
    return { sent: totalSent };
  } finally {
    digestRunning = false;
  }
}

async function digestForOrg(orgId: string, tz: string, stopDays: number): Promise<number> {
  return withTenant(orgId, async () => {
    const todayStart = new Date(startOfTodayOrgMs(tz));
    const stopCutoff = stopDays > 0 ? new Date(Date.now() - stopDays * 24 * 3600_000) : null;

    // Lịch đã nhắc đủ 3 lần, chưa xong, chưa digest hôm nay.
    const candidates = await prisma.appointment.findMany({
      where: {
        status: { in: ['scheduled', 'overdue'] },
        actionPromptCount: { gte: 3 },
        assignedUserId: { not: null },
        OR: [{ managerDigestedAt: null }, { managerDigestedAt: { lt: todayStart } }],
      },
      select: {
        id: true, appointmentDate: true, appointmentTime: true, assignedUserId: true,
        managerDigestFirstAt: true,
        contact: { select: { fullName: true } },
        assignedUser: { select: { fullName: true } },
      },
      take: 1000,
    });
    if (!candidates.length) return 0;

    // D2: dừng digest sau stopDays ngày kể từ lần đầu.
    const live = stopCutoff
      ? candidates.filter((c) => !c.managerDigestFirstAt || c.managerDigestFirstAt.getTime() >= stopCutoff.getTime())
      : candidates;
    if (!live.length) return 0;

    // D3: batch resolve trưởng phòng (1 lần/nhịp).
    const resolveManager = await buildManagerResolver();

    // Nhóm theo trưởng phòng.
    type DigestItem = (typeof live)[number];
    const byManager = new Map<string, DigestItem[]>();
    for (const c of live) {
      const mgr = resolveManager(c.assignedUserId as string);
      if (!mgr) {
        logger.warn(`[appt-digest] lịch ${c.id} (sale ${c.assignedUserId}) không có trưởng phòng → bỏ qua`);
        continue;
      }
      const arr: DigestItem[] = byManager.get(mgr) ?? [];
      arr.push(c);
      byManager.set(mgr, arr);
    }

    let sent = 0;
    const now = new Date();
    for (const [managerId, items] of byManager) {
      const lines = items.map((c) => {
        const kh = c.contact?.fullName?.trim() || 'khách';
        const sale = c.assignedUser?.fullName?.trim() || '(sale)';
        return `☐ ${kh} — ${sale} — ${fmtWhen(c.appointmentDate, c.appointmentTime)}`;
      });
      const content = [
        `LỊCH HẸN CHƯA HOÀN THÀNH (${items.length})`,
        'Đã nhắc đủ 3 lần mà sale chưa cập nhật. Nhờ anh/chị nhắc đội xử lý:',
        '',
        ...lines,
      ].join('\n');

      const result = await sendSystemNotificationToUser({
        orgId,
        targetUserId: managerId,
        type: 'appointment_manager_digest',
        title: 'Lịch hẹn chưa hoàn thành',
        content,
        priority: 'high',
      }).catch((e) => {
        logger.warn(`[appt-digest] gửi manager=${managerId} lỗi:`, e);
        return null;
      });

      // D4: chỉ mark khi gửi OK → gửi lỗi thì ngày sau gửi lại (không mất).
      if (result?.status === 'sent') {
        const ids = items.map((c) => c.id);
        await prisma.appointment.updateMany({ where: { id: { in: ids } }, data: { managerDigestedAt: now } });
        // Set mốc digest ĐẦU chỉ cho lịch chưa có (để tính N-day cap).
        await prisma.appointment.updateMany({
          where: { id: { in: ids }, managerDigestFirstAt: null },
          data: { managerDigestFirstAt: now },
        });
        sent++;
      }
    }
    return sent;
  });
}

/**
 * Dựng hàm resolve trưởng phòng từ sơ đồ org (nạp 1 lần). Logic KHỚP getManagerOfUser:
 *   member/deputy → leader của dept; leader → leader của dept CHA.
 */
/**
 * PURE (test được không cần DB): dựng hàm resolve trưởng phòng từ sơ đồ org. Logic KHỚP
 * getManagerOfUser: member/deputy → leader của dept; leader → leader của dept CHA.
 */
export function makeManagerResolver(
  depts: { id: string; parentId: string | null }[],
  members: { userId: string; departmentId: string; deptRole: string }[],
): (userId: string) => string | null {
  const parentByDept = new Map(depts.map((d) => [d.id, d.parentId]));
  const memberByUser = new Map(members.map((m) => [m.userId, m]));
  const leaderByDept = new Map<string, string>();
  for (const m of members) if (m.deptRole === 'leader') leaderByDept.set(m.departmentId, m.userId);

  return (userId: string): string | null => {
    const m = memberByUser.get(userId);
    if (!m) return null;
    if (m.deptRole !== 'leader') {
      const leader = leaderByDept.get(m.departmentId);
      if (leader && leader !== userId) return leader;
    }
    const parentId = parentByDept.get(m.departmentId);
    if (!parentId) return null;
    const pl = leaderByDept.get(parentId);
    return pl && pl !== userId ? pl : null;
  };
}

async function buildManagerResolver(): Promise<(userId: string) => string | null> {
  const depts = await prisma.department.findMany({ select: { id: true, parentId: true } });
  const deptIds = depts.map((d) => d.id);
  const members = await prisma.departmentMember.findMany({
    where: { departmentId: { in: deptIds } },
    select: { userId: true, departmentId: true, deptRole: true },
  });
  return makeManagerResolver(depts, members);
}
