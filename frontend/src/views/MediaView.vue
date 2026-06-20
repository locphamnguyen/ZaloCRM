<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="media-page">
    <!-- Top bar -->
    <header class="m-top">
      <h1 class="m-title">Kho phương tiện</h1>
      <div class="m-tools">
        <div class="m-search">
          <span class="i">🔍</span>
          <input v-model="search" placeholder="Tìm ảnh, tag dự án…" @input="debouncedReload" />
        </div>
        <button class="btn-dark" @click="triggerUpload">+ Tải lên</button>
        <button v-if="!trashMode" class="btn-multi" :class="{ on: multiMode }" :title="multiMode ? 'Tắt chọn nhiều' : 'Chọn nhiều ảnh'" @click="toggleMultiMode">
          <CheckSquareIcon :size="15" :stroke-width="1.9" /> Chọn nhiều
        </button>
        <button class="btn-trash" :class="{ on: trashMode }" :title="trashMode ? 'Đóng thùng rác' : 'Mở thùng rác'" @click="trashMode ? closeTrash() : openTrash()">
          <Trash2Icon :size="15" :stroke-width="1.9" /> Thùng rác
        </button>
        <input ref="fileInput" type="file" multiple accept="image/*,video/*,.pdf,.xlsx,.docx,.zip" hidden @change="onFilesPicked" />
      </div>
    </header>

    <!-- Tabs -->
    <nav class="m-tabs">
      <button v-for="t in tabs" :key="t.kind" class="tab" :class="{ on: activeKind === t.kind }" @click="setKind(t.kind)">{{ t.label }}</button>
    </nav>

    <!-- ════════ THÙNG RÁC (GĐ13a) ════════ -->
    <section v-if="trashMode" class="m-trash">
      <div class="trash-bar">
        <span class="trash-ttl"><Trash2Icon :size="16" :stroke-width="1.9" /> Thùng rác · {{ trashItems.length }} mục</span>
        <span class="trash-note">Đồ trong đây giữ 30 ngày rồi tự dọn. File gốc luôn được giữ — lịch sử chat đã gửi không bị ảnh hưởng.</span>
        <button class="trash-empty" :disabled="trashItems.length === 0" @click="onEmptyTrash">Dọn sạch</button>
        <button class="trash-close" title="Đóng" @click="closeTrash"><XIcon :size="15" :stroke-width="2" /></button>
      </div>

      <div v-if="trashLoading" class="m-empty"><div class="spin"></div> Đang tải…</div>
      <div v-else-if="trashItems.length === 0" class="m-empty">
        <div class="empty-ic"><Trash2Icon :size="40" :stroke-width="1.4" /></div>
        <div class="empty-ttl">Thùng rác trống</div>
        <div class="empty-sub">File anh xóa khỏi kho sẽ nằm đây 30 ngày, khôi phục lại được trước khi tự dọn.</div>
      </div>

      <div v-else class="m-grid">
        <div v-for="a in trashItems" :key="a.id" class="card trash-card">
          <div class="thumb">
            <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
            <span v-else class="ph"><component :is="kindIcon(a.kind)" :size="26" :stroke-width="1.6" /></span>
            <span class="purge-badge" :class="{ soon: a.daysUntilPurge <= 3 }">còn {{ a.daysUntilPurge }} ngày</span>
          </div>
          <div class="meta">
            <div class="fn" :title="a.name">{{ a.name }}</div>
            <div class="trash-acts">
              <button class="t-restore" @click="onRestore(a)"><RotateCcwIcon :size="13" :stroke-width="1.9" /> Khôi phục</button>
              <button class="t-perm" title="Xóa vĩnh viễn" @click="onPermanentDelete(a)"><Trash2Icon :size="13" :stroke-width="1.9" /></button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Filter row — LEVER 1: Quyền (Loại = tabs ở trên) + nút Lọc sâu -->
    <div v-if="!trashMode" class="m-filter">
      <span class="crumb">Tất cả<template v-if="activeFolder"> ▸ <b>{{ activeFolderName }}</b></template></span>
      <span v-for="tag in activeTags" :key="tag" class="chip coral" @click="toggleTag(tag)">#{{ tag }} <XIcon :size="11" :stroke-width="2.2" /></span>
      <button class="lvl2-btn" :class="{ on: showLever2 }" @click="showLever2 = !showLever2">⚙ Lọc sâu</button>
      <div class="vis-toggle">
        <span :class="{ on: visFilter === '' }" @click="setVis('')">Tất cả</span>
        <span :class="{ on: visFilter === 'public' }" @click="setVis('public')"><GlobeIcon :size="12" :stroke-width="2" /> Công khai</span>
        <span :class="{ on: visFilter === 'private' }" @click="setVis('private')"><LockIcon :size="12" :stroke-width="2" /> Riêng tư</span>
      </div>
    </div>

    <!-- LEVER 2: Sắp xếp / Thời gian / Size / Tag (ẩn/hiện) -->
    <div v-if="showLever2 && !trashMode" class="m-lever2">
      <select v-model="ownerFilter" class="lv2-sel" @change="applyFilters">
        <option value="">Mọi người sở hữu</option>
        <option v-for="u in uploaders" :key="u.id" :value="u.id">{{ u.name }} ({{ u.count }})</option>
      </select>
      <select v-model="sortBy" class="lv2-sel" @change="applyFilters">
        <option value="recent">Gần đây dùng</option>
        <option value="newest">Mới tải lên</option>
        <option value="most_used">Hay dùng nhất</option>
        <option value="name">Tên A→Z</option>
      </select>
      <select v-model="sinceBy" class="lv2-sel" @change="applyFilters">
        <option value="">Mọi lúc</option>
        <option value="7d">7 ngày</option>
        <option value="30d">30 ngày</option>
        <option value="90d">90 ngày</option>
      </select>
      <select v-model="sizeBy" class="lv2-sel" @change="applyFilters">
        <option value="">Mọi cỡ</option>
        <option value="small">&lt; 1MB</option>
        <option value="medium">1–10MB</option>
        <option value="large">&gt; 10MB</option>
      </select>
      <input v-model="tagInput" class="lv2-tag" placeholder="Lọc theo tag…" @keyup.enter="applyTagFilter" @input="debouncedReload" />
    </div>

    <div v-if="!trashMode" class="m-work">
      <!-- Folder tree -->
      <aside class="m-tree">
        <div class="tree-ttl">Thư mục
          <button class="addf" title="Tạo thư mục" @click="onCreateFolder">＋</button>
        </div>
        <div class="f" :class="{ on: !activeFolder }" @click="setFolder(null)"><FolderIcon :size="13" :stroke-width="1.9" /> Tất cả</div>
        <div v-for="f in folders" :key="f.id" class="f" :class="{ on: activeFolder === f.id }" @click="setFolder(f.id)">
          <FolderIcon :size="13" :stroke-width="1.9" /> {{ f.name }} <LockIcon v-if="f.visibility === 'private'" class="lk" :size="11" :stroke-width="2" />
        </div>
      </aside>

      <!-- Grid / empty / loading -->
      <div class="m-grid-wrap">
        <!-- GĐ12: thanh thao tác hàng loạt (hiện khi chọn nhiều + có ảnh chọn) -->
        <div v-if="multiMode && picked.size > 0" class="bulk-bar">
          <span class="bulk-cnt">Đã chọn {{ picked.size }}</span>
          <select v-model="bulkFolderId" class="bulk-sel" @change="onBulkFolder">
            <option value="__none">Gán thư mục…</option>
            <option value="">— Bỏ khỏi thư mục —</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
          <input v-model="bulkTag" class="bulk-tag" placeholder="Gán tag rồi Enter" @keyup.enter="onBulkTag" />
          <button class="bulk-trash" @click="onBulkTrash"><Trash2Icon :size="13" :stroke-width="1.9" /> Xóa {{ picked.size }} mục</button>
          <button class="bulk-clear" @click="clearPicked">Bỏ chọn</button>
        </div>

        <!-- Dải "Hay dùng nhất" đã GỠ 2026-06-15 (Anh chốt) — sẽ build module báo cáo riêng. -->

        <div v-if="loading" class="m-empty"><div class="spin"></div> Đang tải…</div>

        <div v-else-if="items.length === 0" class="m-empty">
          <div class="empty-ic"><ImageIcon :size="44" :stroke-width="1.4" /></div>
          <div class="empty-ttl">Kho ảnh của bạn đang trống</div>
          <div class="empty-sub">Tải ảnh hay dùng (bảng giá, mặt bằng, brochure) để gửi khách 1 chạm.</div>
          <button class="btn-dark" @click="triggerUpload">+ Tải ảnh đầu tiên</button>
          <div class="empty-hint"><LightbulbIcon :size="13" :stroke-width="1.9" /> Hoặc chuột phải ảnh trong chat → <b>Lưu vào Media</b></div>
        </div>

        <!-- TỆP: list detail theo dòng (sale phân biệt được tệp nào — anh chốt 2026-06-12) -->
        <div v-else-if="activeKind === 'file'" class="m-flist">
          <div v-for="a in items" :key="a.id" class="frow" :class="{ sel: selected?.id === a.id }" @click="select(a)">
            <span class="ficon" :style="{ background: fileIcon(a.name).bg, color: fileIcon(a.name).fg }">{{ fileIcon(a.name).label }}</span>
            <div class="finfo">
              <div class="fname" :title="a.name">{{ a.name }}</div>
              <div class="fmeta">
                {{ fmtSize(a.sizeBytes) }} · {{ a.visibility === 'public' ? 'Công khai' : 'Riêng tư' }} · đã dùng {{ a.usageCount }}
              </div>
              <div class="fmeta src-row" :title="sourceLabel(a)">
                <component :is="sourceIcon(a)" :size="11" :stroke-width="2" /> {{ sourceLabel(a) }}
              </div>
            </div>
          </div>
        </div>

        <!-- ẢNH/VIDEO: grid thẻ thumbnail -->
        <div v-else class="m-grid">
          <div v-for="a in items" :key="a.id" class="card" :class="{ sel: selected?.id === a.id, picked: picked.has(a.id) }" @click="onCardClick(a)">
            <div class="thumb">
              <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
              <span v-else class="ph"><component :is="kindIcon(a.kind)" :size="26" :stroke-width="1.6" /></span>
              <span v-if="a.kind === 'video'" class="play-ic">▶</span>
              <span v-if="a.kind === 'video' && a.durationSec" class="dur">{{ fmtDuration(a.durationSec) }}</span>
              <span v-if="a.visibility === 'private'" class="badge"><LockIcon :size="11" :stroke-width="2.2" /></span>
              <span v-if="multiMode" class="pick-tick" :class="{ on: picked.has(a.id) }">{{ picked.has(a.id) ? '✓' : '' }}</span>
            </div>
            <div class="meta">
              <div class="fn" :title="a.name">{{ a.name }}</div>
              <!-- NGUỒN: ảnh từ nick nào / sale nào (2026-06-15). Lucide icon, không emoji. -->
              <div class="src" :title="sourceLabel(a)">
                <component :is="sourceIcon(a)" :size="11" :stroke-width="2" />
                <span>{{ sourceLabel(a) }}</span>
              </div>
              <div class="stat" :class="a.visibility === 'public' ? 'pub' : 'lk'">
                <component :is="a.visibility === 'public' ? GlobeIcon : LockIcon" :size="11" :stroke-width="2" />
                {{ a.visibility === 'public' ? 'Công khai' : 'Riêng tư' }} · {{ a.usageCount }} lần
              </div>
            </div>
          </div>
        </div>

        <!-- Phân trang (anh chốt 2026-06-16): nút chuyển trang + tổng số mục, tránh load lag. -->
        <div v-if="!loading && total > 0" class="m-pager">
          <button class="pg-btn" :disabled="page === 0" @click="goPage(-1)">‹ Trước</button>
          <span class="pg-num">Trang {{ page + 1 }}/{{ totalPages }} · {{ total }} mục</span>
          <button class="pg-btn" :disabled="page + 1 >= totalPages" @click="goPage(1)">Sau ›</button>
        </div>
      </div>

      <!-- Detail panel (PA3) -->
      <MediaDetailPanel
        v-if="selected"
        :asset="selected"
        :folders="folders"
        @close="selected = null"
        @updated="onAssetUpdated"
        @archived="onAssetArchived"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  listMediaPaged, listMediaUploaders, uploadMedia, listMediaFolders, createMediaFolder,
  listTrash, restoreMedia, permanentDeleteMedia, emptyTrash,
  archiveMedia, bulkUpdateMedia,
  type MediaAssetItem, type MediaFolder, type TrashItem,
} from '@/api/media';
import { useToast } from '@/composables/use-toast';
import MediaDetailPanel from '@/components/media/MediaDetailPanel.vue';
import {
  Trash2 as Trash2Icon, RotateCcw as RotateCcwIcon, X as XIcon, CheckSquare as CheckSquareIcon,
  Globe as GlobeIcon, Lock as LockIcon, Smartphone as NickIcon, Upload as UploadIcon,
  Image as ImageIcon, FileText as FileIcon, Video as VideoIcon, Folder as FolderIcon,
  Lightbulb as LightbulbIcon,
} from 'lucide-vue-next';

