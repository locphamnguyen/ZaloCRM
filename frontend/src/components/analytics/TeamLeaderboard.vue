<template>
  <v-card>
    <v-card-title class="text-body-1">Bảng xếp hạng đội nhóm</v-card-title>
    <v-card-text>
      <v-data-table
        v-if="data?.users?.length"
        :headers="headers"
        :items="rankedUsers"
        density="compact"
        no-data-text="Không có dữ liệu"
      >
        <template #item.rank="{ item }">
          <v-icon v-if="item.rank === 1" color="amber" size="20">mdi-trophy</v-icon>
          <v-icon v-else-if="item.rank === 2" color="grey-lighten-1" size="20">mdi-trophy</v-icon>
          <v-icon v-else-if="item.rank === 3" color="brown" size="20">mdi-trophy</v-icon>
          <span v-else>{{ item.rank }}</span>
        </template>
        <template #item.avgResponseTime="{ item }">
          {{ formatTime(item.avgResponseTime) }}
        </template>
      </v-data-table>
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TeamPerformanceData } from '@/composables/use-analytics';

const props = defineProps<{ data: TeamPerformanceData | null }>();

const headers = [
  { title: '#', key: 'rank', width: '60px' },
  { title: 'Họ tên', key: 'fullName' },
  { title: 'Tin nhắn gửi', key: 'messagesSent', align: 'end' as const },
  { title: 'KH chuyển đổi', key: 'contactsConverted', align: 'end' as const },
  { title: 'Lịch hẹn xong', key: 'appointmentsCompleted', align: 'end' as const },
  { title: 'TG trả lời TB', key: 'avgResponseTime', align: 'end' as const },
];

const rankedUsers = computed(() => {
  if (!props.data?.users) return [];
  return props.data.users.map((u, i) => ({ ...u, rank: i + 1 }));
});

function formatTime(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}p ${s}s`;
}
</script>
