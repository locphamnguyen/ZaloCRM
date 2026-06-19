<!--
  LeadPoolPreviewPage v2 — Phase Lead Pool v2.C 2026-05-29.
  Refactor theo mockup: workflow strip + 4 KPI + 4 tab filter + bảng 11 cột + sidebar (FHD+).
  HD-first 1366×648 / FHD 1920 / 2K 2560 responsive.
-->
<template>
  <div class="lp-scope qlp-page">

    <!-- Header -->
    <header class="qlp-top">
      <div>
        <h1>Queue chia Lead — Xem trước thứ tự vòng tua + Thống kê hôm nay</h1>
        <p class="qlp-sub">Admin xem pool đang chờ chia + theo dõi lead đang chăm / trả về / đã note ({{ today }})</p>
      </div>
      <div class="qlp-actions">
        <button class="qlp-btn" :disabled="loading" @click="fetchAll"><v-icon size="16" icon="mdi-refresh" /> Làm mới</button>
        <RouterLink to="/settings/crm/lead-pool" class="qlp-btn"><v-icon size="16" icon="mdi-cog-outline" /> Cấu hình Pool</RouterLink>
      </div>
    </header>

    <!-- Workflow strip — explainer -->
    <section class="qlp-flow">
      <div class="qlp-flow-title">
        <span class="badge">CÁCH POOL HOẠT ĐỘNG</span>
        <span class="muted">— 1 lead đi qua 4 trạng thái như sau:</span>
      </div>
      <div class="qlp-flow-row">
        <div class="step">
          <span class="ic"><v-icon size="16" icon="mdi-inbox-outline" /></span>
          <span class="lab">1. Trong Pool</span>
          <span class="dt">Chờ sale rảnh nhận</span>
        </div>
        <div class="step">
          <span class="ic"><v-icon size="16" icon="mdi-clock-outline" /></span>
          <span class="lab">2. Đã chia</span>
          <span class="dt">Sale nhận, đang chăm</span>
        </div>
        <div class="step">
          <span class="ic"><v-icon size="16" icon="mdi-check-circle-outline" /></span>
          <span class="lab">3. Đã note</span>
          <span class="dt">Sale đã ghi note</span>
        </div>
        <div class="step cooldown">
          <span class="ic"><v-icon size="16" icon="mdi-lock-outline" /></span>
          <span class="lab">4. Khoá pool {{ stats?.config?.cooldownAfterNoteDays ?? 30 }} ngày</span>
          <span class="dt">Tránh spam, sale gốc vẫn chăm</span>
        </div>
        <div class="arrow"><v-icon size="18" icon="mdi-rotate-right" /></div>
        <div class="step">
          <span class="ic"><v-icon size="16" icon="mdi-inbox-arrow-down-outline" /></span>
          <span class="lab">Vào lại pool</span>
          <span class="dt">Sau {{ stats?.config?.cooldownAfterNoteDays ?? 30 }} ngày → sale khác có cơ hội</span>
        </div>
        <div class="step returned">
          <span class="ic"><v-icon size="16" icon="mdi-timer-sand" /></span>
          <span class="lab">Tự trả về pool</span>
          <span class="dt">Sale không ghi note quá hạn → lead tự về pool, xuống cuối vòng tua</span>
        </div>
      </div>
    </section>

    <!-- 4 KPI Cards -->
    <section class="qlp-kpi-row">
      <div class="kpi kpi-pool">
        <div class="kpi-head">
          <span class="kpi-label">Pool chờ chia</span>
          <span class="kpi-help" title="Số lead đang chờ chia. Sale bấm 'Nhận khách' → chia theo VÒNG TUA FIFO: lead chưa chia / chia lâu nhất lên đầu.">?</span>
        </div>
        <div class="kpi-value">{{ stats?.poolSize ?? '—' }}</div>
        <div class="kpi-sub">lead sẵn sàng chia (vòng tua FIFO)</div>
      </div>

      <div class="kpi kpi-active">
        <div class="kpi-head">
          <span class="kpi-label">Đang chia hôm nay</span>
          <span class="kpi-help" title="Lead đã chia cho sale hôm nay nhưng chưa note xong. Auto trả về pool sau 24h nếu sale không note.">?</span>
        </div>
        <div class="kpi-value">{{ stats?.assigned?.today ?? '—' }}</div>
        <div class="kpi-sub">{{ stats?.assigned?.totalActive ?? 0 }} lead chờ note (tất cả ngày)</div>
      </div>

      <div class="kpi kpi-returned">
        <div class="kpi-head">
          <span class="kpi-label">Trả về pool hôm nay</span>
          <span class="kpi-help" title="Lead bị trả lại pool hôm nay (manual + auto). Manual = sale bấm trả. Auto = sale lười quá hạn.">?</span>
        </div>
        <div class="kpi-value">{{ stats?.returnedToday?.total ?? '—' }}</div>
        <div class="kpi-sub">
          <span class="ret-auto">{{ stats?.returnedToday?.auto ?? 0 }} auto</span> ·
          <span class="ret-manual">{{ stats?.returnedToday?.manual ?? 0 }} manual</span>
        </div>
      </div>

      <div class="kpi kpi-noted">
        <div class="kpi-head">
          <span class="kpi-label">Nhận / Ghi chú hôm nay</span>
          <span class="kpi-help" title="Số lead đã nhận hôm nay / đã hoàn thành note. Tỷ lệ thấp = sale lười, kéo theo lead bị treo pending.">?</span>
        </div>
        <div class="kpi-ratio">
          <span class="kpi-value">{{ stats?.today?.requested ?? 0 }} / {{ stats?.today?.noted ?? 0 }}</span>
          <span class="pct">{{ stats?.today?.pct ?? 0 }}%</span>
        </div>
        <div class="kpi-progress"><div :style="{ width: (stats?.today?.pct ?? 0) + '%' }"></div></div>
      </div>
    </section>

    <!-- Main grid: table + sidebar -->
    <div class="qlp-grid">

      <div>
        <!-- Tabs -->
        <div class="qlp-tabs">
          <button v-for="t in TABS" :key="t.key" class="tab" :class="{ active: filter === t.key }" @click="onFilterChange(t.key)">
            {{ t.label }}
            <span class="count">{{ tabCount(t.key) }}</span>
          </button>
        </div>

        <div class="qlp-table-wrap">
          <div class="qlp-table-toolbar">
            <input type="text" v-model="search" placeholder="Tìm theo tên KH, SĐT, tên tệp..." />
            <span class="hint">Sắp xếp: <b>Vòng tua FIFO</b> · lead chưa chia/chia lâu nhất lên đầu · <b>Top 10</b> nền vàng = chia tiếp theo</span>
            <div class="spacer"></div>
            <span class="hint">Hiển thị <b>{{ filteredItems.length }}</b> / <b>{{ items.length }}</b> dòng</span>
          </div>

          <div v-if="loading" class="qlp-loading">Đang tải...</div>
          <div v-else-if="filteredItems.length === 0" class="qlp-empty">
            <div class="empty-icon"><v-icon size="40" icon="mdi-inbox-outline" /></div>
            <h3>{{ emptyTitle }}</h3>
            <p>{{ emptyMessage }}</p>
          </div>

          <div v-else class="qlp-table-scroll">
            <table class="qlp-table">
              <thead>
                <tr>
                  <th class="c-rank">#</th>
                  <th class="c-score">Đã chia</th>
                  <th class="c-customer">Khách hàng</th>
                  <th class="c-phone">SĐT</th>
                  <th class="c-source">Nguồn</th>
                  <th class="c-file">Tên tệp</th>
                  <th class="c-status">Trạng thái</th>
                  <th class="c-sale">Sale đang chia</th>
                  <th class="c-note">Ghi chú mới nhất</th>
                  <th class="c-idle">KH lãng quên</th>
                  <th class="c-prev-sale">Sale cũ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in filteredItems.slice(0, 100)" :key="item.contactId"
                  :class="{ top10: filter === 'available' && i < 10, 'cooldown-row': item.status === 'cooldown' }">
                  <td class="c-rank">
                    <div class="rank">
                      <span class="rank-num" :class="{ gold: filter === 'available' && i < 10, mute: item.status === 'cooldown' }">
                        {{ item.status === 'cooldown' ? '—' : (i + 1) }}
                      </span>
                      <span v-if="filter === 'available' && i < 10" class="rank-badge">TOP</span>
                    </div>
                  </td>
                  <td class="c-score">
                    <span class="score-chip" :class="roundChipClass(item.pooledCount)">
                      {{ (item.pooledCount ?? 0) === 0 ? 'Chưa chia' : `Lần ${item.pooledCount}` }}
                    </span>
                  </td>
                  <td class="c-customer">
                    <div class="customer">
                      <div class="avatar" :style="avatarStyle(item.name, item.status === 'cooldown')">
                        <img v-if="item.avatarUrl" :src="item.avatarUrl" referrerpolicy="no-referrer" :alt="item.name" />
                        <span v-else>{{ initials(item.name) }}</span>
                      </div>
                      <div class="customer-info">
                        <div class="customer-name">{{ item.name }}</div>
                        <div class="customer-sub" v-if="item.addressLine">{{ item.addressLine }}</div>
                      </div>
                    </div>
                  </td>
                  <td class="c-phone">{{ formatPhone(item.phone) }}</td>
                  <td class="c-source"><span class="source-chip" :class="'src-' + item.source">{{ sourceLabel(item.source) }}</span></td>
                  <td class="c-file">
                    <div v-if="item.customerListName" class="file-name" :title="item.customerListName">{{ item.customerListName }}</div>
                    <div v-else class="file-name empty">— Không có —</div>
                  </td>
                  <td class="c-status">
                    <div class="st">
                      <span class="st-row" :class="'st-' + statusBadge(item.status).cls">{{ statusBadge(item.status).text }}</span>
                      <span v-if="item.statusTime" class="st-time" :class="statusTimeClass(item)">{{ formatStatusTime(item) }}</span>
                    </div>
                  </td>
                  <td class="c-sale">
                    <div v-if="item.currentSale" class="sale">
                      <div class="avatar small" :style="avatarStyle(item.currentSale.fullName, false)">{{ initials(item.currentSale.fullName) }}</div>
                      <span class="sale-name" :class="{ strike: item.status === 'returned_manual' || item.status === 'returned_auto' }">
                        {{ item.currentSale.fullName }}
                        <span v-if="item.status === 'cooldown'" class="hint-small">(vẫn chăm)</span>
                      </span>
                    </div>
                    <span v-else class="sale-empty">— Chưa ai nhận —</span>
                  </td>
                  <td class="c-note">
                    <div v-if="item.latestNote" class="note-cell">
                      <span class="note-type" :class="'nt-' + item.latestNote.type">{{ noteTypeLabel(item.latestNote.type) }}</span>
                      <div class="note-text" :title="item.latestNote.text || ''">{{ item.latestNote.text || '(không có nội dung)' }}</div>
                      <span class="note-time" v-if="item.latestNote.time">{{ formatRelativeTime(item.latestNote.time) }}<span v-if="item.latestNote.author"> · {{ item.latestNote.author }}</span></span>
                    </div>
                    <div v-else class="note-cell">
                      <span class="note-type mute">— Chưa có note —</span>
                      <div class="note-empty">Lead mới, chưa có lịch sử chăm sóc.</div>
                    </div>
                  </td>
                  <td class="c-idle">
                    <div class="idle">
                      <span class="idle-num" :class="idleClass(item.daysIdle)">{{ item.daysIdle ?? '—' }}</span>
                      <span class="idle-unit">ngày</span>
                    </div>
                  </td>
                  <td class="c-prev-sale">
                    <div v-if="item.previousAssignee" class="prev-sale" :title="item.previousAssignee.fullName">{{ item.previousAssignee.fullName }}</div>
                    <div v-else class="prev-sale none">— Không có —</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="qlp-pagination">
            <span class="page-info">Hiển thị <b>1 - {{ Math.min(100, filteredItems.length) }}</b> / <b>{{ items.length }}</b> dòng<span v-if="filter !== 'cooldown'"> · <b>{{ stats?.cooldown ?? 0 }}</b> lead đang ở Cooldown (không hiện trong tab này)</span></span>
          </div>
        </div>
      </div>

      <!-- Sidebar FHD+ -->
      <aside class="qlp-sidebar">
        <div class="side-card info">
          <h3>Tại sao Pool có {{ stats?.poolSize ?? '—' }} lead?</h3>
          <p>Mặc định trước đây chỉ hiện <b>50</b> lead, anh tưởng pool nhỏ. Đã tăng default lên <b>200</b>.</p>
          <p>Pool thật có thể <b>500-2000 lead</b>. 200 dòng đầu cover &gt;95% nhu cầu audit của admin.</p>
        </div>

        <div class="side-card warn">
          <h3>Rule cooldown sau note</h3>
          <p>Sale A note xong → KH này KHÔNG vào pool ai khác trong <b>{{ stats?.config?.cooldownAfterNoteDays ?? 30 }} ngày</b>.</p>
          <ul>
            <li>Sale gốc <b>vẫn chăm KH bình thường</b></li>
            <li>Tránh spam chia lại cùng 1 lead</li>
            <li>Sau cooldown → mở pool cho sale khác</li>
          </ul>
          <p style="margin-top:6px;"><b>Lưu ý:</b> lead quá hạn note → tự về pool, xuống cuối vòng tua FIFO.</p>
        </div>

        <div class="side-card">
          <h3>Chú thích trạng thái</h3>
          <div class="legend">
            <div class="leg-item"><span class="st-row st-new">Mới</span><span>Chưa ai nhận, sẵn sàng chia</span></div>
            <div class="leg-item"><span class="st-row st-assigned">Đang chia</span><span>Sale đã nhận, chờ note</span></div>
            <div class="leg-item"><span class="st-row st-cooldown">Cooldown</span><span>Sale đã note, khoá pool</span></div>
            <div class="leg-item"><span class="st-row st-returned">Tự trả về</span><span>Quá hạn note → tự về pool</span></div>
          </div>
        </div>

        <div class="side-card config">
          <h3>Config hiện tại</h3>
          <div class="cfg-row"><span class="lab">"Lãng quên" sau</span><span class="val">{{ stats?.config?.forgottenThresholdDays ?? '—' }} ngày</span></div>
          <div class="cfg-row"><span class="lab">Cooldown sau note</span><span class="val">{{ stats?.config?.cooldownAfterNoteDays ?? '—' }} ngày</span></div>
          <RouterLink to="/settings/crm/lead-pool" class="cfg-link">Mở cài đặt đầy đủ →</RouterLink>
        </div>
      </aside>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/index';
