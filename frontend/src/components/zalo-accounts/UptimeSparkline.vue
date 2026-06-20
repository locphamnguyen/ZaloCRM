<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="uptime-sparkline" preserveAspectRatio="none">
    <polyline
      v-if="points.length > 1"
      :points="points.map(p => p.join(',')).join(' ')"
      fill="none"
      :stroke="strokeColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <line v-else x1="0" :y1="height/2" :x2="width" :y2="height/2" stroke="#E5E7EB" stroke-width="1" stroke-dasharray="2 2"/>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  buckets: Array<{ msgSent: number; msgReceived: number; hasActivity: boolean }>;
  color?: 'success' | 'warning' | 'error';
  width?: number;
  height?: number;
}>(), {
  color: 'success',
  width: 44,
  height: 14,
});

const strokeColor = computed(() => {
  if (props.color === 'error') return '#EF4444';
  if (props.color === 'warning') return '#F59E0B';
  return '#10B981';
});

const points = computed<number[][]>(() => {
  if (!props.buckets || props.buckets.length === 0) return [];
  const values = props.buckets.map(b => b.msgSent + b.msgReceived);
  const max = Math.max(...values, 1);
  const min = 0;
  const range = max - min || 1;
  const step = props.width / Math.max(props.buckets.length - 1, 1);
  return values.map((v, i) => {
    const x = i * step;
    // y = height - normalized (invert because SVG y-down)
    const y = props.height - ((v - min) / range) * (props.height - 2) - 1;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });
});
</script>

<style scoped>
.uptime-sparkline {
  display: inline-block;
  vertical-align: middle;
}
</style>
