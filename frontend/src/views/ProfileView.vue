<template>
  <div>
    <h1 class="text-h4 mb-4">
      <v-icon class="mr-2" style="color: #00F2FF;">mdi-account-circle-outline</v-icon>
      Hồ sơ tài khoản Zalo
    </h1>

    <!-- Account selector -->
    <v-select
      v-model="selectedAccountId"
      :items="accountItems"
      item-title="label"
      item-value="id"
      label="Chọn tài khoản Zalo"
      prepend-inner-icon="mdi-account"
      class="mb-4"
      style="max-width: 360px;"
      @update:model-value="onAccountChange"
    />

    <div v-if="!selectedAccountId" class="text-medium-emphasis py-8 text-center">
      Chọn tài khoản Zalo để xem và quản lý hồ sơ
    </div>

    <template v-else>
      <!-- Loading skeleton -->
      <div v-if="loading" class="d-flex justify-center py-8">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <v-row v-else>
        <!-- Left: avatar + status -->
        <v-col cols="12" md="4">
          <!-- Current avatar -->
          <v-card class="mb-4">
            <v-card-text class="d-flex flex-column align-center pa-4">
              <v-avatar size="96" class="mb-3">
                <v-img v-if="profile?.avatarUrl" :src="profile.avatarUrl" alt="Avatar" />
                <v-icon v-else size="48">mdi-account-circle</v-icon>
              </v-avatar>
              <div class="text-h6 text-center">
                {{ profile?.displayName ?? profile?.zaloName ?? profile?.username ?? '—' }}
              </div>
              <div class="text-caption text-medium-emphasis mt-1">{{ profile?.uid ?? '' }}</div>
            </v-card-text>
          </v-card>

          <!-- Online status toggle -->
          <StatusToggle
            class="mb-4"
            :online="isOnline"
            :saving="saving"
            :error="statusError"
            @change="onStatusChange"
          />
        </v-col>

        <!-- Right: tabs for profile / avatars / credentials -->
        <v-col cols="12" md="8">
          <v-tabs v-model="tab" class="mb-4">
            <v-tab value="profile">Thông tin</v-tab>
            <v-tab value="avatars">Ảnh đại diện</v-tab>
            <v-tab value="credentials">Sao lưu</v-tab>
          </v-tabs>

          <v-window v-model="tab">
            <!-- Profile editor -->
            <v-window-item value="profile">
              <ProfileEditor
                :profile="profile"
                :saving="saving"
                :error="profileError"
                @save="onSaveProfile"
                @cancel="profileError = ''"
              />
            </v-window-item>

            <!-- Avatar management -->
            <v-window-item value="avatars">
              <AvatarUploader
                class="mb-4"
                :saving="saving"
                :error="avatarError"
                @upload="onAvatarUpload"
              />
              <AvatarHistory
                :avatars="avatars"
                :loading="loading"
                :saving="saving"
                :error="avatarError"
                @refresh="fetchAvatars"
                @reuse="onReuseAvatar"
                @delete="onDeleteAvatar"
              />
            </v-window-item>

            <!-- Credentials backup -->
            <v-window-item value="credentials">
              <CredentialManager
                :saving="saving"
                :exporting="exporting"
                :error="credError"
                @export="onExportCredentials"
                @import="onImportCredentials"
              />
            </v-window-item>
          </v-window>
        </v-col>
      </v-row>
    </template>

    <!-- Global success snackbar -->
    <v-snackbar v-model="showSuccess" color="success" :timeout="2500" location="bottom right">
      {{ successMsg }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useProfile } from '@/composables/use-profile';
import ProfileEditor from '@/components/profile/profile-editor.vue';
import AvatarUploader from '@/components/profile/avatar-uploader.vue';
import AvatarHistory from '@/components/profile/avatar-history.vue';
import StatusToggle from '@/components/profile/status-toggle.vue';
import CredentialManager from '@/components/zalo/credential-manager.vue';

// ── Account list ──────────────────────────────────────────────────────────────
const { accounts, fetchAccounts } = useZaloAccounts();
fetchAccounts();

const selectedAccountId = ref('');

