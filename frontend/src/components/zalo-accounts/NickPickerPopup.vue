<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  NickPickerPopup — anchored dropdown picker (Wedge A 2026-05-28).

  Anh chốt 2026-05-28:
   - KHÔNG popup overlay đè lên dialog
   - Bảng nhỏ xổ xuống từ trigger, có mũi tên
   - Bám vị trí trigger qua getBoundingClientRect (Teleport tới body + position:fixed)
     để KHÔNG bị v-card scoped overflow clip
   - Click ngoài → close
   - Reposition khi window scroll/resize

  Privacy lock rules:
   - Nick `privacyMode === 'main'` của user khác → 🔒 disabled (toast warning).
   - Nick `privacyMode === 'main'` của viewer + PIN chưa unlock → 🔒 click → PrivacyUnlockDialog.
   - Nick `privacyMode === 'sub'` → click bình thường.

  Sections: "👤 Nick của bạn" + "👥 Nick sale dưới quyền".
-->
<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="rootEl"
      class="npp-dropdown"
      :class="placementClass"
      role="listbox"
      :style="positionStyle"
    >
      <div class="npp-arrow" :style="arrowStyle"></div>
      <header class="npp-header">
        <span class="npp-title">{{ title }}</span>
        <button class="npp-close" @click="close" aria-label="Đóng">✕</button>
      </header>

      <div v-if="searchable && allAccounts.length > 5" class="npp-search-wrap">
        <input
          v-model="search"
          ref="searchEl"
          type="text"
          class="npp-search"
          placeholder="🔎 Tìm nick…"
          autocomplete="off"
          @keydown.escape="close"
        />
      </div>

      <div class="npp-body">
        <div v-if="filteredOwn.length === 0 && filteredTeam.length === 0" class="npp-empty">
          {{ search ? `Không có nick nào khớp "${search}"` : '⚠ Chưa có nick nào để chọn' }}
        </div>

        <div v-if="filteredOwn.length > 0" class="npp-section">
          <span class="npp-row-label">
            👤 Nick của bạn
            <span v-if="filteredOwn.length > 6" class="npp-count">({{ filteredOwn.length }})</span>
          </span>
          <div class="npp-grid">
            <NickRow
              v-for="n in filteredOwn"
              :key="n.id"
              :nick="n"
              :busy="busy"
              :is-locked="isLockedForViewer(n)"
              :is-blocked="isBlockedForViewer(n)"
              @click="onPick(n)"
            />
          </div>
        </div>

        <div v-if="filteredTeam.length > 0" class="npp-section">
          <span class="npp-row-label">
            👥 Nick sale dưới quyền
            <span class="npp-count">({{ filteredTeam.length }})</span>
          </span>
          <div class="npp-grid">
            <NickRow
              v-for="n in filteredTeam"
              :key="n.id"
              :nick="n"
              :busy="busy"
              :is-locked="isLockedForViewer(n)"
              :is-blocked="isBlockedForViewer(n)"
              @click="onPick(n)"
            />
          </div>
        </div>
      </div>

      <footer v-if="hasAnyLocked" class="npp-hint">
        🔒 = Nick riêng tư. Của bạn → click mở khóa PIN. Của người khác → chỉ owner dùng được.
      </footer>
    </div>

    <!-- OTP unlock modal — owner click 🔒 nick của mình (2026-06-06 thay PIN dialog) -->
    <PrivacyUnlockOtpModal
      :open="showUnlockDialog"
      @close="showUnlockDialog = false"
      @unlocked="onUnlocked"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, h } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { usePrivacyStore } from '@/stores/privacy';
import { useToast } from '@/composables/use-toast';
import PrivacyUnlockOtpModal from '@/components/privacy/PrivacyUnlockOtpModal.vue';

export interface NickPickerAccount {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  zaloUid?: string | null;
  ownerUserId?: string | null;
  privacyMode?: 'main' | 'sub' | string | null;
  owner?: { id: string; fullName: string | null } | null;
  isOwnedByMe?: boolean;
}

interface Props {
  modelValue: boolean;
  accounts: NickPickerAccount[];
  /** Element trigger để compute position. Bắt buộc cho anchored mode. */
  triggerEl?: HTMLElement | null;
  title?: string;
  searchable?: boolean;
  busy?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  triggerEl: null,
  title: 'Chọn nick CRM',
  searchable: true,
  busy: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'pick', account: NickPickerAccount): void;
}>();

const authStore = useAuthStore();
const privacyStore = usePrivacyStore();
const toast = useToast();

const rootEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const search = ref('');

const showUnlockDialog = ref(false);
const pendingLockedNick = ref<NickPickerAccount | null>(null);

const triggerRect = ref<{ top: number; left: number; right: number; bottom: number; width: number; height: number } | null>(null);
const placement = ref<'bottom' | 'top'>('bottom');
const arrowLeft = ref(60);

const placementClass = computed(() => `npp-placement-${placement.value}`);

