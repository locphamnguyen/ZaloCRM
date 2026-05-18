<template>
  <aside class="filter-sidebar" :class="{ collapsed }">
    <!-- Header: workspace + collapse -->
    <header class="fs-header">
      <div class="fs-workspace" v-if="!collapsed">
        <span class="ws-dot"></span>
        <span class="ws-name">{{ workspaceName }}</span>
      </div>
      <button class="fs-collapse-btn" :title="collapsed ? 'Mở rộng' : 'Thu gọn'" @click="toggleCollapsed">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline :points="collapsed ? '13 17 18 12 13 7' : '11 17 6 12 11 7'" />
          <polyline :points="collapsed ? '6 17 11 12 6 7' : '18 17 13 12 18 7'" />
        </svg>
      </button>
    </header>

    <div v-if="!collapsed" class="fs-scroll">
      <!-- Search box -->
      <div class="fs-search-box">
        <svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <input v-model="searchInner" placeholder="Tìm thư mục, nick, bộ lọc..." />
      </div>

      <!-- ══════ 1. THƯ MỤC NICK ZALO ══════ -->
      <section class="fs-section">
        <header class="fs-section-header">
          <span class="fs-section-title">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            Thư mục Nick Zalo
          </span>
          <button class="fs-section-action" @click="$emit('manage-folders')">Quản lý</button>
        </header>

        <!-- ALL (system default) -->
        <div
          class="folder-flat-item"
          :class="{ selected: filters.state.folderId === null }"
          @click="onSelectFolder(null)"
        >
          <div class="composite-avatar">
            <div class="av-mini" style="background: linear-gradient(135deg, #818CF8, #6366F1)">A</div>
            <div class="av-mini" style="background: linear-gradient(135deg, #FBBF24, #F59E0B)">L</div>
          </div>
          <div class="folder-flat-info">
            <div class="folder-flat-name">ALL (toàn bộ)</div>
            <div class="folder-flat-sub">{{ allAccountsCount || 0 }} nick · {{ totalUnread || 0 }} chưa đọc</div>
          </div>
          <span v-if="(totalUnread || 0) > 0" class="folder-flat-badge">{{ totalUnread || 0 }}</span>
        </div>

        <!-- User folders -->
        <div
          v-for="folder in filteredFolders"
          :key="folder.id"
          class="folder-flat-item"
          :class="{ selected: filters.state.folderId === folder.id }"
          @click="onSelectFolder(folder.id)"
        >
          <div class="composite-avatar">
            <div
              v-for="(m, idx) in folder.members.slice(0, 2)"
              :key="m.id"
              class="av-mini"
              :class="`av-${idx}`"
              :style="avatarStyle(m, idx)"
            >
              {{ initials(m.displayName) }}
            </div>
            <div v-if="folder.members.length === 0" class="av-mini" style="background: #E5E7EB; color: #9CA3AF">?</div>
          </div>
          <div class="folder-flat-info">
            <div class="folder-flat-name">{{ folder.name }}</div>
            <div class="folder-flat-sub">
              {{ folder.members.length }} nick · {{ folder.unreadCount }} chưa đọc
            </div>
          </div>
          <span v-if="folder.unreadCount > 0" class="folder-flat-badge">{{ folder.unreadCount }}</span>
        </div>

        <button class="fs-footer-btn create" @click="$emit('manage-folders')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Tạo thư mục mới
        </button>
      </section>

      <!-- ══════ 2. BỘ LỌC ĐÃ LƯU ══════ -->
      <section class="fs-section divider">
        <header class="fs-section-header">
          <span class="fs-section-title">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
            Bộ lọc đã lưu
          </span>
        </header>
        <div
          v-for="preset in filteredPresets"
          :key="preset.id"
          class="preset-row"
          :class="{ active: filters.activePresetId.value === preset.id }"
          @click="onSelectPreset(preset)"
        >
          <span class="preset-emoji">{{ preset.emoji || '⭐' }}</span>
          <span class="preset-name">{{ preset.name }}</span>
          <button class="preset-delete" :title="`Xoá ${preset.name}`" @click.stop="onDeletePreset(preset.id)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        </div>
        <button class="preset-add-row" @click="onCreatePreset">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Lưu bộ lọc hiện tại
        </button>
      </section>

      <!-- ══════ 3. SALE PHỤ TRÁCH ══════ -->
      <section class="fs-section divider">
        <header class="fs-section-header">
          <span class="fs-section-title">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            Sale phụ trách
          </span>
        </header>
        <div
          class="radio-option"
          :class="{ selected: filters.state.saleAssigneeId === null }"
          @click="onSelectSale(null)"
        >
          <span class="radio-dot"></span>
          <div class="avatar-mini">{{ currentUserInitial }}</div>
          <span class="label">Tôi ({{ currentUserName }})</span>
        </div>
        <div
          class="radio-option"
          :class="{ selected: filters.state.saleAssigneeId === 'all' }"
          @click="onSelectSale('all')"
        >
          <span class="radio-dot"></span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          <span class="label">Tất cả</span>
        </div>
      </section>

      <!-- ══════ 4. THỜI GIAN ══════ -->
      <section class="fs-section divider">
        <header class="fs-section-header">
          <span class="fs-section-title">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            Thời gian
          </span>
        </header>
        <div
          v-for="axis in TIME_AXES"
          :key="axis.key"
          class="time-axis-row"
          :class="{ active: filters.state.timeAxis === axis.key }"
          @click="filters.state.timeAxis = axis.key"
        >
          <span>{{ axis.label }}</span>
        </div>
        <div class="time-range-pill-row">
          <span
            v-for="range in TIME_RANGES"
            :key="range.key"
            class="time-range-pill"
            :class="{ active: filters.state.timeRangePreset === range.key }"
            @click="filters.state.timeRangePreset = range.key as any"
          >
            {{ range.label }}
          </span>
        </div>
      </section>

      <!-- ══════ 5. TIP CÚ PHÁP ══════ -->
      <section class="fs-section divider">
        <div class="smart-search-tip">
          <div class="tip-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
            Cú pháp tìm kiếm
          </div>
          <ul>
            <li><code>tag:vip</code> · KH có nhãn</li>
            <li><code>score:&gt;70</code> · Điểm cao</li>
            <li><code>stage:Nóng</code> · Theo stage</li>
            <li><code>silent:&gt;7d</code> · Im lặng</li>
          </ul>
        </div>
      </section>
    </div>

    <!-- Footer: clear filters -->
    <button v-if="!collapsed && filters.hasActiveFilter.value" class="fs-clear-btn" @click="filters.clearAll">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      Xoá tất cả bộ lọc
    </button>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { AccountFolder, SavedFilterPreset } from '@/composables/use-inbox-filters';

