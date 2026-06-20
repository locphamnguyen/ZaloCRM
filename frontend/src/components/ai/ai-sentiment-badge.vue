<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-chip :color="chip.color" size="small" variant="tonal">
    <v-icon start :icon="chip.icon" size="16" />
    {{ chip.label }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  sentiment: { label: 'positive' | 'neutral' | 'negative'; confidence: number; reason: string } | null;
}>();

const chip = computed(() => {
  if (!props.sentiment) return { color: 'grey', icon: 'mdi-emoticon-neutral-outline', label: 'Chưa phân tích' };
  if (props.sentiment.label === 'positive') return { color: 'success', icon: 'mdi-emoticon-happy-outline', label: 'Tích cực' };
  if (props.sentiment.label === 'negative') return { color: 'error', icon: 'mdi-emoticon-sad-outline', label: 'Tiêu cực' };
  return { color: 'warning', icon: 'mdi-emoticon-neutral-outline', label: 'Trung tính' };
});
</script>
