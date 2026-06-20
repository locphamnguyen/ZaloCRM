<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="org-settings-layout">
    <div class="org-form-col">
    <div class="text-h6 mb-4">Thông tin tổ chức</div>

    <v-card variant="outlined" class="pa-4">
      <v-text-field
        v-model="orgName"
        label="Tên tổ chức"
        :disabled="!authStore.isOwner || saving"
        variant="outlined"
        class="mb-3"
      />

      <v-select
        v-model="timezone"
        :items="TIMEZONE_OPTIONS"
        item-title="label"
        item-value="value"
        label="Múi giờ hệ thống"
        :disabled="!authStore.isOwner || saving"
        variant="outlined"
        class="mb-1"
        hint="Mọi thời điểm hiển thị, log, debug và quy đổi tham số đều dùng múi giờ này. Mặc định +07:00 (Việt Nam) — để dễ đọc và đồng nhất bug report."
        persistent-hint
      />

      <v-alert
        type="info"
        variant="tonal"
        density="compact"
        class="mt-3 mb-3"
        icon="mdi-clock-outline"
      >
        Bây giờ tại tổ chức: <strong>{{ previewNow }}</strong>
        <span class="text-medium-emphasis"> (UTC{{ timezone }})</span>
      </v-alert>

      <v-divider class="my-4" />
      <div class="text-subtitle-2 mb-1">Thương hiệu trang đăng nhập</div>
      <p class="text-medium-emphasis text-body-2 mb-3">
        Logo, slogan, copyright và tên miền email hiển thị ngoài trang đăng nhập.
      </p>

      <!-- Logo: text field (path nội bộ /... hoặc https://) + chọn từ kho ảnh + preview -->
      <div class="d-flex align-center mb-3" style="gap: 12px;">
        <v-avatar v-if="logoUrl" rounded="lg" size="48" color="grey-lighten-3">
          <v-img :src="logoUrl" cover @error="logoBroken = true" />
        </v-avatar>
        <v-avatar v-else rounded="lg" size="48" color="grey-lighten-3">
          <v-icon>mdi-image-outline</v-icon>
        </v-avatar>
        <v-text-field
          v-model="logoUrl"
          label="Logo (đường dẫn ảnh)"
          placeholder="/brand/hs-monogram.png hoặc https://..."
          :disabled="!authStore.isOwner || saving"
          variant="outlined"
          density="compact"
          hide-details
          class="flex-grow-1"
        />
        <v-btn
          v-if="authStore.isOwner"
          variant="tonal"
          @click="openMediaPicker"
        >
          Chọn từ kho
        </v-btn>
      </div>
      <v-alert v-if="logoBroken && logoUrl" type="warning" density="compact" variant="tonal" class="mb-3">
        Không tải được ảnh logo — kiểm tra lại đường dẫn.
      </v-alert>

      <v-text-field
        v-model="slogan"
        label="Slogan"
        placeholder="Bền vững · Trường tồn"
        :disabled="!authStore.isOwner || saving"
        variant="outlined"
        class="mb-3"
        hide-details
      />
      <v-text-field
        v-model="copyright"
        label="Copyright"
        placeholder="© 2026 HS Holding"
        :disabled="!authStore.isOwner || saving"
        variant="outlined"
        class="mb-3"
        hide-details
      />
      <v-text-field
        v-model="emailDomain"
        label="Tên miền email"
        placeholder="tenmien.com"
        :disabled="!authStore.isOwner || saving"
        variant="outlined"
        class="mb-3"
        hint="Dùng gợi ý ô đăng nhập: user@<tên miền> hoặc 0901 234 567. Để trống nếu không cần."
        persistent-hint
      />

      <v-alert v-if="error" type="error" density="compact" class="mb-3">{{ error }}</v-alert>
      <v-alert v-if="saved" type="success" density="compact" class="mb-3">Đã lưu thành công</v-alert>

      <v-btn
        v-if="authStore.isOwner"
        color="primary"
        :loading="saving"
        :disabled="!canSave"
        @click="handleSave"
      >
        Lưu
      </v-btn>
      <p v-else class="text-medium-emphasis text-body-2">
        Chỉ chủ sở hữu mới có thể chỉnh sửa thông tin tổ chức.
      </p>
    </v-card>
    </div>

    <!-- Khung "Xem trước trang đăng nhập" — đổi realtime theo form bên trái -->
    <div class="org-preview-col">
      <div class="text-subtitle-2 mb-2">Xem trước giao diện mô phỏng trang đăng nhập với cấu hình hiện tại</div>
      <LoginPreview
        :logo-url="logoUrl"
        :name="orgName || 'HS Holding'"
        :slogan="slogan"
        :copyright="copyright"
        :email-placeholder="previewEmailPlaceholder"
      />
    </div>

    <!-- Media picker — chọn logo từ kho ảnh (GET /api/v1/media?kind=image) -->
    <v-dialog v-model="mediaDialog" max-width="720">
      <v-card>
        <v-card-title class="d-flex align-center">
          Chọn logo từ kho ảnh
          <v-spacer />
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-upload"
            :loading="uploading"
            class="mr-2"
            @click="triggerUpload"
          >
            Tải ảnh lên
          </v-btn>
          <v-btn icon="mdi-close" variant="text" @click="mediaDialog = false" />
          <!-- input file ẩn — chọn ảnh từ máy để upload vào kho -->
          <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileChange" />
        </v-card-title>
        <v-card-text>
          <v-alert v-if="mediaError" type="warning" variant="tonal" density="compact" class="mb-3">
            {{ mediaError }}
          </v-alert>
          <div v-if="mediaLoading || uploading" class="text-center py-8">
            <v-progress-circular indeterminate />
            <div class="text-medium-emphasis text-body-2 mt-2">
              {{ uploading ? 'Đang tải ảnh lên…' : 'Đang tải kho ảnh…' }}
            </div>
          </div>
          <div v-else-if="mediaItems.length === 0" class="text-medium-emphasis text-center py-8">
            Kho ảnh trống. Bấm <strong>Tải ảnh lên</strong> để thêm logo mới.
          </div>
          <div v-else class="media-grid">
            <v-card
              v-for="m in mediaItems"
              :key="m.id"
              variant="outlined"
              class="media-cell"
              @click="pickMedia(m)"
            >
              <v-img :src="m.thumbnailUrl || m.url || undefined" :alt="m.name" height="96" cover />
              <div class="media-name">{{ m.name }}</div>
            </v-card>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import { formatInOrgTz, refreshOrgTimezone } from '@/composables/use-org-timezone';
import LoginPreview from '@/components/branding/LoginPreview.vue';

// SĐT mẫu cố định trong gợi ý ô đăng nhập (khớp với LoginView).
const SAMPLE_PHONE = '0901 234 567';

// Offset cố định, không tự DST. Việt Nam đặt đầu danh sách + chọn mặc định.
const TIMEZONE_OPTIONS = [
  { value: '+07:00', label: 'UTC+7 — Việt Nam / Bangkok / Jakarta (mặc định)' },
  { value: '+08:00', label: 'UTC+8 — Singapore / Hong Kong / Bắc Kinh / Manila' },
  { value: '+09:00', label: 'UTC+9 — Tokyo / Seoul' },
  { value: '+05:30', label: 'UTC+5:30 — Ấn Độ' },
  { value: '+10:00', label: 'UTC+10 — Sydney' },
  { value: '+00:00', label: 'UTC±0 — London / Lisbon' },
  { value: '+01:00', label: 'UTC+1 — Berlin / Paris' },
  { value: '-05:00', label: 'UTC-5 — New York (EST)' },
  { value: '-08:00', label: 'UTC-8 — Los Angeles (PST)' },
];

const authStore = useAuthStore();
const orgName = ref('');
const timezone = ref('+07:00');
// Login branding fields
const logoUrl = ref('');
const slogan = ref('');
const copyright = ref('');
const emailDomain = ref('');
const logoBroken = ref(false);
const original = ref({
  name: '', timezone: '+07:00',
  logoUrl: '', slogan: '', copyright: '', emailDomain: '',
});
const saving = ref(false);
const error = ref('');
const saved = ref(false);

// ── Media picker (chọn logo từ kho ảnh) ──────────────────────────────────────
interface MediaItem { id: string; name: string; url: string | null; thumbnailUrl: string | null }
const mediaDialog = ref(false);
const mediaLoading = ref(false);
const mediaError = ref('');
const mediaItems = ref<MediaItem[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function loadMedia() {
  const res = await api.get('/media', { params: { kind: 'image', limit: 60 } });
  mediaItems.value = (res.data.items ?? []).filter((m: MediaItem) => m.url || m.thumbnailUrl);
}

async function openMediaPicker() {
  mediaDialog.value = true;
  mediaLoading.value = true;
  mediaError.value = '';
  try {
    await loadMedia();
  } catch (err: any) {
    mediaError.value =
      err.response?.status === 403
        ? 'Bạn không có quyền truy cập kho ảnh. Có thể dán trực tiếp đường dẫn logo.'
        : 'Không tải được kho ảnh.';
  } finally {
    mediaLoading.value = false;
  }
}

function triggerUpload() {
  fileInput.value?.click();
}

// Upload ảnh từ máy vào kho (visibility public → dùng làm logo trang login công khai),
// rồi lấy publicUrl. Upload chỉ trả {id,name} (không có url) → re-list tìm theo id.
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // reset để chọn lại cùng tệp vẫn kích hoạt change
  if (!file) return;
  uploading.value = true;
  mediaError.value = '';
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('visibility', 'public');
    const up = await api.post('/media/upload', fd);
    const id = up.data?.assets?.[0]?.id;
    await loadMedia();
    const just = mediaItems.value.find((m) => m.id === id);
    if (just?.url) {
      logoUrl.value = just.url;
      logoBroken.value = false;
      mediaDialog.value = false;
    }
  } catch (err: any) {
    mediaError.value =
      err.response?.status === 403
        ? 'Bạn không có quyền tải ảnh lên kho (cần quyền media:create).'
        : err.response?.data?.error || 'Tải ảnh lên thất bại.';
  } finally {
    uploading.value = false;
  }
}

