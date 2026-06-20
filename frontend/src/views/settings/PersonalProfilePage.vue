<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="profile-page">
    <div class="page-head">
      <h2 class="page-title">Hồ sơ của tôi</h2>
      <p class="page-desc">Thông tin tài khoản cá nhân của bạn trong tổ chức {{ authStore.user?.orgName }}.</p>
    </div>

    <div v-if="authStore.user" class="profile-card">
      <div class="pc-avatar">
        <div class="avatar-circle">{{ initials }}</div>
      </div>
      <div class="pc-info">
        <div class="pc-row">
          <label>Họ tên</label>
          <div class="pc-value">{{ authStore.user.fullName }}</div>
        </div>
        <div class="pc-row">
          <label>Email</label>
          <div class="pc-value">{{ authStore.user.email }}</div>
        </div>
        <div class="pc-row">
          <label>Vai trò</label>
          <div class="pc-value">
            <span class="role-chip" :class="roleClass">{{ roleLabel }}</span>
          </div>
        </div>
        <div class="pc-row">
          <label>Tổ chức</label>
          <div class="pc-value">{{ authStore.user.orgName }}</div>
        </div>
        <div class="pc-row">
          <label>User ID</label>
          <div class="pc-value muted">{{ authStore.user.id }}</div>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn-ghost" disabled title="Sắp ra mắt">✏ Chỉnh sửa hồ sơ (sắp ra mắt)</button>
      <RouterLink to="/settings/personal/password" class="btn-primary">🔑 Đổi mật khẩu</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

const initials = computed(() => {
  const name = authStore.user?.fullName || authStore.user?.email || '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
});

const roleLabel = computed(() => {
  const r = authStore.user?.role;
  if (r === 'owner') return 'Chủ sở hữu';
  if (r === 'admin') return 'Quản trị viên';
  return 'Nhân viên';
});

const roleClass = computed(() => `role-${authStore.user?.role || 'member'}`);
</script>

<style scoped>
.profile-page { max-width: 720px; font-family: inherit; }
.page-head { margin-bottom: 24px; }
.page-title { font-size: 20px; font-weight: 700; color: #1F2D3D; margin: 0 0 4px; }
.page-desc { font-size: 13px; color: #6B7785; margin: 0; }

.profile-card {
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
}
.pc-avatar { flex-shrink: 0; }
.avatar-circle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5E6AD2, #8B5CF6);
  color: white;
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pc-info { flex: 1; display: flex; flex-direction: column; gap: 14px; }
.pc-row { display: flex; align-items: baseline; gap: 16px; }
.pc-row label {
  width: 100px;
  font-size: 11.5px;
  font-weight: 600;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pc-value { font-size: 14px; color: #1F2D3D; font-weight: 500; }
.pc-value.muted { font-size: 12px; color: #97A0AC; font-family: monospace; }

.role-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
}
.role-chip.role-owner { background: #FEF3C7; color: #92400E; }
.role-chip.role-admin { background: #EEF0FF; color: #5E6AD2; }
.role-chip.role-member { background: #DCFCE7; color: #166534; }

.actions { display: flex; gap: 10px; }
.btn-ghost,
.btn-primary {
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid #E4E5E9;
  background: white;
  color: #1F2D3D;
  cursor: pointer;
  font-family: inherit;
  text-decoration: none;
  display: inline-block;
}
.btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #5E6AD2; border-color: #5E6AD2; color: white; }
.btn-primary:hover { background: #4E5AB8; }
</style>