import '@/assets/lead-pool-theme.css';

interface TodayStats {
  poolSize: number;
  assigned: { today: number; totalActive: number };
  cooldown: number;
  returnedToday: { auto: number; manual: number; total: number };
  today: { requested: number; noted: number; pct: number };
  config: { cooldownAfterNoteDays: number; forgottenThresholdDays: number };
}

interface LeadItem {
  contactId: string;
  priorityScore: number;
  pooledCount?: number; // Phase FIFO — số lần đã chia qua pool.
  contactStatus?: { name: string; color: string | null } | null; // trạng thái KH (Status).
  source: 'forgotten' | 'customer_list' | 'external_sync';
  customerListName: string | null;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  addressLine: string;
  status: 'new' | 'assigned' | 'cooldown' | 'returned_manual' | 'returned_auto';
  statusTime: string | null;
  currentSale: { id: string; fullName: string } | null;
  latestNote: { type: 'note' | 'return' | 'auto' | 'contact'; text: string; author: string | null; time: string | null } | null;
  daysIdle: number | null;
  previousAssignee: { id: string; fullName: string } | null;
}

type FilterKey = 'available' | 'assigned' | 'cooldown' | 'returned_today';

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'available', label: 'Pool chờ chia' },
  { key: 'assigned', label: 'Đang chia' },
  { key: 'cooldown', label: 'Khoá cooldown' },
  { key: 'returned_today', label: 'Trả về hôm nay' },
];

