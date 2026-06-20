<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  MediaTabPanel — cột 4 tab "Media" (gộp Picker Media + Automation, anh chốt 2026-06-12).
  4 sub-tab: Ảnh / Video / Tệp / Khối. Ảnh/Video/Tệp = kho media (tái dùng logic
  MediaPickerPopover: listMedia + sendMediaToConversation + sendAlbumToConversation).
  Khối = nhúng AutomationBlocksPanel (kịch bản nhiều tin, có xem trước). Mọi thứ gửi
  THẲNG vào conversation đang mở. Atlas v2 (token --at-*, action #1786be) + Lucide icon,
  KHÔNG emoji. Mockup duyệt: docs/mockup-media-tab-merge-atlas-v2-20260612.html.
-->
<template>
  <div class="mtp airtable-scope">
    <!-- ── Sub-tabs Ảnh / Video / Tệp / Khối (kiểu .at-roletab) ── -->
    <div class="mtp-subtabs" role="tablist">
      <button
        v-for="t in SUBTABS"
        :key="t.key"
        class="mtp-st"
        :class="{ active: subTab === t.key }"
        role="tab"
        :aria-selected="subTab === t.key"
        @click="setSubTab(t.key)"
      >
        <component :is="t.icon" :size="14" :stroke-width="1.9" />
        {{ t.label }}
        <span v-if="t.key !== 'block' && counts[t.key] != null" class="mtp-cnt">{{ counts[t.key] }}</span>
      </button>
    </div>

    <!-- ════════ KHỐI: nhúng AutomationBlocksPanel sẵn có ════════ -->
    <AutomationBlocksPanel
      v-if="subTab === 'block'"
      :conversation-id="conversationId"
      :contact="contact"
      :owner-nick-id="ownerNickId"
      :nick-name="nickName"
    />

    <!-- ════════ ẢNH / VIDEO / TỆP: kho media ════════ -->
    <template v-else>
      <!-- Hàng 1: Tìm (hẹp) + Sắp xếp (xoay vòng) + Lọc — vừa 1 hàng, không tràn -->
      <div class="mtp-search">
        <span class="mtp-inp">
          <SearchIcon :size="13" :stroke-width="1.9" />
          <input v-model="search" :placeholder="searchPlaceholder" @input="debouncedReload" />
        </span>
        <!-- Nút Sắp xếp: bấm xoay vòng Gửi nhiều → Gần nhất → Mới upload (anh chốt 2026-06-12) -->
        <button class="mtp-sortbtn" :title="`Sắp xếp: ${sortLabel} (bấm để đổi)`" @click="cycleSort">
          <ArrowUpDownIcon :size="12" :stroke-width="1.9" />{{ sortLabel }}
        </button>
        <button class="mtp-filtbtn" :class="{ on: showFilter }" title="Lọc thời gian + cỡ" @click="showFilter = !showFilter">
          <FilterIcon :size="13" :stroke-width="1.9" />
        </button>
      </div>

      <!-- Hàng 2: Quyền (Tất cả | Công khai | Riêng tư) — 1 dòng riêng -->
      <div class="mtp-row2">
        <span class="mtp-rlabel">Quyền</span>
        <div class="mtp-seg">
          <button :class="{ on: visFilter === '' }" @click="setVis('')">Tất cả</button>
          <button :class="{ on: visFilter === 'public' }" @click="setVis('public')">Công khai</button>
          <button :class="{ on: visFilter === 'private' }" @click="setVis('private')">Riêng tư</button>
        </div>
      </div>

      <!-- Hàng 3: Dự án (thư mục) | Tag — 1 dòng cuộn ngang -->
      <div v-if="folders.length || availableTags.length" class="mtp-row3">
        <template v-if="folders.length">
          <span class="mtp-rlabel">Dự án</span>
          <button class="mtp-chip" :class="{ on: folderId === '' }" @click="setFolder('')">Tất cả</button>
          <button
            v-for="f in folders"
            :key="f.id"
            class="mtp-chip"
            :class="{ on: folderId === f.id }"
            @click="setFolder(f.id)"
          >{{ f.name }}</button>
        </template>
        <template v-if="availableTags.length">
          <span class="mtp-rdiv" aria-hidden="true"></span>
          <span class="mtp-rlabel">Tag</span>
          <button
            v-for="tag in availableTags"
            :key="tag"
            class="mtp-chip mtp-chip--tag"
            :class="{ on: tagFilter === tag }"
            @click="toggleTagFilter(tag)"
          >#{{ tag }}</button>
        </template>
      </div>

      <!-- Lọc sâu (ẩn/hiện): chỉ Thời gian + Cỡ (Quyền + Dự án/Tag đã ra ngoài) -->
      <div v-if="showFilter" class="mtp-filter">
        <div class="mtp-frow">
          <select v-model="sinceBy" class="mtp-sel" @change="applyFilters">
            <option value="">Mọi lúc</option>
            <option value="7d">7 ngày</option>
            <option value="30d">30 ngày</option>
            <option value="90d">90 ngày</option>
          </select>
          <select v-model="sizeBy" class="mtp-sel" @change="applyFilters">
            <option value="">Mọi cỡ</option>
            <option value="small">&lt; 1MB</option>
            <option value="medium">1–10MB</option>
            <option value="large">&gt; 10MB</option>
          </select>
        </div>
      </div>

      <!-- Thanh chọn album — CHỈ khi đang xem ẢNH (Zalo album = ảnh) -->
      <div v-if="subTab === 'image'" class="mtp-album">
        <label class="mtp-toggle">
          <input type="checkbox" :checked="multiMode" @change="toggleMultiMode" />
          Chọn nhiều ảnh (album)
        </label>
        <template v-if="multiMode">
          <span class="mtp-acount">{{ picked.size }}/12</span>
          <button class="mtp-send-album" :disabled="picked.size === 0 || sendingAlbum" @click="sendAlbum">
            <SendIcon :size="13" :stroke-width="1.9" />
            {{ sendingAlbum ? 'Đang gửi…' : `Gửi ${picked.size || ''} ảnh` }}
          </button>
        </template>
      </div>

      <!-- Body cuộn -->
      <div class="mtp-body">
        <div v-if="loading" class="mtp-empty">Đang tải…</div>
        <div v-else-if="items.length === 0" class="mtp-empty">
          Không có {{ kindLabel }} nào khớp. Tải lên ở trang <b>Kho ảnh</b> hoặc chuột phải tin nhắn → Lưu vào Media.
        </div>

        <!-- TỆP: list theo dòng (sale đọc rõ tên) -->
        <div v-else-if="subTab === 'file'" class="mtp-list">
          <button
            v-for="a in items"
            :key="a.id"
            class="mtp-frow-item"
            :disabled="sending === a.id"
            @click="openReview(a)"
          >
            <span class="mtp-ficon" :style="{ background: fileIcon(a.name).bg, color: fileIcon(a.name).fg }">{{ fileIcon(a.name).label }}</span>
            <span class="mtp-finfo">
              <span class="mtp-fname" :title="a.name">{{ a.name }}</span>
              <span class="mtp-fmeta">{{ fmtSize(a.sizeBytes) }}</span>
            </span>
            <span v-if="sending === a.id" class="mtp-fsending">Đang gửi…</span>
            <span v-else class="mtp-fsend"><SendIcon :size="13" :stroke-width="1.9" /></span>
          </button>
        </div>

        <!-- ẢNH/VIDEO: grid thumbnail -->
        <div v-else class="mtp-grid">
          <button
            v-for="a in items"
            :key="a.id"
            class="mtp-cell"
            :class="{ picked: picked.has(a.id) }"
            :disabled="sending === a.id || sendingAlbum"
            @click="onCellClick(a)"
          >
            <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
            <span v-else class="mtp-ph">
              <ImageIcon v-if="a.kind === 'image'" :size="20" :stroke-width="1.6" />
              <VideoIcon v-else :size="20" :stroke-width="1.6" />
            </span>
            <template v-if="a.kind === 'video'">
              <span class="mtp-vplay"><PlayIcon :size="12" fill="currentColor" :stroke-width="0" /></span>
              <span v-if="a.durationSec" class="mtp-vdur">{{ fmtDuration(a.durationSec) }}</span>
            </template>
            <span class="mtp-cname">{{ a.name }}</span>
            <span v-if="multiMode && picked.has(a.id)" class="mtp-pick">{{ pickIndex(a.id) }}</span>
            <span v-if="sending === a.id" class="mtp-sending">Đang gửi…</span>
          </button>
        </div>

        <!-- Phân trang (anh chốt 2026-06-16): nút chuyển trang, tránh load nhiều lag. -->
        <div v-if="!loading && total > 0" class="mtp-pager">
          <button class="mtp-pg" :disabled="page === 0" @click="goPage(-1)">‹ Trước</button>
          <span class="mtp-pgnum">{{ page + 1 }}/{{ totalPages }} · {{ total }}</span>
          <button class="mtp-pg" :disabled="page + 1 >= totalPages" @click="goPage(1)">Sau ›</button>
        </div>
      </div>
    </template>

    <!-- Bảng review 1 mục (popup): click ảnh/video/file → xem + gắn/tháo tag + Gửi (2026-06-15) -->
    <MediaReviewDialog
      v-if="reviewAsset"
      :asset="reviewAsset"
      :conversation-id="reviewConvId"
      @close="closeReview"
      @sent="onReviewSent"
      @tags-changed="onReviewTagsChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  listMediaPaged, listMediaFolders, sendAlbumToConversation,
  type MediaAssetItem, type ListMediaParams, type MediaFolder,
} from '@/api/media';
import type { Contact } from '@/composables/use-contacts';
import { useToast } from '@/composables/use-toast';
import AutomationBlocksPanel from '@ee/automation/chat-blocks/AutomationBlocksPanel.vue';
import MediaReviewDialog from '@/components/media/MediaReviewDialog.vue';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  FileText as FileTextIcon,
  Boxes as BoxesIcon,
  Search as SearchIcon,
  Filter as FilterIcon,
  Send as SendIcon,
  Play as PlayIcon,
  ArrowUpDown as ArrowUpDownIcon,
} from 'lucide-vue-next';

