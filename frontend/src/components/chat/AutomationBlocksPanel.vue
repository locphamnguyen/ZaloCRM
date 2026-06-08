<!--
  AutomationBlocksPanel — cột 4 tab Automation (2026-06-07).
  Danh sách Khối Marketing (send_message) gọn 1 cột (~280–350px) để sale chọn → Xem trước
  (BlockPreviewDialog) → Gửi CẢ Khối thẳng cho KH của hội thoại đang mở.
  Backend dispatch đủ thành phần + giữ format + render {gender}/{name}/{sale} + delay an toàn;
  tin hiện live ở cột 3 qua socket. Anh chốt: luôn gửi cả khối, không tách thành phần.
-->
<template>
  <div class="abp">
    <!-- Search -->
    <div class="abp-search">
      <span class="abp-search-icon">🔍</span>
      <input
        v-model="searchQuery"
        type="text"
        class="abp-search-input"
        placeholder="Tìm Khối theo tên, nội dung..."
      />
    </div>

    <!-- Tabs Gần đây / Tất cả -->
    <div class="abp-tabs">
      <button class="abp-tab" :class="{ active: activeTab === 'recent' }" @click="activeTab = 'recent'">
        ⚡ Gần đây <span class="abp-tab-badge">{{ recentBlocks.length }}</span>
      </button>
      <button class="abp-tab" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">
        📋 Tất cả <span class="abp-tab-badge">{{ allBlocks.length }}</span>
      </button>
    </div>

    <!-- Tag filter -->
    <div v-if="availableTags.length > 0" class="abp-tags">
      <button
        v-for="tag in availableTags.slice(0, 12)"
        :key="tag"
        class="abp-tag"
        :class="{ active: selectedTags.includes(tag) }"
        @click="toggleTag(tag)"
      >{{ tag }}</button>
    </div>

    <!-- Body -->
    <div class="abp-body">
      <div v-if="loading" class="abp-state">
        <v-progress-circular indeterminate size="24" color="primary" />
        <div class="abp-state-text">Đang tải Khối...</div>
      </div>
      <div v-else-if="loadError" class="abp-state">
        ⚠️ <div class="abp-state-text">{{ loadError }}</div>
      </div>
      <div v-else-if="filtered.length === 0" class="abp-state">
        📭
        <div class="abp-state-text">
          {{ allBlocks.length === 0 ? 'Chưa có Khối gửi tin nào.' : 'Không tìm thấy Khối phù hợp.' }}
        </div>
        <a class="abp-link" href="/marketing/blocks" target="_blank">→ Tạo Khối ở Marketing</a>
      </div>

      <div v-else class="abp-list">
        <article v-for="block in filtered" :key="block.id" class="abp-item">
          <div class="abp-item-icon">📨</div>
          <div class="abp-item-info" @click="onPreview(block)">
            <div class="abp-item-name">{{ block.name }}</div>
            <!-- Dòng phân loại: folder + tag (anh chốt 2026-06-07) -->
            <div v-if="block.folder || (block.tagIds && block.tagIds.length)" class="abp-item-meta abp-meta-class">
              <span v-if="block.folder" class="abp-folder">📁 {{ block.folder.name }}</span>
              <span v-for="tag in (block.tagIds || []).slice(0, 3)" :key="tag" class="abp-tag-mini">{{ tag }}</span>
              <span v-if="(block.tagIds?.length || 0) > 3" class="abp-tag-more">+{{ block.tagIds.length - 3 }}</span>
            </div>
            <!-- Dòng thống kê: số mẫu + lần gửi tay + lần gửi gần nhất -->
            <div class="abp-item-meta abp-meta-stat">
              <span v-if="variantCount(block) > 0" class="abp-variant">🔀 {{ variantCount(block) }} mẫu</span>
              <span v-if="(block.manualSendCount || 0) > 0" class="abp-manual">Số lần gửi: {{ block.manualSendCount }}</span>
              <span v-if="block.lastManualSentAt" class="abp-ago">{{ timeAgo(block.lastManualSentAt) }}</span>
            </div>
          </div>
          <div class="abp-item-actions">
            <button class="abp-btn" title="Xem trước" @click.stop="onPreview(block)">👁</button>
            <button
              class="abp-btn abp-btn-primary"
              title="Gửi cả Khối cho KH"
              :disabled="sendingId === block.id"
              @click.stop="onSendDirect(block)"
            >{{ sendingId === block.id ? '⏳' : '📤' }}</button>
          </div>
        </article>
      </div>
    </div>

    <!-- Preview dialog (tái dùng) -->
    <BlockPreviewDialog
      v-if="previewBlock"
      :visible="!!previewBlock"
      :block="previewBlock"
      :contact-name="contactName"
      :nick-name="nickName || 'Nick'"
      @send="onConfirmSend"
      @close="previewBlock = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { listBlocks, listRecentBlocks, sendBlockToConversation } from '@/api/automation/blocks';
