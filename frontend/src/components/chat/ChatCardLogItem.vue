<template>
  <div
    class="mb-2 pa-2"
    style="border-radius: 8px; border: 1px solid rgba(0,0,0,0.08);"
    :style="bgStyle"
  >
    <div class="d-flex align-center gap-2 mb-1">
      <v-icon :color="statusColor" size="16">{{ statusIcon }}</v-icon>
      <span class="text-body-2 font-weight-medium flex-grow-1">{{ item.campaignName }}</span>
      <v-chip size="x-small" :color="statusColor" variant="tonal">{{ statusLabel }}</v-chip>
    </div>

    <div class="text-caption mb-1">
      Tiến độ: {{ item.currentStep }}/{{ item.totalSteps }}
    </div>

    <div v-if="item.status === 'active' && item.nextSendAt" class="text-caption text-grey mb-2">
      Gửi tiếp: {{ formatDate(item.nextSendAt) }}
    </div>
    <div v-else-if="item.status === 'completed'" class="text-caption text-grey mb-2">
      Hoàn thành: {{ item.lastSentAt ? formatDate(item.lastSentAt) : '—' }}
    </div>

    <div class="d-flex gap-1">
      <v-btn
        v-if="item.status === 'active'"
        size="x-small"
        color="warning"
        variant="tonal"
        :loading="acting"
        @click="$emit('pause', item.id)"
      >
        Tạm dừng
      </v-btn>
      <v-btn
        v-if="item.status === 'paused'"
        size="x-small"
        color="success"
        variant="tonal"
        :loading="acting"
        @click="$emit('resume', item.id)"
      >
        Tiếp tục
      </v-btn>
      <v-btn
        v-if="item.status === 'active' || item.status === 'paused'"
        size="x-small"
        color="error"
        variant="text"
        :loading="acting"
        @click="$emit('cancel', item.id)"
      >
        Hủy
      </v-btn>
      <v-btn
        size="x-small"
        variant="text"
        @click="$emit('view-logs', item.id)"
      >
        Xem logs
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DripHistoryItem } from '@/api/drip-api';

const props = defineProps<{
  item: DripHistoryItem;
  acting: boolean;
}>();

defineEmits<{
  pause: [id: string];
  resume: [id: string];
  cancel: [id: string];
  'view-logs': [id: string];
}>();

const statusColor = computed(() => {
  const map: Record<string, string> = { active: 'success', paused: 'warning', completed: 'info', cancelled: 'grey', failed: 'error' };
  return map[props.item.status] ?? 'grey';
});

const statusIcon = computed(() => {
  const map: Record<string, string> = { active: 'mdi-play-circle', paused: 'mdi-pause-circle', completed: 'mdi-check-circle', cancelled: 'mdi-close-circle', failed: 'mdi-alert-circle' };
  return map[props.item.status] ?? 'mdi-circle';
});

const statusLabel = computed(() => {
  const map: Record<string, string> = { active: 'Đang chạy', paused: 'Tạm dừng', completed: 'Hoàn thành', cancelled: 'Đã hủy', failed: 'Lỗi' };
  return map[props.item.status] ?? props.item.status;
});

const bgStyle = computed(() => {
  const map: Record<string, string> = {
    active: 'background: rgba(76,175,80,0.05);',
    paused: 'background: rgba(255,152,0,0.05);',
    completed: 'background: rgba(33,150,243,0.05);',
    cancelled: 'background: rgba(0,0,0,0.03);',
    failed: 'background: rgba(244,67,54,0.05);',
  };
  return map[props.item.status] ?? '';
});

function formatDate(d: string) {
  return new Date(d).toLocaleString('vi-VN');
}
</script>
