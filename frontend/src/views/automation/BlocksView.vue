<template>
  <div class="blocks-view">
    <header class="at-page-header">
      <div>
        <h1 class="at-page-title">Khối</h1>
        <p class="at-page-subtitle">
          Khối là đơn vị action nhỏ nhất (gửi tin, kết bạn, đổi status...).
          Tạo 1 lần, tái sử dụng trong nhiều Luồng kịch bản và Broadcast.
        </p>
      </div>
      <button class="at-btn at-btn--primary" @click="openCreate">
        <v-icon size="18">mdi-plus</v-icon>
        Tạo Khối
      </button>
    </header>

    <div class="layout-2col">
      <aside class="folder-sidebar">
        <div class="folder-sidebar__head">
          <span class="folder-sidebar__title">Folder</span>
          <button class="at-btn at-btn--ghost at-btn--xs" @click="createFolderInline" title="Tạo folder">
            <v-icon size="16">mdi-folder-plus-outline</v-icon>
          </button>
        </div>
        <ul class="folder-list">
          <li>
            <button class="folder-item" :class="{ 'is-active': !selectedFolderId && !showArchived }" @click="onSelectAll">
              <v-icon size="16">mdi-view-grid-outline</v-icon>
              <span class="folder-item__label">Tất cả</span>
              <span class="folder-item__count">{{ allCount }}</span>
            </button>
          </li>
          <li v-for="folder in folders" :key="folder.id">
            <button class="folder-item" :class="{ 'is-active': selectedFolderId === folder.id }" @click="onSelectFolder(folder.id)">
              <v-icon size="16">mdi-folder-outline</v-icon>
              <span class="folder-item__label">{{ folder.name }}</span>
              <span class="folder-item__count">{{ folder._count?.blocks ?? 0 }}</span>
            </button>
          </li>
          <li class="folder-divider"><hr class="at-hairline" /></li>
          <li>
            <button class="folder-item" :class="{ 'is-active': showArchived }" @click="onSelectArchived">
              <v-icon size="16">mdi-archive-outline</v-icon>
              <span class="folder-item__label">Đã archive</span>
            </button>
          </li>
        </ul>
      </aside>

      <section class="block-list-section">
        <div class="block-toolbar">
          <div class="block-toolbar__title">
            {{ selectedFolderName }}
            <span class="at-chip block-toolbar__count">{{ filteredBlocks.length }}</span>
          </div>
          <div class="block-toolbar__filters">
            <button
              class="filter-chip"
              :class="{ 'is-active': actionTypeFilter === 'all' }"
              @click="actionTypeFilter = 'all'"
            >
              Tất cả
            </button>
            <button
              v-for="type in actionTypeChips"
              :key="type.value"
              class="filter-chip"
              :class="{ 'is-active': actionTypeFilter === type.value }"
              @click="actionTypeFilter = type.value"
            >
              <v-icon size="14">{{ type.icon }}</v-icon>
              {{ type.label }}
            </button>
          </div>
        </div>

        <div v-if="loading" class="at-empty">
          <v-progress-circular indeterminate size="28" color="primary" />
        </div>

        <div v-else-if="filteredBlocks.length === 0" class="at-empty">
          <v-icon size="48">mdi-puzzle-outline</v-icon>
          <div class="at-empty__title">
            {{ showArchived ? 'Không có block nào đã archive' : 'Chưa có block nào ở đây' }}
          </div>
          <p v-if="!showArchived" class="at-empty__desc">
            Block là viên gạch của Sequence/Broadcast. Bắt đầu bằng "Gửi tin nhắn" hoặc "Đổi trạng thái".
          </p>
          <button v-if="!showArchived" class="at-btn at-btn--primary" @click="openCreate">
            <v-icon size="18">mdi-plus</v-icon>
            Tạo Khối đầu tiên
          </button>
        </div>

        <div v-else class="block-grid">
          <article
            v-for="block in filteredBlocks"
            :key="block.id"
            class="block-card"
            :style="{
              '--card-accent': ACTION_TYPE_COLOR[block.actionType].bg,
              '--card-tint': ACTION_TYPE_COLOR[block.actionType].tint,
              '--card-text': ACTION_TYPE_COLOR[block.actionType].text,
            }"
            :class="{ 'is-archived': block.archivedAt }"
          >
            <div class="block-card__icon">
              <v-icon size="20">{{ ACTION_TYPE_ICONS[block.actionType] }}</v-icon>
            </div>
            <div class="block-card__body">
              <div class="block-card__name">{{ block.name }}</div>
              <div class="block-card__meta">
                <span>{{ ACTION_TYPE_LABELS[block.actionType] }}</span>
                <span v-if="block.usageCount > 0" class="meta-usage">
                  <v-icon size="11">mdi-link-variant</v-icon> {{ block.usageCount }}
                </span>
                <span v-if="block.archivedAt" class="meta-archived">archived</span>
              </div>
            </div>
            <div class="block-card__actions">
              <button class="at-btn at-btn--ghost at-btn--xs" @click="openEdit(block)" title="Sửa">
                <v-icon size="16">mdi-pencil-outline</v-icon>
              </button>
              <button class="at-btn at-btn--ghost at-btn--xs" @click="onDuplicate(block)" title="Nhân bản">
                <v-icon size="16">mdi-content-copy</v-icon>
              </button>
              <button v-if="!block.archivedAt" class="at-btn at-btn--ghost at-btn--xs" @click="onArchive(block)" title="Archive">
                <v-icon size="16">mdi-archive-arrow-down-outline</v-icon>
              </button>
              <button v-else class="at-btn at-btn--ghost at-btn--xs" @click="onUnarchive(block)" title="Bỏ archive">
                <v-icon size="16">mdi-archive-arrow-up-outline</v-icon>
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <BlockEditorDialog
      v-model="editorOpen"
      :block="editingBlock"
      :folders="folders"
      :status-items="statusItems"
      @saved="onSaved"
    />

    <v-snackbar v-model="toastOpen" :color="toastColor" timeout="3000" location="bottom right">
      {{ toastMsg }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { blocksApi } from '@/api/automation';
import { ACTION_TYPE_LABELS, ACTION_TYPE_ICONS, SUPPORTED_ACTION_TYPES, type Block, type BlockFolder, type BlockActionType } from '@/api/automation/types';
import BlockEditorDialog from '@/components/automation/phase7/BlockEditorDialog.vue';
import { ACTION_TYPE_COLOR } from '@/components/automation/phase7/design-tokens';
import { api } from '@/api';

const blocks = ref<Block[]>([]);
const folders = ref<BlockFolder[]>([]);
const statusItems = ref<Array<{ id: string; name: string }>>([]);
const loading = ref(true);

const selectedFolderId = ref<string | null>(null);
const showArchived = ref(false);
const actionTypeFilter = ref<BlockActionType | 'all'>('all');

const editorOpen = ref(false);
const editingBlock = ref<Block | null>(null);

const toastOpen = ref(false);
const toastMsg = ref('');
const toastColor = ref<'success' | 'error' | 'info'>('info');

const actionTypeChips = SUPPORTED_ACTION_TYPES.map((value) => ({
  value,
  label: ACTION_TYPE_LABELS[value],
  icon: ACTION_TYPE_ICONS[value],
}));

const selectedFolderName = computed(() => {
  if (showArchived.value) return 'Đã archive';
  if (!selectedFolderId.value) return 'Tất cả block';
  return folders.value.find((f) => f.id === selectedFolderId.value)?.name ?? 'Folder';
});

const allCount = computed(() => blocks.value.filter((b) => !b.archivedAt).length);

const filteredBlocks = computed(() => {
  return blocks.value.filter((b) => {
    if (showArchived.value) { if (!b.archivedAt) return false; }
    else { if (b.archivedAt) return false; }
    if (selectedFolderId.value !== null && b.folderId !== selectedFolderId.value) return false;
    if (actionTypeFilter.value !== 'all' && b.actionType !== actionTypeFilter.value) return false;
    return true;
  });
});

function onSelectAll() { selectedFolderId.value = null; showArchived.value = false; }
function onSelectFolder(id: string) { selectedFolderId.value = id; showArchived.value = false; }
function onSelectArchived() { showArchived.value = true; selectedFolderId.value = null; }

async function loadAll() {
  loading.value = true;
  try {
    const [b, f, statusRes] = await Promise.all([
      blocksApi.listBlocks({ includeArchived: true, limit: 500 }),
      blocksApi.listFolders(),
      api.get<{ statuses: Array<{ id: string; name: string }> }>('/statuses').then((r) => r.data.statuses).catch(() => []),
    ]);
    blocks.value = b;
    folders.value = f;
    statusItems.value = Array.isArray(statusRes) ? statusRes : [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

function openCreate() { editingBlock.value = null; editorOpen.value = true; }
function openEdit(block: Block) { editingBlock.value = block; editorOpen.value = true; }

function showToast(msg: string, color: 'success' | 'error' | 'info' = 'info') {
  toastMsg.value = msg; toastColor.value = color; toastOpen.value = true;
}

function onSaved(_block: Block) { loadAll(); showToast('Đã lưu block', 'success'); }

async function onDuplicate(block: Block) {
  await blocksApi.duplicateBlock(block.id);
  loadAll();
  showToast('Đã nhân bản', 'success');
}
async function onArchive(block: Block) {
  if (!confirm(`Archive block "${block.name}"? Task đang chạy vẫn dùng snapshot — không bị ảnh hưởng.`)) return;
  await blocksApi.archiveBlock(block.id);
  loadAll();
  showToast('Đã archive', 'success');
}
async function onUnarchive(block: Block) {
  await blocksApi.unarchiveBlock(block.id);
  loadAll();
  showToast('Đã unarchive', 'success');
}

async function createFolderInline() {
  const name = prompt('Tên folder?');
  if (!name?.trim()) return;
  await blocksApi.createFolder({ name: name.trim() });
  loadAll();
  showToast('Đã tạo folder', 'success');
}
</script>

<style scoped>
.blocks-view { max-width: 1280px; }

.layout-2col {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: var(--at-s-lg);
}

.folder-sidebar {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-sm);
  height: fit-content;
  position: sticky;
  top: 12px;
}
.folder-sidebar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--at-s-xs);
  padding: 0 var(--at-s-xxs);
}
.folder-sidebar__title {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--at-muted);
}

