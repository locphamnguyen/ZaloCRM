<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="crmtag-settings">
    <header class="settings-section-header">
      <p class="subtitle">
        Tag CRM là <strong>thẻ phân loại nội bộ</strong> do tổ chức định nghĩa (vd "VIP", "Hot lead").
        <strong>Số thứ tự ưu tiên</strong> quyết định thứ tự hiển thị trên thanh chat — kéo thả hoặc sửa
        số trực tiếp để thay đổi.
      </p>
    </header>

    <!-- Toolbar -->
    <div class="toolbar">
      <button class="toolbar-btn primary" @click="openCreate">+ Thêm tag CRM</button>
      <button class="toolbar-btn" :disabled="recounting" @click="recount">
        {{ recounting ? '⟳…' : '⟳ Cập nhật số liệu' }}
      </button>
      <button v-if="selected.size" class="toolbar-btn danger" @click="bulkDelete">
        🗑 Xoá {{ selected.size }} tag
      </button>
      <div class="toolbar-spacer"></div>
      <select v-model="filterCategory" class="filter-select">
        <option value="">Tất cả danh mục</option>
        <option v-for="c in existingCategories" :key="c" :value="c">{{ c }}</option>
      </select>
      <input v-model="filter" type="text" placeholder="Tìm tag…" class="filter-input" />
    </div>

    <!-- Stats summary -->
    <div class="stats-row">
      <div class="stat-card"><div class="stat-num">{{ tags.length }}</div><div class="stat-label">Tổng tag</div></div>
      <div class="stat-card"><div class="stat-num">{{ activeCount }}</div><div class="stat-label">Đang dùng</div></div>
      <div class="stat-card"><div class="stat-num">{{ unusedCount }}</div><div class="stat-label">Chưa dùng</div></div>
      <div class="stat-card"><div class="stat-num">{{ categoryCount }}</div><div class="stat-label">Danh mục</div></div>
    </div>

    <div v-if="loading && !tags.length" class="loading-state">Đang tải…</div>
    <div v-else-if="!filteredTags.length" class="empty-state">
      <p>{{ tags.length ? 'Không có tag nào khớp bộ lọc.' : 'Chưa có tag CRM nào.' }}</p>
      <button v-if="!tags.length" class="toolbar-btn primary" @click="openCreate">+ Tạo tag đầu tiên</button>
    </div>

    <!-- List layout với drag-reorder -->
    <div v-else class="tag-list">
      <!-- Bulk header -->
      <div class="list-header">
        <label class="check-all">
          <input type="checkbox" :checked="allSelected" :indeterminate.prop="someSelected" @change="toggleSelectAll" />
          <span>{{ selected.size }}/{{ filteredTags.length }} chọn</span>
        </label>
        <span class="header-priority">⇅ Ưu tiên</span>
        <span class="header-preview">Preview</span>
        <span class="header-name">Tên & màu</span>
        <span class="header-category">Danh mục</span>
        <span class="header-usage">KH</span>
        <span class="header-actions">Hành động</span>
      </div>

      <div
        v-for="(tag, idx) in filteredTags"
        :key="tag.id"
        class="tag-row"
        :class="{ inactive: !tag.isActive, selected: selected.has(tag.id), dragging: draggingId === tag.id, 'drag-over': dragOverId === tag.id }"
        draggable="true"
        @dragstart="onDragStart(tag.id, $event)"
        @dragover.prevent="onDragOver(tag.id, $event)"
        @dragleave="onDragLeave"
        @drop="onDrop(tag.id, $event)"
        @dragend="onDragEnd"
      >
        <!-- Checkbox -->
        <label class="row-check">
          <input type="checkbox" :checked="selected.has(tag.id)" @change="toggleSelect(tag.id)" />
        </label>

        <!-- Priority handle + number -->
        <div class="priority-cell">
          <span class="drag-handle" title="Kéo thả để đổi thứ tự">⋮⋮</span>
          <input
            type="number"
            min="1"
            :value="idx + 1"
            class="priority-input"
            :title="`Ưu tiên #${idx + 1} — sửa số để di chuyển`"
            @blur="onPriorityChange(tag.id, ($event.target as HTMLInputElement).value)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>

        <!-- Preview pill — Zalo tag dùng brand icon + clean name (strip 🔵 prefix);
             CRM tag giữ emoji + name. Match visual TagCrmBar/ActivityItem. -->
        <div class="preview-cell">
          <span
            class="tag-preview"
            :class="{ 'tag-preview-zalo': isZaloTag(tag) }"
            :style="previewStyle(tag)"
          >
            <ZaloBrandIcon v-if="isZaloTag(tag)" :size="13" />
            <span v-else-if="tag.emoji">{{ tag.emoji }} </span>{{ displayName(tag) }}
          </span>
        </div>

        <!-- Name + color edit inline -->
        <div class="name-cell">
          <!-- Zalo tag: read-only (sync 1-chiều từ Zalo SDK, backend reject edit).
               Hiện brand icon + clean name (strip 🔵 prefix) + 🔒 lock indicator. -->
          <template v-if="isZaloTag(tag)">
            <span class="zalo-locked" title="Tag Zalo Real — chỉ đổi/gỡ trên app Zalo, hệ thống tự sync về CRM">
              <ZaloBrandIcon :size="14" />
              <span class="zalo-locked-name">{{ displayName(tag) }}</span>
              <span class="lock-icon" aria-hidden="true">🔒</span>
            </span>
          </template>
          <template v-else>
            <input type="color" :value="tag.color" class="color-picker" title="Đổi màu"
              @change="patchTag(tag, { color: ($event.target as HTMLInputElement).value })" />
            <input type="text" :value="tag.emoji || ''" class="emoji-input" maxlength="4" placeholder="🏷"
              @blur="patchTag(tag, { emoji: ($event.target as HTMLInputElement).value || null })" />
            <input type="text" :value="tag.name" class="name-input"
              @blur="onRename(tag, ($event.target as HTMLInputElement).value)" />
          </template>
        </div>

        <!-- Category -->
        <div class="category-cell">
          <input type="text" :value="tag.category || ''" class="category-input" placeholder="Khác"
            list="categories-suggest"
            @blur="patchTag(tag, { category: ($event.target as HTMLInputElement).value || null })" />
        </div>

        <!-- Usage -->
        <div class="usage-cell">
          <span class="usage-badge" :class="{ zero: !tag.usageCount }">{{ tag.usageCount }}</span>
        </div>

        <!-- Actions: toggle active, clone, delete -->
        <div class="actions-cell">
          <button class="icon-btn" :title="tag.isActive ? 'Đang bật' : 'Đã tắt'"
            @click="patchTag(tag, { isActive: !tag.isActive })">
            <span v-if="tag.isActive">🟢</span>
            <span v-else>⚪</span>
          </button>
          <button class="icon-btn" title="Clone tag" @click="cloneTag(tag)">⎘</button>
          <button class="icon-btn" :title="editingDescId === tag.id ? 'Đang sửa mô tả' : 'Sửa mô tả'"
            @click="editingDescId = editingDescId === tag.id ? null : tag.id">
            <span>📝</span>
          </button>
          <button class="icon-btn danger" title="Xoá tag" @click="confirmDelete(tag)">✕</button>
        </div>

        <!-- Description row (expandable) -->
        <div v-if="editingDescId === tag.id || tag.description" class="desc-row">
          <input v-if="editingDescId === tag.id"
            :value="tag.description || ''"
            class="desc-input"
            placeholder="Mô tả mục đích sử dụng tag này…"
            @blur="onDescBlur(tag, ($event.target as HTMLInputElement).value)"
            @keydown.enter="($event.target as HTMLInputElement).blur()" />
          <span v-else class="desc-text">📝 {{ tag.description }}</span>
        </div>
      </div>
    </div>

    <datalist id="categories-suggest">
      <option v-for="c in existingCategories" :key="c" :value="c" />
    </datalist>

    <!-- Create dialog -->
    <Teleport to="body">
      <div v-if="createDialog" class="dialog-backdrop" @click.self="createDialog = false">
        <div class="dialog">
          <h3>+ Thêm tag CRM mới</h3>
          <div class="dialog-form">
            <label>Tên *</label>
            <input v-model="newTag.name" type="text" placeholder="VD: VIP, Hot lead..." />

            <label>Danh mục</label>
            <input v-model="newTag.category" type="text" placeholder="VD: Mức độ, Nguồn" list="categories-suggest" />

            <label>Màu</label>
            <div class="color-row">
              <input v-model="newTag.color" type="color" />
              <div class="preset-colors">
                <button v-for="c in PRESET_COLORS" :key="c" class="preset-color"
                  :style="`background:${c}`" :class="{ selected: newTag.color === c }" @click="newTag.color = c" />
              </div>
            </div>

            <label>Emoji (tuỳ chọn)</label>
            <input v-model="newTag.emoji" type="text" maxlength="4" placeholder="🔥 ⭐ 💎" />

            <label>Mô tả</label>
            <textarea v-model="newTag.description" rows="2" placeholder="Khi nào nên gắn tag này?" />
          </div>
          <div class="dialog-actions">
            <button class="btn-link" @click="createDialog = false">Huỷ</button>
            <button class="btn-primary" :disabled="!newTag.name.trim() || creating" @click="submitCreate">
              {{ creating ? 'Đang tạo…' : 'Tạo' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete confirm -->
    <Teleport to="body">
      <div v-if="deleteTarget" class="dialog-backdrop" @click.self="deleteTarget = null">
        <div class="dialog">
          <h3>Xoá tag "{{ deleteTarget.name }}"?</h3>
          <p class="warn-text">Tag này đang gắn cho <strong>{{ deleteTarget.usageCount }}</strong> KH.</p>
          <label class="check-row">
            <input type="checkbox" v-model="removeFromContacts" />
            <span>Gỡ tag khỏi {{ deleteTarget.usageCount }} KH ({{ removeFromContacts ? 'CÓ' : 'KHÔNG' }})</span>
          </label>
          <div class="dialog-actions">
            <button class="btn-link" @click="deleteTarget = null">Huỷ</button>
            <button class="btn-primary danger" @click="submitDelete">Xoá</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Bulk delete confirm -->
    <Teleport to="body">
      <div v-if="showBulkDelete" class="dialog-backdrop" @click.self="showBulkDelete = false">
        <div class="dialog">
          <h3>Xoá {{ selected.size }} tag đã chọn?</h3>
          <label class="check-row">
            <input type="checkbox" v-model="removeFromContacts" />
            <span>Đồng thời gỡ các tag này khỏi mọi KH</span>
          </label>
          <div class="dialog-actions">
            <button class="btn-link" @click="showBulkDelete = false">Huỷ</button>
            <button class="btn-primary danger" @click="submitBulkDelete">Xoá {{ selected.size }} tag</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import ZaloBrandIcon from '@/components/icons/ZaloBrandIcon.vue';

/** Tag là Zalo-managed (synced từ Zalo SDK). Detect qua managedBy='zalo_sync'
 *  hoặc legacy prefix '🔵 ' nếu DB chưa migrate managedBy column. */
function isZaloTag(tag: { name: string; managedBy?: string | null }): boolean {
  return tag.managedBy === 'zalo_sync' || tag.name.startsWith('🔵 ');
}

/** Strip '🔵 ' prefix khỏi name khi display (DB vẫn store nguyên). */
function displayName(tag: { name: string }): string {
  return tag.name.startsWith('🔵 ') ? tag.name.slice(3) : tag.name;
}

/** Preview pill style — Zalo tag dùng brand blue tonal, CRM tag dùng tag.color tinted. */
function previewStyle(tag: CrmTag): string {
  if (isZaloTag(tag)) {
    const c = '#0068FF';
    return `background:${c}1f;color:${c};border-color:${c}99`;
  }
  return `background:${tag.color}22;color:${tag.color};border-color:${tag.color}`;
}

interface CrmTag {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  description: string | null;
  category: string | null;
  order: number;
  isActive: boolean;
  usageCount: number;
  /** 'zalo_sync' = synced từ Zalo SDK (read-only). null = CRM user-created. */
  managedBy?: string | null;
}

const toast = useToast();

const PRESET_COLORS = [
  '#E53935', '#F4511E', '#FB8C00', '#FDD835', '#7CB342',
  '#43A047', '#00ACC1', '#1E88E5', '#3949AB', '#8E24AA',
  '#D81B60', '#5D4037', '#546E7A', '#90A4AE',
];

const tags = ref<CrmTag[]>([]);
const loading = ref(false);
const recounting = ref(false);
const filter = ref('');
const filterCategory = ref('');
const editingDescId = ref<string | null>(null);

const createDialog = ref(false);
const creating = ref(false);
const newTag = ref({ name: '', color: '#1E88E5', emoji: '', category: '', description: '' });

const deleteTarget = ref<CrmTag | null>(null);
const removeFromContacts = ref(true);
const showBulkDelete = ref(false);

const selected = ref(new Set<string>());

// ── Drag-and-drop reorder ───────────────────────────────────────────────
const draggingId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onDragStart(id: string, e: DragEvent) {
  draggingId.value = id;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(id: string, e: DragEvent) {
  if (id !== draggingId.value) dragOverId.value = id;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}
function onDragLeave() { dragOverId.value = null; }
function onDragEnd() {
  draggingId.value = null;
  dragOverId.value = null;
}
async function onDrop(targetId: string, _e: DragEvent) {
  const src = draggingId.value;
  if (!src || src === targetId) {
    onDragEnd();
    return;
  }
  const fromIdx = tags.value.findIndex(t => t.id === src);
  const toIdx = tags.value.findIndex(t => t.id === targetId);
  if (fromIdx < 0 || toIdx < 0) {
    onDragEnd();
    return;
  }
  // Reorder optimistic
  const arr = [...tags.value];
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  tags.value = arr.map((t, i) => ({ ...t, order: i }));
  onDragEnd();
  // Persist
  try {
    await api.post('/crm-tags/reorder', { ids: arr.map(t => t.id) });
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Không lưu được thứ tự');
    void fetchTags();
  }
}

async function onPriorityChange(tagId: string, val: string) {
  const newPos = parseInt(val) - 1;
  if (Number.isNaN(newPos) || newPos < 0) return;
  const fromIdx = tags.value.findIndex(t => t.id === tagId);
  if (fromIdx < 0 || fromIdx === newPos) return;
  const arr = [...tags.value];
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(Math.min(newPos, arr.length), 0, moved);
  tags.value = arr.map((t, i) => ({ ...t, order: i }));
  try {
    await api.post('/crm-tags/reorder', { ids: arr.map(t => t.id) });
  } catch {
    void fetchTags();
  }
}

// ── Filter ──────────────────────────────────────────────────────────────
const filteredTags = computed(() => {
  let list = tags.value;
  if (filterCategory.value) list = list.filter(t => (t.category || '') === filterCategory.value);
  if (filter.value.trim()) {
    const q = filter.value.toLowerCase();
    list = list.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q),
    );
  }
  return list;
});

const existingCategories = computed(() => {
  const s = new Set<string>();
  for (const t of tags.value) if (t.category) s.add(t.category);
  return [...s].sort();
});
const activeCount = computed(() => tags.value.filter(t => t.usageCount > 0).length);
const unusedCount = computed(() => tags.value.filter(t => t.usageCount === 0).length);
const categoryCount = computed(() => existingCategories.value.length);

// ── Bulk select ─────────────────────────────────────────────────────────
const allSelected = computed(() => filteredTags.value.length > 0 && filteredTags.value.every(t => selected.value.has(t.id)));
const someSelected = computed(() => filteredTags.value.some(t => selected.value.has(t.id)) && !allSelected.value);

function toggleSelect(id: string) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
  selected.value = new Set(selected.value);
}
function toggleSelectAll() {
  if (allSelected.value) {
    selected.value.clear();
  } else {
    for (const t of filteredTags.value) selected.value.add(t.id);
  }
  selected.value = new Set(selected.value);
}