const props = defineProps<{
  conversationId: string;
  contact?: Contact | null;
  ownerNickId?: string | null;
  nickName?: string | null;
}>();

const toast = useToast();

type SubKind = 'image' | 'video' | 'file' | 'block';
const SUBTABS: { key: SubKind; label: string; icon: any }[] = [
  { key: 'image', label: 'Ảnh', icon: ImageIcon },
  { key: 'video', label: 'Video', icon: VideoIcon },
  { key: 'file', label: 'Tệp', icon: FileTextIcon },
  { key: 'block', label: 'Khối', icon: BoxesIcon },
];

const subTab = ref<SubKind>('image');
const items = ref<MediaAssetItem[]>([]);
const loading = ref(false);
const search = ref('');
const sending = ref<string | null>(null);

// Phân trang (anh chốt 2026-06-16): cột Media chat cũng có nút chuyển trang, tránh load lag.
const PAGE_SIZE = 40;
const page = ref(0);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

// ── Bảng review (Anh chốt 2026-06-15): click 1 ảnh/video/file → mở popup review ──
// (preview + thông số + gắn/tháo tag lưu-ngay + nút Gửi). Thay cách "gửi thẳng khi click".
const reviewAsset = ref<MediaAssetItem | null>(null);
// SNAPSHOT conversationId lúc MỞ review (code-review #1): nếu sale click khách khác ở cột 1
// khi dialog đang mở, props.conversationId đổi → tránh gửi nhầm khách MỚI. Dialog gửi theo
// đúng khách lúc bấm mở. Nếu khách đổi giữa chừng → đóng dialog (watch bên dưới).
const reviewConvId = ref<string>('');
function openReview(a: MediaAssetItem) { reviewAsset.value = a; reviewConvId.value = props.conversationId; }
function closeReview() { reviewAsset.value = null; }
function onReviewSent() {
  // Bump usageCount/lastUsedAt local cho khớp (code-review #4) — khỏi chờ reload.
  if (reviewAsset.value) {
    const it = items.value.find((x) => x.id === reviewAsset.value!.id);
    if (it) it.usageCount = (it.usageCount ?? 0) + 1;
  }
  reviewAsset.value = null;
}
// Đổi khách khi dialog đang mở → đóng dialog (an toàn, tránh gửi nhầm + thông số lệch khách).
watch(() => props.conversationId, () => { if (reviewAsset.value) closeReview(); });
// Tag sửa trong review → đồng bộ ngược vào list để chip lọc + lần mở sau khớp.
function onReviewTagsChanged(id: string, newTags: string[]) {
  const it = items.value.find((x) => x.id === id);
  if (it) it.tagIds = newTags;
  if (reviewAsset.value?.id === id) reviewAsset.value = { ...reviewAsset.value, tagIds: newTags };
}

