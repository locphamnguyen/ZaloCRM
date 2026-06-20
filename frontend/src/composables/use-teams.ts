// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable for team management API calls.
 * Provides CRUD operations for teams and member management.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface Team {
  id: string;
  name: string;
  memberCount?: number;
  createdAt?: string;
}

export interface TeamMember {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: string;
}

export function useTeams() {
  const teams = ref<Team[]>([]);
  const loading = ref(false);
  const error = ref('');

  async function fetchTeams() {
    loading.value = true;
    error.value = '';
    try {
      const res = await api.get('/teams');
      teams.value = res.data.teams ?? res.data;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Lỗi tải danh sách đội nhóm';
    } finally {
      loading.value = false;
    }
  }

  async function createTeam(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.post('/teams', { name });
      await fetchTeams();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi tạo đội nhóm' };
    }
  }

  async function updateTeam(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.put(`/teams/${id}`, { name });
      await fetchTeams();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi cập nhật đội nhóm' };
    }
  }

  async function deleteTeam(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.delete(`/teams/${id}`);
      await fetchTeams();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi xóa đội nhóm' };
    }
  }

  async function fetchMembers(teamId: string): Promise<TeamMember[]> {
    try {
      const res = await api.get(`/teams/${teamId}/members`);
      return res.data.members ?? res.data;
    } catch {
      return [];
    }
  }

  async function addMember(teamId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.post(`/teams/${teamId}/members`, { userId });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi thêm thành viên' };
    }
  }

  async function removeMember(teamId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.delete(`/teams/${teamId}/members/${userId}`);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi xóa thành viên' };
    }
  }

  return {
    teams,
    loading,
    error,
    fetchTeams,
    createTeam,
    updateTeam,
    deleteTeam,
    fetchMembers,
    addMember,
    removeMember,
  };
}
