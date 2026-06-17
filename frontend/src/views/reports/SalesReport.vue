<!--
  SalesReport — Hiệu suất Sale & Team. Endpoint #3 GET /reports/sales-performance.
  Render trong .rpt-scope (ReportsShell) → dùng global classes của report-kit.css.
-->
<template>
  <div class="rpt">
    <!-- HEAD -->
    <div class="rpt-head">
      <div class="rpt-titles">
        <div class="ic"><v-icon icon="mdi-account-tie-outline" /></div>
        <div>
          <div class="rpt-h1">Hiệu suất Sale &amp; Team</div>
          <div class="rpt-sub">
            Ai đang làm tốt, ai đang kẹt — đo công bằng theo nhịp thật của từng người.
            Xếp hạng, rollup theo phòng ban và tốc độ phản hồi thực tế.
          </div>
        </div>
      </div>
      <div class="rpt-actions">
        <button class="rk-btn ghost" :disabled="loading" @click="load">
          <v-icon icon="mdi-refresh" size="16" /> Làm mới
        </button>
        <button class="rk-btn" disabled title="Sắp có">
          <v-icon icon="mdi-file-excel-outline" size="16" /> Xuất Excel
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
      <v-icon icon="mdi-loading" class="mdi-spin" /> Đang tải dữ liệu…
    </div>

    <template v-else-if="data">
      <!-- KPI ROW -->
      <div class="grid g-4" style="margin-bottom:18px">
        <div class="kpi">
          <div class="top">
            <span class="label">Sale hoạt động</span>
            <span class="kic"><v-icon icon="mdi-account-check-outline" size="18" /></span>
          </div>
          <div class="val">
            {{ fmt(data.kpis.activeSales) }}<span class="u">/ {{ fmt(data.kpis.totalSales) }}</span>
          </div>
        </div>
        <div class="kpi">
          <div class="top">
            <span class="label">Tin / sale (TB)</span>
            <span class="kic"><v-icon icon="mdi-message-text-outline" size="18" /></span>
          </div>
          <div class="val">{{ fmt(data.kpis.avgSentPerSale) }}</div>
        </div>
        <div class="kpi accent-ok">
          <div class="top">
            <span class="label">Tốc độ phản hồi TB</span>
            <span class="kic"><v-icon icon="mdi-timer-sand" size="18" /></span>
          </div>
          <div class="val">{{ fmt(data.kpis.avgResponseMin) }}<span class="u">phút</span></div>
        </div>
        <div class="kpi">
          <div class="top">
            <span class="label">Tỉ lệ chốt TB</span>
            <span class="kic"><v-icon icon="mdi-flag-checkered" size="18" /></span>
          </div>
          <div class="val">{{ fmtPct(data.kpis.avgCloseRate) }}<span class="u">%</span></div>
        </div>
      </div>

      <!-- LEADERBOARD -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-h">
          <div class="t"><v-icon icon="mdi-trophy-outline" size="18" /> Bảng xếp hạng Sale</div>
          <div class="meta">{{ rangeLabel }} · điểm hiệu suất tổng hợp 0–100</div>
        </div>
        <div class="card-b" style="padding:0">
          <table v-if="data.sales.length" class="tbl">
            <thead>
              <tr>
                <th style="width:40px">#</th>
                <th>Sale</th>
                <th class="num">KH phụ trách</th>
                <th class="num">Tin gửi</th>
                <th class="num">Phản hồi TB</th>
                <th class="num">Lịch hẹn</th>
                <th class="num">Chốt</th>
                <th class="num">Lead pool dùng</th>
                <th style="width:170px">Điểm hiệu suất</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, i) in data.sales"
                :key="s.userId"
                :style="i < 3 ? 'background:var(--rk-brand-softer)' : ''"
              >
                <td
                  class="b"
                  :class="{ muted: i >= 3 }"
                  :style="i < 3 ? 'color:var(--rk-brand-700)' : ''"
                >{{ i + 1 }}</td>
                <td>
                  <div class="cellname">
                    <span class="av" :style="{ background: avColor(s.name) }">{{ initials(s.name) }}</span>
                    <div>
                      {{ s.name }}
                      <div class="sub">{{ s.deptName || '—' }}</div>
                    </div>
                  </div>
                </td>
                <td class="num">{{ fmt(s.contacts) }}</td>
                <td class="num">{{ fmt(s.sent) }}</td>
                <td class="num">
                  <span class="pill" :class="respClass(s.avgResponseMin)">{{ fmt(s.avgResponseMin) }} phút</span>
                </td>
                <td class="num">{{ fmt(s.apptDone) }} / {{ fmt(s.apptNoShow) }}</td>
                <td class="num"><span class="pill ok">{{ fmt(s.closed) }}</span></td>
                <td class="num">{{ fmt(s.leadPoolUsed) }}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="bar" :class="scoreClass(s.score)" style="flex:1">
                      <i :style="{ width: clampPct(s.score) + '%' }"></i>
                    </div>
                    <span class="b" style="font-variant-numeric:tabular-nums">{{ fmt(s.score) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="rk-empty">Chưa có dữ liệu sale trong kỳ này.</div>
        </div>
      </div>

      <!-- BOTTOM GRID -->
      <div class="grid g-2">
        <!-- Rollup theo phòng ban -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-office-building-outline" size="18" /> Rollup theo phòng ban</div>
            <div class="meta">{{ rangeLabel }}</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="data.byDept.length" class="tbl">
              <thead>
                <tr>
                  <th>Phòng ban</th>
                  <th class="num">Tổng KH</th>
                  <th class="num">Tin gửi</th>
                  <th class="num">Chốt</th>
                  <th class="num">Tỉ lệ chốt</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in data.byDept" :key="d.deptName">
                  <td>
                    <div class="cellname">
                      <span class="dot" :class="d.closeRate >= 10 ? 'ok' : 'warn'"></span>
                      <div>{{ d.deptName || '—' }}</div>
                    </div>
                  </td>
                  <td class="num">{{ fmt(d.contacts) }}</td>
                  <td class="num">{{ fmt(d.sent) }}</td>
                  <td class="num">
                    <span class="pill" :class="d.closeRate >= 10 ? 'ok' : 'warn'">{{ fmt(d.closed) }}</span>
                  </td>
                  <td class="num">
                    <span
                      class="b"
                      :style="{ color: d.closeRate >= 10 ? '#157f3c' : '#b45309' }"
                    >{{ fmtPct(d.closeRate) }}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có dữ liệu phòng ban.</div>
          </div>
        </div>

        <!-- Phân bố tốc độ phản hồi -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-timer-sand" size="18" /> Phân bố tốc độ phản hồi</div>
            <div class="meta">Theo lượt trả lời · {{ rangeLabel }}</div>
          </div>
          <div class="card-b">
            <div v-if="data.responseBuckets.length" class="chart">
              <div v-for="b in data.responseBuckets" :key="b.label" class="col">
                <div class="stack">
                  <i :style="{ height: bucketHeight(b.count) + '%' }"></i>
                </div>
                <div class="x">{{ b.label }}</div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có dữ liệu phản hồi.</div>
          </div>
        </div>
      </div>

      <!-- ===== MỨC ĐỘ DÙNG CRM (anh bổ sung 2026-06-17) ===== -->
      <div v-if="usage" class="usage-divider">
        <v-icon icon="mdi-monitor-dashboard" size="18" /> Mức độ dùng CRM
        <span class="usage-divider-note">đo theo nhịp thao tác thực tế</span>
      </div>

      <div v-if="usage" class="grid g-4" style="margin-bottom:14px">
        <div class="kpi">
          <div class="top"><span class="label">Sale dùng hôm nay</span><span class="kic"><v-icon icon="mdi-account-clock-outline" size="18" /></span></div>
          <div class="val">{{ fmt(usage.kpis.activeSalesToday) }}</div>
        </div>
        <div class="kpi accent-ok">
          <div class="top"><span class="label">Thời gian dùng TB / ngày</span><span class="kic"><v-icon icon="mdi-timer-outline" size="18" /></span></div>
          <div class="val">{{ fmtDur(usage.kpis.avgActiveMinPerDay) }}<span class="u">ước tính</span></div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">Tổng thao tác</span><span class="kic"><v-icon icon="mdi-gesture-tap" size="18" /></span></div>
          <div class="val">{{ fmt(usage.kpis.totalActions) }}</div>
        </div>
        <div class="kpi">
          <div class="top"><span class="label">Module dùng nhiều nhất</span><span class="kic"><v-icon icon="mdi-view-grid-outline" size="18" /></span></div>
          <div class="val" style="font-size:18px;line-height:1.3">{{ usage.kpis.topModule }}</div>
        </div>
      </div>

      <div v-if="usage" class="grid g-2">
        <!-- Xếp hạng dùng CRM hiệu quả -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-medal-outline" size="18" /> Xếp hạng dùng CRM hiệu quả</div>
            <div class="meta">kết quả ÷ giờ dùng · {{ rangeLabel }}</div>
          </div>
          <div class="card-b" style="padding:0">
            <table v-if="usage.bySale.length" class="tbl">
              <thead>
                <tr>
                  <th style="width:36px">#</th>
                  <th>Sale</th>
                  <th class="num">Giờ / ngày</th>
                  <th class="num">Thao tác</th>
                  <th>Module chính</th>
                  <th class="num">KQ / giờ</th>
                  <th style="width:150px">Hiệu quả</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in usage.bySale" :key="s.userId" :style="i < 3 ? 'background:var(--rk-brand-softer)' : ''">
                  <td class="b" :class="{ muted: i >= 3 }" :style="i < 3 ? 'color:var(--rk-brand-700)' : ''">{{ i + 1 }}</td>
                  <td>
                    <div class="cellname">
                      <span class="av" :style="{ background: avColor(s.name) }">{{ initials(s.name) }}</span>
                      <div>{{ s.name }}<div class="sub">{{ s.deptName || '—' }}</div></div>
                    </div>
                  </td>
                  <td class="num">{{ fmtDur(s.avgActiveMinPerDay) }}</td>
                  <td class="num">{{ fmt(s.actions) }}</td>
                  <td><span class="pill brand">{{ s.topModule }}</span></td>
                  <td class="num b">{{ fmtPct(s.closesPerHour) }}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px">
                      <div class="bar" :class="scoreClass(s.effScore)" style="flex:1"><i :style="{ width: clampPct(s.effScore) + '%' }"></i></div>
                      <span class="b" style="font-variant-numeric:tabular-nums">{{ fmt(s.effScore) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="rk-empty">Chưa có dữ liệu dùng CRM trong kỳ này.</div>
          </div>
        </div>

        <!-- Module dùng nhiều -->
        <div class="card">
          <div class="card-h">
            <div class="t"><v-icon icon="mdi-shape-outline" size="18" /> Module dùng nhiều</div>
            <div class="meta">toàn đội · {{ rangeLabel }}</div>
          </div>
          <div class="card-b">
            <div v-if="usage.moduleUsage.length" class="mod-list">
              <div v-for="m in usage.moduleUsage" :key="m.module" class="mod-row">
                <div class="mod-nm">{{ m.label }}</div>
                <div class="bar brand" style="flex:1"><i :style="{ width: Math.max(3, m.pct) + '%' }"></i></div>
                <div class="mod-vv">{{ fmt(m.actions) }} <span class="muted">· {{ fmtPct(m.pct) }}%</span></div>
              </div>
            </div>
            <div v-else class="rk-empty">Chưa có hoạt động được ghi nhận.</div>
          </div>
        </div>
      </div>

      <div v-if="usage?.note" class="usage-note">
        <v-icon icon="mdi-information-outline" size="14" /> {{ usage.note }}
      </div>
    </template>

    <!-- EMPTY -->
    <div v-else class="rk-empty">Không tải được dữ liệu báo cáo.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { api } from '@/api';

interface SaleRow {
  userId: string;
  name: string;
  deptName: string;
  contacts: number;
  sent: number;
  avgResponseMin: number;
  apptDone: number;
  apptNoShow: number;
  closed: number;
  leadPoolUsed: number;
  score: number;
}
interface DeptRow {
  deptName: string;
  contacts: number;
  sent: number;
  closed: number;
  closeRate: number;
}
interface Bucket { label: string; count: number }
interface SalesData {
  from: string;
  to: string;
  kpis: {
    activeSales: number;
    totalSales: number;
    avgSentPerSale: number;
    avgResponseMin: number;
    avgCloseRate: number;
  };
  sales: SaleRow[];
  byDept: DeptRow[];
  responseBuckets: Bucket[];
}

// Mức độ dùng CRM (endpoint #9 /reports/crm-usage)
interface UsageSale {
  userId: string; name: string; deptName: string;
  activeDays: number; avgActiveMinPerDay: number; actions: number;
  topModule: string; closesPerHour: number; effScore: number;
}
interface ModuleUsage { module: string; label: string; actions: number; pct: number }
interface CrmUsageData {
  from: string; to: string;
  kpis: { activeSalesToday: number; avgActiveMinPerDay: number; totalActions: number; topModule: string };
  bySale: UsageSale[];
  moduleUsage: ModuleUsage[];
  note: string;
}

const ranges = [
  { key: '7d', label: '7 ngày', days: 7 },
  { key: '30d', label: '30 ngày', days: 30 },
  { key: 'quarter', label: 'Quý', days: 90 },
] as const;

const data = ref<SalesData | null>(null);
const usage = ref<CrmUsageData | null>(null);
const loading = ref(true);
const range = ref<string>('30d');

const rangeLabel = computed(() => ranges.find((r) => r.key === range.value)?.label ?? '');

function dateRange(): { from: string; to: string } {
  const days = ranges.find((r) => r.key === range.value)?.days ?? 30;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

async function load() {
  loading.value = true;
  try {
    const { from, to } = dateRange();
    const [perf, use] = await Promise.allSettled([
      api.get('/reports/sales-performance', { params: { from, to } }),
      api.get('/reports/crm-usage', { params: { from, to } }),
    ]);
    data.value = perf.status === 'fulfilled' ? perf.value.data : null;
    usage.value = use.status === 'fulfilled' ? use.value.data : null;
    if (perf.status === 'rejected') console.error('[SalesReport] sales-performance failed', perf.reason);
    if (use.status === 'rejected') console.error('[SalesReport] crm-usage failed', use.reason);
  } catch (e) {
    console.error('[SalesReport] load failed', e);
    data.value = null;
    usage.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(range, load);

// ---- formatting helpers (vi-VN) ----
const nf = new Intl.NumberFormat('vi-VN');
function fmt(n: number | null | undefined): string {
  return n == null ? '0' : nf.format(Math.round(n));
}
function fmtPct(n: number | null | undefined): string {
  return n == null ? '0' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);
}
// phút → "Xh Ym" (cho thời gian dùng CRM)
function fmtDur(min: number | null | undefined): string {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60), r = m % 60;
  return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

function clampPct(n: number | null | undefined): number {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

// response-time thresholds: <10 ok, <20 warn, else danger
function respClass(min: number): string {
  if (min < 10) return 'ok';
  if (min < 20) return 'warn';
  return 'danger';
}
function scoreClass(score: number): string {
  if (score >= 75) return 'ok';
  if (score >= 50) return '';
  return 'danger';
}

// bar chart heights normalized to max bucket
const maxBucket = computed(() =>
  Math.max(1, ...(data.value?.responseBuckets.map((b) => b.count) ?? [1])),
);
function bucketHeight(count: number): number {
  return Math.max(4, Math.round((count / maxBucket.value) * 100));
}

// ---- avatar helper ----
function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}
const AV_COLORS = [
  '#1786be', '#7a4fb0', '#b0734f', '#4fb09a', '#b04f6e',
  '#5b8def', '#d39237', '#6e7a8a', '#9a6f4f', '#b04f4f',
];
function avColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
</script>

<style scoped>
.usage-divider { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700;
  color: var(--rk-brand-700, #0b5880); margin: 20px 0 14px; padding-top: 14px; border-top: 1px dashed var(--rk-hairline, #e6e9ef); }
.usage-divider :deep(.v-icon) { color: var(--rk-brand, #1786be); }
.usage-divider-note { font-size: 12px; font-weight: 500; color: var(--rk-faint, #97a0ac); margin-left: 2px; }
.mod-list { display: flex; flex-direction: column; gap: 11px; }
.mod-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.mod-nm { width: 150px; flex: none; font-weight: 600; color: var(--rk-ink, #1f2d3d); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mod-vv { width: 100px; flex: none; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--rk-ink, #1f2d3d); }
.usage-note { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; color: var(--rk-muted, #6b7785); font-style: italic; }
</style>
