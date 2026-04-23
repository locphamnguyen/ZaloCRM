/**
 * use-profile.ts — Composable for Zalo account profile management.
 * Wraps REST API calls for profile info, avatar CRUD, status toggle,
 * and credential import/export.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface ZaloProfile {
  displayName?: string;
  zaloName?: string;
  username?: string;
  uid?: string;
  gender?: number;
  dob?: number;
  sdob?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

export interface AvatarItem {
  id: string;
  url?: string;
  hdUrl?: string;
  [key: string]: unknown;
}

export function useProfile(accountId: string) {
  const profile = ref<ZaloProfile | null>(null);
  const avatars = ref<AvatarItem[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');

  // ── Fetch profile ─────────────────────────────────────────────────────────

  async function fetchProfile(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/profile`);
      profile.value = res.data.profile ?? res.data;
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Không thể tải thông tin tài khoản';
    } finally {
      loading.value = false;
    }
  }

  // ── Update profile (name / gender / birthday) ─────────────────────────────

  async function updateProfile(params: {
    name?: string;
    gender?: 0 | 1;
    dob?: string;
  }): Promise<boolean> {
    saving.value = true;
    error.value = '';
    try {
      await api.patch(`/zalo-accounts/${accountId}/profile`, params);
      await fetchProfile();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Cập nhật thất bại';
      return false;
    } finally {
      saving.value = false;
    }
  }

  // ── Avatar operations ─────────────────────────────────────────────────────

  async function fetchAvatars(): Promise<void> {
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/profile/avatars`);
      avatars.value = res.data.avatars ?? [];
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Không thể tải danh sách ảnh đại diện';
    }
  }

  async function uploadAvatar(filePath: string): Promise<boolean> {
    saving.value = true;
    error.value = '';
    try {
      await api.patch(`/zalo-accounts/${accountId}/profile/avatar`, { filePath });
      await fetchProfile();
      await fetchAvatars();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Tải ảnh đại diện thất bại';
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function deleteAvatar(avatarId: string): Promise<boolean> {
    saving.value = true;
    error.value = '';
    try {
      await api.delete(`/zalo-accounts/${accountId}/profile/avatars/${avatarId}`);
      await fetchAvatars();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Xóa ảnh đại diện thất bại';
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function reuseAvatar(avatarId: string): Promise<boolean> {
    saving.value = true;
    error.value = '';
    try {
      await api.post(`/zalo-accounts/${accountId}/profile/avatars/${avatarId}/reuse`);
      await fetchProfile();
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Khôi phục ảnh đại diện thất bại';
      return false;
    } finally {
      saving.value = false;
    }
  }

  // ── Online status ─────────────────────────────────────────────────────────

  async function setStatus(online: boolean): Promise<boolean> {
    saving.value = true;
    error.value = '';
    try {
      await api.put(`/zalo-accounts/${accountId}/profile/status`, {
        status: online ? 'online' : 'offline',
      });
      return true;
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Cập nhật trạng thái thất bại';
      return false;
    } finally {
      saving.value = false;
    }
  }

  // ── Last online ───────────────────────────────────────────────────────────

  async function getLastOnline(userId: string): Promise<unknown> {
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/profile/last-online/${userId}`);
      return res.data.lastOnline;
    } catch {
      return null;
    }
  }

  // ── Credentials ───────────────────────────────────────────────────────────

  async function exportCredentials(): Promise<void> {
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/credentials/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      const disp = res.headers['content-disposition'] as string | undefined;
      const match = disp?.match(/filename="([^"]+)"/);
      a.href = url;
      a.download = match?.[1] ?? `zalo-credentials-${accountId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      error.value = err.response?.data?.error ?? 'Xuất thông tin xác thực thất bại';
    }
  }

  async function importCredentials(jsonContent: string): Promise<boolean> {
    saving.value = true;
    error.value = '';
    try {
      const parsed = JSON.parse(jsonContent);
      await api.post(`/zalo-accounts/${accountId}/credentials/import`, parsed);
      return true;
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        error.value = 'File JSON không hợp lệ';
      } else {
        error.value = err.response?.data?.error ?? 'Nhập thông tin xác thực thất bại';
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  return {
    profile,
    avatars,
    loading,
    saving,
    error,
    fetchProfile,
    updateProfile,
    fetchAvatars,
    uploadAvatar,
    deleteAvatar,
    reuseAvatar,
    setStatus,
    getLastOnline,
    exportCredentials,
    importCredentials,
  };
}
