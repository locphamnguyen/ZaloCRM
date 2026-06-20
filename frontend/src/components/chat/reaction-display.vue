<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- Anh chốt 2026-05-22: học Zalo native — 1 BOX duy nhất chứa tất cả icons
       sát nhau + tổng count cuối. Click box → popup chi tiết grouped emoji + user.
       Tin self → align RIGHT, tin received → align LEFT (parent message-bubble
       quản lý positioning, component này chỉ render box). -->
  <div
    v-if="reactions.length > 0"
    class="reaction-box"
    :title="boxTooltip"
    @click.stop="$emit('open-detail', reactions)"
  >
    <span
      v-for="(r, i) in displayedEmojis"
      :key="r.emoji"
      class="reaction-icon"
      :style="{ marginLeft: i === 0 ? 0 : '-3px', zIndex: 10 - i }"
    >{{ r.emoji }}</span>
    <span class="reaction-total">{{ totalCount }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface ReactionView { emoji: string; count: number; reacted: boolean }

const MAX_VISIBLE_ICONS = 5;

const props = defineProps<{
  reactions: ReactionView[];
}>();

defineEmits<{
  /** Click vào box → MessageThread mở popup chi tiết grouped emoji + users */
  'open-detail': [reactions: ReactionView[]];
  toggle: [emoji: string];
}>();

// Hiển thị tối đa 5 emoji unique trong box (Zalo native cap 5).
// Sort: reacted-first → count desc → giữ thứ tự gốc.
const displayedEmojis = computed<ReactionView[]>(() => {
  const indexed = props.reactions.map((r, i) => ({ ...r, originalIdx: i }));
  indexed.sort((a, b) => {
    if (a.reacted !== b.reacted) return a.reacted ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.originalIdx - b.originalIdx;
  });
  return indexed.slice(0, MAX_VISIBLE_ICONS);
});

// Tổng count toàn bộ reactions (tất cả emoji × số người)
const totalCount = computed(() => {
  return props.reactions.reduce((sum, r) => sum + r.count, 0);
});

const boxTooltip = computed(() => {
  const lines = props.reactions.map((r) => `${r.emoji} ${r.count}`).join('  ');
  return `${lines}  ·  Click xem chi tiết`;
});
</script>

<style scoped>
/* Anh chốt 2026-05-22: Zalo native style — 1 box pill chứa stack icons + tổng. */
.reaction-box {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: white;
  border: 1px solid var(--smax-grey-300, #d4d8e0);
  border-radius: 12px;
  padding: 2px 8px 2px 6px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  transition: all 0.12s ease;
  user-select: none;
  white-space: nowrap;
  height: 24px;
}
.reaction-box:hover {
  background: var(--smax-grey-50, #fafbfc);
  border-color: var(--smax-grey-400, #b8becc);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

/* Icons stack sát nhau với negative margin overlap nhẹ (Zalo native effect) */
.reaction-icon {
  display: inline-block;
  font-size: 14px;
  line-height: 1;
  position: relative;
}

/* Tổng count cuối — bold số */
.reaction-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--smax-grey-900, #1f2937);
  margin-left: 3px;
  font-variant-numeric: tabular-nums;
}
</style>
