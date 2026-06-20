<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="al-view">
    <header class="al-header">
      <button class="back-btn" @click="$router.back()">← Quay lại</button>
      <h1>
        📋 Lịch sử hoạt động
        <span v-if="contactName" class="al-contact-name">— {{ contactName }}</span>
      </h1>
      <div class="al-actions">
        <button class="export-btn" :disabled="exporting" @click="exportCsv">
          {{ exporting ? '⏳ Đang xuất…' : '⬇️ Xuất CSV' }}
        </button>
      </div>
    </header>

    <div class="al-layout">
      <!-- Filter sidebar -->
      <aside class="al-filters" :class="{ open: filterDrawerOpen }">
        <button class="drawer-close" @click="filterDrawerOpen = false">×</button>

        <section class="filter-block">
          <h3>📅 Khoảng thời gian</h3>
          <div class="quick-dates">
            <button
              v-for="opt in DATE_PRESETS"
              :key="opt.label"
              class="chip"
              :class="{ active: activePreset === opt.value }"
              @click="applyDatePreset(opt.value)"
            >{{ opt.label }}</button>
          </div>
          <div class="date-inputs">
            <label>
              <span>Từ</span>
              <input type="date" v-model="fromDate" @change="onFilterChange" />
            </label>
            <label>
              <span>Đến</span>
              <input type="date" v-model="toDate" @change="onFilterChange" />
            </label>
          </div>
        </section>

        <section class="filter-block">
          <h3>🏷 Loại hoạt động</h3>
          <div class="cat-list">
            <label
              v-for="cat in ALL_CATEGORIES"
              :key="cat"
              class="cat-row"
            >
              <input
                type="checkbox"
                :checked="selectedCategories.has(cat)"
                @change="toggleCategory(cat)"
              />
              <span class="cat-icon" :style="`color: ${CATEGORY_META[cat].color}`">{{ CATEGORY_META[cat].icon }}</span>
              <span class="cat-label">{{ CATEGORY_META[cat].label }}</span>
            </label>
          </div>
          <button class="text-link" @click="selectAllCategories">Chọn tất cả</button>
          <button class="text-link" @click="clearCategories">Bỏ chọn</button>
        </section>

        <section class="filter-block">
          <h3>👤 Người thực hiện</h3>
          <label class="actor-row">
            <input type="checkbox" :checked="actorTypes.has('user')" @change="toggleActorType('user')" />
            <span>👤 Người dùng (sale/admin)</span>
          </label>
          <label class="actor-row">
            <input type="checkbox" :checked="actorTypes.has('bot')" @change="toggleActorType('bot')" />
            <span>🤖 Bot (automation)</span>
          </label>
          <label class="actor-row">
            <input type="checkbox" :checked="actorTypes.has('system')" @change="toggleActorType('system')" />
            <span>⚙️ Hệ thống</span>
          </label>
        </section>

        <section class="filter-block">
          <h3>🔍 Tìm kiếm</h3>
          <input
            type="text"
            v-model="search"
            placeholder="Tìm trong action / details…"
            @keyup.enter="onFilterChange"
            class="search-input"
          />
          <button class="text-link" @click="onFilterChange">Áp dụng</button>
        </section>

        <button class="reset-btn" @click="resetAllFilters">⟲ Reset tất cả</button>
      </aside>

      <!-- Main list -->
      <main class="al-main">
        <button class="filter-toggle-mobile" @click="filterDrawerOpen = true">
          🔍 Bộ lọc
          <span v-if="activeFilterCount" class="filter-count-badge">{{ activeFilterCount }}</span>
        </button>

        <div class="result-meta">
          <span>{{ items.length }} hoạt động</span>
          <span v-if="hasMore" class="muted">(còn nữa, kéo xuống xem tiếp)</span>
        </div>

        <div v-if="loading && !items.length" class="state">Đang tải…</div>
        <div v-else-if="!items.length" class="state empty">
          <span class="empty-icon">📋</span>
          <p>Không có hoạt động nào khớp bộ lọc.</p>
        </div>

        <div v-else class="items-list">
          <ActivityItem v-for="item in items" :key="item.id" :item="item" />
          <div v-if="hasMore" class="load-more">
            <button :disabled="loadingMore" @click="loadMore">
              {{ loadingMore ? 'Đang tải…' : '↓ Xem thêm' }}
            </button>
          </div>
          <div v-else class="end-marker">─ Hết ─</div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import {
  CATEGORY_META,
  ALL_CATEGORIES,
  type ActivityCategory,
} from '@/constants/activity-types';
import ActivityItem from '@/components/chat/ActivityItem.vue';
import type { ActivityLogItem } from '@/composables/use-timeline';

