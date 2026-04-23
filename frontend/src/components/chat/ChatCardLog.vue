<template>
  <div>
    <v-divider class="my-3" />
    <div class="d-flex align-center mb-2">
      <v-icon size="16" color="primary" class="mr-1">mdi-email-fast-outline</v-icon>
      <span class="text-caption font-weight-bold">
        Card Log
        <v-badge v-if="activeCount > 0" :content="activeCount" color="error" inline />
      </span>
      <v-spacer />
      <v-btn size="x-small" variant="text" :loading="loading" @click="load">
        <v-icon size="14">mdi-refresh</v-icon>
      </v-btn>
    </div>

    <div v-if="loading && !enrollments.length" class="text-center py-2">
      <v-progress-circular indeterminate size="20" color="primary" />
    </div>

    <div v-else-if="!enrollments.length" class="text-caption text-grey py-1">
      No automation history
    </div>

    <ChatCardLogItem
      v-for="item in sorted"
      :key="item.id"
      :item="item"
      :acting="acting"
      @pause="handlePause"
      @resume="handleResume"
      @cancel="handleCancel"
      @view-logs="openLogs"
    />

    <DripLogDialog v-model="showLogDialog" :enrollment-id="logEnrollmentId" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { getContactDripHistory, type DripHistoryItem } from '@/api/drip-api';
import { useDripEnrollments } from '@/composables/use-drip-enrollments';
import ChatCardLogItem from './ChatCardLogItem.vue';
import DripLogDialog from '@/components/automation/drip/DripLogDialog.vue';

const props = defineProps<{ contactId: string | null }>();

const enrollments = ref<DripHistoryItem[]>([]);
const loading = ref(false);
const { acting, pause, resume, cancel } = useDripEnrollments();

const showLogDialog = ref(false);
const logEnrollmentId = ref<string | null>(null);

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, failed: 2, completed: 3, cancelled: 4 };

const sorted = computed(() =>
  [...enrollments.value].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)),
);

const activeCount = computed(() => enrollments.value.filter((e) => e.status === 'active').length);

async function load() {
  if (!props.contactId) return;
  loading.value = true;
  try {
    enrollments.value = await getContactDripHistory(props.contactId);
  } catch (err) {
    console.error('ChatCardLog load error:', err);
  } finally {
    loading.value = false;
  }
}

async function handlePause(id: string) {
  await pause(id);
  await load();
}

async function handleResume(id: string) {
  await resume(id);
  await load();
}

async function handleCancel(id: string) {
  await cancel(id);
  await load();
}

function openLogs(id: string) {
  logEnrollmentId.value = id;
  showLogDialog.value = true;
}

watch(() => props.contactId, () => load(), { immediate: false });

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  load();
  timer = setInterval(load, 30_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
