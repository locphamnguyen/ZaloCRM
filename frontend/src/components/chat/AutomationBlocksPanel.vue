<!--
  AutomationBlocksPanel — cột 4 tab Automation (2026-06-07).
  Danh sách Khối Marketing (send_message) gọn 1 cột (~280–350px) để sale chọn → Xem trước
  (BlockPreviewDialog) → Gửi CẢ Khối thẳng cho KH của hội thoại đang mở.
  Backend dispatch đủ thành phần + giữ format + render {gender}/{name}/{sale} + delay an toàn;
  tin hiện live ở cột 3 qua socket. Anh chốt: luôn gửi cả khối, không tách thành phần.
-->
<template>
  <div class="abp">
    <!-- 2026-06-13: CHÉP 100% layout hàng công cụ của 3 tab Ảnh/Video/Tệp (MediaTabPanel):
         Hàng 1 Tìm + Sắp xếp (xoay vòng) + Lọc · Hàng 2 Quyền · Hàng 3 Tag (= Dự án/Tag). -->
    <!-- Hàng 1: Tìm + Sắp xếp + Lọc -->
    <div class="mtp-search">
      <span class="mtp-inp">
        <SearchIcon :size="13" :stroke-width="1.9" />
        <input v-model="searchQuery" placeholder="Tìm Khối…" />
      </span>
      <button class="mtp-sortbtn" :title="`Sắp xếp: ${sortLabel} (bấm để đổi)`" @click="cycleSort">
        <ArrowUpDownIcon :size="12" :stroke-width="1.9" />{{ sortLabel }}
      </button>
      <button class="mtp-filtbtn" :class="{ on: showFilter }" title="Lọc theo tag" @click="showFilter = !showFilter">
        <FilterIcon :size="13" :stroke-width="1.9" />
      </button>
    </div>

    <!-- Hàng 2: Quyền (Tất cả | Công khai | Riêng tư) -->
    <div class="mtp-row2">
      <span class="mtp-rlabel">Quyền</span>
      <div class="mtp-seg">
        <button :class="{ on: visFilter === '' }" @click="visFilter = ''">Tất cả</button>
        <button :class="{ on: visFilter === 'public' }" @click="visFilter = 'public'">Công khai</button>
        <button :class="{ on: visFilter === 'private' }" @click="visFilter = 'private'">Riêng tư</button>
      </div>
    </div>

    <!-- Hàng 3: Tag dự án -->
    <div v-if="availableTags.length" class="mtp-row3">
      <span class="mtp-rlabel">Tag</span>
      <button class="mtp-chip" :class="{ on: selectedTags.length === 0 }" @click="selectedTags = []">Tất cả</button>
      <button
        v-for="tag in availableTags"
        :key="tag"
        class="mtp-chip mtp-chip--tag"
        :class="{ on: selectedTags.includes(tag) }"
        @click="toggleTag(tag)"
      >#{{ tag }}</button>
    </div>

    <!-- Lọc sâu (ẩn/hiện) — Khối: lọc theo tag (giống Tệp mở panel Thời gian/Cỡ) -->
    <div v-if="showFilter" class="mtp-filter">
      <div class="mtp-frow">
        <span class="mtp-rlabel">Tag</span>
        <button
          v-for="tag in availableTags"
          :key="tag"
          class="mtp-chip mtp-chip--tag"
          :class="{ on: selectedTags.includes(tag) }"
          @click="toggleTag(tag)"
        >#{{ tag }}</button>
        <span v-if="!availableTags.length" class="mtp-rlabel">Chưa có tag</span>
      </div>
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
import {
  Search as SearchIcon,
  ArrowUpDown as ArrowUpDownIcon,
  Filter as FilterIcon,
} from 'lucide-vue-next';

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
const sendingId = ref<string | null>(null);
const previewBlock = ref<Block | null>(null);
let loaded = false;

// 2026-06-13: đồng bộ 3 tab Ảnh/Video/Tệp — Sắp xếp xoay vòng + Lọc + Quyền.
const showFilter = ref(false);
const visFilter = ref<'' | 'public' | 'private'>('');
type SortKey = 'most_used' | 'recent' | 'newest';
const sortKey = ref<SortKey>('most_used');
const SORT_LABELS: Record<SortKey, string> = {
  most_used: 'Gửi nhiều',
  recent: 'Gần nhất',
  newest: 'Mới tạo',
};
const sortLabel = computed(() => SORT_LABELS[sortKey.value]);
function cycleSort() {
  sortKey.value =
    sortKey.value === 'most_used' ? 'recent' : sortKey.value === 'recent' ? 'newest' : 'most_used';
}

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

