<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mpd-overlay" @click.self="$emit('close')">
    <div class="mpd-card">
      <header class="mpd-head">
        <b>Chọn {{ kindLabel }} từ Kho</b>
        <span v-if="multiple && (kind || 'image') === 'image'" class="mpd-hint-album">chọn nhiều ảnh = gửi 1 album</span>
        <input v-model="search" class="mpd-search" :placeholder="`🔍 Tìm ${kindLabel}…`" @input="debouncedApply" />
        <button class="mpd-x" @click="$emit('close')">✕</button>
      </header>

      <!-- Bộ lọc: tag / người upload / sắp xếp / thời gian (BE đã hỗ trợ sẵn) -->
      <div class="mpd-filters">
        <input v-model="tagFilter" class="mpd-finput" placeholder="🏷 tag" @input="debouncedApply" />
        <select v-model="ownerFilter" class="mpd-fsel" @change="applyFilters">
          <option value="">👤 Mọi người upload</option>
          <option v-for="u in uploaders" :key="u.id" :value="u.id">{{ u.name }} ({{ u.count }})</option>
        </select>
        <select v-model="sortBy" class="mpd-fsel" @change="applyFilters">
          <option value="recent">⏱ Gần đây dùng</option>
          <option value="newest">🆕 Mới tải lên</option>
          <option value="most_used">🔥 Hay dùng</option>
          <option value="name">🔤 Tên A→Z</option>
        </select>
        <select v-model="sinceBy" class="mpd-fsel" @change="applyFilters">
          <option value="">📅 Mọi lúc</option>
          <option value="7d">7 ngày</option>
          <option value="30d">30 ngày</option>
          <option value="90d">90 ngày</option>
        </select>
      </div>

      <div class="mpd-body">
        <div v-if="loading" class="mpd-empty">Đang tải…</div>
        <div v-else-if="items.length === 0" class="mpd-empty">
          <template v-if="hasFilter">Không có {{ kindLabel }} nào khớp bộ lọc. Thử bỏ bớt điều kiện.</template>
          <template v-else>Chưa có {{ kindLabel }} công khai trong kho. Vào trang <b>Kho phương tiện</b> tải lên (đặt Công khai) trước.</template>
        </div>
        <div v-else class="mpd-grid">
          <button
            v-for="a in items" :key="a.id"
            class="mpd-cell" :class="{ on: picked.has(a.id) }"
            @click="toggle(a)"
          >
            <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
            <span v-else class="ph">{{ a.kind === 'video' ? '🎬' : a.kind === 'file' ? '📄' : '🖼' }}</span>
            <span class="mpd-name">{{ a.name }}</span>
            <span v-if="a.ownerName" class="mpd-owner">{{ a.ownerName }}</span>
            <span v-if="picked.has(a.id)" class="mpd-check">✓</span>
          </button>
        </div>
      </div>

      <footer class="mpd-foot">
        <div class="mpd-pager">
          <button class="mpd-pgbtn" :disabled="page === 0 || loading" @click="goPage(-1)">‹ Trước</button>
          <span class="mpd-pgnum">Trang {{ page + 1 }}/{{ totalPages }} · {{ total }} {{ kindLabel }}</span>
          <button class="mpd-pgbtn" :disabled="page + 1 >= totalPages || loading" @click="goPage(1)">Sau ›</button>
        </div>
        <span class="mpd-count">{{ multiple ? `Đã chọn ${picked.size}` : `Chọn 1 ${kindLabel}` }}</span>
        <button class="mpd-confirm" :disabled="picked.size === 0" @click="confirm">Chèn</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { listMediaPaged, listMediaUploaders, type MediaAssetItem, type ListMediaParams } from '@/api/media';

// publicOnly: CHỈ hiện media CÔNG KHAI (visibility='public'). Dùng khi gắn media vào
// Block/automation — tránh ảnh nick Riêng tư lọt ra broadcast (privacy, anh chốt 2026-06-12).
// Default false → các chỗ dùng khác (vd chèn vào chat) không bị lọc, hành vi cũ giữ nguyên.
const props = defineProps<{ multiple?: boolean; kind?: string; publicOnly?: boolean }>();
const emit = defineEmits<{ close: []; pick: [assets: MediaAssetItem[]] }>();

// Nhãn theo loại kho đang lọc (anh báo 2026-06-13: file/video đừng hiện "ảnh").
const kindLabel = computed(() => ({ image: 'ảnh', video: 'video', file: 'tệp' }[props.kind || 'image'] || 'media'));

const PAGE_SIZE = 40;

const items = ref<MediaAssetItem[]>([]);
const loading = ref(false);
const search = ref('');
const picked = ref<Set<string>>(new Set());
const pickedAssets = ref<Map<string, MediaAssetItem>>(new Map());

// Bộ lọc (BE đã hỗ trợ: tag / ownerUserId / sort / since).
const tagFilter = ref('');
const ownerFilter = ref('');
const sortBy = ref<'recent' | 'newest' | 'most_used' | 'name'>('recent');
const sinceBy = ref<'' | '7d' | '30d' | '90d'>('');
const uploaders = ref<Array<{ id: string; name: string; count: number }>>([]);

// Phân trang theo trang (anh chốt: nút chuyển trang + đếm số ảnh).
const total = ref(0);
const page = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

