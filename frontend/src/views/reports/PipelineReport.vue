<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  PipelineReport — Pipeline & Lead Pool (2026-06-17).
  Fetch song song /reports/pipeline (#4) + /reports/lead-pool (#5). report-kit classes (scope .rpt-scope ở ReportsShell).
-->
<template>
  <div class="rpt">
    <!-- HEAD -->
    <div class="rpt-head">
      <div class="rpt-titles">
        <div class="ic"><v-icon icon="mdi-filter-variant" size="24" /></div>
        <div>
          <div class="rpt-h1">Pipeline &amp; Lead Pool</div>
          <div class="rpt-sub">
            Lead đang kẹt ở stage nào, nguồn nào ra chốt tốt, và lead pool chia có công bằng không —
            soi nhanh để gỡ tắc và cân tải đội sale.
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
        <button
          v-for="r in ranges"
          :key="r.key"
          :class="{ on: range === r.key }"
          @click="range = r.key"
        >{{ r.label }}</button>
      </div>
    </div>

    <!-- LOADING -->
    <div v-if="loading" class="rk-loading">
      <v-icon icon="mdi-loading" size="20" class="mdi-spin" /> Đang tải báo cáo…
    </div>

    <template v-else>
      <!-- KPI ROW -->
      <div class="grid g-4" style="margin-bottom:18px">
        <div class="kpi accent-ok">
          <div class="top">
            <span class="label">Tỉ lệ chốt</span>
            <span class="kic"><v-icon icon="mdi-flag-checkered" size="17" /></span>
          </div>
          <div class="val">{{ fmtPct(pipe?.kpis?.closeRate) }}<span class="u">%</span></div>
        </div>
        <div class="kpi">
          <div class="top">
            <span class="label">Time-in-stage TB</span>
            <span class="kic"><v-icon icon="mdi-timer-sand" size="17" /></span>
          </div>
          <div class="val">{{ fmtNum(pipe?.kpis?.avgTimeInStageDays) }}<span class="u">ngày</span></div>
        </div>
        <div class="kpi accent-warn">
          <div class="top">
            <span class="label">Lead pool đang chờ</span>
            <span class="kic"><v-icon icon="mdi-gift-outline" size="17" /></span>
          </div>
          <div class="val">{{ fmtInt(pool?.kpis?.waiting) }}</div>
        </div>
        <div class="kpi accent-danger">
          <div class="top">
            <span class="label">Tỉ lệ trả lead</span>
            <span class="kic"><v-icon icon="mdi-backup-restore" size="17" /></span>
          </div>
          <div class="val">{{ fmtPct(pool?.kpis?.returnRate) }}<span class="u">%</span></div>
        </div>
      </div>

      <!-- PIPELINE ROW -->
      <div class="grid g-3" style="margin-bottom:14px">
        <!-- Funnel -->
        <div class="card col-2">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-filter-outline" size="17" /> Phễu pipeline</div>
            <div class="meta">% là tỉ lệ rớt sang stage sau</div>
          </div>
          <div class="card-b">
            <div v-if="funnel.length" class="funnel">
              <div v-for="(s, i) in funnel" :key="i" class="stp">
                <div class="nm">{{ s.status }}</div>
                <div class="track">
                  <i :style="{ width: funnelWidth(s) + '%' }"></i>
                  <div class="vv">{{ fmtInt(s.count) }}</div>
                </div>
                <div class="drop" :class="{ faint: i === 0 }">
                  {{ i === 0 ? '—' : '-' + fmtPct(s.dropPct) + '%' }}
                </div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có dữ liệu phễu.</div>
          </div>
        </div>

        <!-- Time in stage -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-timer-sand" size="17" /> Thời gian ở mỗi stage</div>
            <div class="meta">ngày · trung bình</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="timeInStage.length" class="tbl">
              <thead><tr><th>Stage</th><th class="num">Số ngày TB</th></tr></thead>
              <tbody>
                <tr v-for="(s, i) in timeInStage" :key="i">
                  <td>
                    <span v-if="isLongStage(s)" class="dot warn" style="margin-right:6px"></span>{{ s.status }}
                  </td>
                  <td class="num">
                    <span v-if="isLongStage(s)" class="pill warn">{{ fmtNum(s.avgDays) }}</span>
                    <template v-else>{{ fmtNum(s.avgDays) }}</template>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có dữ liệu.</div>
          </div>
        </div>
      </div>

      <!-- SOURCE EFFECTIVENESS -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-source-branch" size="17" /> Hiệu quả theo nguồn lead</div>
          <div class="meta">{{ rangeLabel }} · {{ bySource.length }} nguồn</div>
        </div>
        <div class="card-b" style="padding:0">
          <table v-if="bySource.length" class="tbl">
            <thead>
              <tr>
                <th>Nguồn</th>
                <th class="num">Lead mới</th>
                <th class="num">Đã liên hệ %</th>
                <th class="num">Chốt</th>
                <th>Tỉ lệ chốt</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in bySource" :key="i">
                <td>
                  <div class="cellname">
                    <span class="av" style="background:var(--rk-brand)"><v-icon icon="mdi-source-branch" size="14" /></span>
                    <div>{{ r.source || 'Không rõ' }}</div>
                  </div>
                </td>
                <td class="num">{{ fmtInt(r.leads) }}</td>
                <td class="num">{{ fmtPct(r.contactedPct) }}%</td>
                <td class="num"><span class="pill" :class="closedPillCls(r.closeRate)">{{ fmtInt(r.closed) }}</span></td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="bar" :class="barCls(r.closeRate)" style="flex:1;max-width:90px">
                      <i :style="{ width: clampPct(r.closeRate) + '%' }"></i>
                    </div>
                    <span class="b">{{ fmtPct(r.closeRate) }}%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="rk-empty">Chưa có dữ liệu nguồn lead.</div>
        </div>
      </div>

      <!-- LEAD POOL + STUCK -->
      <div class="grid g-2">
        <!-- By user -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-scale-balance" size="17" /> Lead Pool — phân phối theo sale</div>
            <div class="meta">độ công bằng = tải so với TB</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="byUser.length" class="tbl">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th class="num">Nhận</th>
                  <th class="num">Đang giữ</th>
                  <th class="num">Đã trả</th>
                  <th class="num">Quá hạn</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(u, i) in byUser" :key="u.userId ?? i">
                  <td>
                    <div class="cellname">
                      <span class="av" :style="{ background: avColor(i) }">{{ initials(u.name) }}</span>
                      <div>{{ u.name || 'Không rõ' }}</div>
                    </div>
                  </td>
                  <td class="num">{{ fmtInt(u.received) }}</td>
                  <td class="num">{{ fmtInt(u.holding) }}</td>
                  <td class="num">{{ fmtInt(u.returned) }}</td>
                  <td class="num">
                    <span class="pill" :class="overduePillCls(u.overdue)">{{ fmtInt(u.overdue) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có phân phối lead pool.</div>
          </div>
        </div>

        <!-- Stuck -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-alert-circle-outline" size="17" /> Lead bị kẹt (stuck)</div>
            <div class="meta">{{ stuck.length }} lead</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="stuck.length" class="tbl">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Stage</th>
                  <th class="num">Số ngày kẹt</th>
                  <th>Sale</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in stuck" :key="s.contactId ?? i">
                  <td>
                    <div class="cellname"><div>{{ s.contactName || 'Không rõ' }}</div></div>
                  </td>
                  <td>{{ s.stage || '—' }}</td>
                  <td class="num">
                    <span class="pill" :class="stuckPillCls(s.daysStuck)">{{ fmtInt(s.daysStuck) }}</span>
                  </td>
                  <td>{{ s.saleName || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Không có lead bị kẹt.</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api';
import { ref, computed, onMounted, watch } from 'vue';

const pipe = ref<any>(null);
const pool = ref<any>(null);
const loading = ref(true);
const range = ref('30d');

const ranges = [
  { key: 'today', label: 'Hôm nay', days: 0 },
  { key: '7d', label: '7 ngày', days: 7 },
  { key: '30d', label: '30 ngày', days: 30 },
  { key: 'quarter', label: 'Quý', days: 90 },
];

const rangeLabel = computed(() => ranges.find((r) => r.key === range.value)?.label ?? '');

function dateRange() {
  const days = ranges.find((r) => r.key === range.value)?.days ?? 30;
  const toD = new Date();
  const fromD = new Date();
  fromD.setDate(fromD.getDate() - days);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(fromD), to: iso(toD) };
}

// ---- formatters (vi-VN) ----
const vi = new Intl.NumberFormat('vi-VN');
const vi1 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtInt(v: any): string {
  return v == null || isNaN(Number(v)) ? '0' : vi.format(Math.round(Number(v)));
}
function fmtNum(v: any): string {
  return v == null || isNaN(Number(v)) ? '0' : vi1.format(Number(v));
}
function fmtPct(v: any): string {
  return v == null || isNaN(Number(v)) ? '0' : vi1.format(Number(v));
}
function clampPct(v: any): number {
  const n = Number(v);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ---- pipeline derived ----
const funnel = computed<any[]>(() => (Array.isArray(pipe.value?.funnel) ? pipe.value.funnel : []));
const funnelMax = computed(() =>
  funnel.value.reduce((m, s) => Math.max(m, Number(s?.count) || 0), 0) || 1,
);
function funnelWidth(s: any): number {
  return Math.max(2, (Number(s?.count) || 0) / funnelMax.value * 100);
}

const timeInStage = computed<any[]>(() =>
  Array.isArray(pipe.value?.timeInStage) ? pipe.value.timeInStage : [],
);
const timeAvg = computed(() => {
  const xs = timeInStage.value.map((s) => Number(s?.avgDays) || 0);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
});
function isLongStage(s: any): boolean {
  const v = Number(s?.avgDays) || 0;
  return timeAvg.value > 0 && v >= timeAvg.value * 1.8;
}

const bySource = computed<any[]>(() => (Array.isArray(pipe.value?.bySource) ? pipe.value.bySource : []));

// ---- lead pool derived ----
const byUser = computed<any[]>(() => (Array.isArray(pool.value?.byUser) ? pool.value.byUser : []));
const stuck = computed<any[]>(() => (Array.isArray(pool.value?.stuck) ? pool.value.stuck : []));

// ---- styling helpers ----
const avPalette = ['#7a4fb0', '#1786be', '#b0734f', '#4fb09a', '#b04f6e', '#5a7fb0', '#f79009', '#12b76a'];
function avColor(i: number): string {
  return avPalette[i % avPalette.length];
}
function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
function barCls(rate: any): string {
  const n = Number(rate) || 0;
  if (n >= 20) return 'ok';
  if (n < 6) return 'warn';
  return '';
}
function closedPillCls(rate: any): string {
  const n = Number(rate) || 0;
  if (n >= 12) return 'ok';
  if (n < 6) return 'warn';
  return '';
}
function overduePillCls(v: any): string {
  const n = Number(v) || 0;
  if (n >= 10) return 'danger';
  if (n >= 3) return 'warn';
  return '';
}
function stuckPillCls(v: any): string {
  const n = Number(v) || 0;
  if (n >= 21) return 'danger';
  if (n >= 10) return 'warn';
  return '';
}

// ---- load ----
async function load() {
  loading.value = true;
  try {
    const { from, to } = dateRange();
    const [a, b] = await Promise.all([
      api.get('/reports/pipeline', { params: { from, to } }),
      api.get('/reports/lead-pool', { params: { from, to } }),
    ]);
    pipe.value = a.data;
    pool.value = b.data;
  } catch (e) {
    console.error('[PipelineReport] load failed', e);
    pipe.value = null;
    pool.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(range, load);
</script>

<style scoped>
.mdi-spin {
  animation: rpt-spin 0.9s linear infinite;
}
@keyframes rpt-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