const route = useRoute();
const router = useRouter();
const toast = useToast();

const contactId = computed(() => route.params.id as string);
const contactName = ref<string | null>(null);

/* ── Filters state ─────────────────────────────────────────────────────── */
const DATE_PRESETS = [
  { label: 'Hôm nay',  value: '1d'   },
  { label: '7 ngày',   value: '7d'   },
  { label: '30 ngày',  value: '30d'  },
  { label: '3 tháng',  value: '90d'  },
  { label: 'Tất cả',   value: 'all'  },
];

const activePreset = ref<string>('30d');
const fromDate = ref('');
const toDate = ref('');
const selectedCategories = ref<Set<ActivityCategory>>(new Set(ALL_CATEGORIES));
const actorTypes = ref<Set<string>>(new Set(['user', 'bot', 'system']));
const search = ref('');
const filterDrawerOpen = ref(false);

const items = ref<ActivityLogItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const exporting = ref(false);
const hasMore = computed(() => nextCursor.value !== null);

const activeFilterCount = computed(() => {
  let n = 0;
  if (fromDate.value) n++;
  if (toDate.value) n++;
  if (selectedCategories.value.size < ALL_CATEGORIES.length) n++;
  if (actorTypes.value.size < 3) n++;
  if (search.value.trim()) n++;
  return n;
});

/* ── URL params <-> filter state sync ──────────────────────────────────── */
function loadFromUrl() {
  const q = route.query;
  if (q.from && typeof q.from === 'string') fromDate.value = q.from;
  if (q.to && typeof q.to === 'string') toDate.value = q.to;
  if (q.categories && typeof q.categories === 'string') {
    selectedCategories.value = new Set(q.categories.split(',').filter(c => ALL_CATEGORIES.includes(c as ActivityCategory)) as ActivityCategory[]);
  }
  if (q.actors && typeof q.actors === 'string') {
    actorTypes.value = new Set(q.actors.split(',').filter(Boolean));
  }
  if (q.search && typeof q.search === 'string') search.value = q.search;
  if (q.preset && typeof q.preset === 'string') activePreset.value = q.preset;
}

function syncUrl() {
  const q: Record<string, string> = {};
  if (fromDate.value) q.from = fromDate.value;
  if (toDate.value) q.to = toDate.value;
  if (selectedCategories.value.size < ALL_CATEGORIES.length) {
    q.categories = [...selectedCategories.value].join(',');
  }
  if (actorTypes.value.size < 3) q.actors = [...actorTypes.value].join(',');
  if (search.value.trim()) q.search = search.value.trim();
  if (activePreset.value && activePreset.value !== '30d') q.preset = activePreset.value;
  void router.replace({ query: q });
}

