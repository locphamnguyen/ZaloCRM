<template>
  <div class="system-notify-page">
    <div class="d-flex align-center justify-space-between mb-5 flex-wrap ga-3">
      <div>
        <div class="text-h5 font-weight-bold">Thông báo hệ thống</div>
        <div class="text-body-2 text-medium-emphasis mt-1">
          Chọn nick gửi system notification và lưu UID từng nhân viên theo góc nhìn nick đó.
        </div>
      </div>
      <v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="loadingRecipients" @click="fetchRecipients">
        Làm mới
      </v-btn>
    </div>

    <v-card variant="outlined" class="pa-4 mb-4 notify-card">
      <div class="d-flex flex-wrap align-start ga-4">
        <v-select
          v-model="senderId"
          :items="senderOptions"
          item-title="label"
          item-value="value"
          label="Nick Zalo gửi thông báo hệ thống"
          variant="outlined"
          density="comfortable"
          clearable
          hide-details="auto"
          :loading="loadingSettings || savingSender"
          class="sender-select"
          @update:model-value="saveSender"
        />
        <v-chip v-if="selectedSender" :color="selectedSender.status === 'connected' ? 'success' : 'warning'" variant="tonal" class="mt-2">
          {{ selectedSender.status === 'connected' ? 'Đang connected' : 'Offline' }}
        </v-chip>
        <v-chip v-else color="grey" variant="tonal" class="mt-2">Chưa chọn nick gửi</v-chip>
      </div>
      <div class="text-caption text-medium-emphasis mt-3">
        Khi đổi nick gửi, bảng bên dưới sẽ kiểm tra mapping UID riêng cho nick mới. UID cũ của nick khác không dùng chung.
      </div>
      <v-alert v-if="senderError" type="error" density="compact" class="mt-3">{{ senderError }}</v-alert>
    </v-card>

    <!-- Org config: welcome template + image + admin fallback phone (Phase user-create-with-zalo 2026-05-27) -->
    <v-card variant="outlined" class="pa-4 mb-4 notify-card">
      <div class="d-flex align-center justify-space-between mb-3 flex-wrap ga-2">
        <div>
          <div class="text-subtitle-1 font-weight-bold">📨 Tin chào mừng khi tạo user mới</div>
          <div class="text-caption text-medium-emphasis">
            Khi admin tạo sale mới + check SĐT Zalo OK, hệ thống tự gửi tin login này cho sale. Anh sửa text + ảnh + SĐT admin fallback tuỳ ý.
          </div>
        </div>
        <div class="d-flex ga-2">
          <v-btn size="small" variant="tonal" @click="showPlaceholders = true">📋 Placeholders</v-btn>
          <v-btn size="small" variant="tonal" color="primary" :loading="previewLoading" @click="openPreview">👁 Preview</v-btn>
          <v-btn size="small" variant="text" @click="resetTemplate">↻ Reset mặc định</v-btn>
        </div>
      </div>

      <v-textarea
        v-model="welcomeTemplate"
        label="Template tin chào mừng (markdown: **bold**, {red}text{/red}, # h1, - bullet, > quote)"
        variant="outlined"
        density="comfortable"
        rows="14"
        auto-grow
        hide-details="auto"
        placeholder="Ô trống = dùng template mặc định em thiết kế"
        class="mb-3 template-textarea"
      />

      <div class="d-flex flex-wrap align-start ga-4 mb-2">
        <div class="welcome-image-block">
          <div class="text-caption text-medium-emphasis mb-1">Ảnh welcome (gửi kèm tin login)</div>
          <div class="welcome-image-preview">
            <img v-if="welcomeImageUrl" :src="welcomeImageUrl" alt="Welcome" />
            <div v-else class="text-caption text-disabled pa-3">Chưa upload ảnh</div>
          </div>
          <input ref="imageFileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="d-none" @change="onImagePicked" />
          <div class="d-flex ga-2 mt-2">
            <v-btn size="small" variant="tonal" :loading="imageUploading" @click="imageFileInput?.click()">⬆ Chọn ảnh</v-btn>
            <v-btn v-if="welcomeImageUrl" size="small" variant="text" color="error" @click="clearImage">🗑 Xoá</v-btn>
          </div>
        </div>

        <v-text-field
          v-model="adminFallbackPhone"
          label="SĐT admin nhận tin lỗi (khi gửi sale fail → admin chuyển thủ công)"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          placeholder="VD: 0908278807"
          class="admin-phone-field"
        />
      </div>

      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" @click="discardOrgConfigChanges">Huỷ</v-btn>
        <v-btn
          color="primary"
          :loading="savingOrgConfig"
          :disabled="!orgConfigDirty"
          @click="saveOrgConfig"
        >
          Lưu cấu hình
        </v-btn>
      </div>
      <v-alert v-if="orgConfigError" type="error" density="compact" class="mt-2">{{ orgConfigError }}</v-alert>
      <v-alert v-if="orgConfigSuccess" type="success" density="compact" class="mt-2">{{ orgConfigSuccess }}</v-alert>
    </v-card>

    <!-- Placeholder helper modal -->
    <v-dialog v-model="showPlaceholders" max-width="560">
      <v-card>
        <v-card-title>📋 Placeholders dùng trong template</v-card-title>
        <v-card-text>
          <v-list density="compact">
            <v-list-item v-for="p in PLACEHOLDER_HELP" :key="p.key">
              <template #title>
                <code v-text="placeholderLabel(p.key)"></code>
              </template>
              <template #subtitle>{{ p.desc }}</template>
            </v-list-item>
          </v-list>
          <v-divider class="my-2" />
          <div class="text-caption">
            Markup: <code>**bold**</code> · <code>*italic*</code> · <code>~~strike~~</code> ·
            <code>{red|orange|yellow|green}text{/tag}</code> · <code>{big}lớn{/big}</code> ·
            <code># Tiêu đề</code> · <code>- bullet</code> · <code>&gt; trích dẫn</code>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showPlaceholders = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Preview modal -->
    <v-dialog v-model="showPreview" max-width="560">
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span>👁 Preview tin chào mừng</span>
          <v-btn-toggle v-model="previewVariant" mandatory density="comfortable" size="small">
            <v-btn value="friend">Đã kết bạn</v-btn>
            <v-btn value="stranger">Chưa kết bạn</v-btn>
          </v-btn-toggle>
        </v-card-title>
        <v-card-text>
          <div class="text-caption text-medium-emphasis mb-2">Render với data giả (Nguyễn Văn A, 0931...)</div>
          <pre class="preview-pane">{{ previewText }}</pre>
          <div v-if="previewStyles.length" class="text-caption mt-2">
            <strong>{{ previewStyles.length }} style ranges</strong> · Zalo render thực sẽ có bold/màu/size đúng vị trí.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showPreview = false">Đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip size="small" color="success" variant="tonal">Đã có UID {{ summary.ready || 0 }}</v-chip>
      <v-chip size="small" color="warning" variant="tonal">Chưa có UID {{ summary.uid_not_found || 0 }}</v-chip>
      <v-chip size="small" color="warning" variant="tonal">Thiếu SĐT {{ summary.missing_internal_phone || 0 }}</v-chip>
      <v-chip size="small" color="grey" variant="tonal">Thiếu nick {{ summary.missing_internal_contact || 0 }}</v-chip>
      <v-chip size="small" color="error" variant="tonal">Lỗi {{ (summary.lookup_failed || 0) + (summary.sender_disconnected || 0) }}</v-chip>
    </div>

    <v-alert v-if="lookupError" type="error" density="compact" class="mb-3">{{ lookupError }}</v-alert>
    <v-alert v-if="lookupSuccess" type="success" density="compact" class="mb-3">{{ lookupSuccess }}</v-alert>

    <v-card variant="outlined" class="notify-card">
      <v-table density="comfortable" class="recipient-table">
        <thead>
          <tr>
            <th>Nhân viên</th>
            <th>Phòng ban</th>
            <th>Chức vụ</th>
            <th>Nick liên lạc nội bộ</th>
            <th>UID góc nhìn nick gửi</th>
            <th>Trạng thái</th>
            <th class="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recipients" :key="row.user.id">
            <td>
              <div class="font-weight-medium">{{ row.user.fullName }}</div>
              <div class="text-caption text-medium-emphasis">{{ row.user.email }}</div>
            </td>
            <td>{{ row.user.departmentMember?.department?.name || 'Chưa gán' }}</td>
            <td>
              <div>{{ row.user.departmentMember?.deptRole || roleLabel(row.user.role) }}</div>
              <div v-if="row.user.permissionGroup?.name" class="text-caption text-medium-emphasis">
                {{ row.user.permissionGroup.name }}
              </div>
            </td>
            <td>
              <div class="font-weight-medium">{{ row.internalContactNick?.displayName || 'Chưa chọn' }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ row.internalContactNick?.phone || 'Chưa có SĐT' }}
              </div>
            </td>
            <td>
              <span v-if="row.recipient.threadIdInSenderView" class="uid-text">{{ row.recipient.threadIdInSenderView }}</span>
              <span v-else class="text-medium-emphasis">Chưa có</span>
            </td>
            <td>
              <v-chip size="small" :color="statusColor(row.recipient.status)" variant="tonal">
                {{ statusLabel(row.recipient.status) }}
              </v-chip>
              <div v-if="row.recipient.error" class="text-caption text-medium-emphasis mt-1">
                {{ row.recipient.error }}
              </div>
            </td>
            <td class="text-right">
              <v-btn
                size="small"
                variant="tonal"
                :loading="lookupUserId === row.user.id"
                :disabled="!canLookup(row)"
                @click="lookupUid(row)"
              >
                Tìm UID
              </v-btn>
            </td>
          </tr>
          <tr v-if="!loadingRecipients && recipients.length === 0">
            <td colspan="7" class="text-center text-medium-emphasis py-6">Chưa có nhân viên để kiểm tra.</td>
          </tr>
          <tr v-if="loadingRecipients">
            <td colspan="7" class="text-center text-medium-emphasis py-6">Đang tải danh sách...</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@/api/index';

