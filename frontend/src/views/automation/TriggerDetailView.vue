<template>
  <div class="trig-detail">
    <div v-if="!data" class="loading">Đang tải...</div>
    <template v-else>
      <!-- Breadcrumb -->
      <div class="crumbs">
        <a @click="router.push('/marketing/triggers')">Marketing</a>
        <span class="sep">›</span>
        <a @click="router.push('/marketing/triggers')">Mục tiêu</a>
        <span class="sep">›</span>
        <span class="here">{{ data.trigger.name }}</span>
      </div>

      <!-- Header card -->
      <div class="header-card">
        <div class="header-row">
          <button class="back-btn" @click="router.push('/marketing/triggers')">← Quay lại</button>
          <div class="h-title-block">
            <div class="h-title">
              {{ data.trigger.name }}
              <span class="state-pill" :class="`state-${data.trigger.state}`">
                <span v-if="data.trigger.state === 'active'" class="running-dot"></span>
                {{ stateLabel(data.trigger.state) }}
              </span>
              <span v-if="data.trigger.successorSequence" class="step-badge">
                🧬 Luồng: {{ data.trigger.successorSequence.name }}
                <template v-if="data.trigger.successorSequence.stepsCount">
                  · {{ data.trigger.successorSequence.stepsCount }} bước
                </template>
              </span>
            </div>
            <div class="h-subtitle">
              <span>Nick: <b>{{ data.nicks.length }} nick</b>
                <template v-if="data.nicks.length">
                  — {{ data.nicks.map((n) => n.displayName ?? n.nickId.slice(0, 6)).join(', ') }}
                </template>
              </span>
              <span class="dot-sep">•</span>
              <span>Tạo: <b>{{ formatDate(data.trigger.createdAt) }}</b></span>
              <span class="dot-sep">•</span>
              <span>Cập nhật: <b>{{ formatTime(lastRefresh) }}</b></span>
            </div>
          </div>
          <button v-if="data.trigger.state === 'active'" class="btn btn-warn" @click="pause">⏸️ Tạm dừng</button>
          <button v-if="data.trigger.state === 'paused'" class="btn btn-warn" @click="resume">▶ Tiếp tục</button>
          <button
            v-if="data.trigger.state !== 'cancelled' && data.trigger.state !== 'completed'"
            class="btn btn-danger"
            @click="cancel"
          >
            ✕ Huỷ mục tiêu
          </button>
          <button class="btn btn-ghost" @click="exportCsv">Export CSV</button>
        </div>
      </div>

      <!-- Overview cells: 4 cell -->
      <div class="overview">
        <div class="ov-cell">
          <div class="ov-label">👥 Tổng pool</div>
          <div class="ov-value">{{ formatNum(data.counters.total) }}</div>
          <div class="ov-sub">khách trong tệp</div>
        </div>
        <div class="ov-cell">
          <div class="ov-label">🤝 Đã xử lý kết bạn</div>
          <div class="ov-value">{{ formatNum(processedPool) }}</div>
          <div class="ov-sub">{{ pct(processedPool, data.counters.total) }}% pool — còn {{ formatNum(remainingPool) }} chờ</div>
        </div>
        <div class="ov-cell">
          <div class="ov-label">✅ Đã thành bạn</div>
          <div class="ov-value">{{ formatNum(data.counters.accepted ?? acceptedFallback) }}</div>
          <div class="ov-sub">
            <span class="ov-rate">{{ pct(data.counters.accepted ?? acceptedFallback, data.counters.sent) }}%</span>
            trên số đã gửi
          </div>
        </div>
        <div class="ov-cell">
          <div class="ov-label">📺 Welcome / sequence</div>
          <div class="ov-value">{{ formatNum(data.counters.processed) }}</div>
          <div class="ov-sub">đang trong luồng chăm sóc</div>
        </div>
      </div>

      <!-- 8-counter grid (split 2 phase) -->
      <div class="phase-grid">
        <!-- Phase 1: Kết bạn -->
        <div class="phase">
          <div class="phase-head">
            <div class="phase-num p1">1</div>
            <div>
              <div class="phase-title">Phase 1 — Kết bạn</div>
              <div class="phase-sub">Gửi lời mời kết bạn từ pool</div>
            </div>
            <span class="phase-status" :class="phase1Running ? 'ps-running' : 'ps-waiting'">
              {{ phase1Running ? '⏱️ Đang gửi' : '⏸ Tạm ngưng' }}
            </span>
          </div>
          <div class="mini-grid">
            <div class="mini-cell green">
              <div class="lbl">Đã gửi KB</div>
              <div class="val">{{ formatNum(data.counters.sent) }}</div>
            </div>
            <div class="mini-cell green">
              <div class="lbl">Đồng ý</div>
              <div class="val">{{ formatNum(data.counters.accepted ?? acceptedFallback) }}</div>
            </div>
            <div class="mini-cell amber">
              <div class="lbl">Từ chối / Skip</div>
              <div class="val">{{ formatNum(data.counters.skipped_friend_cap + data.counters.skipped_recency) }}</div>
            </div>
            <div class="mini-cell coral">
              <div class="lbl">Failed</div>
              <div class="val">{{ formatNum(data.counters.failed_permanent + data.counters.failed_stuck) }}</div>
            </div>
          </div>
        </div>

        <!-- Phase 2: Bám đuổi -->
        <div class="phase">
          <div class="phase-head">
            <div class="phase-num p2">2</div>
            <div>
              <div class="phase-title">
                Phase 2 — Bám đuổi
                <template v-if="sequenceStepsCount">({{ sequenceStepsCount }} bước)</template>
              </div>
              <div class="phase-sub">Khách đã thành bạn × luồng chăm sóc</div>
            </div>
            <span class="phase-status ps-running">🚀 Đang chạy</span>
          </div>
          <div class="mini-grid">
            <div class="mini-cell now">
              <div class="lbl">Đang bám đuổi</div>
              <div class="val">{{ formatNum(inSequenceCount) }}</div>
            </div>
            <div class="mini-cell hot">
              <div class="lbl">Hoàn tất {{ sequenceStepsCount }}/{{ sequenceStepsCount }}</div>
              <div class="val">{{ formatNum(completedSequenceCount) }}</div>
            </div>
            <div class="mini-cell coral">
              <div class="lbl">Lỗi</div>
              <div class="val">{{ formatNum(data.counters.failed_permanent) }}</div>
            </div>
            <div class="mini-cell">
              <div class="lbl">Tin gửi</div>
              <div class="val">{{ formatNum(data.counters.sent) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Nick capacity table -->
      <div class="section-title">
        <h3>📱 Nick chạy</h3>
        <span class="hint">{{ data.nicks.length }} nick — phân chia tải tự động</span>
      </div>
      <div class="nick-tbl">
        <table>
          <thead>
            <tr>
              <th>Nick</th>
              <th>Trạng thái</th>
              <th>Worker</th>
              <th>Đã gửi hôm nay</th>
              <th>Quota friend / ngày</th>
              <th>Tổng đã gửi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in data.nicks" :key="n.nickId">
              <td>
                <div class="nick-name-cell">
                  <div class="nick-av" :class="nickAvClass(n.nickId)">
                    {{ nickInitials(n.displayName, n.nickId) }}
                  </div>
                  <div>
                    <div class="nick-name">{{ n.displayName ?? n.nickId.slice(0, 8) }}</div>
                    <div class="nick-uid">{{ n.nickId.slice(0, 12) }}…</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="nick-state" :class="n.status === 'connected' ? 'ns-running' : 'ns-cooldown'">
                  <span v-if="n.status === 'connected'" class="running-dot"></span>
                  {{ n.status === 'connected' ? 'Online' : n.status }}
                </span>
              </td>
              <td>
                <span class="worker-pill" :class="n.workerRunning ? 'wp-on' : 'wp-off'">
                  {{ n.workerRunning ? 'Active' : 'Off' }}{{ n.workerBusy ? ' (busy)' : '' }}
                </span>
              </td>
              <td><b>{{ n.sentToday }}</b> tin</td>
              <td>
                <div class="cap-wrap">
                  <div class="cap-bar" :class="capBarClass(n.sentToday, n.dailyFriendAddCap)">
                    <span :style="{ width: capPct(n.sentToday, n.dailyFriendAddCap) + '%' }"></span>
                  </div>
                  <span class="cap-txt">{{ n.sentToday }} / {{ n.dailyFriendAddCap }}</span>
                </div>
              </td>
              <td><b>{{ formatNum(n.sentTotal) }}</b> tin</td>
            </tr>
            <tr v-if="!data.nicks.length">
              <td colspan="6" class="empty-row">Chưa có nick nào gắn vào mục tiêu</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Filter bar -->
      <div class="filterbar">
        <div class="search">
          <span class="search-icon">🔍</span>
          <input v-model="searchInput" placeholder="Tìm tên hoặc số điện thoại khách..." />
        </div>
        <div class="chip-row">
          <span class="chip" :class="{ active: filter === 'all' }" @click="filter = 'all'">
            Tất cả <span class="count">{{ formatNum(data.counters.total) }}</span>
          </span>
          <span class="chip-sep"></span>
          <span class="chip" :class="{ active: filter === 'friend' }" @click="filter = 'friend'">
            ✅ Đã kết bạn <span class="count">{{ formatNum(data.counters.accepted ?? acceptedFallback) }}</span>
          </span>
          <span class="chip" :class="{ active: filter === 'sending' }" @click="filter = 'sending'">
            🤝 Đang gửi <span class="count">{{ formatNum(data.counters.processing) }}</span>
          </span>
          <span class="chip" :class="{ active: filter === 'failed' }" @click="filter = 'failed'">
            ⚠️ Failed <span class="count">{{ formatNum(data.counters.failed_permanent + data.counters.failed_stuck) }}</span>
          </span>
          <span class="chip" :class="{ active: filter === 'nozalo' }" @click="filter = 'nozalo'">
            🚫 No-Zalo <span class="count">{{ formatNum(data.counters.skipped_no_zalo) }}</span>
          </span>
        </div>
        <button class="reload-btn" @click="load">↻ Tải lại</button>
      </div>

      <!-- Entries table -->
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Khách hàng</th>
              <th>Điện thoại</th>
              <th>Nick PIN</th>
              <th>Trạng thái</th>
              <th>Bước hiện tại / Tổng</th>
              <th class="act"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in filteredEntries" :key="e.id">
              <td class="num">{{ e.rowIndex ?? i + 1 }}</td>
              <td>
                <div class="kh-cell">
                  <div class="avatar" :class="`a${(e.rowIndex ?? i) % 8 + 1}`">
                    {{ initialsFromName(e.displayName ?? e.phone) }}
                  </div>
                  <div>
                    <div class="kh-name">{{ e.displayName ?? '(chưa có tên Zalo)' }}</div>
                    <div class="kh-sub">
                      <span class="dedup-chip" :class="e.dedup === 'merged' ? 'dedup-merged' : 'dedup-new'">
                        {{ e.dedup === 'merged' ? '🔗 Gộp KH cũ' : '✨ KH mới' }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="phone">{{ e.phone }}</td>
              <td>
                <span v-if="e.nickId" class="nick-chip" :class="nickChipClass(e.nickId)">
                  📌 {{ e.nickName ?? e.nickId.slice(0, 6) }}
                </span>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span class="status-chip" :class="statusChipClass(e.queueStatus, e.hasZalo)">
                  {{ statusChipLabel(e.queueStatus, e.hasZalo) }}
                </span>
              </td>
              <td>
                <div class="step-cell">
                  <span class="step-txt">{{ stepText(e) }}</span>
                  <span class="dots">
                    <span
                      v-for="(d, k) in stepDots(e)"
                      :key="k"
                      class="dot"
                      :class="d"
                    ></span>
                  </span>
                </div>
              </td>
              <td style="text-align: right">
                <button class="row-act" @click="openMenu(e.id, $event)">⋯</button>
              </td>
            </tr>
            <tr v-if="!filteredEntries.length">
              <td colspan="7" class="empty-row">Chưa có khách nào khớp bộ lọc</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination footer -->
      <div class="tbl-foot">
        <div>
          Hiển thị <b>{{ data.entriesOffset + 1 }}–{{ Math.min(data.entriesOffset + data.entries.length, data.entriesTotal) }}</b>
          / <b>{{ formatNum(data.entriesTotal) }}</b> khách
        </div>
        <div class="pager">
          <button class="pg-btn" :class="{ disabled: data.entriesOffset === 0 }" @click="prevPage">‹</button>
          <button class="pg-btn active">{{ currentPage }}</button>
          <button class="pg-btn" :class="{ disabled: !hasNextPage }" @click="nextPage">›</button>
        </div>
      </div>

      <div class="footer-info">🔄 Auto refresh mỗi 5 giây · Cập nhật lúc {{ formatTime(lastRefresh) }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const route = useRoute();
const router = useRouter();
const triggerId = route.params.id as string;

interface NickStat {
  nickId: string;
  displayName: string | null;
  status: string;
  dailyFriendAddCap: number;
  sentToday: number;
  sentTotal: number;
  workerRunning: boolean;
  workerBusy: boolean;
}

interface Entry {
  id: string;
  rowIndex: number;
  displayName: string | null;
  phone: string;
  nickId: string | null;
  nickName: string | null;
  queueStatus: string | null;
  hasZalo: boolean | null;
  dedup: 'merged' | 'new';
  currentStepIdx: number | null;
  taskStatus: string | null;
}

interface DashboardData {
  trigger: {
    id: string;
    name: string;
    state: string;
    greetingTemplate: string;
    welcomeMessageTemplate: string | null;
    successorSequence: { id: string; name: string; stepsCount: number } | null;
    createdAt: string;
  };
  counters: Record<string, number>;
  nicks: NickStat[];
  entries: Entry[];
  entriesTotal: number;
  entriesOffset: number;
  entriesLimit: number;
}

const data = ref<DashboardData | null>(null);
const lastRefresh = ref(new Date());
const searchInput = ref('');
const filter = ref<'all' | 'friend' | 'sending' | 'failed' | 'nozalo'>('all');
const page = ref(1);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const sequenceStepsCount = computed(() => data.value?.trigger.successorSequence?.stepsCount ?? 0);

const processedPool = computed(() => {
  const c = data.value?.counters ?? {};
  return (
    (c.processed ?? 0) +
    (c.skipped_friend_cap ?? 0) +
    (c.skipped_recency ?? 0) +
    (c.skipped_status ?? 0) +
    (c.skipped_no_zalo ?? 0) +
    (c.failed_permanent ?? 0) +
    (c.failed_stuck ?? 0)
  );
});
const remainingPool = computed(() => Math.max(0, (data.value?.counters.total ?? 0) - processedPool.value));
const acceptedFallback = computed(() => data.value?.counters.processed ?? 0);
const phase1Running = computed(() => data.value?.trigger.state === 'active');

const inSequenceCount = computed(() => {
  const entries = data.value?.entries ?? [];
  return entries.filter((e) => e.taskStatus && e.taskStatus !== 'completed' && e.taskStatus !== 'cancelled').length;
});
const completedSequenceCount = computed(() => {
  const entries = data.value?.entries ?? [];
  return entries.filter((e) => e.taskStatus === 'completed').length;
});

const filteredEntries = computed(() => {
  let list = data.value?.entries ?? [];
  if (searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    list = list.filter(
      (e) => (e.displayName ?? '').toLowerCase().includes(q) || e.phone.includes(q),
    );
  }
  switch (filter.value) {
    case 'friend':
      return list.filter((e) => e.queueStatus === 'processed' && e.hasZalo === true);
    case 'sending':
      return list.filter((e) => e.queueStatus === 'processing');
    case 'failed':
      return list.filter((e) => e.queueStatus === 'failed_permanent' || e.queueStatus === 'failed_stuck');
    case 'nozalo':
      return list.filter((e) => e.hasZalo === false || e.queueStatus === 'skipped_no_zalo');
    default:
      return list;
  }
});

const currentPage = computed(() => Math.floor((data.value?.entriesOffset ?? 0) / (data.value?.entriesLimit ?? 50)) + 1);
const hasNextPage = computed(() => {
  if (!data.value) return false;
  return data.value.entriesOffset + data.value.entries.length < data.value.entriesTotal;
});

async function load() {
  try {
    const limit = data.value?.entriesLimit ?? 50;
    const offset = (page.value - 1) * limit;
    const r = await api.get(`/automation/triggers/${triggerId}/dashboard`, {
      params: { limit, offset },
    });
    data.value = r.data;
    lastRefresh.value = new Date();
  } catch (err) {
    console.error('[trig-detail] load failed', err);
  }
}

async function pause() {
  if (!confirm('Tạm dừng Mục tiêu này? Worker sẽ dừng.')) return;
  await api.post(`/automation/triggers/${triggerId}/pause`);
  await load();
}
async function resume() {
  await api.post(`/automation/triggers/${triggerId}/resume`);
  await load();
}
async function cancel() {
  if (!confirm('Huỷ Mục tiêu? Các KH chưa gửi sẽ bị bỏ. KHÔNG quay lại được.')) return;
  await api.post(`/automation/triggers/${triggerId}/cancel`);
  await load();
}
function exportCsv() {
  alert('Export CSV — sắp tới.');
}
function prevPage() {
  if (page.value > 1) {
    page.value--;
    void load();
  }
}
function nextPage() {
  if (hasNextPage.value) {
    page.value++;
    void load();
  }
}
function openMenu(_id: string, _ev: MouseEvent) {
  // TODO: row action menu — placeholder
}

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    draft: '📝 Nháp',
    active: 'Đang chạy',
    paused: '⏸ Tạm dừng',
    cancelling: '⏳ Đang huỷ',
    cancelled: '❌ Đã huỷ',
    completed: '✅ Hoàn tất',
  };
  return map[state] ?? state;
}

function formatNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString('vi-VN');
}
function pct(num: number | undefined | null, denom: number | undefined | null): string {
  const a = num ?? 0;
  const b = denom ?? 0;
  if (!b) return '0';
  return ((a / b) * 100).toFixed(1);
}
function capPct(sent: number, cap: number): number {
  if (!cap) return 0;
  return Math.min(100, Math.round((sent / cap) * 100));
}
function capBarClass(sent: number, cap: number): string {
  const p = capPct(sent, cap);
  if (p >= 90) return 'danger';
  if (p >= 70) return 'warn';
  return '';
}
function nickInitials(name: string | null, id: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[parts.length - 1]?.[0] ?? parts[0]?.[0] ?? id[0]).toUpperCase();
  }
  return id.slice(0, 2).toUpperCase();
}
function nickAvClass(nickId: string): string {
  // Stable colour pick from id hash so each nick gets consistent colour
  let h = 0;
  for (let i = 0; i < nickId.length; i++) h = (h * 31 + nickId.charCodeAt(i)) & 0xff;
  return `nav-${(h % 2 === 0) ? 'p' : 'h'}`;
}
function nickChipClass(nickId: string): string {
  let h = 0;
  for (let i = 0; i < nickId.length; i++) h = (h * 31 + nickId.charCodeAt(i)) & 0xff;
  return h % 2 === 0 ? 'nick-pham' : 'nick-hs';
}
function initialsFromName(s: string | null): string {
  if (!s) return '?';
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1];
  return (last[0] ?? '?').toUpperCase() + (parts.length > 1 ? (parts[0][0] ?? '').toUpperCase() : '');
}