/* ── Preset date helpers ───────────────────────────────────────────────── */
function applyDatePreset(value: string) {
  activePreset.value = value;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  toDate.value = today;
  if (value === '1d') fromDate.value = today;
  else if (value === '7d') fromDate.value = isoMinusDays(7);
  else if (value === '30d') fromDate.value = isoMinusDays(30);
  else if (value === '90d') fromDate.value = isoMinusDays(90);
  else if (value === 'all') { fromDate.value = ''; toDate.value = ''; }
  onFilterChange();
}
function isoMinusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/* ── Filter mutations ──────────────────────────────────────────────────── */
function toggleCategory(cat: ActivityCategory) {
  const s = new Set(selectedCategories.value);
  if (s.has(cat)) s.delete(cat);
  else s.add(cat);
  selectedCategories.value = s;
  onFilterChange();
}
function selectAllCategories() {
  selectedCategories.value = new Set(ALL_CATEGORIES);
  onFilterChange();
}
function clearCategories() {
  selectedCategories.value = new Set();
  onFilterChange();
}
function toggleActorType(type: string) {
  const s = new Set(actorTypes.value);
  if (s.has(type)) s.delete(type);
  else s.add(type);
  actorTypes.value = s;
  onFilterChange();
}
function resetAllFilters() {
  activePreset.value = '30d';
  fromDate.value = isoMinusDays(30);
  toDate.value = new Date().toISOString().slice(0, 10);
  selectedCategories.value = new Set(ALL_CATEGORIES);
  actorTypes.value = new Set(['user', 'bot', 'system']);
  search.value = '';
  onFilterChange();
}
function onFilterChange() {
  // Customize date detection — clear preset nếu user sửa từ/đến thủ công
  syncUrl();
  void fetchFirstPage();
}

/* ── Fetch ─────────────────────────────────────────────────────────────── */
function buildParams(extraParams: Record<string, string> = {}): Record<string, string> {
  const params: Record<string, string> = { limit: '100', ...extraParams };
  if (selectedCategories.value.size < ALL_CATEGORIES.length) {
    params.categories = [...selectedCategories.value].join(',');
  }
  if (actorTypes.value.size < 3) {
    params.actors = [...actorTypes.value].join(',');
  }
  if (fromDate.value) params.from = fromDate.value;
  if (toDate.value) params.to = toDate.value + 'T23:59:59';
  if (search.value.trim()) params.search = search.value.trim();
  return params;
}

async function fetchFirstPage() {
  if (!contactId.value) return;
  loading.value = true;
  nextCursor.value = null;
  try {
    const { data } = await api.get(`/customers/${contactId.value}/activity-log`, {
      params: buildParams(),
    });
    items.value = data.items || [];
    nextCursor.value = data.nextCursor || null;
  } catch (err) {
    console.error(err);
    toast.error('Không tải được activity log');
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!contactId.value || !nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const { data } = await api.get(`/customers/${contactId.value}/activity-log`, {
      params: buildParams({ cursor: nextCursor.value }),
    });
    items.value = [...items.value, ...(data.items || [])];
    nextCursor.value = data.nextCursor || null;
  } catch {
    toast.error('Tải thêm thất bại');
  } finally {
    loadingMore.value = false;
  }
}

async function fetchContactName() {
  if (!contactId.value) return;
  try {
    const { data } = await api.get(`/contacts/${contactId.value}`);
    contactName.value = data.crmName || data.fullName || null;
  } catch {
    // ignore
  }
}

