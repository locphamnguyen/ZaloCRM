<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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
          <div class="afm-sub">
            <template v-if="step === 1">Bước 1/2 · Chọn 1 kịch bản có sẵn để bắt đầu chăm khách này</template>
            <template v-else>Bước 2/2 · Ghi chú lý do gắn luồng (để quản lý audit được)</template>
          </div>
        </div>

        <!-- Body -->
        <div class="afm-body">
          <!-- Loading -->
          <div v-if="loadingSequences" class="afm-loading">
            <div class="afm-spinner" />
            <p>Đang tải danh sách luồng...</p>
          </div>

          <template v-else>
            <!-- ══ BƯỚC 1: chọn luồng + nick ══ -->
            <template v-if="step === 1">
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
                  <span class="afm-opt-metarow">
                    <span class="afm-opt-steps">{{ seq.stepCount }} bước</span>
                    <span class="afm-opt-tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> {{ seq.estLabel }}</span>
                    <span class="afm-opt-tag">{{ seq.rulesLabel }}</span>
                  </span>
                  <span class="afm-opt-start">▸ Bắt đầu ngay khi KH được gắn vào luồng</span>
                </span>
                <button type="button" class="afm-preview-btn" title="Xem trước tin nhắn sẽ gửi" @click="openPreview(seq, $event)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  Xem trước
                </button>
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

            </template>

            <!-- ══ BƯỚC 2: popup ghi chú lý do (next-step) ══ -->
            <template v-else>
              <!-- recap luồng + nick đã chọn ở bước 1 -->
              <div class="afm-recap">
                <span class="afm-recap-ic">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </span>
                <div class="afm-recap-info">
                  <div class="afm-recap-nm">{{ selectedSeqName }}</div>
                  <div class="afm-recap-meta">{{ selectedSeqMeta }}<template v-if="nickName"> · Nick {{ nickName }}</template></div>
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
            </template>

            <!-- Error -->
            <div v-if="error" class="afm-error">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span>{{ error }}</span>
            </div>
          </template>
        </div>

        <!-- Footer — bước 1: Hủy / Tiếp tục · bước 2: Quay lại / Xác nhận -->
        <div class="afm-foot">
          <template v-if="step === 1">
            <button class="afm-btn ghost" @click="onClose">Hủy</button>
            <button class="afm-btn primary" :disabled="!canNext" @click="goNext">
              {{ canNext ? 'Tiếp tục' : 'Chọn luồng' }}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </template>
          <template v-else>
            <button class="afm-btn ghost" :disabled="submitting" @click="step = 1">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              Quay lại
            </button>
            <button class="afm-btn primary" :disabled="!canSubmit || submitting" @click="onSubmit">
              <svg v-if="!submitting" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" /></svg>
              {{ submitting ? 'Đang bắt đầu...' : 'Xác nhận bắt đầu bám đuổi' }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Xem trước tin nhắn luồng (2026-06-18) — dùng KH đang chat -->
    <SequencePreviewDialog
      v-if="previewSeq"
      :visible="!!previewSeq"
      :sequence-id="previewSeq.id"
      :sequence-name="previewSeq.name"
      :initial-contacts="[{ id: contactId, name: contactName }]"
      :nick-id="nickId"
      @close="previewSeq = null"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api/index';
import SequencePreviewDialog from './SequencePreviewDialog.vue';

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
  estLabel: string;   // dự kiến hoàn thành (≈)
  rulesLabel: string; // giờ gửi + giãn cách
}

// ── Xem trước (2026-06-18): mở SequencePreviewDialog cho luồng + KH đang chat ──
const previewSeq = ref<{ id: string; name: string } | null>(null);
function openPreview(seq: SequenceOption, ev: Event): void {
  ev.stopPropagation(); // không chọn radio khi bấm Xem trước
  previewSeq.value = { id: seq.id, name: seq.name };
}

// ── Tính "dự kiến hoàn thành" (≈, bỏ qua né-ngoài-giờ) + "luật" từ runtimeRules ──
function avgGapMinutes(rules: any): number {
  const g = rules?.sendGap;
  if (!g) return 0;
  const unitMin = g.unit === 'hour' ? 60 : g.unit === 'second' ? 1 / 60 : g.unit === 'day' ? 1440 : 1;
  if (typeof g.min === 'number' && typeof g.max === 'number') return ((g.min + g.max) / 2) * unitMin;
  if (typeof g.value === 'number') return g.value * unitMin;
  return 0;
}
function estLabelOf(steps: any[], rules: any): string {
  if (!Array.isArray(steps) || steps.length <= 1) return 'ngay (1 bước)';
  const gap = avgGapMinutes(rules);
  let totalMin = 0;
  for (let i = 1; i < steps.length; i++) totalMin += gap > 0 ? gap : (steps[i]?.delayMinutes ?? 0);
  if (totalMin <= 0) return 'vài phút';
  if (totalMin < 60) return `≈ ${Math.round(totalMin)} phút`;
  if (totalMin < 1440) return `≈ ${(totalMin / 60).toFixed(1)} giờ`;
  return `≈ ${(totalMin / 1440).toFixed(1)} ngày`;
}
function rulesLabelOf(rules: any): string {
  const parts: string[] = [];
  const tr = rules?.allowedTimeRange;
  const hr = rules?.allowedHourRange;
  if (Array.isArray(tr) && tr.length === 2) parts.push(`Giờ gửi ${tr[0]}–${tr[1]}`);
  else if (Array.isArray(hr) && hr.length === 2) parts.push(`Giờ gửi ${hr[0]}h–${hr[1]}h`);
  const g = rules?.sendGap;
  if (g) {
    const unit = g.unit === 'hour' ? 'giờ' : g.unit === 'second' ? 'giây' : 'phút';
    if (typeof g.min === 'number' && typeof g.max === 'number' && g.min !== g.max) parts.push(`giãn ${g.min}–${g.max} ${unit}`);
    else if (g.value != null) parts.push(`giãn ${g.value} ${unit}`);
  }
  return parts.join(' · ') || 'mặc định';
}

