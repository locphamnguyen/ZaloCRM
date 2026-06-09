<!--
═══════════════════════════════════════════════════════════════════════
 Luồng Mục Tiêu M9 — Tab FOLLOW-UP content (2026-06-02)
═══════════════════════════════════════════════════════════════════════

 Wire vào ChatContactPanel.vue line 468-477 (Tab FOLLOW-UP placeholder).
 Hiển thị danh sách N luồng Mục tiêu đang gắn 1 KH cụ thể + 4 buttons
 (Pause / Stop / Resume / Add new).

 API endpoints wire (đã ship Day 1+2 BE):
   GET  /api/v1/contacts/:cid/automation-status        → list cards
   POST /api/v1/automation/triggers/:tid/contacts/:cid/pause
   POST /api/v1/automation/triggers/:tid/contacts/:cid/stop
   POST /api/v1/automation/triggers/:tid/contacts/:cid/resume

 Mockup reference: 03-v2-tab-followup-content.html
-->

<template>
  <div class="auto-card-list">
    <!-- ════════ THEO DÕI THỦ CÔNG (anh chốt 2026-06-08) ════════
         "Ghim" 1 KH đang chat tay vào phiên CHỈ LẮNG NGHE — KHÔNG gửi tin tự động.
         Khách trả lời (dù chậm) → hệ thống báo sale ngay. Khác hẳn "bám đuổi" (gửi chuỗi tin). -->
    <div class="acl-watch" :class="{ on: isListening }">
      <div class="acl-watch__ic">
        <svg v-if="!isListening" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M22 8c0-2.3-.8-4.3-2-6" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /><path d="M4 2C2.8 3.7 2 5.7 2 8" /></svg>
      </div>
      <div class="acl-watch__info">
        <div class="acl-watch__title">
          {{ isListening ? 'Đang theo dõi khách này' : 'Theo dõi khách này' }}
        </div>
        <div class="acl-watch__sub">
          {{ isListening
            ? 'Khách trả lời sẽ báo bạn ngay — không gửi tin tự động.'
            : 'Ghim để được báo khi khách trả lời (dù chậm). Không gửi tin tự động.' }}
        </div>
      </div>
      <button
        class="acl-watch__btn"
        :class="{ on: isListening }"
        :disabled="watchBusy || !nickId"
        :title="!nickId ? 'Chưa chọn nick để theo dõi' : ''"
        @click="toggleListen"
      >
        {{ watchBusy ? '...' : (isListening ? 'Bỏ theo dõi' : 'Theo dõi') }}
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading && !cards.length" class="acl-loading">
      <div class="acl-spinner" />
      <p>Đang tải...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!loading && !cards.length" class="acl-empty">
      <span class="acl-empty__ill">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></svg>
      </span>
      <h3>Chưa có luồng bám đuổi nào</h3>
      <p>Khách này chưa được gắn vào kịch bản nào. Bạn có thể bám đuổi thủ công ngay.</p>
      <button class="acl-cta" @click="$emit('add-flow')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Gắn luồng bám đuổi
      </button>
    </div>

    <!-- List of cards grouped into 3 sections -->
    <template v-else>
      <!-- ── Section: Đang chạy (active + paused) ── -->
      <section v-if="runningCards.length" class="acl-sec">
        <div class="acl-sec__title">
          <span class="acl-dot run" />Đang chạy
          <span class="acl-cnt">{{ runningCards.length }}</span>
        </div>
        <div class="acl-cards">
          <FollowUpCard
            v-for="card in runningCards"
            :key="card.triggerId"
            :card="card"
            @action="(k) => onAction(card, k)"
          />
        </div>
      </section>

      <!-- ── Section: Đã hoàn thành ── -->
      <section v-if="completedCards.length" class="acl-sec">
        <div class="acl-sec__title">
          <span class="acl-dot done" />Đã hoàn thành
          <span class="acl-cnt">{{ completedCards.length }}</span>
        </div>
        <div class="acl-cards">
          <FollowUpCard
            v-for="card in completedCards"
            :key="card.triggerId"
            :card="card"
            @action="(k) => onAction(card, k)"
          />
        </div>
      </section>

      <!-- ── Section: Lịch sử bám đuổi (stopped) ── -->
      <section v-if="historyCards.length" class="acl-sec">
        <div class="acl-sec__title">
          <span class="acl-dot hist" />Lịch sử bám đuổi
          <span class="acl-cnt">{{ historyCards.length }}</span>
        </div>
        <div class="acl-cards">
          <FollowUpCard
            v-for="card in historyCards"
            :key="card.triggerId"
            :card="card"
            @action="(k) => onAction(card, k)"
          />
        </div>
      </section>

      <!-- Add new CTA -->
      <button class="acl-cta acl-cta--soft" @click="$emit('add-flow')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Gắn thêm luồng bám đuổi
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { api } from '@/api/index';
import FollowUpCard, { type FollowUpCardData } from './FollowUpCard.vue';

