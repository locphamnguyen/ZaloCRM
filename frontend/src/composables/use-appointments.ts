// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable for appointment (lịch hẹn) management:
 * - List with filters (date range, status, contact)
 * - CRUD operations
 * - Today / upcoming shortcuts
 */
import { ref, reactive } from 'vue';
import { api } from '@/api/index';

export interface Appointment {
  id: string;
  contactId: string;
  contact?: { id: string; fullName: string | null; phone: string | null; avatarUrl?: string | null; zaloUid?: string | null };
  appointmentDate: string;
  appointmentTime: string;
  // 2026-05-21 "Nhắc hẹn" fields
  title?: string | null;
  durationMin?: number;
  location?: string | null;
  type: string;
  status: string;
  notes: string | null;
  createdAt: string;
  // Phase A: phân biệt nguồn + link sang Zalo conversation
  source: 'manual' | 'zalo';
  externalRef: string | null;
  zaloMessageId: string | null;
  emoji: string | null;
  conversationId: string | null; // resolve từ backend join với Message.conversation
  // Audit: ai đổi status cuối + lúc nào (cron auto-flip không set)
  statusChangedAt: string | null;
  statusChangedBy: { id: string; fullName: string | null; email: string } | null;
  // Người phụ trách lịch hẹn (BE trả qua APPOINTMENT_INCLUDE). Dùng cho màu/filter theo sale.
  assignedUserId?: string | null;
  assignedUser?: { id: string; fullName: string | null } | null;
  // Alias cũ — code AppointmentEditor dùng assignedTo?.id (merge từ stash khi giải
  // conflict 2026-06-11, giữ để không vỡ component). durationMin đã khai báo ở trên.
  assignedToId?: string | null;
  assignedTo?: { id: string; fullName: string | null; email: string } | null;
}

export interface AppointmentFilters {
  from: string;
  to: string;
  status: string;
  contactId: string;
  source: 'all' | 'manual' | 'zalo'; // filter chip
}

// 5 trạng thái: 'scheduled' (chưa đến giờ) → cron auto-flip → 'overdue' khi quá hạn.
// Sale mark thủ công sang completed/cancelled/no_show.
export const APPOINTMENT_STATUS_OPTIONS = [
  { text: 'Đã lên lịch', value: 'scheduled' },
  { text: 'Quá hạn', value: 'overdue' },
  { text: 'Hoàn thành', value: 'completed' },
  { text: 'Đã huỷ', value: 'cancelled' },
  { text: 'Vắng mặt', value: 'no_show' },
];

// 2026-05-21 chốt: 4 loại nhắc hẹn cho domain BĐS (rename từ healthcare).
// Migration data cũ trong appointments table:
//   reminder / tai_kham → follow_up (catchall "Theo dõi")
//   new_visit           → meeting (Gặp mặt)
//   consultation        → call (Gọi điện)
//   other               → follow_up
export const APPOINTMENT_TYPE_OPTIONS = [
  { text: 'Gọi điện', value: 'call' },
  { text: 'Nhắn tin', value: 'message' },
  { text: 'Gặp mặt', value: 'meeting' },
  { text: 'Theo dõi', value: 'follow_up' },
];

export function statusChipColor(status: string): string {
  switch (status) {
    case 'scheduled': return 'blue';
    case 'overdue': return 'orange'; // cam để cảnh báo sale cần action
    case 'completed': return 'green';
    case 'cancelled': return 'grey';
    case 'no_show': return 'red';
    default: return 'grey';
  }
}

export function statusLabel(status: string): string {
  return APPOINTMENT_STATUS_OPTIONS.find(o => o.value === status)?.text ?? status;
}

// Deterministic sale color palette — mỗi sale luôn cùng 1 màu xuyên view
const SALE_PALETTE = [
  { bg: '#2f6ee5', soft: '#e8f0fe' }, // blue
  { bg: '#16a34a', soft: '#dcfce7' }, // green
  { bg: '#d97706', soft: '#fef3c7' }, // amber
  { bg: '#7c3aed', soft: '#ede9fe' }, // purple
  { bg: '#db2777', soft: '#fce7f3' }, // pink
  { bg: '#0891b2', soft: '#cffafe' }, // cyan
  { bg: '#dc2626', soft: '#fee2e2' }, // red
  { bg: '#65a30d', soft: '#ecfccb' }, // lime
];

export function saleColor(userId: string | null | undefined): { bg: string; soft: string } {
  if (!userId) return { bg: '#64748b', soft: '#f1f5f9' };
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return SALE_PALETTE[h % SALE_PALETTE.length];
}

export function appointmentOwnerId(a: Appointment): string | null {
  return a.assignedUserId || a.statusChangedBy?.id || null;
}

