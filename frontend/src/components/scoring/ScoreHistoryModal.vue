<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="shm-overlay" @click.self="close">
      <div class="shm-card" role="dialog" aria-modal="true">
        <header class="shm-head">
          <div>
            <h3 class="shm-title">📜 Lịch sử chấm điểm</h3>
            <div class="shm-sub">
              {{ contactName || 'Khách hàng' }}
              <span v-if="filteredSignals.length">· {{ filteredSignals.length }} sự kiện</span>
            </div>
          </div>
          <button class="shm-close" @click="close" aria-label="Đóng">×</button>
        </header>

        <div class="shm-filter">
          <span
            class="shm-pill"
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >Tất cả</span>
          <span
            class="shm-pill"
            :class="{ active: filter === 'pos' }"
            @click="filter = 'pos'"
          >▲ Tăng điểm</span>
          <span
            class="shm-pill"
            :class="{ active: filter === 'neg' }"
            @click="filter = 'neg'"
          >▼ Giảm điểm</span>
        </div>

        <div v-if="loading" class="shm-loading">⏳ Đang tải lịch sử…</div>
        <div v-else-if="filteredSignals.length === 0" class="shm-empty">
          Không có sự kiện nào khớp bộ lọc.
        </div>
        <div v-else class="shm-list">
          <div
            v-for="(s, i) in filteredSignals"
            :key="i"
            class="shm-row"
          >
            <span class="shm-row-icon" :class="s.delta >= 0 ? 'pos' : 'neg'">
              {{ s.delta >= 0 ? '▲' : '▼' }}
            </span>
            <div class="shm-row-body">
              <span class="shm-row-label">{{ s.label }}</span>
              <span class="shm-row-dim" :class="`dim-${s.dimension}`">
                {{ dimLabel(s.dimension) }}
              </span>
            </div>
            <span class="shm-row-delta" :class="s.delta >= 0 ? 'pos' : 'neg'">
              {{ s.delta >= 0 ? '+' : '' }}{{ s.delta }}
            </span>
            <span class="shm-row-time" :title="formatFull(s.appliedAt)">
              {{ relativeTime(s.appliedAt) }}
            </span>
          </div>
        </div>

        <footer class="shm-footer">
          <button class="shm-btn-secondary" @click="close">Đóng</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useScoring, type ScoreBreakdown } from '@/composables/use-scoring';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const props = defineProps<{
  modelValue: boolean;
  friendId: string | null;
  contactName?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const scoring = useScoring();
const data = ref<ScoreBreakdown | null>(null);
const loading = ref(false);
const filter = ref<'all' | 'pos' | 'neg'>('all');

async function fetchData() {
  if (!props.friendId) {
    data.value = null;
    return;
  }
  loading.value = true;
  try {
    const res = await scoring.getScoreBreakdown(props.friendId);
    data.value = res?.scoreBreakdown ?? res ?? null;
  } catch (err) {
    console.warn('[ScoreHistoryModal] fetch failed', err);
    data.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.friendId] as const,
  ([open, id]) => {
    if (open && id) fetchData();
    if (open) filter.value = 'all';
  },
  { immediate: true },
);

const filteredSignals = computed(() => {
  const list = data.value?.signals ?? [];
  const sorted = [...list].sort(
    (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
  );
  if (filter.value === 'pos') return sorted.filter(s => s.delta >= 0);
  if (filter.value === 'neg') return sorted.filter(s => s.delta < 0);
  return sorted;
});

function close() {
  emit('update:modelValue', false);
}

function dimLabel(d: string): string {
  return ({
    engagement: 'Tương tác',
    intent: 'Ý định',
    fit: 'Phù hợp',
    velocity: 'Đà tăng',
  } as Record<string, string>)[d] || d;
}

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

function formatFull(iso: string | null): string {
  if (!iso) return '';
  return formatInOrgTz(iso);
}
</script>

<style scoped>
.shm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: shm-fade 0.15s ease;
}
@keyframes shm-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.shm-card {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 460px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
  animation: shm-pop 0.18s ease;
}
@keyframes shm-pop {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.shm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--smax-grey-100, #eef0f4);
}
.shm-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  color: var(--smax-grey-900, #1a1f2e);
}
.shm-sub {
  font-size: 11.5px;
  color: var(--smax-grey-600, #5a6478);
  margin-top: 3px;
}
.shm-close {
  background: transparent;
  border: none;
  color: var(--smax-grey-400, #a8aebb);
  font-size: 22px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  line-height: 1;
}
.shm-close:hover { background: var(--smax-grey-100, #eef0f4); color: var(--smax-grey-700, #3d4456); }

.shm-filter {
  display: flex;
  gap: 6px;
  padding: 10px 18px 6px;
}
.shm-pill {
  font-size: 11.5px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--smax-grey-100, #eef0f4);
  color: var(--smax-grey-700, #3d4456);
  cursor: pointer;
  font-weight: 500;
  user-select: none;
  transition: background 0.12s;
}
.shm-pill:hover { background: var(--smax-grey-200, #e1e4eb); }
.shm-pill.active {
  background: var(--smax-primary-soft, #e8efff);
  color: var(--smax-primary, #2962ff);
  font-weight: 600;
}

.shm-loading,
.shm-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--smax-grey-400, #a8aebb);
  font-size: 13px;
}

.shm-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 14px 14px;
}
.shm-row {
  display: grid;
  grid-template-columns: 14px 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 6px;
  font-size: 12.5px;
}
.shm-row:hover { background: var(--smax-grey-50, #f8f9fb); }
.shm-row-icon { font-size: 11px; text-align: center; font-weight: 800; }
.shm-row-icon.pos { color: #16a34a; }
.shm-row-icon.neg { color: #ef4444; }
.shm-row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.shm-row-label {
  color: var(--smax-grey-900, #1a1f2e);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shm-row-dim {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 1px 6px;
  border-radius: 999px;
  display: inline-block;
  width: fit-content;
}
.shm-row-dim.dim-engagement { color: #1e40af; background: #dbeafe; }
.shm-row-dim.dim-intent { color: #047857; background: #d1fae5; }
.shm-row-dim.dim-fit { color: #6d28d9; background: #ede9fe; }
.shm-row-dim.dim-velocity { color: #b45309; background: #fef3c7; }

.shm-row-delta {
  font-size: 12.5px;
  font-weight: 700;
  font-family: 'SF Mono', Monaco, monospace;
}
.shm-row-delta.pos { color: #16a34a; }
.shm-row-delta.neg { color: #ef4444; }
.shm-row-time {
  color: var(--smax-grey-400, #a8aebb);
  font-size: 11px;
  font-family: 'SF Mono', Monaco, monospace;
  min-width: 32px;
  text-align: right;
}

.shm-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--smax-grey-100, #eef0f4);
  display: flex;
  justify-content: flex-end;
}
.shm-btn-secondary {
  padding: 8px 16px;
  border: 1px solid var(--smax-grey-200, #e1e4eb);
  background: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--smax-grey-700, #3d4456);
}
.shm-btn-secondary:hover { background: var(--smax-grey-50, #f8f9fb); }
</style>
