<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="ctx-menu-overlay"
      @click.self="close"
      @contextmenu.prevent="close"
    >
      <div
        ref="menuRef"
        class="ctx-menu"
        :class="{ 'flip-up': flipUp }"
        :style="menuStyle"
        role="menu"
        @click.stop
      >
        <!-- Trả lời -->
        <button class="ctx-item" role="menuitem" @click="onAction('reply')">
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
          </svg>
          <span class="ctx-item__label">Trả lời</span>
        </button>

        <!-- Chỉnh sửa (self + text) -->
        <button
          v-if="isSelf && message?.contentType === 'text'"
          class="ctx-item"
          role="menuitem"
          @click="onAction('edit')"
        >
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
          <span class="ctx-item__label">Chỉnh sửa</span>
        </button>

        <!-- Sao chép (text only) -->
        <button
          v-if="message?.contentType === 'text'"
          class="ctx-item"
          role="menuitem"
          @click="onCopy"
        >
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span class="ctx-item__label">Sao chép</span>
        </button>

        <!-- Chuyển tiếp -->
        <button class="ctx-item" role="menuitem" @click="onAction('forward')">
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
          </svg>
          <span class="ctx-item__label">Chuyển tiếp</span>
        </button>

        <!-- Lưu vào Media (chỉ tin có media: ảnh/video/tệp) — Phase Media Library 2026-06-11 -->
        <!-- Có submenu: Kho cá nhân Riêng tư (mặc định) / Kho chung Công khai (G3) -->
        <div v-if="isMediaMessage" class="ctx-sub" @mouseenter="saveSubOpen = true" @mouseleave="saveSubOpen = false">
          <button class="ctx-item" role="menuitem" @click="onSaveMedia('private')">
            <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            <span class="ctx-item__label">Lưu vào Media</span>
            <span class="ctx-caret">▸</span>
          </button>
          <div v-if="saveSubOpen" class="ctx-flyout" :class="{ left: flipLeft }">
            <button class="ctx-item" role="menuitem" @click="onSaveMedia('private')">
              <span class="ctx-item__icon emoji">🔒</span>
              <span class="ctx-item__label">Kho cá nhân (Riêng tư)</span>
            </button>
            <button class="ctx-item" role="menuitem" @click="onSaveMedia('public')">
              <span class="ctx-item__icon emoji">🌐</span>
              <span class="ctx-item__label">Kho chung (Công khai)</span>
            </button>
          </div>
        </div>

        <!-- Thêm vào Yêu thích — lưu private rồi gắn ⭐ (G3) -->
        <button v-if="isMediaMessage" class="ctx-item" role="menuitem" @click="onAction('favorite-media')">
          <span class="ctx-item__icon emoji">⭐</span>
          <span class="ctx-item__label">Thêm vào Yêu thích</span>
        </button>

        <!-- Thu hồi (self only) -->
        <button v-if="isSelf" class="ctx-item" role="menuitem" @click="onAction('undo')">
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          <span class="ctx-item__label">Thu hồi</span>
        </button>

        <!-- Xóa (self only) -->
        <template v-if="isSelf">
          <div class="ctx-divider"></div>
          <button class="ctx-item is-danger" role="menuitem" @click="onAction('delete')">
            <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
            <span class="ctx-item__label">Xóa</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { Message } from '@/composables/use-chat';

const props = defineProps<{
  message: Message | null;
  isSelf: boolean;
  position: { x: number; y: number };
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [val: boolean];
  reply: [];
  edit: [];
  delete: [];
  undo: [];
  forward: [];
  copy: [];
  'save-media': [visibility: 'private' | 'public'];
  'favorite-media': [];
}>();

// Tin có media (ảnh/video/tệp) → hiện "Lưu vào Media". Phase Media Library 2026-06-11.
const isMediaMessage = computed(() =>
  ['image', 'video', 'file'].includes(props.message?.contentType ?? ''),
);

// Submenu "Lưu vào Media" (Riêng tư / Công khai) — mở khi hover.
const saveSubOpen = ref(false);
function onSaveMedia(visibility: 'private' | 'public') {
  emit('save-media', visibility);
  close();
}

const menuRef = ref<HTMLElement | null>(null);
const flipUp = ref(false);
const flipLeft = ref(false);
const computedTop = ref(0);
const computedLeft = ref(0);

// Estimated menu height — recompute after mount with real measurement.
// 38px per item × ~7 items + 2 dividers (10px each) + 12px padding ≈ 300px.
const EST_HEIGHT = 300;
const EST_WIDTH = 210;
const VIEWPORT_GAP = 12;