function pickMedia(m: MediaItem) {
  if (m.url) {
    logoUrl.value = m.url;
    logoBroken.value = false;
  }
  mediaDialog.value = false;
}


// Tick mỗi giây để preview "Bây giờ tại tổ chức" cập nhật theo offset chọn.
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

const previewNow = computed(() =>
  formatInOrgTz(new Date(nowTick.value), timezone.value, { withSeconds: true }),
);

const canSave = computed(() => {
  if (!orgName.value.trim()) return false;
  return (
    orgName.value.trim() !== original.value.name ||
    timezone.value !== original.value.timezone ||
    logoUrl.value.trim() !== original.value.logoUrl ||
    slogan.value.trim() !== original.value.slogan ||
    copyright.value.trim() !== original.value.copyright ||
    emailDomain.value.trim() !== original.value.emailDomain
  );
});

// Đổi đường dẫn logo → reset cờ "ảnh hỏng" để preview thử lại.
watch(logoUrl, () => { logoBroken.value = false; });

// Placeholder email cho preview — khớp logic LoginView (#3: kèm SĐT mẫu).
const previewEmailPlaceholder = computed(() => {
  const d = emailDomain.value.trim();
  return d ? `user@${d} hoặc ${SAMPLE_PHONE}` : `admin@hs.com hoặc ${SAMPLE_PHONE}`;
});

