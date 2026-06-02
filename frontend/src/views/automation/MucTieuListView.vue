<template>
  <div class="mtl-page">
    <!-- ================== HEADER ================== -->
    <div class="crumb">
      <a href="#" @click.prevent="router.push('/marketing/triggers')">Marketing</a>
      <span class="sep">/</span>
      <span>Mục tiêu</span>
    </div>

    <div class="topbar">
      <div>
        <h1>Mục tiêu</h1>
        <p class="sub">Quản lý chiến dịch mời kết bạn + bám đuổi</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" @click="onCreate">
          <span>+</span> Tạo Mục tiêu mới
        </button>
        <button
          class="btn"
          disabled
          title="Tính năng dự kiến phát hành ở Wave 4"
        >
          <span>📥</span> Nhập từ Excel
        </button>
        <button
          class="btn btn-ghost"
          disabled
          title="Tính năng dự kiến phát hành ở Wave 4"
        >
          <span>⚙</span>
        </button>
      </div>
    </div>

    <!-- ================== FILTER BAR ================== -->
    <div class="filter-bar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchInput"
          class="search-input"
          type="text"
          placeholder="Tìm theo tên Mục tiêu, Tệp KH..."
        />
      </div>

      <div class="chips">
        <span
          v-for="chip in statusChips"
          :key="chip.key"
          class="chip"
          :class="{ active: statusFilter === chip.key }"
          @click="statusFilter = chip.key"
        >
          {{ chip.label }} <span class="count">{{ chipCount(chip.key) }}</span>
        </span>
      </div>

      <div class="filter-spacer"></div>

      <div class="filter-right">
        <select v-model="sortKey" class="sort-dd">
          <option value="created_desc">Sắp xếp: Mới tạo</option>
          <option value="progress_desc">Sắp xếp: Tiến độ</option>
          <option value="reply_desc">Sắp xếp: Phản hồi cao nhất</option>
        </select>
        <div class="view-toggle">
          <button class="active">▦ Bảng</button>
          <button disabled title="Defer Wave 4">▥ Card</button>
        </div>
      </div>
    </div>

    <!-- ================== TABLE ================== -->
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th
              class="col-name"
              :class="{ sorted: sortKey === 'created_desc' }"
              @click="sortKey = 'created_desc'"
            >
              Mục tiêu
              <span class="sort-arrow">{{ sortKey === 'created_desc' ? '▼' : '⇅' }}</span>
            </th>
            <th class="col-list">Tệp KH <span class="sort-arrow">⇅</span></th>
            <th
              class="col-progress"
              :class="{ sorted: sortKey === 'progress_desc' }"
              @click="sortKey = 'progress_desc'"
            >
              Tiến độ
              <span class="sort-arrow">{{ sortKey === 'progress_desc' ? '▼' : '⇅' }}</span>
            </th>
            <th class="col-nick">Nick <span class="sort-arrow">⇅</span></th>
            <th
              class="col-reply"
              :class="{ sorted: sortKey === 'reply_desc' }"
              @click="sortKey = 'reply_desc'"
            >
              Phản hồi
              <span class="sort-arrow">{{ sortKey === 'reply_desc' ? '▼' : '⇅' }}</span>
            </th>
            <th class="col-status">Trạng thái <span class="sort-arrow">⇅</span></th>
          </tr>
        </thead>
        <tbody>
          <!-- Loading skeleton -->
          <template v-if="loading && items.length === 0">
            <tr v-for="i in 8" :key="`sk-${i}`" class="skeleton-row">
              <td><div class="sk-bar sk-bar-name"></div><div class="sk-bar sk-bar-sub"></div></td>
              <td><div class="sk-bar sk-bar-name"></div><div class="sk-bar sk-bar-sub"></div></td>
              <td><div class="sk-bar sk-bar-progress"></div></td>
              <td><div class="sk-bar sk-bar-nick"></div></td>
              <td><div class="sk-bar sk-bar-reply"></div></td>
              <td><div class="sk-bar sk-bar-status"></div></td>
            </tr>
          </template>

          <!-- Error state -->
          <tr v-else-if="error">
            <td colspan="6" class="empty-cell">
              <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <div class="empty-title">Không tải được danh sách</div>
                <div class="empty-desc">{{ error }}</div>
                <button class="btn btn-primary" @click="loadList">Thử lại</button>
              </div>
            </td>
          </tr>

          <!-- Empty state -->
          <tr v-else-if="!loading && items.length === 0">
            <td colspan="6" class="empty-cell">
              <div class="empty-state">
                <div class="empty-icon">🎯</div>
                <div class="empty-title">
                  {{ searchInput || statusFilter !== 'all' ? 'Không có Mục tiêu nào khớp bộ lọc' : 'Chưa có Mục tiêu nào' }}
                </div>
                <div class="empty-desc">
                  {{ searchInput || statusFilter !== 'all'
                    ? 'Thử xoá tìm kiếm hoặc đổi bộ lọc.'
                    : 'Mục tiêu là chiến dịch mời kết bạn + bám đuổi 1 tệp khách hàng.' }}
                </div>
                <button
                  v-if="!searchInput && statusFilter === 'all'"
                  class="btn btn-primary"
                  @click="onCreate"
                >
                  + Tạo Mục tiêu đầu tiên
                </button>
              </div>
            </td>
          </tr>

          <!-- Data rows -->
          <tr
            v-for="item in items"
            v-else
            :key="item.id"
            :class="{ active: activeId === item.id }"
            @click="onRowClick(item)"
          >
            <td>
              <div class="row-name">{{ item.name }}</div>
              <div class="row-sub">tạo {{ formatShortDate(item.createdAt) }} bởi {{ item.createdBy?.fullName ?? '—' }}</div>
            </td>
            <td>
              <div class="row-name" style="font-weight:500">{{ item.list?.name ?? '—' }}</div>
              <div class="row-sub">{{ listSummaryLine(item) }}</div>
            </td>
            <td>
              <div class="progress-row">
                <span class="progress-pct">{{ progressPct(item) }}%</span>
                <div class="progress" style="flex:1">
                  <div
                    class="progress-fill"
                    :class="progressClass(item)"
                    :style="{ width: progressPct(item) + '%' }"
                  ></div>
                </div>
              </div>
              <div class="row-sub">{{ progressSubLine(item) }}</div>
            </td>
            <td>
              <div class="avatars">
                <span
                  v-for="(n, idx) in (item.nicks ?? []).slice(0, 3)"
                  :key="n.id ?? idx"
                  class="avatar"
                  :class="`a${(idx % 5) + 1}`"
                  :title="n.displayName ?? ''"
                >
                  {{ nickInitials(n.displayName ?? n.id ?? '?') }}
                </span>
                <span v-if="(item.nicks?.length ?? 0) > 3" class="avatar-more">
                  +{{ (item.nicks?.length ?? 0) - 3 }}
                </span>
                <span v-if="!item.nicks || item.nicks.length === 0" class="text-mute">—</span>
              </div>
            </td>
            <td>
              <template v-if="(item.replyCount ?? 0) > 0">
                <span class="reply-num">{{ item.replyCount }}</span>
                <span
                  v-if="item.replyTrend != null && item.replyTrend !== 0"
                  class="reply-trend"
                  :class="{ down: item.replyTrend < 0 }"
                >
                  {{ item.replyTrend > 0 ? '▲' : '▼' }} {{ Math.abs(item.replyTrend) }}
                </span>
                <div class="row-sub">reply tuần này</div>
              </template>
              <template v-else>
                <span class="reply-zero">0</span>
                <div class="row-sub">{{ item.status === 'scheduled' ? 'chưa khởi chạy' : 'chưa có reply' }}</div>
              </template>
            </td>
            <td>
              <span class="status" :class="statusClass(item.status)">
                {{ statusLabel(item) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ================== PAGINATION ================== -->
    <div v-if="!loading && !error && items.length > 0" class="pagination">
      <div>
        Hiển thị
        <strong>{{ pageFrom }}-{{ pageTo }}</strong>
        trong <strong>{{ formatNum(total) }}</strong> Mục tiêu
      </div>
      <div class="page-nav">
        <button
          class="page-btn"
          :disabled="page <= 1"
          @click="page > 1 && (page--, loadList())"
        >‹</button>
        <button class="page-btn active">{{ page }}</button>
        <button
          class="page-btn"
          :disabled="!hasNextPage"
          @click="hasNextPage && (page++, loadList())"
        >›</button>
      </div>
    </div>

    <!-- ================== SIDE PANEL ================== -->
    <div class="panel-overlay" :class="{ show: panelOpen }" @click="closePanel"></div>
    <aside class="side-panel" :class="{ open: panelOpen }">
      <template v-if="activeItem">
        <div class="panel-header">
          <div class="panel-header-row">
            <div style="flex:1; min-width:0">
              <h3 class="panel-title">{{ activeItem.name }}</h3>
              <div class="panel-meta-row">
                <span class="status" :class="statusClass(activeItem.status)">{{ statusLabel(activeItem) }}</span>
                <span class="panel-meta">
                  · tạo {{ formatShortDate(activeItem.createdAt) }} · {{ activeItem.createdBy?.fullName ?? '—' }}
                </span>
              </div>
            </div>
            <div class="menu-wrap">
              <button class="panel-icon-btn" title="Tác vụ khác" @click.stop="menuOpen = !menuOpen">⋯</button>
              <div class="menu" :class="{ show: menuOpen }">
                <div v-if="activeItem.status === 'running'" class="menu-item" @click="panelAction('pause')">⏸ Tạm dừng</div>
                <div v-else-if="activeItem.status === 'paused'" class="menu-item" @click="panelAction('resume')">▶ Tiếp tục</div>
                <div class="menu-item" @click="panelAction('duplicate')">📋 Sao chép</div>
                <div class="menu-divider"></div>
                <div class="menu-item danger" @click="panelAction('delete')">🗑 Xóa</div>
              </div>
            </div>
            <button class="panel-icon-btn" title="Đóng" @click="closePanel">✕</button>
          </div>
        </div>

        <div class="panel-body">
          <!-- Loading state -->
          <div v-if="dashboardLoading" class="panel-loading">
            <div class="sk-bar sk-bar-name" style="width:60%"></div>
            <div class="sk-bar sk-bar-sub" style="width:40%; margin-top:8px"></div>
          </div>

          <!-- Error state -->
          <div v-else-if="dashboardError" class="panel-error">
            <div class="empty-icon">⚠️</div>
            <div class="empty-title">Không tải được chi tiết</div>
            <button class="btn btn-sm btn-primary" @click="loadDashboard(activeItem.id)">Thử lại</button>
          </div>

          <template v-else-if="dashboard">
            <!-- 4 stat cards -->
            <div class="panel-section">
              <div class="stat-grid">
                <div class="stat-card">
                  <div class="stat-label">Trong tệp</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.total) }}</div>
                </div>
                <div class="stat-card">
                  <div class="stat-label">Đã xử lý</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.processed) }}</div>
                </div>
                <div class="stat-card green">
                  <div class="stat-label">Có Zalo</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.hasZalo) }}</div>
                </div>
                <div class="stat-card red">
                  <div class="stat-label">Không Zalo</div>
                  <div class="stat-value">{{ formatNum(dashboardStats.noZalo) }}</div>
                </div>
              </div>
            </div>

            <!-- Danger CTA -->
            <div v-if="dashboardStats.noZalo > 0" class="cta-banner">
              <span style="font-size:18px">🔴</span>
              <div class="cta-banner-text">
                <strong>Không có Zalo ({{ formatNum(dashboardStats.noZalo) }} KH)</strong>
                — gợi ý gọi điện qua Lead Pool
              </div>
              <a
                href="#"
                @click.prevent="goLeadPool(activeItem.id)"
              >Xem danh sách →</a>
            </div>

            <!-- Phase 1 -->
            <div class="panel-section">
              <div class="panel-section-title">Phase 1 · Mời kết bạn</div>
              <div class="phase-block">
                <div class="phase-head">
                  <span>Tiến độ Phase 1</span>
                  <span style="color:var(--mtl-text-3); font-weight:500">
                    {{ formatNum(dashboardStats.sent) }} / {{ formatNum(Math.max(dashboardStats.hasZalo, dashboardStats.sent)) }}
                  </span>
                </div>
                <div class="progress">
                  <div
                    class="progress-fill"
                    :style="{ width: phase1Pct + '%' }"
                  ></div>
                </div>
                <div class="phase-row" style="margin-top:10px">
                  <span>Đã gửi lời mời</span><span class="v">{{ formatNum(dashboardStats.sent) }}</span>
                </div>
                <div class="phase-row">
                  <span>Đồng ý kết bạn</span>
                  <span class="v" style="color:var(--mtl-success)">{{ formatNum(dashboardStats.accepted) }}</span>
                </div>
                <div class="phase-row">
                  <span>Từ chối</span>
                  <span class="v" style="color:var(--mtl-danger)">{{ formatNum(dashboardStats.rejected) }}</span>
                </div>
                <div class="phase-row muted">
                  <span>Đang chờ phản hồi</span>
                  <span class="v">{{ formatNum(dashboardStats.pending) }}</span>
                </div>
              </div>
            </div>

            <!-- Phase 2 -->
            <div class="panel-section">
              <div class="panel-section-title">Phase 2 · Chuỗi bám đuổi (Welcome → Follow-up)</div>
              <div class="phase-block">
                <div class="phase-head">
                  <span>Tiến độ Phase 2</span>
                  <span style="color:var(--mtl-text-3); font-weight:500">
                    {{ formatNum(dashboardStats.welcomeSent) }} KH đã nhận tin đầu
                  </span>
                </div>
                <div class="progress">
                  <div
                    class="progress-fill"
                    :style="{ width: phase2Pct + '%' }"
                  ></div>
                </div>
                <div class="phase-row" style="margin-top:10px">
                  <span>Đã gửi tin Welcome</span><span class="v">{{ formatNum(dashboardStats.welcomeSent) }}</span>
                </div>
                <div class="phase-row">
                  <span>Đang chạy bước tiếp</span>
                  <span class="v" style="color:var(--mtl-primary)">{{ formatNum(dashboardStats.inSequence) }}</span>
                </div>
                <div class="phase-row">
                  <span>Hoàn tất chuỗi</span>
                  <span class="v" style="color:var(--mtl-success)">{{ formatNum(dashboardStats.sequenceDone) }}</span>
                </div>
                <div class="phase-row muted">
                  <span>Dừng (reply / block)</span>
                  <span class="v">{{ formatNum(dashboardStats.sequenceStopped) }}</span>
                </div>
              </div>
            </div>

            <!-- Top nicks -->
            <div v-if="topNicks.length > 0" class="panel-section">
              <div class="panel-section-title">Top 3 nick theo tỉ lệ Accept</div>
              <table class="nick-table">
                <thead>
                  <tr><th>Nick</th><th>Gửi</th><th>Accept</th><th>%</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(n, idx) in topNicks" :key="n.nickId">
                    <td>
                      {{ n.displayName ?? n.nickId.slice(0, 6) }}
                      <span class="medal">{{ ['🥇', '🥈', '🥉'][idx] ?? '' }}</span>
                    </td>
                    <td>{{ formatNum(n.sent) }}</td>
                    <td>{{ formatNum(n.accepted) }}</td>
                    <td>
                      <span class="accept-bar">
                        <span class="fill" :style="{ width: Math.min(100, n.acceptPct * 6) + '%' }"></span>
                      </span>
                      <strong>{{ n.acceptPct.toFixed(1) }}%</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>

        <div class="panel-footer">
          <button class="btn btn-primary btn-block" @click="goDetail(activeItem.id)">
            Mở trang chi tiết đầy đủ →
          </button>
        </div>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';