// Icon placeholder theo loại media (thay emoji 🎬📄🖼 — Lucide, thống nhất 2026-06-15).
function kindIcon(kind: string) {
  return kind === 'video' ? VideoIcon : kind === 'file' ? FileIcon : ImageIcon;
}

const toast = useToast();

// Nhãn + icon NGUỒN ảnh (2026-06-15): "nick nào · sale nào" hoặc "Tải lên thủ công · sale".
function sourceLabel(a: MediaAssetItem): string {
  const sale = a.ownerName ? ` · ${a.ownerName}` : '';
  if (a.source === 'saved_from_chat' && a.sourceNickName) return `${a.sourceNickName}${sale}`;
  if (a.source === 'saved_from_chat') return `Lưu từ chat${sale}`;
  return `Tải lên thủ công${sale}`;
}
function sourceIcon(a: MediaAssetItem) {
  return a.source === 'saved_from_chat' && a.sourceNickName ? NickIcon : UploadIcon;
}

const tabs = [
  { kind: 'image', label: 'Ảnh' },
  { kind: 'album', label: 'Album' },
  { kind: 'file', label: 'Tệp' },
  { kind: 'video', label: 'Video' },
];
const activeKind = ref<'image' | 'album' | 'file' | 'video'>('image');
const items = ref<MediaAssetItem[]>([]);
const folders = ref<MediaFolder[]>([]);
const loading = ref(false);
const search = ref('');
const visFilter = ref<'' | 'public' | 'private'>('');
const activeFolder = ref<string | null>(null);
const activeTags = ref<string[]>([]);
const selected = ref<MediaAssetItem | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// LEVER 2 (lọc sâu — anh chốt 2026-06-12).
const showLever2 = ref(false);
const sortBy = ref<'recent' | 'newest' | 'most_used' | 'name'>('recent');
const sinceBy = ref<'' | '7d' | '30d' | '90d'>('');
const sizeBy = ref<'' | 'small' | 'medium' | 'large'>('');
const tagInput = ref('');

