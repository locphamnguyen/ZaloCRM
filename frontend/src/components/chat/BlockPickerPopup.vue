<!--
  BlockPickerPopup — Phase 1 MVP 2026-06-04 (Mockup 3 approved)
  Upgrade M14 cũ: thay vì chỉ chèn text, giờ resolve full components → emit array.
  - Tabs: ⚡ Gần đây / 📋 Tất cả
  - Tag chip filter row
  - Mỗi item: 👁 Xem trước (mở Preview dialog) + 📤 Gửi luôn (bỏ qua preview)
  - Hỗ trợ multi-component (text + image + album + file + video)
-->
<template>
  <v-dialog
    :model-value="visible"
    max-width="720"
    scrollable
    @update:model-value="(v) => { if (!v) emit('close'); }"
  >
    <v-card class="bp-card" rounded="lg">
      <!-- Header -->
      <div class="bp-header">
        <span class="bp-icon"><FolderOpenIcon :size="18" :stroke-width="2" /></span>
        <span class="bp-title">Chọn Khối để gửi</span>
        <button class="bp-close" @click="emit('close')"><XIcon :size="18" :stroke-width="2" /></button>
      </div>

      <!-- Tabs -->
      <div class="bp-tabs">
        <button
          class="bp-tab"
          :class="{ active: activeTab === 'recent' }"
          @click="activeTab = 'recent'"
        ><ZapIcon :size="14" :stroke-width="2" /> Gần đây <span class="bp-tab-badge">{{ recentBlocks.length }}</span></button>
        <button
          class="bp-tab"
          :class="{ active: activeTab === 'all' }"
          @click="activeTab = 'all'"
        ><LayoutListIcon :size="14" :stroke-width="2" /> Tất cả <span class="bp-tab-badge">{{ allBlocks.length }}</span></button>
      </div>

      <!-- Search -->
      <div class="bp-search">
        <span class="bp-search-icon"><SearchIcon :size="15" :stroke-width="2" /></span>
        <input
          ref="searchRef"
          v-model="searchQuery"
          type="text"
          class="bp-search-input"
          placeholder="Tìm Khối theo tên, nội dung, tag..."
          @keydown="onKey"
        />
      </div>

      <!-- Tag filter row -->
      <div v-if="availableTags.length > 0" class="bp-tag-row">
        <span class="bp-tag-label"><TagIcon :size="14" :stroke-width="2" /></span>
        <button
          v-for="tag in availableTags.slice(0, 8)"
          :key="tag"
          class="bp-tag-chip"
          :class="{ active: selectedTags.includes(tag) }"
          @click="toggleTag(tag)"
        >{{ tag }}</button>
        <span v-if="selectedTags.length > 0" class="bp-tag-status">
          <CheckIcon :size="13" :stroke-width="2.2" /> Đang lọc {{ selectedTags.length }} tag · {{ filtered.length }} Khối
        </span>
      </div>

      <!-- Body -->
      <div class="bp-body">
        <div v-if="loading" class="bp-empty">
          <v-progress-circular indeterminate size="28" color="primary" />
          <div class="bp-empty-text">Đang tải Khối...</div>
        </div>
        <div v-else-if="loadError" class="bp-empty">
          <AlertTriangleIcon :size="28" :stroke-width="1.8" /> {{ loadError }}
        </div>
        <div v-else-if="filtered.length === 0" class="bp-empty">
          <InboxIcon :size="32" :stroke-width="1.6" />
          <div class="bp-empty-text">
            {{ allBlocks.length === 0 ? 'Chưa có Khối nào. Tạo tại /marketing/blocks.' : 'Không tìm thấy Khối phù hợp.' }}
          </div>
        </div>

        <div v-else class="bp-list">
          <article
            v-for="block in filtered"
            :key="block.id"
            class="bp-item"
            :class="{ 'kind-friend': block.actionType === 'request_friend' }"
          >
            <div class="bp-item-icon">{{ blockIcon(block) }}</div>
            <div class="bp-item-info">
              <div class="bp-item-name">{{ block.name }}</div>
              <div class="bp-item-meta">
                <span v-if="block.folder?.visibility === 'private'" class="bp-vis private"><LockIcon :size="12" :stroke-width="2" /></span>
                <span v-else class="bp-vis public"><UnlockIcon :size="12" :stroke-width="2" /></span>
                {{ block.folder?.visibility === 'private' ? 'Riêng tư' : 'Công khai' }}
                <span v-if="block.folder" class="bp-meta-seg"> · <FolderIcon :size="12" :stroke-width="2" /> {{ block.folder.name }}</span>
                <span
                  v-for="tag in (block.tagIds || []).slice(0, 2)"
                  :key="tag"
                  class="bp-tag-mini"
                >{{ tag }}</span>
                <span v-if="variantCount(block) > 0" class="bp-meta-seg"> · <ShuffleIcon :size="12" :stroke-width="2" /> {{ variantCount(block) }} mẫu</span>
                <span v-if="block.lastUsedAt"> · {{ timeAgo(block.lastUsedAt) }}</span>
              </div>
            </div>
            <div class="bp-item-actions">
              <button class="bp-btn-small" @click="onPreview(block)" title="Xem trước trước khi gửi">
                <EyeIcon :size="14" :stroke-width="2" /> Xem trước
              </button>
              <button class="bp-btn-small bp-btn-primary" :disabled="sendingId === block.id" @click="onSendDirect(block)" title="Gửi thẳng, bỏ qua xem trước">
                <Loader2Icon v-if="sendingId === block.id" class="bp-spin" :size="14" :stroke-width="2" />
                <SendIcon v-else :size="14" :stroke-width="2" /> Gửi luôn
              </button>
            </div>
          </article>
        </div>
      </div>

      <!-- Footer -->
      <div class="bp-footer">
        <span class="bp-hint"><kbd>↑↓</kbd> chọn · <kbd>Enter</kbd> Xem trước · <kbd>Esc</kbd> đóng</span>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { listBlocks, listRecentBlocks } from '@/api/automation/blocks';
