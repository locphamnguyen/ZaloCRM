<template>
  <div>
    <!-- Filter bar -->
    <div class="d-flex gap-3 mb-3 flex-wrap">
      <v-select
        v-model="filterCampaignId"
        :items="campaignOptions"
        item-title="name"
        item-value="id"
        label="Chiến dịch"
        density="compact"
        variant="outlined"
        clearable
        hide-details
        style="min-width: 200px;"
      />
      <v-select
        v-model="filterStatus"
        :items="statusOptions"
        item-title="label"
        item-value="value"
        label="Trạng thái"
        density="compact"
        variant="outlined"
        clearable
        hide-details
        style="min-width: 160px;"
      />
      <v-spacer />
      <v-btn
        v-if="selected.length"
        size="small"
        color="warning"
        :loading="acting"
        @click="bulkPause"
      >
        Tạm dừng ({{ selected.length }})
      </v-btn>
      <v-btn
        v-if="selected.length"
        size="small"
        color="error"
        :loading="acting"
        @click="bulkCancel"
      >
        Hủy ({{ selected.length }})
      </v-btn>
    </div>

    <v-data-table
      v-model="selected"
      :headers="headers"
      :items="enrollments"
      :loading="loading"
      show-select
      item-value="id"
      no-data-text="Không có enrollment nào"
    >
      <template #item.contact="{ item }">
        <span>{{ item.contact?.crmName || item.contact?.fullName || item.contactId }}</span>
      </template>

      <template #item.campaign="{ item }">
        <span class="text-caption">{{ item.campaign?.name ?? '—' }}</span>
      </template>

      <template #item.progress="{ item }">
        <span class="text-caption">{{ item.currentStep }} bước</span>
      </template>

      <template #item.status="{ item }">
        <v-chip size="small" :color="statusColor(item.status)" variant="tonal">
          {{ statusLabel(item.status) }}
        </v-chip>
      </template>

      <template #item.scheduledAt="{ item }">
        <span class="text-caption">{{ item.scheduledAt ? formatDate(item.scheduledAt) : '—' }}</span>
      </template>

      <template #item.actions="{ item }">
        <div class="d-flex gap-1">
          <v-btn
            v-if="item.status === 'active'"
            icon size="x-small" variant="text" color="warning"
            :loading="acting"
            @click="handlePause(item.id)"
          >
            <v-icon size="14">mdi-pause</v-icon>
          </v-btn>
          <v-btn
            v-if="item.status === 'paused'"
            icon size="x-small" variant="text" color="success"
            :loading="acting"
            @click="handleResume(item.id)"
          >
            <v-icon size="14">mdi-play</v-icon>
          </v-btn>
          <v-btn
            v-if="item.status === 'active' || item.status === 'paused'"
            icon size="x-small" variant="text" color="error"
            :loading="acting"
            @click="handleCancel(item.id)"
          >
            <v-icon size="14">mdi-close-circle</v-icon>
          </v-btn>
          <v-btn icon size="x-small" variant="text" @click="$emit('view-logs', item.id)">
            <v-icon size="14">mdi-text-box-outline</v-icon>
          </v-btn>
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useDripEnrollments } from '@/composables/use-drip-enrollments';
import type { DripCampaign } from '@/api/drip-api';

const props = defineProps<{
  campaigns: DripCampaign[];
}>();

defineEmits<{ 'view-logs': [enrollmentId: string] }>();

const { enrollments, loading, acting, fetchEnrollments, pause, resume, cancel } = useDripEnrollments();

const filterCampaignId = ref<string | null>(null);
const filterStatus = ref<string | null>(null);
const selected = ref<string[]>([]);

const campaignOptions = computed(() => props.campaigns);

const statusOptions = [
  { label: 'Đang chạy', value: 'active' },
  { label: 'Tạm dừng', value: 'paused' },
  { label: 'Hoàn thành', value: 'completed' },
  { label: 'Đã hủy', value: 'cancelled' },
  { label: 'Lỗi', value: 'failed' },
];

const headers = [
  { title: 'Khách hàng', key: 'contact', sortable: false },
  { title: 'Chiến dịch', key: 'campaign', sortable: false },
  { title: 'Bước', key: 'progress', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Gửi tiếp', key: 'scheduledAt', sortable: false },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

function statusColor(s: string) {
  const map: Record<string, string> = { active: 'success', paused: 'warning', completed: 'info', cancelled: 'grey', failed: 'error' };
  return map[s] ?? 'grey';
}

function statusLabel(s: string) {
  return statusOptions.find((o) => o.value === s)?.label ?? s;
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('vi-VN');
}

async function loadData() {
  await fetchEnrollments({
    campaignId: filterCampaignId.value ?? undefined,
    status: filterStatus.value ?? undefined,
    limit: 100,
  });
}

watch([filterCampaignId, filterStatus], () => loadData());

async function handlePause(id: string) { await pause(id); }
async function handleResume(id: string) { await resume(id); }
async function handleCancel(id: string) { await cancel(id); }

async function bulkPause() {
  for (const id of selected.value) await pause(id);
  selected.value = [];
}

async function bulkCancel() {
  for (const id of selected.value) await cancel(id);
  selected.value = [];
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  loadData();
  pollTimer = setInterval(loadData, 10_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>
