<template>
  <v-card>
    <v-card-title class="text-body-1">Phễu chuyển đổi</v-card-title>
    <v-card-text>
      <Bar v-if="chartData" :data="chartData" :options="chartOptions" style="height: 280px;" />
      <div v-else class="text-center pa-8 text-grey">Không có dữ liệu</div>
      <div v-if="data?.avgConversionDays" class="text-caption text-grey mt-2 text-center">
        Thời gian chuyển đổi trung bình: {{ data.avgConversionDays }} ngày
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { ConversionFunnelData } from '@/composables/use-analytics';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{ data: ConversionFunnelData | null }>();

const statusLabels: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

const stageColors: Record<string, string> = {
  new: '#9E9E9E',
  contacted: '#42A5F5',
  interested: '#FFA726',
  converted: '#66BB6A',
  lost: '#EF5350',
};

const chartData = computed(() => {
  if (!props.data?.stages?.length) return null;
  return {
    labels: props.data.stages.map((s) => statusLabels[s.status] ?? s.status),
    datasets: [
      {
        label: 'Số khách hàng',
        data: props.data.stages.map((s) => s.count),
        backgroundColor: props.data.stages.map((s) => stageColors[s.status] ?? '#78909C'),
      },
    ],
  };
});

const chartOptions = {
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const stage = props.data?.stages[ctx.dataIndex];
          return `${ctx.raw} (${stage?.rate ?? 0}%)`;
        },
      },
    },
  },
  scales: {
    x: { beginAtZero: true },
  },
};
</script>
