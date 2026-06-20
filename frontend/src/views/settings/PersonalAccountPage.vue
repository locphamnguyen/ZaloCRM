<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="account-page">
    <div class="page-head">
      <h2 class="page-title">Tài khoản của tôi</h2>
      <p class="page-desc">Quản lý ảnh đại diện, thông tin và mật khẩu của bạn trong tổ chức {{ authStore.user?.orgName }}.</p>
    </div>

    <template v-if="authStore.user">
      <!-- Card 1: Hero avatar + danh tính -->
      <div class="card">
        <div class="card-pad hero">
          <div class="avatar-wrap">
            <Avatar :src="authStore.user.avatarUrl" :name="authStore.user.fullName" :size="88" :platform="null" />
            <button class="avatar-edit" title="Đổi ảnh đại diện" @click="pickAvatar" :disabled="avatarBusy">
              <span v-if="avatarBusy" class="spin">⏳</span>
              <span v-else>✎</span>
            </button>
            <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden @change="onFilePicked" />
          </div>
          <div class="hero-info">
            <div class="hero-name">
              {{ authStore.user.fullName }}
              <span class="role-chip" :class="roleClass">{{ roleLabel }}</span>
            </div>
            <div class="hero-meta">
              <span v-if="authStore.user.email"><b>Email:</b> {{ authStore.user.email }}</span>
              <span v-if="authStore.user.phone"><b>SĐT:</b> {{ authStore.user.phone }}</span>
              <span><b>Tổ chức:</b> {{ authStore.user.orgName }}</span>
            </div>
            <div class="avatar-actions">
              <button class="btn btn-sm" @click="pickAvatar" :disabled="avatarBusy">⬆ Tải ảnh lên</button>
              <button v-if="authStore.user.avatarUrl" class="btn btn-sm btn-danger" @click="removeAvatar" :disabled="avatarBusy">🗑 Xóa ảnh</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Card 2: Thông tin cơ bản (edit inline) -->
      <div class="card">
        <div class="card-head">
          <h3>Thông tin cơ bản</h3>
          <button v-if="!editing" class="btn btn-sm" @click="startEdit">✎ Chỉnh sửa</button>
        </div>
        <div class="card-pad fields">
          <div class="frow">
            <div class="flabel">Họ tên</div>
            <input v-if="editing" v-model="nameDraft" class="finput" maxlength="80" placeholder="Nhập họ tên" />
            <div v-else class="fval">{{ authStore.user.fullName }}</div>
          </div>
          <div class="frow">
            <div class="flabel">Email</div>
            <div class="fval">{{ authStore.user.email || '—' }} <span class="locked">🔒 do quản trị quản lý</span></div>
          </div>
          <div class="frow">
            <div class="flabel">Số điện thoại</div>
            <div class="fval">{{ authStore.user.phone || '—' }} <span class="locked">🔒 do quản trị quản lý</span></div>
          </div>
          <div class="frow">
            <div class="flabel">Vai trò</div>
            <div class="fval"><span class="role-chip" :class="roleClass">{{ roleLabel }}</span></div>
          </div>
        </div>
        <div v-if="editing" class="card-pad row-end">
          <button class="btn" @click="cancelEdit" :disabled="saving">Huỷ</button>
          <button class="btn btn-primary" @click="saveName" :disabled="saving || !nameValid">
            <span v-if="saving">Đang lưu...</span><span v-else>💾 Lưu thay đổi</span>
          </button>
        </div>
      </div>

      <!-- Card 3: Bảo mật -->
      <div class="card">
        <div class="card-head"><h3>Bảo mật</h3></div>
        <div class="card-pad sec-row">
          <div>
            <div class="sec-lbl">Mật khẩu</div>
            <div class="sec-sub">••••••••</div>
          </div>
          <button class="btn btn-primary" @click="showPwModal = true">🔑 Đổi mật khẩu</button>
        </div>
      </div>

      <!-- Card 4: Lối tắt khác (D7) -->
      <div class="card">
        <div class="card-head"><h3>Khác</h3></div>
        <div class="card-pad">
          <div class="shortcuts">
            <RouterLink to="/settings/channels/zalo?tab=privacy" class="sc">
              <div class="sc-ic">🔒</div>
              <div class="sc-txt"><div class="sc-t">Riêng tư</div><div class="sc-d">Khoá/mở nội dung chat nhạy cảm</div></div>
              <div class="sc-arrow">›</div>
            </RouterLink>
            <RouterLink to="/settings/channels/zalo?tab=internal-contact" class="sc">
              <div class="sc-ic">🔔</div>
              <div class="sc-txt"><div class="sc-t">Thông báo của tôi</div><div class="sc-d">Nhận thông báo qua Zalo nội bộ</div></div>
              <div class="sc-arrow">›</div>
            </RouterLink>
          </div>
        </div>
      </div>
    </template>

    <!-- Modal đổi mật khẩu (Q1 = modal) -->
    <ChangePasswordModal v-if="showPwModal" @close="showPwModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import Avatar from '@/components/ui/Avatar.vue';