// Lọc theo người sở hữu ảnh + phân trang (anh chốt 2026-06-16: /media load nhiều ảnh lag,
// cần nút chuyển trang; thêm lọc theo người upload). Tái dùng BE skip/total/ownerUserId.
const ownerFilter = ref('');
const uploaders = ref<Array<{ id: string; name: string; count: number }>>([]);
const PAGE_SIZE = 40;
const page = ref(0);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

const activeFolderName = computed(() => folders.value.find((f) => f.id === activeFolder.value)?.name ?? '');

function sizeRange(): { sizeMin?: number; sizeMax?: number } {
  const MB = 1024 * 1024;
  if (sizeBy.value === 'small') return { sizeMax: MB };
  if (sizeBy.value === 'medium') return { sizeMin: MB, sizeMax: 10 * MB };
  if (sizeBy.value === 'large') return { sizeMin: 10 * MB };
  return {};
}
function applyTagFilter() {
  const t = tagInput.value.trim();
  if (t && !activeTags.value.includes(t)) activeTags.value = [...activeTags.value, t];
  tagInput.value = '';
  applyFilters();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 300);
}

// Đổi bộ lọc → luôn về trang 1 (tránh kẹt ở "trang 5" rỗng khi kết quả co lại).
function applyFilters() { page.value = 0; reload(); }
function goPage(delta: number) {
  const next = page.value + delta;
  if (next < 0 || next >= totalPages.value) return;
  page.value = next;
  reload();
}