const router = useRouter();

// ============ Types (FE-side, mirrors expected BE response) ============

type MucTieuStatus = 'running' | 'paused' | 'done' | 'scheduled' | 'draft';

interface NickMini {
  id: string;
  displayName: string | null;
}

interface MucTieuListItem {
  id: string;
  name: string;
  status: MucTieuStatus;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  list: { id: string; name: string; phoneCount: number } | null;
  processedCount: number;
  totalCount: number;
  scheduledAt: string | null;
  nicks: NickMini[];
  replyCount: number;
  replyTrend: number | null;
  // Phase Friend Invite UI 2026-05-30 — flat counters from BE (top-level)
  // shipped by muc-tieu-list-service: tổng SĐT / có Zalo / không Zalo / đã xử lý /
  // KH đã hoàn tất Sequence (derive từ AutomationTask state='done'|'skipped').
  totalEntries?: number;
  hasZaloCount?: number;
  noZaloCount?: number;
  completedKHCount?: number;
}

// NOTE: BE list response shape is defined as `BeListResponse` inside loadList()
// (FE adapter scope) — the FE-side `MucTieuListItem` above represents the
// POST-adapter shape consumed by the template.

// Trigger dashboard payload (Wave 2 endpoint).
// Side panel adapter reads counters[] + nicks[] from it.
interface DashboardCounters {
  total?: number;
  processed?: number;
  sent?: number;
  accepted?: number;
  rejected?: number;
  pending?: number;
  skipped_no_zalo?: number;
  failed_permanent?: number;
  failed_stuck?: number;
  welcome_sent?: number;
  in_sequence?: number;
  sequence_done?: number;
  sequence_stopped?: number;
  [k: string]: number | undefined;
}