function statusChipClass(qs: string | null, hasZalo: boolean | null): string {
  if (qs === 'processing') return 'st-sending';
  if (qs === 'processed' && hasZalo === true) return 'st-friend';
  if (qs === 'skipped_no_zalo' || hasZalo === false) return 'st-nozalo';
  if (qs === 'failed_permanent' || qs === 'failed_stuck') return 'st-failed';
  if (qs === 'cancelled') return 'st-paused';
  if (qs === 'queued_for_pickup') return 'st-queued';
  return 'st-queued';
}
function statusChipLabel(qs: string | null, hasZalo: boolean | null): string {
  if (qs === 'processing') return '🤝 Đang gửi kết bạn';
  if (qs === 'processed' && hasZalo === true) return '✅ Đã kết bạn';
  if (qs === 'skipped_no_zalo' || hasZalo === false) return '🚫 Không có Zalo';
  if (qs === 'failed_permanent') return '⚠️ Failed';
  if (qs === 'failed_stuck') return '⚠️ Stuck';
  if (qs === 'cancelled') return '⏸️ Huỷ';
  if (qs === 'queued_for_pickup') return '⏳ Chờ xử lý';
  if (qs === 'skipped_friend_cap') return '⛔ Skip cap';
  if (qs === 'skipped_recency') return '⛔ Skip recency';
  return qs ?? '—';
}

