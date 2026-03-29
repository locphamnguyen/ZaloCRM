<template>
  <v-card>
    <v-card-title class="text-body-1">Báo cáo tùy chỉnh</v-card-title>
    <v-card-text>
      <v-row>
        <v-col cols="12" md="5">
          <v-select
            v-model="selectedMetrics"
            :items="metricOptions"
            label="Chỉ số"
            multiple
            chips
            closable-chips
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="groupBy"
            :items="groupByOptions"
            label="Nhóm theo"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="2">
          <v-select
            v-model="filterSource"
            :items="sourceOptions"
            label="Nguồn"
            clearable
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="2" class="d-flex gap-2">
          <v-btn color="primary" :loading="loading" :disabled="!selectedMetrics.length" @click="run">
            Chạy
          </v-btn>
          <v-btn variant="outlined" :disabled="!selectedMetrics.length" @click="saveDialog = true">
            Lưu
          </v-btn>
        </v-col>
      </v-row>

      <!-- Results chart -->
      <div v-if="result" class="mt-4">
        <Bar :data="resultChartData!" :options="chartOptions" style="height: 300px;" />
      </div>

      <!-- Saved reports -->
      <div v-if="savedReports.length" class="mt-6">
        <div class="text-subtitle-2 mb-2">Báo cáo đã lưu</div>
        <v-list density="compact">
          <v-list-item v-for="r in savedReports" :key="r.id" :title="r.name" :subtitle="r.type">
            <template #append>
              <v-btn icon="mdi-play" size="small" variant="text" @click="$emit('runSaved', r)" />
              <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="$emit('deleteSaved', r.id)" />
            </template>
          </v-list-item>
        </v-list>
      </div>
    </v-card-text>

    <!-- Save dialog -->
    <v-dialog v-model="saveDialog" max-width="400">
      <v-card>
        <v-card-title>Lưu báo cáo</v-card-title>
        <v-card-text>
          <v-text-field v-model="reportName" label="Tên báo cáo" variant="outlined" density="compact" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="saveDialog = false">Hủy</v-btn>
          <v-btn color="primary" :disabled="!reportName" @click="save">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import type { CustomReportResult, SavedReport, ReportConfig } from '@/composables/use-analytics';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const props = defineProps<{
  result: CustomReportResult | null;
  savedReports: SavedReport[];
  loading: boolean;
  dateFrom: string;
  dateTo: string;
}>();

const emit = defineEmits<{
  run: [config: ReportConfig];
  save: [data: { name: string; type: string; config: ReportConfig }];
  runSaved: [report: SavedReport];
  deleteSaved: [id: string];
}>();

const selectedMetrics = ref<string[]>([]);
const groupBy = ref('day');
const filterSource = ref<string | null>(null);
const saveDialog = ref(false);
const reportName = ref('');

const metricOptions = [
  { title: 'Tin nhắn gửi', value: 'messages_sent' },
  { title: 'Tin nhắn nhận', value: 'messages_received' },
  { title: 'KH mới', value: 'contacts_new' },
  { title: 'KH chuyển đổi', value: 'contacts_converted' },
  { title: 'Lịch hẹn', value: 'appointments' },
  { title: 'TG trả lời TB', value: 'avg_response_time' },
];

const groupByOptions = [
  { title: 'Theo ngày', value: 'day' },
  { title: 'Theo tuần', value: 'week' },
  { title: 'Theo tháng', value: 'month' },
  { title: 'Theo nhân viên', value: 'user' },
  { title: 'Theo nguồn', value: 'source' },
];

const sourceOptions = ['FB', 'TT', 'GT', 'CN', 'ZL'];

const datasetColors = ['#42A5F5', '#66BB6A', '#FFA726', '#EF5350', '#AB47BC', '#26C6DA'];

function buildConfig(): ReportConfig {
  return {
    metrics: selectedMetrics.value,
    groupBy: groupBy.value,
    dateRange: { from: props.dateFrom, to: props.dateTo },
    filters: filterSource.value ? { source: filterSource.value } : undefined,
  };
}

function run() {
  emit('run', buildConfig());
}

function save() {
  emit('save', { name: reportName.value, type: 'custom', config: buildConfig() });
  saveDialog.value = false;
  reportName.value = '';
}

const metricLabels: Record<string, string> = {
  messages_sent: 'Tin nhắn gửi',
  messages_received: 'Tin nhắn nhận',
  contacts_new: 'KH mới',
  contacts_converted: 'KH chuyển đổi',
  appointments: 'Lịch hẹn',
  avg_response_time: 'TG trả lời (s)',
};

const resultChartData = computed(() => {
  if (!props.result) return null;
  return {
    labels: props.result.labels,
    datasets: props.result.datasets.map((ds, i) => ({
      label: metricLabels[ds.metric] ?? ds.metric,
      data: ds.data,
      backgroundColor: datasetColors[i % datasetColors.length],
    })),
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'top' as const } },
  scales: { y: { beginAtZero: true } },
};
</script>