interface DashboardNick {
  nickId: string;
  displayName: string | null;
  sentTotal?: number;
  sent?: number;
  accepted?: number;
}

interface DashboardPayload {
  trigger: { id: string; name: string; state: string };
  counters: DashboardCounters;
  nicks: DashboardNick[];
}

// ============ State ============

const items = ref<MucTieuListItem[]>([]);
const total = ref(0);
const statusCounts = ref<Record<string, number>>({});

const loading = ref(false);
const error = ref<string | null>(null);

const searchInput = ref('');
const searchDebounced = ref('');
const statusFilter = ref<'all' | MucTieuStatus>('all');
const sortKey = ref<'created_desc' | 'progress_desc' | 'reply_desc'>('created_desc');

const page = ref(1);
const pageSize = 20;

const activeId = ref<string | null>(null);
const activeItem = computed<MucTieuListItem | null>(() =>
  items.value.find((x) => x.id === activeId.value) ?? null,
);
const panelOpen = ref(false);
const menuOpen = ref(false);

const dashboard = ref<DashboardPayload | null>(null);
const dashboardLoading = ref(false);
const dashboardError = ref<string | null>(null);

// ============ Status chips ============
// FE chip-key (UX label) ↔ BE state map.
// BE AutomationTrigger.state ∈ { draft | active | paused | completed | cancelled }.
// "scheduled" UX bucket = trigger có state='draft' + scheduledAt — Wave 3 BE chưa
// trả riêng → tạm map sang `draft` count, hiển thị 0 nếu trống.
const chipToBeState: Record<Exclude<'all' | MucTieuStatus, 'all'>, string> = {
  running: 'active',
  paused: 'paused',
  done: 'completed',
  scheduled: 'draft',
  draft: 'draft',
};