// Đếm để hiện badge trên sub-tab (chỉ cập nhật cho kind đang xem; null = chưa biết).
const counts = ref<Record<string, number | null>>({ image: null, video: null, file: null });

const showFilter = ref(false);
const visFilter = ref<'' | 'public' | 'private'>('');
// Nút Sắp xếp xoay vòng (anh chốt 2026-06-12): Gửi nhiều → Gửi gần nhất → Mới upload.
// Mặc định 'most_used' (Gửi nhiều) — mục hay gửi cho khách luôn ở trên, ổn định, dễ lấy nhanh.
type SortMode = 'most_used' | 'recent' | 'newest';
const SORT_CYCLE: { mode: SortMode; label: string }[] = [
  { mode: 'most_used', label: 'Gửi nhiều' },
  { mode: 'recent', label: 'Gần nhất' },
  { mode: 'newest', label: 'Mới upload' },
];
const sortBy = ref<SortMode>('most_used');
const sortLabel = computed(() => SORT_CYCLE.find((s) => s.mode === sortBy.value)?.label ?? 'Gửi nhiều');
const sinceBy = ref<'' | '7d' | '30d' | '90d'>('');
const sizeBy = ref<'' | 'small' | 'medium' | 'large'>('');
const tagFilter = ref('');

// Thư mục (gom theo dự án) — load 1 lần, lọc theo kind đang xem.
const allFolders = ref<MediaFolder[]>([]);
const folderId = ref('');
const folders = computed(() => allFolders.value.filter((f) => f.kind === subTab.value));
// Tag dự án — gom từ tagIds của các mục đang hiện (chip lọc nhanh).
const availableTags = computed(() => {
  const set = new Set<string>();
  for (const a of items.value) for (const t of a.tagIds || []) set.add(t);
  return Array.from(set).sort().slice(0, 12);
});

