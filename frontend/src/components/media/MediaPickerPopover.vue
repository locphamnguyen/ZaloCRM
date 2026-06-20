<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mp-pop" @click.self="$emit('close')">
    <div class="mp-card">
      <!-- Hàng 1: tìm + nút lọc sâu + đóng -->
      <div class="mp-row1">
        <input v-model="search" class="mp-search" placeholder="🔍 Tìm trong kho…" @input="debouncedReload" />
        <button class="mp-filter-btn" :class="{ on: showLever2 }" title="Lọc sâu" @click="showLever2 = !showLever2">⚙ Lọc</button>
        <button class="mp-x" @click="$emit('close')">✕</button>
      </div>

      <!-- LEVER 1: Loại (Ảnh/Video/Tệp) + Quyền (Riêng/Công) -->
      <div class="mp-lever1">
        <div class="seg">
          <span :class="{ on: kindFilter === 'image' }" @click="setKind('image')">🖼 Ảnh</span>
          <span :class="{ on: kindFilter === 'video' }" @click="setKind('video')">🎬 Video</span>
          <span :class="{ on: kindFilter === 'file' }" @click="setKind('file')">📄 Tệp</span>
        </div>
        <div class="seg vis">
          <span :class="{ on: visFilter === '' }" @click="setVis('')">Tất cả</span>
          <span :class="{ on: visFilter === 'public' }" @click="setVis('public')">🌐 Công</span>
          <span :class="{ on: visFilter === 'private' }" @click="setVis('private')">🔒 Riêng</span>
        </div>
      </div>

      <!-- LEVER 2: Sắp xếp / Thời gian / Size / Tag (ẩn/hiện) -->
      <div v-if="showLever2" class="mp-lever2">
        <select v-model="sortBy" class="mp-sel" @change="reload">
          <option value="recent">⏱ Gần đây dùng</option>
          <option value="newest">🆕 Mới tải lên</option>
          <option value="most_used">🔥 Hay dùng nhất</option>
          <option value="name">🔤 Tên A→Z</option>
        </select>
        <select v-model="sinceBy" class="mp-sel" @change="reload">
          <option value="">📅 Mọi lúc</option>
          <option value="7d">7 ngày</option>
          <option value="30d">30 ngày</option>
          <option value="90d">90 ngày</option>
        </select>
        <select v-model="sizeBy" class="mp-sel" @change="reload">
          <option value="">⚖ Mọi cỡ</option>
          <option value="small">&lt; 1MB</option>
          <option value="medium">1–10MB</option>
          <option value="large">&gt; 10MB</option>
        </select>
        <input v-model="tagFilter" class="mp-tag-input" placeholder="🏷 tag" @input="debouncedReload" />
      </div>

      <!-- Thanh chọn nhiều (album) — CHỈ khi đang lọc ẢNH (Zalo album = ảnh) -->
      <div v-if="kindFilter === 'image'" class="mp-multibar">
        <label class="mp-toggle">
          <input type="checkbox" :checked="multiMode" @change="toggleMultiMode" />
          Chọn nhiều ảnh (gửi cả album)
        </label>
        <template v-if="multiMode">
          <span class="mp-count">{{ picked.size }}/12 đã chọn</span>
          <button class="mp-send-album" :disabled="picked.size === 0 || sendingAlbum" @click="sendAlbum">
            {{ sendingAlbum ? 'Đang gửi…' : `Gửi ${picked.size || ''} ảnh` }}
          </button>
        </template>
      </div>

      <div v-if="loading" class="mp-empty">Đang tải…</div>
      <div v-else-if="items.length === 0" class="mp-empty">
        Không có {{ kindLabel }} nào khớp. Tải lên ở trang <b>Kho ảnh</b> hoặc chuột phải tin nhắn → Lưu vào Media.
      </div>

      <!-- TỆP: list theo dòng (sale phân biệt được tệp nào — anh chốt) -->
      <div v-else-if="kindFilter === 'file'" class="mp-list">
        <button
          v-for="a in items"
          :key="a.id"
          class="mp-fitem"
          :disabled="sending === a.id"
          @click="send(a)"
        >
          <span class="mp-ficon" :style="{ background: fileIcon(a.name).bg, color: fileIcon(a.name).fg }">{{ fileIcon(a.name).label }}</span>
          <span class="mp-finfo">
            <span class="mp-fname" :title="a.name">{{ a.name }}</span>
            <span class="mp-fmeta">{{ fmtSize(a.sizeBytes) }}</span>
          </span>
          <span v-if="sending === a.id" class="mp-fsending">Đang gửi…</span>
          <span v-else class="mp-fsend">Gửi ›</span>
        </button>
      </div>

      <!-- ẢNH/VIDEO: grid thumbnail (video có overlay ▶ + thời lượng + size) -->
      <div v-else class="mp-grid">
        <button
          v-for="a in items"
          :key="a.id"
          class="mp-cell"
          :class="{ picked: picked.has(a.id) }"
          :disabled="sending === a.id || sendingAlbum"
          @click="onCellClick(a)"
        >
          <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
          <span v-else class="ph">{{ a.kind === 'video' ? '🎬' : '🖼' }}</span>
          <template v-if="a.kind === 'video'">
            <span class="mp-play">▶</span>
            <span v-if="a.durationSec" class="mp-dur">{{ fmtDuration(a.durationSec) }}</span>
          </template>
          <span class="mp-name">
            {{ a.name }}<template v-if="a.kind === 'video' && a.sizeBytes"> · {{ fmtSize(a.sizeBytes) }}</template>
          </span>
          <span v-if="multiMode && picked.has(a.id)" class="mp-check on">{{ pickIndex(a.id) }}</span>
          <span v-if="sending === a.id" class="mp-sending">Đang gửi…</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { listMedia, sendMediaToConversation, sendAlbumToConversation, type MediaAssetItem, type ListMediaParams } from '@/api/media';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ conversationId: string }>();