function bulkDelete() {
  showBulkDelete.value = true;
  removeFromContacts.value = true;
}

async function submitBulkDelete() {
  const ids = [...selected.value];
  try {
    await Promise.all(ids.map(id =>
      api.delete(`/crm-tags/${id}`, { data: { removeFromContacts: removeFromContacts.value } }),
    ));
    tags.value = tags.value.filter(t => !selected.value.has(t.id));
    toast.success(`✓ Đã xoá ${ids.length} tag`);
    selected.value.clear();
    selected.value = new Set();
    showBulkDelete.value = false;
  } catch {
    toast.error('Xoá hàng loạt thất bại');
  }
}

// ── Single CRUD ─────────────────────────────────────────────────────────
async function fetchTags(recount = false) {
  loading.value = true;
  try {
    const { data } = await api.get(`/crm-tags${recount ? '?recount=1' : ''}`);
    tags.value = data.tags || [];
  } catch (err) {
    console.error(err);
    toast.error('Không tải được tag CRM');
  } finally {
    loading.value = false;
  }
}

async function recount() {
  recounting.value = true;
  try {
    await fetchTags(true);
    toast.success('✓ Đã cập nhật số liệu');
  } finally {
    recounting.value = false;
  }
}

function openCreate() {
  newTag.value = { name: '', color: '#1E88E5', emoji: '', category: '', description: '' };
  createDialog.value = true;
}