// ── Props ──
const props = defineProps<{
  contactId: string;
  // Nick CRM đang chat KH này — cần để "theo dõi tay" gắn đúng (contact × nick).
  nickId?: string | null;
  nickName?: string | null;
}>();

defineEmits<{
  'add-flow': [];
}>();

// ── Types ── (raw từ BE; UI state + helper render nằm trong FollowUpCard.vue)
type CardState = 'active' | 'paused' | 'completed' | 'stopped';
interface AutomationStatusCard extends FollowUpCardData {
  systemKind?: string | null;
  latestEvent: string;
  pausedUntil?: string | null;
  stopped?: boolean;
}

// ── State ──
const cards = ref<AutomationStatusCard[]>([]);
const loading = ref(false);

// ── Theo dõi thủ công (anh chốt 2026-06-08) ──
const isListening = ref(false);
const watchBusy = ref(false);

/** Kiểm KH này (× nick hiện tại) đã có phiên theo-dõi-tay đang mở chưa. */
async function fetchListenStatus(): Promise<void> {
  if (!props.contactId || !props.nickId) {
    isListening.value = false;
    return;
  }
  try {
    const res = await api.get<{ listening: boolean }>(
      '/automation/care-sessions/listen-status',
      { params: { contactId: props.contactId, nickId: props.nickId } },
    );
    isListening.value = res.data.listening === true;
  } catch (err) {
    console.error('[care-listen] status failed', err);
  }
}

/** Bật/tắt theo dõi tay — tạo/đóng phiên chỉ-lắng-nghe (không gửi tin). */
async function toggleListen(): Promise<void> {
  if (watchBusy.value || !props.contactId || !props.nickId) return;
  watchBusy.value = true;
  try {
    if (isListening.value) {
      await api.delete('/automation/care-sessions/listen', {
        data: { contactId: props.contactId, nickId: props.nickId },
      });
      isListening.value = false;
    } else {
      await api.post('/automation/care-sessions/listen', {
        contactId: props.contactId,
        nickId: props.nickId,
      });
      isListening.value = true;
    }
  } catch (err) {
    console.error('[care-listen] toggle failed', err);
    window.alert('Lỗi cập nhật theo dõi — thử lại sau');
  } finally {
    watchBusy.value = false;
  }
}

// ── 3 nhóm (Anh chốt 2026-06-07) ──
const runningCards = computed(() => cards.value.filter((c) => c.state === 'active' || c.state === 'paused'));
const completedCards = computed(() => cards.value.filter((c) => c.state === 'completed'));
const historyCards = computed(() => cards.value.filter((c) => c.state === 'stopped'));

// ── Derive UI state (đồng bộ logic server deriveFollowupState 2026-06-07) ──
// THỨ TỰ ƯU TIÊN — KHỚP backend manual-control-routes.ts:
//   1. stopped (sale dừng / KH chặn)
//   2. active nếu CÒN job pending → BE set nextRunAt khi có job. PHẢI check TRƯỚC
//      completed: bước cuối đang chờ gửi → currentStep==totalSteps nhưng VẪN đang chạy.
//      (Bug fix: trước đây nhầm thành "đã hoàn thành" khi step=2/2 mà job chưa chạy.)
//   3. paused (pausedUntilMs>0, không còn job)
//   4. completed (hết job + đã đi hết bước)
function deriveState(card: AutomationStatusCard): CardState {
  if (card.stopped) return 'stopped';
  if (card.nextRunAt) return 'active';
  if ((card.pausedUntilMs ?? 0) > 0) return 'paused';
  if (
    card.currentStep != null && card.totalSteps != null &&
    card.totalSteps > 0 && card.currentStep >= card.totalSteps
  ) return 'completed';
  return 'active';
}

