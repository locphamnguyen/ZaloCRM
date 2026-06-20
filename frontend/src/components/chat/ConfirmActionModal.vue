<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
═══════════════════════════════════════════════════════════════════════
 ConfirmActionModal — hộp xác nhận đẹp (thay window.confirm/prompt) 2026-06-15
═══════════════════════════════════════════════════════════════════════
 Anh báo: nút Tạm dừng / Dừng hẳn dùng window.confirm/prompt của Chrome XẤU.
 Modal này clone pattern AddFlowModal.vue (Teleport + overlay + design tokens)
 để đồng nhất với panel bám đuổi.

 Dùng 2 chế độ:
   • Xác nhận đơn (Tạm dừng): tiêu đề + mô tả + 2 nút.
   • Có ô nhập lý do (Dừng hẳn): thêm requireReason=true → textarea bắt buộc.

 Props điều khiển từ parent (v-model:open). Emit 'confirm' (kèm reason nếu có)
 hoặc 'cancel'. Parent tự gọi API trong handler 'confirm'.
-->
<template>
  <Teleport to="body">
    <div v-if="open" class="cam-overlay" @click.self="onCancel">
      <div class="cam-modal" role="dialog" aria-modal="true">
        <!-- Head -->
        <div class="cam-head">
          <span class="cam-ic" :class="tone">
            <svg v-if="tone === 'danger'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          </span>
          <div class="cam-head__tx">
            <h2>{{ title }}</h2>
            <p v-if="message" class="cam-sub">{{ message }}</p>
          </div>
          <button class="cam-x" aria-label="Đóng" @click="onCancel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <!-- Body: ô lý do (chỉ khi requireReason) -->
        <div v-if="requireReason" class="cam-body">
          <label class="cam-label">{{ reasonLabel }} <span class="cam-req">*</span></label>
          <textarea
            ref="reasonEl"
            v-model="reason"
            class="cam-textarea"
            :placeholder="reasonPlaceholder"
            rows="3"
            @keydown.enter.exact.prevent="onConfirm"
          />
          <p v-if="showError" class="cam-err">Vui lòng nhập lý do trước khi dừng.</p>
        </div>

        <!-- Foot -->
        <div class="cam-foot">
          <button class="cam-btn cam-btn--ghost" :disabled="busy" @click="onCancel">{{ cancelText }}</button>
          <button
            class="cam-btn"
            :class="tone === 'danger' ? 'cam-btn--danger' : 'cam-btn--primary'"
            :disabled="busy"
            @click="onConfirm"
          >
            <span v-if="busy" class="cam-spin" />
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  message?: string;
  tone?: 'primary' | 'danger';
  confirmText?: string;
  cancelText?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  busy?: boolean;
}>(), {
  message: '',
  tone: 'primary',
  confirmText: 'Xác nhận',
  cancelText: 'Hủy',
  requireReason: false,
  reasonLabel: 'Lý do',
  reasonPlaceholder: 'Nhập lý do...',
  busy: false,
});

const emit = defineEmits<{
  'update:open': [value: boolean];
  confirm: [reason: string];
  cancel: [];
}>();

const reason = ref('');
const showError = ref(false);
const reasonEl = ref<HTMLTextAreaElement | null>(null);

// Mở modal → reset + focus ô lý do.
watch(() => props.open, (v) => {
  if (v) {
    reason.value = '';
    showError.value = false;
    if (props.requireReason) {
      void nextTick(() => reasonEl.value?.focus());
    }
  }
});

function onConfirm(): void {
  if (props.busy) return;
  if (props.requireReason && !reason.value.trim()) {
    showError.value = true;
    return;
  }
  emit('confirm', reason.value.trim());
}

function onCancel(): void {
  if (props.busy) return;
  emit('cancel');
  emit('update:open', false);
}
</script>

<style scoped>
.cam-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 26, 36, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  animation: cam-fade 0.15s ease;
}
@keyframes cam-fade { from { opacity: 0; } to { opacity: 1; } }

.cam-modal {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  width: 400px;
  max-width: calc(100vw - 32px);
  box-shadow: var(--sh-lg);
  animation: cam-slide 0.2s ease;
  display: flex;
  flex-direction: column;
}
@keyframes cam-slide {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Head */
.cam-head { display: flex; align-items: flex-start; gap: 11px; padding: 16px 16px 12px; }
.cam-ic {
  width: 34px; height: 34px; border-radius: var(--r-sm); flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.cam-ic.primary { background: var(--warning-soft, #fef3c7); color: var(--warning, #b45309); }
.cam-ic.danger { background: var(--error-soft, #fee2e2); color: var(--error, #dc2626); }
.cam-head__tx { flex: 1; min-width: 0; }
.cam-head h2 { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--ink); line-height: 1.35; }
.cam-sub { font-size: 12.5px; color: var(--ink-3); margin-top: 4px; line-height: 1.45; }
.cam-x {
  width: 26px; height: 26px; border-radius: var(--r-sm); border: 0; flex-shrink: 0;
  background: transparent; color: var(--ink-4); cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
}
.cam-x:hover { background: var(--surface-3); color: var(--ink); }

/* Body */
.cam-body { padding: 2px 16px 4px; display: flex; flex-direction: column; }
.cam-label { font-size: 11.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.cam-req { color: var(--error); }
.cam-textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink);
  resize: vertical;
  background: var(--surface);
  transition: border-color 0.12s;
}
.cam-textarea:focus { outline: none; border-color: var(--brand); }
.cam-err { font-size: 11px; color: var(--error); margin-top: 5px; }

/* Foot */
.cam-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 16px 16px; }
.cam-btn {
  height: 36px; padding: 0 16px; border-radius: var(--r-sm);
  font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  border: 1px solid transparent; transition: 0.12s;
}
.cam-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.cam-btn--ghost { background: var(--surface); border-color: var(--line); color: var(--ink-2); }
.cam-btn--ghost:hover:not(:disabled) { background: var(--surface-3); }
.cam-btn--primary { background: var(--brand); color: #fff; }
.cam-btn--primary:hover:not(:disabled) { background: var(--brand-600); }
.cam-btn--danger { background: var(--error, #dc2626); color: #fff; }
.cam-btn--danger:hover:not(:disabled) { background: #b91c1c; }

.cam-spin {
  width: 13px; height: 13px; border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff; border-radius: 50%; animation: cam-spin 0.7s linear infinite;
}
@keyframes cam-spin { to { transform: rotate(360deg); } }

svg { display: block; }
</style>