const filter = ref<FilterKey>('available');
const loading = ref(false);
const items = ref<LeadItem[]>([]);
const stats = ref<TodayStats | null>(null);
const search = ref('');

const today = computed(() => {
  const d = new Date();
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
});

function tabCount(key: FilterKey): number {
  if (!stats.value) return 0;
  if (key === 'available') return stats.value.poolSize;
  if (key === 'assigned') return stats.value.assigned.totalActive;
  if (key === 'cooldown') return stats.value.cooldown;
  if (key === 'returned_today') return stats.value.returnedToday.total;
  return 0;
}

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((it) => {
    return (it.name?.toLowerCase().includes(q) ?? false)
      || (it.phone?.toLowerCase().includes(q) ?? false)
      || (it.customerListName?.toLowerCase().includes(q) ?? false);
  });
});

const emptyTitle = computed(() => {
  if (filter.value === 'available') return 'Pool đang trống';
  if (filter.value === 'assigned') return 'Không có lead nào đang chia';
  if (filter.value === 'cooldown') return 'Không có lead nào đang Cooldown';
  if (filter.value === 'returned_today') return 'Hôm nay chưa có lead nào trả lại pool';
  return 'Không có dữ liệu';
});

const emptyMessage = computed(() => {
  if (filter.value === 'available') return 'Mọi KH đều đã được chăm gần đây, hoặc đang ở Cooldown / đang chia. Anh kiểm tra các tab khác.';
  if (filter.value === 'assigned') return 'Mọi sale đều đã note xong. Đợi vòng chia tiếp theo.';
  if (filter.value === 'cooldown') return 'Chưa có lead nào được note + khoá pool. Sale chưa nhận lead nào hôm nay?';
  if (filter.value === 'returned_today') return 'Chúc mừng! Sale không bỏ bê lead nào hôm nay.';
  return '—';
});