const emit = defineEmits<{ close: []; sent: [] }>();
const toast = useToast();

const items = ref<MediaAssetItem[]>([]);
const loading = ref(false);
const search = ref('');
const sending = ref<string | null>(null);

// LEVER 1
const kindFilter = ref<'image' | 'video' | 'file'>('image');
const visFilter = ref<'' | 'public' | 'private'>('');
// LEVER 2
const showLever2 = ref(false);
const sortBy = ref<'recent' | 'newest' | 'most_used' | 'name'>('recent');
const sinceBy = ref<'' | '7d' | '30d' | '90d'>('');
const sizeBy = ref<'' | 'small' | 'medium' | 'large'>('');
const tagFilter = ref('');

// Chọn nhiều ảnh để gửi cả album 1 lần.
const multiMode = ref(false);
const picked = ref<Set<string>>(new Set());
const sendingAlbum = ref(false);

const kindLabel = computed(() => ({ image: 'ảnh', video: 'video', file: 'tệp' }[kindFilter.value]));

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
  if (!bytes) return '';
  const MB = 1024 * 1024;
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() { if (timer) clearTimeout(timer); timer = setTimeout(reload, 300); }

function setKind(k: 'image' | 'video' | 'file') {
  kindFilter.value = k;
  if (k !== 'image') { multiMode.value = false; picked.value = new Set(); } // album chỉ cho ảnh
  reload();
}
function setVis(v: '' | 'public' | 'private') { visFilter.value = v; reload(); }

function toggleMultiMode() {
  multiMode.value = !multiMode.value;
  if (!multiMode.value) picked.value = new Set();
}

// Map size bucket → byte min/max.
function sizeRange(): { sizeMin?: number; sizeMax?: number } {
  const MB = 1024 * 1024;
  if (sizeBy.value === 'small') return { sizeMax: MB };
  if (sizeBy.value === 'medium') return { sizeMin: MB, sizeMax: 10 * MB };
  if (sizeBy.value === 'large') return { sizeMin: 10 * MB };
  return {};
}

async function reload() {
  loading.value = true;
  try {
    const params: ListMediaParams = {
      kind: kindFilter.value,
      q: search.value || undefined,
      visibility: visFilter.value || undefined,
      tag: tagFilter.value || undefined,
      since: sinceBy.value || undefined,
      sort: sortBy.value,
      limit: 40,
      ...sizeRange(),
    };
    items.value = await listMedia(params);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được kho');
  } finally {
    loading.value = false;
  }
}

