<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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

    <!-- ② 4 tabs row — Main Tab style, chia 4 equal, KHÔNG icon KHÔNG count.
         User spec: "Đây dạng Main Tab — fix size không cần đếm số hội thoại". -->
    <div class="cfb-tabs main-tab-style">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="cfb-tab"
        :class="{
          active: filters.state.activeTab === tab.key,
          'has-unread': tab.key === 'other' && priorityHasUnread,
        }"
        @click="setActiveTab(tab.key)"
        :title="tab.tooltip"
      >
        <span class="tab-label">{{ tab.label }}</span>
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
  /** 2026-06-11 — tab Ưu tiên KHÔNG hiện số đếm, nhưng IN ĐẬM hơn khi có hội thoại
   *  chưa đọc trong tab này. Đọc hết → hết đậm. ChatView truyền cờ này xuống. */
  priorityHasUnread?: boolean;
}>();

// 2026-06-20: phát khi click LẠI tab đang active → ChatView clear ô tìm kiếm.
const emit = defineEmits<{ 'reselect-tab': [] }>();

type TabKey = 'personal' | 'group' | 'main' | 'other';

const TABS: Array<{
  key: TabKey;
  label: string;
  tooltip: string;
}> = [
  { key: 'personal', label: 'Cá nhân', tooltip: 'Chỉ hội thoại 1-1 (user với user)' },
  { key: 'group',    label: 'Nhóm',    tooltip: 'Chỉ hội thoại nhóm' },
  { key: 'main',     label: 'Chính',   tooltip: 'Hộp thư chính (cả user lẫn nhóm)' },
  // 2026-06-11 — đổi "Khác" → "Ưu tiên" (key 'other' giữ nguyên, load-bearing
  // ở use-inbox-filters + PATCH /:id/tab). Hội thoại chuyển vào đây sẽ KHÔNG còn
  // ở tab Cá nhân nữa (loại trừ lẫn nhau, xử lý ở backend).
  { key: 'other',    label: 'Ưu tiên', tooltip: 'Hội thoại ưu tiên (đã ghim từ menu chuột phải)' },
];

function setActiveTab(key: TabKey) {
  // 2026-06-20 (anh báo): click LẠI tab đang active cũng phải clear ô tìm kiếm. activeTab
  // không đổi → watch ở ChatView không fire → emit 'reselect-tab' để parent tự clear search.
  const sameTab = props.filters.state.activeTab === key;
  // Single-active: tab khác sẽ tự deselect.
  props.filters.state.activeTab = key;
  if (sameTab) emit('reselect-tab');
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

/* ① Quick pills — 4 pills chia ĐỀU, vừa khít khung cột 2, KHÔNG scroll ngang */
.cfb-pills-wrap {
  border-bottom: 1px solid #F3F4F6;
}
.cfb-pills {
  display: flex;
  gap: 4px;
  padding: 7px 10px;
  align-items: center;
}

/* Pill: 2-line layout (label trên, count dưới) — fit gọn trong ~76px/pill
   Cách này tránh ellipsis label "Chưa đọc" → "Ch..." khi cột 2 hẹp. */
.pill {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 5px 4px 4px;
  border-radius: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  border: 1px solid #E5E7EB;
  background: white;
  color: #4B5563;
  font-family: inherit;
  line-height: 1.2;
}
.pill .pill-label {
  font-size: 10.5px;
  white-space: nowrap;
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
/* Count dưới label (2-line layout) — compact, đậm */
.pill .count {
  color: #6B7280;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  transition: color 0.18s ease;
}
/* Active state: count inherit accent color (không cần background — 2-line clean) */
.pill.alert.active .count { color: #B91C1C; }
.pill.warning.active .count { color: #B45309; }
.pill.danger.active .count { color: #B91C1C; }
.pill.success.active .count { color: #047857; }

/* ② Main Tab style — 4 tabs prominent, fix size, KHÔNG count */
.cfb-tabs.main-tab-style {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 6px;
  margin: 8px 10px 0;
  background: #F3F4F6;
  border-radius: 10px;
  gap: 2px;
  border-bottom: none;
}
.cfb-tabs.main-tab-style .cfb-tab {
  padding: 7px 1px;
  text-align: center;
  /* 2026-06-11 — "Ưu tiên" (7 ký tự) dài hơn "Khác"; giảm font + padding để 4 tab
     đều không bị cắt chữ ở 1366px. */
  font-size: 11px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: #6B7280;
  cursor: pointer;
  border: none;
  background: transparent;
  border-radius: 7px;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  overflow: hidden;
  font-family: inherit;
}
.cfb-tabs.main-tab-style .cfb-tab:hover {
  background: rgba(255, 255, 255, 0.6);
  color: #4338CA;
}
.cfb-tabs.main-tab-style .cfb-tab.active {
  background: white;
  color: #6366F1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(99, 102, 241, 0.1);
}
/* 2026-06-11 — tab Ưu tiên có tin chưa đọc: in ĐẬM hơn + đậm màu + chấm báo nhỏ.
   Không hiện con số (theo yêu cầu). Đọc hết → class này biến mất → trở lại thường. */
.cfb-tabs.main-tab-style .cfb-tab.has-unread:not(.active) {
  color: #111827;
  font-weight: 800;
}
.cfb-tabs.main-tab-style .cfb-tab.has-unread .tab-label::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  background: #EF4444;
  vertical-align: middle;
}
.cfb-tab .tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Main-tab: font đã đủ nhỏ để "Ưu tiên" vừa khít → không cắt ellipsis. */
.cfb-tabs.main-tab-style .cfb-tab .tab-label {
  overflow: visible;
  text-overflow: clip;
}
/* Bottom border thay cho tabs section sau khi đổi sang main-tab pill style */
.cfb-tabs.main-tab-style + .cfb-mini {
  margin-top: 8px;
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