async function fetchStats() {
  try {
    const { data } = await api.get<TodayStats>('/lead-pool/queue-today-stats');
    stats.value = data;
  } catch (e: any) {
    console.error('[queue-stats]', e);
  }
}

async function fetchItems() {
  loading.value = true;
  try {
    const { data } = await api.get(`/lead-pool/preview?filter=${filter.value}&limit=200`);
    items.value = data.items ?? [];
  } catch (e: any) {
    console.error('[preview]', e);
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function fetchAll() {
  await Promise.all([fetchStats(), fetchItems()]);
}

function onFilterChange(key: FilterKey) {
  filter.value = key;
  search.value = '';
  void fetchItems();
}

onMounted(() => { void fetchAll(); });

// ── Helpers ──
function initials(name: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarStyle(name: string | null, faded: boolean) {
  const palette = [
    'linear-gradient(135deg,#3b82f6,#1e40af)',
    'linear-gradient(135deg,#10b981,#059669)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#8b5cf6,#6d28d9)',
    'linear-gradient(135deg,#ec4899,#be185d)',
    'linear-gradient(135deg,#06b6d4,#0891b2)',
  ];
  const h = (name ?? '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return { background: palette[h % palette.length], opacity: faded ? 0.6 : 1 };
}

function formatPhone(p: string | null) {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7);
  return p;
}

// Phase Lead Pool FIFO 2026-06-15 — badge "Đã chia" theo số vòng (pooledCount).
function roundChipClass(n: number | undefined) {
  const c = n ?? 0;
  if (c === 0) return 'score-high';   // chưa chia = xanh (ưu tiên đầu vòng)
  if (c >= 5) return 'score-cooldown'; // kẹt đáy = đỏ
  if (c >= 2) return 'score-mid';
  return 'score-low';
}
function sourceLabel(s: string) { return ({ forgotten: 'Lãng quên', customer_list: 'Tệp KH', external_sync: 'Sync' } as Record<string, string>)[s] ?? s; }

function statusBadge(s: string) {
  if (s === 'new') return { cls: 'new', text: 'Mới' };
  if (s === 'assigned') return { cls: 'assigned', text: 'Đang chia' };
  if (s === 'cooldown') return { cls: 'cooldown', text: 'Khoá cooldown' };
  if (s === 'returned_manual') return { cls: 'returned', text: 'Đã trả lại' };
  if (s === 'returned_auto') return { cls: 'returned', text: 'Tự trả về' };
  return { cls: 'new', text: s };
}

function statusTimeClass(item: LeadItem) {
  if (item.status === 'cooldown') return 'cooldown';
  if (item.status === 'assigned' && item.statusTime) {
    const remainingMs = new Date(item.statusTime).getTime() - Date.now();
    if (remainingMs < 30 * 60 * 1000) return 'urgent';
  }
  return '';
}

function formatStatusTime(item: LeadItem): string {
  if (!item.statusTime) return '';
  const ts = new Date(item.statusTime).getTime();
  const now = Date.now();
  if (item.status === 'assigned') {
    const diff = ts - now;
    if (diff < 0) return 'Đã hết hạn';
    return 'Còn ' + formatDuration(diff);
  }
  if (item.status === 'cooldown') {
    const cooldownMs = (stats.value?.config.cooldownAfterNoteDays ?? 30) * 24 * 3600 * 1000;
    const remainMs = ts + cooldownMs - now;
    if (remainMs <= 0) return 'Sắp mở pool';
    return 'Còn ' + formatDuration(remainMs);
  }
  if (item.status === 'returned_manual') return 'manual · ' + formatRelativeTime(item.statusTime);
  if (item.status === 'returned_auto') return formatRelativeTime(item.statusTime);
  return '';
}

function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} ngày ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function noteTypeLabel(t: string): string {
  return ({
    note: 'Note sale',
    return: 'Lý do trả',
    auto: 'Tự trả về',
    contact: 'Liên hệ',
  } as Record<string, string>)[t] ?? '— Chưa có note —';
}

function idleClass(d: number | null): string {
  if (d == null) return '';
  if (d > 180) return 'very-old';
  if (d > 90) return 'old';
  return '';
}
</script>

<style scoped>
/* ─────────── DESIGN TOKENS ─────────── */
.qlp-page {
  --bg-page: #F1F5F9;
  --bg-card: #FFFFFF;
  --bg-card-alt: #F8FAFC;
  --border: #E2E8F0;
  --border-strong: #CBD5E1;
  --text-1: #0F172A;
  --text-2: #475569;
  --text-3: #64748B;
  --text-mute: #94A3B8;
  --primary: #4F46E5;
  --primary-bg: #EEF2FF;
  --primary-border: #C7D2FE;
  --success: #16A34A;
  --warning: #B45309;
  --danger: #B91C1C;
  --info: #0369A1;
  min-width: 1280px;
  max-width: 1920px;
  margin: 0 auto;
  padding: 12px 16px 16px;
  font-size: 13px;
  color: var(--text-1);
  background: var(--bg-page);
}
@media (min-width: 1920px) { .qlp-page { padding: 14px 24px 18px; } }
@media (min-width: 2400px) { .qlp-page { max-width: 2200px; padding: 16px 32px 20px; } }

/* ─────────── HEADER ─────────── */
.qlp-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 10px; }
.qlp-top h1 { font-size: 18px; font-weight: 800; margin: 0 0 2px; letter-spacing: -0.01em; }
.qlp-sub { font-size: 12px; color: var(--text-3); margin: 0; }
.qlp-actions { display: flex; gap: 6px; flex-shrink: 0; }
.qlp-btn { padding: 7px 12px; background: white; border: 1px solid var(--border-strong); border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-2); transition: all 0.15s; text-decoration: none; display: inline-flex; align-items: center; }
.qlp-btn:hover { background: var(--bg-card-alt); border-color: var(--text-3); }