const props = defineProps<{
  filters: any; // useInboxFilters() return — typed via destructure later
  workspaceName?: string;
  currentUserName?: string;
  currentUserId?: string;
  allAccountsCount?: number;
  totalUnread?: number;
}>();

defineEmits<{
  'manage-folders': [];
  'change': [];
}>();

const collapsed = ref(localStorage.getItem('filter-sidebar-collapsed') === '1');
function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  localStorage.setItem('filter-sidebar-collapsed', collapsed.value ? '1' : '0');
}

const searchInner = ref('');

const currentUserInitial = computed(() => {
  const name = props.currentUserName || 'Tôi';
  return name.split(' ').filter(Boolean).pop()?.[0]?.toUpperCase() || 'T';
});

const TIME_AXES = [
  { key: 'last-interaction', label: 'Tương tác gần nhất' },
  { key: 'oldest', label: 'Lâu nhất (stale)' },
  { key: 'crm-added', label: 'Thêm vào CRM' },
  { key: 'last-inbound', label: 'Tin nhắn KH cuối' },
] as const;

const TIME_RANGES = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'custom', label: 'Tuỳ chỉnh...' },
] as const;

const filteredFolders = computed<AccountFolder[]>(() => {
  const q = searchInner.value.trim().toLowerCase();
  if (!q) return props.filters.folders.value;
  return props.filters.folders.value.filter((f: AccountFolder) =>
    f.name.toLowerCase().includes(q)
  );
});

