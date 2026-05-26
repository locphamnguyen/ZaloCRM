<!--
  LeadFloatingButton — Phase Lead Pool 2026-05-24.
  FAB góc phải dưới Chat. Click → mở LeadRequestModal hoặc ForceNoteDialog.
-->
<template>
  <Teleport to="body">
    <div v-if="state.enabled" class="lfb-wrap">
      <!-- Cooldown tooltip — chỉ hiện khi hover -->
      <div v-if="cooldownLabel" class="lfb-tooltip">
        Đợi <strong>{{ cooldownLabel }}</strong> để xin lead tiếp
      </div>

      <button
        class="lfb-btn"
        :class="{
          'lfb-disabled': !state.canRequest && state.reason !== 'unsubmitted_note',
          'lfb-warn': state.reason === 'unsubmitted_note',
          'lfb-pulse': state.canRequest && (state.remainingToday ?? 0) > 0,
        }"
        :title="buttonTitle"
        @click="onClick"
      >
        <span class="lfb-icon">🎁</span>
        <span class="lfb-text">Nhận Lead</span>
        <span
          v-if="state.remainingToday !== undefined"
          class="lfb-badge"
          :class="{ 'lfb-badge-warn': state.reason === 'unsubmitted_note' }"
        >
          {{ state.reason === 'unsubmitted_note' ? '!' : state.remainingToday }}
        </span>
      </button>
    </div>

    <!-- Modals (Teleport to body for proper stacking) -->
    <LeadRequestModal
      v-if="leadOpen"
      :lead="leadData"
      @close="onLeadClose"
      @note-submitted="onAfterAction"
      @returned="onAfterAction"
    />

    <ForceNoteDialog
      v-if="forceNoteOpen && state.pendingNoteLead"
      :pending="state.pendingNoteLead"
      :min-length="state.config.noteMinLength"
      @done="onForceNoteDone"
      @returned="onForceNoteDone"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useLeadPool, type LeadPayload, type Eligibility } from '@/composables/use-lead-pool';
import LeadRequestModal from './LeadRequestModal.vue';
import ForceNoteDialog from './ForceNoteDialog.vue';

const route = useRoute();

const {
  eligibility,
  cooldownLabel,
  fetchEligibility,
  requestNewLead,
  requesting,
} = useLeadPool();

const leadOpen = ref(false);
const leadData = ref<LeadPayload | null>(null);
const forceNoteOpen = ref(false);

const state = computed(() => {
  const e = eligibility.value;
  if (!e) {
    return {
      enabled: false,
      canRequest: false,
      remainingToday: undefined as number | undefined,
      reason: undefined as Eligibility['reason'],
      pendingNoteLead: undefined as Eligibility['pendingNoteLead'],
      config: { noteMinLength: 20 } as any,
    };
  }
  return {
    enabled: e.config.enabled,
    canRequest: e.canRequest,
    remainingToday: e.remainingToday,
    reason: e.reason,
    pendingNoteLead: e.pendingNoteLead,
    config: e.config,
  };
});

const buttonTitle = computed(() => {
  const e = eligibility.value;
  if (!e) return 'Đang tải...';
  if (e.canRequest) return `Còn ${e.remainingToday} lượt — click để nhận lead mới`;
  if (e.reason === 'cooldown') return `Đợi ${cooldownLabel.value} nữa`;
  if (e.reason === 'daily_cap') return `Hết quota hôm nay (${e.config.maxRequestsPerDay} lượt)`;
  if (e.reason === 'unsubmitted_note') return 'Ghi note cho lead trước rồi mới xin tiếp';
  if (e.reason === 'disabled') return 'Tính năng tạm tắt';
  return 'Không thể xin lead';
});

async function onClick() {
  if (requesting.value) return;
  if (state.value.reason === 'unsubmitted_note') {
    forceNoteOpen.value = true;
    return;
  }
  if (!state.value.canRequest) return;
  const lead = await requestNewLead();
  if (lead) {
    leadData.value = lead;
    leadOpen.value = true;
  }
}

function onLeadClose() {
  leadOpen.value = false;
  leadData.value = null;
}

function onAfterAction() {
  leadOpen.value = false;
  leadData.value = null;
  void fetchEligibility();
}

function onForceNoteDone() {
  forceNoteOpen.value = false;
  void fetchEligibility();
}

onMounted(() => {
  void fetchEligibility();
});

// Re-fetch khi vào ChatView (route change)
import { watch } from 'vue';
watch(() => route.path, (path) => {
  if (path.startsWith('/chat')) void fetchEligibility();
});
</script>

<style scoped>
.lfb-wrap {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 95; /* dưới modal (1000) nhưng trên content */
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.lfb-tooltip {
  background: rgba(15, 23, 42, 0.92);
  color: white;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
}
.lfb-wrap:hover .lfb-tooltip { opacity: 1; }
.lfb-tooltip strong { font-variant-numeric: tabular-nums; }

.lfb-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border: none;
  border-radius: 9999px;
  background: linear-gradient(135deg, #5E6AD2 0%, #4F46E5 100%);
  color: white;
  font-weight: 700;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(94, 106, 210, 0.35), 0 2px 6px rgba(94, 106, 210, 0.25);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
}
.lfb-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(94, 106, 210, 0.45), 0 4px 8px rgba(94, 106, 210, 0.3);
}
.lfb-btn:active { transform: translateY(0); }

.lfb-btn.lfb-disabled {
  background: linear-gradient(135deg, #94A3B8 0%, #64748B 100%);
  cursor: not-allowed;
  box-shadow: 0 4px 12px rgba(100, 116, 139, 0.25);
}
.lfb-btn.lfb-disabled:hover { transform: none; box-shadow: 0 4px 12px rgba(100, 116, 139, 0.25); }

.lfb-btn.lfb-warn {
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
  box-shadow: 0 8px 24px rgba(217, 119, 6, 0.4), 0 2px 6px rgba(217, 119, 6, 0.3);
}
.lfb-btn.lfb-warn:hover {
  box-shadow: 0 12px 32px rgba(217, 119, 6, 0.5);
}

.lfb-btn.lfb-pulse::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px solid #5E6AD2;
  animation: lfb-pulse 2s infinite;
  pointer-events: none;
}
.lfb-btn { position: relative; }
@keyframes lfb-pulse {
  0%   { transform: scale(1);    opacity: 0.7; }
  100% { transform: scale(1.25); opacity: 0; }
}

.lfb-icon { font-size: 18px; }
.lfb-text { letter-spacing: 0.02em; }

.lfb-badge {
  background: rgba(255, 255, 255, 0.25);
  color: white;
  padding: 2px 9px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.lfb-badge.lfb-badge-warn {
  background: white;
  color: #B45309;
}
</style>
