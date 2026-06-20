<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  OnboardingChecklist — Phase Onboarding v1 2026-05-24 (redesign 2026-05-24).

  Clean Linear-inspired design. Single card thay cho 2 element trước (banner + checklist).
  Progress ring 56px thay progress bar. Calm blue accent thay yellow warning.

  Spec: docs/DESIGN-ONBOARDING-V1.md
  Mockup: docs/designs/dashboard-onboarding-redesign-20260524.html
-->
<template>
  <div v-if="visible" class="ob-card" :class="{ 'is-complete': state.percent === 100 }">
    <!-- ─── Header: Progress ring + Greeting + Dismiss ─── -->
    <header class="ob-header">
      <div class="ob-progress" role="progressbar" :aria-valuenow="state.percent" aria-valuemin="0" aria-valuemax="100">
        <svg viewBox="0 0 56 56">
          <circle class="ob-progress-track" cx="28" cy="28" r="24" />
          <circle
            class="ob-progress-fill"
            cx="28" cy="28" r="24"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
          />
        </svg>
        <span class="ob-progress-label">{{ state.completedCount }}/{{ state.totalCount }}</span>
      </div>

      <div class="ob-headline">
        <h2 class="ob-greeting">
          <template v-if="state.percent === 100">
            🎉 <strong>Setup hoàn tất!</strong> CRM sẵn sàng dùng.
          </template>
          <template v-else-if="state.completedCount === state.totalCount - 1">
            <strong>Gần xong rồi!</strong> Chỉ còn 1 bước cuối.
          </template>
          <template v-else>
            Chào <strong>{{ greetingName }}</strong>, còn {{ remainingCount }} bước nữa thôi.
          </template>
        </h2>
        <p class="ob-sub">{{ subText }}</p>
      </div>

      <button
        v-if="state.canDismiss && state.percent < 100"
        class="ob-dismiss"
        aria-label="Ẩn checklist"
        :disabled="dismissing"
        @click="onDismiss"
      >
        Ẩn
      </button>
    </header>

    <!-- ─── Steps list ─── -->
    <ul class="ob-steps">
      <li
        v-for="(step, idx) in state.steps"
        :key="step.step"
        class="ob-step"
        :class="{
          'is-done': step.completed && !step.skipped,
          'is-skipped': step.skipped,
          'is-pending': !step.completed && step.step === firstPendingStep,
          'is-optional': step.step === 'pin',
        }"
      >
        <div class="ob-marker" aria-hidden="true">
          <template v-if="step.completed && !step.skipped">✓</template>
          <template v-else-if="step.skipped">⊘</template>
          <template v-else>{{ idx + 1 }}</template>
        </div>
        <div class="ob-body">
          <h3 class="ob-title">
            {{ stepTitle(step.step) }}
            <span v-if="step.step === 'pin' && !step.completed" class="ob-tag">Tuỳ chọn</span>
            <span v-if="step.skipped" class="ob-tag">Đã bỏ qua</span>
          </h3>
          <p class="ob-detail">{{ step.detail }}</p>
        </div>
        <div class="ob-action">
          <template v-if="step.completed && !step.skipped">
            <span class="ob-done-label">Hoàn tất</span>
          </template>
          <template v-else-if="step.skipped">
            <span class="ob-skipped-label">Đã bỏ qua</span>
          </template>
          <template v-else>
            <button
              v-if="step.step === 'pin'"
              class="ob-btn-ghost"
              :disabled="skippingPin"
              @click="onSkipPin"
            >Bỏ qua</button>
            <button class="ob-btn" @click="onGoStep(step.step)">
              {{ ctaLabel(step.step) }}
            </button>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

interface StepStatus {
  // 2026-06-09 (Anh chốt): gỡ 'internal_contact' — onboarding còn 3 bước.
  step: 'change_password' | 'connect_nick' | 'pin';
  completed: boolean;
  completedAt: string | null;
  skipped: boolean;
  detail?: string;
}
interface OnboardingState {
  steps: StepStatus[];
  completedCount: number;
  totalCount: number;
  percent: number;
  dismissed: boolean;
  dismissedAt: string | null;
  canDismiss: boolean;
}