import ChangePasswordModal from '@/components/settings/ChangePasswordModal.vue';

const authStore = useAuthStore();
const toast = useToast();

const roleLabel = computed(() => {
  const r = authStore.user?.role;
  if (r === 'owner') return 'Chủ sở hữu';
  if (r === 'admin') return 'Quản trị viên';
  return 'Nhân viên';
});
const roleClass = computed(() => `role-${authStore.user?.role || 'member'}`);

// ── Sửa họ tên (edit inline) ──
const editing = ref(false);
const nameDraft = ref('');
const saving = ref(false);
const nameValid = computed(() => nameDraft.value.trim().length >= 2 && nameDraft.value.trim().length <= 80);

function startEdit() {
  nameDraft.value = authStore.user?.fullName ?? '';
  editing.value = true;
}
function cancelEdit() {
  editing.value = false;
}
async function saveName() {
  if (!nameValid.value) return;
  saving.value = true;
  try {
    const { data } = await api.patch('/me/profile', { fullName: nameDraft.value.trim() });
    authStore.updateProfile({ fullName: data.fullName });
    editing.value = false;
    toast.success('Đã cập nhật họ tên');
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Không thể cập nhật họ tên');
  } finally {
    saving.value = false;
  }
}

// ── Avatar (upload / xoá) ──
const fileInput = ref<HTMLInputElement | null>(null);
const avatarBusy = ref(false);
function pickAvatar() {
  fileInput.value?.click();
}
async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // reset để chọn lại cùng file vẫn trigger
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    toast.error('Ảnh tối đa 15MB');
    return;
  }
  avatarBusy.value = true;
  try {
    const fd = new FormData();
    fd.append('avatar', file);
    const { data } = await api.post('/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    authStore.updateProfile({ avatarUrl: data.avatarUrl });
    toast.success('Đã cập nhật ảnh đại diện');
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Không thể tải ảnh lên');
  } finally {
    avatarBusy.value = false;
  }
}
async function removeAvatar() {
  avatarBusy.value = true;
  try {
    await api.patch('/me/profile', { avatarUrl: null });
    authStore.updateProfile({ avatarUrl: null });
    toast.success('Đã xóa ảnh đại diện');
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Không thể xóa ảnh');
  } finally {
    avatarBusy.value = false;
  }
}

// ── Modal đổi mật khẩu ──
const showPwModal = ref(false);
</script>

