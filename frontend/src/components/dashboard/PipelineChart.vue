<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-card>
    <v-card-title class="text-body-1">Pipeline khách hàng</v-card-title>
    <v-card-text>
      <Doughnut v-if="chartData" :data="chartData" :options="chartOptions" style="height: 250px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { status: string | null; _count: { _all: number } | number }[];
}>();

const statusColors: Record<string, string> = {
  new: '#9E9E9E',
  contacted: '#42A5F5',
  interested: '#FF9800',
  converted: '#66BB6A',
  lost: '#EF5350',
};

const statusLabels: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  const filtered = props.data.filter(d => d.status);
  if (!filtered.length) return null;
  return {
    labels: filtered.map(d => statusLabels[d.status || ''] || d.status),
    datasets: [{
      data: filtered.map(d => getCount(d)),
      backgroundColor: filtered.map(d => statusColors[d.status || ''] || '#BDBDBD'),
    }],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12 } } },
};
</script>