async function submitCreate() {
  if (!newTag.value.name.trim()) return;
  creating.value = true;
  try {
    const { data } = await api.post('/crm-tags', {
      name: newTag.value.name.trim(),
      color: newTag.value.color,
      emoji: newTag.value.emoji || undefined,
      category: newTag.value.category || undefined,
      description: newTag.value.description || undefined,
    });
    tags.value = [...tags.value, data.tag];
    toast.success('✓ Đã tạo tag');
    createDialog.value = false;
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Tạo tag thất bại');
  } finally {
    creating.value = false;
  }
}

async function patchTag(tag: CrmTag, body: Partial<CrmTag>) {
  const snapshot = { ...tag };
  Object.assign(tag, body);
  try {
    const { data } = await api.patch(`/crm-tags/${tag.id}`, body);
    Object.assign(tag, data.tag);
  } catch (err: any) {
    Object.assign(tag, snapshot);
    toast.error(err.response?.data?.error || 'Cập nhật thất bại');
  }
}

function onRename(tag: CrmTag, newName: string) {
  const t = newName.trim();
  if (!t || t === tag.name) return;
  patchTag(tag, { name: t });
}
function onDescBlur(tag: CrmTag, value: string) {
  editingDescId.value = null;
  const v = value.trim();
  if (v === (tag.description || '')) return;
  patchTag(tag, { description: v || null });
}