<style scoped>
.account-page { max-width: 760px; font-family: inherit; }
.page-head { margin-bottom: 22px; }
.page-title { font-size: 21px; font-weight: 700; color: var(--ink, #141a24); margin: 0 0 3px; }
.page-desc { font-size: 13px; color: var(--ink-3, #6b7488); margin: 0; }

.card {
  background: #fff;
  border: 1px solid var(--line, #e7eaf0);
  border-radius: var(--r-lg, 14px);
  box-shadow: var(--sh-sm, 0 1px 3px rgba(20,26,36,.06));
  margin-bottom: 18px;
  overflow: hidden;
}
.card-pad { padding: 22px 24px; }
.card-head {
  padding: 14px 24px;
  border-bottom: 1px solid var(--line-2, #eef1f6);
  display: flex; align-items: center; justify-content: space-between;
}
.card-head h3 {
  font-size: 13px; font-weight: 700; color: var(--ink-3, #6b7488);
  text-transform: uppercase; letter-spacing: .05em; margin: 0;
}

/* Hero */
.hero { display: flex; gap: 22px; align-items: center; }
.avatar-wrap { position: relative; flex-shrink: 0; }
.avatar-edit {
  position: absolute; right: -2px; bottom: -2px;
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--brand, #1786be); color: #fff;
  border: 2px solid #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; box-shadow: var(--sh-sm, 0 1px 3px rgba(20,26,36,.06));
}
.avatar-edit:disabled { opacity: .6; cursor: default; }
.spin { display: inline-block; animation: sp 1s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
.hero-info { flex: 1; }
.hero-name { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px; color: var(--ink, #141a24); }
.hero-meta { font-size: 13px; color: var(--ink-3, #6b7488); margin-top: 6px; display: flex; gap: 16px; flex-wrap: wrap; }
.hero-meta b { color: var(--ink-2, #475066); font-weight: 600; }
.avatar-actions { display: flex; gap: 8px; margin-top: 12px; }

/* Field rows */
.fields { padding-top: 8px; padding-bottom: 8px; }
.frow { display: flex; align-items: center; gap: 18px; padding: 13px 0; border-bottom: 1px solid var(--line-2, #eef1f6); }
.frow:last-child { border-bottom: none; }
.flabel {
  width: 130px; flex-shrink: 0;
  font-size: 12px; font-weight: 600; color: var(--ink-3, #6b7488);
  text-transform: uppercase; letter-spacing: .04em;
}
.fval { font-size: 14px; color: var(--ink, #141a24); font-weight: 500; flex: 1; }
.finput {
  flex: 1; max-width: 360px; padding: 9px 12px; font-size: 14px;
  border: 1px solid var(--line, #e7eaf0); border-radius: var(--r-sm, 8px);
  outline: none; font-family: inherit;
}
.finput:focus { border-color: var(--brand, #1786be); box-shadow: 0 0 0 3px rgba(23,134,190,.12); }
.locked {
  font-size: 11px; color: var(--ink-4, #97a0b3);
  background: var(--surface-3, #f1f4f9); padding: 2px 8px; border-radius: var(--r-pill, 999px);
}

/* Role chip */
.role-chip { font-size: 11.5px; font-weight: 700; padding: 3px 11px; border-radius: var(--r-pill, 999px); }
.role-owner { background: #fdf4e3; color: #92610c; }
.role-admin { background: var(--brand-soft, #e4f1f8); color: var(--brand-700, #0b5880); }
.role-member { background: #e8f6ed; color: #166534; }

/* Security */
.sec-row { display: flex; align-items: center; justify-content: space-between; }
.sec-lbl { font-size: 14px; font-weight: 600; color: var(--ink, #141a24); }
.sec-sub { font-size: 12.5px; color: var(--ink-3, #6b7488); margin-top: 2px; }

/* Shortcuts */
.shortcuts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sc {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  border: 1px solid var(--line, #e7eaf0); border-radius: var(--r-md, 10px);
  cursor: pointer; background: #fff; text-decoration: none;
}
.sc:hover { border-color: var(--brand, #1786be); background: var(--brand-softer, #f2f8fc); }
.sc-ic {
  width: 36px; height: 36px; border-radius: var(--r-sm, 8px); flex-shrink: 0;
  background: var(--brand-soft, #e4f1f8); color: var(--brand-700, #0b5880);
  display: flex; align-items: center; justify-content: center; font-size: 18px;
}
.sc-txt { flex: 1; }
.sc-t { font-size: 13.5px; font-weight: 600; color: var(--ink, #141a24); }
.sc-d { font-size: 12px; color: var(--ink-3, #6b7488); margin-top: 1px; }
.sc-arrow { color: var(--ink-4, #97a0b3); font-size: 18px; }

/* Buttons */
.row-end { display: flex; justify-content: flex-end; gap: 10px; padding-top: 0; }
.btn {
  padding: 9px 16px; font-size: 13px; font-weight: 600;
  border-radius: var(--r-sm, 8px); border: 1px solid var(--line, #e7eaf0);
  background: #fff; color: var(--ink, #141a24); cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 7px;
}
.btn:hover:not(:disabled) { background: var(--surface-3, #f1f4f9); }
.btn:disabled { opacity: .55; cursor: default; }
.btn-sm { padding: 6px 12px; font-size: 12.5px; }
.btn-primary { background: var(--brand, #1786be); border-color: var(--brand, #1786be); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--brand-600, #0f6fa0); }
.btn-danger { color: var(--error, #f04438); border-color: #f5c4c0; }
.btn-danger:hover:not(:disabled) { background: var(--error-soft, #fdeceb); }
</style>