const accountItems = computed(() =>
  accounts.value.map((a) => ({
    id: a.id,
    label: a.displayName ?? a.zaloUid ?? a.id,
  })),
);

// ── Profile composable (re-instantiated per selected account) ─────────────────
let profileOps = useProfile(selectedAccountId.value);

const profile = ref(profileOps.profile.value);
const avatars = ref(profileOps.avatars.value);
const loading = ref(false);
const saving = ref(false);
const exporting = ref(false);
const isOnline = ref(false);

const profileError = ref('');
const avatarError = ref('');
const statusError = ref('');
const credError = ref('');
const showSuccess = ref(false);
const successMsg = ref('');
const tab = ref('profile');

function onAccountChange(id: string) {
  profileOps = useProfile(id);
  profile.value = null;
  avatars.value = [];
  isOnline.value = false;
  profileError.value = '';
  avatarError.value = '';
  statusError.value = '';
  credError.value = '';
  loadAll();
}

async function loadAll() {
  loading.value = true;
  await profileOps.fetchProfile();
  await profileOps.fetchAvatars();
  profile.value = profileOps.profile.value;
  avatars.value = profileOps.avatars.value;
  loading.value = false;
}

async function fetchAvatars() {
  await profileOps.fetchAvatars();
  avatars.value = profileOps.avatars.value;
}

watch(selectedAccountId, (id) => { if (id) onAccountChange(id); });

// ── Profile save ──────────────────────────────────────────────────────────────

async function onSaveProfile(params: { name?: string; gender?: 0 | 1; dob?: string }) {
  saving.value = true;
  profileError.value = '';
  const ok = await profileOps.updateProfile(params);
  saving.value = false;
  if (ok) {
    profile.value = profileOps.profile.value;
    flash('Cập nhật hồ sơ thành công');
  } else {
    profileError.value = profileOps.error.value;
  }
}

// ── Avatar ops ────────────────────────────────────────────────────────────────

async function onAvatarUpload(filePath: string) {
  saving.value = true;
  avatarError.value = '';
  const ok = await profileOps.uploadAvatar(filePath);
  saving.value = false;
  if (ok) {
    profile.value = profileOps.profile.value;
    avatars.value = profileOps.avatars.value;
    flash('Đã cập nhật ảnh đại diện');
  } else {
    avatarError.value = profileOps.error.value;
  }
}

async function onReuseAvatar(avatarId: string) {
  saving.value = true;
  avatarError.value = '';
  const ok = await profileOps.reuseAvatar(avatarId);
  saving.value = false;
  if (ok) {
    profile.value = profileOps.profile.value;
    flash('Đã khôi phục ảnh đại diện');
  } else {
    avatarError.value = profileOps.error.value;
  }
}

async function onDeleteAvatar(avatarId: string) {
  saving.value = true;
  avatarError.value = '';
  const ok = await profileOps.deleteAvatar(avatarId);
  saving.value = false;
  if (ok) {
    avatars.value = profileOps.avatars.value;
    flash('Đã xóa ảnh đại diện');
  } else {
    avatarError.value = profileOps.error.value;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

async function onStatusChange(online: boolean) {
  saving.value = true;
  statusError.value = '';
  const ok = await profileOps.setStatus(online);
  saving.value = false;
  if (ok) {
    isOnline.value = online;
    flash(online ? 'Đã bật trạng thái trực tuyến' : 'Đã tắt trạng thái trực tuyến');
  } else {
    statusError.value = profileOps.error.value;
    isOnline.value = !online; // revert
  }
}

// ── Credentials ───────────────────────────────────────────────────────────────

async function onExportCredentials() {
  exporting.value = true;
  credError.value = '';
  await profileOps.exportCredentials();
  exporting.value = false;
  if (profileOps.error.value) credError.value = profileOps.error.value;
}

async function onImportCredentials(content: string) {
  saving.value = true;
  credError.value = '';
  const ok = await profileOps.importCredentials(content);
  saving.value = false;
  if (ok) {
    flash('Đã nhập thông tin xác thực. Sử dụng kết nối lại để kích hoạt.');
  } else {
    credError.value = profileOps.error.value;
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

function flash(msg: string) {
  successMsg.value = msg;
  showSuccess.value = true;
}
</script>