interface SenderNick {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  zaloUid?: string | null;
  phone?: string | null;
  status: string;
}

interface RecipientRow {
  user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    departmentMember: { deptRole: string | null; department: { id: string; name: string; path: string } | null } | null;
    permissionGroup: { id: string; name: string; isSystem: boolean } | null;
  };
  internalContactNick: { id: string; displayName: string | null; avatarUrl?: string | null; phone?: string | null; status: string } | null;
  recipient: {
    id: string;
    status: string;
    error: string | null;
    conversationId: string | null;
    threadIdInSenderView: string | null;
    lastVerifiedAt: string;
  };
}

const loadingSettings = ref(false);
const loadingRecipients = ref(false);
const savingSender = ref(false);
const senderError = ref('');
const lookupError = ref('');
const lookupSuccess = ref('');
const senderId = ref<string | null>(null);
const nicks = ref<SenderNick[]>([]);
const recipients = ref<RecipientRow[]>([]);
const summary = ref<Record<string, number>>({});
const lookupUserId = ref<string | null>(null);

// ── Org config: welcome template + image + admin fallback phone ──
const welcomeTemplate = ref<string>('');
const welcomeImageUrl = ref<string | null>(null);
const adminFallbackPhone = ref<string>('');
const defaultTemplate = ref<string>('');
const savedSnapshot = ref<{ template: string; image: string | null; phone: string }>({ template: '', image: null, phone: '' });
const savingOrgConfig = ref(false);
const orgConfigError = ref('');
const orgConfigSuccess = ref('');
const imageUploading = ref(false);
const imageFileInput = ref<HTMLInputElement | null>(null);