/** Khối công khai = chia sẻ tổ chức hoặc nằm thư mục công khai; còn lại = riêng tư (của chủ nick). */
function isPublic(b: Block): boolean {
  return b.isShared === true || b.folder?.visibility === 'public';
}

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let list = allBlocks.value.filter((b) => {
    // Quyền (Tất cả / Công khai / Riêng tư)
    if (visFilter.value === 'public' && !isPublic(b)) return false;
    if (visFilter.value === 'private' && isPublic(b)) return false;
    // Tag
    if (selectedTags.value.length > 0) {
      if (!(b.tagIds || []).some((t) => selectedTags.value.includes(t))) return false;
    }
    // Tìm theo tên + nội dung
    if (!q) return true;
    if (b.name.toLowerCase().includes(q)) return true;
    return JSON.stringify(b.content).slice(0, 500).toLowerCase().includes(q);
  });

  // Sắp xếp theo nút xoay vòng (giống 3 tab Ảnh/Video/Tệp).
  const ts = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  list = [...list].sort((a, b) => {
    if (sortKey.value === 'most_used') {
      const am = a.manualSendCount || 0;
      const bm = b.manualSendCount || 0;
      if (bm !== am) return bm - am; // gửi nhiều lên trước
      return ts(b.lastManualSentAt) - ts(a.lastManualSentAt);
    }
    if (sortKey.value === 'recent') {
      return ts(b.lastManualSentAt) - ts(a.lastManualSentAt); // gửi gần nhất lên trước
    }
    return ts(b.createdAt) - ts(a.createdAt); // mới tạo lên trước
  });

  // Ưu tiên Khối của chính nick đang mở lên đầu (giữ hành vi cũ).
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
    // 2026-06-13: BE gửi NỀN, trả {accepted} ngay (tránh timeout) → báo "đang gửi", tin hiện dần socket.
    if ((res as any).accepted) {
      toast.success(`Đang gửi Khối (${res.totalMessages ?? ''} tin) cho KH — tin hiện dần…`);
    } else if (res.partial) {
      toast.warning(`Đã gửi ${res.sentCount}/${res.totalMessages} tin — ${res.errors?.length ?? 0} thành phần lỗi`);
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

/* 2026-06-13: CHÉP 100% layout hàng công cụ 3 tab Ảnh/Video/Tệp (MediaTabPanel .mtp-*).
   Token --at-* được cấp ở .airtable-scope toàn app; kèm fallback hex để chắc chắn đồng nhất. */
.mtp-search { display: flex; gap: 5px; align-items: center; padding: 9px 12px 7px; flex-shrink: 0; }
.mtp-inp {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 5px;
  border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 8px; padding: 5px 9px;
  color: var(--at-hint, #8b93a7);
}
.mtp-inp input { border: none; outline: none; font: inherit; font-size: 12px; flex: 1; min-width: 0; color: var(--at-ink, #141a24); background: transparent; }
/* Nút Sắp xếp: gọn, không xuống dòng (Gửi nhiều/Gần nhất/Mới tạo) */
.mtp-sortbtn {
  flex-shrink: 0; border: 1px solid var(--at-hairline, #e7eaf0); background: #fff; border-radius: 8px;
  padding: 6px 8px; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--at-body, #374151);
  white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; font-family: inherit;
}
.mtp-sortbtn:hover { border-color: var(--at-action, #1786be); color: var(--at-action, #1786be); }
/* Nút Lọc: chỉ icon (vuông) */
.mtp-filtbtn {
  flex-shrink: 0; width: 30px; height: 29px; border: 1px solid var(--at-hairline, #e7eaf0); background: #fff;
  border-radius: 8px; cursor: pointer; color: var(--at-body, #374151); display: inline-flex;
  align-items: center; justify-content: center; font-family: inherit;
}
.mtp-filtbtn:hover { border-color: var(--at-action, #1786be); color: var(--at-action, #1786be); }
.mtp-filtbtn.on { background: var(--at-action, #1786be); border-color: var(--at-action, #1786be); color: #fff; }

/* Hàng 2 (Quyền) + Hàng 3 (Tag) — mỗi nhóm 1 dòng cuộn ngang */
.mtp-row2, .mtp-row3 {
  display: flex; gap: 5px; align-items: center; padding: 0 12px 7px; flex-shrink: 0;
  overflow-x: auto; scrollbar-width: none;
}
.mtp-row2::-webkit-scrollbar, .mtp-row3::-webkit-scrollbar { display: none; }
.mtp-rlabel { flex-shrink: 0; font-size: 10.5px; color: var(--at-hint, #8b93a7); font-weight: 700; }
.mtp-seg { flex-shrink: 0; display: inline-flex; border: 1px solid var(--at-hairline, #e7eaf0); border-radius: 9999px; overflow: hidden; }
.mtp-seg button {
  border: none; background: #fff; font-family: inherit; font-size: 11px; padding: 4px 11px;
  cursor: pointer; color: var(--at-body, #374151); border-right: 1px solid var(--at-hairline, #e7eaf0); white-space: nowrap;
}
.mtp-seg button:last-child { border-right: none; }
.mtp-seg button.on { background: var(--at-action-soft, rgba(23,134,190,0.1)); color: var(--at-action, #1786be); font-weight: 700; }
.mtp-chip {
  flex-shrink: 0; border: 1px solid var(--at-hairline, #e7eaf0); background: #fff; border-radius: 9999px;
  padding: 3px 10px; font-size: 11px; font-weight: 600; color: var(--at-body, #374151); cursor: pointer;
  white-space: nowrap; font-family: inherit;
}
.mtp-chip:hover { border-color: var(--at-action, #1786be); color: var(--at-action, #1786be); }
.mtp-chip.on { background: var(--at-action-soft, rgba(23,134,190,0.1)); border-color: var(--at-action, #1786be); color: var(--at-action, #1786be); }
.mtp-chip--tag { color: var(--at-hint, #8b93a7); }
.mtp-chip--tag.on { color: var(--at-action, #1786be); }

/* Lọc sâu (Tag) */
.mtp-filter { padding: 0 12px 8px; flex-shrink: 0; display: flex; flex-direction: column; gap: 7px; }
.mtp-frow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

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
  color: #1786be;
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
.abp-item:hover { border-color: #1786be; box-shadow: 0 1px 6px rgba(23,134,190,0.1); }
.abp-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(23,134,190,0.12);
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
  background: rgba(23,134,190,0.1);
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
  background: #1786be;
  border-color: #1786be;
}
.abp-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.abp-btn:disabled { opacity: 0.55; cursor: wait; }
</style>
