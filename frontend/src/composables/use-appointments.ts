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

export const APPOINTMENT_TYPE_OPTIONS = [
  { text: 'Tái khám', value: 'follow_up' },
  { text: 'Khám mới', value: 'new_visit' },
  { text: 'Tư vấn', value: 'consultation' },
  { text: 'Khác', value: 'other' },
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

  async function markComplete(id: string): Promise<boolean> {
    return updateAppointment(id, { status: 'completed' } as Partial<Appointment>);
  }

  async function cancelAppointment(id: string): Promise<boolean> {
    return updateAppointment(id, { status: 'cancelled' } as Partial<Appointment>);
  }

  return {
    appointments, todayAppointments, upcomingAppointments,
    total, sourceCounts, loading, saving, deleting,
    filters,
    fetchAppointments, fetchToday, fetchUpcoming,
    createAppointment, updateAppointment, deleteAppointment,
    markComplete, cancelAppointment,
  };
}