const showPlaceholders = ref(false);
const showPreview = ref(false);
const previewLoading = ref(false);
const previewVariant = ref<'friend' | 'stranger'>('stranger');
const previewText = ref('');
const previewStyles = ref<Array<{ offset: number; length: number; style: string; color?: string }>>([]);

function placeholderLabel(key: string): string {
  return '{{' + key + '}}';
}

const PLACEHOLDER_HELP = [
  { key: 'fullName', desc: 'Họ tên sale' },
  { key: 'email', desc: 'Email (nếu có)' },
  { key: 'phone', desc: 'SĐT đăng nhập' },
  { key: 'password', desc: 'Mật khẩu tạm tự sinh' },
  { key: 'loginUrl', desc: 'Link CRM (ENV CRM_LOGIN_URL)' },
  { key: 'orgName', desc: 'Tên tổ chức' },
  { key: 'departmentName', desc: 'Phòng ban (rỗng → dòng biến mất)' },
  { key: 'roleName', desc: 'Chức vụ' },
  { key: 'adminPhone', desc: 'SĐT admin fallback (ô bên cạnh)' },
  { key: 'strangerNotice', desc: 'Auto-fill nhắc kết bạn nếu sale chưa friend' },
];

const orgConfigDirty = computed(() =>
  welcomeTemplate.value !== savedSnapshot.value.template ||
  welcomeImageUrl.value !== savedSnapshot.value.image ||
  adminFallbackPhone.value !== savedSnapshot.value.phone,
);

