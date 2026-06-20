<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog v-model="open" max-width="440">
    <v-card v-if="info" class="zui-card">
      <!-- Cover + avatar overlay -->
      <div class="zui-cover" :style="info.coverPhoto ? `background-image:url(${info.coverPhoto})` : ''">
        <div class="zui-avatar-wrap">
          <img v-if="info.avatarBig || info.avatar" :src="info.avatarBig || info.avatar" alt="avatar" class="zui-avatar" />
          <div v-else class="zui-avatar zui-avatar-fallback">{{ initials }}</div>
          <span v-if="info.isActive === 1" class="zui-online-dot" title="Đang hoạt động"></span>
        </div>
        <v-btn icon size="small" variant="text" class="zui-close" @click="open = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <v-card-text class="zui-body">
        <!-- Tên + gender icon + verified biz badge -->
        <div class="zui-name">
          {{ info.displayName || info.zaloName || 'Người dùng Zalo' }}
          <v-icon v-if="info.gender === 0" size="16" color="primary" class="ml-1">mdi-gender-male</v-icon>
          <v-icon v-else-if="info.gender === 1" size="16" color="pink" class="ml-1">mdi-gender-female</v-icon>
          <v-tooltip v-if="info.bizPkg && info.bizPkg.pkgId > 0" text="Tài khoản doanh nghiệp">
            <template #activator="{ props: tipProps }">
              <v-icon v-bind="tipProps" size="14" color="warning" class="ml-1">mdi-check-decagram</v-icon>
            </template>
          </v-tooltip>
        </div>

        <!-- Username + UID (monospace) -->
        <div class="zui-handle">
          <span v-if="info.username">@{{ info.username }}</span>
          <span class="zui-uid">UID: {{ info.uid }}</span>
        </div>

        <!-- Status quote text user tự đặt -->
        <div v-if="info.status && !isPhoneStatus" class="zui-status">"{{ info.status }}"</div>

        <v-divider class="my-3" />

        <!-- Section: Thông tin liên hệ -->
        <div class="zui-section">
          <div v-if="info.phoneNumber || isPhoneStatus" class="zui-row">
            <v-icon size="14" color="success">mdi-phone</v-icon>
            <span>{{ info.phoneNumber || info.status }}</span>
            <v-btn
              icon size="x-small" variant="text" class="ml-auto"
              :title="'Sao chép SĐT'"
              @click="copy(info.phoneNumber || info.status)"
            >
              <v-icon size="14">mdi-content-copy</v-icon>
            </v-btn>
          </div>
          <div v-if="info.sdob || info.dob" class="zui-row">
            <v-icon size="14">mdi-cake-variant</v-icon>
            <span>Sinh nhật: <strong>{{ formatDob(info.sdob || info.dob) }}</strong></span>
          </div>
        </div>

        <!-- Section: Trạng thái mối quan hệ -->
        <div class="zui-section">
          <div class="zui-row">
            <v-icon size="14" :color="info.isFr === 1 ? 'success' : 'grey'">
              {{ info.isFr === 1 ? 'mdi-account-check' : 'mdi-account-question' }}
            </v-icon>
            <span>{{ info.isFr === 1 ? 'Đã kết bạn' : 'Chưa kết bạn' }}</span>
          </div>
          <div v-if="info.isBlocked === 1" class="zui-row" style="color:#d32f2f">
            <v-icon size="14" color="error">mdi-block-helper</v-icon>
            <span>Đã chặn</span>
          </div>
          <div v-if="info.lastActionTime > 0" class="zui-row">
            <v-icon size="14">mdi-clock-outline</v-icon>
            <span>Hoạt động gần đây: <strong>{{ formatRelativeTime(info.lastActionTime) }}</strong></span>
          </div>
        </div>

        <!-- Section: Active devices -->
        <div v-if="info.isActivePC === 1 || info.isActiveWeb === 1" class="zui-devices">
          <span class="zui-devices-label">Thiết bị:</span>
          <v-chip v-if="info.isActivePC === 1" size="x-small" variant="tonal" color="primary" prepend-icon="mdi-monitor">PC</v-chip>
          <v-chip v-if="info.isActiveWeb === 1" size="x-small" variant="tonal" color="info" prepend-icon="mdi-web">Web</v-chip>
        </div>

        <!-- Section: OA / Biz info -->
        <div v-if="info.bizPkg && info.bizPkg.pkgId > 0" class="zui-section">
          <div class="zui-row">
            <v-icon size="14" color="warning">mdi-briefcase-check</v-icon>
            <span>Tài khoản DN <strong v-if="info.bizPkg.label">({{ info.bizPkg.label }})</strong></span>
          </div>
          <div v-if="info.bizPkg.createdTs > 0" class="zui-row">
            <v-icon size="14">mdi-calendar-plus</v-icon>
            <span>Tạo: {{ formatDate(info.bizPkg.createdTs * 1000) }}</span>
          </div>
        </div>

        <!-- Action buttons hàng 1: Kết bạn + Nhắn tin (primary actions) -->
        <div class="zui-actions">
          <v-btn
            v-if="info.isFr !== 1 && info.isBlocked !== 1 && zaloAccountId"
            size="small" variant="flat" color="success"
            prepend-icon="mdi-account-plus"
            :loading="friendRequestLoading"
            :disabled="friendRequestSent"
            @click="onSendFriendRequest"
          >
            {{ friendRequestSent ? 'Đã gửi lời mời' : 'Kết bạn' }}
          </v-btn>
          <v-btn
            v-if="zaloAccountId && info && info.uid"
            size="small" variant="flat" color="primary"
            prepend-icon="mdi-message-text"
            :loading="openingChat"
            @click="onOpenChat"
          >Nhắn tin</v-btn>
        </div>

        <!-- Action buttons hàng 2: secondary (zalo.me link + copy UID) -->
        <div class="zui-actions zui-actions-secondary">
          <v-btn
            size="x-small" variant="text" color="primary"
            prepend-icon="mdi-link-variant"
            :href="`https://zalo.me/${info.uid}`"
            target="_blank"
          >Mở trên Zalo</v-btn>
          <v-btn
            size="x-small" variant="text" color="grey"
            prepend-icon="mdi-content-copy"
            @click="copy(info.uid)"
          >Copy UID</v-btn>
        </div>
      </v-card-text>

      <!-- CRM Contact panel — tách biệt với phần Zalo info phía trên -->
      <div v-if="crmContact" class="zui-crm-panel">
        <div class="zui-crm-header">
          <v-icon size="14" color="primary">mdi-account-circle-outline</v-icon>
          <span>Khách hàng CRM</span>
          <v-spacer />
          <v-chip v-if="crmStatusLabel" size="x-small" :color="crmStatusColor" variant="tonal">
            {{ crmStatusLabel }}
          </v-chip>
        </div>
        <div class="zui-crm-body">
          <div v-if="crmContact.crmName || crmContact.fullName" class="zui-row">
            <v-icon size="13">mdi-account</v-icon>
            <span>{{ crmContact.crmName || crmContact.fullName }}</span>
          </div>
          <div v-if="crmContact.phone" class="zui-row">
            <v-icon size="13" color="success">mdi-phone</v-icon>
            <span>{{ crmContact.phone }}</span>
          </div>
          <div v-if="crmContact.email" class="zui-row">
            <v-icon size="13">mdi-email-outline</v-icon>
            <span>{{ crmContact.email }}</span>
          </div>
          <div v-if="crmContact.assignedUser" class="zui-row">
            <v-icon size="13" color="info">mdi-account-tie</v-icon>
            <span>Phụ trách: <strong>{{ crmContact.assignedUser.fullName || crmContact.assignedUser.email }}</strong></span>
          </div>
          <div v-if="crmContact.source" class="zui-row">
            <v-icon size="13">mdi-source-branch</v-icon>
            <span>Nguồn: {{ crmContact.source }}</span>
          </div>
          <div class="zui-crm-stats">
            <div class="zui-stat">
              <div class="zui-stat-num">{{ crmContact.conversationsCount }}</div>
              <div class="zui-stat-label">hội thoại</div>
            </div>
            <div class="zui-stat">
              <div class="zui-stat-num">{{ crmContact.appointmentsCount }}</div>
              <div class="zui-stat-label">lịch hẹn</div>
            </div>
            <div v-if="crmContact.leadScore > 0" class="zui-stat">
              <div class="zui-stat-num zui-stat-score">{{ crmContact.leadScore }}</div>
              <div class="zui-stat-label">lead score</div>
            </div>
          </div>
          <div v-if="crmTags.length > 0" class="zui-crm-tags">
            <v-chip v-for="tag in crmTags" :key="tag" size="x-small" variant="outlined" color="primary">
              {{ tag }}
            </v-chip>
          </div>
          <div v-if="crmContact.notes" class="zui-crm-notes">
            <v-icon size="11" class="mr-1">mdi-note-text-outline</v-icon>
            {{ crmContact.notes }}
          </div>
          <v-btn
            size="x-small" variant="text" color="primary" block class="mt-2"
            prepend-icon="mdi-account-details"
            @click="onOpenContactDetail"
          >Mở chi tiết khách hàng</v-btn>
        </div>
      </div>

      <!-- Trạng thái khi không có CRM contact -->
      <div v-else-if="crmContact === null && crmLoaded" class="zui-crm-empty">
        <v-icon size="14" color="grey">mdi-account-off-outline</v-icon>
        <span>Chưa có trong danh sách khách hàng CRM</span>
      </div>
    </v-card>

    <v-card v-else-if="loading" class="zui-loading">
      <v-progress-circular indeterminate size="24" />
      <span class="ml-3">Đang tải thông tin...</span>
    </v-card>

    <v-card v-else-if="error" class="zui-error pa-4">
      <v-icon color="error">mdi-alert</v-icon>
      <span class="ml-2">Không tải được thông tin user</span>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const router = useRouter();