// Album (chỉ ảnh).
const multiMode = ref(false);
const picked = ref<Set<string>>(new Set());
const sendingAlbum = ref(false);

const kindLabel = computed(() => ({ image: 'ảnh', video: 'video', file: 'tệp', block: 'khối' }[subTab.value]));
const searchPlaceholder = computed(() => ({ image: 'Tìm ảnh…', video: 'Tìm video…', file: 'Tìm tệp…', block: '' }[subTab.value]));

// Icon + màu theo định dạng tệp (sale nhận diện nhanh PDF/Excel/Word) — giữ y MediaPickerPopover.
function fileIcon(name: string): { label: string; bg: string; fg: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { label: 'PDF', bg: '#fdeceb', fg: '#c0392b' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', bg: '#e7f7ef', fg: '#1e7e45' };
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', bg: '#e4f1f8', fg: '#1a5cc0' };
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', bg: '#fdeee4', fg: '#c75b1e' };
  if (['zip', 'rar', '7z'].includes(ext)) return { label: 'ZIP', bg: '#eae6ff', fg: '#6b4fb0' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), bg: '#eef0f2', fg: '#41454d' };
}

function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  const MB = 1024 * 1024;
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() { if (timer) clearTimeout(timer); timer = setTimeout(applyFilters, 300); }

function setSubTab(k: SubKind) {
  if (subTab.value === k) return;
  subTab.value = k;
  // Đổi loại → reset thư mục + tag (thư mục/tag thuộc riêng từng loại).
  folderId.value = '';
  tagFilter.value = '';
  if (k !== 'image') { multiMode.value = false; picked.value = new Set(); } // album chỉ cho ảnh
  if (k !== 'block') applyFilters();
}
function setVis(v: '' | 'public' | 'private') { visFilter.value = v; applyFilters(); }

