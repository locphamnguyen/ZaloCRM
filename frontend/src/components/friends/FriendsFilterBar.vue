<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="filter-bar">
    <div class="kind-tabs">
      <button
        v-for="t in KIND_TABS"
        :key="t.value"
        class="kind-tab"
        :class="{ active: kindFilter === t.value }"
        :data-k="t.value"
        @click="$emit('update:kindFilter', t.value)"
      >
        <span v-if="t.dot" class="dot" :style="{ background: t.dot }" />
        {{ t.label }}
        <span class="num">{{ countByKind[t.value] ?? 0 }}</span>
      </button>
    </div>

    <div class="divider" />

    <!-- Trạng thái KH — lọc theo Status thật của org (Friend.statusId per-nick) -->
    <div class="care-wrap">
      <button class="chip" :class="{ on: !!careStatus }" @click="toggleCareDropdown">
        <span v-if="selectedStatus" class="dot" :style="{ background: selectedStatus.color || 'var(--ink-4)' }" />
        <span>{{ selectedStatus ? selectedStatus.name : 'Trạng thái KH' }}</span>
        <span class="caret" :class="{ clear: !!careStatus }" @click.stop="careStatus ? onCarePick('') : toggleCareDropdown()">{{ careStatus ? '✕' : '▾' }}</span>
      </button>
      <div v-if="careDropdown" class="dropdown care-dd">
        <button :class="{ active: !careStatus }" @click="onCarePick('')">Tất cả trạng thái</button>
        <button
          v-for="st in statuses"
          :key="st.id"
          :class="{ active: careStatus === st.id }"
          @click="onCarePick(st.id)"
        ><span class="dot" :style="{ background: st.color || 'var(--ink-4)' }" />{{ st.name }}</button>
        <div v-if="!statuses.length" class="care-empty">Chưa cài Trạng thái KH</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api/index';
import type { FriendKindFilter } from '@/composables/use-friends-state';

const props = defineProps<{
  kindFilter: FriendKindFilter;
  countByKind: Record<string, number>;
  careStatus: string;
}>();

const emit = defineEmits<{
  (e: 'update:kindFilter', v: FriendKindFilter): void;
  (e: 'update:careStatus', v: string): void;
}>();

const KIND_TABS: { value: FriendKindFilter; label: string; dot?: string }[] = [
  { value: 'all',                label: 'Tất cả' },
  // 'none' = mới tìm ra Zalo qua SDK (có uid) nhưng chưa gửi mời / chưa nhắn → Người Lạ.
  { value: 'none',               label: 'Người Lạ',      dot: '#a78bfa' },
  { value: 'friend',             label: 'Đã KB',         dot: '#16a34a' },
  { value: 'pending_friend',     label: 'Đã mời',        dot: '#d97706' },
  { value: 'chatting_stranger',  label: 'Đang nhắn lạ',  dot: '#0891b2' },
  { value: 'ghost',              label: 'Đã ngắt',       dot: '#9ca3af' },
];

// 8 Trạng thái KH thật của org (Mới/Tiếp cận/Hẹn gặp/Nóng/Tiềm năng/Chốt/Mất/Thất Bại).
const statuses = ref<Array<{ id: string; name: string; color: string | null }>>([]);
onMounted(async () => {
  try {
    const { data } = await api.get('/settings/statuses');
    statuses.value = data?.statuses ?? [];
  } catch { statuses.value = []; }
});
const selectedStatus = computed(() => statuses.value.find(s => s.id === props.careStatus) || null);

const careDropdown = ref(false);
function toggleCareDropdown() {
  careDropdown.value = !careDropdown.value;
}
function onCarePick(v: string) {
  emit('update:careStatus', v);
  careDropdown.value = false;
}
</script>

<style scoped>
/* HS Holding theme — filter bar dạng .kpill (token brand #1786be) */
.filter-bar {
  padding: 10px 22px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
}

.kind-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.kind-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 12px; border-radius: var(--r-pill);
  background: var(--surface); border: 1px solid var(--line);
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  color: var(--ink-2);
  font-family: inherit;
  transition: all .12s;
}
.kind-tab:hover { border-color: var(--brand); color: var(--ink); }
.kind-tab .dot { width: 7px; height: 7px; border-radius: 50%; }
.kind-tab .num {
  font-family: var(--mono, ui-monospace, monospace);
  background: var(--surface-3); color: var(--ink-3);
  padding: 0 7px; border-radius: var(--r-pill);
  font-size: 11px; font-weight: 700;
}
/* Active pill — màu theo kind (giống .kpill.on[data-k] của theme) */
.kind-tab.active { color: #fff; border-color: transparent; }
.kind-tab.active .dot { display: none; }
.kind-tab.active .num { background: rgba(255,255,255,.22); color: #fff; }
.kind-tab.active[data-k="all"]               { background: var(--ink); }
.kind-tab.active[data-k="none"]              { background: var(--chip-purple, #8b5cf6); }
.kind-tab.active[data-k="friend"]            { background: var(--success); }
.kind-tab.active[data-k="pending_friend"]    { background: var(--warning); }
.kind-tab.active[data-k="chatting_stranger"] { background: var(--info); }
.kind-tab.active[data-k="ghost"]             { background: #6b7488; }

.divider { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }

.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: var(--r-pill);
  border: 1px solid var(--line); background: var(--surface);
  font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--ink-2);
  font-family: inherit;
  transition: all .12s;
}
.chip:hover { background: var(--surface-3); color: var(--ink); }
.chip.on { background: var(--brand-soft); color: var(--brand-700); border-color: var(--brand); }
.chip .caret { opacity: .55; font-size: 9px; }

.saved-view {
  margin-left: auto;
  padding: 6px 14px;
  border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--surface);
  font-size: 12.5px; font-weight: 600; color: var(--ink-2);
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: all .12s;
}
.saved-view:hover { border-color: var(--brand); box-shadow: var(--sh-xs); }
.saved-view .star { color: var(--warning); }
.saved-view .caret { opacity: .55; font-size: 9px; }

/* Care status dropdown */
.care-wrap { position: relative; display: inline-flex; }
.chip .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.chip .caret.clear:hover { color: var(--error); }
.dropdown.care-dd {
  position: absolute; top: 100%; left: 0; margin-top: 6px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md);
  box-shadow: var(--sh-lg, 0 12px 32px rgba(20,26,36,.14));
  padding: 5px; min-width: 200px;
  z-index: 10;
  display: flex; flex-direction: column;
}
.dropdown.care-dd button {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 11px; border-radius: var(--r-sm);
  background: transparent; border: none; text-align: left;
  cursor: pointer; font-size: 12.5px; font-family: inherit;
  color: var(--ink);
}
.dropdown.care-dd button:hover { background: var(--surface-3); }
.dropdown.care-dd button.active { background: var(--brand-soft); color: var(--brand-700); font-weight: 600; }
.dropdown.care-dd .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.care-empty { padding: 8px 11px; font-size: 12px; color: var(--ink-4); }
</style>
