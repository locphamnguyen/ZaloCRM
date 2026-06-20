// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * appointment-zalo-service.ts — Lịch hẹn CRM ⇄ Nhắc hẹn Zalo (2026-06-16).
 *
 * Khi sale tạo Lịch hẹn → nick thông báo hệ thống của org:
 *   (a) gửi TIN NHẮN báo về thread sale ("Đã đặt lịch hẹn…"),
 *   (b) tạo NHẮC HẸN Zalo (createReminder) trong thread đó → tới giờ Zalo tự báo sale.
 * Sau giờ hẹn `appointmentActionDelayMinutes` phút → cron gửi TIN kèm LINK token để sale
 * bấm đánh dấu Hoàn thành / Huỷ (public endpoint, không cần đăng nhập).
 *
 * Mọi lỗi Zalo đều nuốt (try/catch) — KHÔNG làm fail việc tạo/sửa Lịch hẹn ở CRM.
 */
import crypto from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import {
  sendSystemNotificationToUser,
  resolveSystemNotifyRecipient,
} from '../system-notifications/system-notify-service.js';

const THREAD_USER = 0 as const; // ThreadType.User

// ── Action token (HMAC tự ký bằng JWT_SECRET — không cần lib JWT, verify ở endpoint public) ──
interface ActionTokenPayload {
  a: string; // appointmentId
  u: string; // userId (sale được phép đánh dấu)
  o: string; // orgId
  exp: number; // epoch ms hết hạn
}
export function signActionToken(p: ActionTokenPayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyActionToken(token: string): ActionTokenPayload | null {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as ActionTokenPayload;
    if (!p.a || !p.u || !p.exp || Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}
function appBaseUrl(): string {
  return (config.appUrl || '').replace(/\/$/, '');
}
function buildActionLink(apptId: string, userId: string, orgId: string): string {
  const token = signActionToken({ a: apptId, u: userId, o: orgId, exp: Date.now() + 7 * 24 * 3600_000 });
  return `${appBaseUrl()}/appointments/action?t=${encodeURIComponent(token)}`;
}

// 2026-06-18 — Short-link: mã base62 8 ký tự từ random bytes.
function genShortCode(): string {
  const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA[bytes[i] % 62];
  return s;
}

/**
 * Mint (find-or-create) short-link cho 1 lịch. 1 mã / 1 lịch, tái dùng cả 3 lần nhắc.
 * expiresAt = now + 14 ngày (phủ dư 3 lần nhắc trong vài giờ + 7 ngày sống link). KHÔNG ném lỗi
 * (DB lỗi → fallback link dài). Link: {base}/a/{code}.
 */
export async function mintActionLink(apptId: string, userId: string, orgId: string): Promise<string> {
  try {
    const existing = await prisma.appointmentActionLink.findFirst({
      where: { appointmentId: apptId, expiresAt: { gt: new Date() } },
      select: { code: true },
    });
    if (existing) return `${appBaseUrl()}/a/${existing.code}`;
    const expiresAt = new Date(Date.now() + 14 * 24 * 3600_000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = genShortCode();
      try {
        await prisma.appointmentActionLink.create({ data: { code, appointmentId: apptId, orgId, userId, expiresAt } });
        return `${appBaseUrl()}/a/${code}`;
      } catch {
        // trùng mã (PK) → thử lại
      }
    }
  } catch (e) {
    logger.warn(`[appt-zalo] mintActionLink failed apt=${apptId}:`, e);
  }
  return buildActionLink(apptId, userId, orgId); // fallback link dài
}

// Header tin nhắc theo lần (Luật: nhãn rõ lần 1/2/3).
const PROMPT_HEADER: Record<number, string> = {
  1: '⏰ NHẮC HOÀN THÀNH LỊCH HẸN',
  2: '🔔 NHẮC HOÀN THÀNH (LẦN 2)',
  3: '❗ NHẮC HOÀN THÀNH (LẦN 3 — LẦN CUỐI)',
};

/** Builder DRY cho tin nhắc — keyed theo reminderNo (1..3). Kèm người phụ trách + dòng trấn an. */
function buildPromptMessage(a: ApptForZalo, reminderNo: number, link: string): string {
  const owner = a.assignedUser?.fullName?.trim();
  const lines = [
    PROMPT_HEADER[reminderNo] || PROMPT_HEADER[1],
    apptHeadline(a),
    '',
    apptDetailBlock(a),
  ];
  if (owner) lines.push(`• Người phụ trách: ${owner}`);
  lines.push(
    '',
    'Lịch hẹn đã diễn ra chưa? Bấm để cập nhật (Hoàn thành / Huỷ):',
    link,
    '🔒 Link nội bộ HS — an toàn 100%.',
  );
  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  call: 'Gọi điện', message: 'Nhắn tin', meeting: 'Gặp mặt', follow_up: 'Theo dõi',
};

/** Giờ + thứ + ngày: "14:30 · Thứ Ba, 17/06/2026". appointmentDate=00:00 UTC; format ở tz VN. */
function vnWhen(date: Date, timeStr?: string | null): string {
  const weekday = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long' }).format(date);
  const dmy = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  const t = timeStr?.trim()
    || new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const wd = weekday.charAt(0).toUpperCase() + weekday.slice(1); // "thứ ba" → "Thứ ba"
  return `${t} · ${wd}, ${dmy}`;
}

/** SĐT chuẩn VN để hiển thị: 84xxx/+84xxx → 0xxx. */
function phoneVN(p?: string | null): string {
  if (!p) return '';
  let s = String(p).replace(/[\s.()-]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length >= 10 && s.length <= 12) s = '0' + s.slice(2);
  return s;
}

/** Bỏ hậu tố " 📍 địa điểm" mà FE tự chèn vào tiêu đề (đã có dòng Địa điểm riêng). */
function cleanTitle(title?: string | null): string {
  if (!title) return '';
  return title.replace(/\s*📍\s*.*$/u, '').trim();
}

interface ApptForZalo {
  id: string;
  orgId: string;
  assignedUserId: string | null;
  appointmentDate: Date;
  appointmentTime: string | null;
  title: string | null;
  type: string | null;
  location: string | null;
  externalRef: string | null;
  contact: { fullName: string | null; phone: string | null } | null;
  assignedUser: { fullName: string | null } | null;
}

async function loadAppt(apptId: string): Promise<ApptForZalo | null> {
  return prisma.appointment.findUnique({
    where: { id: apptId },
    select: {
      id: true, orgId: true, assignedUserId: true, appointmentDate: true,
      appointmentTime: true, title: true, type: true, location: true, externalRef: true,
      contact: { select: { fullName: true, phone: true } },
      assignedUser: { select: { fullName: true } },
    },
  });
}

/** Khối chi tiết lịch hẹn (Khách · Thời gian · Địa điểm) — dùng chung cho mọi tin thông báo. */
function apptDetailBlock(a: ApptForZalo): string {
  const kh = a.contact?.fullName?.trim() || 'khách';
  const phone = phoneVN(a.contact?.phone);
  const loc = a.location?.trim();
  const lines = [
    `• Khách: ${kh}${phone ? ` — ${phone}` : ''}`,
    `• Thời gian: ${vnWhen(a.appointmentDate, a.appointmentTime)}`,
    `• Địa điểm: ${loc || '(chưa có)'}`,
  ];
  return lines.join('\n');
}

/** Tiêu đề lịch hẹn gọn cho dòng đầu tin (loại + KH nếu tiêu đề trống). */
function apptHeadline(a: ApptForZalo): string {
  const clean = cleanTitle(a.title);
  if (clean) return clean;
  const kh = a.contact?.fullName?.trim() || 'khách';
  const type = TYPE_LABEL[a.type || ''] || 'Lịch hẹn';
  return `${type} cho ${kh}`;
}

interface OrgZaloCfg { enabled: boolean; timezone: string }
async function loadOrgCfg(orgId: string): Promise<OrgZaloCfg> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId }, select: { appointmentZaloReminderEnabled: true, timezone: true },
  });
  return { enabled: !!org?.appointmentZaloReminderEnabled, timezone: org?.timezone || '+07:00' };
}

