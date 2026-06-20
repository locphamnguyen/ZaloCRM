<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="settings-layout">
    <!-- Sidebar -->
    <aside class="sl-sidebar" aria-label="Cài đặt sidebar">
      <header class="sl-header">
        <h1 class="sl-title">
          <v-icon class="sl-icon" icon="mdi-cog-outline" size="20" />
          <span>Cài đặt</span>
        </h1>
      </header>

      <div class="sl-search">
        <v-icon class="ic" icon="mdi-magnify" size="16" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Tìm cài đặt..."
          aria-label="Tìm cài đặt"
        />
        <button v-if="searchQuery" type="button" class="sl-search-clear" @click="searchQuery = ''" aria-label="Xoá tìm kiếm">✕</button>
      </div>

      <nav class="sl-nav" :aria-label="searchQuery ? 'Kết quả tìm kiếm' : 'Cài đặt'">
        <!-- Search results -->
        <div v-if="searchQuery" class="sl-search-results">
          <div v-if="searchResults.length === 0" class="sl-empty">
            Không tìm thấy "{{ searchQuery }}"
          </div>
          <RouterLink
            v-for="item in searchResults"
            :key="`sr-${item.route}`"
            :to="item.route"
            class="sl-item"
            :class="{ active: isItemActive(item.route) }"
          >
            <v-icon class="sl-item-icon" :icon="item.icon" size="18" />
            <span class="sl-item-label">{{ item.label }}</span>
            <span v-if="item.comingSoon" class="sl-lock" title="Sắp ra mắt">🔒</span>
          </RouterLink>
        </div>

        <!-- Grouped nav -->
        <div v-else>
          <div v-for="group in visibleGroups" :key="group.id" class="sl-group">
            <button
              type="button"
              class="sl-group-header"
              :class="{ collapsed: !openGroups[group.id] }"
              @click="toggleGroup(group.id)"
            >
              <v-icon class="sl-group-icon" :icon="group.icon" size="17" />
              <span class="sl-group-label">{{ group.label }}</span>
              <span class="sl-chevron">▾</span>
            </button>
            <div v-if="openGroups[group.id]" class="sl-group-body">
              <RouterLink
                v-for="item in group.items"
                :key="item.route"
                :to="item.route"
                class="sl-item"
                :class="{ active: isItemActive(item.route) }"
              >
                <v-icon class="sl-item-icon" :icon="item.icon" size="18" />
                <span class="sl-item-label">{{ item.label }}</span>
                <span v-if="item.comingSoon" class="sl-lock" title="Sắp ra mắt">🔒</span>
              </RouterLink>
            </div>
          </div>
        </div>
      </nav>
    </aside>

    <!-- Content panel -->
    <main class="sl-content" role="main">
      <header class="sl-breadcrumb" v-if="activeItem">
        <RouterLink to="/settings" class="bc-root">Cài đặt</RouterLink>
        <span class="bc-sep">/</span>
        <span class="bc-group">{{ activeItem.group.label }}</span>
        <span class="bc-sep">/</span>
        <span class="bc-current">{{ activeItem.item.label }}</span>
      </header>
      <div class="sl-content-body">
        <RouterView />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsNav } from '@/composables/use-settings-nav';

const route = useRoute();
const router = useRouter();
const { visibleGroups, activeItem, searchItems, defaultRoute } = useSettingsNav();

// Active class check — support query param (vd /settings/channels/zalo?tab=internal-contact
// active KHÁC /settings/channels/zalo plain — 2 entry trỏ cùng path nhưng tab khác).
function isItemActive(itemRoute: string): boolean {
  const [itemPath, itemQuery] = itemRoute.split('?');
  if (itemPath !== route.path) return false;
  if (!itemQuery) {
    // Item không query → active chỉ khi current cũng không match query của entry khác
    const currentTab = route.query.tab as string | undefined;
    return !currentTab;
  }
  const expected = new URLSearchParams(itemQuery).get('tab');
  return expected === (route.query.tab as string | undefined);
}

const searchQuery = ref('');

// Group collapsed state — persist in localStorage
const SECTION_KEY_PREFIX = 'settings-nav.group.';
function loadGroupState(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const g of visibleGroups.value) {
    const raw = localStorage.getItem(SECTION_KEY_PREFIX + g.id);
    // Default open = true, except 'dev' which defaults closed for cleaner first impression
    const defaultOpen = g.id !== 'dev';
    result[g.id] = raw === null ? defaultOpen : raw === '1';
  }
  return result;
}
const openGroups = reactive<Record<string, boolean>>(loadGroupState());