// ── Gom card theo SEQUENCE (Anh chốt 2026-06-07) ──
// Nhiều Mục tiêu (trigger) cùng trỏ 1 Luồng → gộp thành 1 card, liệt kê các mục
// tiêu nguồn. Card chính giữ run "ưu tiên cao nhất" để nút pause/stop tác động
// đúng run. Trigger gắn block/broadcast (sequenceId null) giữ riêng theo trigger.
const STATE_RANK: Record<CardState, number> = { active: 3, paused: 2, completed: 1, stopped: 0 };
function groupBySequence(raw: AutomationStatusCard[]): AutomationStatusCard[] {
  const groups = new Map<string, AutomationStatusCard[]>();
  for (const c of raw) {
    // Key: sequenceId nếu có, else triggerId (giữ riêng).
    const key = c.sequenceId ? `seq:${c.sequenceId}` : `trg:${c.triggerId}`;
    const arr = groups.get(key);
    if (arr) arr.push(c); else groups.set(key, [c]);
  }

  const out: AutomationStatusCard[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) { out.push(arr[0]); continue; }
    // Chọn run chính: state cao nhất, rồi tiến xa nhất (currentStep), rồi mới nhất.
    const primary = [...arr].sort((a, b) => {
      const r = STATE_RANK[b.state] - STATE_RANK[a.state];
      if (r !== 0) return r;
      const s = (b.currentStep ?? 0) - (a.currentStep ?? 0);
      if (s !== 0) return s;
      return new Date(b.latestAt ?? 0).getTime() - new Date(a.latestAt ?? 0).getTime();
    })[0];
    // Tên các mục tiêu nguồn (unique, giữ thứ tự).
    const sourceTriggers = [...new Set(arr.map((c) => c.triggerName).filter(Boolean))];
    out.push({ ...primary, sourceTriggers });
  }
  return out;
}

// ── Fetch ──
async function fetchStatus(): Promise<void> {
  if (!props.contactId) return;
  loading.value = true;
  try {
    const res = await api.get<{
      contactId: string;
      triggers: AutomationStatusCard[];
    }>(`/contacts/${props.contactId}/automation-status`);

    const mapped = (res.data.triggers ?? []).map((c) => ({
      ...c,
      state: deriveState(c),
      busy: false,
      // BE chưa expose → giữ undefined: UI tự ẩn ETA + disable nút "Gửi bước tiếp ngay".
      advanceEnabled: false,
    }));
    cards.value = groupBySequence(mapped);
  } catch (err) {
    console.error('[automation-status] fetch failed', err);
    cards.value = [];
  } finally {
    loading.value = false;
  }
}

