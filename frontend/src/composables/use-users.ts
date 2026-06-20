// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable for user/staff management API calls.
 * Provides CRUD operations scoped to the current org via JWT.
 */
import { ref } from 'vue';
import { api } from '@/api';

export interface OrgUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  teamId: string | null;
  createdAt: string;
  team?: { id: string; name: string } | null;
}

export function useUsers() {
  const users = ref<OrgUser[]>([]);
  const loading = ref(false);
  const error = ref('');

  async function fetchUsers() {
    loading.value = true;
    error.value = '';
    try {
      const res = await api.get('/users');
      users.value = res.data.users;
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Lỗi tải danh sách nhân viên';
    } finally {
      loading.value = false;
    }
  }

  async function createUser(data: {
    email: string;
    fullName: string;
    password: string;
    role: string;
    teamId?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.post('/users', data);
      await fetchUsers();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi tạo nhân viên' };
    }
  }

  async function updateUser(
    id: string,
    data: Partial<{ fullName: string; email: string; role: string; teamId: string; isActive: boolean }>,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.put(`/users/${id}`, data);
      await fetchUsers();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi cập nhật nhân viên' };
    }
  }

  async function resetPassword(id: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.put(`/users/${id}/password`, { password });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi đặt lại mật khẩu' };
    }
  }

  async function deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await api.delete(`/users/${id}`);
      await fetchUsers();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.response?.data?.error || 'Lỗi xóa nhân viên' };
    }
  }

  return { users, loading, error, fetchUsers, createUser, updateUser, resetPassword, deleteUser };
}
