<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="score-inline">
    <!-- Loading skeleton -->
    <div v-if="loading" class="sip-skeleton">
      <div class="sk-line sk-line-big"></div>
      <div class="sk-line sk-line-small"></div>
      <div class="sk-rows">
        <div class="sk-row"></div>
        <div class="sk-row"></div>
        <div class="sk-row"></div>
        <div class="sk-row"></div>
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

      <!-- 4 chiều — vertical full-width rows (mỗi row icon + label + bar + value) -->
      <div class="sip-dims">
        <div class="sip-dim eng" :title="`Tương tác: ${Math.round(data.engagement)}/100`">
          <span class="sip-dim-icon">🗨️</span>
          <span class="sip-dim-label">Tương tác</span>
          <span class="sip-dim-bar"><span :style="{ width: data.engagement + '%' }"></span></span>
          <span class="sip-dim-val">{{ Math.round(data.engagement) }}</span>
        </div>
        <div class="sip-dim int" :title="`Ý định mua: ${Math.round(data.intent)}/100`">
          <span class="sip-dim-icon">🎯</span>
          <span class="sip-dim-label">Ý định mua</span>
          <span class="sip-dim-bar"><span :style="{ width: data.intent + '%' }"></span></span>
          <span class="sip-dim-val">{{ Math.round(data.intent) }}</span>
        </div>
        <div class="sip-dim fit" :title="`Phù hợp: ${Math.round(data.fit)}/100`">
          <span class="sip-dim-icon">🧭</span>
          <span class="sip-dim-label">Phù hợp</span>
          <span class="sip-dim-bar"><span :style="{ width: data.fit + '%' }"></span></span>
          <span class="sip-dim-val">{{ Math.round(data.fit) }}</span>
        </div>
        <div class="sip-dim vel" :title="`Đà tăng nhiệt: ${Math.round(data.velocity)}/100`">
          <span class="sip-dim-icon">⚡</span>
          <span class="sip-dim-label">Đà tăng</span>
          <span class="sip-dim-bar"><span :style="{ width: data.velocity + '%' }"></span></span>
          <span class="sip-dim-val">{{ Math.round(data.velocity) }}</span>
        </div>
      </div>

      <!-- Signals: 3 gần nhất -->
      <div class="sip-signals">
        <div class="sip-signals-head">
          <span class="sip-signals-title">📜 Lịch sử ± gần nhất</span>
          <button
            v-if="(data.signals?.length ?? 0) > 10"
            class="sip-signals-expand"
            @click="$emit('view-history')"
          >
            Xem toàn bộ ({{ data.signals?.length }}) →
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

// 10 signals gần nhất theo appliedAt DESC (tab có space rộng, không cần modal cho 90% case)
const recentSignals = computed(() => {
  const list = data.value?.signals ?? [];
  return [...list]
    .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
    .slice(0, 10);
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

/* 4 chiều — vertical rows full-width (mỗi row 1 dòng) */
.sip-dims {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}
.sip-dim {
  display: grid;
  grid-template-columns: 22px 70px 1fr 28px;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  min-height: 26px;
}
.sip-dim-icon {
  font-size: 14px;
  text-align: center;
  line-height: 1;
}
.sip-dim-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--smax-grey-700, #3d4456);
  letter-spacing: 0.1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sip-dim-bar {
  height: 6px;
  background: var(--smax-grey-100, #eef0f4);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}
.sip-dim-bar > span {
  position: absolute;
  inset: 0;
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.sip-dim.eng .sip-dim-bar > span { background: linear-gradient(90deg, #60a5fa, #3b82f6); }
.sip-dim.int .sip-dim-bar > span { background: linear-gradient(90deg, #34d399, #10b981); }
.sip-dim.fit .sip-dim-bar > span { background: linear-gradient(90deg, #a78bfa, #8b5cf6); }
.sip-dim.vel .sip-dim-bar > span { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.sip-dim-val {
  font-size: 13px;
  font-weight: 700;
  color: var(--smax-grey-900, #1a1f2e);
  font-family: 'SF Mono', Monaco, monospace;
  text-align: right;
  line-height: 1;
}

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
.sk-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sk-row {
  height: 26px;
  background: linear-gradient(90deg, #eef0f4 0%, #f8f9fb 50%, #eef0f4 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
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