import type { Block } from '@/api/automation/types';
import type { Contact } from '@/composables/use-contacts';
import { useToast } from '@/composables/use-toast';
import BlockPreviewDialog from '@/components/chat/BlockPreviewDialog.vue';

const props = defineProps<{
  conversationId: string | null;
  contact?: Contact | null;
  ownerNickId?: string | null;
  nickName?: string | null;
}>();

const toast = useToast();

const allBlocks = ref<Block[]>([]);
const recentBlocks = ref<Block[]>([]);
const loading = ref(false);
const loadError = ref('');
const searchQuery = ref('');
const selectedTags = ref<string[]>([]);
const activeTab = ref<'recent' | 'all'>('recent');
const sendingId = ref<string | null>(null);
const previewBlock = ref<Block | null>(null);
let loaded = false;

const contactName = computed(
  () => props.contact?.fullName || (props.contact as any)?.crmName || 'KH',
);

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
    activeTab.value = recentBlocks.value.length > 0 ? 'recent' : 'all';
    loaded = true;
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

// Lazy-load lần đầu panel mount (tab Automation active).
fetchAll();

const availableTags = computed(() => {
  const set = new Set<string>();
  for (const b of allBlocks.value) for (const t of b.tagIds || []) set.add(t);
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
    return JSON.stringify(b.content).slice(0, 500).toLowerCase().includes(q);
  });
  if (props.ownerNickId) {
    list = [...list].sort((a, b) => {
      const am = a.ownerNickId === props.ownerNickId ? 0 : 1;
      const bm = b.ownerNickId === props.ownerNickId ? 0 : 1;
      return am - bm;
    });
  }
  return list;
});

function toggleTag(tag: string) {
  const i = selectedTags.value.indexOf(tag);
  if (i >= 0) selectedTags.value.splice(i, 1);
  else selectedTags.value.push(tag);
}

function variantCount(block: Block): number {
  const c = block.content as any;
  if (Array.isArray(c?.greetingVariants)) return c.greetingVariants.length;
  if (Array.isArray(c?.textVariants)) return c.textVariants.length;
  if (Array.isArray(c?.components)) {
    let n = 0;
    for (const cmp of c.components) {
      if (cmp?.kind === 'text') n += (Array.isArray(cmp.variants) ? cmp.variants.length : 0) + 1;
    }
    return n;
  }
  return 0;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min}p`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}ng`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

function onPreview(block: Block) {
  previewBlock.value = block;
}

async function onConfirmSend(blockId: string) {
  previewBlock.value = null;
  await dispatchSend(blockId);
}

async function onSendDirect(block: Block) {
  await dispatchSend(block.id);
}

async function dispatchSend(blockId: string) {
  if (!props.conversationId) {
    toast.error('Chưa chọn hội thoại để gửi Khối');
    return;
  }
  sendingId.value = blockId;
  try {
    const res = await sendBlockToConversation(props.conversationId, blockId);
    if (res.partial) {
      toast.warning(`Đã gửi ${res.sentCount}/${res.totalMessages} tin — ${res.errors.length} thành phần lỗi`);
    } else {
      toast.success(`Đã gửi Khối (${res.sentCount} tin) cho KH`);
    }
    // Refresh "Gần đây" để Khối vừa gửi nổi lên (fire-and-forget).
    void listRecentBlocks()
      .then((r) => { recentBlocks.value = r.filter((b) => b.actionType === 'send_message'); })
      .catch(() => {});
  } catch (err: any) {
    const msg = err?.response?.data?.error
      || err?.response?.data?.detail
      || err?.message
      || 'Không gửi được Khối';
    toast.error(msg);
  } finally {
    sendingId.value = null;
  }
}

