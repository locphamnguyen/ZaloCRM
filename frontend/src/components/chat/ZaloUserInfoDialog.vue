<template>
  <v-dialog v-model="open" max-width="380">
    <v-card v-if="info" class="zui-card">
      <!-- Cover + avatar overlay -->
      <div class="zui-cover" :style="info.coverPhoto ? `background-image:url(${info.coverPhoto})` : ''">
        <div class="zui-avatar-wrap">
          <img v-if="info.avatarBig || info.avatar" :src="info.avatarBig || info.avatar" alt="avatar" class="zui-avatar" />
          <div v-else class="zui-avatar zui-avatar-fallback">{{ initials }}</div>
        </div>
        <v-btn icon size="small" variant="text" class="zui-close" @click="open = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <v-card-text class="zui-body">
        <div class="zui-name">
          {{ info.zaloName || 'Người dùng Zalo' }}
          <v-icon v-if="info.gender === 0" size="16" color="primary" class="ml-1">mdi-gender-male</v-icon>
          <v-icon v-else-if="info.gender === 1" size="16" color="pink" class="ml-1">mdi-gender-female</v-icon>
        </div>
        <div class="zui-uid">UID: {{ info.uid }}</div>

        <v-divider class="my-3" />

        <div v-if="info.sdob || info.dob" class="zui-row">
          <v-icon size="14">mdi-calendar</v-icon>
          <span>Ngày sinh: <strong>{{ formatDob(info.sdob || info.dob) }}</strong></span>
        </div>
        <div v-if="info.phoneNumber" class="zui-row">
          <v-icon size="14">mdi-phone</v-icon>
          <span>{{ info.phoneNumber }}</span>
        </div>
        <div class="zui-row">
          <v-icon size="14">mdi-account-check-outline</v-icon>
          <span>{{ info.isFr === 1 ? 'Đã kết bạn' : 'Chưa kết bạn' }}</span>
        </div>
        <div v-if="info.status" class="zui-status">"{{ info.status }}"</div>
      </v-card-text>
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
import { api } from '@/api/index';

interface ZaloUserInfo {
  uid: string;
  zaloName: string;
  avatar: string;
  avatarBig: string;
  gender: number;
  dob: string | null;
  sdob: string | null;
  phoneNumber: string;
  coverPhoto: string;
  status: string;
  isFr: number;
  type: number;
  userId: string;
}

const props = defineProps<{
  modelValue: boolean;
  uid: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const info = ref<ZaloUserInfo | null>(null);
const loading = ref(false);
const error = ref(false);

async function load(uid: string) {
  loading.value = true;
  error.value = false;
  info.value = null;
  try {
    const res = await api.get(`/zalo-user-info/${uid}`);
    info.value = res.data as ZaloUserInfo;
  } catch (err) {
    console.error('[zalo-user-info] load error:', err);
    error.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => props.uid, (uid) => {
  if (uid && props.modelValue) void load(uid);
});
watch(() => props.modelValue, (v) => {
  if (v && props.uid) void load(props.uid);
});

const initials = computed(() => {
  const name = info.value?.zaloName || 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

function formatDob(d: string | null): string {
  if (!d) return '';
  // Zalo sdob format thường "DD/MM/YYYY" hoặc number
  const s = String(d);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const ts = Number(d);
  if (ts > 1e9) return new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleDateString('vi-VN');
  return s;
}
</script>

<style scoped>
.zui-card { border-radius: 14px; overflow: hidden; }
.zui-cover {
  position: relative;
  height: 130px;
  background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%);
  background-size: cover;
  background-position: center;
}
.zui-close {
  position: absolute; top: 8px; right: 8px;
  background: rgba(255,255,255,0.85) !important;
}
.zui-avatar-wrap {
  position: absolute; bottom: -36px; left: 50%; transform: translateX(-50%);
}
.zui-avatar {
  width: 72px; height: 72px; border-radius: 50%;
  border: 3px solid white;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  object-fit: cover;
}
.zui-avatar-fallback {
  background: linear-gradient(135deg, #90caf9, #1976d2);
  color: white; font-weight: 700; font-size: 24px;
  display: flex; align-items: center; justify-content: center;
}
.zui-body { padding-top: 48px !important; text-align: center; }
.zui-name {
  font-size: 18px; font-weight: 600;
  display: inline-flex; align-items: center;
}
.zui-uid {
  font-size: 11px; color: #757575; font-family: monospace;
  margin-top: 2px;
}
.zui-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; padding: 5px 0;
  color: #424242;
}
.zui-status {
  font-style: italic; color: #757575;
  font-size: 12px; margin-top: 10px;
  padding: 8px 12px; background: #f5f5f5; border-radius: 8px;
}
.zui-loading, .zui-error {
  display: flex; align-items: center; justify-content: center;
  padding: 30px; font-size: 13px; color: #757575;
}
</style>
