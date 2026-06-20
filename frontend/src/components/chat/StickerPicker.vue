<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-menu
    v-model="open"
    :close-on-content-click="false"
    location="top start"
    transition="scale-transition"
  >
    <template #activator="{ props: actProps }">
      <button v-bind="actProps" class="icon-tool" title="Gửi sticker">
        <!-- Anh chốt 2026-05-22: Lucide Smile đồng bộ với 7 nút Lucide khác trong toolbar -->
        <SmileIcon :size="18" :stroke-width="1.5" />
      </button>
    </template>

    <div class="sticker-picker">
      <!-- Search bar -->
      <div class="sp-search">
        <v-icon size="14" class="mr-1">mdi-magnify</v-icon>
        <input
          v-model="searchInput"
          name="sticker-search"
          autocomplete="off"
          placeholder="Tìm sticker (vd: vui, buồn, yêu...)"
          @keydown.enter="onSearch"
        />
        <button v-if="searchInput" class="sp-clear" @click="searchInput = ''; onSearch()">×</button>
      </div>

      <!-- Quick category chips -->
      <div class="sp-chips">
        <button
          v-for="kw in quickKeywords"
          :key="kw"
          class="sp-chip"
          :class="{ active: currentKeyword === kw }"
          @click="searchInput = kw; onSearch()"
        >{{ kw }}</button>
      </div>

      <!-- Sticker grid -->
      <div class="sp-grid">
        <div v-if="loading" class="sp-loading">
          <v-progress-circular size="20" width="2" indeterminate />
        </div>
        <button
          v-for="s in stickers"
          v-else
          :key="s.id"
          class="sp-item"
          :title="`Sticker ${s.id}`"
          @click="onSelect(s)"
        >
          <!-- Animated → CSS sprite, static → img -->
          <div
            v-if="s.spriteUrl && s.totalFrames > 1"
            class="sp-anim"
            :style="{
              backgroundImage: `url(${s.spriteUrl})`,
              backgroundSize: `${64 * s.totalFrames}px 64px`,
              animation: `sticker-play ${s.duration * s.totalFrames}ms steps(${s.totalFrames}) infinite`,
            }"
          ></div>
          <img v-else :src="s.staticUrl" alt="sticker" />
        </button>
        <div v-if="!loading && stickers.length === 0" class="sp-empty">Không tìm thấy sticker</div>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api/index';
import { Smile as SmileIcon } from 'lucide-vue-next';

interface StickerItem {
  id: number;
  catId: number;
  type: number;
  staticUrl: string;
  spriteUrl: string | null;
  totalFrames: number;
  duration: number;
}

const emit = defineEmits<{
  select: [sticker: StickerItem];
}>();

const open = ref(false);
const searchInput = ref('');
const currentKeyword = ref('vui');
const loading = ref(false);
const stickers = ref<StickerItem[]>([]);

const quickKeywords = ['vui', 'yêu', 'buồn', 'haha', 'ok', 'cảm ơn', 'chào'];

async function loadStickers(keyword: string) {
  loading.value = true;
  currentKeyword.value = keyword;
  try {
    // _t bypass browser cache — Cache-Control max-age=600 đã từng cache empty response
    const res = await api.get('/zalo-sticker-list', { params: { keyword, _t: Date.now() } });
    stickers.value = res.data?.stickers || [];
    if ((stickers.value?.length ?? 0) === 0) {
      console.warn('[sticker-picker] empty list from API', res.data);
    }
  } catch (err: any) {
    console.error('[sticker-picker] load error:', err?.response?.status, err?.response?.data);
    stickers.value = [];
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  const kw = searchInput.value.trim() || 'vui';
  void loadStickers(kw);
}

function onSelect(sticker: StickerItem) {
  emit('select', sticker);
  open.value = false;
}

// Pre-load default khi mở lần đầu
function watchOpen() {
  if (open.value && stickers.value.length === 0) {
    void loadStickers('vui');
  }
}
// Watch via simple effect — Vue's watch import overhead avoided since we toggle ourselves
import { watch } from 'vue';
watch(open, watchOpen);
</script>

<style scoped>
/* Anh chốt 2026-05-22: .icon-tool CSS từ MessageThread.vue (scoped) KHÔNG penetrate
   qua Vue scoped boundary xuống StickerPicker. Browser fallback default <button>
   style: border 2px outset + bg gray + radius 0 → viền vuông xám lệch. Reset đây. */
.icon-tool {
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  color: var(--smax-grey-700, #4b5563);
  background: transparent;
  border: none;
  outline: none;
  font-family: inherit;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s, color 0.12s;
}
.icon-tool:hover { background: var(--smax-grey-100, #f5f6fa); color: var(--smax-primary, #2962ff); }
.icon-tool:focus { outline: none; }
.icon-tool:focus-visible {
  outline: 2px solid var(--smax-primary-soft, #bbdefb);
  outline-offset: -1px;
}

.sticker-picker {
  width: 340px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 8px;
}
.sp-search {
  display: flex;
  align-items: center;
  background: #f5f5f5;
  border-radius: 8px;
  padding: 4px 8px;
  margin-bottom: 6px;
}
.sp-search input {
  flex: 1;
  border: 0;
  background: transparent;
  outline: none;
  font-size: 12px;
}
.sp-clear {
  background: none;
  border: 0;
  cursor: pointer;
  font-size: 16px;
  color: #757575;
  line-height: 1;
  padding: 0 4px;
}
.sp-chips {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.sp-chip {
  font-size: 11px;
  padding: 2px 8px;
  background: #f0f0f0;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sp-chip:hover { background: #e3f2fd; }
.sp-chip.active {
  background: var(--smax-primary, #2962ff);
  color: white;
  border-color: var(--smax-primary, #2962ff);
}
.sp-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}
.sp-item {
  background: #fafafa;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 4px;
  cursor: pointer;
  width: 100%;
  aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.sp-item:hover {
  background: #e3f2fd;
  border-color: var(--smax-primary, #2962ff);
  transform: scale(1.05);
}
.sp-item img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.sp-anim {
  width: 64px;
  height: 64px;
  background-repeat: no-repeat;
  background-position: 0 0;
}
.sp-loading {
  grid-column: 1 / -1;
  display: flex; justify-content: center; padding: 40px 0;
}
.sp-empty {
  grid-column: 1 / -1;
  text-align: center; padding: 40px 0;
  color: #9e9e9e; font-size: 12px;
}
/* Reuse animation keyframes from message-bubble */
@keyframes sticker-play {
  from { background-position: 0 0; }
  to { background-position: -100% 0; }
}
</style>
