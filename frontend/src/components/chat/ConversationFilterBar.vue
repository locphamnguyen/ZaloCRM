<template>
  <div class="cfb">
    <!-- ── 4 Tabs row ── -->
    <div class="cfb-tabs">
      <button
        class="cfb-tab"
        :class="{ active: filters.state.tabType === 'user' }"
        @click="filters.setTabType('user')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        Cá nhân
        <span v-if="counts.individual !== undefined" class="tab-count">{{ counts.individual }}</span>
      </button>
      <button
        class="cfb-tab"
        :class="{ active: filters.state.tabType === 'group' }"
        @click="filters.setTabType('group')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        Nhóm
        <span v-if="counts.group !== undefined" class="tab-count">{{ counts.group }}</span>
      </button>
      <span class="cfb-tab-divider"></span>
      <button
        class="cfb-tab"
        :class="{ active: filters.state.tabBox === 'main' }"
        @click="filters.setTabBox('main')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
        Chính
        <span v-if="counts.main !== undefined" class="tab-count">{{ counts.main }}</span>
      </button>
      <button
        class="cfb-tab"
        :class="{ active: filters.state.tabBox === 'other' }"
        @click="filters.setTabBox('other')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
        Khác
        <span v-if="counts.other !== undefined" class="tab-count">{{ counts.other }}</span>
      </button>
    </div>

    <!-- ── Quick pills + Nhãn ── -->
    <div class="cfb-pills">
      <button
        class="pill"
        :class="{ active: filters.state.quickPills.has('unread'), alert: true }"
        @click="filters.toggleQuickPill('unread')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        Chưa đọc
        <span v-if="counts.unread" class="count">{{ counts.unread }}</span>
      </button>
      <button
        class="pill"
        :class="{ active: filters.state.quickPills.has('unanswered'), warning: true }"
        @click="filters.toggleQuickPill('unanswered')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
        Chưa rep
        <span v-if="counts.unanswered" class="count">{{ counts.unanswered }}</span>
      </button>
      <button
        class="pill"
        :class="{ active: filters.state.quickPills.has('stuck'), danger: true }"
        @click="filters.toggleQuickPill('stuck')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        Đình trệ
        <span v-if="counts.stuck" class="count">{{ counts.stuck }}</span>
      </button>
      <button
        class="pill"
        :class="{ active: filters.state.quickPills.has('ready'), success: true }"
        @click="filters.toggleQuickPill('ready')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        Sẵn sàng chốt
        <span v-if="counts.ready" class="count">{{ counts.ready }}</span>
      </button>
      <span class="pill-divider"></span>
      <button
        class="pill nhan"
        :class="{ 'has-value': totalSelectedTags > 0 }"
        @click="$emit('open-tag-popup')"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
        Nhãn
        <span v-if="totalSelectedTags > 0">: {{ totalSelectedTags }}</span>
        <svg class="caret" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </div>

    <!-- ── Sort + Counter row ── -->
    <div class="cfb-sort">
      <span class="cfb-sort-count">
        <strong>{{ totalCount }}</strong> hội thoại
        <span v-if="counts.unread" class="muted">·</span>
        <span v-if="counts.unread" class="accent">{{ counts.unread }} chưa đọc</span>
      </span>
      <button class="sort-toggle" @click="toggleSort">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M7 12h10M11 18h2" /></svg>
        {{ filters.state.sortMode === 'unread-first' ? 'Chưa đọc lên trên' : 'Mới nhất lên trên' }}
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  filters: any;
  totalCount: number;
  counts: {
    unread?: number;
    unanswered?: number;
    stuck?: number;
    ready?: number;
    individual?: number;
    group?: number;
    main?: number;
    other?: number;
  };
}>();

defineEmits<{
  'open-tag-popup': [];
}>();

const totalSelectedTags = computed(
  () => props.filters.state.tagsZalo.length + props.filters.state.tagsCrm.length
);

function toggleSort() {
  props.filters.setSortMode(
    props.filters.state.sortMode === 'unread-first' ? 'recent' : 'unread-first'
  );
}
</script>

<style scoped>
.cfb {
  background: white;
  border-bottom: 1px solid #F3F4F6;
}

/* Tabs */
.cfb-tabs {
  display: flex;
  padding: 0 14px;
  gap: 2px;
  border-bottom: 1px solid #F3F4F6;
  background: white;
  position: relative;
}
.cfb-tab {
  flex: 1;
  padding: 9px 0 11px;
  text-align: center;
  font-size: 12.5px;
  font-weight: 600;
  color: #6B7280;
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: inherit;
}
.cfb-tab:hover { color: #4338CA; }
.cfb-tab.active {
  color: #6366F1;
  border-bottom-color: #6366F1;
}
.cfb-tab .ic { width: 14px; height: 14px; }
.cfb-tab .tab-count {
  background: #F3F4F6;
  color: #4B5563;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 6px;
  font-weight: 700;
}
.cfb-tab.active .tab-count { background: #EEF2FF; color: #4338CA; }
.cfb-tab-divider {
  width: 1px;
  background: #E5E7EB;
  margin: 8px 2px;
  flex-shrink: 0;
}

/* Pills */
.cfb-pills {
  display: flex;
  gap: 5px;
  padding: 10px 14px 9px;
  border-bottom: 1px solid #F3F4F6;
  overflow-x: auto;
  scrollbar-width: none;
  align-items: center;
}
.cfb-pills::-webkit-scrollbar { display: none; }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  border-radius: 13px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid #E5E7EB;
  background: white;
  color: #4B5563;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: inherit;
}
.pill:hover { background: #F9FAFB; border-color: #D1D5DB; }
.pill.active {
  background: #111827;
  color: white;
  border-color: #111827;
}
.pill.alert.active { background: #DC2626; border-color: #DC2626; }
.pill.warning.active { background: #F59E0B; border-color: #F59E0B; }
.pill.danger.active { background: #EF4444; border-color: #EF4444; }
.pill.success.active { background: #10B981; border-color: #10B981; }
.pill .ic { width: 12px; height: 12px; }
.pill .count {
  background: rgba(255, 255, 255, 0.2);
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9.5px;
}
.pill:not(.active) .count { background: #F3F4F6; color: #6B7280; }

.pill-divider {
  width: 1px;
  height: 18px;
  background: #E5E7EB;
  margin: 0 2px;
  flex-shrink: 0;
}
.pill.nhan { background: #F3F4F6; border-color: transparent; }
.pill.nhan.has-value {
  background: #EEF2FF;
  color: #4338CA;
  border-color: #C7D2FE;
}
.pill .caret { opacity: 0.7; }

/* Sort */
.cfb-sort {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  background: #FAFBFC;
  font-size: 11px;
  color: #6B7280;
}
.cfb-sort-count strong { color: #111827; }
.cfb-sort-count .muted { color: #6B7280; }
.cfb-sort-count .accent { color: #EF4444; font-weight: 700; }
.sort-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 6px;
  background: white;
  border: 1px solid #E5E7EB;
  color: #4B5563;
  font-weight: 600;
  font-size: 11px;
  font-family: inherit;
}
.sort-toggle:hover { border-color: #6366F1; color: #4338CA; }
.sort-toggle .ic { width: 11px; height: 11px; }
</style>