const toast = useToast();

interface ZaloUserInfo {
  uid: string;
  userId: string;
  username: string;
  globalId: string;
  zaloName: string;
  displayName: string;
  avatar: string;
  avatarBig: string;
  bgavatar: string;
  coverPhoto: string;
  gender: number;
  dob: number | string | null;
  sdob: string | null;
  phoneNumber: string;
  status: string;
  isFr: number;
  isBlocked: number;
  isActive: number;
  isActivePC: number;
  isActiveWeb: number;
  isValid: number;
  lastActionTime: number;
  lastUpdateTime: number;
  type: number;
  accountStatus: number;
  userMode: number;
  bizPkg: { label: string | null; pkgId: number; createdTs: number } | null;
  isExtensionAccount: number;
  oaInfo: unknown;
  oaStatus: unknown;
}

interface CrmContact {
  id: string;
  fullName: string | null;
  crmName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  tags: unknown;
  leadScore: number;
  firstContactDate: string | null;
  lastActivity: string | null;
  assignedUser: { id: string; fullName: string | null; email: string } | null;
  conversationsCount: number;
  appointmentsCount: number;
  lastConversationId: string | null;
}

const props = defineProps<{
  modelValue: boolean;
  uid: string;
  zaloAccountId?: string; // dùng cho friend request endpoint
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  // Fix 2026-06-16: đẩy avatar/tên mới nhất từ SDK lên parent để header + danh sách
  // hội thoại cập nhật tức thì (không phải chờ F5).
  'synced': [payload: { uid: string; avatarUrl: string | null; displayName: string | null; gender: number | null }];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const info = ref<ZaloUserInfo | null>(null);
const loading = ref(false);
const error = ref(false);
const crmContact = ref<CrmContact | null>(null);
const crmLoaded = ref(false);
const friendRequestLoading = ref(false);
const friendRequestSent = ref(false);

async function load(uid: string) {
  loading.value = true;
  error.value = false;
  info.value = null;
  crmContact.value = null;
  crmLoaded.value = false;
  friendRequestSent.value = false;
  try {
    // Fetch Zalo info + CRM contact song song.
    // 2026-06-11 — truyền accountId (nick đang xem) để BE CHỈ gọi đúng nick đó thay vì
    // thử tất cả 30-50 nick (gây lag 538ms + đốt quota Zalo trên product).
    // force=1: user CHỦ ĐỘNG bấm avatar/tên để xem → luôn lấy SDK mới nhất (bỏ cache
    // server 600s) và trigger BE persist Contact+Friend. Chi phí 1 lượt getUserInfo/click
    // (đã scope đúng nick qua accountId nên ~30ms, không đụng PERF "thử tất cả nick").
    const uiParams = {
      params: {
        force: 1,
        ...(props.zaloAccountId ? { accountId: props.zaloAccountId } : {}),
      },
    };
    const [zaloRes, crmRes] = await Promise.all([
      api.get(`/zalo-user-info/${uid}`, uiParams),
      api.get(`/contacts/by-zalo-uid/${uid}`).catch(() => ({ data: { contact: null } })),
    ]);
    info.value = zaloRes.data as ZaloUserInfo;
    crmContact.value = (crmRes.data?.contact || null) as CrmContact | null;
    crmLoaded.value = true;
    // Đẩy avatar/tên mới lên parent → patch conversation state tại chỗ (header + list).
    emit('synced', {
      uid: info.value.uid || uid,
      avatarUrl: info.value.avatarBig || info.value.avatar || null,
      displayName: info.value.zaloName || info.value.displayName || null,
      gender: typeof info.value.gender === 'number' ? info.value.gender : null,
    });
  } catch (err) {
    console.error('[zalo-user-info] load error:', err);
    error.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => props.uid, (uid) => { if (uid && props.modelValue) void load(uid); });
watch(() => props.modelValue, (v) => { if (v && props.uid) void load(props.uid); });

async function onSendFriendRequest() {
  if (!props.zaloAccountId || !info.value) return;
  friendRequestLoading.value = true;
  try {
    await api.post(`/zalo-accounts/${props.zaloAccountId}/friends/requests`, {
      userId: info.value.uid,
      message: 'Xin chào, tôi muốn kết bạn với bạn.',
    });
    friendRequestSent.value = true;
    toast.push('Đã gửi lời mời kết bạn', 'success');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } };
    toast.push(e.response?.data?.error || 'Không gửi được lời mời', 'error');
  } finally {
    friendRequestLoading.value = false;
  }
}