.folder-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.folder-divider { padding: var(--at-s-xxs) 0; }
.folder-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: transparent;
  border: 0;
  border-radius: var(--at-r-sm);
  cursor: pointer;
  font-size: 14px;
  color: var(--at-body);
  text-align: left;
  font-family: inherit;
}
.folder-item:hover { background: var(--at-surface-soft); }
.folder-item.is-active {
  background: var(--at-ink);
  color: var(--at-on-primary);
}
.folder-item__label { flex: 1; }
.folder-item__count {
  font-size: 11px;
  color: var(--at-muted);
  background: var(--at-surface-soft);
  padding: 2px 7px;
  border-radius: var(--at-r-pill);
}
.folder-item.is-active .folder-item__count {
  color: var(--at-on-primary);
  background: rgba(255,255,255,0.15);
}

.block-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--at-s-sm);
  margin-bottom: var(--at-s-md);
}
.block-toolbar__title {
  font-size: 18px;
  font-weight: 500;
  color: var(--at-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.block-toolbar__filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.filter-chip {
  background: var(--at-canvas);
  color: var(--at-body);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-pill);
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: inherit;
}
.filter-chip.is-active {
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-color: var(--at-ink);
}

.block-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--at-s-xs);
}
.block-card {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-sm);
  display: flex;
  align-items: center;
  gap: var(--at-s-sm);
  position: relative;
  transition: border-color 0.1s;
}
.block-card::before {
  content: '';
  position: absolute;
  left: 0; top: var(--at-s-sm); bottom: var(--at-s-sm);
  width: 3px;
  border-radius: 2px;
  background: var(--card-accent);
}
.block-card:hover { border-color: var(--card-accent); }
.block-card.is-archived { opacity: 0.55; }

.block-card__icon {
  width: 36px;
  height: 36px;
  border-radius: var(--at-r-md);
  background: var(--card-tint);
  color: var(--card-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.block-card__body { flex: 1; min-width: 0; }
.block-card__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--at-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.block-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--at-muted);
}
.meta-usage { display: inline-flex; align-items: center; gap: 2px; }
.meta-archived {
  background: var(--at-surface-soft);
  padding: 2px 6px;
  border-radius: var(--at-r-sm);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.block-card__actions {
  display: flex;
  gap: 0;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s;
}
.block-card:hover .block-card__actions { opacity: 1; }

@media (max-width: 900px) {
  .layout-2col { grid-template-columns: 1fr; }
  .folder-sidebar { position: relative; }
}
</style>
