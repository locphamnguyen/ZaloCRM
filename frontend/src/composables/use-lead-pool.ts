/**
 * use-lead-pool.ts — Phase Lead Pool 2026-05-24.
 *
 * Composable cho LeadFloatingButton + LeadRequestModal.
 * Cache eligibility state, poll cooldown countdown, fire request, force note, return.
 */
import { ref, computed, onUnmounted } from 'vue';
import { api } from '@/api/index';

export interface PoolConfig {
  enabled: boolean;
  maxRequestsPerDay: number;
  cooldownMinutes: number;
  forgottenThresholdDays: number;
  excludedStatuses: string[];
  autoReturnAfterDays: number;
  forceNoteBeforeNext: boolean;
  enabledSources: string[];
  noteMinLength: number;
}

export interface PendingNoteLead {
  leadRequestId: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  requestedAt: string;
  expiresAt: string | null;
}

export interface Eligibility {
  canRequest: boolean;
  reason?: 'cooldown' | 'daily_cap' | 'unsubmitted_note' | 'disabled' | 'no_leads';
  remainingToday: number;
  pendingNoteLead?: PendingNoteLead;
  nextAvailableAt?: string;
  config: PoolConfig;
}

export interface AutoLookupResult {
  found: boolean;
  uid?: string | null;
  nickUsed?: string | null;
  nickId?: string | null;
  zaloProfile?: {
    uid: string; zaloName: string | null; username: string | null;
    avatar: string | null; gender: number | null; dob: string | number | null;
    bio: string | null; bizPkg: any; accountStatus: number | null; isFriend: boolean | null;
  } | null;
}

export interface LeadPayload {
  leadRequestId: string;
  source: 'forgotten' | 'customer_list' | 'external_sync';
  priorityScore: number;
  expiresAt: string;
  contact: Record<string, any>;
  previousAssignee: { id: string; fullName: string; email: string; isActive: boolean } | null;
  friends: Array<any>;
  // 2026-05-28 per-nick UID semantic
  friendsByCurrentSale?: Array<any>;
  hasZaloFromMyNick?: boolean;
  autoLookup?: AutoLookupResult | null;
  recentNotes: Array<any>;
  recentAppointments: Array<any>;
  insights: { daysIdle: number | null; noShowCount: number; acceptedFriendCount: number; totalMessages: number; hadHotMoment: boolean };
  suggestedOpenings: string[];
}

const eligibility = ref<Eligibility | null>(null);
const loading = ref(false);
const error = ref('');
const requesting = ref(false);

const tickNow = ref(Date.now());
let tickTimer: number | null = null;

function startTicker() {
  if (tickTimer) return;
  tickTimer = window.setInterval(() => { tickNow.value = Date.now(); }, 1000);
}
function stopTicker() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

const cooldownSecondsLeft = computed(() => {
  if (!eligibility.value?.nextAvailableAt) return 0;
  const diff = new Date(eligibility.value.nextAvailableAt).getTime() - tickNow.value;
  return Math.max(0, Math.ceil(diff / 1000));
});

const cooldownLabel = computed(() => {
  const s = cooldownSecondsLeft.value;
  if (s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
});

export function useLeadPool() {
  async function fetchEligibility() {
    loading.value = true;
    try {
      const { data } = await api.get('/lead-pool/eligibility');
      eligibility.value = data;
      if (data.nextAvailableAt) startTicker();
    } catch (err: any) {
      // 401 = chưa login, silent
      if (err?.response?.status !== 401) {
        console.warn('[lead-pool] eligibility failed:', err?.response?.data || err);
      }
    } finally {
      loading.value = false;
    }
  }

  async function requestNewLead(): Promise<LeadPayload | null> {
    requesting.value = true;
    error.value = '';
    try {
      const { data } = await api.post('/lead-pool/request');
      // Re-fetch eligibility để update remaining count + cooldown
      await fetchEligibility();
      return data;
    } catch (err: any) {
      const resp = err?.response?.data;
      error.value = resp?.error || 'Không xin được lead';
      // Nếu unsubmitted_note → re-sync eligibility để FE biết force note
      if (resp?.code === 'unsubmitted_note') {
        eligibility.value = { ...resp.meta };
      }
      return null;
    } finally {
      requesting.value = false;
    }
  }

  async function submitNote(leadRequestId: string, noteContent: string) {
    error.value = '';
    try {
      await api.post(`/lead-pool/${leadRequestId}/note`, { noteContent });
      await fetchEligibility();
      return true;
    } catch (err: any) {
      error.value = err?.response?.data?.error || 'Không lưu được note';
      return false;
    }
  }

  async function returnLead(leadRequestId: string, reason?: string) {
    error.value = '';
    try {
      await api.post(`/lead-pool/${leadRequestId}/return`, { reason });
      await fetchEligibility();
      return true;
    } catch (err: any) {
      error.value = err?.response?.data?.error || 'Không trả được lead';
      return false;
    }
  }

  async function getMyHistory(limit = 30) {
    const { data } = await api.get('/lead-pool/my-history', { params: { limit } });
    return data;
  }

  async function fetchStats() {
    try {
      const { data } = await api.get('/lead-pool/stats');
      return data;
    } catch (err: any) {
      console.warn('[lead-pool] stats failed:', err?.response?.data || err);
      return null;
    }
  }

  onUnmounted(stopTicker);

  return {
    eligibility,
    loading,
    error,
    requesting,
    cooldownSecondsLeft,
    cooldownLabel,
    fetchEligibility,
    requestNewLead,
    submitNote,
    returnLead,
    getMyHistory,
    fetchStats,
    startTicker,
    stopTicker,
  };
}