async function exportCsv() {
  if (!contactId.value) return;
  exporting.value = true;
  try {
    const params: Record<string, string> = { customerId: contactId.value, format: 'csv' };
    if (selectedCategories.value.size < ALL_CATEGORIES.length) {
      params.categories = [...selectedCategories.value].join(',');
    }
    if (fromDate.value) params.from = fromDate.value;
    if (toDate.value) params.to = toDate.value + 'T23:59:59';

    const response = await api.get('/timeline/export', { params, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `activity-${contactName.value || contactId.value}-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    toast.success('✓ Đã tải file CSV');
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Export thất bại');
  } finally {
    exporting.value = false;
  }
}

onMounted(() => {
  loadFromUrl();
  if (!fromDate.value && !toDate.value && activePreset.value === '30d') {
    applyDatePreset('30d');
  } else {
    void fetchFirstPage();
  }
  void fetchContactName();
});

watch(() => route.params.id, () => {
  if (contactId.value) {
    void fetchContactName();
    void fetchFirstPage();
  }
});
</script>

<style scoped>
.al-view {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px 20px;
}

/* Header */
.al-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.back-btn {
  background: var(--smax-grey-100);
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--smax-grey-700);
}
.back-btn:hover { background: var(--smax-primary-soft); color: var(--smax-primary); }
.al-header h1 {
  font-size: 20px;
  margin: 0;
  color: var(--smax-text);
  flex: 1;
}
.al-contact-name {
  font-size: 16px;
  font-weight: 500;
  color: var(--smax-grey-600);
}
.al-actions { display: flex; gap: 8px; }
.export-btn {
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.export-btn:hover:not(:disabled) { background: #1e4cc7; }
.export-btn:disabled { opacity: 0.6; cursor: not-allowed; }

/* Layout */
.al-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
}
@media (max-width: 768px) {
  .al-layout { grid-template-columns: 1fr; }
}

/* Filter sidebar */
.al-filters {
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 10px;
  padding: 14px;
  height: fit-content;
  position: sticky;
  top: 16px;
}
@media (max-width: 768px) {
  .al-filters {
    position: fixed;
    inset: 0;
    z-index: 9000;
    transform: translateX(-100%);
    transition: transform 0.2s;
    border-radius: 0;
    overflow-y: auto;
    padding-top: 50px;
  }
  .al-filters.open { transform: translateX(0); }
}
.drawer-close {
  display: none;
  position: absolute;
  top: 12px;
  right: 12px;
  background: var(--smax-grey-100);
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 18px;
  cursor: pointer;
}
@media (max-width: 768px) {
  .drawer-close { display: block; }
}

.filter-block {
  border-bottom: 1px solid var(--smax-grey-100);
  padding-bottom: 12px;
  margin-bottom: 12px;
}
.filter-block:last-of-type { border-bottom: none; }
.filter-block h3 {
  font-size: 12px;
  font-weight: 700;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin: 0 0 8px;
}

.quick-dates, .date-inputs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
.date-inputs { flex-direction: column; gap: 6px; }
.date-inputs label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.date-inputs label span { width: 30px; color: var(--smax-grey-600); }
.date-inputs input[type="date"] {
  flex: 1;
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}

.chip {
  background: var(--smax-grey-100);
  border: 1px solid var(--smax-grey-200);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--smax-grey-700);
}
.chip:hover { background: var(--smax-primary-soft); color: var(--smax-primary); border-color: var(--smax-primary); }
.chip.active {
  background: var(--smax-primary);
  color: #fff;
  border-color: var(--smax-primary);
  font-weight: 600;
}

.cat-list, .actor-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cat-row, .actor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
  cursor: pointer;
}
.cat-icon { width: 18px; text-align: center; }
.cat-label { color: var(--smax-text); }

.text-link {
  background: none;
  border: none;
  color: var(--smax-primary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
  margin-right: 6px;
}

.search-input {
  width: 100%;
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 12.5px;
  outline: none;
  font-family: inherit;
}
.search-input:focus { border-color: var(--smax-primary); }

.reset-btn {
  width: 100%;
  background: var(--smax-grey-100);
  border: none;
  border-radius: 7px;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: var(--smax-grey-700);
  margin-top: 8px;
}
.reset-btn:hover { background: var(--smax-grey-200); }

/* Main list */
.al-main { min-width: 0; }

.filter-toggle-mobile {
  display: none;
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 8px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 10px;
  position: relative;
}
@media (max-width: 768px) {
  .filter-toggle-mobile { display: inline-flex; align-items: center; gap: 6px; }
}
.filter-count-badge {
  background: #fff;
  color: var(--smax-primary);
  border-radius: 9px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 700;
}

.result-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 4px;
  font-size: 12px;
  color: var(--smax-grey-600);
  border-bottom: 1px solid var(--smax-grey-100);
  margin-bottom: 8px;
}
.muted { color: var(--smax-grey-500); font-style: italic; }

.items-list {
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 10px;
  padding: 8px 4px;
}

.state {
  padding: 40px;
  text-align: center;
  color: var(--smax-grey-500);
}
.state.empty .empty-icon { font-size: 32px; display: block; margin-bottom: 8px; }

.load-more {
  text-align: center;
  padding: 12px;
}
.load-more button {
  background: var(--smax-grey-100);
  border: none;
  padding: 7px 18px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--smax-grey-700);
}
.load-more button:hover:not(:disabled) { background: var(--smax-primary-soft); color: var(--smax-primary); }
.end-marker {
  text-align: center;
  padding: 12px;
  font-size: 11px;
  color: var(--smax-grey-400);
}
</style>