async function cloneTag(tag: CrmTag) {
  try {
    const { data } = await api.post('/crm-tags', {
      name: `${tag.name} (copy)`,
      color: tag.color,
      emoji: tag.emoji,
      category: tag.category,
      description: tag.description,
    });
    tags.value = [...tags.value, data.tag];
    toast.success('✓ Đã clone tag');
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Clone thất bại');
  }
}

function confirmDelete(tag: CrmTag) {
  deleteTarget.value = tag;
  removeFromContacts.value = tag.usageCount > 0;
}

async function submitDelete() {
  if (!deleteTarget.value) return;
  try {
    await api.delete(`/crm-tags/${deleteTarget.value.id}`, {
      data: { removeFromContacts: removeFromContacts.value },
    });
    tags.value = tags.value.filter(t => t.id !== deleteTarget.value!.id);
    toast.success('✓ Đã xoá');
    deleteTarget.value = null;
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Xoá thất bại');
  }
}

onMounted(() => { void fetchTags(); });
</script>

<style scoped>
.crmtag-settings { max-width: 1280px; }
.settings-section-header { margin-bottom: 16px; }
.subtitle { font-size: 13px; color: var(--smax-grey-600); line-height: 1.5; margin: 0; }
.subtitle strong { color: var(--smax-text); }

