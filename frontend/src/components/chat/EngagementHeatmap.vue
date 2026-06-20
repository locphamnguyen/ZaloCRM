<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <section class="engagement-heatmap" :class="{ 'is-loading': loading }">
    <header class="eh-header">
      <h3 class="eh-title">
        <span class="eh-icon">📊</span>
        Engagement 4 tuần
      </h3>
      <span v-if="pattern" class="eh-pattern" :class="`pattern-${pattern}`">
        {{ patternLabel }}
      </span>
    </header>

    <div v-if="loading" class="eh-skeleton">
      <div class="sk-row" v-for="r in 4" :key="r">
        <div class="sk-cell" v-for="c in 7" :key="c"></div>
      </div>
    </div>

    <template v-else>
      <!-- Grid: 4 weeks × 7 days -->
      <div class="eh-grid" v-if="weekRows.length > 0">
        <div class="eh-day-header">
          <div class="eh-row-label"></div>
          <div v-for="d in DAY_LABELS" :key="d">{{ d }}</div>
        </div>
        <div v-for="(week, wIdx) in weekRows" :key="wIdx" class="eh-row">
          <div class="eh-row-label">{{ rowLabel(wIdx) }}</div>
          <div
            v-for="cell in week"
            :key="cell.date"
            class="eh-cell"
            :data-level="intensityLevel(cell.dailyIntensity)"
            :title="cellTooltip(cell)"
          ></div>
        </div>
      </div>

      <!-- Trend + score row -->
      <div class="eh-meta">
        <div class="eh-meta-item">
          <span class="meta-label">Xu hướng:</span>
          <span class="meta-value" :class="trendClass">
            {{ trendIcon }} {{ trendText }}
          </span>
        </div>
        <div class="eh-meta-item">
          <span class="meta-label">Điểm tuần này:</span>
          <span class="meta-value score">{{ score ?? '—' }}/100</span>
        </div>
      </div>

      <!-- Breakdown — 6 signal groups anh chốt 2026-05-21 -->
      <div class="eh-breakdown" v-if="breakdown">
        <div class="bd-item">
          <span class="bd-label">❤️ Thả tim</span>
          <span class="bd-val">{{ breakdown.totalReactions }} lần</span>
        </div>
        <div class="bd-item">
          <span class="bd-label">💬 Trả lời</span>
          <span class="bd-val">{{ breakdown.replyRate }}%</span>
        </div>
        <div class="bd-item">
          <span class="bd-label">📞 Cuộc gọi</span>
          <span class="bd-val">
            {{ breakdown.totalCalls ?? 0 }} lần<span
              v-if="(breakdown.totalMissedCalls ?? 0) > 0"
              class="bd-val-sub"
            > ({{ breakdown.totalMissedCalls }} nhỡ)</span>
          </span>
        </div>
        <div class="bd-item">
          <span class="bd-label">📎 Ảnh/file/video</span>
          <span class="bd-val">{{ breakdown.totalMedia }} lần</span>
        </div>
        <div class="bd-item">
          <span class="bd-label">⚡ KH chủ động</span>
          <span class="bd-val">{{ breakdown.daysInitiated }} ngày</span>
        </div>
        <div class="bd-item">
          <span class="bd-label">↩️ Reply</span>
          <span class="bd-val">{{ breakdown.totalQuoteReplies ?? 0 }} lần</span>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '@/api/index';
import { getOrgParts } from '@/composables/use-org-timezone';

const props = defineProps<{
  contactId: string;
}>();

interface TimelineCell {
  date: string;
  inboundMsgCount: number;
  outboundMsgCount: number;
  reactionCount: number;
  mediaShareCount: number;
  voiceMsgCount: number;
  callCount: number;
  missedCallCount: number;
  quoteReplyCount: number;
  customerInitiated: boolean;
  dailyIntensity: number;
}

interface Breakdown {
  totalInbound: number;
  totalOutbound: number;
  totalReactions: number;
  totalMedia: number;
  totalVoice: number;
  totalCalls: number;
  totalMissedCalls: number;
  totalQuoteReplies: number;
  daysInitiated: number;
  replyRate: number;
  reactionRate: number;
}

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const loading = ref(true);
const timeline = ref<TimelineCell[]>([]);
const pattern = ref<string | null>(null);
const trend = ref<number | null>(null);
const score = ref<number | null>(null);
const breakdown = ref<Breakdown | null>(null);

const PATTERN_LABELS: Record<string, string> = {
  hot: '🔥 Đang nóng lên',
  champion: '💎 Champion',
  stable: '📈 Ổn định',
  cooling: '⚠ Đang nguội',
  cold: '😴 Lạnh',
  noise: '🌫 Chưa đủ dữ liệu',
};

const patternLabel = computed(() => (pattern.value ? PATTERN_LABELS[pattern.value] || pattern.value : ''));

const trendClass = computed(() => {
  if (trend.value === null) return 'flat';
  if (trend.value >= 20) return 'up';
  if (trend.value <= -20) return 'down';
  return 'flat';
});

const trendIcon = computed(() => {
  if (trend.value === null) return '→';
  if (trend.value >= 20) return '↑';
  if (trend.value <= -20) return '↓';
  return '→';
});

const trendText = computed(() => {
  if (trend.value === null) return 'Không đủ dữ liệu';
  if (trend.value === 0) return 'Không đổi';
  const sign = trend.value > 0 ? '+' : '';
  return `${sign}${trend.value}% so tuần trước`;
});

// Split timeline (28 days, oldest first) into 4 rows of 7 days each
const weekRows = computed<TimelineCell[][]>(() => {
  const result: TimelineCell[][] = [];
  for (let i = 0; i < timeline.value.length; i += 7) {
    result.push(timeline.value.slice(i, i + 7));
  }
  return result;
});