const positionStyle = computed(() => {
  if (!triggerRect.value) return { visibility: 'hidden' as const };
  const r = triggerRect.value;
  const dropdownWidth = Math.min(Math.max(r.width, 480), 720);
  const vw = window.innerWidth;
  // Align dropdown left với trigger; clamp 16px khỏi mép phải
  let leftPx = r.left;
  if (leftPx + dropdownWidth > vw - 16) {
    leftPx = Math.max(16, vw - 16 - dropdownWidth);
  }
  // Vị trí top/bottom dựa placement
  if (placement.value === 'bottom') {
    return {
      position: 'fixed' as const,
      top: `${r.bottom + 10}px`,
      left: `${leftPx}px`,
      width: `${dropdownWidth}px`,
    };
  }
  // top placement — em đặt bottom relative tới viewport
  return {
    position: 'fixed' as const,
    bottom: `${window.innerHeight - r.top + 10}px`,
    left: `${leftPx}px`,
    width: `${dropdownWidth}px`,
  };
});

const arrowStyle = computed(() => ({ left: `${arrowLeft.value}px` }));

function recomputePosition() {
  const t = props.triggerEl;
  if (!t) {
    triggerRect.value = null;
    return;
  }
  const r = t.getBoundingClientRect();
  triggerRect.value = {
    top: r.top, left: r.left, right: r.right, bottom: r.bottom,
    width: r.width, height: r.height,
  };
  // Decide placement: nếu không đủ space dưới → flip lên trên
  const dropdownMaxHeight = 400;
  const spaceBelow = window.innerHeight - r.bottom;
  const spaceAbove = r.top;
  placement.value = (spaceBelow >= dropdownMaxHeight || spaceBelow >= spaceAbove) ? 'bottom' : 'top';
  // Arrow alignment — căn theo center icon của trigger button
  arrowLeft.value = Math.max(20, Math.min(r.width - 30, 60));
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    search.value = '';
    void privacyStore.fetchStatus(true);
    await nextTick();
    recomputePosition();
    searchEl.value?.focus();
  }
});

watch(() => props.triggerEl, () => {
  if (props.modelValue) recomputePosition();
});

const myUserId = computed(() => authStore.user?.id || '');
const allAccounts = computed(() => props.accounts);

function isOwn(n: NickPickerAccount): boolean {
  if (n.isOwnedByMe != null) return !!n.isOwnedByMe;
  return n.ownerUserId === myUserId.value;
}

const filteredOwn = computed<NickPickerAccount[]>(() =>
  filterBySearch(allAccounts.value.filter(isOwn)),
);

const filteredTeam = computed<NickPickerAccount[]>(() =>
  filterBySearch(allAccounts.value.filter((n) => !isOwn(n))),
);

function filterBySearch(list: NickPickerAccount[]): NickPickerAccount[] {
  const q = search.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((n) =>
    (n.displayName || '').toLowerCase().includes(q) ||
    (n.zaloUid || '').toLowerCase().includes(q) ||
    (n.owner?.fullName || '').toLowerCase().includes(q),
  );
}

function isLockedForViewer(n: NickPickerAccount): boolean {
  if (n.privacyMode !== 'main') return false;
  if (!isOwn(n)) return true;
  return !privacyStore.isUnlocked;
}

function isBlockedForViewer(n: NickPickerAccount): boolean {
  return isLockedForViewer(n) && !isOwn(n);
}

const hasAnyLocked = computed(() =>
  allAccounts.value.some((n) => n.privacyMode === 'main'),
);

function close() {
  emit('update:modelValue', false);
}

function onPick(nick: NickPickerAccount) {
  if (props.busy) return;
  if (isBlockedForViewer(nick)) {
    toast.warning(`🔒 Nick "${nick.displayName || ''}" thuộc Riêng tư của ${nick.owner?.fullName || 'người khác'} — không thể dùng để liên lạc.`);
    return;
  }
  if (isLockedForViewer(nick)) {
    pendingLockedNick.value = nick;
    showUnlockDialog.value = true;
    return;
  }
  emit('pick', nick);
  close();
}

async function onUnlocked() {
  showUnlockDialog.value = false;
  await privacyStore.fetchStatus(true);
  const nick = pendingLockedNick.value;
  pendingLockedNick.value = null;
  if (nick && !isLockedForViewer(nick)) {
    emit('pick', nick);
    close();
  }
}

// Click-outside listener — đóng dropdown khi click ngoài root + ngoài trigger
function handleOutsideClick(e: MouseEvent) {
  if (!props.modelValue) return;
  if (showUnlockDialog.value) return;
  const root = rootEl.value;
  const target = e.target as Node;
  // Inside dropdown → keep open
  if (root && root.contains(target)) return;
  // Click trigger → để trigger handle toggle (đừng đóng ngay rồi parent toggle = mở lại)
  const trigger = props.triggerEl;
  if (trigger && trigger.contains(target as any)) return;
  // Element marked as trigger (vd nút "Đổi nick")
  if ((target as HTMLElement)?.closest?.('[data-nick-picker-trigger]')) return;
  close();
}

// Reposition khi window resize / scroll outside trigger container
function onScrollOrResize() {
  if (props.modelValue) recomputePosition();
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true); // capture: catch inner scroll
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('scroll', onScrollOrResize, true);
});