const filteredPresets = computed<SavedFilterPreset[]>(() => {
  const q = searchInner.value.trim().toLowerCase();
  if (!q) return props.filters.presets.value;
  return props.filters.presets.value.filter((p: SavedFilterPreset) =>
    p.name.toLowerCase().includes(q)
  );
});

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #34D399, #10B981)',
  'linear-gradient(135deg, #FB923C, #F97316)',
  'linear-gradient(135deg, #F472B6, #EC4899)',
  'linear-gradient(135deg, #60A5FA, #3B82F6)',
  'linear-gradient(135deg, #A78BFA, #8B5CF6)',
  'linear-gradient(135deg, #FCA5A5, #F87171)',
];

function avatarStyle(member: AccountFolder['members'][number], idx: number) {
  if (member.avatarUrl) {
    return { backgroundImage: `url(${member.avatarUrl})` };
  }
  return { background: AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length] };
}

function onSelectFolder(id: string | null) {
  props.filters.setFolder(id);
}

function onSelectPreset(preset: SavedFilterPreset) {
  props.filters.applyPreset(preset);
}

async function onDeletePreset(id: string) {
  if (!confirm('Xoá bộ lọc này?')) return;
  await props.filters.deletePreset(id);
}

async function onCreatePreset() {
  const name = prompt('Tên bộ lọc:');
  if (!name?.trim()) return;
  const emoji = prompt('Emoji (tuỳ chọn, vd ☀️ 🥶 🔥):') || '⭐';
  await props.filters.createPreset({ name: name.trim(), emoji });
}

function onSelectSale(value: string | null | 'all') {
  props.filters.state.saleAssigneeId = value;
}

onMounted(async () => {
  await Promise.all([props.filters.fetchFolders(), props.filters.fetchPresets()]);
});

// Emit change khi filter state thay đổi (để parent refetch conv list)
watch(
  () => props.filters.state,
  () => {
    /* parent watches buildQueryParams() directly */
  },
  { deep: true }
);
</script>

<style scoped>
.filter-sidebar {
  width: 260px;
  background: #FAFBFC;
  border-right: 1px solid #E5E7EB;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100vh;
  position: sticky;
  top: 0;
  font-family: -apple-system, "Segoe UI", "Inter", system-ui, sans-serif;
}
.filter-sidebar.collapsed { width: 56px; }

.fs-header {
  padding: 14px 16px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #E5E7EB;
  background: white;
}
.fs-workspace {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
  color: #111827;
}
.ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10B981;
}
.fs-collapse-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6B7280;
  cursor: pointer;
}
.fs-collapse-btn:hover { background: #F3F4F6; color: #6366F1; }

.fs-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.fs-scroll::-webkit-scrollbar { width: 4px; }
.fs-scroll::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 2px; }