// Bấm nút Sắp xếp → nhảy sang bộ kế tiếp, hết thì quay về đầu.
function cycleSort() {
  const i = SORT_CYCLE.findIndex((s) => s.mode === sortBy.value);
  sortBy.value = SORT_CYCLE[(i + 1) % SORT_CYCLE.length].mode;
  applyFilters();
}
function setFolder(id: string) { folderId.value = id; applyFilters(); }
function toggleTagFilter(tag: string) {
  tagFilter.value = tagFilter.value === tag ? '' : tag;
  applyFilters();
}

function toggleMultiMode() {
  multiMode.value = !multiMode.value;
  if (!multiMode.value) picked.value = new Set();
}

function sizeRange(): { sizeMin?: number; sizeMax?: number } {
  const MB = 1024 * 1024;
  if (sizeBy.value === 'small') return { sizeMax: MB };
  if (sizeBy.value === 'medium') return { sizeMin: MB, sizeMax: 10 * MB };
  if (sizeBy.value === 'large') return { sizeMin: 10 * MB };
  return {};
}

// Đổi bộ lọc → về trang 1; chuyển trang giữ nguyên lọc.
function applyFilters() { page.value = 0; reload(); }
function goPage(delta: number) {
  const next = page.value + delta;
  if (next < 0 || next >= totalPages.value) return;
  page.value = next;
  reload();
}

async function reload() {
  if (subTab.value === 'block') return;
  loading.value = true;
  try {
    const params: ListMediaParams = {
      kind: subTab.value,
      q: search.value || undefined,
      visibility: visFilter.value || undefined,
      tag: tagFilter.value || undefined,
      folderId: folderId.value || undefined,
      since: sinceBy.value || undefined,
      sort: sortBy.value,
      limit: PAGE_SIZE,
      skip: page.value * PAGE_SIZE,
      ...sizeRange(),
    };
    const res = await listMediaPaged(params);
    items.value = res.items;
    total.value = res.total;
    counts.value[subTab.value] = res.total; // badge tab = TỔNG (không phải số/trang)
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được kho');
  } finally {
    loading.value = false;
  }
}

function onCellClick(a: MediaAssetItem) {
  if (multiMode.value && a.kind === 'image') { togglePick(a); return; }
  openReview(a); // mở bảng review (xem + tag + gửi) thay vì gửi thẳng
}
function togglePick(a: MediaAssetItem) {
  const next = new Set(picked.value);
  if (next.has(a.id)) {
    next.delete(a.id);
  } else {
    if (next.size >= 12) { toast.warning('Tối đa 12 ảnh/lần'); return; }
    next.add(a.id);
  }
  picked.value = next;
}
function pickIndex(id: string): string {
  const idx = [...picked.value].indexOf(id);
  return idx >= 0 ? String(idx + 1) : '';
}

// (Gửi đơn 1 mục giờ qua MediaReviewDialog — xem openReview. Album vẫn gửi qua sendAlbum.)

async function sendAlbum() {
  if (sendingAlbum.value || picked.value.size === 0) return;
  sendingAlbum.value = true;
  try {
    const ids = [...picked.value];
    const res = await sendAlbumToConversation(ids, props.conversationId);
    toast.success(`Đã gửi album ${res.sent} ảnh`);
    picked.value = new Set();
    multiMode.value = false;
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi album thất bại');
  } finally {
    sendingAlbum.value = false;
  }
}

onMounted(async () => {
  // Load thư mục 1 lần (để dựng chip gom theo dự án); lỗi thì bỏ qua, không chặn kho.
  listMediaFolders().then((f) => { allFolders.value = f; }).catch(() => { allFolders.value = []; });
  await reload();
});
</script>

<style scoped>
.mtp {
  display: flex; flex-direction: column; min-height: 0; height: 100%;
  --at-action: #1786be; --at-action-soft: #e4f1f8; --at-ink: #141a24;
  --at-body: #475066; --at-hint: #8b93a7; --at-hairline: #e7eaf0;
  --at-canvas: #fff; --at-surface-soft: #f1f4f9; --mono: "Roboto Mono", monospace;
}

