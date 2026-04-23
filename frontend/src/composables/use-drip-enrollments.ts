import { ref } from 'vue';
import {
  listEnrollments,
  enroll,
  pauseEnrollment,
  resumeEnrollment,
  cancelEnrollment,
  getEnrollmentLogs,
  bulkEnrollmentAction,
  type DripEnrollment,
  type DripLog,
  type EnrollmentFilters,
} from '@/api/drip-api';

export type { DripEnrollment, DripLog };

export function useDripEnrollments() {
  const enrollments = ref<DripEnrollment[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const acting = ref(false);
  const logs = ref<DripLog[]>([]);
  const logsLoading = ref(false);

  async function fetchEnrollments(filters: EnrollmentFilters = {}) {
    loading.value = true;
    try {
      const res = await listEnrollments(filters);
      enrollments.value = res.items;
      total.value = res.total;
    } catch (err) {
      console.error('fetchEnrollments error:', err);
    } finally {
      loading.value = false;
    }
  }

  async function enrollContacts(campaignId: string, contactIds: string[]): Promise<boolean> {
    acting.value = true;
    try {
      await enroll(campaignId, { contactIds });
      return true;
    } catch (err) {
      console.error('enroll error:', err);
      return false;
    } finally {
      acting.value = false;
    }
  }

  async function pause(id: string): Promise<boolean> {
    acting.value = true;
    try {
      const updated = await pauseEnrollment(id);
      _updateLocal(updated);
      return true;
    } catch (err) {
      console.error('pauseEnrollment error:', err);
      return false;
    } finally {
      acting.value = false;
    }
  }

  async function resume(id: string): Promise<boolean> {
    acting.value = true;
    try {
      const updated = await resumeEnrollment(id);
      _updateLocal(updated);
      return true;
    } catch (err) {
      console.error('resumeEnrollment error:', err);
      return false;
    } finally {
      acting.value = false;
    }
  }

  async function cancel(id: string): Promise<boolean> {
    acting.value = true;
    try {
      const updated = await cancelEnrollment(id);
      _updateLocal(updated);
      return true;
    } catch (err) {
      console.error('cancelEnrollment error:', err);
      return false;
    } finally {
      acting.value = false;
    }
  }

  async function fetchLogs(id: string): Promise<DripLog[]> {
    logsLoading.value = true;
    try {
      logs.value = await getEnrollmentLogs(id);
      return logs.value;
    } catch (err) {
      console.error('getEnrollmentLogs error:', err);
      return [];
    } finally {
      logsLoading.value = false;
    }
  }

  async function bulkAction(
    campaignId: string,
    action: 'pause' | 'resume' | 'cancel',
    status: string,
  ): Promise<number> {
    acting.value = true;
    try {
      const res = await bulkEnrollmentAction(campaignId, { action, filter: { status } });
      return res.affected;
    } catch (err) {
      console.error('bulkAction error:', err);
      return 0;
    } finally {
      acting.value = false;
    }
  }

  function _updateLocal(updated: DripEnrollment) {
    const idx = enrollments.value.findIndex((e) => e.id === updated.id);
    if (idx !== -1) enrollments.value[idx] = { ...enrollments.value[idx], ...updated };
  }

  return {
    enrollments,
    total,
    loading,
    acting,
    logs,
    logsLoading,
    fetchEnrollments,
    enrollContacts,
    pause,
    resume,
    cancel,
    fetchLogs,
    bulkAction,
  };
}