.fs-search-box {
  margin: 8px 14px 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  padding: 7px 10px;
}
.fs-search-box:focus-within { border-color: #6366F1; }
.fs-search-box input {
  border: none;
  background: transparent;
  outline: none;
  flex: 1;
  font-size: 12.5px;
  color: #111827;
  font-family: inherit;
}
.fs-search-box input::placeholder { color: #9CA3AF; }
.fs-search-box .ic { color: #9CA3AF; flex-shrink: 0; }

.fs-section { padding: 6px 0; }
.fs-section.divider {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #F3F4F6;
}
.fs-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 16px 6px;
}
.fs-section-title {
  font-size: 10.5px;
  font-weight: 700;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fs-section-title .ic { width: 12px; height: 12px; color: #9CA3AF; }
.fs-section-action {
  font-size: 11px;
  color: #6366F1;
  font-weight: 600;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.fs-section-action:hover { text-decoration: underline; }

/* Folder flat item */
.folder-flat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.folder-flat-item:hover { background: rgba(99, 102, 241, 0.06); }
.folder-flat-item.selected {
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.04));
  box-shadow: inset 3px 0 0 #6366F1;
}

.composite-avatar {
  width: 38px;
  height: 28px;
  position: relative;
  flex-shrink: 0;
}
.composite-avatar .av-mini {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border: 1.5px solid white;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 9px;
  font-weight: 700;
  background-size: cover;
  background-position: center;
}
.composite-avatar .av-mini.av-0 { top: 0; left: 0; z-index: 1; }
.composite-avatar .av-mini.av-1 { bottom: 0; right: 0; z-index: 2; }
.composite-avatar .av-mini:only-child {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  position: relative;
}

.folder-flat-info { flex: 1; min-width: 0; }
.folder-flat-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder-flat-item.selected .folder-flat-name { color: #4338CA; }
.folder-flat-sub {
  font-size: 10.5px;
  color: #9CA3AF;
  font-weight: 500;
  margin-top: 1px;
}
.folder-flat-badge {
  background: #EF4444;
  color: white;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 7px;
  font-weight: 700;
  flex-shrink: 0;
}

/* Saved presets */
.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
  font-size: 12px;
  color: #4B5563;
  transition: background 0.15s;
  position: relative;
}
.preset-row:hover { background: rgba(99, 102, 241, 0.06); }
.preset-row.active {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.08));
  color: #4338CA;
  font-weight: 600;
}
.preset-emoji { font-size: 14px; flex-shrink: 0; }
.preset-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preset-delete {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: #9CA3AF;
  opacity: 0;
  transition: opacity 0.15s;
}
.preset-row:hover .preset-delete { opacity: 1; }
.preset-delete:hover { color: #EF4444; }
.preset-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  font-size: 11.5px;
  color: #9CA3AF;
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
  font-weight: 600;
  font-family: inherit;
}
.preset-add-row:hover { color: #6366F1; }

/* Radio option */
.radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 12px;
  color: #4B5563;
  transition: background 0.15s;
}
.radio-option:hover { background: rgba(99, 102, 241, 0.06); }
.radio-option.selected { color: #4338CA; font-weight: 600; }
.radio-option .radio-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #D1D5DB;
  flex-shrink: 0;
  position: relative;
}
.radio-option.selected .radio-dot { border-color: #6366F1; }
.radio-option.selected .radio-dot::after {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6366F1;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.radio-option .label { flex: 1; }
.radio-option .avatar-mini {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(135deg, #34D399, #10B981);
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Time axis */
.time-axis-row {
  padding: 7px 14px;
  border-radius: 0;
  margin: 0 8px 3px;
  cursor: pointer;
  font-size: 12px;
  color: #4B5563;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
}
.time-axis-row:hover { border-color: #6366F1; color: #4338CA; }
.time-axis-row.active {
  background: #EEF2FF;
  color: #4338CA;
  border-color: #C7D2FE;
  font-weight: 600;
}
.time-range-pill-row {
  display: flex;
  gap: 4px;
  margin: 8px 14px 4px;
  flex-wrap: wrap;
}
.time-range-pill {
  font-size: 10.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: white;
  border: 1px solid #E5E7EB;
  color: #4B5563;
  cursor: pointer;
  font-weight: 600;
}
.time-range-pill.active { background: #111827; color: white; border-color: #111827; }
.time-range-pill:hover:not(.active) { border-color: #6366F1; color: #4338CA; }

/* Smart search tip */
.smart-search-tip {
  margin: 4px 14px;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  padding: 10px;
  font-size: 11px;
  color: #4B5563;
}
.smart-search-tip .tip-title {
  font-weight: 700;
  color: #111827;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.smart-search-tip code {
  background: #EEF2FF;
  color: #4338CA;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 600;
}
.smart-search-tip ul { list-style: none; margin-top: 4px; padding-left: 0; }
.smart-search-tip li { padding: 2px 0; }

/* Footer buttons */
.fs-footer-btn {
  margin: 6px 14px 4px;
  padding: 7px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-family: inherit;
  transition: all 0.15s;
}
.fs-footer-btn.create {
  background: white;
  border: 1px dashed #D1D5DB;
  color: #6B7280;
}
.fs-footer-btn.create:hover {
  color: #6366F1;
  border-color: #6366F1;
  background: #FAFBFC;
}

.fs-clear-btn {
  margin: 10px 14px 14px;
  padding: 8px;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 7px;
  color: #6B7280;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-family: inherit;
}
.fs-clear-btn:hover { color: #EF4444; border-color: #FCA5A5; }
</style>