/* sub-tabs (kiểu .at-roletab) */
.mtp-subtabs { display: flex; padding: 0 8px; border-bottom: 1px solid var(--at-hairline); flex-shrink: 0; }
.mtp-st {
  flex: 1; border: none; background: transparent; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 600; color: var(--at-body); padding: 9px 4px 8px;
  border-bottom: 2.5px solid transparent; display: inline-flex; align-items: center;
  justify-content: center; gap: 4px;
}
.mtp-st:hover { color: var(--at-ink); }
.mtp-st.active { color: var(--at-action); border-bottom-color: var(--at-action); }
.mtp-cnt {
  font-size: 10px; font-weight: 700; background: var(--at-surface-soft); color: var(--at-body);
  border-radius: 9999px; padding: 0 6px; font-family: var(--mono);
}
.mtp-st.active .mtp-cnt { background: var(--at-action-soft); color: var(--at-action); }

/* Hàng 1: Tìm (hẹp) + Sắp xếp + Lọc — không tràn cột 350px */
.mtp-search { display: flex; gap: 5px; align-items: center; padding: 9px 12px 7px; flex-shrink: 0; }
.mtp-inp {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 5px;
  border: 1px solid var(--at-hairline); border-radius: 8px; padding: 5px 9px; color: var(--at-hint);
}
.mtp-inp input { border: none; outline: none; font: inherit; font-size: 12px; flex: 1; min-width: 0; color: var(--at-ink); background: transparent; }
/* Nút Sắp xếp: gọn, không xuống dòng, nhãn ngắn (Gửi nhiều/Gần nhất/Mới upload) */
.mtp-sortbtn {
  flex-shrink: 0; border: 1px solid var(--at-hairline); background: #fff; border-radius: 8px;
  padding: 6px 8px; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--at-body);
  white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; font-family: inherit;
}
.mtp-sortbtn:hover { border-color: var(--at-action); color: var(--at-action); }
/* Nút Lọc: chỉ icon (vuông), tiết kiệm chỗ */
.mtp-filtbtn {
  flex-shrink: 0; width: 30px; height: 29px; border: 1px solid var(--at-hairline); background: #fff;
  border-radius: 8px; cursor: pointer; color: var(--at-body); display: inline-flex;
  align-items: center; justify-content: center; font-family: inherit;
}
.mtp-filtbtn:hover { border-color: var(--at-action); color: var(--at-action); }
.mtp-filtbtn.on { background: var(--at-action); border-color: var(--at-action); color: #fff; }

/* Hàng 2 (Quyền) + Hàng 3 (Dự án | Tag) — luôn hiện, mỗi nhóm 1 dòng cuộn ngang */
.mtp-row2, .mtp-row3 {
  display: flex; gap: 5px; align-items: center; padding: 0 12px 7px; flex-shrink: 0;
  overflow-x: auto; scrollbar-width: none;
}
.mtp-row2::-webkit-scrollbar, .mtp-row3::-webkit-scrollbar { display: none; }
.mtp-rlabel { flex-shrink: 0; font-size: 10.5px; color: var(--at-hint); font-weight: 700; }
.mtp-rdiv { flex-shrink: 0; width: 1px; height: 16px; background: var(--at-hairline); margin: 0 2px; }
.mtp-seg { flex-shrink: 0; display: inline-flex; border: 1px solid var(--at-hairline); border-radius: 9999px; overflow: hidden; }
.mtp-seg button {
  border: none; background: #fff; font-family: inherit; font-size: 11px; padding: 4px 11px;
  cursor: pointer; color: var(--at-body); border-right: 1px solid var(--at-hairline); white-space: nowrap;
}
.mtp-seg button:last-child { border-right: none; }
.mtp-seg button.on { background: var(--at-action-soft); color: var(--at-action); font-weight: 700; }
.mtp-chip {
  flex-shrink: 0; border: 1px solid var(--at-hairline); background: #fff; border-radius: 9999px;
  padding: 3px 10px; font-size: 11px; font-weight: 600; color: var(--at-body); cursor: pointer;
  white-space: nowrap; font-family: inherit;
}
.mtp-chip:hover { border-color: var(--at-action); color: var(--at-action); }
.mtp-chip.on { background: var(--at-action-soft); border-color: var(--at-action); color: var(--at-action); }
.mtp-chip--tag { color: var(--at-hint); }
.mtp-chip--tag.on { color: var(--at-action); }

/* Lọc sâu (Thời gian + Cỡ) */
.mtp-filter { padding: 0 12px 8px; flex-shrink: 0; display: flex; flex-direction: column; gap: 7px; }
.mtp-frow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.mtp-sel { border: 1px solid var(--at-hairline); border-radius: 6px; padding: 4px 8px; font-size: 11.5px; color: var(--at-ink); background: #fff; outline: none; font-family: inherit; }

/* album bar */
.mtp-album { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--at-ink);
  background: var(--at-surface-soft); border-radius: 6px; padding: 6px 9px; margin: 0 12px 8px; flex-shrink: 0; }
.mtp-toggle { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.mtp-toggle input { accent-color: var(--at-action); cursor: pointer; }
.mtp-acount { color: var(--at-action); font-weight: 700; font-family: var(--mono); }
.mtp-send-album {
  margin-left: auto; border: none; background: var(--at-action); color: #fff; border-radius: 6px;
  padding: 5px 11px; font-size: 11.5px; font-weight: 700; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px; font-family: inherit;
}
.mtp-send-album:disabled { opacity: .45; cursor: default; }

/* body */
.mtp-body { flex: 1; overflow-y: auto; padding: 2px 12px 12px; }
.mtp-empty { padding: 24px 12px; text-align: center; font-size: 12.5px; color: var(--at-hint); line-height: 1.5; }
.mtp-pager { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px 0 2px; }
.mtp-pg { border: 1px solid var(--at-line, #e3e6ea); background: #fff; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: var(--at-ink, #141a24); }
.mtp-pg:disabled { opacity: .4; cursor: default; }
.mtp-pgnum { font-size: 11.5px; color: var(--at-hint, #8b93a7); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* grid ảnh/video */
.mtp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.mtp-cell {
  position: relative; aspect-ratio: 1; border-radius: 9px; overflow: hidden; cursor: pointer;
  border: 1.5px solid transparent; background: #e4e9f0; padding: 0;
}
.mtp-cell:hover { border-color: var(--at-action); }
.mtp-cell:disabled { opacity: .6; }
.mtp-cell.picked { border-color: var(--at-action); box-shadow: 0 0 0 2px var(--at-action-soft); }
.mtp-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mtp-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #aab2c2; }
.mtp-cname {
  position: absolute; left: 0; right: 0; bottom: 0; font-size: 9px; color: #fff;
  background: linear-gradient(transparent, rgba(0,0,0,.72)); padding: 11px 5px 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mtp-vplay {
  position: absolute; inset: 0; margin: auto; width: 26px; height: 26px; border-radius: 9999px;
  background: rgba(0,0,0,.5); color: #fff; display: flex; align-items: center; justify-content: center; pointer-events: none;
}
.mtp-vdur {
  position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,.66); color: #fff; font-size: 9px;
  padding: 1px 5px; border-radius: 5px; font-family: var(--mono); pointer-events: none;
}
.mtp-pick {
  position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: 9999px;
  background: var(--at-action); color: #fff; font-size: 11px; font-weight: 800; display: flex;
  align-items: center; justify-content: center; font-family: var(--mono);
}
.mtp-sending { position: absolute; inset: 0; background: rgba(255,255,255,.8); display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--at-ink); }

/* list tệp */
.mtp-list { display: flex; flex-direction: column; }
.mtp-frow-item {
  display: grid; grid-template-columns: 34px 1fr auto; gap: 9px; align-items: center; width: 100%;
  padding: 7px 6px; border: none; background: none; border-bottom: 1px solid var(--at-hairline);
  cursor: pointer; text-align: left; border-radius: 6px;
}
.mtp-frow-item:last-child { border-bottom: none; }
.mtp-frow-item:hover { background: var(--at-surface-soft); }
.mtp-frow-item:disabled { opacity: .55; }
.mtp-ficon { width: 34px; height: 34px; flex-shrink: 0; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }
.mtp-finfo { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mtp-fname { font-size: 12.5px; color: var(--at-ink); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mtp-fmeta { font-size: 11px; color: var(--at-hint); }
.mtp-fsend { color: var(--at-action); display: inline-flex; align-items: center; }
.mtp-fsending { font-size: 11px; color: var(--at-hint); }
</style>
