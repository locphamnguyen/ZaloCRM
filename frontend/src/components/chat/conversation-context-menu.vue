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
        <!-- Chuyển tab: từ Ưu tiên → Cá nhân, hoặc từ Cá nhân/Chính → Ưu tiên.
             activeTab='other' nghĩa là đang ở tab Ưu tiên. -->
        <button
          v-if="activeTab === 'other'"
          class="ctx-item"
          role="menuitem"
          @click="onAction('move-main')"
        >
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11l3-3 3 3"/><path d="M12 8v8"/><rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
          <span class="ctx-item__label">Chuyển qua Cá nhân</span>
        </button>
        <button
          v-else
          class="ctx-item"
          role="menuitem"
          @click="onAction('move-other')"
        >
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.7-6.3 4.7L7.9 14 2 9.4h7.6z"/>
          </svg>
          <span class="ctx-item__label">Chuyển qua Ưu tiên</span>
        </button>

        <!-- Theo dõi khách này (reuse care-session manual listen).
             Ẩn nếu thiếu contactId/nickId (vd hội thoại nhóm chưa map contact). -->
        <button
          v-if="canFollow"
          class="ctx-item"
          :class="{ 'is-primary': isFollowing }"
          role="menuitem"
          :disabled="followBusy"
          @click="onAction('toggle-follow')"
        >
          <svg v-if="!isFollowing" class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <svg v-else class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
          <span class="ctx-item__label">{{ followBusy ? 'Đang xử lý…' : (isFollowing ? 'Bỏ theo dõi' : 'Theo dõi') }}</span>
        </button>

        <!-- Xóa đoạn hội thoại (xóa mềm — mở hộp xác nhận ở component cha) -->
        <div class="ctx-divider"></div>
        <button class="ctx-item is-danger" role="menuitem" @click="onAction('delete')">
          <svg class="ctx-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
          <span class="ctx-item__label">Xóa đoạn hội thoại</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// conversation-context-menu.vue — menu chuột phải CỘT 2 (danh sách hội thoại).
// Clone y hệt message-context-menu.vue (cột 3) về giao diện + logic edge-flip
// responsive, chỉ khác bộ item (Chuyển tab / Theo dõi / Xóa hội thoại).
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  position: { x: number; y: number };
  /** Tab đang active: 'main' | 'other' | 'personal' | 'group'.
   *  'other' = tab Ưu tiên → hiện "Chuyển qua Cá nhân", còn lại → "Chuyển qua Ưu tiên". */
  activeTab: string;
  isFollowing: boolean;
  followBusy: boolean;
  /** false khi thiếu contactId/nickId (vd nhóm chưa map contact) → ẩn item Theo dõi. */
  canFollow: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [val: boolean];
  'move-main': [];
  'move-other': [];
  'toggle-follow': [];
  delete: [];
}>();

const menuRef = ref<HTMLElement | null>(null);
const flipUp = ref(false);
const flipLeft = ref(false);
const computedTop = ref(0);
const computedLeft = ref(0);

// Estimate trước khi đo thật (tránh flash off-screen). Menu cột 2 nhỏ hơn cột 3.
const EST_HEIGHT = 160;
const EST_WIDTH = 220;
const VIEWPORT_GAP = 12;

function recompute() {
  const { x, y } = props.position;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const menuEl = menuRef.value;
  const h = menuEl ? menuEl.offsetHeight : EST_HEIGHT;
  const w = menuEl ? menuEl.offsetWidth : EST_WIDTH;

  flipUp.value = vh - y < h + VIEWPORT_GAP;
  flipLeft.value = vw - x < w + VIEWPORT_GAP;

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

watch(
  () => [props.modelValue, props.position],
  async ([open]) => {
    if (!open) return;
    recompute();
    await nextTick();
    recompute();
  },
  { deep: true, immediate: true },
);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) close();
}
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
function onAction(name: 'move-main' | 'move-other' | 'toggle-follow' | 'delete') {
  // toggle-follow KHÔNG đóng menu (sale có thể muốn xem trạng thái đổi); các action
  // khác đóng menu ngay như Zalo native.
  switch (name) {
    case 'move-main':     emit('move-main');     close(); break;
    case 'move-other':    emit('move-other');    close(); break;
    case 'delete':        emit('delete');        close(); break;
    case 'toggle-follow': emit('toggle-follow');          break;
  }
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
.ctx-item:disabled { opacity: 0.6; cursor: default; }

.ctx-item__icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: #6b7280;
}
.ctx-item__label { flex: 1; }

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