// Reload nếu chưa load xong khi conversationId đổi (panel có thể mount trước khi có conv).
watch(
  () => props.conversationId,
  async () => {
    if (!loaded && !loading.value) {
      await nextTick();
      await fetchAll();
    }
  },
);
</script>

<style scoped>
.abp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fff;
  font-size: 12px;
}

/* Search */
.abp-search {
  position: relative;
  padding: 8px 10px;
  border-bottom: 1px solid #eceef1;
  flex-shrink: 0;
}
.abp-search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: #9ca3af;
}
.abp-search-input {
  width: 100%;
  padding: 6px 9px 6px 26px;
  border: 1px solid #d4d7dc;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.abp-search-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }

/* Tabs */
.abp-tabs {
  display: flex;
  gap: 2px;
  padding: 0 10px;
  border-bottom: 1px solid #eceef1;
  background: #fafbfc;
  flex-shrink: 0;
}
.abp-tab {
  padding: 7px 10px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 11.5px;
  font-weight: 600;
  color: #6b7280;
  cursor: pointer;
  font-family: inherit;
}
.abp-tab:hover { color: #1f2328; }
.abp-tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }
.abp-tab-badge {
  font-size: 9.5px;
  background: rgba(59,130,246,0.15);
  color: #1d4ed8;
  padding: 0 5px;
  border-radius: 7px;
  margin-left: 3px;
  font-weight: 600;
}

/* Tags */
.abp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 7px 10px;
  border-bottom: 1px solid #eceef1;
  flex-shrink: 0;
}
.abp-tag {
  background: #fff;
  color: #6b7280;
  border: 1px solid #e6e8eb;
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.abp-tag:hover { background: #f4f5f7; }
.abp-tag.active {
  background: rgba(59,130,246,0.12);
  color: #1d4ed8;
  border-color: #93c5fd;
  font-weight: 600;
}

/* Body */
.abp-body { flex: 1; overflow-y: auto; min-height: 0; padding: 8px; }
.abp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 16px;
  color: #9ca3af;
  font-size: 22px;
  text-align: center;
}
.abp-state-text { font-size: 12px; }
.abp-link {
  font-size: 11.5px;
  color: #3b82f6;
  text-decoration: none;
  font-weight: 600;
}
.abp-link:hover { text-decoration: underline; }

.abp-list { display: flex; flex-direction: column; gap: 5px; }
.abp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid #e6e8eb;
  border-radius: 8px;
  background: #fff;
  transition: border-color .12s, box-shadow .12s;
}
.abp-item:hover { border-color: #3b82f6; box-shadow: 0 1px 6px rgba(59,130,246,0.1); }
.abp-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(59,130,246,0.12);
  color: #1d4ed8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.abp-item-info { flex: 1; min-width: 0; cursor: pointer; }
.abp-item-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #1f2328;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abp-item-meta {
  font-size: 10px;
  color: #6b7280;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.abp-meta-stat { margin-top: 3px; }
.abp-folder {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 96px;
  color: #4b5563; font-weight: 600;
}
.abp-tag-mini {
  background: rgba(59,130,246,0.1);
  color: #1d4ed8;
  font-size: 9px;
  padding: 0 5px;
  border-radius: 7px;
  font-weight: 500;
}
.abp-tag-more { font-size: 9px; color: #9ca3af; font-weight: 600; }
.abp-variant { color: #7c3aed; font-weight: 600; }
.abp-manual { color: #047857; font-weight: 600; }
.abp-ago { margin-left: auto; color: #9ca3af; }

.abp-item-actions { display: flex; gap: 4px; flex-shrink: 0; }
.abp-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #d4d7dc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.abp-btn:hover { background: #f4f5f7; }
.abp-btn-primary {
  background: #3b82f6;
  border-color: #3b82f6;
}
.abp-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.abp-btn:disabled { opacity: 0.55; cursor: wait; }
</style>
