<template>
  <div v-if="modelValue" class="modal-overlay" @click.self="$emit('update:modelValue', false)">
    <div class="modal">
      <div class="modal-head">
        <h3>📥 Tạo tệp khách hàng mới</h3>
        <button class="x" @click="$emit('update:modelValue', false)">✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Tên tệp</label>
          <input v-model="name" placeholder="VD: Lead Vinhomes Grand Park — Tháng 5" />
          <div class="hint">Để trống → auto đặt "Tệp {{ defaultName }}"</div>
        </div>

        <div class="field">
          <label>Icon</label>
          <div class="icon-picker">
            <button
              v-for="ic in ICON_CHOICES"
              :key="ic"
              type="button"
              class="icon-btn"
              :class="{ active: iconEmoji === ic }"
              @click="iconEmoji = ic"
            >{{ ic }}</button>
          </div>
        </div>

        <div class="field">
          <label>Danh sách SĐT (mỗi dòng 1 SĐT, có thể kèm tên)</label>
          <textarea
            v-model="rawText"
            placeholder="0908 123 456&#10;0987-654-321 Nguyễn Văn A&#10;+84.938.111.222&#10;0913 445 566   Chị Lan VinGroup&#10;0976 333 444"
            @input="onRawTextInput"
          ></textarea>
          <div class="hint">Hệ thống tự nhận diện SĐT đúng/sai format, dedup, lookup Zalo background.</div>
        </div>

        <div v-if="dryRunResult" class="parse-preview">
          <div class="pp-row">
            <span class="ico">📋</span> Đã nhận diện <b>{{ dryRunResult.total }} dòng</b>
          </div>
          <div class="pp-row" style="color:#047857">
            <span class="ico">✓</span> <b>{{ dryRunResult.valid }} SĐT</b> hợp lệ
          </div>
          <div v-if="dryRunResult.invalid > 0" class="pp-row" style="color:#B91C1C">
            <span class="ico">✗</span> <b>{{ dryRunResult.invalid }} dòng</b> bỏ qua (sai format)
          </div>
          <div v-if="dryRunResult.dupInList > 0" class="pp-row" style="color:#B45309">
            <span class="ico">↺</span> <b>{{ dryRunResult.dupInList }} SĐT</b> trùng trong cùng danh sách paste
          </div>
          <div v-if="dryRunResult.dupCrossList > 0" class="pp-row" style="color:#B45309">
            <span class="ico">↔</span> <b>{{ dryRunResult.dupCrossList }} SĐT</b> trùng với tệp khác trong tổ chức
          </div>
          <div v-if="dryRunResult.dupWithCrm > 0" class="pp-row" style="color:#B45309">
            <span class="ico">⚷</span> <b>{{ dryRunResult.dupWithCrm }} SĐT</b> trùng với Contact hiện có trong CRM
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <span class="left">Sau khi tạo, hệ thống async lookup UID Zalo qua zalo-pool (không chặn UI).</span>
        <div class="right">
          <button class="btn ghost" @click="$emit('update:modelValue', false)">Huỷ</button>
          <button
            class="btn primary"
            :disabled="!rawText.trim() || submitting"
            @click="onSubmit"
          >{{ submitting ? 'Đang tạo...' : 'Tạo tệp' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useCustomerLists, type DryRunResult } from '@/composables/use-customer-lists';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'created', payload: { id: string }): void;
}>();

const { dryRun, createList } = useCustomerLists();

const name = ref('');
const iconEmoji = ref<string | null>(null);
const rawText = ref('');
const submitting = ref(false);
const dryRunResult = ref<DryRunResult | null>(null);

const ICON_CHOICES = ['🏢', '📣', '❄️', '🌊', '📋', '🎪', '📱', '🎵', '🔥', '⭐'];

const defaultName = computed(() => {
  const d = new Date();
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
});

// Debounced dry-run
let dryRunTimer: ReturnType<typeof setTimeout> | null = null;
function onRawTextInput() {
  if (dryRunTimer) clearTimeout(dryRunTimer);
  if (!rawText.value.trim()) {
    dryRunResult.value = null;
    return;
  }
  dryRunTimer = setTimeout(async () => {
    dryRunResult.value = await dryRun(rawText.value);
  }, 400);
}