function recompute() {
  const { x, y } = props.position;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Measure real menu if mounted, else fall back to estimate.
  const menuEl = menuRef.value;
  const h = menuEl ? menuEl.offsetHeight : EST_HEIGHT;
  const w = menuEl ? menuEl.offsetWidth : EST_WIDTH;

  // Vertical flip: if not enough room below, open up.
  flipUp.value = vh - y < h + VIEWPORT_GAP;
  // Horizontal flip: if not enough room right, shift left.
  flipLeft.value = vw - x < w + VIEWPORT_GAP;

  // Position computation — anchor near click point, with small offset.
  if (flipUp.value) {
    computedTop.value = Math.max(VIEWPORT_GAP, y - h - 4);
  } else {
    computedTop.value = Math.min(vh - h - VIEWPORT_GAP, y + 4);
  }
  if (flipLeft.value) {
    computedLeft.value = Math.max(VIEWPORT_GAP, x - w - 4);
  } else {
    computedLeft.value = Math.min(vw - w - VIEWPORT_GAP, x + 4);
  }
}

const menuStyle = computed(() => ({
  top: `${computedTop.value}px`,
  left: `${computedLeft.value}px`,
}));

// Recompute on open + when position changes
watch(
  () => [props.modelValue, props.position],
  async ([open]) => {
    if (!open) return;
    // Initial guess with estimates so menu doesn't flash off-screen.
    recompute();
    await nextTick();
    // Re-measure now that menu DOM exists, refine position.
    recompute();
  },
  { deep: true, immediate: true },
);

// Close on Escape
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) close();
}
// Close on scroll/resize (Zalo native UX — menu không stay khi scroll)
function onScroll() { if (props.modelValue) close(); }
function onResize() { if (props.modelValue) close(); }

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('scroll', onScroll, { capture: true });
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', onScroll, { capture: true } as any);
  window.removeEventListener('resize', onResize);
});

function close() {
  emit('update:modelValue', false);
}
function onAction(name: 'reply' | 'edit' | 'forward' | 'undo' | 'delete' | 'favorite-media') {
  // Switch để TS narrow đúng từng emit signature (union không inferr được)
  switch (name) {
    case 'reply':          emit('reply');          break;
    case 'edit':           emit('edit');           break;
    case 'forward':        emit('forward');        break;
    case 'undo':           emit('undo');           break;
    case 'delete':         emit('delete');         break;
    case 'favorite-media': emit('favorite-media'); break;
  }
  close();
}
async function onCopy() {
  await navigator.clipboard.writeText(props.message?.content || '');
  emit('copy');
  close();
}
</script>

<style scoped>
.ctx-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  /* Transparent — only catches clicks-outside to close. */
}

.ctx-menu {
  position: fixed;
  z-index: 101;
  background: #ffffff;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
  border: 1px solid #e5e7eb;
  min-width: 200px;
  padding: 6px 0;
  animation: ctx-pop 0.12s ease-out;
  font-family: inherit;
}
.ctx-menu.flip-up { animation: ctx-pop-up 0.12s ease-out; }

@keyframes ctx-pop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ctx-pop-up {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 14px;
  min-height: 38px;
  font-size: 13.5px;
  line-height: 1.2;
  color: #374151;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  user-select: none;
  transition: background-color 0.08s ease;
}
.ctx-item:hover { background: #f3f4f6; }
.ctx-item:active { background: #e5e7eb; }
.ctx-item:focus-visible { outline: 2px solid #2962ff; outline-offset: -2px; }

.ctx-item__icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: #6b7280;
}
.ctx-item__icon.emoji { display: flex; align-items: center; justify-content: center; font-size: 14px; }
.ctx-item__label { flex: 1; }
.ctx-caret { color: #9ca3af; font-size: 11px; margin-left: 4px; }

/* Submenu "Lưu vào Media" — flyout bên phải (hoặc trái khi sát mép). */
.ctx-sub { position: relative; }
.ctx-flyout {
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 2px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
  min-width: 190px;
  padding: 6px 0;
  z-index: 102;
}
.ctx-flyout.left { left: auto; right: 100%; margin-left: 0; margin-right: 2px; }

.ctx-item.is-danger { color: #ef4444; }
.ctx-item.is-danger .ctx-item__icon { color: #ef4444; }
.ctx-item.is-danger:hover { background: rgba(239, 68, 68, 0.08); }

.ctx-item.is-primary { color: #2962ff; font-weight: 500; }
.ctx-item.is-primary .ctx-item__icon { color: #2962ff; }
.ctx-item.is-primary:hover { background: rgba(41, 98, 255, 0.08); }

.ctx-divider {
  height: 1px;
  background: #e5e7eb;
  margin: 5px 8px;
}
</style>