import type { Block } from '@/api/automation/types';
// Icon chrome — Lucide line (anh chốt 2026-06-08, bỏ emoji nút).
import {
  FolderOpen as FolderOpenIcon,
  X as XIcon,
  Zap as ZapIcon,
  LayoutList as LayoutListIcon,
  Search as SearchIcon,
  Tag as TagIcon,
  Check as CheckIcon,
  Eye as EyeIcon,
  Send as SendIcon,
  Loader2 as Loader2Icon,
  Inbox as InboxIcon,
  AlertTriangle as AlertTriangleIcon,
  Lock as LockIcon,
  Unlock as UnlockIcon,
  Folder as FolderIcon,
  Shuffle as ShuffleIcon,
} from 'lucide-vue-next';

const props = defineProps<{
  visible: boolean;
  contact?: { fullName?: string | null; gender?: string | null; phone?: string | null } | null;
  currentUserName?: string | null;
  ownerNickId?: string | null;
}>();

const emit = defineEmits<{
  /** Sale chọn preview — parent mở Preview dialog (truyền cả block) */
  preview: [block: Block];
  /** Sale chọn gửi luôn — parent resolve + dispatch */
  'send-direct': [block: Block];
  close: [];
}>();

const allBlocks = ref<Block[]>([]);
const recentBlocks = ref<Block[]>([]);
const loading = ref(false);
const loadError = ref('');
const searchQuery = ref('');
const selectedIndex = ref(0);
const selectedTags = ref<string[]>([]);
const activeTab = ref<'recent' | 'all'>('recent');
const sendingId = ref<string | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);