async function onSubmit() {
  if (!rawText.value.trim()) return;
  submitting.value = true;
  try {
    const result = await createList({
      name: name.value.trim() || undefined,
      iconEmoji: iconEmoji.value ?? undefined,
      sourceType: 'paste',
      rawText: rawText.value,
    });
    if (result?.id) {
      emit('created', { id: result.id });
      emit('update:modelValue', false);
      // Reset
      name.value = '';
      iconEmoji.value = null;
      rawText.value = '';
      dryRunResult.value = null;
    } else {
      alert('Tạo tệp thất bại — thử lại');
    }
  } finally {
    submitting.value = false;
  }
}

// Reset trên đóng modal
watch(() => props.modelValue, (v) => {
  if (!v) {
    if (dryRunTimer) clearTimeout(dryRunTimer);
  }
});
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(17,24,39,.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}
.modal {
  background: #fff;
  border-radius: 14px;
  width: 580px;
  max-width: 92vw;
  max-height: 88vh;
  box-shadow: 0 24px 60px rgba(17,24,39,.22);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.modal-head {
  padding: 16px 20px;
  border-bottom: 1px solid #E5E7EB;
  display: flex; justify-content: space-between; align-items: center;
}
.modal-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
.modal-head .x {
  background: transparent; border: none;
  color: #6B7280; font-size: 18px; cursor: pointer;
  padding: 4px 8px; border-radius: 5px;
}
.modal-head .x:hover { background: #F4F5F8; color: #111827; }
.modal-body { padding: 18px 20px; overflow-y: auto; flex: 1; }
.modal-foot {
  padding: 12px 20px;
  background: #F4F5F8;
  border-top: 1px solid #E5E7EB;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
}
.modal-foot .left { font-size: 12px; color: #6B7280; }
.modal-foot .right { display: flex; gap: 8px; }

.field { margin-bottom: 14px; }
.field label {
  display: block; font-size: 11.5px; font-weight: 600;
  color: #4B5563; text-transform: uppercase; letter-spacing: .04em;
  margin-bottom: 5px;
}
.field input, .field textarea {
  width: 100%; padding: 8px 10px;
  border: 1px solid #E5E7EB; border-radius: 7px;
  font-size: 13px; outline: none;
  font-family: inherit; background: #fff; color: #111827;
}
.field input:focus, .field textarea:focus { border-color: #6366F1; }
.field textarea {
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 12px; min-height: 140px; resize: vertical;
}
.field .hint { font-size: 11px; color: #6B7280; margin-top: 4px; }

.icon-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.icon-btn {
  width: 36px; height: 36px;
  border: 1px solid #E5E7EB; border-radius: 8px;
  background: #fff; font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #F4F5F8; }
.icon-btn.active {
  background: #EEF2FF; border-color: #6366F1;
}

.parse-preview {
  background: #F4F5F8;
  border: 1px solid #EFF1F4;
  border-radius: 8px;
  padding: 11px 13px;
  margin-top: 10px;
  font-size: 12px; color: #4B5563;
}
.parse-preview .pp-row {
  display: flex; align-items: center; gap: 8px; padding: 2px 0;
}
.parse-preview .pp-row .ico { font-size: 13px; width: 18px; }
.parse-preview .pp-row b {
  color: #111827; font-variant-numeric: tabular-nums;
}

.btn {
  padding: 7px 13px;
  background: #fff; border: 1px solid #E5E7EB; border-radius: 7px;
  color: #111827; cursor: pointer; font-size: 12.5px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  font-family: inherit;
}
.btn:hover { background: #F4F5F8; border-color: #D1D5DB; }
.btn.primary {
  background: #6366F1; border-color: #6366F1; color: white;
}
.btn.primary:hover:not(:disabled) {
  background: #4F46E5; border-color: #4F46E5;
}
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.ghost {
  background: transparent; border-color: transparent; color: #4B5563;
}
.btn.ghost:hover { background: #F4F5F8; }
</style>
