<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="shm-backdrop" @click.self="closeModal">
      <div class="shm-modal">
        <header class="shm-head">
          <div class="shm-title">
            ✨ Nhắn <strong>{{ targetName || 'đồng nghiệp' }}</strong> phối hợp chăm KH
          </div>
          <button class="shm-x" title="Đóng" @click="closeModal">×</button>
        </header>

        <div class="shm-body">
          <div class="shm-meta">
            <span class="shm-meta-pill">KH: <strong>{{ contactName || '—' }}</strong></span>
            <span class="shm-meta-pill arrow">→</span>
            <span class="shm-meta-pill from">
              Từ nick: <strong>{{ senderNickName || '...' }}</strong>
            </span>
            <span class="shm-meta-pill ok">
              gửi tới: <strong>{{ targetZaloAccountName || targetName }}</strong>
            </span>
          </div>

          <!-- Loading state khi đang soạn / đang gửi -->
          <div v-if="loading" class="shm-loading">
            <div class="shm-spinner" />
            <span>Đang soạn tin nhắn phối hợp...</span>
          </div>

          <template v-else>
            <textarea
              v-model="draft"
              class="shm-textarea"
              rows="6"
              placeholder="Tin nhắn nội bộ giữa 2 sale (tối đa 500 ký tự)"
              maxlength="500"
              :disabled="sending"
            />
            <div class="shm-footer-meta">
              <span :class="['shm-source', source === 'ai' ? 'ai' : 'template']">
                {{ source === 'ai' ? '✨ AI sinh' : '📋 Mẫu chuẩn' }}
              </span>
              <span class="shm-charcount">{{ draft.length }}/500</span>
              <button class="shm-regen" :disabled="regenerating || sending" @click="onRegenerate">
                ↻ Soạn lại
              </button>
            </div>
          </template>
        </div>

        <footer class="shm-foot">
          <button class="shm-btn-ghost" :disabled="sending" @click="closeModal">Hủy</button>
          <button
            class="shm-btn-primary"
            :disabled="!draft.trim() || loading || sending || !targetUserId || !senderZaloAccountId"
            @click="onSend"
          >
            <span v-if="sending">⏳ Đang gửi...</span>
            <span v-else>📤 Gửi tới {{ targetName || 'sale' }}</span>
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';

const props = defineProps<{
  modelValue: boolean;
  contactName: string | null;
  targetName: string | null;
  /** User ID của sale target — BE sẽ tự lookup nick của target qua targetUserId */
  targetUserId: string | null;
  targetZaloAccountName: string | null;
  /** Nick của sale ĐANG online — gửi tin từ nick này */
  senderZaloAccountId: string | null;
  /** Tên nick sender để hiển thị "Từ nick: X" */
  senderNickName: string | null;
  initialContent: string;
  source: 'template' | 'ai' | 'fallback';
  loading: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  regenerate: [];
  sent: [];
}>();

const toast = useToast();
const draft = ref('');
const regenerating = ref(false);
const sending = ref(false);

watch(() => props.initialContent, (v) => {
  draft.value = v;
}, { immediate: true });

watch(() => props.loading, (v) => {
  if (!v) regenerating.value = false;
});

function closeModal() {
  if (sending.value) return;
  emit('update:modelValue', false);
}

function onRegenerate() {
  regenerating.value = true;
  emit('regenerate');
}

async function onSend() {
  const text = draft.value.trim();
  if (!text || !props.senderZaloAccountId || !props.targetUserId) return;
  sending.value = true;
  try {
    await api.post('/chat/send-handoff', {
      senderZaloAccountId: props.senderZaloAccountId,
      targetUserId: props.targetUserId,
      content: text,
    });
    toast.success(`Đã gửi tin tới ${props.targetName || props.targetZaloAccountName || 'sale'}`);
    emit('sent');
    emit('update:modelValue', false);
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Gửi tin thất bại';
    toast.error(msg);
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.shm-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: shm-fade 160ms ease;
}
@keyframes shm-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.shm-modal {
  background: #fff;
  width: min(540px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.shm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(180deg, #fff, #f8fafc);
}
.shm-title {
  font-size: 14px;
  flex: 1;
  color: #0f172a;
}
.shm-title strong { color: #4f46e5; }
.shm-x {
  width: 28px; height: 28px;
  background: transparent;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #64748b;
  border-radius: 50%;
}
.shm-x:hover { background: #f1f5f9; }

.shm-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}
.shm-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.shm-meta-pill {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11.5px;
  color: #334155;
}
.shm-meta-pill.ok { background: #dcfce7; border-color: #bbf7d0; color: #166534; }
.shm-meta-pill.warn { background: #fef3c7; border-color: #fde68a; color: #92400e; }
.shm-meta-pill.from { background: #ede9fe; border-color: #ddd6fe; color: #5b21b6; }
.shm-meta-pill.arrow { background: transparent; border: none; padding: 3px 2px; color: #94a3b8; font-weight: 700; }

.shm-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 12px;
  color: #64748b;
  font-size: 13px;
}
.shm-spinner {
  width: 18px; height: 18px;
  border: 2px solid #e2e8f0;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: shm-spin 700ms linear infinite;
}
@keyframes shm-spin {
  to { transform: rotate(360deg); }
}

.shm-textarea {
  width: 100%;
  min-height: 130px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.45;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.shm-textarea:focus {
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
}

.shm-footer-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: #64748b;
}
.shm-source.ai { color: #6d28d9; }
.shm-source.template { color: #0891b2; }
.shm-charcount { margin-left: auto; }
.shm-regen {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 11.5px;
  cursor: pointer;
}
.shm-regen:hover:not(:disabled) { background: #f1f5f9; }
.shm-regen:disabled { opacity: 0.5; cursor: wait; }

.shm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #e5e7eb;
  background: #f8fafc;
}
.shm-btn-ghost {
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  color: #475569;
}
.shm-btn-ghost:hover { background: #f1f5f9; }
.shm-btn-primary {
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 16px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 600;
}
.shm-btn-primary:hover:not(:disabled) { background: #4338ca; }
.shm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
