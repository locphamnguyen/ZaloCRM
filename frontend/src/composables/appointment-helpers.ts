// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Pure helper utilities for appointment UI — color palette, formatting, time math.
 * Separate from use-appointments.ts (stateful composable) to keep that file lean
 * and so SFCs can import these without pulling the composable into every render path.
 */
import type { Appointment } from './use-appointments';
import { APPOINTMENT_TYPE_OPTIONS, APPOINTMENT_STATUS_OPTIONS } from './use-appointments';
import { orgDayKey, orgWallClockToUtc } from './use-org-timezone';

// Re-export so component imports stay short
export { APPOINTMENT_TYPE_OPTIONS, APPOINTMENT_STATUS_OPTIONS };

/**
 * Extended appointment fields that the backend may or may not populate yet.
 * UI degrades gracefully when absent.
 *
 * Lưu ý tên cột: BE (schema Appointment) dùng assignedUserId / assignedUser — KHÔNG
 * phải assignedToId. Giữ alias assignedToId/assignedTo (legacy) phòng nơi khác đọc,
 * nhưng appointmentOwnerId/Name ưu tiên tên cột THẬT (assignedUserId/assignedUser).
 */
export interface AppointmentExtras {
  assignedUserId?: string | null;
  assignedUser?: { id: string; fullName: string | null } | null;
  // Legacy aliases (giữ tương thích, không phải tên cột DB)
  assignedToId?: string | null;
  assignedTo?: { id: string; fullName: string | null; email: string } | null;
  durationMin?: number | null;
}

export type AppointmentEx = Appointment & AppointmentExtras;

const SALE_PALETTE = [
  { bg: '#2f6ee5', soft: '#e8f0fe' },
  { bg: '#16a34a', soft: '#dcfce7' },
  { bg: '#d97706', soft: '#fef3c7' },
  { bg: '#7c3aed', soft: '#ede9fe' },
  { bg: '#db2777', soft: '#fce7f3' },
  { bg: '#0891b2', soft: '#cffafe' },
  { bg: '#dc2626', soft: '#fee2e2' },
  { bg: '#65a30d', soft: '#ecfccb' },
];

export function saleColor(userId: string | null | undefined): { bg: string; soft: string } {
  if (!userId) return { bg: '#64748b', soft: '#f1f5f9' };
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return SALE_PALETTE[h % SALE_PALETTE.length];
}

export function appointmentOwnerId(a: AppointmentEx): string | null {
  // Ưu tiên tên cột THẬT (assignedUserId), fallback alias legacy + statusChangedBy.
  return a.assignedUserId || a.assignedUser?.id || a.assignedToId || a.statusChangedBy?.id || null;
}

export function appointmentOwnerName(a: AppointmentEx): string {
  return (
    a.assignedUser?.fullName ||
    a.assignedTo?.fullName ||
    a.statusChangedBy?.fullName ||
    a.statusChangedBy?.email ||
    'Chưa gán'
  );
}

export function typeIcon(type: string): string {
  switch (type) {
    case 'call':      return '📞';
    case 'message':   return '💬';
    case 'meeting':   return '🤝';
    case 'follow_up': return '👁';
    // Legacy values (pre-2026-05-21 migration) — fallback an toàn
    case 'consultation': return '💬';
    case 'new_visit':    return '🤝';
    case 'reminder':     return '👁';
    case 'tai_kham':     return '👁';
    default: return '📌';
  }
}

/**
 * Type → signature tint cho icon container (mockup nhac-hen-editor 2026-05-21).
 */
export function typeTint(type: string): { bg: string; text: string } {
  switch (type) {
    case 'call':      return { bg: '#fdf0e3', text: '#7a4115' };
    case 'message':   return { bg: '#e8f4ee', text: '#1f4d39' };
    case 'meeting':   return { bg: '#fbe6dc', text: '#7a2000' };
    case 'follow_up': return { bg: '#fdf3df', text: '#7a5818' };
    default: return { bg: '#f8fafc', text: '#41454d' };
  }
}