const router = useRouter();
const auth = useAuthStore();
const state = ref<OnboardingState>({
  steps: [],
  completedCount: 0,
  totalCount: 4,
  percent: 0,
  dismissed: false,
  dismissedAt: null,
  canDismiss: false,
});
const skippingPin = ref(false);
const dismissing = ref(false);
const loaded = ref(false);

// Progress ring math — r=24 → circumference = 2πr ≈ 150.8
const circumference = 2 * Math.PI * 24;
const dashOffset = computed(() => circumference * (1 - state.value.percent / 100));

const visible = computed(() => {
  if (!loaded.value) return false;
  if (state.value.totalCount === 0) return false;
  if (state.value.percent === 100) return false; // Mini indicator handle
  if (state.value.dismissed) return false;
  return true;
});

const greetingName = computed(() => {
  const full = auth.user?.fullName || '';
  const parts = full.trim().split(/\s+/);
  // Lấy first name (chữ cuối trong tên tiếng Việt) — vd "Nguyễn Văn Đức" → "Đức"
  return parts[parts.length - 1] || 'bạn';
});

const remainingCount = computed(() => state.value.totalCount - state.value.completedCount);

const subText = computed(() => {
  if (state.value.percent === 100) {
    return 'Checklist sẽ tự ẩn. Bạn có thể xem lại ở góc phải dưới bất cứ lúc nào.';
  }
  if (state.value.completedCount === state.value.totalCount - 1) {
    const last = state.value.steps.find((s) => !s.completed);
    if (last?.step === 'pin') return 'Đặt PIN bảo mật là tuỳ chọn — bạn có thể bỏ qua nếu không cần.';
  }
  return 'Hoàn tất để nhận thông báo khách hàng, lịch hẹn, daily KPI tự động vào Zalo.';
});

const firstPendingStep = computed(() => {
  const pending = state.value.steps.find((s) => !s.completed && !s.skipped);
  return pending?.step;
});

function stepTitle(step: string): string {
  return ({
    change_password: 'Đổi mật khẩu',
    connect_nick: 'Kết nối nick Zalo',
    pin: 'Đặt PIN bảo mật',
  } as Record<string, string>)[step] || step;
}

function ctaLabel(step: string): string {
  return ({
    connect_nick: 'Kết nối ngay',
    pin: 'Setup',
  } as Record<string, string>)[step] || 'Thiết lập';
}

async function fetchState() {
  try {
    const { data } = await api.get('/me/onboarding');
    state.value = data;
  } catch (err) {
    console.warn('[onboarding-checklist] fetch failed:', err);
  } finally {
    loaded.value = true;
  }
}

function onGoStep(step: string) {
  if (step === 'change_password') return;
  if (step === 'connect_nick') {
    router.push('/settings/channels/zalo');
    return;
  }
  if (step === 'pin') {
    router.push('/settings/privacy');
    return;
  }
}

async function onSkipPin() {
  skippingPin.value = true;
  try {
    await api.post('/me/onboarding/skip-step', { step: 'pin' });
    await fetchState();
  } finally {
    skippingPin.value = false;
  }
}

async function onDismiss() {
  dismissing.value = true;
  try {
    await api.post('/me/onboarding/dismiss');
    state.value.dismissed = true;
  } finally {
    dismissing.value = false;
  }
}

onMounted(fetchState);

defineExpose({ fetchState });
</script>

<style scoped>
/* Calm palette — không còn warning yellow */
.ob-card {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.03);
  overflow: hidden;
  margin-bottom: 24px;
}

/* ─── Header ─── */
.ob-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  border-bottom: 1px solid #E5E7EB;
}