/** Offset phút từ chuỗi org tz "+07:00" / "-05:30". Sai định dạng → +07:00 (VN, mặc định). */
function parseOffsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz || '');
  if (!m) return 420;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/**
 * Thời điểm THẬT của lịch hẹn (epoch ms). appointmentDate lưu NGÀY (00:00 UTC), giờ thật nằm
 * ở appointmentTime "HH:mm" wall-clock org. Bản cũ dùng appointmentDate.getTime() → mọi nhắc
 * dán cứng 07:00 (00:00 UTC = 07:00 VN). GHÉP ngày-org của appointmentDate + appointmentTime →
 * instant UTC đúng. KHỚP FE appointmentStart() (fix "auto 7h" 2026-06-09). Fallback: time rỗng
 * → giữ instant nhúng trong appointmentDate (vài dòng data cũ có giờ trong cột date).
 */
export function appointmentStartMs(appointmentDate: Date, appointmentTime: string | null, tz: string): number {
  const offsetMin = parseOffsetMinutes(tz);
  const local = new Date(appointmentDate.getTime() + offsetMin * 60_000); // shift → wall-clock org
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  const tmatch = /^(\d{1,2}):(\d{2})/.exec((appointmentTime || '').trim());
  if (!tmatch) return appointmentDate.getTime();
  const h = Math.min(23, parseInt(tmatch[1], 10) || 0);
  const mi = Math.min(59, parseInt(tmatch[2], 10) || 0);
  return Date.UTC(y, mo, d, h, mi, 0, 0) - offsetMin * 60_000; // wall-clock org → UTC instant
}