async function reload() {
  loading.value = true;
  try {
    // Album tab dùng folders; còn lại list assets theo kind.
    const kind = activeKind.value === 'album' ? undefined : activeKind.value;
    const res = await listMediaPaged({
      kind,
      q: search.value || undefined,
      visibility: visFilter.value || undefined,
      folderId: activeFolder.value || undefined,
      tag: activeTags.value[0] || tagInput.value.trim() || undefined,
      ownerUserId: ownerFilter.value || undefined,
      // Lever 2.
      sort: sortBy.value,
      since: sinceBy.value || undefined,
      limit: PAGE_SIZE,
      skip: page.value * PAGE_SIZE,
      ...sizeRange(),
    });
    items.value = res.items;
    total.value = res.total;
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được kho');
  } finally {
    loading.value = false;
  }
}

// Danh sách người sở hữu ảnh (đổ vào dropdown lọc) — khớp kind + visibility đang xem.
async function loadUploaders() {
  try {
    uploaders.value = await listMediaUploaders({
      kind: activeKind.value === 'album' ? undefined : activeKind.value,
      visibility: visFilter.value || undefined,
    });
  } catch { /* ignore — dropdown rỗng vẫn dùng lọc khác */ }
}

async function loadFolders() {
  try { folders.value = await listMediaFolders(); } catch { /* ignore */ }
}

function setKind(k: any) { activeKind.value = k; selected.value = null; if (trashMode.value) loadTrash(); else { applyFilters(); loadUploaders(); } }
function setVis(v: any) { visFilter.value = v; applyFilters(); loadUploaders(); }
function setFolder(id: string | null) { activeFolder.value = id; applyFilters(); }
function toggleTag(tag: string) { activeTags.value = activeTags.value.filter((t) => t !== tag); applyFilters(); }
function select(a: MediaAssetItem) { selected.value = a; }

// ── GĐ12: Chọn nhiều + thao tác hàng loạt ───────────────────────────────────
const multiMode = ref(false);
const picked = ref<Set<string>>(new Set());
const bulkFolderId = ref('__none');
const bulkTag = ref('');