const senderOptions = computed(() => nicks.value.map((nick) => ({
  value: nick.id,
  label: `${nick.displayName || 'Nick chưa đặt tên'}${nick.status === 'connected' ? '' : ' (offline)'}`,
})));

const selectedSender = computed(() => nicks.value.find((nick) => nick.id === senderId.value) || null);

async function fetchSettings() {
  loadingSettings.value = true;
  senderError.value = '';
  try {
    const { data } = await api.get('/system-notifications/settings');
    senderId.value = data.systemNotifyZaloAccountId ?? null;
    nicks.value = data.nicks || [];
  } catch (err: any) {
    senderError.value = err?.response?.data?.error || 'Lỗi tải cấu hình thông báo hệ thống';
  } finally {
    loadingSettings.value = false;
  }
}

async function fetchRecipients() {
  loadingRecipients.value = true;
  try {
    const { data } = await api.get('/system-notifications/recipients');
    recipients.value = data.recipients || [];
    summary.value = data.summary || {};
  } finally {
    loadingRecipients.value = false;
  }
}

async function saveSender(value: unknown) {
  savingSender.value = true;
  senderError.value = '';
  lookupError.value = '';
  lookupSuccess.value = '';
  try {
    await api.patch('/system-notifications/settings/sender', { zaloAccountId: value || null });
    await fetchRecipients();
  } catch (err: any) {
    senderError.value = err?.response?.data?.error || 'Lỗi lưu nick gửi thông báo hệ thống';
  } finally {
    savingSender.value = false;
  }
}

function canLookup(row: RecipientRow) {
  return Boolean(senderId.value && row.internalContactNick?.id && row.internalContactNick?.phone && lookupUserId.value !== row.user.id);
}

async function lookupUid(row: RecipientRow) {
  lookupUserId.value = row.user.id;
  lookupError.value = '';
  lookupSuccess.value = '';
  try {
    const { data } = await api.post(`/system-notifications/recipients/${row.user.id}/lookup-uid`);
    const recipient = data.recipient;
    if (recipient) {
      row.recipient = {
        id: recipient.id,
        status: recipient.status,
        error: recipient.error,
        conversationId: recipient.conversationId,
        threadIdInSenderView: recipient.threadIdInSenderView,
        lastVerifiedAt: recipient.lastVerifiedAt,
      };
    }
    lookupSuccess.value = data.found ? `Đã lưu UID cho ${row.user.fullName}` : `Chưa tìm thấy UID cho ${row.user.fullName}`;
    await fetchRecipients();
  } catch (err: any) {
    lookupError.value = err?.response?.data?.error || 'Lỗi tìm UID';
    await fetchRecipients();
  } finally {
    lookupUserId.value = null;
  }
}

function statusColor(status: string) {
  if (status === 'ready') return 'success';
  if (status === 'uid_not_found' || status === 'missing_internal_phone' || status === 'missing_internal_contact') return 'warning';
  if (status === 'sender_disconnected' || status === 'missing_system_sender' || status === 'lookup_failed') return 'error';
  return 'grey';
}

function statusLabel(status: string) {
  return ({
    ready: 'Đã có UID',
    missing_system_sender: 'Chưa chọn nick gửi',
    missing_internal_contact: 'Chưa chọn nick nội bộ',
    missing_internal_phone: 'Nick nội bộ thiếu SĐT',
    sender_disconnected: 'Nick gửi offline',
    uid_not_found: 'Chưa có UID',
    lookup_failed: 'Lỗi tìm UID',
    invalid: 'Invalid',
  } as Record<string, string>)[status] || status;
}

function roleLabel(role: string) {
  return ({ owner: 'Chủ tổ chức', admin: 'Admin', member: 'Nhân viên' } as Record<string, string>)[role] || role;
}