function reminderTitle(a: ApptForZalo): string {
  const head = apptHeadline(a);
  const loc = a.location?.trim();
  return loc ? `${head} — ${loc}` : head;
}

// ── (1) Tạo lịch → gửi tin + tạo Nhắc hẹn Zalo ──────────────────────────────
export async function pushAppointmentOnCreate(apptId: string): Promise<void> {
  try {
    const a = await loadAppt(apptId);
    if (!a || !a.assignedUserId) return;
    const cfg = await loadOrgCfg(a.orgId);
    if (!cfg.enabled) return;

    const resolved = await resolveSystemNotifyRecipient(a.orgId, a.assignedUserId);
    if (resolved.status !== 'ready' || !resolved.senderZaloAccountId || !resolved.threadIdInSenderView) {
      logger.info(`[appt-zalo] skip push apt=${apptId}: recipient not ready (${resolved.status})`);
      return;
    }

    // (a) Tin nhắn báo đã đặt lịch — bố cục rõ ràng: tiêu đề + Khách/Thời gian/Địa điểm.
    const content = [
      `LỊCH HẸN MỚI · ${TYPE_LABEL[a.type || ''] || 'Lịch hẹn'}`,
      apptHeadline(a),
      '',
      apptDetailBlock(a),
      '',
      'Zalo sẽ nhắc bạn khi tới giờ hẹn.',
    ].join('\n');
    await sendSystemNotificationToUser({
      orgId: a.orgId,
      targetUserId: a.assignedUserId,
      type: 'appointment_created',
      title: 'Đã đặt lịch hẹn',
      content,
    }).catch((e) => logger.warn(`[appt-zalo] notify msg failed apt=${apptId}:`, e));

    // (b) Nhắc hẹn Zalo native (tới giờ Zalo tự báo).
    try {
      const rem = await zaloOps.createReminder(
        resolved.senderZaloAccountId, resolved.threadIdInSenderView, THREAD_USER,
        { title: reminderTitle(a), startTime: appointmentStartMs(a.appointmentDate, a.appointmentTime, cfg.timezone) },
      );
      const reminderId = (rem as any)?.reminderId ?? null;
      if (reminderId) {
        await prisma.appointment.update({ where: { id: apptId }, data: { externalRef: String(reminderId), reminderSent: true } });
      }
    } catch (e) {
      logger.warn(`[appt-zalo] createReminder failed apt=${apptId}:`, e);
    }
  } catch (err) {
    logger.error(`[appt-zalo] pushAppointmentOnCreate error apt=${apptId}:`, err);
  }
}

