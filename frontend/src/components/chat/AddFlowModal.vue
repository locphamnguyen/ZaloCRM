<!--
═══════════════════════════════════════════════════════════════════════
 Luồng Mục Tiêu M9 — Modal "+ Gắn thêm luồng bám đuổi" (2026-06-02)
═══════════════════════════════════════════════════════════════════════

 Hiển thị khi sale bấm nút "+ Gắn thêm luồng bám đuổi" trong tab FOLLOW-UP.
 Cho phép sale enroll 1 KH ad-hoc vào "Mục tiêu hệ thống — Bám đuổi thủ công"
 với 1 sequence được chọn + nick đang chat được auto-pin.

 API endpoint (BE đã ship M9):
   POST /api/v1/chat/contacts/:cid/manual-enroll
   Body: { sequenceId, nickId, reason }

 Mockup reference: 03-v2-tab-followup-content.html (modal phần dưới)
-->

<template>
  <Teleport to="body">
    <div class="afm-overlay" @click.self="onClose">
      <div class="afm-modal" role="dialog" aria-modal="true">
        <!-- Header -->
        <div class="afm-head">
          <div class="afm-head__row">
            <h2>Bám đuổi thủ công cho {{ contactName }}</h2>
            <button class="afm-x" @click="onClose" aria-label="Đóng">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <div class="afm-sub">Chọn 1 kịch bản có sẵn để bắt đầu chăm khách này</div>
        </div>

        <!-- Body -->
        <div class="afm-body">
          <!-- Loading -->
          <div v-if="loadingSequences" class="afm-loading">
            <div class="afm-spinner" />
            <p>Đang tải danh sách luồng...</p>
          </div>

          <template v-else>
            <!-- Sequence picker -->
            <div class="afm-field">
              <label class="afm-label">Chọn luồng kịch bản <span class="afm-req">*</span></label>

              <div v-if="sequences.length === 0" class="afm-empty-seq">
                Chưa có luồng nào đang bật trong tổ chức.
                <a href="/marketing/sequences" target="_blank">Tạo luồng mới →</a>
              </div>

              <button
                v-for="seq in sequences"
                :key="seq.id"
                type="button"
                class="afm-opt"
                :class="{ sel: selectedSequenceId === seq.id }"
                @click="selectedSequenceId = seq.id"
              >
                <span class="afm-radio" />
                <span class="afm-opt-ic">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </span>
                <span class="afm-opt-info">
                  <span class="afm-opt-nm">{{ seq.name }}</span>
                  <span v-if="seq.description" class="afm-opt-ds">{{ seq.description }}</span>
                  <span class="afm-opt-steps">{{ seq.stepCount }} bước</span>
                </span>
              </button>
            </div>

            <!-- Nick auto-pin -->
            <div class="afm-field">
              <label class="afm-label">Nick gửi (theo cuộc chat hiện tại)</label>
              <div class="afm-nick">
                <span class="afm-nick-ic">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                </span>
                <span class="afm-nick-nm">{{ nickName || 'Chưa chọn nick' }}</span>
              </div>
            </div>

            <!-- Reason -->
            <div class="afm-field">
              <label class="afm-label">Lý do bám đuổi <span class="afm-req">*</span></label>
              <textarea
                v-model="reason"
                class="afm-reason"
                placeholder="VD: KH hỏi giá Emerald GV, cần chăm tiếp tới khi đặt lịch xem nhà…"
                rows="3"
              />
              <div class="afm-help">Bắt buộc nhập để quản lý audit được lý do bám đuổi thủ công.</div>
            </div>

            <!-- Error -->
            <div v-if="error" class="afm-error">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span>{{ error }}</span>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="afm-foot">
          <button class="afm-btn ghost" :disabled="submitting" @click="onClose">Hủy</button>
          <button class="afm-btn primary" :disabled="!canSubmit || submitting" @click="onSubmit">
            <svg v-if="!submitting" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" /></svg>
            {{ submitting ? 'Đang bắt đầu...' : submitButtonText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api/index';

// ── Props ──
const props = defineProps<{
  contactId: string;
  contactName: string;
  nickId: string;
  nickName: string;
}>();

const emit = defineEmits<{
  close: [];
  enrolled: [payload: { sequenceId: string; sequenceName: string }];
}>();

// ── Types ──
interface SequenceOption {
  id: string;
  name: string;
  description?: string | null;
  stepCount: number;
}

// ── State ──
const sequences = ref<SequenceOption[]>([]);
const loadingSequences = ref(true);
const selectedSequenceId = ref<string | null>(null);
const reason = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

// ── Computed ──
const canSubmit = computed(
  () => !!selectedSequenceId.value && !!props.nickId && reason.value.trim().length > 0,
);

const submitButtonText = computed(() => {
  if (!selectedSequenceId.value) return 'Chọn Sequence';
  const seq = sequences.value.find((s) => s.id === selectedSequenceId.value);
  if (!seq) return 'Bắt đầu bám đuổi';
  return `Bắt đầu bám đuổi ${seq.stepCount} bước`;
});

// ── Fetch sequences ──
async function fetchSequences(): Promise<void> {
  loadingSequences.value = true;
  try {
    const res = await api.get<{
      sequences: Array<{
        id: string;
        name: string;
        description?: string | null;
        steps: unknown[];
        enabled: boolean;
      }>;
    }>('/automation/sequences?enabled=true');

    sequences.value = (res.data.sequences ?? [])
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
      }));

    // Auto-select sequence đầu tiên
    if (sequences.value.length > 0 && !selectedSequenceId.value) {
      selectedSequenceId.value = sequences.value[0].id;
    }
  } catch (err) {
    console.error('[add-flow-modal] fetch sequences failed', err);
    error.value = 'Lỗi tải danh sách Sequence. Vui lòng thử lại.';
  } finally {
    loadingSequences.value = false;
  }
}

