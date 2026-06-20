<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div v-if="hints.length" class="smart-hints">
    <div class="hint-row">
      <button
        v-for="h in hints"
        :key="h.key"
        class="hint-chip"
        :class="h.kind"
        @click="$emit('apply', h)"
      >
        {{ h.icon }} {{ h.label }}
        <span class="x">→</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DbFriend } from '@/composables/use-friends';

export type HintKey = 'silent7d' | 'newThisWeek' | 'hotPending' | 'aliasDup';
export interface SmartHint {
  key: HintKey;
  label: string;
  icon: string;
  kind: 'warn' | 'success' | 'danger' | 'info';
}

const props = defineProps<{
  friends: DbFriend[];
}>();

defineEmits<{
  (e: 'apply', hint: SmartHint): void;
}>();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_WEEK_AGO = () => Date.now() - SEVEN_DAYS_MS;

const hints = computed<SmartHint[]>(() => {
  if (!props.friends.length) return [];
  const list: SmartHint[] = [];
  const now = Date.now();

  const silent = props.friends.filter(f => {
    if (!f.lastInteractionAt) return false;
    return now - new Date(f.lastInteractionAt).getTime() >= SEVEN_DAYS_MS;
  }).length;
  if (silent > 0) {
    list.push({
      key: 'silent7d',
      label: `${silent} KH chưa nhắn ≥7 ngày — risk lạnh`,
      icon: '⚠',
      kind: 'warn',
    });
  }

  const newKB = props.friends.filter(f => {
    if (!f.becameFriendAt) return false;
    return now - new Date(f.becameFriendAt).getTime() <= SEVEN_DAYS_MS;
  }).length;
  if (newKB > 0) {
    list.push({
      key: 'newThisWeek',
      label: `${newKB} KH mới kết bạn tuần này`,
      icon: '✓',
      kind: 'success',
    });
  }

  const hot = props.friends.filter(f => f.statusRef?.name?.toLowerCase().includes('nóng') || f.statusRef?.name?.toLowerCase() === 'hot').length;
  if (hot > 0) {
    list.push({
      key: 'hotPending',
      label: `${hot} KH đang "Nóng" cần follow gấp`,
      icon: '🔥',
      kind: 'danger',
    });
  }

  // Alias duplicate detection — same alias trên nhiều pair
  const aliasMap = new Map<string, number>();
  props.friends.forEach(f => {
    if (f.aliasInNick) aliasMap.set(f.aliasInNick, (aliasMap.get(f.aliasInNick) || 0) + 1);
  });
  const dupAlias = [...aliasMap.values()].filter(c => c > 1).length;
  if (dupAlias > 0) {
    list.push({
      key: 'aliasDup',
      label: `${dupAlias} alias trùng — gợi ý merge`,
      icon: '💡',
      kind: 'info',
    });
  }

  return list;
});

void ONE_WEEK_AGO;
</script>

<style scoped>
.smart-hints {
  padding: 8px 20px 0;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.hint-row {
  display: flex;
  gap: 8px;
  padding: 0 0 10px;
  flex-wrap: wrap;
}
.hint-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--warning-soft); color: #78350f;
  border: 1px solid #fbbf24;
  padding: 4px 10px; border-radius: var(--r-pill);
  font-size: 11.5px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.hint-chip:hover { background: #fde68a; }
.hint-chip.success { background: var(--success-soft); color: #166534; border-color: #4ade80; }
.hint-chip.success:hover { background: #bbf7d0; }
.hint-chip.danger { background: var(--error-soft); color: #991b1b; border-color: #f87171; }
.hint-chip.danger:hover { background: #fecaca; }
.hint-chip.info { background: #dbeafe; color: #1e40af; border-color: #60a5fa; }
.hint-chip.info:hover { background: #bfdbfe; }
.hint-chip .x { opacity: .5; margin-left: 2px; }
</style>