async function fetchAll() {
  loading.value = true;
  loadError.value = '';
  try {
    const [all, recent] = await Promise.all([
      listBlocks({ actionType: 'send_message', limit: 100 }),
      listRecentBlocks().catch(() => [] as Block[]),
    ]);
    allBlocks.value = all;
    recentBlocks.value = recent.filter((b) => b.actionType === 'send_message');
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => props.visible, async (open) => {
  if (!open) return;
  searchQuery.value = '';
  selectedIndex.value = 0;
  selectedTags.value = [];
  activeTab.value = recentBlocks.value.length > 0 ? 'recent' : 'all';
  await fetchAll();
  await nextTick();
  searchRef.value?.focus();
});

const availableTags = computed(() => {
  const set = new Set<string>();
  for (const b of allBlocks.value) {
    for (const t of b.tagIds || []) set.add(t);
  }
  return Array.from(set).sort();
});

const filtered = computed(() => {
  const source = activeTab.value === 'recent' ? recentBlocks.value : allBlocks.value;
  const q = searchQuery.value.trim().toLowerCase();
  let list = source.filter((b) => {
    if (selectedTags.value.length > 0) {
      if (!(b.tagIds || []).some((t) => selectedTags.value.includes(t))) return false;
    }
    if (!q) return true;
    if (b.name.toLowerCase().includes(q)) return true;
    const txt = JSON.stringify(b.content).slice(0, 500).toLowerCase();
    return txt.includes(q);
  });
  if (props.ownerNickId) {
    list = [...list].sort((a, b) => {
      const aMatch = a.ownerNickId === props.ownerNickId ? 0 : 1;
      const bMatch = b.ownerNickId === props.ownerNickId ? 0 : 1;
      return aMatch - bMatch;
    });
  }
  return list;
});

watch(filtered, () => { selectedIndex.value = 0; });

function toggleTag(tag: string) {
  const i = selectedTags.value.indexOf(tag);
  if (i >= 0) selectedTags.value.splice(i, 1);
  else selectedTags.value.push(tag);
}

function blockIcon(block: Block): string {
  if (block.actionType === 'request_friend') return '🤝';
  return '📨';
}

function variantCount(block: Block): number {
  const c = block.content as any;
  if (Array.isArray(c?.greetingVariants)) return c.greetingVariants.length;
  if (Array.isArray(c?.textVariants)) return c.textVariants.length;
  if (Array.isArray(c?.components)) {
    let n = 0;
    for (const cmp of c.components) {
      if (cmp?.kind === 'text') {
        n += (Array.isArray(cmp.variants) ? cmp.variants.length : 0) + 1;
      }
    }
    return n;
  }
  return 0;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

function onPreview(block: Block) {
  emit('preview', block);
}

async function onSendDirect(block: Block) {
  sendingId.value = block.id;
  try {
    emit('send-direct', block);
  } finally {
    // Giữ sendingId cho tới khi parent gọi close
    setTimeout(() => { sendingId.value = null; }, 500);
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filtered.value.length > 0) selectedIndex.value = (selectedIndex.value + 1) % filtered.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filtered.value.length > 0) selectedIndex.value = (selectedIndex.value - 1 + filtered.value.length) % filtered.value.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const block = filtered.value[selectedIndex.value];
    if (block) onPreview(block);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}
</script>

<style scoped>
.bp-card {
  background: #fff;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
}

.bp-header {
  padding: 14px 18px;
  border-bottom: 1px solid #e6e8eb;
  display: flex;
  align-items: center;
  gap: 12px;
}
.bp-icon { font-size: 18px; }
.bp-title { font-size: 15px; font-weight: 700; color: #1f2328; flex: 1; }
.bp-close {
  width: 30px;
  height: 30px;
  background: transparent;
  border: 0;
  color: #6b7280;
  cursor: pointer;
  border-radius: 6px;
  font-size: 16px;
}
.bp-close:hover { background: #f4f5f7; color: #1f2328; }

.bp-tabs {
  display: flex;
  gap: 2px;
  padding: 0 18px;
  border-bottom: 1px solid #e6e8eb;
  background: #fafbfc;
}
.bp-tab {
  padding: 9px 14px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 12.5px;
  font-weight: 600;
  color: #6b7280;
  cursor: pointer;
  font-family: inherit;
}
.bp-tab:hover { color: #1f2328; }
.bp-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }
.bp-tab-badge {
  font-size: 10px;
  background: rgba(59,130,246,0.15);
  color: #1d4ed8;
  padding: 1px 5px;
  border-radius: 8px;
  margin-left: 4px;
  font-weight: 600;
}

.bp-search {
  padding: 11px 18px;
  border-bottom: 1px solid #e6e8eb;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}
.bp-search-icon {
  position: absolute;
  left: 28px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  font-size: 13px;
}
.bp-search-input {
  flex: 1;
  padding: 7px 11px 7px 32px;
  border: 1px solid #d4d7dc;
  border-radius: 6px;
  font-size: 12.5px;
  outline: none;
  font-family: inherit;
}
.bp-search-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.18); }

.bp-tag-row {
  padding: 6px 18px 11px;
  border-bottom: 1px solid #e6e8eb;
  display: flex;
  gap: 5px;
  align-items: center;
  flex-wrap: wrap;
  background: #fff;
}
.bp-tag-label {
  font-size: 11px;
  color: #6b7280;
  font-weight: 600;
  margin-right: 2px;
}
.bp-tag-chip {
  background: #fff;
  color: #6b7280;
  border: 1px solid #e6e8eb;
  border-radius: 11px;
  padding: 2px 8px;
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.bp-tag-chip:hover { background: #f4f5f7; }
.bp-tag-chip.active {
  background: rgba(59,130,246,0.12);
  color: #1d4ed8;
  border-color: #93c5fd;
  font-weight: 600;
}
.bp-tag-status {
  margin-left: auto;
  font-size: 10.5px;
  color: #10b981;
  font-weight: 600;
}

.bp-body { flex: 1; overflow-y: auto; padding: 12px 18px; }
.bp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  color: #9ca3af;
  gap: 10px;
  font-size: 28px;
}
.bp-empty-text { font-size: 12.5px; }

.bp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bp-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e6e8eb;
  border-radius: 8px;
  background: #fff;
  transition: all 0.12s;
}
.bp-item:hover { border-color: #3b82f6; box-shadow: 0 2px 8px rgba(59,130,246,0.1); }
.bp-item-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(59,130,246,0.12);
  color: #1d4ed8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}
.bp-item.kind-friend .bp-item-icon {
  background: rgba(16,185,129,0.12);
  color: #047857;
}
.bp-item-info { flex: 1; min-width: 0; }
.bp-item-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2328;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-item-meta {
  font-size: 11px;
  color: #6b7280;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.bp-vis { font-size: 11px; }
.bp-vis.public { color: #10b981; }
.bp-vis.private { color: #f59e0b; }
.bp-tag-mini {
  background: rgba(59,130,246,0.1);
  color: #1d4ed8;
  font-size: 9.5px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}
.bp-item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.bp-btn-small {
  padding: 5px 10px;
  border: 1px solid #d4d7dc;
  border-radius: 6px;
  background: #fff;
  color: #1f2328;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.bp-btn-small:hover { background: #f4f5f7; }
.bp-btn-small.bp-btn-primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}
.bp-btn-small.bp-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.bp-btn-small:disabled { opacity: 0.5; cursor: wait; }

.bp-footer {
  padding: 10px 18px;
  border-top: 1px solid #e6e8eb;
  font-size: 11px;
  color: #9ca3af;
  text-align: center;
}
.bp-footer kbd {
  font-family: ui-monospace, monospace; font-size: 10px;
  background: #f1f2f4; border: 1px solid #d4d7dc; border-radius: 4px;
  padding: 0 4px; color: #41454d;
}

/* Icon Lucide chrome — căn giữa với text, spin cho loading (2026-06-08). */
.bp-btn-small { display: inline-flex; align-items: center; gap: 4px; }
.bp-icon, .bp-close, .bp-tab, .bp-search-icon, .bp-tag-label, .bp-tag-status,
.bp-vis, .bp-meta-seg { display: inline-flex; align-items: center; gap: 3px; }
.bp-tab { gap: 5px; }
.bp-header svg, .bp-close svg, .bp-tab svg, .bp-search-icon svg, .bp-tag-label svg,
.bp-tag-status svg, .bp-vis svg, .bp-meta-seg svg, .bp-btn-small svg,
.bp-empty svg { display: block; }
.bp-spin { animation: bp-spin 0.8s linear infinite; }
@keyframes bp-spin { to { transform: rotate(360deg); } }
</style>