// ── Submit ──
async function onSubmit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return;

  submitting.value = true;
  error.value = null;

  try {
    await api.post(`/chat/contacts/${props.contactId}/manual-enroll`, {
      sequenceId: selectedSequenceId.value,
      nickId: props.nickId,
      reason: reason.value.trim(),
    });

    const seq = sequences.value.find((s) => s.id === selectedSequenceId.value);
    emit('enrolled', {
      sequenceId: selectedSequenceId.value!,
      sequenceName: seq?.name ?? '',
    });
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
    error.value = msg || 'Lỗi enroll KH vào Sequence. Vui lòng thử lại.';
    console.error('[add-flow-modal] enroll failed', err);
  } finally {
    submitting.value = false;
  }
}

// ── Close ──
function onClose(): void {
  if (submitting.value) return;
  emit('close');
}

// ── Lifecycle ──
onMounted(() => {
  void fetchSequences();
});
</script>

<style scoped>
.afm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 26, 36, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: afm-fade 0.15s ease;
}
@keyframes afm-fade { from { opacity: 0; } to { opacity: 1; } }

.afm-modal {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--sh-lg);
  animation: afm-slide 0.2s ease;
}
@keyframes afm-slide {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Head */
.afm-head {
  padding: 15px 16px 13px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.afm-head__row { display: flex; align-items: flex-start; gap: 8px; }
.afm-head h2 {
  margin: 0; flex: 1;
  font-size: 14.5px; font-weight: 600; color: var(--ink); line-height: 1.3;
}
.afm-x {
  width: 26px; height: 26px; border-radius: var(--r-sm); border: 0;
  background: transparent; color: var(--ink-4); cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; font-family: inherit;
}
.afm-x:hover { background: var(--surface-3); color: var(--ink); }
.afm-sub { font-size: 12px; color: var(--ink-3); margin-top: 3px; }

/* Body */
.afm-body { padding: 14px 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
.afm-field { display: flex; flex-direction: column; }
.afm-label { font-size: 11.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 7px; }
.afm-req { color: var(--error); }
.afm-help { font-size: 11px; color: var(--ink-3); margin-top: 5px; line-height: 1.4; }

/* Loading */
.afm-loading { text-align: center; padding: 32px; color: var(--ink-3); font-size: 12.5px; }
.afm-spinner {
  width: 24px; height: 24px; border: 2px solid var(--surface-3);
  border-top-color: var(--brand); border-radius: 50%; margin: 0 auto 12px;
  animation: afm-spin 0.8s linear infinite;
}
@keyframes afm-spin { to { transform: rotate(360deg); } }

.afm-empty-seq { text-align: center; padding: 22px 12px; color: var(--ink-3); font-size: 12px; }
.afm-empty-seq a { color: var(--brand); text-decoration: none; font-weight: 600; margin-top: 6px; display: block; }

/* Sequence option */
.afm-opt {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 11px;
  cursor: pointer; border: 1px solid var(--line); border-radius: var(--r-md);
  transition: 0.12s; margin-bottom: 7px; width: 100%; text-align: left;
  background: var(--surface); font-family: inherit;
}
.afm-opt:last-child { margin-bottom: 0; }
.afm-opt:hover { border-color: var(--brand-bright, #5bb8e5); background: var(--brand-softer); }
.afm-opt.sel { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 1px var(--brand) inset; }
.afm-radio {
  width: 17px; height: 17px; border-radius: 50%; border: 2px solid var(--ink-4);
  flex-shrink: 0; margin-top: 2px; position: relative; transition: 0.12s;
}
.afm-opt.sel .afm-radio { border-color: var(--brand); }
.afm-opt.sel .afm-radio::after { content: ""; position: absolute; inset: 2.5px; border-radius: 50%; background: var(--brand); }
.afm-opt-ic {
  width: 30px; height: 30px; border-radius: var(--r-sm); flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--success-soft); color: #0a2e0e;
}
.afm-opt-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.afm-opt-nm { font-size: 12.5px; font-weight: 600; color: var(--ink); line-height: 1.3; }
.afm-opt-ds {
  font-size: 11px; color: var(--ink-3); margin-top: 2px; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.afm-opt-steps {
  font-family: var(--mono); font-size: 10.5px; color: var(--ink-2);
  background: var(--surface-3); border-radius: var(--r-pill); padding: 1px 7px;
  margin-top: 5px; align-self: flex-start;
}

/* Nick */
.afm-nick {
  background: var(--surface-3); padding: 9px 11px; border-radius: var(--r-sm);
  display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-2);
}
.afm-nick-ic { color: var(--brand-700); display: inline-flex; flex-shrink: 0; }
.afm-nick-nm { font-weight: 600; color: var(--ink); }

/* Reason */
.afm-reason {
  width: 100%; min-height: 64px; padding: 9px 11px; border: 1px solid var(--line);
  border-radius: var(--r-sm); font-family: inherit; font-size: 12.5px; color: var(--ink);
  resize: vertical; line-height: 1.5; box-sizing: border-box;
}
.afm-reason:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.afm-reason::placeholder { color: var(--ink-4); }

/* Error */
.afm-error {
  display: flex; align-items: center; gap: 7px; padding: 9px 11px;
  background: var(--error-soft); border: 1px solid #f6c5c1; border-radius: var(--r-sm);
  font-size: 12px; color: var(--error);
}
.afm-error svg { flex-shrink: 0; }

/* Footer */
.afm-foot { padding: 12px 16px; border-top: 1px solid var(--line); display: flex; gap: 9px; flex-shrink: 0; }
.afm-btn {
  height: 38px; border-radius: var(--r-sm); font-size: 12.5px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: 0.12s; border: 1px solid var(--line);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.afm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.afm-btn.ghost { flex: 1; background: var(--surface); color: var(--ink-3); }
.afm-btn.ghost:hover:not(:disabled) { background: var(--surface-3); color: var(--ink); }
.afm-btn.primary { flex: 2; background: var(--brand); color: #fff; border-color: var(--brand); }
.afm-btn.primary:hover:not(:disabled) { background: var(--brand-600); }

svg { display: block; }
</style>