async function fetchOrg() {
  try {
    const res = await api.get('/organization');
    orgName.value = res.data.name ?? '';
    timezone.value = res.data.timezone ?? '+07:00';
    logoUrl.value = res.data.logoUrl ?? '';
    slogan.value = res.data.slogan ?? '';
    copyright.value = res.data.copyright ?? '';
    emailDomain.value = res.data.emailDomain ?? '';
    original.value = {
      name: orgName.value,
      timezone: timezone.value,
      logoUrl: logoUrl.value,
      slogan: slogan.value,
      copyright: copyright.value,
      emailDomain: emailDomain.value,
    };
  } catch {
    // endpoint có thể chưa tồn tại lần đầu — giữ default +07:00
  }
}


async function handleSave() {
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    const res = await api.put('/organization', {
      name: orgName.value.trim(),
      timezone: timezone.value,
      logoUrl: logoUrl.value.trim(),
      slogan: slogan.value.trim(),
      copyright: copyright.value.trim(),
      emailDomain: emailDomain.value.trim(),
    });
    orgName.value = res.data.name ?? orgName.value;
    timezone.value = res.data.timezone ?? timezone.value;
    logoUrl.value = res.data.logoUrl ?? '';
    slogan.value = res.data.slogan ?? '';
    copyright.value = res.data.copyright ?? '';
    emailDomain.value = res.data.emailDomain ?? '';
    original.value = {
      name: orgName.value,
      timezone: timezone.value,
      logoUrl: logoUrl.value,
      slogan: slogan.value,
      copyright: copyright.value,
      emailDomain: emailDomain.value,
    };
    // Cập nhật cache offset toàn app + auth store để các component khác đổi format luôn.
    refreshOrgTimezone(timezone.value);
    if (authStore.user) authStore.user.orgTimezone = timezone.value;
    saved.value = true;
    setTimeout(() => {
      saved.value = false;
    }, 3000);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Lỗi lưu thông tin tổ chức';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  fetchOrg();
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});
</script>

<style scoped>
/* Bố cục 2 cột: form bên trái, preview login bên phải (khung đỏ). Hẹp → xuống dòng. */
.org-settings-layout {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  align-items: flex-start;
}
.org-form-col { flex: 0 0 560px; max-width: 560px; min-width: 0; }
/* Preview giữ ĐÚNG 880px (không co). Đủ chỗ cạnh form (màn ≥~1480px) thì nằm phải,
   không đủ thì wrap xuống dòng riêng full width. Không dùng overflow-x:auto để
   khỏi hiện thanh cuộn xấu trong khung. */
.org-preview-col {
  flex: 0 0 880px;
  padding-top: 4px;
}
.org-preview-col :deep(.login-card) { flex-shrink: 0; }

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.media-cell { cursor: pointer; transition: box-shadow 0.15s; }
.media-cell:hover { box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18); }
.media-name {
  font-size: 12px;
  padding: 4px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