/**
 * Type → dark bg color cho week-view event cards (saleColor không còn, thay bằng
 * type color để sale phân biệt nhanh task call vs meeting vs message).
 * Anh chốt 4 màu 2026-05-21:
 *   call (📞)      → blue   — communication chuyên nghiệp
 *   message (💬)   → green  — text nhanh gọn
 *   meeting (🤝)   → violet — in-person quan trọng nhất, distinct
 *   follow_up (👁) → amber  — gentle attention, watch
 */
export function typeBgColor(type: string | null | undefined): string {
  switch (type) {
    case 'call':         return '#2563eb'; // blue-600
    case 'message':      return '#16a34a'; // green-600
    case 'meeting':      return '#7c3aed'; // violet-600
    case 'follow_up':    return '#d97706'; // amber-600
    // Legacy values (pre-2026-05-21) — map về palette mới
    case 'consultation': return '#16a34a';
    case 'new_visit':    return '#7c3aed';
    case 'reminder':     return '#d97706';
    case 'tai_kham':     return '#d97706';
    default:             return '#475569'; // slate-600 fallback
  }
}

export function typeLabel(type: string): string {
  return APPOINTMENT_TYPE_OPTIONS.find(o => o.value === type)?.text ?? type;
}

export function statusLabel(status: string): string {
  return APPOINTMENT_STATUS_OPTIONS.find(o => o.value === status)?.text ?? status;
}

/**
 * AI parse result từ ghi chú → fill các trường tạo lịch hẹn (AppointmentEditor).
 * Sản sinh bởi cascade backend `parseAppointmentFromText`:
 *   Step 1: parseAppointmentRuleBased (regex tiếng Việt: "thứ X", "mai", "ghé", ...)
 *   Step 2: AI provider (Gemini default) với prompt phân tích structured JSON
 *   Fallback: nếu AI fail (quota/429) → trả rule-based result (nếu confidence ≥ 0.5)
 * Field nào null → editor giữ default (date/time → roundToNextSlot now).
 */
export interface AiPrefill {
  date?: string | null;       // YYYY-MM-DD
  time?: string | null;       // HH:MM
  type?: string | null;       // call/message/meeting/follow_up
  location?: string | null;
  title?: string | null;      // = summary AI sinh
  notes?: string | null;      // = note body gốc (tham chiếu)
}

/**
 * Resolve avatar URL từ contact: ưu tiên Contact.avatarUrl (manual upload), fallback
 * sang Friend.zaloAvatarUrl của friend hoạt động gần nhất (per-nick Zalo profile pic).
 * KH import từ Zalo thường có Contact.avatarUrl=null vì avatar lưu per-nick ở Friend.
 */
export function resolveContactAvatar(contact: any): string | null {
  if (!contact) return null;
  if (contact.avatarUrl) return contact.avatarUrl;
  const friends = contact.friends || [];
  for (const f of friends) {
    if (f?.zaloAvatarUrl) return f.zaloAvatarUrl;
  }
  return null;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * FIX 2026-06-09 (Anh báo "auto 7h"): appointmentDate lưu NGÀY (timestamp 00:00 UTC),
 * giờ THẬT nằm ở appointmentTime ("HH:mm" wall-clock org). Bản cũ chỉ `new Date(appointmentDate)`
 * → bỏ giờ → mọi event dán cứng 07:00 (midnight UTC +7 ở giờ VN). Giờ GHÉP ngày (org-local
 * day của appointmentDate) + appointmentTime → UTC instant đúng. Fallback: appointmentTime
 * rỗng → giữ giờ nhúng trong appointmentDate (data cũ vài dòng có giờ trong cột date).
 */
export function appointmentStart(a: AppointmentEx): Date {
  const dayKey = orgDayKey(a.appointmentDate);
  const t = (a.appointmentTime || '').trim();
  if (dayKey && t) {
    const combined = orgWallClockToUtc(dayKey, t);
    if (combined) return combined;
  }
  return new Date(a.appointmentDate);
}

export function appointmentEnd(a: AppointmentEx): Date {
  const start = appointmentStart(a);
  const dur = a.durationMin ?? 30;
  return new Date(start.getTime() + dur * 60_000);
}
