<template>
  <div class="score-inline">
    <!-- Loading skeleton -->
    <div v-if="loading" class="sip-skeleton">
      <div class="sk-line sk-line-big"></div>
      <div class="sk-line sk-line-small"></div>
      <div class="sk-grid">
        <div class="sk-cell"></div><div class="sk-cell"></div>
        <div class="sk-cell"></div><div class="sk-cell"></div>
      </div>
      <div class="sk-line sk-line-tiny"></div>
      <div class="sk-line sk-line-tiny"></div>
      <div class="sk-line sk-line-tiny"></div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!data" class="sip-empty">
      <span class="sip-empty-icon">📊</span>
      <p>Chưa có dữ liệu điểm</p>
      <small>Hệ thống sẽ tự chấm khi có tương tác</small>
    </div>

    <!-- Loaded -->
    <template v-else>
      <!-- Total score line -->
      <div class="sip-total-line">
        <span class="sip-num">{{ data.finalScore }}</span>
        <span class="sip-max">/ 100</span>
        <span v-if="stageLabel" class="sip-stage-tag">{{ stageLabel }}</span>
        <span v-if="trendDelta !== null" class="sip-trend" :class="trendDelta >= 0 ? 'pos' : 'neg'">
          {{ trendDelta >= 0 ? '▲' : '▼' }} {{ trendDelta >= 0 ? '+' : '' }}{{ trendDelta }} / 7d
        </span>
      </div>
      <div v-if="data.computedAt" class="sip-meta">
        Cập nhật {{ relativeTime(data.computedAt) }}
      </div>

      <!-- 2x2 grid 4 chiều -->
      <div class="sip-grid">
        <div class="sip-cell eng" :title="`Tương tác: ${Math.round(data.engagement)}/100`">
          <div class="sip-cell-icon">🗨️</div>
          <div class="sip-cell-body">
            <span class="sip-cell-label">Tương tác</span>
            <span class="sip-cell-val">{{ Math.round(data.engagement) }}<span class="sip-cell-bar" :style="{ '--w': data.engagement + '%' }"></span></span>
          </div>
        </div>
        <div class="sip-cell int" :title="`Ý định: ${Math.round(data.intent)}/100`">
          <div class="sip-cell-icon">🎯</div>
          <div class="sip-cell-body">
            <span class="sip-cell-label">Ý định</span>
            <span class="sip-cell-val">{{ Math.round(data.intent) }}<span class="sip-cell-bar" :style="{ '--w': data.intent + '%' }"></span></span>
          </div>
        </div>
        <div class="sip-cell fit" :title="`Phù hợp: ${Math.round(data.fit)}/100`">
          <div class="sip-cell-icon">🧭</div>
          <div class="sip-cell-body">
            <span class="sip-cell-label">Phù hợp</span>
            <span class="sip-cell-val">{{ Math.round(data.fit) }}<span class="sip-cell-bar" :style="{ '--w': data.fit + '%' }"></span></span>
          </div>
        </div>
        <div class="sip-cell vel" :title="`Đà tăng: ${Math.round(data.velocity)}/100`">
          <div class="sip-cell-icon">⚡</div>
          <div class="sip-cell-body">
            <span class="sip-cell-label">Đà tăng</span>
            <span class="sip-cell-val">{{ Math.round(data.velocity) }}<span class="sip-cell-bar" :style="{ '--w': data.velocity + '%' }"></span></span>
          </div>
        </div>
      </div>

      <!-- Signals: 3 gần nhất -->
      <div class="sip-signals">
        <div class="sip-signals-head">
          <span class="sip-signals-title">📜 Lịch sử ± gần nhất</span>
          <button
            v-if="(data.signals?.length ?? 0) > 3"
            class="sip-signals-expand"
            @click="$emit('view-history')"
          >
            Xem thêm →
          </button>
        </div>
        <div v-if="recentSignals.length === 0" class="sip-signals-empty">
          Chưa có sự kiện chấm điểm nào.
        </div>
        <div
          v-for="(s, i) in recentSignals"
          :key="i"
          class="sip-signal-row"
        >
          <span class="sip-signal-icon" :class="s.delta >= 0 ? 'pos' : 'neg'">
            {{ s.delta >= 0 ? '▲' : '▼' }}
          </span>
          <span class="sip-signal-label" :title="s.label">{{ s.label }}</span>
          <span class="sip-signal-delta" :class="s.delta >= 0 ? 'pos' : 'neg'">
            {{ s.delta >= 0 ? '+' : '' }}{{ s.delta }}
          </span>
          <span class="sip-signal-time">{{ relativeTime(s.appliedAt) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useScoring, type ScoreBreakdown } from '@/composables/use-scoring';

const props = defineProps<{
  friendId: string | null;
  /** Nhãn stage hiển thị bên cạnh điểm tổng (vd "warm-lead") */
  stageLabel?: string | null;
}>();

defineEmits<{
  'view-history': [];
}>();

const scoring = useScoring();
const data = ref<ScoreBreakdown | null>(null);
const loading = ref(false);

async function fetchBreakdown(id: string | null) {
  if (!id) {
    data.value = null;
    return;
  }
  loading.value = true;
  try {
    const res = await scoring.getScoreBreakdown(id);
    data.value = res?.scoreBreakdown ?? res ?? null;
  } catch (err) {
    console.warn('[ScoreInlinePanel] fetch failed', err);
    data.value = null;
  } finally {
    loading.value = false;
  }
}

watch(() => props.friendId, fetchBreakdown, { immediate: true });

// 3 signals gần nhất theo appliedAt DESC
const recentSignals = computed(() => {
  const list = data.value?.signals ?? [];
  return [...list]
    .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
    .slice(0, 3);
});

// Trend = tổng delta của signals trong 7 ngày
const trendDelta = computed<number | null>(() => {
  const list = data.value?.signals ?? [];
  if (list.length === 0) return null;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sum = list
    .filter(s => new Date(s.appliedAt).getTime() >= cutoff)
    .reduce((acc, s) => acc + s.delta, 0);
  return sum;
});

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}m`;
}
</script>

<style scoped>
.score-inline {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.sip-total-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.sip-num {
  font-size: 26px;
  font-weight: 800;
  color: var(--smax-grey-900, #1a1f2e);
  line-height: 1;
  letter-spacing: -0.5px;
}
.sip-max {
  font-size: 11px;
  font-weight: 500;
  color: var(--smax-grey-400, #a8aebb);
}
.sip-stage-tag {
  font-size: 9.5px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  padding: 2px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.sip-trend {
  font-size: 10px;
  font-weight: 700;
  margin-left: auto;
  padding: 2px 6px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.sip-trend.pos { color: #15803d; background: #dcfce7; }
.sip-trend.neg { color: #b91c1c; background: #fee2e2; }
.sip-meta {
  font-size: 10px;
  color: var(--smax-grey-400, #a8aebb);
  margin-top: -2px;
}

/* 2x2 grid */
.sip-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.sip-cell {
  background: var(--smax-grey-50, #f8f9fb);
  border: 1px solid var(--smax-grey-100, #eef0f4);
  border-radius: 8px;
  padding: 5px 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  min-width: 0;
}
.sip-cell-icon {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.sip-cell.eng .sip-cell-icon { background: #dbeafe; }
.sip-cell.int .sip-cell-icon { background: #d1fae5; }
.sip-cell.fit .sip-cell-icon { background: #ede9fe; }
.sip-cell.vel .sip-cell-icon { background: #fef3c7; }
.sip-cell-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.sip-cell-label {
  font-size: 9.5px;
  color: var(--smax-grey-600, #5a6478);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sip-cell-val {
  font-size: 13px;
  font-weight: 700;
  color: var(--smax-grey-900, #1a1f2e);
  line-height: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sip-cell-bar {
  display: inline-block;
  width: 26px;
  height: 3px;
  background: var(--smax-grey-200, #e1e4eb);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}
.sip-cell-bar::after {
  content: "";
  position: absolute;
  inset: 0;
  width: var(--w, 0%);
  border-radius: 2px;
}
.sip-cell.eng .sip-cell-bar::after { background: #3b82f6; }
.sip-cell.int .sip-cell-bar::after { background: #10b981; }
.sip-cell.fit .sip-cell-bar::after { background: #8b5cf6; }
.sip-cell.vel .sip-cell-bar::after { background: #f59e0b; }

/* Signals */
.sip-signals { margin-top: 2px; }
.sip-signals-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}
.sip-signals-title {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--smax-grey-600, #5a6478);
  font-weight: 600;
}
.sip-signals-expand {
  font-size: 10.5px;
  color: var(--smax-primary, #2962ff);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  font-weight: 600;
}
.sip-signals-expand:hover { text-decoration: underline; }
.sip-signals-empty {
  font-size: 11px;
  color: var(--smax-grey-400, #a8aebb);
  padding: 4px 2px;
  font-style: italic;
}
.sip-signal-row {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 11px;
  border-radius: 3px;
}
.sip-signal-icon { font-size: 9px; text-align: center; font-weight: 800; line-height: 1; }
.sip-signal-icon.pos { color: #16a34a; }
.sip-signal-icon.neg { color: #ef4444; }
.sip-signal-label {
  color: var(--smax-grey-700, #3d4456);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sip-signal-delta {
  font-size: 10px;
  font-weight: 700;
  font-family: 'SF Mono', Monaco, monospace;
}
.sip-signal-delta.pos { color: #16a34a; }
.sip-signal-delta.neg { color: #ef4444; }
.sip-signal-time {
  color: var(--smax-grey-400, #a8aebb);
  font-size: 9.5px;
  font-family: 'SF Mono', Monaco, monospace;
  min-width: 20px;
  text-align: right;
}

/* Loading skeleton */
.sip-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sk-line {
  background: linear-gradient(90deg, #eef0f4 0%, #f8f9fb 50%, #eef0f4 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 4px;
}
.sk-line-big { width: 50%; height: 20px; }
.sk-line-small { width: 70%; height: 10px; }
.sk-line-tiny { width: 100%; height: 14px; }
.sk-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.sk-cell {
  height: 34px;
  background: linear-gradient(90deg, #eef0f4 0%, #f8f9fb 50%, #eef0f4 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 8px;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Empty */
.sip-empty {
  text-align: center;
  padding: 12px 8px;
  color: var(--smax-grey-400, #a8aebb);
}
.sip-empty-icon { font-size: 24px; display: block; margin-bottom: 4px; }
.sip-empty p { font-size: 12px; margin: 0 0 2px; font-weight: 500; color: var(--smax-grey-600, #5a6478); }
.sip-empty small { font-size: 10px; }
</style>