// ── State ──
const sequences = ref<SequenceOption[]>([]);
const loadingSequences = ref(true);
const selectedSequenceId = ref<string | null>(null);
const reason = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

// ── 2 bước (anh chốt 2026-06-18: ghi chú lý do là NEXT-STEP, không nằm cùng màn phải cuộn) ──
//   bước 1 = chọn luồng + nick · bước 2 = popup nhập ghi chú → Xác nhận / Quay lại.
const step = ref<1 | 2>(1);
const canNext = computed(() => !!selectedSequenceId.value && !!props.nickId);
function goNext(): void {
  if (!canNext.value) return;
  error.value = null;
  step.value = 2;
}
const selectedSeq = computed(() => sequences.value.find((s) => s.id === selectedSequenceId.value) ?? null);
const selectedSeqName = computed(() => selectedSeq.value?.name ?? 'Luồng đã chọn');
const selectedSeqMeta = computed(() =>
  selectedSeq.value ? `${selectedSeq.value.stepCount} bước · ${selectedSeq.value.estLabel}` : '',
);

// ── Computed ──
const canSubmit = computed(
  () => !!selectedSequenceId.value && !!props.nickId && reason.value.trim().length > 0,
);

// ── Fetch sequences ──
async function fetchSequences(): Promise<void> {
  loadingSequences.value = true;
  try {
    const res = await api.get<{
      sequences: Array<{
        id: string;
        name: string;
        description?: string | null;
        steps: any[];
        runtimeRules?: any;
        enabled: boolean;
      }>;
    }>('/automation/sequences?enabled=true');

    sequences.value = (res.data.sequences ?? [])
      .filter((s) => s.enabled)
      .map((s) => {
        const steps = Array.isArray(s.steps) ? s.steps : [];
        return {
          id: s.id,
          name: s.name,
          description: s.description,
          stepCount: steps.length,
          estLabel: estLabelOf(steps, s.runtimeRules),
          rulesLabel: rulesLabelOf(s.runtimeRules),
        };
      });

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
    // Ưu tiên `detail` (thông báo đầy đủ tiếng Việt, vd cooldown có tên luồng + đếm
    // ngược); fallback `error` (mã lỗi) nếu route không trả detail.
    const data = (err as { response?: { data?: { error?: string; detail?: string } } }).response?.data;
    error.value = data?.detail || data?.error || 'Lỗi gắn khách vào luồng. Vui lòng thử lại.';
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
.afm-opt-metarow { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; align-items: center; }
.afm-opt-steps {
  font-family: var(--mono); font-size: 10.5px; color: var(--ink-2);
  background: var(--surface-3); border-radius: var(--r-pill); padding: 1px 7px;
}
.afm-opt-tag {
  display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; color: var(--ink-2);
  background: var(--surface-3); border-radius: var(--r-pill); padding: 1px 7px;
}
.afm-opt-tag svg { display: block; }
.afm-opt-start { font-size: 10.5px; color: #157f3c; margin-top: 5px; }
.afm-preview-btn {
  flex-shrink: 0; align-self: center; display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--brand, #1786be); background: var(--surface); color: var(--brand, #1786be);
  border-radius: var(--r-sm); padding: 4px 9px; font-size: 11px; font-weight: 600; cursor: pointer;
  font-family: inherit;
}
.afm-preview-btn:hover { background: var(--brand-soft, #e7f3fb); }
.afm-preview-btn svg { display: block; }

/* Nick */
.afm-nick {
  background: var(--surface-3); padding: 9px 11px; border-radius: var(--r-sm);
  display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-2);
}
.afm-nick-ic { color: var(--brand-700); display: inline-flex; flex-shrink: 0; }
.afm-nick-nm { font-weight: 600; color: var(--ink); }

/* Recap luồng đã chọn (bước 2) */
.afm-recap {
  display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
  background: var(--brand-soft); border-radius: var(--r-sm); padding: 10px 12px;
}
.afm-recap-ic {
  width: 30px; height: 30px; flex: 0 0 30px; border-radius: 8px; background: var(--surface);
  color: var(--brand); display: inline-flex; align-items: center; justify-content: center;
}
.afm-recap-info { min-width: 0; }
.afm-recap-nm { font-size: 13px; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.afm-recap-meta { font-size: 11.5px; color: var(--ink-3); margin-top: 1px; }

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