const statusChips: { key: 'all' | MucTieuStatus; label: string }[] = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'running',   label: '🟢 Đang chạy' },
  { key: 'paused',    label: '⏸ Tạm dừng' },
  { key: 'done',      label: '✅ Hoàn tất' },
  { key: 'scheduled', label: '🟡 Hẹn lịch' },
];

// Display count for a chip — reads BE-keyed statusCounts via chipToBeState mapping.
function chipCount(key: 'all' | MucTieuStatus): number {
  if (key === 'all') return statusCounts.value.all ?? total.value ?? 0;
  const beKey = chipToBeState[key];
  return statusCounts.value[beKey] ?? 0;
}

// ============ Debounce search input → searchDebounced ============

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchDebounced.value = val.trim();
  }, 400);
});

// Reset to page 1 + reload when filter changes
watch([searchDebounced, statusFilter, sortKey], () => {
  page.value = 1;
  void loadList();
});

// ============ API calls ============

// ============ FE Adapter — BE shape → FE expected shape ============
// P0-1 FIX 2026-05-30 — BE service `muc-tieu-list-service.ts` ship payload với
// shape không khớp template `<tr v-for>` (template đọc `item.status`/`item.list`/
// `item.processedCount`/`createdBy.fullName`/`item.nicks[]`). Anh chốt fix trên
// FE: adapter map field 1-1 thay vì refactor BE.
//
// Map rules:
//   BE `state`             → FE `status` (active→running, completed→done, …)
//   BE `sourceList`        → FE `list` (totalEntries → phoneCount)
//   BE `progress.processed`→ FE `processedCount`
//   BE `progress.totalContacts` → FE `totalCount`
//   BE `counters.replyCount` → FE `replyCount`
//   BE `createdBy.displayName` → FE `createdBy.fullName`
//   BE `nickIds[]` (bulk-loaded via GET /zalo-accounts) → FE `nicks[]` (id+displayName)
//
// Nick lookup: gom unique nickIds toàn page rồi gọi 1 GET /zalo-accounts → map.
// /zalo-accounts không hỗ trợ ?ids= filter (đọc-all rồi filter client), nhưng
// dataset nick org thường <50 (memory zalocrm_scale_target) nên acceptable.

const stateToStatus: Record<string, MucTieuStatus> = {
  active: 'running',
  paused: 'paused',
  completed: 'done',
  draft: 'draft',
  cancelled: 'draft', // UI ẩn cancelled mặc định; fallback hiển thị Nháp.
};

// Raw BE shape (mirrors muc-tieu-list-service.MucTieuListItem)
interface BeMucTieuItem {
  id: string;
  name: string;
  state: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
  sourceList: { id: string; name: string; totalEntries: number } | null;
  sequenceName: string | null;
  nickCount?: number;
  nickIds?: string[];
  progress?: { totalContacts: number; processed: number; percent: number };
  counters?: { friendSent?: number; friendAccepted?: number; replyCount?: number; blockCount?: number };
  totalEntries?: number;
  hasZaloCount?: number;
  noZaloCount?: number;
  processedCount?: number;
  completedKHCount?: number;
  scheduledAt?: string | null;
  replyCount?: number; // tolerate already-flat shape
  replyTrend?: number | null;
}

interface ZaloAccountMini {
  id: string;
  displayName: string | null;
}

