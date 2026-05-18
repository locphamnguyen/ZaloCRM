<template>
  <div class="cfb">
    <!-- ① Quick pills row — soft button, no icon, count fixed-slot tránh nhảy UI -->
    <div class="cfb-pills-wrap">
      <div class="cfb-pills">
        <button
          class="pill alert"
          :class="{ active: filters.state.quickPills.has('unread') }"
          @click="filters.toggleQuickPill('unread')"
        >
          <span class="pill-label">Chưa đọc</span>
          <span class="count">{{ counts.unread ?? 0 }}</span>
        </button>
        <button
          class="pill warning"
          :class="{ active: filters.state.quickPills.has('unanswered') }"
          @click="filters.toggleQuickPill('unanswered')"
        >
          <span class="pill-label">Chưa rep</span>
          <span class="count">{{ counts.unanswered ?? 0 }}</span>
        </button>
        <button
          class="pill danger"
          :class="{ active: filters.state.quickPills.has('stuck') }"
          @click="filters.toggleQuickPill('stuck')"
        >
          <span class="pill-label">Đình trệ</span>
          <span class="count">{{ counts.stuck ?? 0 }}</span>
        </button>
        <button
          class="pill success"
          :class="{ active: filters.state.quickPills.has('ready') }"
          @click="filters.toggleQuickPill('ready')"
        >
          <span class="pill-label">Sẵn sàng</span>
          <span class="count">{{ counts.ready ?? 0 }}</span>
        </button>
      </div>
    </div>

    <!-- ② 4 tabs row — chia 4 cố định, text + count, KHÔNG icon, single active -->
    <div class="cfb-tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="cfb-tab"
        :class="{ active: filters.state.activeTab === tab.key }"
        @click="setActiveTab(tab.key)"
        :title="tab.tooltip"
      >
        <span class="tab-label">{{ tab.label }}</span>
        <span class="tab-count">{{ tabCount(tab.key) ?? 0 }}</span>
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
  tooltip: string;
}> = [
  { key: 'personal', label: 'Cá nhân', tooltip: 'Chỉ hội thoại 1-1 (user với user)' },
  { key: 'group',    label: 'Nhóm',    tooltip: 'Chỉ hội thoại nhóm' },
  { key: 'main',     label: 'Chính',   tooltip: 'Hộp thư chính (cả user lẫn nhóm)' },
  { key: 'other',    label: 'Khác',    tooltip: 'Hội thoại đã move qua Khác' },
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

/* ① Quick pills — soft button, no icon, count fixed-slot, gentle color khi active */
.cfb-pills-wrap {
  border-bottom: 1px solid #F3F4F6;
  overflow: hidden;
  position: relative;
}
.cfb-pills {
  display: flex;
  gap: 6px;
  padding: 8px 14px;
  overflow-x: auto;
  scrollbar-width: none;
  align-items: center;
  scroll-behavior: smooth;
}
.cfb-pills::-webkit-scrollbar { display: none; }

/* Pill: nhẹ nhàng, soft button, không có dark fill khi active.
   Active = light tint background + accent border (gentle color change). */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 14px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  /* Critical: KHÔNG transition width/padding để tránh nhảy UI khi click */
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  border: 1px solid #E5E7EB;
  background: white;
  color: #4B5563;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: inherit;
  /* Tránh layout shift khi count đổi width — min-width đảm bảo width stable */
  min-width: 0;
}
.pill:hover {
  background: #FAFBFC;
  border-color: #D1D5DB;
  color: #111827;
}
.pill .pill-label {
  font-weight: 500;
}

/* Active state: light tint + colored border (no dark solid bg) */
.pill.alert.active {
  background: #FEF2F2;
  border-color: #FCA5A5;
  color: #B91C1C;
  font-weight: 600;
}
.pill.warning.active {
  background: #FFFBEB;
  border-color: #FCD34D;
  color: #B45309;
  font-weight: 600;
}
.pill.danger.active {
  background: #FEF2F2;
  border-color: #F87171;
  color: #B91C1C;
  font-weight: 600;
}
.pill.success.active {
  background: #F0FDF4;
  border-color: #86EFAC;
  color: #047857;
  font-weight: 600;
}

/* Count: fixed slot, monospace tiny, always visible */
.pill .count {
  background: #F3F4F6;
  color: #6B7280;
  padding: 1px 6px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 22px;
  text-align: center;
  /* Tránh inherit transitions của parent pill */
  transition: background-color 0.18s ease, color 0.18s ease;
}
.pill.alert.active .count { background: rgba(220, 38, 38, 0.12); color: #B91C1C; }
.pill.warning.active .count { background: rgba(245, 158, 11, 0.15); color: #B45309; }
.pill.danger.active .count { background: rgba(239, 68, 68, 0.12); color: #B91C1C; }
.pill.success.active .count { background: rgba(16, 185, 129, 0.12); color: #047857; }

/* ② 4 tabs — chia 4 cố định, KHÔNG icon, text + count, single active.
   Compact để fit Cột 2 hẹp 340px (mỗi tab ~85px). */
.cfb-tabs {
  display: flex;
  padding: 0 4px;
  border-bottom: 1px solid #F3F4F6;
  background: white;
}
.cfb-tab {
  /* Chia đều 4 cột — flex 1 1 0 ép equal width bất kể content */
  flex: 1 1 0;
  min-width: 0;
  padding: 10px 2px 12px;
  text-align: center;
  font-size: 12.5px;
  font-weight: 500;
  color: #6B7280;
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.18s ease, border-color 0.18s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* Quan trọng: KHÔNG cho text wrap → giữ width cố định */
  white-space: nowrap;
  overflow: hidden;
  font-family: inherit;
}
.cfb-tab:hover { color: #4338CA; }
.cfb-tab.active {
  color: #6366F1;
  font-weight: 600;
  border-bottom-color: #6366F1;
}
.cfb-tab .tab-label {
  /* Không cắt label — flex-shrink: 0 giữ nguyên kích thước */
  flex-shrink: 0;
}
.cfb-tab .tab-count {
  background: #F3F4F6;
  color: #6B7280;
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 5px;
  font-weight: 700;
  min-width: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  transition: background-color 0.18s ease, color 0.18s ease;
  flex-shrink: 0;
}
.cfb-tab.active .tab-count {
  background: #EEF2FF;
  color: #4338CA;
}

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
