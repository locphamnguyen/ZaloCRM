// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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
  /** Dashboard v4 — số phiên theo dõi đang mở */
  followSessions?: number;
}

// ── Dashboard v4 2026-06-11 — widget mới ──────────────────────────────────
export interface SessionsSummary {
  active: number;
  replied: number;
  paused: number;
  closedThisMonth: number;
}
export interface ReminderAppt {
  id: string;
  title: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  location: string | null;
  contactId?: string;
  contactName?: string | null;
}
export interface RemindersBlock {
  overdue: ReminderAppt[];
  today: ReminderAppt[];
  tomorrow: ReminderAppt[];
  birthdays: Array<{ id: string; contactName: string }>;
}
export interface ScoresBlock {
  leadAvg: number;
  engagementAvg: number;
  priorityHigh: number;
  leadHi: number; leadMid: number;
  engHi: number; engMid: number;
}
export interface InteractionToday {
  sent: number;
  replied: number;
  replyRate: number;
  newFriends: number;
  newLeads: number;
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
  // 2026-06-11 — preview tin nhắn cuối (đã redact theo privacy) + cờ blur + nick riêng tư
  messagePreview?: string;
  redacted?: boolean;
  isPrivateNick?: boolean;
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
  // Dashboard v4 — widget mới
  sessions?: SessionsSummary;
  reminders?: RemindersBlock;
  scores?: ScoresBlock;
  statusBreakdown?: Array<{ status: string; count: number }>;
  topTags?: Array<{ tag: string; count: number }>;
  interactionToday?: InteractionToday;
}

export interface TeamUser {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
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
  // Dashboard v4 — widget mới
  followSessions?: { active: number; replied: number };
  responsePerf?: { sent: number; replied: number; replyRate: number };
  leadPool?: { pending: number; claimedToday: number; forgotten: number };
}

export interface SystemResponse {
  orgKpi: {
    totalNicks: number;
    nickHealth: { healthy: number; overlimit: number; banned: number; offline: number; private: number };
    newLeadsThisMonth: number;
    totalContacts: number;
    auditCountToday: number;
    followSessions?: number;
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

  // Role gating — section render quyết định ở component, đây chỉ helper.
  // 2026-06-11 Dashboard v4: /profile giờ trả deptRole + canViewAll → auth.isManager
  // (leader/deputy/admin/grant view_all) quyết tab "Quản lý team". /team + /system
  // VẪN enforce RBAC ở server (requireGrant + getOwnerScope) — đây chỉ ẩn/hiện tab.
  const isAdmin = computed(() => auth.isAdmin);
  const hasTeamSection = computed(() => auth.isManager);
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
