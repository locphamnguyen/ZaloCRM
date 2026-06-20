// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { refreshOrgTimezone } from '@/composables/use-org-timezone';

interface User {
  id: string;
  email: string | null;
  phone?: string | null;
  fullName: string;
  role: string;
  orgId: string;
  orgName: string;
  orgTimezone?: string;
  // Module Cá nhân 2026-06-13 — avatar ảnh thật (null = chưa có → Avatar.vue fallback chữ cái).
  avatarUrl?: string | null;
  // Phase Onboarding v1 2026-05-24 — track first-run setup state.
  // passwordChangedAt = null → force change pw (router guard redirect /setup-password)
  passwordChangedAt?: string | null;
  onboardingDismissedAt?: string | null;
  // RBAC enforce 2026-06-08 — grants nhóm quyền của user hiện tại, dùng cho canAccess().
  grants?: Record<string, Record<string, boolean>>;
  permissionGroupName?: string | null;
  isFullAccess?: boolean;
  // Dashboard v4 2026-06-11 — vai trò phòng ban + cờ xem-tất-cả, quyết hiện mấy tab dashboard.
  deptRole?: string | null;       // 'leader' | 'deputy' | 'member' | null
  departmentId?: string | null;
  canViewAll?: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref(localStorage.getItem('token') || '');
  const needsSetup = ref(false);

  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isOwner = computed(() => user.value?.role === 'owner');
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role || ''));
  // Dashboard v4 — "trưởng phòng trở lên": admin/owner, hoặc trưởng/phó phòng, hoặc
  // có grant xem-tất-cả (vd Marketing/CEO). Dùng quyết hiện tab "Quản lý team".
  const isManager = computed(() => {
    const u = user.value;
    if (!u) return false;
    if (['owner', 'admin'].includes(u.role || '')) return true;
    if (['leader', 'deputy'].includes(u.deptRole || '')) return true;
    return u.canViewAll === true;
  });

  /**
   * RBAC enforce 2026-06-08 — kiểm user hiện tại có quyền (resource, action) không.
   * owner + admin = toàn quyền (anh chốt). Còn lại đọc grants nhóm quyền, default-deny.
   * Dùng cho router guard, lọc menu, ẩn nút thao tác.
   */
  function canAccess(resource: string, action = 'access'): boolean {
    const u = user.value;
    if (!u) return false;
    if (u.role === 'owner' || u.role === 'admin') return true;
    return u.grants?.[resource]?.[action] === true;
  }

  async function checkSetup() {
    const res = await api.get('/setup/status');
    needsSetup.value = res.data.needsSetup;
    return res.data.needsSetup;
  }

  // Phase 2 token hardening 2026-06-08 — lưu access + refresh token.
  function persistTokens(accessToken: string, refreshToken?: string) {
    token.value = accessToken;
    localStorage.setItem('token', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  }

  async function setup(data: { orgName: string; fullName: string; email: string; password: string }) {
    const res = await api.post('/setup', data);
    user.value = res.data.user;
    persistTokens(res.data.token, res.data.refreshToken);
  }

  // Phase Onboarding v1 2026-05-24 — identifier accept cả email vừa phone
  async function login(identifier: string, password: string) {
    // BE expect field 'email' nhưng accept cả phone — gửi raw identifier qua field email
    // để backward-compat (BE auto-detect '@' hoặc digit-only).
    const res = await api.post('/auth/login', { email: identifier, password });
    // Login response = { ...jwtPayload, ...getProfile } → đã chứa grants/isFullAccess.
    user.value = {
      ...res.data.user,
      avatarUrl: res.data.user.avatarUrl ?? null,
      grants: res.data.user.grants ?? {},
      permissionGroupName: res.data.user.permissionGroup?.name ?? null,
      isFullAccess: res.data.user.isFullAccess ?? false,
      deptRole: res.data.user.deptRole ?? null,
      departmentId: res.data.user.departmentId ?? null,
      canViewAll: res.data.user.canViewAll ?? false,
    };
    // Phase 2: persistTokens set token.value + lưu access + refreshToken.
    persistTokens(res.data.token, res.data.refreshToken);
  }

  async function fetchProfile() {
    try {
      const res = await api.get('/profile');
      const data = res.data;
      const tz = data.org?.timezone ?? '+07:00';
      user.value = {
        id: data.id,
        email: data.email,
        phone: data.phone ?? null,
        fullName: data.fullName,
        role: data.role,
        orgId: data.orgId,
        orgName: data.org?.name ?? '',
        orgTimezone: tz,
        avatarUrl: data.avatarUrl ?? null,
        passwordChangedAt: data.passwordChangedAt ?? null,
        onboardingDismissedAt: data.onboardingDismissedAt ?? null,
        grants: data.grants ?? {},
        permissionGroupName: data.permissionGroup?.name ?? null,
        isFullAccess: data.isFullAccess ?? false,
        deptRole: data.deptRole ?? null,
        departmentId: data.departmentId ?? null,
        canViewAll: data.canViewAll ?? false,
      };
      refreshOrgTimezone(tz);
    } catch {
      logout();
    }
  }

  function logout() {
    // Revoke refresh token family phía server (fire-and-forget — không chặn UI).
    const rt = localStorage.getItem('refreshToken');
    if (rt) api.post('/auth/logout', { refreshToken: rt }).catch(() => {});
    token.value = '';
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }

  async function init() {
    if (token.value) {
      await fetchProfile();
    }
  }

  // Module Cá nhân 2026-06-13 — patch store cục bộ sau khi đổi tên/avatar trên trang
  // "Tài khoản của tôi" → top nav + mọi chỗ dùng user đổi TỨC THÌ, không cần fetchProfile lại.
  function updateProfile(patch: { fullName?: string; avatarUrl?: string | null }) {
    if (!user.value) return;
    if (patch.fullName !== undefined) user.value.fullName = patch.fullName;
    if (patch.avatarUrl !== undefined) user.value.avatarUrl = patch.avatarUrl;
  }

  return { user, token, needsSetup, isAuthenticated, isOwner, isAdmin, isManager, canAccess, checkSetup, setup, login, fetchProfile, logout, init, updateProfile };
});
