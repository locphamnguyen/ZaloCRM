<template>
  <!-- Phase A UI fix v3 (2026-05-21): cap 3 chip visible + "+N" overflow chip.
       Trước fix: thả 5 reaction → tràn ra ngoài bubble → chat UI scroll ngang (bể UI).
       Anh chốt: max 3 chip, dư thì hiện "+N" sau. Hover "+N" thấy list emoji còn lại. -->
  <div v-if="reactions.length > 0" class="d-flex ga-1 reaction-row">
    <v-chip
      v-for="r in visibleReactions"
      :key="r.emoji"
      size="x-small"
      :variant="r.reacted ? 'tonal' : 'outlined'"
      :color="r.reacted ? 'primary' : undefined"
      class="reaction-chip"
      :class="{ 'reaction-chip--reacted': r.reacted }"
      :title="tooltipFor(r)"
      @click="emit('toggle', r.emoji)"
    >
      {{ r.emoji }}&nbsp;{{ r.count }}
    </v-chip>
    <v-chip
      v-if="overflowCount > 0"
      size="x-small"
      variant="outlined"
      class="reaction-chip reaction-chip--overflow"
      :title="overflowTooltip"
    >+{{ overflowCount }}</v-chip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface ReactionView { emoji: string; count: number; reacted: boolean }

const MAX_VISIBLE_CHIPS = 3;

const props = defineProps<{
  reactions: ReactionView[];
}>();

const emit = defineEmits<{
  toggle: [emoji: string];
}>();

// Cap 3 chip visible. Ưu tiên giữ chip mà user đã react (mình thấy ngay icon mình thả).
const visibleReactions = computed<ReactionView[]>(() => {
  if (props.reactions.length <= MAX_VISIBLE_CHIPS) return props.reactions;
  // Sort: reacted (mình thả) lên trước, sau đó theo count desc, sau đó giữ thứ tự gốc
  const indexed = props.reactions.map((r, i) => ({ ...r, originalIdx: i }));
  indexed.sort((a, b) => {
    if (a.reacted !== b.reacted) return a.reacted ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.originalIdx - b.originalIdx;
  });
  return indexed.slice(0, MAX_VISIBLE_CHIPS);
});

const overflowCount = computed(() => Math.max(0, props.reactions.length - MAX_VISIBLE_CHIPS));

// Tooltip "+N" chip — list emoji còn lại để user biết ẩn gì.
const overflowTooltip = computed(() => {
  if (overflowCount.value === 0) return '';
  const shown = new Set(visibleReactions.value.map(r => r.emoji));
  const hidden = props.reactions.filter(r => !shown.has(r.emoji));
  const list = hidden.map(r => `${r.emoji} ${r.count}`).join(' · ');
  return `+${overflowCount.value} reaction khác: ${list}`;
});

function tooltipFor(r: ReactionView): string {
  const people = r.count === 1 ? '1 người' : `${r.count} người`;
  const verb = r.reacted ? 'gỡ' : 'thả';
  return `${r.emoji} ${people} đã thả · click để ${verb} reaction`;
}
</script>

<style scoped>
.reaction-row {
  flex-wrap: nowrap;
  white-space: nowrap;
}
.reaction-chip {
  cursor: pointer;
  transition: transform 0.12s;
  flex-shrink: 0;
}
.reaction-chip:hover {
  transform: scale(1.1);
}
.reaction-chip--reacted {
  border-width: 1.5px;
}
/* "+N" overflow chip — slightly muted, không cursor pointer (chỉ tooltip) */
.reaction-chip--overflow {
  cursor: default;
  opacity: 0.85;
}
.reaction-chip--overflow:hover {
  transform: none;
}
</style>