// ── (2) Đổi giờ → sửa Nhắc hẹn ───────────────────────────────────────────────
export async function syncReminderOnReschedule(apptId: string): Promise<void> {
  try {
    const a = await loadAppt(apptId);
    if (!a || !a.assignedUserId || !a.externalRef) return;
    const cfg = await loadOrgCfg(a.orgId);
    if (!cfg.enabled) return;
    const r = await resolveSystemNotifyRecipient(a.orgId, a.assignedUserId);
    if (r.status !== 'ready' || !r.senderZaloAccountId || !r.threadIdInSenderView) return;
    await zaloOps.editReminder(
      r.senderZaloAccountId, r.threadIdInSenderView, THREAD_USER,
      { title: reminderTitle(a), topicId: a.externalRef, startTime: appointmentStartMs(a.appointmentDate, a.appointmentTime, cfg.timezone) },
    ).catch((e) => logger.warn(`[appt-zalo] editReminder failed apt=${apptId}:`, e));
  } catch (err) {
    logger.error(`[appt-zalo] syncReminderOnReschedule error apt=${apptId}:`, err);
  }
}

// ── (3) Huỷ/Hoàn thành → xoá Nhắc hẹn Zalo ──────────────────────────────────
export async function removeAppointmentReminder(apptId: string): Promise<void> {
  try {
    const a = await loadAppt(apptId);
    if (!a || !a.assignedUserId || !a.externalRef) return;
    const r = await resolveSystemNotifyRecipient(a.orgId, a.assignedUserId);
    if (r.status === 'ready' && r.senderZaloAccountId && r.threadIdInSenderView) {
      await zaloOps.removeReminder(r.senderZaloAccountId, a.externalRef, r.threadIdInSenderView, THREAD_USER)
        .catch((e) => logger.warn(`[appt-zalo] removeReminder failed apt=${apptId}:`, e));
    }
    await prisma.appointment.update({ where: { id: apptId }, data: { externalRef: null } }).catch(() => {});
  } catch (err) {
    logger.error(`[appt-zalo] removeAppointmentReminder error apt=${apptId}:`, err);
  }
}

// ── (4) Cron → gửi tin nhắc kèm SHORT-LINK đánh dấu. Trả status để cron quyết tăng count.
//   'sent'    = gửi Zalo OK    → cron tăng actionPromptCount (Luật D4)
//   'failed'  = gửi lỗi/anti-spam → cron GIỮ count, nhịp sau thử lại
//   'skipped' = không đủ điều kiện (mất sale) → cron coi như đã xử lý (không retry vô hạn)
export async function sendAppointmentActionPrompt(
  apptId: string,
  reminderNo: number,
): Promise<'sent' | 'failed' | 'skipped'> {
  try {
    const a = await loadAppt(apptId);
    if (!a || !a.assignedUserId) return 'skipped';
    const link = await mintActionLink(a.id, a.assignedUserId, a.orgId);
    const content = buildPromptMessage(a, reminderNo, link);
    const result = await sendSystemNotificationToUser({
      orgId: a.orgId,
      targetUserId: a.assignedUserId,
      type: 'appointment_action',
      title: 'Cập nhật lịch hẹn',
      content,
    }).catch((e) => {
      logger.warn(`[appt-zalo] action prompt msg failed apt=${apptId}:`, e);
      return null;
    });
    return result?.status === 'sent' ? 'sent' : 'failed';
  } catch (err) {
    logger.error(`[appt-zalo] sendAppointmentActionPrompt error apt=${apptId}:`, err);
    return 'failed';
  }
}