function toggleMultiMode() {
  multiMode.value = !multiMode.value;
  if (!multiMode.value) clearPicked();
  else selected.value = null; // tắt panel chi tiết khi vào chế độ chọn nhiều
}
function clearPicked() { picked.value = new Set(); }
function onCardClick(a: MediaAssetItem) {
  if (!multiMode.value) { select(a); return; }
  const next = new Set(picked.value);
  if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
  picked.value = next;
}
async function onBulkFolder() {
  const v = bulkFolderId.value;
  if (v === '__none' || picked.value.size === 0) return;
  try {
    const folderId = v === '' ? null : v;
    const res = await bulkUpdateMedia([...picked.value], { folderId });
    toast.success(`Đã gán thư mục cho ${res.updated} mục`);
    bulkFolderId.value = '__none';
    clearPicked(); reload();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Gán thư mục thất bại'); }
}
async function onBulkTag() {
  const t = bulkTag.value.trim();
  if (!t || picked.value.size === 0) return;
  try {
    const res = await bulkUpdateMedia([...picked.value], { addTags: [t] });
    toast.success(`Đã gán tag "${t}" cho ${res.updated} mục`);
    bulkTag.value = ''; reload();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Gán tag thất bại'); }
}
async function onBulkTrash() {
  const ids = [...picked.value];
  if (ids.length === 0) return;
  if (!window.confirm(`Chuyển ${ids.length} mục vào Thùng rác?\n(Khôi phục được trong 30 ngày. Lịch sử chat đã gửi không bị ảnh hưởng.)`)) return;
  try {
    // Tái dùng archiveMedia (DELETE /media/:id = vào thùng rác) — chạy tuần tự cho an toàn.
    let ok = 0;
    for (const id of ids) { try { await archiveMedia(id); ok++; } catch { /* skip lỗi lẻ */ } }
    toast.success(`Đã chuyển ${ok}/${ids.length} mục vào Thùng rác`);
    clearPicked(); reload();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Xóa hàng loạt thất bại'); }
}

// Định dạng thời lượng video: 95s → "1:35".
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Icon + màu theo định dạng tệp (sale nhận diện nhanh PDF/Excel/Word).
function fileIcon(name: string): { label: string; bg: string; fg: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { label: 'PDF', bg: '#fdecec', fg: '#c0392b' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', bg: '#e7f4ec', fg: '#1e7e45' };
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', bg: '#e8effb', fg: '#1a5cc0' };
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', bg: '#fdeee4', fg: '#c75b1e' };
  if (['zip', 'rar', '7z'].includes(ext)) return { label: 'ZIP', bg: '#f0eef9', fg: '#6b4fb0' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), bg: '#eef0f2', fg: '#41454d' };
}
function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  const MB = 1024 * 1024;
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function triggerUpload() { fileInput.value?.click(); }
async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  try {
    const res = await uploadMedia(files, { visibility: 'private', folderId: activeFolder.value ?? undefined });
    const dup = res.assets.filter((a) => a.deduped).length;
    toast.success(dup > 0 ? `Đã tải ${res.assets.length} tệp (${dup} đã có sẵn, không tốn thêm dung lượng)` : `Đã tải ${res.assets.length} tệp lên kho`);
    reload();
  } catch (err: any) {
    toast.warning(err?.response?.data?.error || 'Tải lên thất bại');
  } finally {
    input.value = '';
  }
}

async function onCreateFolder() {
  const name = window.prompt('Tên thư mục mới:');
  if (!name?.trim()) return;
  try {
    await createMediaFolder(name.trim(), 'private');
    toast.success('Đã tạo thư mục');
    loadFolders();
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tạo được thư mục');
  }
}

function onAssetUpdated(patch: Partial<MediaAssetItem>) {
  if (!selected.value) return;
  Object.assign(selected.value, patch);
  const it = items.value.find((x) => x.id === selected.value!.id);
  if (it) Object.assign(it, patch);
}
function onAssetArchived(id: string) {
  items.value = items.value.filter((x) => x.id !== id);
  selected.value = null;
  toast.success('Đã chuyển vào Thùng rác');
}

// ── GĐ13a: Thùng rác ────────────────────────────────────────────────────────
const trashMode = ref(false);
const trashItems = ref<TrashItem[]>([]);
const trashLoading = ref(false);

async function loadTrash() {
  trashLoading.value = true;
  try {
    const kind = activeKind.value === 'album' ? undefined : activeKind.value;
    const res = await listTrash({ kind });
    trashItems.value = res.items;
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được thùng rác');
  } finally {
    trashLoading.value = false;
  }
}
function openTrash() { trashMode.value = true; selected.value = null; loadTrash(); }
function closeTrash() { trashMode.value = false; reload(); }

async function onRestore(a: TrashItem) {
  try {
    await restoreMedia(a.id);
    trashItems.value = trashItems.value.filter((x) => x.id !== a.id);
    toast.success(`Đã khôi phục "${a.name}" về kho`);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Khôi phục thất bại');
  }
}
async function onPermanentDelete(a: TrashItem) {
  if (!window.confirm(`Xóa vĩnh viễn "${a.name}"? Sẽ KHÔNG khôi phục được nữa.\n(Lịch sử chat đã gửi không bị ảnh hưởng.)`)) return;
  try {
    await permanentDeleteMedia(a.id);
    trashItems.value = trashItems.value.filter((x) => x.id !== a.id);
    toast.success('Đã xóa vĩnh viễn khỏi kho');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Xóa vĩnh viễn thất bại');
  }
}
async function onEmptyTrash() {
  if (trashItems.value.length === 0) return;
  if (!window.confirm(`Dọn sạch Thùng rác (${trashItems.value.length} mục)? Sẽ KHÔNG khôi phục được.\n(Lịch sử chat đã gửi không bị ảnh hưởng.)`)) return;
  try {
    const res = await emptyTrash();
    toast.success(`Đã dọn ${res.deleted} mục${res.hasMore ? ' (còn nữa, bấm lại để dọn tiếp)' : ''}`);
    loadTrash();
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Dọn thùng rác thất bại');
  }
}

// Dải "Hay dùng nhất" (mediaStats) đã GỠ 2026-06-15 — build module báo cáo riêng sau.

onMounted(() => { reload(); loadFolders(); loadUploaders(); });
</script>

<style scoped>
.media-page {
  --ink:#181d26; --body:#333840; --muted:#41454d; --hairline:#dddddd;
  --canvas:#fff; --soft:#f8fafc; --strong:#e0e2e6; --coral:#aa2d00; --success:#006400;
  --r-sm:6px; --r-md:10px; --pill:9999px;
  /* Chiều cao CỐ ĐỊNH theo viewport (trừ topnav 48px) — v-main chỉ có min-height nên
     height:100% không phân giải → flex chain hỏng, cột 3 detail không cuộn được, accordion
     mở ra tràn khỏi màn (anh báo 2026-06-16). Cố định height → .p-body cuộn đúng. */
  display:flex; flex-direction:column; height:calc(100vh - var(--smax-topnav-h, 48px)); min-height:0; overflow:hidden;
  background:var(--canvas); color:var(--body); font-size:14px;
}
.m-top { display:flex; align-items:center; justify-content:space-between; padding:16px 24px 12px; border-bottom:1px solid var(--hairline); }
.m-title { font-size:20px; font-weight:400; color:var(--ink); margin:0; }
.m-tools { display:flex; gap:10px; align-items:center; }
.m-search { display:flex; align-items:center; gap:7px; border:1px solid var(--hairline); border-radius:var(--r-sm); padding:6px 12px; width:240px; }
.m-search input { border:none; outline:none; font-size:13px; width:100%; background:transparent; color:var(--body); }
.btn-dark { background:var(--ink); color:#fff; border:none; border-radius:var(--r-md); padding:8px 16px; font-size:13.5px; font-weight:500; cursor:pointer; }
.m-tabs { display:flex; gap:2px; padding:0 24px; border-bottom:1px solid var(--hairline); }
.tab { padding:11px 16px; font-size:14px; color:var(--muted); border:none; background:none; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab.on { color:var(--ink); font-weight:500; border-bottom-color:var(--ink); }
.m-filter { display:flex; align-items:center; gap:10px; padding:12px 24px; border-bottom:1px solid var(--hairline); flex-wrap:wrap; }
.crumb { color:var(--muted); font-size:13px; }
.crumb b { color:var(--ink); font-weight:500; }
.chip { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--hairline); border-radius:var(--pill); padding:4px 11px; font-size:12.5px; cursor:pointer; }
.chip.coral { background:#fbe9e2; border-color:#f0c4b3; color:var(--coral); }
.vis-toggle { margin-left:auto; display:inline-flex; border:1px solid var(--hairline); border-radius:var(--pill); overflow:hidden; font-size:12.5px; }
.vis-toggle span { padding:5px 13px; cursor:pointer; color:var(--muted); }
.vis-toggle span.on { background:var(--ink); color:#fff; }
.lvl2-btn { border:1px solid var(--hairline); background:var(--canvas); border-radius:var(--pill); padding:5px 12px; font-size:12.5px; cursor:pointer; color:var(--muted); }
.lvl2-btn.on { background:var(--ink); color:#fff; border-color:var(--ink); }
.m-lever2 { display:flex; gap:8px; align-items:center; padding:10px 24px; border-bottom:1px solid var(--hairline); flex-wrap:wrap; background:var(--soft); }
.lv2-sel { border:1px solid var(--hairline); border-radius:var(--r-sm,6px); padding:5px 10px; font-size:12.5px; color:var(--ink); background:var(--canvas); outline:none; }
.lv2-tag { border:1px solid var(--hairline); border-radius:var(--r-sm,6px); padding:5px 11px; font-size:12.5px; width:150px; outline:none; }
.thumb .play-ic { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:34px; height:34px; border-radius:9999px; background:rgba(0,0,0,.5); color:#fff; font-size:14px; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.thumb .dur { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,.7); color:#fff; border-radius:4px; padding:1px 6px; font-size:10.5px; font-variant-numeric:tabular-nums; }
.m-work { display:flex; flex:1; overflow:hidden; min-height:0; }
.m-tree { width:180px; border-right:1px solid var(--hairline); padding:14px 12px; flex-shrink:0; overflow:auto; }
.tree-ttl { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:8px; font-weight:500; display:flex; justify-content:space-between; align-items:center; }
.addf { border:none; background:none; cursor:pointer; color:var(--ink); font-size:16px; line-height:1; }
.f { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:var(--r-sm); font-size:13px; color:var(--body); cursor:pointer; }
.f.on { background:var(--soft); color:var(--ink); font-weight:500; }
.f .lk { margin-left:auto; font-size:11px; }
.m-grid-wrap { flex:1; padding:16px 24px; overflow:auto; min-width:0; }
.m-pager { display:flex; align-items:center; justify-content:center; gap:14px; padding:16px 0 4px; }
.pg-btn { border:1px solid var(--hairline); background:var(--canvas); border-radius:var(--r-sm,6px); padding:6px 14px; font-size:13px; cursor:pointer; color:var(--ink); }
.pg-btn:disabled { opacity:.4; cursor:default; }
.pg-num { font-size:12.5px; color:var(--muted,#8b93a7); font-variant-numeric:tabular-nums; white-space:nowrap; }
/* GĐ12a (HD-first 1366): cell co theo cỡ màn. 1366 ô nhỏ (sale màn nhỏ thấy nhiều ảnh
   hơn, đỡ cuộn) → 1920 vừa → 2560 ô to thoáng. minmax auto-fill giữ lưới không vỡ. */
.m-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:12px; }
@media (min-width:1600px) { .m-grid { grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:14px; } }
@media (min-width:2200px) { .m-grid { grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:16px; } }
/* TỆP — list detail theo dòng (anh chốt: grid card không phân biệt được tệp nào). */
.m-flist { display:flex; flex-direction:column; border:1px solid var(--hairline); border-radius:var(--r-md); overflow:hidden; background:var(--canvas); }
.frow { display:flex; align-items:center; gap:13px; padding:11px 14px; border-bottom:1px solid var(--hairline); cursor:pointer; }
.frow:last-child { border-bottom:none; }
.frow:hover { background:var(--soft); }
.frow.sel { background:#eef2fb; }
.ficon { width:46px; height:46px; flex-shrink:0; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; letter-spacing:.02em; }
.finfo { flex:1; min-width:0; }
.fname { font-size:14px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
.fmeta { font-size:12px; color:var(--muted); }
.card { border:1px solid var(--hairline); border-radius:var(--r-md); overflow:hidden; cursor:pointer; background:var(--canvas); }
.card.sel { border-color:var(--ink); box-shadow:0 0 0 2px var(--ink); }
.thumb { height:108px; background:var(--strong); position:relative; display:flex; align-items:center; justify-content:center; }
.thumb img { width:100%; height:100%; object-fit:cover; }
.thumb .ph { color:var(--muted); display:flex; align-items:center; justify-content:center; }
.thumb .badge { position:absolute; top:6px; right:6px; background:rgba(24,29,38,.82); color:#fff; border-radius:var(--pill); padding:3px 6px; display:inline-flex; align-items:center; }
.meta { padding:8px 10px; }
.fn { font-size:12.5px; color:var(--ink); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stat { font-size:11px; margin-top:3px; }
.stat.pub { color:var(--success); }
.stat.lk { color:var(--coral); }
.m-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--muted); padding:60px 20px; text-align:center; }
.empty-ic { opacity:.5; color:var(--muted); display:flex; align-items:center; justify-content:center; }
.empty-ttl { font-size:17px; color:var(--ink); font-weight:500; }
.empty-sub { font-size:13px; max-width:340px; }
.empty-hint { margin-top:10px; background:#f5e9d4; border:1px solid #e6d3ad; color:#6b5520; padding:6px 16px; border-radius:var(--pill); font-size:12px; display:inline-flex; align-items:center; gap:6px; }
.spin { width:18px; height:18px; border:2px solid var(--strong); border-top-color:var(--ink); border-radius:50%; animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
/* Dải "Hay dùng nhất" đã GỠ 2026-06-15 — build module báo cáo riêng sau. */

/* NGUỒN ảnh: nick nào / sale nào (2026-06-15) — Lucide icon, không emoji. */
.src { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.src span { overflow:hidden; text-overflow:ellipsis; }
.src-row { display:flex; align-items:center; gap:4px; margin-top:2px; }
.stat { display:flex; align-items:center; gap:4px; }

/* ── GĐ13a: Thùng rác ── */
.btn-trash { display:inline-flex; align-items:center; gap:6px; background:#fff; color:var(--muted); border:1px solid var(--hairline); border-radius:var(--r-md); padding:7px 13px; font-size:13px; font-weight:500; cursor:pointer; }
.btn-trash:hover { border-color:#1786be; color:#1786be; }
.btn-trash.on { background:#1786be; border-color:#1786be; color:#fff; }
.m-trash { flex:1; display:flex; flex-direction:column; padding:14px 24px; overflow:auto; min-height:0; }
.trash-bar { display:flex; align-items:center; gap:12px; padding:9px 13px; background:#fff8ec; border:1px solid #ffe3b3; border-radius:var(--r-md); margin-bottom:14px; }
.trash-ttl { display:inline-flex; align-items:center; gap:6px; font-size:13.5px; font-weight:700; color:#92400e; flex-shrink:0; }
.trash-note { font-size:11.5px; color:#7a5a1e; flex:1; line-height:1.4; }
.trash-empty { background:#fff; border:1px solid #e0a93f; color:#92400e; border-radius:var(--r-sm); padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; flex-shrink:0; }
.trash-empty:disabled { opacity:.45; cursor:default; }
.trash-close { background:none; border:none; cursor:pointer; color:#92400e; display:inline-flex; padding:3px; flex-shrink:0; }
.trash-card { cursor:default; }
.purge-badge { position:absolute; top:5px; left:5px; background:rgba(20,26,36,.72); color:#fff; font-size:10px; font-weight:600; border-radius:5px; padding:1px 6px; }
.purge-badge.soon { background:#c0392b; }
.trash-acts { display:flex; gap:5px; margin-top:4px; }
.t-restore { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; background:#e4f1f8; color:#1786be; border:1px solid #cfe6f3; border-radius:var(--r-sm); padding:5px 8px; font-size:11.5px; font-weight:600; cursor:pointer; }
.t-restore:hover { background:#1786be; color:#fff; border-color:#1786be; }
.t-perm { background:#fff; color:#c0392b; border:1px solid #f0c8c2; border-radius:var(--r-sm); padding:5px 9px; cursor:pointer; display:inline-flex; align-items:center; }
.t-perm:hover { background:#c0392b; color:#fff; border-color:#c0392b; }

/* ── GĐ12: Chọn nhiều + thao tác hàng loạt ── */
.btn-multi { display:inline-flex; align-items:center; gap:6px; background:#fff; color:var(--muted); border:1px solid var(--hairline); border-radius:var(--r-md); padding:7px 13px; font-size:13px; font-weight:500; cursor:pointer; }
.btn-multi:hover { border-color:#1786be; color:#1786be; }
.btn-multi.on { background:#1786be; border-color:#1786be; color:#fff; }
.pick-tick { position:absolute; top:6px; left:6px; width:22px; height:22px; border-radius:6px; border:2px solid #fff; background:rgba(20,26,36,.35); color:#fff; font-size:13px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,.25); }
.pick-tick.on { background:#1786be; }
.card.picked { border-color:#1786be; box-shadow:0 0 0 2px #d4ecf7; }
.bulk-bar { display:flex; align-items:center; gap:10px; background:#e4f1f8; border:1px solid #b9ddf0; border-radius:var(--r-md); padding:9px 13px; margin-bottom:14px; }
.bulk-cnt { font-size:13px; font-weight:700; color:#0b5880; flex-shrink:0; }
.bulk-sel, .bulk-tag { border:1px solid #b9ddf0; border-radius:var(--r-sm); padding:6px 10px; font-size:12.5px; background:#fff; color:var(--ink); outline:none; }
.bulk-tag { width:150px; }
.bulk-trash { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1px solid #f0c8c2; color:#c0392b; border-radius:var(--r-sm); padding:6px 11px; font-size:12.5px; font-weight:600; cursor:pointer; }
.bulk-trash:hover { background:#c0392b; color:#fff; border-color:#c0392b; }
.bulk-clear { margin-left:auto; background:none; border:none; color:#0b5880; font-size:12.5px; font-weight:600; cursor:pointer; }
</style>