// Cache trong scope load — không cross-page persist (page mới refetch để pickup
// nick rename / new nick).
async function loadNickDisplayMap(nickIds: string[]): Promise<Map<string, ZaloAccountMini>> {
  const map = new Map<string, ZaloAccountMini>();
  if (nickIds.length === 0) return map;
  try {
    const res = await api.get<ZaloAccountMini[]>('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : [];
    for (const acc of accounts) {
      if (acc?.id) map.set(acc.id, { id: acc.id, displayName: acc.displayName ?? null });
    }
  } catch {
    // Nick fetch fail không bể list — avatar fallback hiện ID prefix.
  }
  return map;
}

function adaptItem(be: BeMucTieuItem, nickMap: Map<string, ZaloAccountMini>): MucTieuListItem {
  const nickIds = be.nickIds ?? [];
  const nicks: NickMini[] = nickIds.map((nid) => {
    const hit = nickMap.get(nid);
    return { id: nid, displayName: hit?.displayName ?? null };
  });
  return {
    id: be.id,
    name: be.name,
    status: stateToStatus[be.state] ?? 'draft',
    createdAt: be.createdAt,
    createdBy: be.createdBy
      ? { id: be.createdBy.id, fullName: be.createdBy.displayName }
      : null,
    list: be.sourceList
      ? { id: be.sourceList.id, name: be.sourceList.name, phoneCount: be.sourceList.totalEntries }
      : null,
    processedCount: be.progress?.processed ?? be.processedCount ?? 0,
    totalCount: be.progress?.totalContacts ?? be.totalEntries ?? 0,
    scheduledAt: be.scheduledAt ?? null,
    nicks,
    replyCount: be.counters?.replyCount ?? be.replyCount ?? 0,
    replyTrend: be.replyTrend ?? null,
    totalEntries: be.totalEntries,
    hasZaloCount: be.hasZaloCount,
    noZaloCount: be.noZaloCount,
    completedKHCount: be.completedKHCount,
  };
}

// BE raw list response shape
interface BeListResponse {
  items: BeMucTieuItem[];
  total: number;
  page?: number;
  pageSize?: number;
  statusCounts?: Record<string, number>;
  filters?: { statusCounts?: Record<string, number> };
}

async function loadList() {
  loading.value = true;
  error.value = null;
  try {
    const params: Record<string, string | number> = {
      page: page.value,
      pageSize,
      sort: sortKey.value,
    };
    if (searchDebounced.value) params.search = searchDebounced.value;
    if (statusFilter.value !== 'all') {
      // Map FE chip key → BE state key (e.g., "running" → "active").
      params.status = chipToBeState[statusFilter.value] ?? statusFilter.value;
    }

    const res = await api.get<BeListResponse>('/automation/muc-tieu/list', { params });
    const beItems = res.data.items ?? [];

    // Bulk-load nick displayNames cho toàn page (1 GET).
    const allNickIds = new Set<string>();
    for (const it of beItems) {
      for (const nid of it.nickIds ?? []) allNickIds.add(nid);
    }
    const nickMap = await loadNickDisplayMap([...allNickIds]);

    items.value = beItems.map((be) => adaptItem(be, nickMap));
    total.value = res.data.total ?? 0;
    // BE Wave 3 ships counters under `filters.statusCounts`; fallback to root for safety.
    statusCounts.value =
      res.data.filters?.statusCounts ?? res.data.statusCounts ?? {};
  } catch (err) {
    const e = err as { response?: { data?: { error?: string; detail?: string } }; message?: string };
    error.value =
      e.response?.data?.detail ??
      e.response?.data?.error ??
      e.message ??
      'Lỗi không xác định';
  } finally {
    loading.value = false;
  }
}

async function loadDashboard(triggerId: string) {
  dashboardLoading.value = true;
  dashboardError.value = null;
  dashboard.value = null;
  try {
    const res = await api.get<DashboardPayload>(`/automation/triggers/${triggerId}/dashboard`);
    dashboard.value = res.data;
  } catch (err) {
    const e = err as { response?: { data?: { error?: string } }; message?: string };
    dashboardError.value =
      e.response?.data?.error ??
      e.message ??
      'Lỗi tải dashboard';
  } finally {
    dashboardLoading.value = false;
  }
}

// ============ Side panel ============

function onRowClick(item: MucTieuListItem) {
  activeId.value = item.id;
  panelOpen.value = true;
  menuOpen.value = false;
  void loadDashboard(item.id);
}

function closePanel() {
  panelOpen.value = false;
  menuOpen.value = false;
  // Clear active row indicator after slide-out transition
  setTimeout(() => {
    if (!panelOpen.value) activeId.value = null;
  }, 250);
}

function panelAction(action: 'pause' | 'resume' | 'duplicate' | 'delete') {
  menuOpen.value = false;
  if (!activeItem.value) return;
  const id = activeItem.value.id;
  // Light-weight actions — defer real impl to detail page
  if (action === 'delete') {
    if (!confirm(`Xoá Mục tiêu "${activeItem.value.name}"?`)) return;
    void api
      .delete(`/automation/triggers/${id}`)
      .then(() => {
        closePanel();
        void loadList();
      })
      .catch((err: unknown) => {
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        alert(`Không xoá được: ${e.response?.data?.error ?? e.message ?? 'lỗi'}`);
      });
    return;
  }
  if (action === 'pause') {
    void api
      .post(`/automation/triggers/${id}/pause`)
      .then(() => loadList())
      .catch(() => alert('Không tạm dừng được'));
    return;
  }
  if (action === 'resume') {
    void api
      .post(`/automation/triggers/${id}/resume`)
      .then(() => loadList())
      .catch(() => alert('Không tiếp tục được'));
    return;
  }
  if (action === 'duplicate') {
    alert('Sao chép — Wave 4');
    return;
  }
}

function onCreate() {
  void router.push('/automation/muc-tieu/tao-moi');
}

function goDetail(id: string) {
  // Wave 3 Day 1 — MucTieuDetailView (Dashboard + Log) thay TriggerDetailView legacy.
  void router.push(`/automation/muc-tieu/${id}`);
}

function goLeadPool(id: string) {
  void router.push({ path: '/leads/stuck', query: { source: 'muc-tieu', id } });
}

// ============ Derived stats for side panel ============

const dashboardStats = computed(() => {
  const c = dashboard.value?.counters ?? {};
  const total = c.total ?? 0;
  const processed = c.processed ?? 0;
  const sent = c.sent ?? processed;
  const accepted = c.accepted ?? 0;
  const rejected = c.rejected ?? 0;
  const hasZalo = total - (c.skipped_no_zalo ?? 0);
  const noZalo = c.skipped_no_zalo ?? 0;
  const pending = Math.max(0, sent - accepted - rejected);
  return {
    total,
    processed,
    sent,
    accepted,
    rejected,
    pending,
    hasZalo,
    noZalo,
    welcomeSent: c.welcome_sent ?? c.processed ?? 0,
    inSequence: c.in_sequence ?? 0,
    sequenceDone: c.sequence_done ?? 0,
    sequenceStopped: c.sequence_stopped ?? 0,
  };
});

const phase1Pct = computed(() => {
  const s = dashboardStats.value;
  if (s.hasZalo <= 0) return 0;
  return Math.min(100, Math.round((s.sent / s.hasZalo) * 100));
});
const phase2Pct = computed(() => {
  const s = dashboardStats.value;
  if (s.welcomeSent <= 0) return 0;
  const denom = s.welcomeSent;
  const num = s.sequenceDone + s.inSequence;
  return Math.min(100, Math.round((num / Math.max(denom, 1)) * 100));
});

const topNicks = computed(() => {
  const ns = dashboard.value?.nicks ?? [];
  return ns
    .map((n) => {
      const sent = n.sent ?? n.sentTotal ?? 0;
      const accepted = n.accepted ?? 0;
      const acceptPct = sent > 0 ? (accepted / sent) * 100 : 0;
      return { nickId: n.nickId, displayName: n.displayName, sent, accepted, acceptPct };
    })
    .sort((a, b) => b.acceptPct - a.acceptPct)
    .slice(0, 3);
});

// ============ Helpers ============

function progressPct(item: MucTieuListItem): number {
  // Phase Friend Invite UI 2026-05-30 — Tiến độ giờ đếm KH HOÀN TẤT (sequence_done)
  // chứ không phải "đã xử lý kiểm Zalo". `completedKHCount / totalEntries`.
  // Fallback `processedCount / totalCount` cho payload cũ.
  const t = item.totalEntries ?? item.totalCount ?? 0;
  if (t <= 0) return 0;
  const n = item.completedKHCount ?? item.processedCount ?? 0;
  return Math.min(100, Math.round((n / t) * 100));
}

// Cột "Tệp KH": "X SĐT · Y có Zalo · Z không Zalo".
// Hiển thị placeholder "—" nếu BE chưa kèm flat counters (cũ payload).
function listSummaryLine(item: MucTieuListItem): string {
  const totalSdt = item.totalEntries ?? item.list?.phoneCount ?? 0;
  const hasZalo = item.hasZaloCount;
  const noZalo = item.noZaloCount;
  if (hasZalo == null && noZalo == null) {
    return `${formatNum(totalSdt)} SĐT`;
  }
  return `${formatNum(totalSdt)} SĐT · ${formatNum(hasZalo ?? 0)} có Zalo · ${formatNum(noZalo ?? 0)} không Zalo`;
}

function progressClass(item: MucTieuListItem): string {
  if (item.status === 'done') return 'success';
  if (item.status === 'paused') return 'warning';
  if (item.status === 'scheduled') return 'muted';
  return '';
}

function progressSubLine(item: MucTieuListItem): string {
  if (item.status === 'scheduled' && item.scheduledAt) {
    return `Bắt đầu ${formatShortDateTime(item.scheduledAt)}`;
  }
  // Phase Friend Invite UI 2026-05-30 — đếm KH đi hết Sequence (completedKHCount)
  // chia tổng entries (totalEntries). Không có flat counter mới → fallback processed.
  const done = item.completedKHCount ?? item.processedCount ?? 0;
  const total = item.totalEntries ?? item.totalCount ?? 0;
  return `${formatNum(done)}/${formatNum(total)} hoàn tất (${progressPct(item)}%)`;
}

function statusClass(status: MucTieuStatus): string {
  return status; // CSS classes: running / paused / done / scheduled / draft
}

function statusLabel(item: MucTieuListItem): string {
  if (item.status === 'running') return '🟢 Đang chạy';
  if (item.status === 'paused') return '⏸ Tạm dừng';
  if (item.status === 'done') return '✅ Hoàn tất';
  if (item.status === 'scheduled') {
    if (item.scheduledAt) return `🟡 Hẹn ${formatShortDateTime(item.scheduledAt)}`;
    return '🟡 Hẹn lịch';
  }
  return '📝 Nháp';
}

function nickInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1];
  if (parts.length === 1) {
    return last.slice(0, 2).toUpperCase();
  }
  return (parts[0][0] ?? '').toUpperCase() + (last[0] ?? '').toUpperCase();
}

function formatNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString('vi-VN');
}

function formatShortDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function formatShortDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

// ============ Pagination ============

const pageFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize + 1));
const pageTo = computed(() => Math.min(total.value, page.value * pageSize));
const hasNextPage = computed(() => page.value * pageSize < total.value);

// ============ Keyboard ESC closes panel + click-outside menu ============

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (menuOpen.value) menuOpen.value = false;
    else if (panelOpen.value) closePanel();
  }
}
function onDocClick() {
  if (menuOpen.value) menuOpen.value = false;
}

onMounted(() => {
  void loadList();
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocClick);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onDocClick);
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
});
</script>

<style scoped>
/* ============================ DESIGN TOKENS (scoped) ============================ */
.mtl-page {
  --mtl-bg-page: #FAFBFC;
  --mtl-bg-card: #FFFFFF;
  --mtl-bg-soft: #F4F5F7;
  --mtl-bg-hover: #EBF3FF;
  --mtl-border: #DFE1E6;
  --mtl-border-strong: #C1C7D0;
  --mtl-text-1: #172B4D;
  --mtl-text-2: #42526E;
  --mtl-text-3: #6B778C;
  --mtl-text-mute: #97A0AF;
  --mtl-primary: #2D7FF9;
  --mtl-primary-hover: #1B6FE0;
  --mtl-primary-bg: #E7F0FF;
  --mtl-success: #36B37E;
  --mtl-success-bg: #E3FCEF;
  --mtl-warning: #FFAB00;
  --mtl-warning-bg: #FFF7E0;
  --mtl-danger: #DE350B;
  --mtl-danger-bg: #FFEBE6;
  --mtl-purple: #6554C0;
  --mtl-purple-bg: #EAE6FF;
  --mtl-shadow-1: 0 1px 2px rgba(9, 30, 66, 0.05);
  --mtl-shadow-2: 0 4px 12px rgba(9, 30, 66, 0.12);
  --mtl-shadow-panel: -8px 0 24px rgba(9, 30, 66, 0.10);

  width: 100%;
  min-width: 1280px;
  max-width: 1920px;
  margin: 0 auto;
  padding: 16px 24px 24px;
  background: var(--mtl-bg-page);
  color: var(--mtl-text-1);
  font-size: 13px;
  line-height: 1.45;
}

/* ============================ HEADER ============================ */
.crumb { font-size: 12px; color: var(--mtl-text-3); margin-bottom: 8px; }
.crumb a { color: var(--mtl-text-3); text-decoration: none; cursor: pointer; }
.crumb a:hover { color: var(--mtl-primary); }
.crumb .sep { margin: 0 6px; color: var(--mtl-text-mute); }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 16px; }
.topbar h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em; color: var(--mtl-text-1); }
.topbar .sub { font-size: 13px; color: var(--mtl-text-3); margin: 0; }
.actions { display: flex; gap: 8px; flex-shrink: 0; }

.btn {
  padding: 8px 14px;
  background: white;
  border: 1px solid var(--mtl-border-strong);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--mtl-text-2);
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.btn:hover:not(:disabled) { background: var(--mtl-bg-soft); border-color: var(--mtl-text-3); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary { background: var(--mtl-primary); color: white; border-color: var(--mtl-primary); }
.btn-primary:hover:not(:disabled) { background: var(--mtl-primary-hover); border-color: var(--mtl-primary-hover); }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover:not(:disabled) { background: var(--mtl-bg-soft); }
.btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 4px; }
.btn-block { width: 100%; justify-content: center; }