const hasFilter = computed(() => !!(search.value || tagFilter.value || ownerFilter.value || sinceBy.value));

let timer: ReturnType<typeof setTimeout> | null = null;
// Gõ tìm/tag → reset về trang 1 rồi tải (debounce).
function debouncedApply() { if (timer) clearTimeout(timer); timer = setTimeout(applyFilters, 300); }

// Đổi bộ lọc → luôn về trang 1 (tránh "trang 5" rỗng khi kết quả co lại).
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
    const params: ListMediaParams = {
      kind: props.kind || 'image',
      q: search.value || undefined,
      tag: tagFilter.value || undefined,
      ownerUserId: ownerFilter.value || undefined,
      sort: sortBy.value,
      since: sinceBy.value || undefined,
      limit: PAGE_SIZE,
      skip: page.value * PAGE_SIZE,
      ...(props.publicOnly ? { visibility: 'public' } : {}),
    };
    const res = await listMediaPaged(params);
    items.value = res.items;
    total.value = res.total;
  } catch { /* ignore */ } finally { loading.value = false; }
}

async function loadUploaders() {
  try {
    uploaders.value = await listMediaUploaders({
      kind: props.kind || 'image',
      ...(props.publicOnly ? { visibility: 'public' } : {}),
    });
  } catch { /* ignore — dropdown rỗng vẫn dùng được các lọc khác */ }
}

function toggle(a: MediaAssetItem) {
  if (!props.multiple) {
    // single: chọn 1, confirm ngay
    emit('pick', [a]);
    emit('close');
    return;
  }
  if (picked.value.has(a.id)) { picked.value.delete(a.id); pickedAssets.value.delete(a.id); }
  else { picked.value.add(a.id); pickedAssets.value.set(a.id, a); }
  picked.value = new Set(picked.value);
}

function confirm() {
  emit('pick', Array.from(pickedAssets.value.values()));
  emit('close');
}

onMounted(() => { reload(); loadUploaders(); });
</script>

<style scoped>
.mpd-overlay { position:fixed; inset:0; z-index:3000; background:rgba(24,29,38,.45); display:flex; align-items:center; justify-content:center; }
.mpd-card { --ink:#181d26; --muted:#41454d; --hairline:#dddddd; --canvas:#fff; --soft:#f8fafc; --coral:#aa2d00;
  background:var(--canvas); border-radius:12px; width:680px; max-width:92vw; max-height:80vh; display:flex; flex-direction:column; overflow:hidden; }
.mpd-head { display:flex; align-items:center; gap:10px; padding:14px 18px; border-bottom:1px solid var(--hairline); }
.mpd-head b { color:var(--ink); }
.mpd-hint-album { font-size:11px; color:#1786be; background:#e4f1f8; border-radius:9999px; padding:2px 9px; font-weight:600; }
.mpd-search { margin-left:auto; border:1px solid var(--hairline); border-radius:6px; padding:5px 10px; font-size:13px; width:160px; outline:none; }
.mpd-x { border:none; background:none; cursor:pointer; color:var(--muted); font-size:15px; }
.mpd-filters { display:flex; gap:7px; flex-wrap:wrap; padding:10px 18px; border-bottom:1px solid var(--hairline); background:var(--soft); }
.mpd-finput { border:1px solid var(--hairline); border-radius:6px; padding:5px 9px; font-size:12px; width:96px; outline:none; }
.mpd-fsel { border:1px solid var(--hairline); border-radius:6px; padding:5px 8px; font-size:12px; color:var(--ink); background:var(--canvas); outline:none; max-width:170px; }
.mpd-body { padding:16px 18px; overflow:auto; flex:1; }
.mpd-empty { padding:40px; text-align:center; color:var(--muted); }
.mpd-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px; }
.mpd-cell { border:1px solid var(--hairline); border-radius:8px; overflow:hidden; cursor:pointer; background:var(--canvas); padding:0; position:relative; }
.mpd-cell.on { border-color:var(--ink); box-shadow:0 0 0 2px var(--ink); }
.mpd-cell img { width:100%; height:80px; object-fit:cover; display:block; }
.mpd-cell .ph { display:flex; align-items:center; justify-content:center; height:80px; font-size:26px; background:linear-gradient(135deg,#cfd6dd,#aeb6bf); }
.mpd-name { display:block; font-size:11px; padding:4px 6px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--ink); }
.mpd-owner { display:block; font-size:10px; padding:0 6px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--muted); }
.mpd-check { position:absolute; top:5px; right:5px; background:var(--ink); color:#fff; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px; }
.mpd-foot { padding:12px 18px; border-top:1px solid var(--hairline); display:flex; align-items:center; gap:14px; }
.mpd-pager { display:flex; align-items:center; gap:8px; }
.mpd-pgbtn { border:1px solid var(--hairline); background:var(--canvas); border-radius:6px; padding:5px 10px; font-size:12px; cursor:pointer; color:var(--ink); }
.mpd-pgbtn:disabled { opacity:.4; cursor:default; }
.mpd-pgnum { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
.mpd-count { font-size:13px; color:var(--muted); margin-left:auto; }
.mpd-confirm { background:var(--ink); color:#fff; border:none; border-radius:8px; padding:8px 20px; font-size:13.5px; font-weight:500; cursor:pointer; }
.mpd-confirm:disabled { opacity:.5; cursor:default; }
</style>
