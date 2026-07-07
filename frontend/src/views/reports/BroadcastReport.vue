<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension -->
<!--
  BroadcastReport — Thống kê Broadcast tự động (Community).
  Endpoint: GET /reports/broadcast?from&to. report-kit.css (global, scope .rpt-scope).
-->
<template>
  <div class="rpt">
    <!-- HEAD -->
    <div class="rpt-head">
      <div class="rpt-titles">
        <div class="ic"><v-icon icon="mdi-bullhorn-outline" size="24" /></div>
        <div>
          <div class="rpt-h1">Broadcast tự động</div>
          <div class="rpt-sub">
            Tỉ lệ gửi thành công theo nick Zalo và theo tệp khách hàng — theo dõi chất lượng
            gửi rải để phát hiện sớm nick bị chặn hoặc tệp sai số điện thoại.
          </div>
        </div>
      </div>
      <div class="rpt-actions">
        <button class="rk-btn ghost" :disabled="loading" @click="load">
          <v-icon icon="mdi-refresh" size="16" /> Làm mới
        </button>
      </div>
    </div>

    <!-- FILTERS -->
    <div class="rpt-filters">
      <div class="seg">
        <button v-for="r in ranges" :key="r.key" :class="{ on: range === r.key }" @click="range = r.key">{{ r.label }}</button>
      </div>
    </div>

    <!-- LOADING -->
    <div v-if="loading" class="rk-loading">
      <v-icon icon="mdi-loading" size="20" /> Đang tải dữ liệu…
    </div>

    <template v-else-if="data">
      <!-- KPI ROW -->
      <div class="grid g-4" style="margin-bottom:18px">
        <div class="kpi">
          <div class="top"><span class="label">Tổng broadcast</span><span class="kic"><v-icon icon="mdi-bullhorn-outline" size="18" /></span></div>
          <div class="val">{{ n(k.totalJobs) }}<span class="u">/ {{ n(k.activeJobs) }} đang hoạt động</span></div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Đã gửi</span><span class="kic"><v-icon icon="mdi-send-check-outline" size="18" /></span></div>
          <div class="val">{{ n(k.totalSent) }}</div>
        </div>
        <div class="kpi accent-danger">
          <div class="top"><span class="label">Lỗi</span><span class="kic"><v-icon icon="mdi-send-circle-outline" size="18" /></span></div>
          <div class="val">{{ n(k.totalFailed) }}<span class="u">· bỏ qua {{ n(k.totalSkipped) }}</span></div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Tỉ lệ thành công</span><span class="kic"><v-icon icon="mdi-check-decagram-outline" size="18" /></span></div>
          <div class="val">{{ n(k.successRatePct) }}<span class="u">%</span></div>
        </div>
      </div>

      <!-- BY NICK + BY LIST -->
      <div class="grid g-2" style="margin-bottom:18px">
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-account-circle-outline" size="18" /> Theo nick gửi</div>
            <div class="meta">{{ n(byNick.length) }} nick</div>
          </div>
          <div class="card-b" style="padding:0">
            <table class="tbl">
              <thead><tr><th>Nick</th><th class="num">Đã gửi</th><th class="num">Lỗi</th><th class="num">Tỉ lệ TC</th></tr></thead>
              <tbody>
                <tr v-if="!byNick.length"><td colspan="4"><div class="rk-empty">Chưa có dữ liệu.</div></td></tr>
                <tr v-for="row in byNick" :key="row.zaloAccountId">
                  <td>{{ row.nickName }}</td>
                  <td class="num">{{ n(row.sent) }}</td>
                  <td class="num">{{ n(row.failed) }}</td>
                  <td class="num"><span class="pill" :class="rateClass(row.successRatePct)">{{ n(row.successRatePct) }}%</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-format-list-bulleted" size="18" /> Theo tệp khách hàng</div>
            <div class="meta">{{ n(byList.length) }} tệp</div>
          </div>
          <div class="card-b" style="padding:0">
            <table class="tbl">
              <thead><tr><th>Tệp</th><th class="num">Đã gửi</th><th class="num">Lỗi</th><th class="num">Tỉ lệ TC</th></tr></thead>
              <tbody>
                <tr v-if="!byList.length"><td colspan="4"><div class="rk-empty">Chưa có dữ liệu.</div></td></tr>
                <tr v-for="row in byList" :key="row.customerListId">
                  <td>{{ row.listName }}</td>
                  <td class="num">{{ n(row.sent) }}</td>
                  <td class="num">{{ n(row.failed) }}</td>
                  <td class="num"><span class="pill" :class="rateClass(row.successRatePct)">{{ n(row.successRatePct) }}%</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- RECENT RUNS -->
      <div class="card">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-history" size="18" /> Lần chạy gần đây</div>
          <div class="meta">{{ n(recentRuns.length) }} run</div>
        </div>
        <div class="card-b" style="padding:0">
          <table class="tbl">
            <thead>
              <tr><th>Broadcast</th><th>Tệp</th><th>Nick</th><th>Trạng thái</th><th class="num">Gửi/Lỗi/Bỏ qua</th><th>Bắt đầu</th></tr>
            </thead>
            <tbody>
              <tr v-if="!recentRuns.length"><td colspan="6"><div class="rk-empty">Chưa có lần chạy nào trong khoảng thời gian này.</div></td></tr>
              <tr v-for="run in recentRuns" :key="run.runId">
                <td>{{ run.jobName }}</td>
                <td>{{ run.listName }}</td>
                <td>{{ run.nickName }}</td>
                <td><span class="pill" :class="statusClass(run.status)">{{ statusLabel(run.status) }}</span></td>
                <td class="num">{{ n(run.sent) }} / {{ n(run.failed) }} / {{ n(run.skipped) }}</td>
                <td class="num">{{ fmtDate(run.startedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-else class="rk-empty">Không tải được dữ liệu báo cáo.</div>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api';
import { ref, onMounted, watch, computed } from 'vue';

const data = ref<any>(null);
const loading = ref(true);
const range = ref('30d');

const ranges = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: '30d', label: '30 ngày' },
];

const k = computed<any>(() => data.value?.kpis ?? {});
const byNick = computed<any[]>(() => data.value?.byNick ?? []);
const byList = computed<any[]>(() => data.value?.byList ?? []);
const recentRuns = computed<any[]>(() => data.value?.recentRuns ?? []);

function pad(d: Date) {
  return d.toISOString().slice(0, 10);
}
function rangeDates() {
  const to = new Date();
  const from = new Date();
  if (range.value === 'today') {
    // from = to (same day)
  } else if (range.value === '7d') {
    from.setDate(from.getDate() - 6);
  } else {
    from.setDate(from.getDate() - 29);
  }
  return { from: pad(from), to: pad(to) };
}

async function load() {
  loading.value = true;
  try {
    const { from, to } = rangeDates();
    const res = await api.get('/reports/broadcast', { params: { from, to } });
    data.value = res.data;
  } catch (e) {
    data.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(range, load);

function n(v: any): string {
  const num = Number(v);
  if (v == null || Number.isNaN(num)) return '0';
  return num.toLocaleString('vi-VN');
}
function rateClass(v: any): string {
  const num = Number(v) || 0;
  if (num >= 90) return 'ok';
  if (num >= 70) return 'warn';
  return 'danger';
}
function statusClass(s: string): string {
  if (s === 'done') return 'ok';
  if (s === 'running') return 'warn';
  return 'danger';
}
function statusLabel(s: string): string {
  return s === 'done' ? 'Xong' : s === 'running' ? 'Đang chạy' : 'Lỗi';
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}
</script>
