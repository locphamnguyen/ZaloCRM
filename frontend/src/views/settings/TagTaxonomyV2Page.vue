<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- Wave 4a v2 /plan-eng-review M57 2026-06-01.
       Cấu trúc bổ sung theo feedback anh:
       - Cột Tên: Zalo SVG icon prefix cho zalo_real
       - Cột Slug: {displayName-slug}-{tag-slug} cho Zalo Real, slug thuần cho non-Zalo
       - Cột Nguồn: 2 line — source type + nick name (Zalo Real chỉ)
       - Cột Ưu tiên: hint "stack tag UI chat cột 2"
       - Cột Hành động: Edit (push Zalo Real nếu cần) + Merge + Archive
       - Filter Friend tab: source chip + Nick zalo dropdown
       - Edit Modal đồng nhất: Tên / Màu / Emoji / Ưu tiên / Group -->
  <div class="tag-v2-page">
    <header class="t2-header">
      <div class="t2-title">
        <span class="t2-icon">🏷</span>
        <h1>Tag Taxonomy v2 — 2 Nhóm</h1>
      </div>
      <p class="t2-subtitle">
        <b>Friend Tag</b> (per-pair sale × KH) + <b>CRM Tag</b> (cấp KH chung).
        Sync 2 chiều với Zalo Real (edit ở zalocrm sẽ push ngược lên Zalo App).
      </p>
    </header>

    <!-- Tab strip -->
    <nav class="t2-tabs">
      <button :class="['t2-tab', { active: activeTab === 'friend' }]" @click="activeTab = 'friend'">
        <span class="t2-tab-emoji">👥</span> Friend Tag
        <span class="t2-tab-count">{{ stats.friend }}</span>
      </button>
      <button :class="['t2-tab', { active: activeTab === 'crm' }]" @click="activeTab = 'crm'">
        <span class="t2-tab-emoji">📇</span> CRM Tag
        <span class="t2-tab-count">{{ stats.crm }}</span>
      </button>
      <div class="t2-tab-spacer"></div>
      <button class="t2-btn-secondary" @click="recountUsage" :disabled="loading">🔄 Recount usage</button>
      <button class="t2-btn-primary" @click="openCreateDialog">+ Tạo Tag</button>
    </nav>

    <!-- Filters: source chips + nick dropdown (Friend tab only) -->
    <div class="t2-filters">
      <div class="t2-filter-row">
        <span class="t2-filter-label">Nguồn:</span>
        <button
          v-for="src in availableSources"
          :key="src.value"
          :class="['t2-chip', { active: filterSource === src.value }]"
          @click="filterSource = filterSource === src.value ? null : src.value"
        >
          <span class="t2-chip-dot" :style="{ background: src.color }"></span>
          {{ src.label }}
        </button>
      </div>
      <div v-if="activeTab === 'friend'" class="t2-filter-row">
        <span class="t2-filter-label">Nick Zalo:</span>
        <select v-model="filterNickId" class="t2-nick-select">
          <option :value="null">Tất cả nick ({{ zaloAccounts.length }})</option>
          <option v-for="acc in zaloAccounts" :key="acc.id" :value="acc.id">
            {{ acc.displayName }}{{ acc.phone ? ' · ' + acc.phone : '' }}
          </option>
        </select>
      </div>
    </div>

    <!-- Search -->
    <div class="t2-search">
      <input v-model="searchQuery" type="text" placeholder="Tìm tag theo tên hoặc slug..." />
    </div>

    <!-- Table -->
    <div class="t2-table-wrap" v-if="!loading">
      <table class="t2-table">
        <thead>
          <tr>
            <th class="t2-col-name">Tên</th>
            <th class="t2-col-slug">Slug</th>
            <th class="t2-col-source">Nguồn</th>
            <th class="t2-col-priority" title="Vị trí xuất hiện trong stack tag UI chat cột 2 (1 = top)">Ưu tiên</th>
            <th class="t2-col-usage">Dùng</th>
            <th class="t2-col-color">Màu</th>
            <th class="t2-col-action">Hành động</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tag in filteredTags" :key="tag.id" :class="{ archived: tag.archivedAt }">
            <td class="t2-cell-name">
              <!-- Tag pill style đồng nhất UI chat — color-mix derive bg/border/text từ tag.color.
                   Zalo Real có ZaloBrandIcon brand mark prefix. -->
              <span
                class="t2-tag-pill"
                :class="{ 'is-zalo-real': tag.source === 'zalo_real', 'is-auto': tag.source?.startsWith('auto_') }"
                :style="{ '--tag-color': tag.color }"
              >
                <ZaloBrandIcon v-if="tag.source === 'zalo_real'" class="t2-pill-zalo-icon" />
                <span v-else-if="tag.emoji" class="t2-pill-emoji">{{ tag.emoji }}</span>
                <span class="t2-pill-text">{{ tag.name }}</span>
              </span>
            </td>
            <td><code class="t2-slug">{{ displaySlug(tag) }}</code></td>
            <td class="t2-cell-source">
              <span class="t2-source-chip" :style="{ background: getSourceColor(tag.source) }">
                {{ getSourceLabel(tag.source) }}
              </span>
              <span v-if="tag.zaloAccount" class="t2-source-nick" :title="tag.zaloAccount.displayName">
                {{ tag.zaloAccount.displayName }}
              </span>
            </td>
            <td class="t2-cell-priority">
              <span class="t2-priority-badge">{{ tag.priority }}</span>
            </td>
            <td class="t2-cell-usage">{{ tag.usageCount }}</td>
            <td class="t2-cell-color">
              <span class="t2-color-swatch" :style="{ background: tag.color }" :title="tag.color"></span>
            </td>
            <td class="t2-cell-action">
              <div class="t2-action-group">
                <button class="t2-btn-sm primary" @click="openEditDialog(tag)">Sửa</button>
                <button class="t2-btn-sm" @click="openMergeDialog(tag)" :disabled="tag.source === 'zalo_real'">Merge</button>
                <button class="t2-btn-sm danger" @click="archiveTag(tag.id)" :disabled="tag.source === 'zalo_real'">Archive</button>
              </div>
            </td>
          </tr>
          <tr v-if="filteredTags.length === 0">
            <td colspan="7" class="t2-empty">
              Không có tag nào trong scope <b>{{ activeTab === 'friend' ? 'Friend Tag' : 'CRM Tag' }}</b>{{ filterSource ? ` với nguồn ${getSourceLabel(filterSource)}` : '' }}{{ filterNickId ? ` của nick ${zaloAccounts.find(a => a.id === filterNickId)?.displayName}` : '' }}.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="t2-loading">Đang tải...</div>

    <!-- Edit/Create Dialog đồng nhất -->
    <div v-if="showEditDialog" class="t2-modal-backdrop" @click.self="showEditDialog = false">
      <div class="t2-modal">
        <h3>
          <span v-if="editTag?.id">Sửa Tag</span>
          <span v-else>Tạo Tag mới</span>
          <span class="t2-modal-scope">scope = {{ editTag?.scope || activeTab }}</span>
        </h3>

        <div v-if="editTag?.source === 'zalo_real'" class="t2-zalo-banner">
          <ZaloBrandIcon class="t2-zalo-icon-small" />
          <div>
            <b>Tag Zalo Real</b> — đổi Tên/Màu/Emoji sẽ <b>push ngược lên Zalo App</b> qua nick
            "{{ editTag.zaloAccount?.displayName }}". Ưu tiên + Group chỉ áp dụng zalocrm.
          </div>
        </div>

        <label>Tên hiển thị</label>
        <input v-model="editForm.name" type="text" placeholder="VIP, Tiềm năng, ..." />

        <div class="t2-form-row">
          <div class="t2-form-color">
            <label>Màu</label>
            <!-- Zalo Real: palette 8 màu cố định (Zalo App chỉ render đúng các màu này) -->
            <div v-if="editTag?.source === 'zalo_real'" class="t2-palette">
              <button
                v-for="c in ZALO_PALETTE"
                :key="c.hex"
                type="button"
                :class="['t2-palette-swatch', { active: editForm.color.toUpperCase() === c.hex.toUpperCase() }]"
                :style="{ background: c.hex }"
                :title="c.name + ' (' + c.hex + ')'"
                @click="editForm.color = c.hex"
              ></button>
            </div>
            <!-- Non-Zalo: full RGB picker -->
            <input v-else v-model="editForm.color" type="color" />
          </div>
          <div>
            <label>Emoji</label>
            <input v-model="editForm.emoji" type="text" maxlength="4" placeholder="🔥" />
          </div>
          <div class="t2-form-priority">
            <label title="Vị trí trong stack tag UI chat cột 2 (1 = top)">Ưu tiên</label>
            <input v-model.number="editForm.priority" type="number" min="1" max="99" />
          </div>
        </div>

        <label v-if="!editTag?.id">Nguồn</label>
        <select v-if="!editTag?.id" v-model="editForm.source">
          <option v-for="src in availableSources.filter(s => s.value !== 'zalo_real')" :key="src.value" :value="src.value">
            {{ src.label }}
          </option>
        </select>

        <div class="t2-modal-actions">
          <button @click="showEditDialog = false">Huỷ</button>
          <button class="t2-btn-primary" @click="saveTag" :disabled="!editForm.name">
            {{ editTag?.source === 'zalo_real' ? 'Lưu + Push Zalo' : 'Lưu' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Merge dialog -->
    <div v-if="showMergeDialog" class="t2-modal-backdrop" @click.self="showMergeDialog = false">
      <div class="t2-modal">
        <h3>Merge tag</h3>
        <p>Source: <b>{{ mergeSource?.name }}</b> ({{ mergeSource?.usageCount }} usage)</p>
        <label>Chọn target tag</label>
        <select v-model="mergeTargetId">
          <option v-for="t in availableTagsForMerge" :key="t.id" :value="t.id">
            {{ t.name }} ({{ t.usageCount }})
          </option>
        </select>
        <div class="t2-modal-actions">
          <button @click="showMergeDialog = false">Huỷ</button>
          <button class="t2-btn-primary" @click="confirmMerge" :disabled="!mergeTargetId">
            Merge {{ mergeSource?.name }} → {{ availableTagsForMerge.find(t => t.id === mergeTargetId)?.name }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '@/api';
import ZaloBrandIcon from '@/components/icons/ZaloBrandIcon.vue';

interface ZaloAccount {
  id: string;
  displayName: string;
  phone: string | null;
  avatarUrl: string | null;
  status?: string;
}

interface TagV2 {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  color: string;
  emoji: string | null;
  scope: 'friend' | 'crm';
  source: string;
  priority: number;
  usageCount: number;
  zaloAccountId: string | null;
  sourceZaloLabelId: number | null;
  archivedAt: string | null;
  zaloAccount: ZaloAccount | null;
}

const activeTab = ref<'friend' | 'crm'>('friend');
const tags = ref<TagV2[]>([]);
const zaloAccounts = ref<ZaloAccount[]>([]);
const loading = ref(false);
const filterSource = ref<string | null>(null);
const filterNickId = ref<string | null>(null);
const searchQuery = ref('');

const showEditDialog = ref(false);
const editTag = ref<TagV2 | null>(null);
const editForm = ref({ name: '', color: '#90A4AE', emoji: '', priority: 99, source: 'manual_per_nick' });

const showMergeDialog = ref(false);
const mergeSource = ref<TagV2 | null>(null);
const mergeTargetId = ref<string>('');

// Bảng màu Zalo Real chính thức — verify từ DB production (8 màu unique từ
// zalo_labels) + Zalo Web UI palette. SDK accept hex bất kỳ, nhưng Zalo App
// chỉ render đúng 8 màu này; màu non-palette sẽ fallback sang grey hoặc gần
// nhất. Để zalocrm + Zalo App đồng bộ visual, lock 8 màu cố định.
const ZALO_PALETTE: Array<{ hex: string; name: string }> = [
  { hex: '#D91B1B', name: 'Đỏ' },
  { hex: '#0068FF', name: 'Xanh dương' },
  { hex: '#FF6905', name: 'Cam' },
  { hex: '#4BC377', name: 'Xanh lá' },
  { hex: '#FAC000', name: 'Vàng' },
  { hex: '#F31BC8', name: 'Hồng' },
  { hex: '#6F3FCF', name: 'Tím' },
  { hex: '#FF6B6B', name: 'Đỏ nhạt' },
];

const SOURCE_META: Record<string, { label: string; color: string; scope: 'friend' | 'crm' }> = {
  zalo_real: { label: 'Zalo Real', color: '#0068FF', scope: 'friend' },
  manual_per_nick: { label: 'Manual per Nick', color: '#FFA726', scope: 'friend' },
  auto_detect: { label: 'Auto Detect', color: '#66BB6A', scope: 'friend' },
  // auto_score (Tier A-D) ĐÃ GỠ HẲN /office-hours 2026-06-06 — xoá khỏi hệ tag + DB
  // (4784 junction + 3 def). Điểm Lead vẫn ở ScoreBanner. Bỏ entry khỏi SOURCE_META để
  // chip bộ lọc "Auto Score" biến mất khỏi /settings/crm/tags-v2.
  auto_engagement: { label: 'Auto Engagement', color: '#EF5350', scope: 'friend' },
  manual_crm: { label: 'Manual CRM', color: '#FFA726', scope: 'crm' },
  ai_suggest: { label: 'AI Suggest', color: '#5C6BC0', scope: 'crm' },
  segment_rule: { label: 'Segment Rule', color: '#26A69A', scope: 'crm' },
  status: { label: 'Status', color: '#8D6E63', scope: 'crm' },
  import: { label: 'Import', color: '#78909C', scope: 'crm' },
};

const availableSources = computed(() =>
  Object.entries(SOURCE_META)
    .filter(([_, m]) => m.scope === activeTab.value)
    .map(([value, m]) => ({ value, label: m.label, color: m.color }))
);

const stats = computed(() => ({
  friend: tags.value.filter((t) => t.scope === 'friend' && !t.archivedAt).length,
  crm: tags.value.filter((t) => t.scope === 'crm' && !t.archivedAt).length,
}));

const filteredTags = computed(() => {
  let arr = tags.value.filter((t) => t.scope === activeTab.value);
  if (filterSource.value) arr = arr.filter((t) => t.source === filterSource.value);
  if (filterNickId.value) arr = arr.filter((t) => t.zaloAccountId === filterNickId.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    arr = arr.filter((t) => t.name.toLowerCase().includes(q) || t.slug.includes(q));
  }
  return arr.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.usageCount - a.usageCount;
  });
});

const availableTagsForMerge = computed(() => {
  if (!mergeSource.value) return [];
  return tags.value.filter(
    (t) => t.scope === mergeSource.value!.scope && t.id !== mergeSource.value!.id && !t.archivedAt
  );
});

function getSourceLabel(src: string): string { return SOURCE_META[src]?.label ?? src; }
function getSourceColor(src: string): string { return SOURCE_META[src]?.color ?? '#999'; }

function slugify(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Slug hiển thị: {displayName-slug}-{tag-slug} cho Zalo Real, slug thuần cho non-Zalo. */
function displaySlug(tag: TagV2): string {
  if (tag.source === 'zalo_real' && tag.zaloAccount?.displayName) {
    const nickSlug = slugify(tag.zaloAccount.displayName);
    return `${nickSlug}-${tag.slug}`;
  }
  return tag.slug;
}

async function loadTags() {
  loading.value = true;
  try {
    const [friendRes, crmRes, accRes] = await Promise.all([
      api.get('/tags', { params: { scope: 'friend', limit: 500 } }),
      api.get('/tags', { params: { scope: 'crm', limit: 500 } }),
      api.get('/tags/zalo-accounts'),
    ]);
    tags.value = [...(friendRes.data.tags ?? []), ...(crmRes.data.tags ?? [])];
    zaloAccounts.value = accRes.data.accounts ?? [];
  } catch (err) {
    console.error('[TagTaxonomyV2] load error', err);
  } finally {
    loading.value = false;
  }
}

async function recountUsage() {
  loading.value = true;
  try {
    await api.get('/tags', { params: { recount: 1, scope: activeTab.value } });
    await loadTags();
  } finally { loading.value = false; }
}

function openCreateDialog() {
  editTag.value = null;
  editForm.value = {
    name: '',
    color: '#90A4AE',
    emoji: '',
    priority: 99,
    source: activeTab.value === 'friend' ? 'manual_per_nick' : 'manual_crm',
  };
  showEditDialog.value = true;
}

function openEditDialog(tag: TagV2) {
  editTag.value = tag;
  editForm.value = {
    name: tag.name,
    color: tag.color,
    emoji: tag.emoji ?? '',
    priority: tag.priority,
    source: tag.source,
  };
  showEditDialog.value = true;
}

async function saveTag() {
  if (!editForm.value.name) return;
  try {
    if (editTag.value?.id) {
      // Update existing
      const body: Record<string, unknown> = {
        name: editForm.value.name,
        color: editForm.value.color,
        emoji: editForm.value.emoji || null,
        priority: editForm.value.priority,
      };
      const res = await api.patch(`/tags/${editTag.value.id}`, body);
      if (res.data.pushedZalo) {
        alert('Đã lưu zalocrm + push ngược lên Zalo Real qua nick "' + editTag.value.zaloAccount?.displayName + '"');
      }
    } else {
      // Create
      await api.post('/tags', {
        name: editForm.value.name,
        scope: activeTab.value,
        source: editForm.value.source,
        color: editForm.value.color,
        emoji: editForm.value.emoji || null,
      });
    }
    showEditDialog.value = false;
    await loadTags();
  } catch (err) {
    const msg = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message
      ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      ?? 'Lưu thất bại';
    alert(msg);
  }
}

async function archiveTag(tagId: string) {
  if (!confirm('Archive tag này? Junction giữ nguyên nhưng tag không xuất hiện trong autocomplete.')) return;
  try {
    await api.delete(`/tags/${tagId}`);
    await loadTags();
  } catch { alert('Archive thất bại'); }
}

function openMergeDialog(tag: TagV2) {
  mergeSource.value = tag;
  mergeTargetId.value = '';
  showMergeDialog.value = true;
}

async function confirmMerge() {
  if (!mergeSource.value || !mergeTargetId.value) return;
  try {
    const res = await api.post('/tags/merge', {
      sourceTagId: mergeSource.value.id,
      targetTagId: mergeTargetId.value,
    });
    alert(res.data.skipped ? `Merge bỏ qua: ${res.data.skipped}` : `Merge thành công. ${res.data.moved} junction rows moved.`);
    showMergeDialog.value = false;
    await loadTags();
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Merge thất bại';
    alert(msg);
  }
}

onMounted(loadTags);

watch(activeTab, () => {
  filterSource.value = null;
  filterNickId.value = null;
  loadTags();
});
</script>

<style scoped>
.tag-v2-page {
  padding: 24px;
  max-width: 1366px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #181d26;
}
.t2-header { margin-bottom: 20px; }
.t2-title { display: flex; align-items: center; gap: 10px; }
.t2-title h1 { font-size: 22px; font-weight: 700; margin: 0; color: #181d26; }
.t2-icon { font-size: 24px; }
.t2-subtitle { font-size: 13px; color: #41454d; margin: 8px 0 0 0; }

.t2-tabs { display: flex; align-items: center; gap: 6px; border-bottom: 1px solid #dddddd; padding-bottom: 0; margin-bottom: 14px; }
.t2-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 16px; border: 1px solid transparent; border-bottom: none;
  background: transparent; color: #41454d; font-size: 13px; font-weight: 500;
  cursor: pointer; border-radius: 8px 8px 0 0; margin-bottom: -1px;
}
.t2-tab.active { background: #fff; border-color: #dddddd; color: #181d26; font-weight: 600; }
.t2-tab-emoji { font-size: 14px; }
.t2-tab-count { background: #eef0f3; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.t2-tab-spacer { flex: 1; }

.t2-btn-primary { background: #181d26; color: white; border: 1px solid #181d26; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
.t2-btn-primary:hover { background: #2a2f3a; }
.t2-btn-primary:disabled { background: #999; cursor: not-allowed; }
.t2-btn-secondary { background: white; color: #41454d; border: 1px solid #dddddd; padding: 8px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.t2-btn-secondary:hover { background: #f5f7fa; }
.t2-btn-sm { background: white; color: #41454d; border: 1px solid #dddddd; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.t2-btn-sm.primary { color: #0068FF; border-color: #b3d4ff; font-weight: 500; }
.t2-btn-sm.danger { color: #d32f2f; border-color: #ef9a9a; }
.t2-btn-sm:hover:not(:disabled) { background: #f5f7fa; }
.t2-btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }

.t2-filters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 10px 12px; background: #fafbfc; border: 1px solid #eef0f3; border-radius: 6px; }
.t2-filter-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.t2-filter-label { font-size: 11px; color: #41454d; font-weight: 600; min-width: 64px; }
.t2-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; background: white; border: 1px solid #dddddd;
  border-radius: 14px; font-size: 11px; cursor: pointer; color: #41454d;
}
.t2-chip.active { background: #181d26; color: white; border-color: #181d26; }
.t2-chip-dot { width: 8px; height: 8px; border-radius: 50%; }
.t2-nick-select {
  padding: 4px 8px; border: 1px solid #dddddd; border-radius: 6px; font-size: 12px; min-width: 240px;
}

.t2-search { margin-bottom: 12px; }
.t2-search input {
  width: 100%; padding: 8px 12px; border: 1px solid #dddddd; border-radius: 6px;
  font-size: 13px; box-sizing: border-box;
}

.t2-table-wrap { background: white; border: 1px solid #dddddd; border-radius: 8px; overflow-x: auto; }
.t2-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }

/* Fixed width per column → tránh hàng nhảy vỡ */
.t2-col-name      { width: 26%; min-width: 200px; }
.t2-col-slug      { width: 18%; min-width: 160px; }
.t2-col-source    { width: 16%; min-width: 140px; }
.t2-col-priority  { width: 8%;  min-width: 70px; }
.t2-col-usage     { width: 7%;  min-width: 60px; }
.t2-col-color     { width: 7%;  min-width: 50px; }
.t2-col-action    { width: 18%; min-width: 200px; }

.t2-table th {
  text-align: left; padding: 8px 10px; background: #f5f7fa; color: #41454d;
  font-weight: 600; border-bottom: 1px solid #dddddd; font-size: 11px; white-space: nowrap;
}
.t2-table td {
  padding: 10px; border-bottom: 1px solid #eef0f3; vertical-align: middle;
  overflow: hidden;
}
.t2-table tr:hover td { background: #fafbfc; }
.t2-table tr.archived td { opacity: 0.5; }

/* Tag pill — đồng nhất style UI chat (color-mix derive 3 màu phụ từ --tag-color) */
.t2-cell-name { padding-right: 6px; }
.t2-tag-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; border-radius: 14px;
  font-size: 13px; font-weight: 500;
  border: 1.4px solid;
  --tag-color: #546E7A;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  border-color: color-mix(in srgb, var(--tag-color) 75%, white);
  color: color-mix(in srgb, var(--tag-color) 78%, black);
  max-width: 100%;
  white-space: nowrap;
}
.t2-tag-pill.is-zalo-real {
  /* Zalo Real: tinted strong hơn + ZaloBrandIcon prefix làm brand mark */
  background: color-mix(in srgb, var(--tag-color) 14%, white);
  border-color: color-mix(in srgb, var(--tag-color) 80%, white);
  position: relative;
}
.t2-tag-pill.is-auto {
  /* Auto-tag: tone-on-tone nhẹ hơn, font-weight cao hơn */
  background: color-mix(in srgb, var(--tag-color) 10%, white);
  border-color: color-mix(in srgb, var(--tag-color) 60%, white);
  font-weight: 600;
}
.t2-pill-zalo-icon { width: 14px; height: 14px; flex-shrink: 0; }
.t2-pill-emoji { font-size: 14px; flex-shrink: 0; }
.t2-pill-text { overflow: hidden; text-overflow: ellipsis; }

.t2-slug {
  background: #eef0f3; padding: 3px 8px; border-radius: 4px;
  font-family: 'JetBrains Mono', Consolas, monospace; font-size: 11px; color: #41454d;
  display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; vertical-align: middle;
}

.t2-cell-source { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; max-width: 100%; }
.t2-source-chip {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  color: white; font-size: 10px; font-weight: 500; white-space: nowrap; flex-shrink: 0;
}
.t2-source-nick {
  font-size: 11px; color: #41454d; font-weight: 500;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.t2-cell-priority { text-align: center; }
.t2-priority-badge {
  display: inline-block; min-width: 22px; text-align: center;
  padding: 3px 7px; background: #181d26; color: white;
  border-radius: 4px; font-size: 11px; font-weight: 700;
}

.t2-cell-usage { font-variant-numeric: tabular-nums; }

.t2-cell-color { text-align: center; }
.t2-color-swatch {
  display: inline-block; width: 26px; height: 18px; border-radius: 4px;
  border: 1px solid rgba(0,0,0,0.15); vertical-align: middle;
}

.t2-cell-action { padding-right: 10px; }
.t2-action-group {
  display: flex; gap: 4px; flex-wrap: nowrap;
}

.t2-empty { text-align: center; padding: 40px; color: #999; }
.t2-loading { text-align: center; padding: 40px; color: #999; }

.t2-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.t2-modal { background: white; padding: 24px; border-radius: 8px; min-width: 460px; max-width: 560px; }
.t2-modal h3 { margin: 0 0 16px 0; font-size: 16px; display: flex; align-items: center; gap: 10px; }
.t2-modal-scope { font-size: 11px; color: #999; background: #eef0f3; padding: 2px 8px; border-radius: 10px; font-weight: 400; }
.t2-modal label { display: block; font-size: 12px; color: #41454d; margin: 12px 0 4px; font-weight: 500; }
.t2-modal input, .t2-modal select {
  width: 100%; padding: 6px 10px; border: 1px solid #dddddd; border-radius: 4px;
  font-size: 13px; box-sizing: border-box;
}
.t2-modal input[type="color"] { width: 60px; padding: 2px; height: 32px; }
.t2-form-row { display: flex; gap: 12px; align-items: flex-start; }
.t2-form-row > div { flex: 1; }
.t2-form-priority input { width: 60px; }
.t2-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.t2-modal-actions button { padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.t2-modal-actions button:not(.t2-btn-primary) { background: white; color: #41454d; border: 1px solid #dddddd; }

.t2-palette {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 4px 0;
}
.t2-palette-swatch {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer; padding: 0;
  transition: transform 0.1s ease, border-color 0.1s ease;
}
.t2-palette-swatch:hover { transform: scale(1.1); }
.t2-palette-swatch.active {
  border-color: #181d26;
  box-shadow: 0 0 0 2px white inset;
}
.t2-form-color { min-width: 180px; }

.t2-zalo-banner {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; background: #e8f3ff; border: 1px solid #b3d4ff;
  border-radius: 6px; margin-bottom: 12px; font-size: 12px; color: #003a8c; line-height: 1.5;
}
.t2-zalo-icon-small { width: 20px; height: 20px; flex-shrink: 0; margin-top: 2px; }
</style>