export function appointmentOwnerName(a: Appointment): string {
  return a.assignedUser?.fullName || a.statusChangedBy?.fullName || a.statusChangedBy?.email || 'Chưa gán';
}

export function typeIcon(type: string): string {
  switch (type) {
    case 'consultation': return '💬';
    case 'follow_up': return '🔁';
    case 'new_visit': return '🆕';
    default: return '📌';
  }
}

export function typeLabel(type: string): string {
  return APPOINTMENT_TYPE_OPTIONS.find(o => o.value === type)?.text ?? type;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Build a Date from `appointmentDate` (ISO) — luôn trust field này, KHÔNG dùng appointmentTime string
export function appointmentStart(a: Appointment): Date {
  return new Date(a.appointmentDate);
}
export function appointmentEnd(a: Appointment): Date {
  const start = appointmentStart(a);
  const dur = a.durationMin ?? 30;
  return new Date(start.getTime() + dur * 60_000);
}

export function useAppointments() {
  const appointments = ref<Appointment[]>([]);
  const todayAppointments = ref<Appointment[]>([]);
  const upcomingAppointments = ref<Appointment[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const saving = ref(false);
  const deleting = ref(false);

  const filters = reactive<AppointmentFilters>({
    from: '',
    to: '',
    status: '',
    contactId: '',
    source: 'all',
  });
  const sourceCounts = ref<Record<string, number>>({});

  async function fetchAppointments() {
    loading.value = true;
    try {
      const res = await api.get('/appointments', {
        params: {
          dateFrom: filters.from || undefined,
          dateTo: filters.to || undefined,
          status: filters.status || undefined,
          contactId: filters.contactId || undefined,
          source: filters.source === 'all' ? undefined : filters.source,
        },
      });
      appointments.value = res.data.appointments ?? res.data;
      total.value = res.data.total ?? appointments.value.length;
      sourceCounts.value = res.data.counts ?? {};
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchToday() {
    try {
      const res = await api.get('/appointments/today');
      todayAppointments.value = res.data.appointments ?? res.data;
    } catch (err) {
      console.error('Failed to fetch today appointments:', err);
    }
  }

  async function fetchUpcoming() {
    try {
      const res = await api.get('/appointments/upcoming');
      upcomingAppointments.value = res.data.appointments ?? res.data;
    } catch (err) {
      console.error('Failed to fetch upcoming appointments:', err);
    }
  }

  async function createAppointment(payload: Partial<Appointment>): Promise<Appointment | null> {
    saving.value = true;
    try {
      const res = await api.post('/appointments', payload);
      return res.data;
    } catch (err) {
      console.error('Failed to create appointment:', err);
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function updateAppointment(id: string, payload: Partial<Appointment>): Promise<boolean> {
    saving.value = true;
    try {
      await api.put(`/appointments/${id}`, payload);
      const idx = appointments.value.findIndex(a => a.id === id);
      if (idx !== -1) appointments.value[idx] = { ...appointments.value[idx], ...payload };
      return true;
    } catch (err) {
      console.error('Failed to update appointment:', err);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function deleteAppointment(id: string): Promise<boolean> {
    deleting.value = true;
    try {
      await api.delete(`/appointments/${id}`);
      appointments.value = appointments.value.filter(a => a.id !== id);
      return true;
    } catch (err) {
      console.error('Failed to delete appointment:', err);
      return false;
    } finally {
      deleting.value = false;
    }
  }

  // Đổi status qua PATCH endpoint dedicate → backend tự set statusChangedByUserId/At
  async function changeStatus(id: string, status: 'completed' | 'cancelled' | 'no_show' | 'scheduled' | 'overdue'): Promise<boolean> {
    saving.value = true;
    try {
      const res = await api.patch(`/appointments/${id}/status`, { status });
      const idx = appointments.value.findIndex(a => a.id === id);
      if (idx !== -1) appointments.value[idx] = { ...appointments.value[idx], ...res.data };
      return true;
    } catch (err) {
      console.error('Failed to change status:', err);
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function markComplete(id: string): Promise<boolean> {
    return changeStatus(id, 'completed');
  }

  async function cancelAppointment(id: string): Promise<boolean> {
    return changeStatus(id, 'cancelled');
  }

  async function markNoShow(id: string): Promise<boolean> {
    return changeStatus(id, 'no_show');
  }

  return {
    appointments, todayAppointments, upcomingAppointments,
    total, sourceCounts, loading, saving, deleting,
    filters,
    fetchAppointments, fetchToday, fetchUpcoming,
    createAppointment, updateAppointment, deleteAppointment,
    markComplete, cancelAppointment, markNoShow, changeStatus,
  };
}