// Mở chat 1-1 với UID này TỪ NICK hiện tại (props.zaloAccountId). KHÔNG dùng
// lastConversationId vì đó có thể là conv của nick khác → bị FilterRail lọc ra.
// Backend ensure-by-uid find-or-create conv cho cặp (nick, uid) — idempotent.
const openingChat = ref(false);
async function onOpenChat() {
  if (!props.zaloAccountId || !info.value?.uid) return;
  openingChat.value = true;
  try {
    const res = await api.post<{ conversationId: string; created: boolean }>(
      '/conversations/ensure-by-uid',
      { zaloAccountId: props.zaloAccountId, uid: info.value.uid },
    );
    if (res.data?.created) toast.push('Đã tạo cuộc trò chuyện mới', 'success');
    router.push(`/chat/${res.data.conversationId}`);
    emit('update:modelValue', false);
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      || 'Không mở được chat';
    toast.push(msg, 'error');
  } finally {
    openingChat.value = false;
  }
}

function onOpenContactDetail() {
  if (!crmContact.value) return;
  router.push(`/contacts/${crmContact.value.id}`);
  emit('update:modelValue', false);
}

const crmTags = computed<string[]>(() => {
  const t = crmContact.value?.tags;
  if (!t) return [];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
});

const CRM_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new: { label: 'Mới', color: 'info' },
  contacted: { label: 'Đã liên hệ', color: 'primary' },
  interested: { label: 'Quan tâm', color: 'warning' },
  converted: { label: 'Đã chốt', color: 'success' },
  lost: { label: 'Mất khách', color: 'grey' },
};
const crmStatusLabel = computed(() => {
  const s = crmContact.value?.status;
  return s ? (CRM_STATUS_LABEL[s]?.label || s) : '';
});
const crmStatusColor = computed(() => {
  const s = crmContact.value?.status;
  return s ? (CRM_STATUS_LABEL[s]?.color || 'grey') : 'grey';
});

