/**
 * use-dashboard-action-hub.ts — Dashboard redesign 2026-05-29.
 *
 * Fetch 3 section (me/team/system) + 2 picker (users/depts) tuỳ role.
 * Render quyết định section nào hiển thị dựa trên user role + permission:
 *   - Sale            → chỉ /me (asUserId = self, picker locked)
 *   - Trưởng phòng    → /me + /team (picker mở)
 *   - Admin           → /me + /team + /system
 */
import { ref, computed } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

export interface PrivacySplit {
  public: number;
  private: number;
}

export interface MeKpi {
  unreplied: PrivacySplit;
  todayAppointments: PrivacySplit;
  dormantContacts: PrivacySplit;
  totalContacts: number;
  closedThisMonth: number;
}

export interface UrgentItem {
  conversationId: string;
  contactId?: string;
  contactName: string;
  contactAvatar?: string;
  unreadCount: number;
  lastMessageAt: string;
  nickName: string;
  status?: string;
}

export interface AppointmentItem {
  id: string;
  title: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  location: string | null;
  contactId?: string;
  contactName?: string;
}

export interface QuotaNick {
  id: string;
  displayName: string;
  isPrivate: boolean;
  messagesToday: number | null;
  friendsToday: number | null;
}

export interface MeResponse {
  targetUserId: string;
  isViewingSelf: boolean;
  kpi: MeKpi;
  urgent: UrgentItem[];
  appointments: AppointmentItem[];
  quotaNicks: QuotaNick[];
}

export interface TeamUser {
  userId: string;
  fullName: string;
  email: string;
  departmentName: string | null;
  deptRole: string | null;
  hasPrivateNick: boolean;
  privateNickCount: number;
  unreplied: PrivacySplit;
  todayAppointments: PrivacySplit;
  totalContacts: number;
  closedThisWeek: number;
}

export interface TeamResponse {
  scope: { canViewAll: boolean; deptIds: string[]; userCount: number };
  teamKpi: {
    unreplied: PrivacySplit;
    todayAppointments: PrivacySplit;
    totalContacts: number;
    closedThisWeek: number;
  };
  topUser: { userId: string; fullName: string; closedThisWeek: number } | null;
  perUser: TeamUser[];
}

export interface SystemResponse {
  orgKpi: {
    totalNicks: number;
    nickHealth: { healthy: number; overlimit: number; banned: number; offline: number; private: number };
    newLeadsThisMonth: number;
    totalContacts: number;
    auditCountToday: number;
  };
  deptRanking: Array<{
    departmentId: string;
    departmentName: string;
    memberCount: number;
    newLeadsThisMonth: number;
    closedThisMonth: number;
  }>;
  funnel: Array<{ status: string | null; count: number }>;
  recentAudit: Array<{
    id: string;
    actorName: string;
    actorId?: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface PickerUser {
  id: string;
  fullName: string;
  email: string;
  departmentId?: string;
  departmentName?: string;
  isSelf: boolean;
}

export interface PickerDept {
  id: string;
  name: string;
  path: string;
  memberCount: number;
}

export function useDashboardActionHub() {
  const auth = useAuthStore();
  const me = ref<MeResponse | null>(null);
  const team = ref<TeamResponse | null>(null);
  const system = ref<SystemResponse | null>(null);
  const pickerUsers = ref<PickerUser[]>([]);
  const pickerDepts = ref<PickerDept[]>([]);
  const pickerCanViewAll = ref(false);

  // Currently viewed user/depts (picker state)
  const viewAsUserId = ref<string | null>(null);
  const selectedDeptIds = ref<string[]>([]);

  const loadingMe = ref(false);
  const loadingTeam = ref(false);
  const loadingSystem = ref(false);

  // Role gating — section render quyết định ở component, đây chỉ helper
  const isAdmin = computed(() => auth.isAdmin);
  const hasTeamSection = computed(() => {
    // Trưởng phòng có dept_role='leader'|'deputy' hoặc admin
    if (isAdmin.value) return true;
    // FE chưa biết deptRole của user, BE đã có grant check.
    // Tạm: nếu user có legacy role 'admin'|'owner', show team. Sau Phase RBAC
    // FE đầy đủ sẽ check via /rbac/me.
    return false;
  });
  const hasSystemSection = computed(() => isAdmin.value);

  async function fetchMe(asUserId?: string | null) {
    loadingMe.value = true;
    try {
      const params = asUserId ? { asUserId } : {};
      const res = await api.get('/dashboard/action-hub/me', { params });
      me.value = res.data;
      viewAsUserId.value = asUserId ?? null;
    } catch (err: any) {
      console.error('[dashboard-hub] fetchMe error:', err?.response?.data ?? err);
      throw err;
    } finally {
      loadingMe.value = false;
    }
  }

  async function fetchTeam(deptIds?: string[]) {
    loadingTeam.value = true;
    try {
      const params = deptIds && deptIds.length > 0 ? { deptIds: deptIds.join(',') } : {};
      const res = await api.get('/dashboard/action-hub/team', { params });
      team.value = res.data;
      selectedDeptIds.value = deptIds ?? [];
    } catch (err: any) {
      // 403 nếu user không có quyền — silent fail, không crash UI
      if (err?.response?.status !== 403) {
        console.error('[dashboard-hub] fetchTeam error:', err?.response?.data ?? err);
      }
      team.value = null;
    } finally {
      loadingTeam.value = false;
    }
  }

  async function fetchSystem() {
    loadingSystem.value = true;
    try {
      const res = await api.get('/dashboard/action-hub/system');
      system.value = res.data;
    } catch (err: any) {
      if (err?.response?.status !== 403) {
        console.error('[dashboard-hub] fetchSystem error:', err?.response?.data ?? err);
      }
      system.value = null;
    } finally {
      loadingSystem.value = false;
    }
  }

  async function fetchPickerUsers() {
    try {
      const res = await api.get('/dashboard/action-hub/picker/users');
      pickerUsers.value = res.data.users;
      pickerCanViewAll.value = res.data.canViewAll;
    } catch (err) {
      console.error('[dashboard-hub] picker/users error:', err);
    }
  }

  async function fetchPickerDepts() {
    try {
      const res = await api.get('/dashboard/action-hub/picker/depts');
      pickerDepts.value = res.data.depts;
    } catch (err) {
      console.error('[dashboard-hub] picker/depts error:', err);
    }
  }

  async function fetchAll() {
    // Sale: chỉ /me. Manager/admin: parallel /me + /team + /system (system bị 403 silent).
    const tasks: Promise<void>[] = [fetchMe()];
    if (hasTeamSection.value || isAdmin.value) {
      tasks.push(fetchTeam());
      tasks.push(fetchPickerUsers());
      tasks.push(fetchPickerDepts());
    }
    if (hasSystemSection.value) {
      tasks.push(fetchSystem());
    }
    await Promise.all(tasks);
  }

  return {
    me,
    team,
    system,
    pickerUsers,
    pickerDepts,
    pickerCanViewAll,
    viewAsUserId,
    selectedDeptIds,
    loadingMe,
    loadingTeam,
    loadingSystem,
    isAdmin,
    hasTeamSection,
    hasSystemSection,
    fetchMe,
    fetchTeam,
    fetchSystem,
    fetchPickerUsers,
    fetchPickerDepts,
    fetchAll,
  };
}