function stepText(e: Entry): string {
  const total = sequenceStepsCount.value;
  if (e.currentStepIdx === null) {
    if (e.queueStatus === 'skipped_no_zalo' || e.hasZalo === false) return '—';
    return total ? `0/${total}` : '—';
  }
  return total ? `${e.currentStepIdx + 1}/${total}` : `${e.currentStepIdx + 1}`;
}
function stepDots(e: Entry): string[] {
  const total = sequenceStepsCount.value || 10;
  const cur = e.currentStepIdx;
  const skipped = e.queueStatus === 'skipped_no_zalo' || e.hasZalo === false || e.queueStatus === 'cancelled';
  const dots: string[] = [];
  for (let i = 0; i < total; i++) {
    if (skipped) dots.push('skip');
    else if (cur === null) dots.push('');
    else if (i < cur) dots.push('done');
    else if (i === cur) dots.push('cur');
    else dots.push('');
  }
  return dots;
}

function formatDate(iso: string): string {
  return formatInOrgTz(iso);
}
function formatTime(d: Date): string {
  return d.toLocaleTimeString('vi-VN');
}

onMounted(() => {
  void load();
  refreshTimer = setInterval(load, 5000);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.trig-detail {
  --bg: #f8fafc;
  --bg-alt: #f1f5f9;
  --surface: #ffffff;
  --border: #e2e8f0;
  --border-soft: #f1f5f9;
  --text: #0f172a;
  --text-mid: #1e293b;
  --text-soft: #475569;
  --text-mute: #64748b;
  --text-faint: #94a3b8;
  --blue: #3b82f6;
  --blue-strong: #2563eb;
  --green: #10b981;
  --green-text: #15803d;
  --amber: #f59e0b;
  --amber-text: #92400e;
  --red: #ef4444;
  --red-text: #b91c1c;
  --violet: #8b5cf6;
  --violet-text: #6d28d9;
  --teal-text: #0f766e;

  background: var(--bg);
  color: var(--text-mid);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  padding-bottom: 64px;
  min-height: 100vh;
}
.loading { text-align: center; padding: 80px; color: var(--text-mute); }

/* Breadcrumb */
.crumbs {
  display: flex; align-items: center; gap: 6px;
  padding: 14px 24px 8px;
  font-size: 12.5px; color: var(--text-mute);
}
.crumbs a { color: var(--text-soft); cursor: pointer; }
.crumbs a:hover { color: var(--blue-strong); }
.crumbs .sep { color: #cbd5e1; }
.crumbs .here { color: var(--text); font-weight: 600; }

/* Header card */
.header-card {
  background: #fff; border: 1px solid var(--border); border-radius: 12px;
  margin: 0 24px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.header-row { display: flex; align-items: center; gap: 12px; padding: 16px 20px; }
.back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; background: #fff;
  border: 1px solid var(--border); border-radius: 8px;
  color: var(--text-soft); font-size: 13px; font-weight: 500;
  cursor: pointer;
}
.back-btn:hover { background: var(--bg-alt); color: var(--text); }
.h-title-block { flex: 1; min-width: 0; }
.h-title {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-size: 18px; font-weight: 700; color: var(--text);
}
.state-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
.state-active { background: #dcfce7; color: var(--green-text); }
.state-paused { background: #fef3c7; color: var(--amber-text); }
.state-draft { background: #f1f5f9; color: var(--text-soft); }
.state-cancelled { background: #fee2e2; color: var(--red-text); }
.state-completed { background: #ede9fe; color: var(--violet-text); }
.running-dot {
  width: 7px; height: 7px; background: #16a34a; border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.6);
  animation: pulse 1.6s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.55); }
  70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}
.step-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: #ede9fe; color: var(--violet-text);
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
.h-subtitle {
  margin-top: 6px;
  color: var(--text-mute); font-size: 12.5px;
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
}
.h-subtitle b { color: var(--text-mid); font-weight: 600; }
.dot-sep { color: #cbd5e1; }
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  border: 1px solid transparent;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.btn-warn { background: #fef3c7; color: var(--amber-text); border-color: #fde68a; }
.btn-warn:hover { background: #fde68a; }
.btn-danger { background: #fff; color: var(--red-text); border-color: #fecaca; }
.btn-danger:hover { background: #fef2f2; }
.btn-ghost { background: #fff; color: var(--text-soft); border-color: var(--border); }
.btn-ghost:hover { background: var(--bg-alt); }

/* Overview */
.overview {
  margin: 16px 24px 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.ov-cell { display: flex; flex-direction: column; gap: 3px; }
.ov-label { font-size: 11.5px; color: var(--text-mute); font-weight: 500; display: flex; align-items: center; gap: 6px; }
.ov-value { font-size: 22px; font-weight: 700; color: var(--text); }
.ov-sub { font-size: 11.5px; color: var(--text-faint); }
.ov-rate { color: var(--green-text); font-weight: 600; }

/* Phase */
.phase-grid { margin: 16px 24px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.phase { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.phase-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.phase-num { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
.phase-num.p1 { background: #fef3c7; color: var(--amber-text); }
.phase-num.p2 { background: #dbeafe; color: #1d4ed8; }
.phase-title { font-size: 14px; font-weight: 700; color: var(--text); }
.phase-sub { font-size: 12px; color: var(--text-mute); }
.phase-status { margin-left: auto; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
.ps-running { background: #dcfce7; color: var(--green-text); }
.ps-waiting { background: #f1f5f9; color: var(--text-soft); }
.mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mini-cell { padding: 10px 12px; background: var(--bg); border: 1px solid var(--border-soft); border-radius: 10px; }
.mini-cell .lbl { font-size: 11px; color: var(--text-mute); font-weight: 500; }
.mini-cell .val { font-size: 18px; font-weight: 700; color: var(--text); margin-top: 2px; }
.mini-cell.hot { background: #ecfdf5; border-color: #a7f3d0; }
.mini-cell.hot .val { color: var(--green-text); }
.mini-cell.now { background: #eff6ff; border-color: #bfdbfe; }
.mini-cell.now .val { color: #1d4ed8; }
.mini-cell.green .val { color: var(--green-text); }
.mini-cell.amber .val { color: var(--amber-text); }
.mini-cell.coral .val { color: var(--red-text); }

/* Section heading */
.section-title { margin: 22px 24px 10px; display: flex; align-items: center; gap: 10px; }
.section-title h3 { font-size: 14px; font-weight: 700; color: var(--text); }
.section-title .hint { font-size: 12px; color: var(--text-mute); }

/* Nick table */
.nick-tbl { margin: 0 24px; background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.nick-tbl table { width: 100%; border-collapse: collapse; }
.nick-tbl thead th {
  background: var(--bg); color: var(--text-mute);
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  text-align: left; padding: 9px 14px;
  border-bottom: 1px solid var(--border);
}
.nick-tbl tbody td { padding: 11px 14px; font-size: 13px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
.nick-tbl tbody tr:last-child td { border-bottom: 0; }
.nick-name-cell { display: flex; align-items: center; gap: 10px; }
.nick-av { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 11.5px; }
.nav-p { background: #8b5cf6; }
.nav-h { background: #14b8a6; }
.nick-name { font-weight: 600; color: var(--text); }
.nick-uid { font-size: 11.5px; color: var(--text-faint); }
.cap-wrap { display: flex; align-items: center; gap: 8px; }
.cap-bar { height: 6px; background: var(--bg-alt); border-radius: 999px; overflow: hidden; width: 120px; }
.cap-bar > span { display: block; height: 100%; background: var(--blue); border-radius: 999px; }
.cap-bar.warn > span { background: var(--amber); }
.cap-bar.danger > span { background: var(--red); }
.cap-txt { font-size: 12px; color: var(--text-soft); }
.nick-state {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600;
}
.ns-running { background: #dcfce7; color: var(--green-text); }
.ns-cooldown { background: #fef3c7; color: var(--amber-text); }
.worker-pill { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
.wp-on { background: #dcfce7; color: var(--green-text); }
.wp-off { background: #fee2e2; color: var(--red-text); }
.empty-row { text-align: center; padding: 28px !important; color: var(--text-faint); font-style: italic; }

/* Filter bar */
.filterbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 16px 24px 10px;
}
.search {
  flex: 1; max-width: 320px;
  display: flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid var(--border);
  border-radius: 8px; padding: 7px 12px;
}
.search input { flex: 1; border: 0; outline: 0; background: transparent; font-size: 13px; color: var(--text-mid); }
.search-icon { color: var(--text-faint); font-size: 14px; }
.chip-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px;
  background: #fff; border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px; font-weight: 500; color: var(--text-soft);
  cursor: pointer;
}
.chip:hover { background: var(--bg-alt); }
.chip.active { background: #eff6ff; border-color: #bfdbfe; color: var(--blue-strong); font-weight: 600; }
.chip .count { font-size: 10.5px; background: rgba(15,23,42,0.06); padding: 1px 6px; border-radius: 999px; color: var(--text-soft); }
.chip.active .count { background: #bfdbfe; color: var(--blue-strong); }
.chip-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
.reload-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; background: #fff;
  border: 1px solid var(--border); border-radius: 8px;
  color: var(--text-soft); font-size: 13px; font-weight: 500; cursor: pointer;
}
.reload-btn:hover { background: var(--bg-alt); }

/* Entries table */
.tbl-wrap { margin: 0 24px; background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.tbl-wrap table { width: 100%; border-collapse: collapse; }
.tbl-wrap thead th {
  background: var(--bg); color: var(--text-mute);
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  text-align: left; padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.tbl-wrap thead th.num { text-align: center; width: 40px; }
.tbl-wrap thead th.act { text-align: right; width: 56px; }
.tbl-wrap tbody tr { border-bottom: 1px solid var(--border-soft); transition: background 0.08s ease; }
.tbl-wrap tbody tr:last-child { border-bottom: 0; }
.tbl-wrap tbody tr:hover { background: var(--bg); }
.tbl-wrap tbody td { padding: 11px 12px; font-size: 13px; color: var(--text-mid); vertical-align: middle; }
td.num { text-align: center; color: var(--text-faint); font-weight: 500; }
.kh-cell { display: flex; align-items: center; gap: 10px; }
.avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 600; color: #fff; flex-shrink: 0; }
.a1 { background: #f472b6; } .a2 { background: #60a5fa; } .a3 { background: #34d399; } .a4 { background: #fbbf24; }
.a5 { background: #a78bfa; } .a6 { background: #fb7185; } .a7 { background: #38bdf8; } .a8 { background: #f97316; }
.kh-name { font-weight: 600; color: var(--text); }
.kh-sub { font-size: 11px; color: var(--text-faint); margin-top: 1px; }
.phone { color: var(--text-soft); font-size: 12.5px; }
.muted { color: var(--text-faint); font-size: 12px; }
.dedup-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 10.5px; font-weight: 600; border-radius: 999px; background: #f1f5f9; color: var(--text-soft); }
.dedup-merged { background: #ede9fe; color: var(--violet-text); }
.dedup-new { background: #ecfdf5; color: #047857; }
.nick-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; border: 1px solid transparent; }
.nick-pham { background: #ede9fe; color: var(--violet-text); border-color: #ddd6fe; }
.nick-hs { background: #ccfbf1; color: var(--teal-text); border-color: #99f6e4; }
.status-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; border: 1px solid transparent; }
.st-queued { background: #f1f5f9; color: var(--text-soft); border-color: #e2e8f0; }
.st-sending { background: #fef3c7; color: var(--amber-text); border-color: #fde68a; }
.st-friend { background: #dcfce7; color: var(--green-text); border-color: #bbf7d0; }
.st-rejected { background: #fee2e2; color: var(--red-text); border-color: #fecaca; }
.st-failed { background: #ffedd5; color: #9a3412; border-color: #fed7aa; }
.st-nozalo { background: #e2e8f0; color: var(--text-mute); border-color: #cbd5e1; }
.st-followup { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
.st-done { background: #ede9fe; color: var(--violet-text); border-color: #ddd6fe; }
.st-paused { background: #fef3c7; color: var(--amber-text); border-color: #fde68a; }
.step-cell { display: flex; align-items: center; gap: 8px; min-width: 200px; }
.step-txt { font-weight: 700; color: var(--text); min-width: 40px; font-size: 12.5px; }
.dots { display: inline-flex; gap: 2.5px; flex-wrap: wrap; max-width: 220px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border); flex-shrink: 0; }
.dot.done { background: #10b981; }
.dot.cur { background: var(--blue); box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25); }
.dot.skip { background: var(--border-soft); border: 1px dashed #cbd5e1; }
.row-act {
  width: 30px; height: 30px;
  border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--text-mute);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 16px;
}
tr:hover .row-act { border-color: var(--border); background: #fff; }
.row-act:hover { background: var(--bg-alt) !important; color: var(--text); }

/* Pagination */
.tbl-foot { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px 0; font-size: 12.5px; color: var(--text-mute); }
.pager { display: flex; gap: 4px; align-items: center; }
.pg-btn {
  min-width: 28px; height: 28px; padding: 0 8px;
  border-radius: 6px; border: 1px solid var(--border);
  background: #fff; color: var(--text-soft);
  font-size: 12.5px; font-weight: 500; cursor: pointer;
}
.pg-btn:hover { background: var(--bg-alt); }
.pg-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 600; }
.pg-btn.disabled { color: var(--text-faint); cursor: not-allowed; }

.footer-info { text-align: center; font-size: 11px; color: var(--text-mute); padding: 16px; }
</style>
