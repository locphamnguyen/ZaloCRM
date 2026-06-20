<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-card>
    <v-card-title class="text-body-1">Trạng thái lịch hẹn</v-card-title>
    <v-card-text>
      <Pie v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Pie } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { status: string; _count: { _all: number } | number }[];
}>();

const statusColors: Record<string, string> = {
  'scheduled': '#42A5F5',
  'completed': '#66BB6A',
  'cancelled': '#9E9E9E',
  'no_show': '#EF5350',
};

const statusLabels: Record<string, string> = {
  'scheduled': 'Đã lên lịch',
  'completed': 'Hoàn thành',
  'cancelled': 'Đã hủy',
  'no_show': 'Vắng mặt',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => statusLabels[d.status] || d.status),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map(d => statusColors[d.status] || '#BDBDBD'),
    }],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12 } } },
};
</script>