/* ── Toolbar ──────────────────────────────────────────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.toolbar-spacer { flex: 1; }
.toolbar-btn {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.toolbar-btn:hover:not(:disabled) { background: var(--smax-primary-soft); color: var(--smax-primary); }
.toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.toolbar-btn.primary { background: var(--smax-primary); color: #fff; border-color: var(--smax-primary); }
.toolbar-btn.primary:hover { background: #1e4cc7; color: #fff; }
.toolbar-btn.danger {
  background: #ffebee; color: #c62828; border-color: #ef9a9a;
}
.toolbar-btn.danger:hover { background: #ffcdd2; color: #b71c1c; }

.filter-select, .filter-input {
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 6px 11px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.filter-select { min-width: 160px; }
.filter-input { min-width: 200px; }
.filter-select:focus, .filter-input:focus { border-color: var(--smax-primary); }

/* ── Stats ────────────────────────────────────────────────────────────── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.stat-card {
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 10px;
  padding: 11px 16px;
}
.stat-num { font-size: 24px; font-weight: 700; color: var(--smax-primary); line-height: 1.1; }
.stat-label {
  font-size: 11px; color: var(--smax-grey-600);
  text-transform: uppercase; letter-spacing: 0.4px; margin-top: 2px;
}

/* ── List ─────────────────────────────────────────────────────────────── */
.tag-list {
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 10px;
  overflow: hidden;
}