/* ============================ FILTER BAR ============================ */
.filter-bar {
  position: sticky; top: 0; z-index: 10;
  background: var(--mtl-bg-page);
  padding: 10px 0;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--mtl-border);
}
.search-wrap { position: relative; width: 320px; }
.search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: 1px solid var(--mtl-border-strong);
  border-radius: 6px;
  font-size: 13px;
  background: white;
  font-family: inherit;
  color: var(--mtl-text-1);
  transition: border-color 0.15s;
}
.search-input:focus { outline: none; border-color: var(--mtl-primary); box-shadow: 0 0 0 3px rgba(45, 127, 249, 0.15); }
.search-icon {
  position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
  color: var(--mtl-text-3); font-size: 14px;
}

.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  padding: 6px 12px;
  background: white;
  border: 1px solid var(--mtl-border);
  border-radius: 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--mtl-text-2);
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  user-select: none;
}
.chip:hover { background: var(--mtl-bg-soft); border-color: var(--mtl-border-strong); }
.chip.active { background: var(--mtl-primary-bg); border-color: var(--mtl-primary); color: var(--mtl-primary); font-weight: 600; }
.chip .count { color: var(--mtl-text-3); font-size: 11px; }
.chip.active .count { color: var(--mtl-primary); }

.filter-spacer { flex: 1; }
.filter-right { display: flex; gap: 8px; align-items: center; }
.sort-dd {
  padding: 7px 12px;
  background: white;
  border: 1px solid var(--mtl-border-strong);
  border-radius: 6px;
  font-size: 12px;
  color: var(--mtl-text-2);
  cursor: pointer;
  font-family: inherit;
}
.view-toggle { display: flex; border: 1px solid var(--mtl-border-strong); border-radius: 6px; overflow: hidden; }
.view-toggle button {
  padding: 6px 10px;
  background: white;
  border: none;
  font-size: 12px;
  color: var(--mtl-text-3);
  cursor: pointer;
  font-family: inherit;
}
.view-toggle button.active { background: var(--mtl-primary); color: white; }
.view-toggle button:disabled { opacity: 0.5; cursor: not-allowed; }

