<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mini-bar" :title="tooltipText">
    <div
      v-for="(cell, idx) in cells"
      :key="idx"
      class="mb-cell"
      :data-level="intensityLevel(cell)"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  /** Last 7 daily intensity values, oldest first. If undefined → renders all zeros. */
  intensities?: number[] | null;
  pattern?: string | null;
}>();

const PATTERN_LABELS: Record<string, string> = {
  hot: '🔥 Đang nóng lên',
  champion: '💎 Champion',
  stable: '📈 Ổn định',
  cooling: '⚠ Đang nguội',
  cold: '😴 Lạnh',
  noise: 'Chưa đủ dữ liệu',
};

const cells = computed<number[]>(() => {
  const arr = props.intensities ?? [];
  // Pad/truncate to exactly 7 values
  if (arr.length === 7) return arr;
  if (arr.length > 7) return arr.slice(-7);
  const padded = new Array(7 - arr.length).fill(0).concat(arr);
  return padded;
});

const tooltipText = computed(() => {
  if (!props.pattern) return 'Engagement 7 ngày qua';
  const lbl = PATTERN_LABELS[props.pattern] || props.pattern;
  return `${lbl} · Engagement 7 ngày qua`;
});

function intensityLevel(intensity: number): number {
  if (!intensity || intensity === 0) return 0;
  if (intensity < 20) return 1;
  if (intensity < 40) return 2;
  if (intensity < 65) return 3;
  return 4;
}
</script>

<style scoped>
.mini-bar {
  display: grid;
  grid-template-columns: repeat(7, 8px);
  gap: 2px;
  flex-shrink: 0;
  align-items: center;
}
.mb-cell {
  height: 14px;
  border-radius: 2px;
}
.mb-cell[data-level="0"] { background: #F4F4F7; }
.mb-cell[data-level="1"] { background: #DCFCE7; }
.mb-cell[data-level="2"] { background: #86EFAC; }
.mb-cell[data-level="3"] { background: #4ADE80; }
.mb-cell[data-level="4"] { background: #16A34A; }
</style>