.list-header {
  display: grid;
  grid-template-columns: 32px 90px 160px 1fr 160px 50px 160px;
  gap: 10px;
  padding: 8px 14px;
  background: var(--smax-grey-50, #f9fafb);
  border-bottom: 1px solid var(--smax-grey-200);
  font-size: 11px;
  font-weight: 700;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  align-items: center;
}
.check-all { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.check-all input { cursor: pointer; }

.tag-row {
  display: grid;
  grid-template-columns: 32px 90px 160px 1fr 160px 50px 160px;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--smax-grey-100);
  align-items: center;
  transition: background 0.12s, border-color 0.12s;
  position: relative;
}
.tag-row:hover { background: var(--smax-grey-50, #f9fafb); }
.tag-row.selected { background: var(--smax-primary-soft); }
.tag-row.inactive { opacity: 0.55; }
.tag-row.dragging { opacity: 0.4; }
.tag-row.drag-over::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--smax-primary);
}
.tag-row:last-child { border-bottom: none; }

.row-check { display: flex; align-items: center; cursor: pointer; }
.row-check input { cursor: pointer; }

/* Priority cell */
.priority-cell { display: flex; align-items: center; gap: 6px; }
.drag-handle {
  cursor: grab;
  color: var(--smax-grey-400);
  font-weight: 700;
  user-select: none;
  font-size: 14px;
}
.drag-handle:active { cursor: grabbing; }
.priority-input {
  width: 50px;
  text-align: center;
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--smax-primary);
  font-family: inherit;
  outline: none;
}
.priority-input:focus { border-color: var(--smax-primary); background: var(--smax-primary-soft); }