/* ─────────── WORKFLOW STRIP ─────────── */
.qlp-flow { display: grid; grid-template-columns: 1fr; gap: 8px; background: linear-gradient(135deg, #F0F9FF 0%, #EEF2FF 100%); border: 1px solid var(--primary-border); border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
.qlp-flow-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; }
.qlp-flow-title .badge { background: #1786be; color: white; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; }
.qlp-flow-title .muted { color: var(--text-3); font-weight: 500; }
/* 2026-06-19 (anh báo ô "Tự trả về pool" to hơn): stretch để MỌI ô cao bằng nhau (theo ô
   nhiều chữ nhất) thay vì center làm ô ngắn co lại → hết lệch size. */
.qlp-flow-row { display: grid; grid-template-columns: repeat(4, 1fr) 32px repeat(2, 1fr); gap: 0; align-items: stretch; }
.qlp-flow-row .step { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px; background: white; border: 1px solid var(--border); border-radius: 8px; }
.qlp-flow-row .step .ic { font-size: 18px; }
.qlp-flow-row .step .lab { font-size: 11px; font-weight: 700; color: var(--text-1); text-align: center; line-height: 1.2; }
.qlp-flow-row .step .dt { font-size: 10px; color: var(--text-3); text-align: center; line-height: 1.3; }
.qlp-flow-row .step.cooldown { background: #FEF3C7; border-color: #FCD34D; }
.qlp-flow-row .step.cooldown .lab { color: #92400E; }
.qlp-flow-row .step.returned { background: #FEE2E2; border-color: #FCA5A5; }
.qlp-flow-row .step.returned .lab { color: var(--danger); }
.qlp-flow-row .arrow { font-size: 18px; color: var(--text-mute); text-align: center; font-weight: 700; align-self: center; }

/* ─────────── KPI ROW ─────────── */
.qlp-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
.kpi { background: white; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; min-height: 78px; position: relative; }
.kpi-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; margin-bottom: 4px; }
.kpi-label { font-size: 11px; color: var(--text-3); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.3; }
.kpi-help { width: 16px; height: 16px; border-radius: 50%; background: rgba(0,0,0,0.06); color: var(--text-3); font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: help; flex-shrink: 0; }
.kpi-value { font-size: 24px; font-weight: 800; line-height: 1.05; letter-spacing: -0.02em; }
.kpi-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.kpi-progress { height: 4px; background: rgba(34, 197, 94, 0.18); border-radius: 2px; overflow: hidden; margin-top: 4px; }
.kpi-progress > div { height: 100%; background: var(--success); }
.kpi-pool { background: linear-gradient(135deg, #e4f1f8 0%, #f2f8fc 100%); border-color: #bcdcee; }
.kpi-pool .kpi-value { color: #0b5880; }
.kpi-active { background: linear-gradient(135deg, #FEF3C7 0%, #FFF7ED 100%); border-color: #FCD34D; }
.kpi-active .kpi-value { color: var(--warning); }
.kpi-returned { background: linear-gradient(135deg, #FEE2E2 0%, #FFF1F2 100%); border-color: #FCA5A5; }
.kpi-returned .kpi-value { color: var(--danger); }
.kpi-noted { background: linear-gradient(135deg, #DCFCE7 0%, #F0FDF4 100%); border-color: #86EFAC; }
.kpi-noted .kpi-value { color: #166534; }
.kpi-ratio { display: flex; align-items: baseline; gap: 8px; }
.kpi-ratio .pct { font-size: 14px; font-weight: 700; color: var(--success); }
.ret-auto { color: var(--danger); font-weight: 700; }
.ret-manual { color: var(--warning); font-weight: 700; }
@media (min-width: 1920px) { .kpi-value { font-size: 28px; } .kpi { min-height: 88px; padding: 12px 14px; } }

/* ─────────── GRID + SIDEBAR ─────────── */
.qlp-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
@media (min-width: 1920px) { .qlp-grid { grid-template-columns: 1fr 320px; gap: 14px; } }
@media (min-width: 2400px) { .qlp-grid { grid-template-columns: 1fr 380px; gap: 16px; } }
.qlp-sidebar { display: none; }
@media (min-width: 1920px) { .qlp-sidebar { display: flex; flex-direction: column; gap: 10px; } }

/* ─────────── TABS ─────────── */
.qlp-tabs { display: flex; gap: 4px; background: white; border: 1px solid var(--border); border-radius: 8px; padding: 4px; width: fit-content; margin-bottom: 10px; }
.tab { padding: 6px 12px; border-radius: 5px; font-size: 12px; font-weight: 600; color: var(--text-3); cursor: pointer; border: none; background: transparent; display: flex; align-items: center; gap: 6px; }
/* Phase FIFO — màu brand HS teal-navy thay tím Indigo cũ (đồng bộ 2 màn mới). */
.tab.active { background: #e4f1f8; color: #0b5880; }
.tab .count { background: var(--border); color: var(--text-2); padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; min-width: 22px; text-align: center; }
.tab.active .count { background: #cfe6f3; color: #0b5880; }

/* ─────────── TABLE ─────────── */
.qlp-table-wrap { background: white; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.qlp-table-toolbar { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; background: var(--bg-card-alt); flex-wrap: wrap; }
.qlp-table-toolbar input { padding: 6px 10px; border: 1px solid var(--border-strong); border-radius: 6px; font-size: 12px; min-width: 220px; }
.qlp-table-toolbar .hint { font-size: 11px; color: var(--text-3); }
.qlp-table-toolbar .spacer { flex: 1; }
.qlp-table-scroll { max-height: calc(100vh - 380px); overflow: auto; }
@media (min-width: 1920px) { .qlp-table-scroll { max-height: calc(100vh - 320px); } }
.qlp-loading { padding: 30px 20px; text-align: center; color: var(--text-3); }
.qlp-empty { padding: 40px 20px; text-align: center; color: var(--text-3); }
.qlp-empty .empty-icon { font-size: 40px; margin-bottom: 8px; }
.qlp-empty h3 { font-size: 14px; font-weight: 700; color: var(--text-1); margin: 0 0 4px; }
.qlp-empty p { font-size: 12px; margin: 0; }

.qlp-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1400px; }
@media (min-width: 1920px) { .qlp-table { min-width: 100%; } }
.qlp-table thead th { position: sticky; top: 0; background: var(--bg-card-alt); padding: 8px; text-align: left; font-size: 11px; font-weight: 700; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); z-index: 2; white-space: nowrap; }
.qlp-table tbody td { padding: 8px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
.qlp-table tbody tr:hover { background: var(--bg-card-alt); }
.qlp-table tbody tr.top10 { background: linear-gradient(90deg, rgba(254,243,199,0.4) 0%, transparent 60%); }
.qlp-table tbody tr.top10:hover { background: linear-gradient(90deg, rgba(254,243,199,0.6) 0%, var(--bg-card-alt) 60%); }
.qlp-table tbody tr.cooldown-row { background: rgba(254, 243, 199, 0.25); opacity: 0.85; }
.qlp-table tbody tr.cooldown-row:hover { background: rgba(254, 243, 199, 0.4); }

th.c-rank, td.c-rank { width: 50px; text-align: center; }
th.c-score, td.c-score { width: 60px; text-align: center; }
th.c-customer, td.c-customer { min-width: 170px; max-width: 210px; }
th.c-phone, td.c-phone { width: 110px; }
th.c-source, td.c-source { width: 105px; }
th.c-file, td.c-file { min-width: 140px; max-width: 180px; }
th.c-status, td.c-status { width: 130px; }
th.c-sale, td.c-sale { min-width: 130px; max-width: 160px; }
th.c-note, td.c-note { min-width: 200px; max-width: 280px; }
th.c-idle, td.c-idle { width: 80px; text-align: center; }
th.c-prev-sale, td.c-prev-sale { min-width: 110px; max-width: 140px; }

.rank { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; }
.rank-num { font-weight: 700; }
.rank-num.gold { color: var(--warning); }
.rank-num.mute { color: var(--text-mute); }
.rank-badge { font-size: 9px; font-weight: 800; background: #F59E0B; color: white; padding: 1px 4px; border-radius: 3px; letter-spacing: 0.05em; }

.score-chip { display: inline-block; padding: 2px 8px; border-radius: 10px; font-weight: 700; font-size: 11px; }
.score-high { background: #FEE2E2; color: var(--danger); }
.score-mid  { background: #FEF3C7; color: var(--warning); }
.score-low  { background: #E0F2FE; color: var(--info); }
.score-cooldown { background: rgba(0,0,0,0.04); color: var(--text-mute); }

.customer { display: flex; align-items: center; gap: 8px; }
.avatar { width: 28px; height: 28px; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0; overflow: hidden; }
.avatar.small { width: 22px; height: 22px; font-size: 10px; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.customer-info { min-width: 0; flex: 1; }
.customer-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.customer-sub { font-size: 10.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.source-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.source-chip.src-forgotten { background: #FEF3C7; color: var(--warning); }
.source-chip.src-customer_list { background: #e9f2fd; color: #2e88e5; }
.source-chip.src-external_sync { background: #CFFAFE; color: #155E75; }

.file-name { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; font-size: 11.5px; color: var(--text-2); max-height: 30px; }
.file-name.empty { color: var(--text-mute); font-style: italic; }

.st { display: inline-flex; flex-direction: column; gap: 2px; }
.st-row { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; width: fit-content; }
.st-new { background: #DCFCE7; color: #166534; }
.st-assigned { background: #FEF3C7; color: var(--warning); }
.st-cooldown { background: #FCE7F3; color: #9D174D; }
.st-returned { background: #FEE2E2; color: var(--danger); }
.st-time { font-size: 10px; color: var(--text-3); padding-left: 4px; }
.st-time.urgent { color: #DC2626; font-weight: 700; }
.st-time.cooldown { color: #9D174D; font-weight: 700; }

.sale { display: flex; align-items: center; gap: 6px; }
.sale-name { font-size: 11.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sale-name.strike { text-decoration: line-through; color: var(--text-mute); }
.sale-empty { font-size: 11px; color: var(--text-mute); font-style: italic; }
.hint-small { color: var(--text-mute); font-size: 10px; }

.note-cell { display: flex; flex-direction: column; gap: 2px; }
.note-type { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
.note-type.nt-note { color: var(--success); }
.note-type.nt-return { color: var(--danger); }
.note-type.nt-contact { color: #2563EB; }
.note-type.nt-auto { color: #9D174D; }
.note-type.mute { color: var(--text-mute); }
.note-text { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; font-size: 11.5px; color: var(--text-2); max-height: 32px; }
.note-empty { font-size: 11px; color: var(--text-mute); font-style: italic; }
.note-time { font-size: 10px; color: var(--text-mute); }

.idle { display: flex; flex-direction: column; gap: 1px; align-items: center; }
.idle-num { font-weight: 700; font-size: 13px; }
.idle-unit { font-size: 10px; color: var(--text-3); }
.idle-num.very-old { color: var(--danger); }
.idle-num.old { color: #EA580C; }

.prev-sale { font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.prev-sale.none { color: var(--border-strong); font-style: italic; }

.qlp-pagination { padding: 8px 12px; border-top: 1px solid var(--border); background: var(--bg-card-alt); display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--text-3); flex-wrap: wrap; }
.page-info { margin-left: auto; }

/* ─────────── SIDEBAR ─────────── */
.side-card { background: white; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.side-card h3 { font-size: 12px; font-weight: 700; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.03em; display: flex; align-items: center; gap: 6px; }
.side-card p { margin: 0 0 6px; font-size: 12px; color: var(--text-2); line-height: 1.5; }
.side-card ul { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-2); line-height: 1.6; }
.side-card b { color: var(--text-1); }
.side-card.info { background: linear-gradient(135deg, #F0F9FF 0%, #EEF2FF 100%); border-color: var(--primary-border); }
.side-card.info h3 { color: #4338CA; }
.side-card.warn { background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%); border-color: #FCD34D; }
.side-card.warn h3 { color: var(--warning); }
.side-card.config { background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); border-color: #86EFAC; }
.side-card.config h3 { color: #166534; }
.legend { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.leg-item { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-2); }
.leg-item .st-row { font-size: 10px; padding: 1px 7px; }
.cfg-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px; }
.cfg-row .lab { color: var(--text-3); }
.cfg-row .val { font-weight: 700; color: var(--text-1); background: var(--bg-page); padding: 2px 8px; border-radius: 4px; }
.cfg-link { display: block; margin-top: 8px; font-size: 12px; color: #1786be; text-decoration: none; font-weight: 600; }
.cfg-link:hover { text-decoration: underline; }
</style>
