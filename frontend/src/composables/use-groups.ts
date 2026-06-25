// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable wrapping all group management API endpoints.
 * All methods take accountId as first param (from useSelectedAccount).
 */
import { ref } from 'vue';
import { api } from '@/api/index';

/** GroupScan lifecycle states returned by the backend. */
export type GroupScanState = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface GroupScan {
  id: string;
  state: GroupScanState;
  scope: 'selected' | 'all' | string;
  groupIds: string[];
  totalGroups: number;
  scannedGroups: number;
  memberCount: number;
  [key: string]: any;
}

export interface GroupScanMember {
  id: string;
  memberUid: string;
  displayName: string;
  zaloName: string;
  avatarUrl: string;
  isAdmin: boolean;
  isFriend: boolean;
  harvestedAt: string;
  [key: string]: any;
}

export function useGroups() {
  const groups = ref<any[]>([]);
  const selectedGroup = ref<any | null>(null);
  const members = ref<any[]>([]);
  const blocked = ref<any[]>([]);
  const pending = ref<any[]>([]);
  const loading = ref(false);
  const actionLoading = ref(false);

  /* ── Group scan (feature E1) reactive state ── */
  const scan = ref<GroupScan | null>(null);
  const scanMembers = ref<GroupScanMember[]>([]);
  const scanLoading = ref(false);
  const scanMembersLoading = ref(false);

  const base = (accountId: string) => `/zalo-accounts/${accountId}/groups`;
  const scanBase = (accountId: string) => `/zalo-accounts/${accountId}/group-scans`;

  async function fetchGroups(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(base(accountId));
      groups.value = res.data.groups ?? [];
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchGroup(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}`);
      selectedGroup.value = res.data.group;
      return res.data.group;
    } catch (err) {
      console.error('Failed to fetch group:', err);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function fetchMembers(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/members`);
      members.value = res.data.members ?? [];
    } catch (err) {
      console.error('Failed to fetch members:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createGroup(accountId: string, payload: { name: string; memberIds: string[] }) {
    actionLoading.value = true;
    try {
      const res = await api.post(base(accountId), payload);
      await fetchGroups(accountId);
      return res.data.group;
    } catch (err) {
      console.error('Failed to create group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function renameGroup(accountId: string, groupId: string, name: string) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`${base(accountId)}/${groupId}/name`, { name });
      return res.data.result;
    } catch (err) {
      console.error('Failed to rename group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function updateSettings(accountId: string, groupId: string, settings: Record<string, any>) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`${base(accountId)}/${groupId}/settings`, settings);
      return res.data.result;
    } catch (err) {
      console.error('Failed to update settings:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function addMembers(accountId: string, groupId: string, userIds: string[]) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/members`, { userIds });
      return res.data.result;
    } catch (err) {
      console.error('Failed to add members:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function removeMembers(accountId: string, groupId: string, userIds: string[]) {
    actionLoading.value = true;
    try {
      const res = await api.delete(`${base(accountId)}/${groupId}/members`, { data: { userIds } });
      return res.data.result;
    } catch (err) {
      console.error('Failed to remove members:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function addDeputy(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/deputies`, { userId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to add deputy:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function removeDeputy(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.delete(`${base(accountId)}/${groupId}/deputies/${userId}`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to remove deputy:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function transferOwnership(accountId: string, groupId: string, newOwnerId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/transfer`, { newOwnerId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to transfer ownership:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function blockMember(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/block`, { userId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to block member:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function unblockMember(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.delete(`${base(accountId)}/${groupId}/block/${userId}`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to unblock member:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function fetchBlocked(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/blocked`);
      blocked.value = res.data.blocked ?? [];
    } catch (err) {
      console.error('Failed to fetch blocked:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchPending(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/pending`);
      pending.value = res.data.pending ?? [];
    } catch (err) {
      console.error('Failed to fetch pending:', err);
    } finally {
      loading.value = false;
    }
  }

  async function getInviteLink(accountId: string, groupId: string) {
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/link`);
      return res.data.link;
    } catch (err) {
      console.error('Failed to get invite link:', err);
      return null;
    }
  }

  async function enableInviteLink(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/link/enable`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to enable invite link:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function disableInviteLink(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/link/disable`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to disable invite link:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function joinByLink(accountId: string, linkId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/groups/join-link`, { linkId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to join group by link:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function leaveGroup(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/leave`);
      await fetchGroups(accountId);
      return res.data.result;
    } catch (err) {
      console.error('Failed to leave group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function disperseGroup(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/disperse`);
      await fetchGroups(accountId);
      return res.data.result;
    } catch (err) {
      console.error('Failed to disperse group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  /* ── Group scan (feature E1) ── */

  /** Kick off a scan. Pass { all: true } to scan every group, or { groupIds }. */
  async function createScan(
    accountId: string,
    payload: { groupIds?: string[]; all?: boolean },
  ): Promise<GroupScan | null> {
    scanLoading.value = true;
    try {
      const res = await api.post(scanBase(accountId), payload);
      // Backend bọc trong { scan }. Unwrap (fallback res.data nếu sau này trả phẳng).
      scan.value = res.data?.scan ?? res.data ?? null;
      return scan.value;
    } catch (err) {
      console.error('Failed to create group scan:', err);
      return null;
    } finally {
      scanLoading.value = false;
    }
  }

  /** Poll a scan's current status. Updates `scan` and returns the latest snapshot. */
  async function fetchScanStatus(accountId: string, scanId: string): Promise<GroupScan | null> {
    try {
      const res = await api.get(`${scanBase(accountId)}/${scanId}`);
      // Backend bọc trong { scan }. Unwrap (fallback res.data nếu trả phẳng).
      scan.value = res.data?.scan ?? res.data ?? null;
      return scan.value;
    } catch (err) {
      console.error('Failed to fetch scan status:', err);
      return null;
    }
  }

  /** Fetch harvested members for a scan, optionally filtered by friend status. */
  async function fetchScanMembers(
    accountId: string,
    scanId: string,
    opts: { isFriend?: boolean; page?: number; limit?: number } = {},
  ): Promise<{ members: GroupScanMember[]; total: number }> {
    scanMembersLoading.value = true;
    try {
      const params: Record<string, any> = {};
      if (opts.isFriend !== undefined) params.isFriend = opts.isFriend;
      if (opts.page !== undefined) params.page = opts.page;
      if (opts.limit !== undefined) params.limit = opts.limit;
      const res = await api.get(`${scanBase(accountId)}/${scanId}/members`, { params });
      scanMembers.value = res.data.members ?? [];
      return { members: scanMembers.value, total: res.data.total ?? scanMembers.value.length };
    } catch (err) {
      console.error('Failed to fetch scan members:', err);
      return { members: [], total: 0 };
    } finally {
      scanMembersLoading.value = false;
    }
  }

  return {
    groups, selectedGroup, members, blocked, pending,
    loading, actionLoading,
    fetchGroups, fetchGroup, fetchMembers,
    createGroup, renameGroup, updateSettings,
    addMembers, removeMembers,
    addDeputy, removeDeputy, transferOwnership,
    blockMember, unblockMember,
    fetchBlocked, fetchPending,
    getInviteLink, enableInviteLink, disableInviteLink, joinByLink,
    leaveGroup, disperseGroup,
    // Group scan (feature E1)
    scan, scanMembers, scanLoading, scanMembersLoading,
    createScan, fetchScanStatus, fetchScanMembers,
  };
}