.ob-progress {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  position: relative;
}
.ob-progress svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}
.ob-progress-track {
  fill: none;
  stroke: #E5E7EB;
  stroke-width: 5;
}
.ob-progress-fill {
  fill: none;
  stroke: #5E6AD2;
  stroke-width: 5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.6s ease;
}
.ob-progress-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  color: #0F172A;
}

.ob-headline {
  flex: 1;
  min-width: 0;
}
.ob-greeting {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
  line-height: 1.4;
}
.ob-greeting strong { color: #5E6AD2; font-weight: 700; }
.ob-sub {
  margin: 3px 0 0;
  font-size: 13px;
  color: #475569;
}

.ob-dismiss {
  background: transparent;
  border: none;
  color: #94A3B8;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.ob-dismiss:hover:not(:disabled) { background: #F1F5F9; color: #475569; }
.ob-dismiss:disabled { opacity: 0.4; cursor: not-allowed; }

/* ─── Steps ─── */
.ob-steps {
  list-style: none;
  padding: 6px 0;
  margin: 0;
}
.ob-step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  border-left: 3px solid transparent;
  transition: background 0.15s;
}
.ob-step + .ob-step { border-top: 1px solid #E5E7EB; }
.ob-step:hover { background: #FAFBFC; }
.ob-step.is-done { background: #FAFBFC; }
.ob-step.is-pending { border-left-color: #5E6AD2; }
.ob-step.is-skipped { opacity: 0.65; }

.ob-marker {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  border: 1.5px solid #D1D5DB;
  color: #94A3B8;
  background: #FFFFFF;
}
.ob-step.is-done .ob-marker {
  border-color: #10B981;
  background: #10B981;
  color: white;
}
.ob-step.is-pending .ob-marker {
  border-color: #5E6AD2;
  color: #5E6AD2;
  background: #EEF0FF;
}
.ob-step.is-optional .ob-marker {
  border-style: dashed;
}
.ob-step.is-skipped .ob-marker {
  background: #F1F5F9;
  color: #94A3B8;
  border-color: #E5E7EB;
}

.ob-body { flex: 1; min-width: 0; }
.ob-title {
  font-size: 14px;
  font-weight: 600;
  color: #0F172A;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ob-step.is-done .ob-title { color: #475569; }
.ob-step.is-skipped .ob-title { color: #94A3B8; }

.ob-tag {
  background: #F1F5F9;
  color: #94A3B8;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9999px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.ob-detail {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: #475569;
  line-height: 1.5;
}

.ob-action {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ob-btn {
  background: #5E6AD2;
  color: white;
  border: none;
  padding: 7px 14px;
  border-radius: 7px;
  font-weight: 600;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.15s, transform 0.1s;
}
.ob-btn:hover { background: #4F46E5; }
.ob-btn:active { transform: translateY(1px); }

.ob-btn-ghost {
  background: transparent;
  color: #94A3B8;
  border: none;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.ob-btn-ghost:hover:not(:disabled) { background: #F1F5F9; color: #475569; }
.ob-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

.ob-done-label {
  color: #047857;
  font-size: 12px;
  font-weight: 600;
  background: #ECFDF5;
  padding: 4px 10px;
  border-radius: 9999px;
}

.ob-skipped-label {
  color: #94A3B8;
  font-size: 12px;
  font-style: italic;
  padding: 4px 10px;
}

/* ─── Complete state — subtle green gradient ─── */
.ob-card.is-complete {
  background: linear-gradient(135deg, #FFFFFF 0%, #ECFDF5 100%);
  border-color: #A7F3D0;
}
.ob-card.is-complete .ob-greeting strong { color: #047857; }
.ob-card.is-complete .ob-progress-fill { stroke: #10B981; }
.ob-card.is-complete .ob-progress-label { color: #047857; }

/* ─── Responsive ─── */
@media (max-width: 640px) {
  .ob-header { flex-wrap: wrap; gap: 12px; padding: 16px 18px; }
  .ob-step { padding: 12px 18px; flex-wrap: wrap; }
  .ob-action { width: 100%; justify-content: flex-end; margin-top: 4px; }
}
</style>