/* Preview */
.preview-cell { display: flex; align-items: center; }
.tag-preview {
  padding: 3px 11px;
  border-radius: 12px;
  font-size: 12.5px;
  font-weight: 600;
  border: 1.5px solid;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* Zalo locked name cell — read-only display thay input (Zalo sync 1-chiều) */
.zalo-locked {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: color-mix(in srgb, #0068FF 6%, white);
  border: 1px dashed color-mix(in srgb, #0068FF 40%, white);
  border-radius: 6px;
  color: color-mix(in srgb, #0068FF 80%, black);
  font-size: 13px;
  font-weight: 500;
  cursor: help;
}
.zalo-locked-name { font-weight: 600; }
.lock-icon { font-size: 11px; opacity: 0.6; }

/* Zalo tag preview — match TagCrmBar.tag-pill.tag-zalo: brand icon + "Zalo" badge.
 * Cần position:relative cho ::before. margin-right chừa cho badge nhô góc phải. */
.tag-preview-zalo {
  position: relative;
  margin-right: 6px;
}
.tag-preview-zalo::before {
  content: 'Zalo';
  position: absolute;
  top: -7px;
  right: -4px;
  background: #0068FF;
  color: white;
  font-size: 7.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  padding: 1px 5px;
  border-radius: 99px;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Name cell */
.name-cell { display: flex; align-items: center; gap: 6px; }
.color-picker {
  width: 32px;
  height: 26px;
  border: 1px solid var(--smax-grey-200);
  border-radius: 5px;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
}
.emoji-input, .name-input, .category-input {
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 4px 7px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  background: transparent;
}
.emoji-input:hover, .name-input:hover, .category-input:hover { border-color: var(--smax-grey-200); }
.emoji-input:focus, .name-input:focus, .category-input:focus {
  border-color: var(--smax-primary);
  background: var(--smax-primary-soft);
}
.emoji-input { width: 40px; text-align: center; flex-shrink: 0; }
.name-input { flex: 1; font-weight: 600; min-width: 0; }

/* Category */
.category-cell { display: flex; align-items: center; }
.category-input { width: 100%; font-size: 12px; color: var(--smax-grey-600); }

/* Usage */
.usage-cell { display: flex; align-items: center; justify-content: center; }
.usage-badge {
  background: rgba(0, 200, 83, 0.12);
  color: #00897b;
  padding: 2px 9px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 700;
  min-width: 24px;
  text-align: center;
}
.usage-badge.zero { background: var(--smax-grey-100); color: var(--smax-grey-500); }

/* Actions */
.actions-cell { display: flex; align-items: center; gap: 2px; }
.icon-btn {
  background: transparent;
  border: 1px solid transparent;
  width: 30px;
  height: 28px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;
  color: var(--smax-grey-500);
}
.icon-btn:hover { background: var(--smax-grey-200); color: var(--smax-grey-700); }
.icon-btn.danger:hover { background: #ffebee; color: #c62828; border-color: #ef9a9a; }

/* Description expand row */
.desc-row {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding: 4px 0;
  border-top: 1px dashed var(--smax-grey-100);
}
.desc-input {
  width: 100%;
  border: 1.5px solid var(--smax-primary);
  border-radius: 5px;
  padding: 5px 8px;
  font-family: inherit;
  font-size: 12px;
  outline: none;
  background: var(--smax-primary-soft);
}
.desc-text {
  font-size: 12px;
  color: var(--smax-grey-600);
  font-style: italic;
}

.loading-state, .empty-state {
  padding: 40px;
  text-align: center;
  color: var(--smax-grey-500);
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 10px;
}

/* ── Dialog ───────────────────────────────────────────────────────────── */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.dialog {
  background: #fff;
  border-radius: 12px;
  min-width: 420px;
  max-width: 480px;
  padding: 20px 24px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.2);
}
.dialog h3 { margin: 0 0 14px; font-size: 16px; }
.dialog-form { display: flex; flex-direction: column; gap: 4px; }
.dialog-form label {
  font-size: 11px; font-weight: 700;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: 8px;
}
.dialog-form input[type="text"],
.dialog-form textarea {
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
  padding: 7px 10px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.dialog-form input[type="text"]:focus,
.dialog-form textarea:focus { border-color: var(--smax-primary); }

.color-row { display: flex; align-items: center; gap: 10px; }
.color-row input[type="color"] {
  width: 44px; height: 32px;
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px; padding: 0; cursor: pointer;
}
.preset-colors { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.preset-color {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer; padding: 0;
}
.preset-color:hover { transform: scale(1.15); }
.preset-color.selected {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--smax-primary);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--smax-grey-100);
}
.btn-link {
  background: transparent;
  border: none;
  color: var(--smax-grey-600);
  font-size: 13px;
  cursor: pointer;
  padding: 6px 12px;
}
.btn-primary {
  background: var(--smax-primary);
  color: #fff; border: none;
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary.danger { background: #c62828; }

.warn-text { color: var(--smax-grey-700); font-size: 13px; margin: 8px 0; }
.check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--smax-grey-700);
  padding: 8px 10px;
  background: var(--smax-grey-50);
  border-radius: 6px;
  cursor: pointer;
}
</style>