/* ============================ TABLE ============================ */
.table-card {
  background: white;
  border: 1px solid var(--mtl-border);
  border-radius: 6px;
  /* IMPORTANT: KHÔNG overflow:hidden — cắt sticky context của <thead> bên trong.
     Dùng clip-path để vẫn giữ rounded corner cho border-radius mà không phá sticky. */
  overflow: visible;
  box-shadow: var(--mtl-shadow-1);
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
/* Sticky thead must paint OVER tbody row 1 — bg-white + z-index 10 + shadow.
   Background lives on both THEAD và TH: thead sticky cho Safari ≤14 cross-browser,
   th sticky cho modern. top:0 dính tới mép trên scroll container (.mtl-page),
   KHÔNG hardcode 64px (offset navbar thay đổi theo layout). */
thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #FFFFFF;
}
thead tr {
  border-bottom: 1px solid var(--mtl-border);
}
thead th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #FFFFFF;
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mtl-text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
  cursor: pointer;
  border-bottom: 1px solid var(--mtl-border);
  white-space: nowrap;
  /* Crisp drop shadow so row 1 visibly slides UNDER the header on scroll. */
  box-shadow: 0 1px 0 var(--mtl-border), 0 2px 4px rgba(9, 30, 66, 0.06);
}
thead th:hover { background: #ECEEF1; color: var(--mtl-text-2); }
thead th .sort-arrow { color: var(--mtl-text-mute); font-size: 10px; margin-left: 4px; }
thead th.sorted .sort-arrow { color: var(--mtl-primary); }

tbody tr {
  border-bottom: 1px solid var(--mtl-border);
  cursor: pointer;
  transition: background 0.1s;
  height: 56px;
}
tbody tr:hover { background: var(--mtl-bg-hover); }
tbody tr.active { background: var(--mtl-primary-bg); box-shadow: inset 3px 0 0 var(--mtl-primary); }
tbody td { padding: 10px 14px; vertical-align: middle; }
tbody tr:last-child { border-bottom: none; }

.col-name { width: 28%; }
.col-list { width: 16%; }
.col-progress { width: 18%; }
.col-nick { width: 12%; }
.col-reply { width: 10%; }
.col-status { width: 14%; }

.row-name { font-weight: 600; color: var(--mtl-text-1); font-size: 13px; line-height: 1.3; }
.row-sub { font-size: 11px; color: var(--mtl-text-3); margin-top: 2px; }
.text-mute { color: var(--mtl-text-mute); }

/* Progress bar */
.progress {
  width: 100%;
  height: 4px;
  background: var(--mtl-bg-soft);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}
.progress-fill { height: 100%; background: var(--mtl-primary); border-radius: 2px; transition: width 0.3s; }
.progress-fill.success { background: var(--mtl-success); }
.progress-fill.warning { background: var(--mtl-warning); }
.progress-fill.muted { background: var(--mtl-text-mute); }
.progress-row { display: flex; align-items: center; gap: 8px; }
.progress-pct { font-weight: 600; font-size: 12px; color: var(--mtl-text-2); min-width: 36px; }

/* Avatar group */
.avatars { display: flex; align-items: center; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--mtl-primary-bg);
  color: var(--mtl-primary);
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid white;
  margin-left: -8px;
  text-transform: uppercase;
}
.avatar:first-child { margin-left: 0; }
.avatar.a2 { background: #FFE0B2; color: #B45309; }
.avatar.a3 { background: #D1FAE5; color: #047857; }
.avatar.a4 { background: #E0E7FF; color: #4F46E5; }
.avatar.a5 { background: #FCE7F3; color: #BE185D; }
.avatar-more {
  margin-left: 4px;
  font-size: 11px;
  color: var(--mtl-text-3);
  font-weight: 600;
}

/* Status chip */
.status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.status.running { background: var(--mtl-success-bg); color: #006644; }
.status.done { background: var(--mtl-primary-bg); color: var(--mtl-primary); }
.status.paused { background: var(--mtl-bg-soft); color: var(--mtl-text-2); }
.status.scheduled { background: var(--mtl-warning-bg); color: #974F00; }
.status.draft { background: var(--mtl-purple-bg); color: var(--mtl-purple); }

/* Reply cell */
.reply-num { font-weight: 600; color: var(--mtl-text-1); }
.reply-trend { color: var(--mtl-success); font-size: 11px; margin-left: 4px; }
.reply-trend.down { color: var(--mtl-danger); }
.reply-zero { color: var(--mtl-text-mute); font-weight: 500; }

/* ============================ EMPTY / SKELETON ============================ */
.empty-cell { padding: 0 !important; }
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
}
.empty-icon { font-size: 36px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--mtl-text-1); }
.empty-desc { font-size: 13px; color: var(--mtl-text-3); margin-bottom: 8px; text-align: center; }

.skeleton-row { cursor: default; }
.skeleton-row:hover { background: white; }
.sk-bar {
  height: 10px;
  background: linear-gradient(90deg, #EEF1F4 0%, #F7F8FA 50%, #EEF1F4 100%);
  background-size: 200% 100%;
  border-radius: 3px;
  animation: sk-shimmer 1.4s infinite;
  border: 1px dashed transparent;
}
.sk-bar-name { width: 70%; }
.sk-bar-sub { width: 40%; height: 8px; margin-top: 6px; }
.sk-bar-progress { width: 90%; height: 8px; }
.sk-bar-nick { width: 60%; height: 24px; border-radius: 12px; }
.sk-bar-reply { width: 40%; }
.sk-bar-status { width: 80%; height: 16px; border-radius: 4px; }
@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ============================ FOOTER PAGINATION ============================ */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 4px;
  font-size: 12px;
  color: var(--mtl-text-3);
}
.page-nav { display: flex; gap: 4px; }
.page-btn {
  min-width: 28px; height: 28px;
  padding: 0 8px;
  border: 1px solid var(--mtl-border);
  background: white;
  border-radius: 4px;
  font-size: 12px;
  color: var(--mtl-text-2);
  cursor: pointer;
  font-family: inherit;
}
.page-btn:hover:not(:disabled) { background: var(--mtl-bg-soft); }
.page-btn.active { background: var(--mtl-primary); color: white; border-color: var(--mtl-primary); }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ============================ SIDE PANEL ============================ */
.panel-overlay {
  position: fixed; inset: 0;
  background: rgba(9, 30, 66, 0.30);
  z-index: 90;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}
.panel-overlay.show { opacity: 1; pointer-events: auto; }

.side-panel {
  position: fixed;
  top: 0; right: 0;
  height: 100vh;
  width: 460px;
  background: white;
  z-index: 100;
  transform: translateX(100%);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--mtl-shadow-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.side-panel.open { transform: translateX(0); }

.panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--mtl-border);
  background: white;
  flex-shrink: 0;
}
.panel-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.panel-title { font-size: 16px; font-weight: 700; color: var(--mtl-text-1); line-height: 1.3; margin: 0 0 6px; }
.panel-meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.panel-meta { font-size: 11px; color: var(--mtl-text-3); }
.panel-icon-btn {
  background: transparent; border: none; cursor: pointer;
  padding: 4px 8px; color: var(--mtl-text-3); font-size: 18px;
  line-height: 1; border-radius: 4px; font-family: inherit;
}
.panel-icon-btn:hover { background: var(--mtl-bg-soft); color: var(--mtl-text-1); }

.panel-body { flex: 1; overflow-y: auto; padding: 16px 20px; }

.panel-section { margin-bottom: 20px; }
.panel-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--mtl-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
}

.panel-loading, .panel-error {
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

/* Stat cards */
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat-card {
  background: var(--mtl-bg-soft);
  border-radius: 6px;
  padding: 10px 12px;
}
.stat-label { font-size: 11px; color: var(--mtl-text-3); margin-bottom: 2px; }
.stat-value { font-size: 18px; font-weight: 700; color: var(--mtl-text-1); line-height: 1.1; }
.stat-card.green { background: var(--mtl-success-bg); }
.stat-card.green .stat-value { color: #006644; }
.stat-card.red { background: var(--mtl-danger-bg); }
.stat-card.red .stat-value { color: var(--mtl-danger); }

/* Danger CTA banner */
.cta-banner {
  background: var(--mtl-danger-bg);
  border: 1px solid #FFBDAD;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.cta-banner-text { flex: 1; font-size: 12px; color: #8B1A0A; }
.cta-banner-text strong { color: var(--mtl-danger); }
.cta-banner a { color: var(--mtl-danger); font-weight: 600; text-decoration: none; font-size: 12px; white-space: nowrap; cursor: pointer; }
.cta-banner a:hover { text-decoration: underline; }

/* Phase progress */
.phase-block {
  background: var(--mtl-bg-soft);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 10px;
}
.phase-head { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--mtl-text-1); margin-bottom: 8px; }
.phase-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px;
  font-size: 12px;
  padding: 3px 0;
  color: var(--mtl-text-2);
}
.phase-row .v { font-weight: 600; color: var(--mtl-text-1); }
.phase-row.muted .v { color: var(--mtl-text-3); }

/* Nick mini table */
.nick-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.nick-table th { text-align: left; padding: 6px 4px; color: var(--mtl-text-3); font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--mtl-border); }
.nick-table th:last-child, .nick-table td:last-child { text-align: right; }
.nick-table td { padding: 7px 4px; border-bottom: 1px solid var(--mtl-border); color: var(--mtl-text-1); }
.nick-table td .medal { margin-left: 4px; }
.accept-bar {
  display: inline-block;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--mtl-bg-soft);
  margin-right: 6px;
  vertical-align: middle;
  position: relative;
  overflow: hidden;
}
.accept-bar .fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--mtl-success); border-radius: 2px; }

/* Panel footer */
.panel-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--mtl-border);
  background: white;
  flex-shrink: 0;
}

/* Dropdown menu */
.menu-wrap { position: relative; }
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: white;
  border: 1px solid var(--mtl-border);
  border-radius: 6px;
  box-shadow: var(--mtl-shadow-2);
  min-width: 160px;
  padding: 4px;
  display: none;
  z-index: 110;
}
.menu.show { display: block; }
.menu-item {
  padding: 7px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--mtl-text-2);
  cursor: pointer;
  user-select: none;
}
.menu-item:hover { background: var(--mtl-bg-soft); color: var(--mtl-text-1); }
.menu-item.danger { color: var(--mtl-danger); }
.menu-item.danger:hover { background: var(--mtl-danger-bg); }
.menu-divider { height: 1px; background: var(--mtl-border); margin: 4px 0; }
</style>
