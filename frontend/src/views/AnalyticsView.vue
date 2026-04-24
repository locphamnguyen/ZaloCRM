<template>
  <div>
    <!-- Header -->
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h4">
        <v-icon class="mr-2" style="color: #00F2FF;">mdi-chart-timeline-variant-shimmer</v-icon>
        Phân tích nâng cao
      </h1>
      <v-spacer />
      <v-text-field
        v-model="dateFrom"
        label="Từ ngày"
        type="date"
        density="compact"
        variant="outlined"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-text-field
        v-model="dateTo"
        label="Đến ngày"
        type="date"
        density="compact"
        variant="outlined"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-btn color="primary" prepend-icon="mdi-refresh" :loading="loading" @click="fetchAll">Xem</v-btn>
    </div>

    <!-- Filter bar: account + rep dropdowns -->
    <AnalyticsFilterBar
      :zalo-account-id="zaloAccountId"
      :assigned-user-id="assignedUserId"
      :accounts="accounts"
      :users="users"
      class="mb-4"
      @update:zalo-account-id="onAccountChange"
      @update:assigned-user-id="onUserChange"
    />

    <!-- Export error snackbar -->
    <v-snackbar v-model="showExportError" color="error" timeout="4000">
      {{ exportError }}
    </v-snackbar>

    <!-- Tabs -->
    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="overview">Tổng quan</v-tab>
      <v-tab value="funnel">Phễu khách hàng</v-tab>
      <v-tab value="team">Đội nhóm</v-tab>
      <v-tab value="response">Thời gian trả lời</v-tab>
      <v-tab value="heatmap">Heatmap</v-tab>
      <v-tab value="tags">Thẻ tag</v-tab>
      <v-tab value="drip">Drip campaigns</v-tab>
      <v-tab value="builder">Báo cáo tùy chỉnh</v-tab>
    </v-tabs>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-window v-model="tab">
      <v-window-item value="overview">
        <OverviewPanel :funnel="funnel" :team-performance="teamPerformance" :response-time="responseTime" />
      </v-window-item>

      <v-window-item value="funnel">
        <ExportStrip type="funnel" :export-loading="exportLoading" @export="exportCsv" />
        <ConversionFunnelChart :data="funnel" />
      </v-window-item>

      <v-window-item value="team">
        <ExportStrip type="team" :export-loading="exportLoading" @export="exportCsv" />
        <TeamLeaderboard :data="teamPerformance" />
      </v-window-item>

      <v-window-item value="response">
        <ExportStrip type="response" :export-loading="exportLoading" @export="exportCsv" />
        <v-row>
          <v-col cols="12"><ResponseTimeChart :data="responseTime" /></v-col>
          <v-col cols="12"><ResponseTimeByUserTable :items="responseTime?.byUser" /></v-col>
        </v-row>
      </v-window-item>

      <v-window-item value="heatmap">
        <ExportStrip type="heatmap" :export-loading="exportLoading" @export="exportCsv" />
        <ResponseHeatmap :data="responseHeatmap" />
      </v-window-item>

      <v-window-item value="tags">
        <ExportStrip type="tags" :export-loading="exportLoading" @export="exportCsv" />
        <TagDistributionChart :data="tagDistribution" />
      </v-window-item>

      <v-window-item value="drip">
        <ExportStrip type="drip" :export-loading="exportLoading" @export="exportCsv" />
        <DripKpiCard :data="dripKpi" />
      </v-window-item>

      <v-window-item value="builder">
        <ReportBuilder
          :result="customResult"
          :saved-reports="savedReports"
          :loading="loading"
          :date-from="dateFrom"
          :date-to="dateTo"
          @run="runCustomReport"
          @save="onSaveReport"
          @run-saved="onRunSaved"
          @delete-saved="deleteSavedReport"
        />
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useAnalytics } from '@/composables/use-analytics';
import type { ReportConfig, SavedReport } from '@/composables/use-analytics';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useUsers } from '@/composables/use-users';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar.vue';
import OverviewPanel from '@/components/analytics/OverviewPanel.vue';
import ConversionFunnelChart from '@/components/analytics/ConversionFunnelChart.vue';
import TeamLeaderboard from '@/components/analytics/TeamLeaderboard.vue';
import ResponseTimeChart from '@/components/analytics/ResponseTimeChart.vue';
import ResponseTimeByUserTable from '@/components/analytics/ResponseTimeByUserTable.vue';
import ReportBuilder from '@/components/analytics/ReportBuilder.vue';
import ResponseHeatmap from '@/components/analytics/ResponseHeatmap.vue';
import TagDistributionChart from '@/components/analytics/TagDistributionChart.vue';
import DripKpiCard from '@/components/analytics/DripKpiCard.vue';
import ExportStrip from '@/components/analytics/ExportStrip.vue';

// ── Composables ───────────────────────────────────────────────────────────────

const {
  funnel, teamPerformance, responseTime, customResult, savedReports,
  responseHeatmap, tagDistribution, dripKpi,
  loading, dateFrom, dateTo,
  zaloAccountId, assignedUserId,
  exportLoading, exportError,
  fetchAll, exportCsv,
  runCustomReport, fetchSavedReports, createSavedReport, deleteSavedReport, runSavedReport,
} = useAnalytics();

const { accounts, fetchAccounts } = useZaloAccounts();
const { users, fetchUsers } = useUsers();

// ── Local state ───────────────────────────────────────────────────────────────

const tab = ref('overview');
const showExportError = ref(false);

watch(exportError, (val) => { if (val) showExportError.value = true; });

function onAccountChange(val: string | null) {
  zaloAccountId.value = val;
  fetchAll();
}

function onUserChange(val: string | null) {
  assignedUserId.value = val;
  fetchAll();
}

async function onSaveReport(data: { name: string; type: string; config: ReportConfig }) {
  await createSavedReport(data);
}

async function onRunSaved(report: SavedReport) {
  const result = await runSavedReport(report.id);
  if (result) customResult.value = result;
  tab.value = 'builder';
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await Promise.all([fetchAccounts(), fetchUsers(), fetchAll(), fetchSavedReports()]);
});
</script>
