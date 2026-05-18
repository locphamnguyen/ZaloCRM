<template>
  <div class="cfb">
    <!-- ① Quick pills row (scroll-x, no wrap, no overflow ngoài) -->
    <div class="cfb-pills-wrap">
      <div class="cfb-pills">
        <button
          class="pill alert"
          :class="{ active: filters.state.quickPills.has('unread') }"
          @click="filters.toggleQuickPill('unread')"
        >
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          Chưa đọc
          <span v-if="counts.unread" class="count">{{ counts.unread }}</span>
        </button>
        <button
          class="pill warning"
          :class="{ active: filters.state.quickPills.has('unanswered') }"
          @click="filters.toggleQuickPill('unanswered')"
        >
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
          Chưa rep
          <span v-if="counts.unanswered" class="count">{{ counts.unanswered }}</span>
        </button>
        <button
          class="pill danger"
          :class="{ active: filters.state.quickPills.has('stuck') }"
          @click="filters.toggleQuickPill('stuck')"
        >
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          Đình trệ
          <span v-if="counts.stuck" class="count">{{ counts.stuck }}</span>
        </button>
        <button
          class="pill success"
          :class="{ active: filters.state.quickPills.has('ready') }"
          @click="filters.toggleQuickPill('ready')"
        >
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
          Sẵn sàng
          <span v-if="counts.ready" class="count">{{ counts.ready }}</span>
        </button>
      </div>
    </div>

    <!-- ② 4 tabs row — single active (1 tab tại 1 thời điểm) -->
    <div class="cfb-tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="cfb-tab"
        :class="{ active: filters.state.activeTab === tab.key }"
        @click="setActiveTab(tab.key)"
        :title="tab.tooltip"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" v-html="tab.svg" />
        {{ tab.label }}
        <span v-if="tabCount(tab.key) !== null" class="tab-count">{{ tabCount(tab.key) }}</span>
      </button>
    </div>

    <!-- ③ Mini counter + sort row — half height, muted -->
    <div class="cfb-mini">
      <span class="mini-count">
        <strong>{{ totalCount }}</strong> hội thoại
        <template v-if="counts.unread">
          <span class="dot">·</span>
          <span class="accent">{{ counts.unread }} chưa đọc</span>
        </template>
      </span>
      <button class="mini-sort" @click="toggleSort">
        {{ filters.state.sortMode === 'unread-first' ? 'Chưa đọc lên trên' : 'Mới nhất lên trên' }}
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
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


type TabKey = 'personal' | 'group' | 'main' | 'other';

const TABS: Array<{
  key: TabKey;
  label: string;
  svg: string;
  tooltip: string;
}> = [
  {
    key: 'personal',
    label: 'Cá nhân',
    tooltip: 'Chỉ hội thoại 1-1 (user với user)',
    svg: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />',
  },
  {
    key: 'group',
    label: 'Nhóm',
    tooltip: 'Chỉ hội thoại nhóm',
    svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />',
  },
  {
    key: 'main',
    label: 'Chính',
    tooltip: 'Hộp thư chính (cả user lẫn nhóm)',
    svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />',
  },
  {
    key: 'other',
    label: 'Khác',
    tooltip: 'Hội thoại đã move qua Khác',
    svg: '<circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />',
  },
];

function setActiveTab(key: TabKey) {
  // Single-active: tab khác sẽ tự deselect.
  props.filters.state.activeTab = key;
}

function tabCount(key: TabKey): number | null {
  switch (key) {
    case 'personal':
      return props.counts.individual ?? null;
    case 'group':
      return props.counts.group ?? null;
    case 'main':
      return props.counts.main ?? null;
    case 'other':
      return props.counts.other ?? null;
  }
  return null;
}

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
  flex-shrink: 0;
}

/* ① Quick pills — scroll-x, KHÔNG wrap, KHÔNG overflow ra ngoài */
.cfb-pills-wrap {
  border-bottom: 1px solid #F3F4F6;
  /* Critical: clip overflow-x, scroll trong wrap */
  overflow: hidden;
  position: relative;
}
.cfb-pills {
  display: flex;
  gap: 5px;
  padding: 8px 14px;
  overflow-x: auto;
  scrollbar-width: none;
  align-items: center;
  /* Cho pill bay-out smooth khi scroll */
  scroll-behavior: smooth;
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

/* ③ 4 tabs — single active */
.cfb-tabs {
  display: flex;
  padding: 0 14px;
  gap: 2px;
  border-bottom: 1px solid #F3F4F6;
  background: white;
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
.cfb-tab .ic { width: 13px; height: 13px; }
.cfb-tab .tab-count {
  background: #F3F4F6;
  color: #4B5563;
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 5px;
  font-weight: 700;
  min-width: 16px;
  text-align: center;
}
.cfb-tab.active .tab-count { background: #EEF2FF; color: #4338CA; }

/* ④ Mini row — half height, muted */
.cfb-mini {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 14px;
  background: #FAFBFC;
  font-size: 10.5px;
  color: #9CA3AF;
  border-bottom: 1px solid #F3F4F6;
  min-height: 22px;
}
.mini-count strong { color: #4B5563; font-weight: 600; }
.mini-count .dot { margin: 0 4px; color: #D1D5DB; }
.mini-count .accent { color: #EF4444; font-weight: 600; }
.mini-sort {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  font-weight: 500;
  font-size: 10.5px;
  font-family: inherit;
  transition: color 0.15s, background 0.15s;
}
.mini-sort:hover { color: #4338CA; background: white; }
.mini-sort .ic { width: 10px; height: 10px; opacity: 0.7; }
</style>