// NickRow functional render
const NickRow = (rawProps: any) => {
  const { nick, busy, isLocked, isBlocked } = rawProps;
  const classes = ['npp-pill'];
  if (isLocked) classes.push('locked');
  if (isBlocked) classes.push('blocked');
  if (busy) classes.push('busy');

  const initials = (nick.displayName || '?').trim().charAt(0).toUpperCase();
  const titleAttr = isBlocked
    ? `🔒 Nick riêng tư của ${nick.owner?.fullName || 'người khác'} — không thể dùng`
    : isLocked
      ? '🔒 Nick riêng tư của bạn — click để mở khóa PIN'
      : (nick.displayName || '');

  return h('button', {
    class: classes.join(' '),
    type: 'button',
    title: titleAttr,
    disabled: busy || isBlocked,
    onClick: rawProps.onClick,
  }, [
    h('span', { class: 'npp-pill-avatar' }, [
      nick.avatarUrl
        ? h('img', { src: nick.avatarUrl, alt: nick.displayName || '', referrerpolicy: 'no-referrer' })
        : h('span', initials),
    ]),
    h('span', { class: 'npp-pill-body' }, [
      h('span', { class: 'npp-pill-name' }, nick.displayName || '(không tên)'),
      nick.owner?.fullName && !nick.isOwnedByMe
        ? h('span', { class: 'npp-pill-owner' }, `👤 ${nick.owner.fullName}`)
        : null,
    ]),
    isLocked ? h('span', { class: 'npp-pill-lock' }, '🔒') : null,
  ]);
};
</script>

<style scoped>
.npp-dropdown {
  z-index: 11000; /* trên panel lead (9999) + modal note (10000) để không bị che */
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18), 0 4px 8px rgba(15, 23, 42, 0.08);
  max-height: 400px;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.npp-arrow {
  position: absolute;
  width: 14px; height: 14px;
  background: #ffffff;
  border-left: 1px solid #d1d5db;
  border-top: 1px solid #d1d5db;
  transform: rotate(45deg);
}
.npp-placement-bottom .npp-arrow { top: -8px; }
.npp-placement-top .npp-arrow {
  bottom: -8px;
  transform: rotate(225deg);
}

.npp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  background: #ffffff;
  position: relative;
  z-index: 1;
}
.npp-title {
  font-size: 13px;
  font-weight: 600;
  color: #181d26;
}
.npp-close {
  background: transparent;
  border: none;
  font-size: 15px;
  color: #41454d;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}
.npp-close:hover { background: #f8fafc; color: #181d26; }

.npp-search-wrap { padding: 8px 14px 4px; flex-shrink: 0; }
.npp-search {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12.5px;
  font-family: inherit;
  color: #181d26;
  background: #f8fafc;
}
.npp-search:focus {
  outline: none;
  border-color: #181d26;
  background: #ffffff;
}

.npp-body {
  padding: 6px 14px 10px;
  overflow-y: auto;
  flex: 1 1 auto;
}
.npp-empty {
  padding: 20px 12px;
  text-align: center;
  color: #41454d;
  font-size: 12.5px;
}

.npp-section { margin-bottom: 10px; }
.npp-section:last-child { margin-bottom: 0; }
.npp-row-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #41454d;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.npp-count {
  font-size: 10.5px;
  font-weight: 500;
  color: #41454d;
  opacity: 0.7;
  text-transform: none;
}

.npp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
@media (min-width: 1366px) { .npp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

:deep(.npp-pill) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  background: #ffffff;
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  color: #181d26;
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
  position: relative;
  min-width: 0;
}
:deep(.npp-pill:hover:not(:disabled)) {
  background: #f8fafc;
  border-color: #181d26;
}
:deep(.npp-pill:disabled) { cursor: not-allowed; opacity: 0.55; }

:deep(.npp-pill.locked) {
  background: #fffbeb;
  border-color: #f4d35e;
}
:deep(.npp-pill.locked:hover:not(:disabled)) {
  background: #fef3c7;
  border-color: #d97706;
}
:deep(.npp-pill.blocked) {
  background: #f8fafc;
  border-color: #e5e7eb;
  cursor: not-allowed;
  opacity: 0.6;
}

:deep(.npp-pill-avatar) {
  width: 28px; height: 28px;
  border-radius: 50%;
  overflow: hidden;
  background: #e0e2e6;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #181d26;
  font-weight: 600;
  font-size: 12px;
}
:deep(.npp-pill-avatar img) { width: 100%; height: 100%; object-fit: cover; }

:deep(.npp-pill-body) {
  display: flex; flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
:deep(.npp-pill-name) {
  font-size: 12.5px;
  font-weight: 500;
  color: #181d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
:deep(.npp-pill-owner) {
  font-size: 10.5px;
  color: #41454d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
:deep(.npp-pill-lock) {
  flex-shrink: 0;
  font-size: 12px;
  margin-left: 2px;
}

.npp-hint {
  padding: 8px 14px;
  border-top: 1px solid #e5e7eb;
  background: #f8fafc;
  font-size: 10.5px;
  color: #41454d;
  line-height: 1.4;
  flex-shrink: 0;
}
</style>
