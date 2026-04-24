<template>
  <v-card v-if="items?.length">
    <v-card-title class="text-body-1">Thời gian trả lời theo nhân viên</v-card-title>
    <v-card-text>
      <v-data-table
        :headers="headers"
        :items="items"
        density="compact"
        no-data-text="Không có dữ liệu"
      >
        <template #item.avgSeconds="{ item }">{{ formatTime(item.avgSeconds) }}</template>
      </v-data-table>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
defineProps<{
  items: { userId: string; fullName: string; avgSeconds: number }[] | undefined;
}>();

const headers = [
  { title: 'Họ tên', key: 'fullName' },
  { title: 'TG trả lời TB', key: 'avgSeconds', align: 'end' as const },
];

function formatTime(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s} giây` : `${m} phút ${s} giây`;
}
</script>