async function fetchOrgConfig() {
  try {
    const { data } = await api.get('/system-notifications/org-config');
    welcomeTemplate.value = data.welcomeMessageTemplate ?? '';
    welcomeImageUrl.value = data.welcomeImageUrl ?? null;
    adminFallbackPhone.value = data.adminFallbackPhone ?? '';
    defaultTemplate.value = data.defaultTemplate ?? '';
    savedSnapshot.value = {
      template: welcomeTemplate.value,
      image: welcomeImageUrl.value,
      phone: adminFallbackPhone.value,
    };
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Lỗi tải cấu hình tin chào mừng';
  }
}

async function saveOrgConfig() {
  savingOrgConfig.value = true;
  orgConfigError.value = '';
  orgConfigSuccess.value = '';
  try {
    await api.patch('/system-notifications/org-config', {
      welcomeMessageTemplate: welcomeTemplate.value.trim() || null,
      welcomeImageUrl: welcomeImageUrl.value,
      adminFallbackPhone: adminFallbackPhone.value.trim() || null,
    });
    savedSnapshot.value = {
      template: welcomeTemplate.value,
      image: welcomeImageUrl.value,
      phone: adminFallbackPhone.value,
    };
    orgConfigSuccess.value = 'Lưu thành công';
    setTimeout(() => { orgConfigSuccess.value = ''; }, 3000);
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Lỗi lưu cấu hình';
  } finally {
    savingOrgConfig.value = false;
  }
}

function discardOrgConfigChanges() {
  welcomeTemplate.value = savedSnapshot.value.template;
  welcomeImageUrl.value = savedSnapshot.value.image;
  adminFallbackPhone.value = savedSnapshot.value.phone;
  orgConfigError.value = '';
  orgConfigSuccess.value = '';
}

function resetTemplate() {
  welcomeTemplate.value = defaultTemplate.value;
}

async function onImagePicked(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  imageUploading.value = true;
  orgConfigError.value = '';
  try {
    const fd = new FormData();
    fd.append('image', file);
    const { data } = await api.post('/system-notifications/welcome-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    welcomeImageUrl.value = data.url;
    savedSnapshot.value.image = data.url; // server-side đã commit, sync snapshot
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Upload ảnh thất bại';
  } finally {
    imageUploading.value = false;
    if (target) target.value = '';
  }
}

async function clearImage() {
  welcomeImageUrl.value = null;
  // Force save ngay vì image upload đã save vào DB lúc upload — clear local-only sẽ misalign.
  // Đơn giản: gọi PATCH để xoá luôn.
  try {
    await api.patch('/system-notifications/org-config', { welcomeImageUrl: null });
    savedSnapshot.value.image = null;
  } catch (err: any) {
    orgConfigError.value = err?.response?.data?.error || 'Xoá ảnh thất bại';
  }
}

async function openPreview() {
  previewLoading.value = true;
  showPreview.value = true;
  try {
    const { data } = await api.post('/system-notifications/preview-welcome', {
      templateOverride: welcomeTemplate.value.trim() || undefined,
      variant: previewVariant.value,
    });
    previewText.value = data.text;
    previewStyles.value = data.styles ?? [];
  } catch (err: any) {
    previewText.value = `Lỗi preview: ${err?.response?.data?.error || err?.message}`;
    previewStyles.value = [];
  } finally {
    previewLoading.value = false;
  }
}

// Re-fetch preview khi đổi variant trong dialog
watch(previewVariant, () => {
  if (showPreview.value) openPreview();
});

onMounted(async () => {
  await fetchSettings();
  await fetchRecipients();
  await fetchOrgConfig();
});
</script>

<style scoped>
.system-notify-page {
  max-width: 1280px;
}

.notify-card {
  border-color: rgba(var(--v-theme-outline), 0.18);
}

.sender-select {
  min-width: 320px;
  max-width: 520px;
}

.recipient-table :deep(td),
.recipient-table :deep(th) {
  white-space: nowrap;
}

.uid-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.template-textarea :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.55;
}

.welcome-image-block {
  flex: 0 0 auto;
}

.welcome-image-preview {
  width: 180px;
  height: 120px;
  border: 1px dashed rgba(var(--v-theme-outline), 0.4);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(var(--v-theme-surface-variant), 0.3);
}

.welcome-image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.admin-phone-field {
  flex: 1 1 280px;
  min-width: 240px;
  max-width: 360px;
}

.preview-pane {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  line-height: 1.55;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  padding: 12px;
  border-radius: 8px;
  max-height: 60vh;
  overflow: auto;
}
</style>