const initials = computed(() => {
  const name = info.value?.zaloName || info.value?.displayName || 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

// Zalo đôi khi lưu phone trong `status` field thay vì `phoneNumber`
// (vd "0904808000" khi user chỉ điền số mà không có bio text) — detect pattern
const isPhoneStatus = computed(() => {
  const s = info.value?.status || '';
  return /^0\d{9,10}$/.test(s.trim());
});

function formatDob(d: string | number | null): string {
  if (!d) return '';
  const s = String(d);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const ts = Number(d);
  if (ts > 1e9) return formatInOrgTz(ts * (ts < 1e12 ? 1000 : 1), undefined, { dateOnly: true });
  return s;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return formatInOrgTz(ts, undefined, { dateOnly: true });
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return formatInOrgTz(ts, undefined, { dateOnly: true });
}

function copy(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}
</script>

<style scoped>
.zui-card { border-radius: 14px; overflow: hidden; }
.zui-cover {
  position: relative;
  height: 140px;
  background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%);
  background-size: cover;
  background-position: center;
}
.zui-close {
  position: absolute; top: 8px; right: 8px;
  background: rgba(255,255,255,0.85) !important;
}
.zui-avatar-wrap {
  position: absolute; bottom: -40px; left: 50%; transform: translateX(-50%);
}
.zui-avatar {
  width: 80px; height: 80px; border-radius: 50%;
  border: 3px solid white;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  object-fit: cover;
}
.zui-avatar-fallback {
  background: linear-gradient(135deg, #90caf9, #1976d2);
  color: white; font-weight: 700; font-size: 24px;
  display: flex; align-items: center; justify-content: center;
}
.zui-online-dot {
  position: absolute; bottom: 4px; right: 4px;
  width: 14px; height: 14px;
  background: #4caf50;
  border: 2px solid white;
  border-radius: 50%;
}
.zui-body { padding-top: 52px !important; text-align: center; }
.zui-name {
  font-size: 18px; font-weight: 600;
  display: inline-flex; align-items: center;
}
.zui-handle {
  font-size: 11px; color: #757575; font-family: monospace;
  margin-top: 4px;
  display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;
}
.zui-uid { color: #9e9e9e; }
.zui-status {
  font-style: italic; color: #424242;
  font-size: 12px; margin-top: 10px;
  padding: 8px 12px; background: #f5f5f5; border-radius: 8px;
  line-height: 1.5;
}
.zui-section {
  text-align: left;
  margin-top: 10px;
}
.zui-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; padding: 4px 0;
  color: #424242;
}
.zui-devices {
  display: flex; align-items: center; gap: 6px;
  margin-top: 10px; font-size: 12px;
  justify-content: center;
}
.zui-devices-label { color: #757575; }
.zui-actions {
  display: flex; gap: 8px; justify-content: center;
  margin-top: 16px; flex-wrap: wrap;
}
.zui-actions-secondary {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
}

/* CRM contact panel — tách rõ với Zalo info bằng nền + border */
.zui-crm-panel {
  background: linear-gradient(180deg, #f5faff 0%, #ffffff 100%);
  border-top: 1px solid rgba(25, 118, 210, 0.15);
  padding: 12px 16px;
}
.zui-crm-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; color: #1565c0;
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.zui-crm-body {
  font-size: 12px;
}
.zui-crm-body .zui-row {
  padding: 3px 0;
}
.zui-crm-stats {
  display: flex; gap: 12px;
  margin-top: 8px;
  padding: 8px 0;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
}
.zui-stat {
  flex: 1; text-align: center;
}
.zui-stat-num {
  font-size: 18px; font-weight: 700; color: #1565c0;
  line-height: 1;
}
.zui-stat-score { color: #f57c00; }
.zui-stat-label {
  font-size: 10px; color: #757575;
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-top: 2px;
}
.zui-crm-tags {
  display: flex; gap: 4px; flex-wrap: wrap;
  margin-top: 6px;
}
.zui-crm-notes {
  font-size: 11px;
  color: #757575;
  background: rgba(0, 0, 0, 0.03);
  padding: 6px 8px;
  border-radius: 6px;
  margin-top: 8px;
  font-style: italic;
}
.zui-crm-empty {
  display: flex; align-items: center; gap: 6px;
  justify-content: center;
  font-size: 11px; color: #9e9e9e;
  padding: 10px 16px;
  border-top: 1px solid #f0f0f0;
}
.zui-loading, .zui-error {
  display: flex; align-items: center; justify-content: center;
  padding: 30px; font-size: 13px; color: #757575;
}
</style>