// ── Action: advance / pause / stop / resume / history ──
async function onAction(
  card: AutomationStatusCard,
  kind: 'advance' | 'pause' | 'stop' | 'resume' | 'history',
): Promise<void> {
  if (card.busy) return;

  // "Gửi bước tiếp ngay" + "Xem lịch sử": chờ endpoint BE (anh nối BullMQ sau).
  if (kind === 'advance') {
    window.alert('Tính năng "Gửi bước tiếp ngay" đang phát triển — sẽ có sớm.');
    return;
  }
  if (kind === 'history') {
    window.alert('Lịch sử chi tiết các bước đã gửi đang phát triển — sẽ có sớm.');
    return;
  }

  if (kind === 'pause') {
    const ok = window.confirm(`Pause chuỗi "${card.triggerName}" trong 24h cho KH này?`);
    if (!ok) return;
    card.busy = true;
    try {
      await api.post(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/pause`,
        { hours: 24 },
      );
      await fetchStatus();
    } catch (err) {
      console.error('[pause] failed', err);
      window.alert('Lỗi pause — thử lại sau');
    } finally {
      card.busy = false;
    }
  } else if (kind === 'stop') {
    const reason = window.prompt(`Dừng chuỗi "${card.triggerName}" cho KH này. Lý do (bắt buộc):`);
    if (!reason || !reason.trim()) return;
    card.busy = true;
    try {
      await api.post(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/stop`,
        { reason: reason.trim() },
      );
      await fetchStatus();
    } catch (err) {
      console.error('[stop] failed', err);
      window.alert('Lỗi dừng — thử lại sau');
    } finally {
      card.busy = false;
    }
  } else if (kind === 'resume') {
    card.busy = true;
    try {
      await api.post(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/resume`,
      );
      await fetchStatus();
    } catch (err) {
      console.error('[resume] failed', err);
      window.alert('Lỗi tiếp tục — thử lại sau');
    } finally {
      card.busy = false;
    }
  }
}

// ── Lifecycle ──
let pollHandle: number | null = null;

function startPolling(): void {
  if (pollHandle != null) return;
  // Refresh mỗi 30s khi tab visible (Page Visibility API)
  pollHandle = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void fetchStatus();
    }
  }, 30_000);
}

function stopPolling(): void {
  if (pollHandle != null) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }
}

onMounted(() => {
  void fetchStatus();
  void fetchListenStatus();
  startPolling();
});

onUnmounted(() => {
  stopPolling();
});

// Re-fetch khi đổi KH hoặc đổi nick đang chat (theo dõi tay gắn theo contact × nick).
watch(
  () => [props.contactId, props.nickId],
  () => {
    void fetchStatus();
    void fetchListenStatus();
  },
);

// Expose refetch cho parent component (Modal close → refresh)
defineExpose({ refetch: fetchStatus });
</script>

<style scoped>
.auto-card-list {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Theo dõi thủ công (anh chốt 2026-06-08) ── */
.acl-watch {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  transition: 0.14s;
}
.acl-watch.on {
  border-color: var(--brand);
  background: var(--brand-softer);
}
.acl-watch__ic {
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-3);
  color: var(--ink-3);
}
.acl-watch.on .acl-watch__ic {
  background: var(--brand-soft);
  color: var(--brand-700);
}
.acl-watch__info { flex: 1; min-width: 0; }
.acl-watch__title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}
.acl-watch__sub {
  font-size: 11px;
  color: var(--ink-3);
  line-height: 1.4;
  margin-top: 2px;
}
.acl-watch__btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 13px;
  border-radius: var(--r-sm);
  border: 1px solid var(--brand);
  background: var(--brand);
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s;
}
.acl-watch__btn:hover:not(:disabled) { background: var(--brand-600); }
.acl-watch__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.acl-watch__btn.on {
  background: var(--surface);
  color: var(--ink-3);
  border-color: var(--line);
}
.acl-watch__btn.on:hover:not(:disabled) {
  background: var(--error-soft);
  color: var(--error);
  border-color: #f6c5c1;
}

/* ── Loading ── */
.acl-loading {
  text-align: center;
  padding: 40px 20px;
  color: var(--ink-3);
  font-size: 12.5px;
}
.acl-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--surface-3);
  border-top-color: var(--brand);
  border-radius: 50%;
  margin: 0 auto 12px;
  animation: acl-spin 0.8s linear infinite;
}
@keyframes acl-spin { to { transform: rotate(360deg); } }

/* ── Empty ── */
.acl-empty {
  text-align: center;
  padding: 44px 20px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.acl-empty__ill {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--brand-softer);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  margin-bottom: 14px;
}
.acl-empty h3 {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 5px;
}
.acl-empty p {
  font-size: 12.5px;
  color: var(--ink-3);
  line-height: 1.5;
  max-width: 250px;
  margin: 0 auto 18px;
}

/* ── Section ── */
.acl-sec { display: flex; flex-direction: column; }
.acl-sec__title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.acl-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.acl-dot.run { background: var(--brand); }
.acl-dot.done { background: var(--success); }
.acl-dot.hist { background: var(--ink-4); }
.acl-cnt {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--ink-3);
  background: var(--surface-3);
  border-radius: var(--r-pill);
  padding: 1px 8px;
  min-width: 20px;
  text-align: center;
}
.acl-cards { display: flex; flex-direction: column; gap: 10px; margin-top: 9px; }

/* ── Add CTA ── */
.acl-cta {
  width: 100%;
  height: 40px;
  border-radius: var(--r-sm);
  background: var(--brand);
  color: #fff;
  border: 0;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  box-shadow: var(--sh-xs);
  transition: 0.12s;
}
.acl-cta:hover { background: var(--brand-600); }
.acl-cta--soft {
  background: var(--brand-soft);
  color: var(--brand-700);
  box-shadow: none;
}
.acl-cta--soft:hover { background: #d4e8f4; }

svg { display: block; }
</style>