function toggleGroup(id: string) {
  openGroups[id] = !openGroups[id];
  localStorage.setItem(SECTION_KEY_PREFIX + id, openGroups[id] ? '1' : '0');
}

// Auto-open group of active item
watch(activeItem, (info) => {
  if (info) openGroups[info.group.id] = true;
}, { immediate: true });

// Re-init openGroups when visibleGroups changes (e.g., role loads after login)
watch(visibleGroups, (groups) => {
  for (const g of groups) {
    if (!(g.id in openGroups)) {
      const raw = localStorage.getItem(SECTION_KEY_PREFIX + g.id);
      const defaultOpen = g.id !== 'dev';
      openGroups[g.id] = raw === null ? defaultOpen : raw === '1';
    }
  }
});

const searchResults = computed(() => searchItems(searchQuery.value));

// Redirect /settings (no subroute) to default item
onMounted(() => {
  if (route.path === '/settings' || route.path === '/settings/') {
    router.replace(defaultRoute.value);
  }
});
</script>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  height: calc(100vh - 56px);
  background: #FAFAFC;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13.5px;
  color: #1F2D3D;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.005em;
}

/* ── Sidebar ── */
.sl-sidebar {
  background: white;
  border-right: 1px solid #E4E5E9;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sl-header {
  padding: 16px 18px 12px;
  border-bottom: 1px solid #E4E5E9;
  flex-shrink: 0;
}
.sl-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #1F2D3D;
  margin: 0;
}
.sl-icon {
  font-size: 16px;
}

.sl-search {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #E4E5E9;
  background: white;
  flex-shrink: 0;
}
.sl-search input {
  flex: 1;
  border: none;
  outline: none;
  background: #F4F4F7;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12.5px;
  font-family: inherit;
  color: #1F2D3D;
  min-width: 0;
  border: 1px solid transparent;
}
.sl-search input:focus {
  background: white;
  border-color: #5E6AD2;
  box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.12);
}
.sl-search .ic {
  color: #97A0AC;
  font-size: 13px;
}
.sl-search-clear {
  background: transparent;
  border: none;
  color: #97A0AC;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 10px;
}
.sl-search-clear:hover { color: #EF4444; background: #FEF2F2; }

.sl-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px 6px 16px;
}
.sl-nav::-webkit-scrollbar { width: 5px; }
.sl-nav::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 2px; }

.sl-group {
  margin-bottom: 4px;
}
.sl-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  user-select: none;
}
.sl-group-header:hover { background: #F4F4F7; }
.sl-group-icon {
  font-size: 13px;
  flex-shrink: 0;
}
.sl-group-label {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sl-chevron {
  color: #97A0AC;
  font-size: 10px;
  transition: transform 0.15s;
}
.sl-group-header.collapsed .sl-chevron {
  transform: rotate(-90deg);
}

.sl-group-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0 6px 8px;
}
.sl-search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sl-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: #1F2D3D;
  font-size: 12.5px;
  font-weight: 500;
  transition: all 0.12s;
}
.sl-item:hover {
  background: #F4F4F7;
}
.sl-item.active,
.sl-item.router-link-exact-active {
  background: #EEF0FF;
  color: #5E6AD2;
  font-weight: 600;
  box-shadow: inset 3px 0 0 #5E6AD2;
}
.sl-item-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.sl-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sl-lock {
  font-size: 11px;
  opacity: 0.6;
  flex-shrink: 0;
}
.sl-empty {
  padding: 20px 14px;
  font-size: 12px;
  color: #97A0AC;
  text-align: center;
  font-style: italic;
}

/* ── Content ── */
.sl-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #FAFAFC;
}
.sl-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  font-size: 12px;
  color: #6B7785;
  background: white;
  border-bottom: 1px solid #E4E5E9;
  flex-shrink: 0;
}
.bc-root {
  color: #5E6AD2;
  text-decoration: none;
  font-weight: 500;
}
.bc-root:hover { text-decoration: underline; }
.bc-sep {
  color: #D4D6DB;
}
.bc-group {
  color: #6B7785;
}
.bc-current {
  color: #1F2D3D;
  font-weight: 600;
}
.sl-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}
.sl-content-body::-webkit-scrollbar { width: 8px; }
.sl-content-body::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 4px; }
</style>