function onCellClick(a: MediaAssetItem) {
  if (multiMode.value && a.kind === 'image') { togglePick(a); return; }
  send(a);
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

// Số thứ tự theo lượt chọn (anh chốt): tick trước → số nhỏ. Bỏ giữa → số sau dồn lại.
// CHỈ hiện trên ảnh ĐÃ chọn (chưa chọn không có vòng tròn).
function pickIndex(id: string): string {
  const idx = [...picked.value].indexOf(id);
  return idx >= 0 ? String(idx + 1) : '';
}

async function send(a: MediaAssetItem) {
  if (sending.value) return;
  sending.value = a.id;
  try {
    await sendMediaToConversation(a.id, props.conversationId);
    toast.success(`Đã gửi "${a.name}"`);
    emit('sent');
    emit('close');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi thất bại');
  } finally {
    sending.value = null;
  }
}

async function sendAlbum() {
  if (sendingAlbum.value || picked.value.size === 0) return;
  sendingAlbum.value = true;
  try {
    const ids = [...picked.value];
    const res = await sendAlbumToConversation(ids, props.conversationId);
    toast.success(`Đã gửi album ${res.sent} ảnh`);
    emit('sent');
    emit('close');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi album thất bại');
  } finally {
    sendingAlbum.value = false;
  }
}

onMounted(reload);
</script>

<style scoped>
.mp-pop { position:absolute; inset:0 0 auto 0; bottom:100%; z-index:40; }
.mp-card {
  --ink:#181d26; --muted:#41454d; --hairline:#dddddd; --canvas:#fff; --soft:#f8fafc; --coral:#aa2d00; --forest:#006400;
  background:var(--soft); border:1px solid var(--hairline); border-radius:10px 10px 0 0;
  border-bottom:none; padding:12px 14px; max-height:400px; display:flex; flex-direction:column;
  box-shadow:0 -4px 16px rgba(0,0,0,.06);
}
.mp-row1 { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.mp-search { flex:1; border:1px solid var(--hairline); border-radius:6px; padding:5px 10px; font-size:12px; outline:none; }
.mp-filter-btn { border:1px solid var(--hairline); background:var(--canvas); border-radius:6px; padding:5px 10px; font-size:11.5px; cursor:pointer; color:var(--muted); }
.mp-filter-btn.on { background:var(--ink); color:#fff; border-color:var(--ink); }
.mp-x { border:none; background:none; cursor:pointer; color:var(--muted); }
.mp-lever1 { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.seg { display:inline-flex; border:1px solid var(--hairline); border-radius:9999px; overflow:hidden; font-size:11.5px; background:var(--canvas); }
.seg span { padding:4px 11px; cursor:pointer; color:var(--muted); white-space:nowrap; }
.seg span.on { background:var(--ink); color:#fff; }
.mp-lever2 { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
.mp-sel { border:1px solid var(--hairline); border-radius:6px; padding:4px 8px; font-size:11.5px; color:var(--ink); background:var(--canvas); outline:none; }
.mp-tag-input { border:1px solid var(--hairline); border-radius:6px; padding:4px 9px; font-size:11.5px; width:90px; outline:none; }
.mp-multibar { display:flex; align-items:center; gap:12px; margin-bottom:8px; font-size:12px; color:var(--muted); }
.mp-toggle { display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
.mp-toggle input { accent-color:var(--ink); cursor:pointer; }
.mp-count { color:var(--ink); font-weight:500; }
.mp-send-album { margin-left:auto; border:none; background:var(--ink); color:#fff; border-radius:6px; padding:5px 14px; font-size:12px; font-weight:500; cursor:pointer; }
.mp-send-album:disabled { opacity:.45; cursor:default; }
.mp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(78px,1fr)); gap:8px; overflow:auto; }
.mp-cell { border:1px solid var(--hairline); border-radius:6px; overflow:hidden; cursor:pointer; background:var(--canvas); padding:0; position:relative; }
.mp-cell:disabled { opacity:.6; }
.mp-cell.picked { border-color:var(--ink); box-shadow:0 0 0 2px var(--ink) inset; }
.mp-cell img { width:100%; height:56px; object-fit:cover; display:block; }
.mp-cell .ph { display:flex; align-items:center; justify-content:center; height:56px; font-size:22px; background:#e0e2e6; color:var(--muted); }
.mp-play { position:absolute; top:50%; left:50%; transform:translate(-50%,-58%); width:24px; height:24px; border-radius:9999px; background:rgba(0,0,0,.5); color:#fff; font-size:11px; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.mp-dur { position:absolute; bottom:22px; right:3px; background:rgba(0,0,0,.72); color:#fff; border-radius:3px; padding:0 4px; font-size:9.5px; font-variant-numeric:tabular-nums; pointer-events:none; }
.mp-name { display:block; font-size:10px; padding:3px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink); }

/* TỆP — list theo dòng (anh chốt: grid card không phân biệt được tệp nào). */
.mp-list { overflow:auto; display:flex; flex-direction:column; }
.mp-fitem { display:flex; align-items:center; gap:10px; width:100%; padding:8px 8px; border:none; background:none; border-bottom:1px solid var(--hairline); cursor:pointer; text-align:left; }
.mp-fitem:last-child { border-bottom:none; }
.mp-fitem:hover { background:var(--canvas); }
.mp-fitem:disabled { opacity:.55; }
.mp-ficon { width:38px; height:38px; flex-shrink:0; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:700; letter-spacing:.02em; }
.mp-finfo { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.mp-fname { font-size:12.5px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mp-fmeta { font-size:11px; color:var(--muted); }
.mp-fsend { font-size:11.5px; color:var(--ink); font-weight:500; flex-shrink:0; }
.mp-fsending { font-size:11px; color:var(--muted); flex-shrink:0; }
.mp-check { position:absolute; top:4px; right:4px; width:19px; height:19px; border-radius:9999px; border:1.5px solid #fff; background:rgba(24,29,38,.35); color:#fff; font-size:11.5px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,.25); }
.mp-check.on { background:var(--ink); }
.mp-sending { position:absolute; inset:0; background:rgba(255,255,255,.8); display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--ink); }
.mp-empty { padding:24px 12px; text-align:center; font-size:12.5px; color:var(--muted); }
</style>