function rowLabel(idx: number): string {
  // 4 rows: oldest first (T-3 = 3 weeks ago) ... current (Tuần này)
  const labels = ['T-3', 'T-2', 'T-1', 'Tuần này'];
  return labels[idx] || `T-${idx}`;
}

function intensityLevel(intensity: number): number {
  if (intensity === 0) return 0;
  if (intensity < 20) return 1;
  if (intensity < 40) return 2;
  if (intensity < 65) return 3;
  return 4;
}

function cellTooltip(cell: TimelineCell): string {
  const p = getOrgParts(cell.date);
  const dateStr = p ? `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}` : '';
  if (cell.dailyIntensity === 0) return `${dateStr} · Không có tương tác`;
  const parts: string[] = [`${dateStr} · Điểm ${cell.dailyIntensity}/100`];
  if (cell.reactionCount > 0) parts.push(`❤️ ${cell.reactionCount}`);
  if (cell.inboundMsgCount > 0) parts.push(`💬 KH ${cell.inboundMsgCount}`);
  if (cell.outboundMsgCount > 0) parts.push(`📤 Sale ${cell.outboundMsgCount}`);
  if (cell.callCount > 0) parts.push(`📞 ${cell.callCount}`);
  if (cell.missedCallCount > 0) parts.push(`📵 nhỡ ${cell.missedCallCount}`);
  if (cell.quoteReplyCount > 0) parts.push(`↩️ ${cell.quoteReplyCount}`);
  if (cell.voiceMsgCount > 0) parts.push(`🎤 ${cell.voiceMsgCount}`);
  if (cell.mediaShareCount > 0) parts.push(`📎 ${cell.mediaShareCount}`);
  if (cell.customerInitiated) parts.push('⚡ KH nhắn trước');
  return parts.join(' · ');
}

async function fetchTimeline() {
  if (!props.contactId) return;
  loading.value = true;
  try {
    const { data } = await api.get(`/contacts/${props.contactId}/engagement-timeline`, {
      params: { days: 28 },
    });
    timeline.value = data.timeline || [];
    pattern.value = data.pattern;
    trend.value = data.trend;
    score.value = data.score;
    breakdown.value = data.breakdown;
  } catch (err) {
    console.warn('[EngagementHeatmap] fetch failed', err);
    timeline.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(fetchTimeline);
watch(() => props.contactId, fetchTimeline);

defineExpose({ refresh: fetchTimeline });
</script>

<style scoped>
.engagement-heatmap {
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 12px;
  padding: 16px 18px;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: #1F2D3D;
}
.eh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 10px;
}
.eh-title {
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}
.eh-icon { font-size: 14px; }
.eh-pattern {
  font-size: 10.5px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.eh-pattern.pattern-hot { background: #FEF2F2; color: #EF4444; }
.eh-pattern.pattern-champion { background: #FFFBEB; color: #F59E0B; }
.eh-pattern.pattern-stable { background: #EFF6FF; color: #3B82F6; }
.eh-pattern.pattern-cooling { background: #FFF7ED; color: #F97316; }
.eh-pattern.pattern-cold { background: #F4F4F7; color: #9CA3AF; }
.eh-pattern.pattern-noise { background: #F4F4F7; color: #97A0AC; font-style: italic; }

.eh-grid { margin-bottom: 12px; }
.eh-day-header,
.eh-row {
  display: grid;
  grid-template-columns: 44px repeat(7, 1fr);
  gap: 3px;
  align-items: center;
}
.eh-day-header {
  font-size: 9px;
  font-weight: 600;
  color: #97A0AC;
  text-align: center;
  margin-bottom: 4px;
}
.eh-day-header > div { padding: 2px 0; }
.eh-row { margin-bottom: 3px; }
.eh-row-label {
  font-size: 9.5px;
  font-weight: 600;
  color: #97A0AC;
  text-align: right;
  padding-right: 4px;
}
.eh-cell {
  aspect-ratio: 1;
  border-radius: 3px;
  cursor: pointer;
  transition: outline 0.1s;
}
.eh-cell[data-level="0"] { background: #F4F4F7; }
.eh-cell[data-level="1"] { background: #DCFCE7; }
.eh-cell[data-level="2"] { background: #86EFAC; }
.eh-cell[data-level="3"] { background: #4ADE80; }
.eh-cell[data-level="4"] { background: #16A34A; }
.eh-cell:hover {
  outline: 2px solid #5E6AD2;
  outline-offset: 1px;
}

.eh-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 0;
  border-top: 1px solid #E4E5E9;
  border-bottom: 1px solid #E4E5E9;
  font-size: 12px;
}
.eh-meta-item {
  display: flex;
  justify-content: space-between;
}
.meta-label { color: #6B7785; }
.meta-value { font-weight: 600; }
.meta-value.up { color: #16A34A; }
.meta-value.down { color: #EF4444; }
.meta-value.flat { color: #6B7785; }
.meta-value.score { color: #5E6AD2; }

.eh-breakdown {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  font-size: 11.5px;
}
.bd-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  white-space: nowrap;
  min-width: 0;
  gap: 6px;
}
.bd-label {
  color: #6B7785;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}
.bd-val { font-weight: 600; color: #1F2D3D; flex: 0 0 auto; }
.bd-val-sub { font-weight: 500; color: #97A0AC; font-size: 10.5px; }

/* Loading skeleton */
.eh-skeleton {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.sk-row {
  display: grid;
  grid-template-columns: 44px repeat(7, 1fr);
  gap: 3px;
}
.sk-row::before {
  content: '';
}
.sk-cell {
  aspect-ratio: 1;
  background: #F4F4F7;
  border-radius: 3px;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
