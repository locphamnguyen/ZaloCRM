<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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
            :key="card.enrollmentId ?? card.triggerId"
            :card="card"
            @action="(k) => onAction(card, k)"
          />
        </div>
      </section>

      <!-- ── Section: Đã hoàn thành (THU GỌN mặc định — anh chốt 2026-06-15) ──
           Bấm tiêu đề mới xổ ra danh sách dòng nhỏ. Đang chạy luôn hiện đầy đủ ở trên. -->
      <section v-if="completedCards.length" class="acl-sec">
        <button class="acl-sec__title acl-sec__title--toggle" @click="showCompleted = !showCompleted">
          <span class="acl-dot done" />Đã hoàn thành
          <span class="acl-cnt">{{ completedCards.length }}</span>
          <svg class="acl-chev" :class="{ open: showCompleted }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <div v-if="showCompleted" class="acl-done-list">
          <button
            v-for="card in completedCards"
            :key="card.enrollmentId ?? card.triggerId"
            class="acl-done-row"
            :title="`${card.sequenceName || 'Luồng bám đuổi'} — Lần ${card.enrollSeq ?? 1}`"
            @click="onAction(card, 'history')"
          >
            <span class="acl-done-name">{{ card.sequenceName || 'Luồng bám đuổi' }}</span>
            <span v-if="card.enrollSeq" class="acl-done-seq">Lần {{ card.enrollSeq }}</span>
            <span class="acl-done-when">{{ doneWhen(card) }}</span>
          </button>
        </div>
      </section>

      <!-- ── Section: Lịch sử bám đuổi (stopped) — cũng thu gọn dòng nhỏ ── -->
      <section v-if="historyCards.length" class="acl-sec">
        <button class="acl-sec__title acl-sec__title--toggle" @click="showHistory = !showHistory">
          <span class="acl-dot hist" />Lịch sử bám đuổi
          <span class="acl-cnt">{{ historyCards.length }}</span>
          <svg class="acl-chev" :class="{ open: showHistory }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <div v-if="showHistory" class="acl-done-list">
          <button
            v-for="card in historyCards"
            :key="card.enrollmentId ?? card.triggerId"
            class="acl-done-row"
            :title="`${card.sequenceName || 'Luồng bám đuổi'} — Lần ${card.enrollSeq ?? 1}`"
            @click="onAction(card, 'history')"
          >
            <span class="acl-done-name">{{ card.sequenceName || 'Luồng bám đuổi' }}</span>
            <span v-if="card.enrollSeq" class="acl-done-seq">Lần {{ card.enrollSeq }}</span>
            <span class="acl-done-when">{{ doneWhen(card) }}</span>
          </button>
        </div>
      </section>

    </template>

    <!-- 2026-06-18: nút "+ Add" NỔI gim góc dưới-phải cột — luôn thấy dù nhiều luồng, khỏi cuộn.
         Hover xổ chữ. Hiện khi ĐÃ có ≥1 card (empty-state đã có nút lớn riêng). -->
    <button
      v-if="cards.length"
      class="acl-fab"
      title="Gắn thêm luồng bám đuổi"
      @click="$emit('add-flow')"
    >
      <svg class="acl-fab-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      <span class="acl-fab-lb">Gắn luồng bám đuổi</span>
    </button>

    <!-- Modal xác nhận pause/stop (thay window.confirm/prompt — anh chốt 2026-06-15) -->
    <ConfirmActionModal
      v-model:open="confirmOpen"
      :title="confirmConfig.title"
      :message="confirmConfig.message"
      :tone="confirmConfig.tone"
      :confirm-text="confirmConfig.confirmText"
      :require-reason="confirmConfig.requireReason"
      :reason-label="confirmConfig.reasonLabel"
      :reason-placeholder="confirmConfig.reasonPlaceholder"
      :busy="confirmBusy"
      @confirm="runConfirmedAction"
      @cancel="confirmOpen = false"
    />

    <!-- Lịch sử chi tiết bám đuổi (office-hours 2026-06-18) -->
    <FollowUpHistoryDialog
      :open="historyOpen"
      :contact-id="props.contactId"
      :card="historyCard"
      @close="historyOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { api } from '@/api/index';
import FollowUpCard, { type FollowUpCardData } from './FollowUpCard.vue';
import ConfirmActionModal from './ConfirmActionModal.vue';
import FollowUpHistoryDialog from './FollowUpHistoryDialog.vue';
import { useToast } from '@/composables/use-toast';

const toastSvc = useToast();
// Helper gọn: toast(msg)=thường(xanh); 'warning'=vàng (không phải lỗi); 'error'=đỏ.
function toast(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
  if (type === 'error') toastSvc.error(message);
  else if (type === 'warning') toastSvc.warning(message);
  else toastSvc.success(message);
}

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
  // 2026-06-15 — per-lần-gắn (manual followup): mỗi lần gắn 1 card riêng.
  enrollmentId?: string;
  enrollSeq?: number;
  derivedState?: CardState; // BE truyền sẵn state per-run (không tự derive)
  enrolledAt?: string;
  lastSentAt?: string | null;
  // YC3 timing (Đợt 2): BE trả 4 mốc per luồng.
  etaCompleteAt?: string | null; // bao lâu nữa xong (ISO)
  holdReason?: 'running' | 'waiting_reply' | 'out_of_hours' | 'nick_offline' | 'completed' | 'stopped' | null;
  allowedHourRange?: [number, number] | null;
}

// ── State ──
const cards = ref<AutomationStatusCard[]>([]);
const loading = ref(false);

// ── Theo dõi thủ công (anh chốt 2026-06-08) ──
const isListening = ref(false);
// 2026-06-15: phân biệt phiên theo-dõi GẮN TAY vs AUTO (luồng tự gắn). Chuông hiện cho cả
// 2, nhưng nút "Bỏ theo dõi" CHỈ áp phiên gắn tay — auto là luồng đang chạy, không tắt ở đây.
const isManualWatch = ref(false);
const watchBusy = ref(false);

/** Kiểm KH này (× nick hiện tại) đang được theo dõi chưa (gắn tay HOẶC auto). */
async function fetchListenStatus(): Promise<void> {
  if (!props.contactId || !props.nickId) {
    isListening.value = false;
    isManualWatch.value = false;
    return;
  }
  try {
    const res = await api.get<{ listening: boolean; isManualWatch?: boolean }>(
      '/automation/care-sessions/listen-status',
      { params: { contactId: props.contactId, nickId: props.nickId } },
    );
    isListening.value = res.data.listening === true;
    isManualWatch.value = res.data.isManualWatch === true;
  } catch (err) {
    console.error('[care-listen] status failed', err);
  }
}

/** Bật/tắt theo dõi tay — tạo/đóng phiên chỉ-lắng-nghe (không gửi tin). */
async function toggleListen(): Promise<void> {
  if (watchBusy.value || !props.contactId || !props.nickId) return;
  // Đang theo dõi qua LUỒNG TỰ ĐỘNG (không phải gắn tay) → không cho tắt ở đây (luồng tự
  // kết thúc). Báo nhẹ cho sale hiểu.
  if (isListening.value && !isManualWatch.value) {
    toast('Khách đang trong luồng bám đuổi tự động — dừng/tạm dừng ở thẻ luồng bên dưới, không bỏ theo dõi ở đây.', 'warning');
    return;
  }
  watchBusy.value = true;
  try {
    if (isListening.value) {
      await api.delete('/automation/care-sessions/listen', {
        data: { contactId: props.contactId, nickId: props.nickId },
      });
      isListening.value = false;
      isManualWatch.value = false;
    } else {
      await api.post('/automation/care-sessions/listen', {
        contactId: props.contactId,
        nickId: props.nickId,
      });
      isListening.value = true;
      isManualWatch.value = true; // vừa tạo phiên gắn tay → cho phép bỏ theo dõi
    }
  } catch (err) {
    console.error('[care-listen] toggle failed', err);
    toast('Lỗi cập nhật theo dõi — thử lại sau', 'error');
  } finally {
    watchBusy.value = false;
  }
}

// ── 3 nhóm (Anh chốt 2026-06-07) ──
const runningCards = computed(() => cards.value.filter((c) => c.state === 'active' || c.state === 'paused'));
const completedCards = computed(() => cards.value.filter((c) => c.state === 'completed'));
const historyCards = computed(() => cards.value.filter((c) => c.state === 'stopped'));

// 2026-06-15: 2 nhóm xong THU GỌN mặc định (anh chốt — bấm mới mở). Đang chạy luôn hiện.
const showCompleted = ref(false);
const showHistory = ref(false);

// Ngày "xong" hiển thị ở dòng thu gọn — ưu tiên lần gửi cuối, fallback ngày gắn.
function doneWhen(card: AutomationStatusCard): string {
  const iso = card.lastSentAt || card.enrolledAt || card.latestAt;
  if (!iso) return '';
  const d = new Date(iso as string);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
    + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

// ── Derive UI state (đồng bộ logic server deriveFollowupState 2026-06-07) ──
// THỨ TỰ ƯU TIÊN — KHỚP backend manual-control-routes.ts:
//   1. stopped (sale dừng / KH chặn)
//   2. active nếu CÒN job pending → BE set nextRunAt khi có job. PHẢI check TRƯỚC
//      completed: bước cuối đang chờ gửi → currentStep==totalSteps nhưng VẪN đang chạy.
//      (Bug fix: trước đây nhầm thành "đã hoàn thành" khi step=2/2 mà job chưa chạy.)
//   3. paused (pausedUntilMs>0, không còn job)
//   4. completed (hết job + đã đi hết bước)
function deriveState(card: AutomationStatusCard): CardState {
  // 2026-06-15: run manual followup BE đã biết state chính xác per-lần-gắn → tôn trọng,
  // KHÔNG tự derive (run cũ progressUnknown totalSteps=null sẽ bị nhầm 'active').
  if (card.derivedState) return card.derivedState;
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
    // 2026-06-15: run manual followup (có enrollmentId) = mỗi LẦN GẮN riêng → KHÔNG gom
    // (dù cùng sequenceId — gắn lại nhiều lần là nhiều card). Card tự động gom theo sequence.
    const key = c.enrollmentId
      ? `enr:${c.enrollmentId}`
      : (c.sequenceId ? `seq:${c.sequenceId}` : `trg:${c.triggerId}`);
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
      // Đợt 2: BE đã expose timing. Cho advance khi: có job kế (nextRunAt) + CÓ sequenceId
      // (BE advance bắt buộc sequenceId — review #1, không fan-out đa-luồng) + không
      // chờ-khách-reply + chưa dừng.
      advanceEnabled: !!c.nextRunAt && !!c.sequenceId && c.holdReason !== 'waiting_reply' && !c.stopped,
    }));
    // 2026-06-15: CHỈ gom các card ĐANG CHẠY cùng sequence (gọn 1 card đang chạy). Card đã
    // xong/lịch sử = mỗi LẦN GẮN 1 dòng riêng (KHÔNG gom — nếu không lại ẩn mất luồng cũ).
    const running = mapped.filter((c) => c.state === 'active' || c.state === 'paused');
    const rest = mapped.filter((c) => c.state !== 'active' && c.state !== 'paused');
    cards.value = [...groupBySequence(running), ...rest];
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

  // "Gửi bước tiếp ngay": promote job + CHỜ BE xác nhận gửi thật (actuallySent) rồi mới
  // báo. Fix bug anh báo 2026-06-15: trước đây luôn báo "Đã gửi" dù tin chưa qua.
  if (kind === 'advance') {
    if (card.advanceEnabled === false) return;
    card.busy = true;
    try {
      const res = await api.post<{ ok: boolean; promoted: number; actuallySent?: boolean; deferred?: boolean; deferReason?: string | null }>(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/advance`,
        { sequenceId: card.sequenceId ?? undefined },
      );
      await fetchStatus();
      const d = res.data;
      if (d.actuallySent) {
        toast('Đã gửi bước tiếp cho khách');
      } else if (d.deferred) {
        // Job đã đẩy nhưng worker hoãn — KHÔNG phải lỗi (hệ thống tự gửi khi đủ điều kiện).
        // Báo màu VÀNG + đúng 1 lý do cụ thể (BE trả deferReason) cho dễ hiểu.
        const reasonMsg: Record<string, string> = {
          nick_gap: 'Vừa gửi tin xong — chờ chút cho tự nhiên rồi hệ thống tự gửi tiếp',
          outside_hour_window: 'Đang ngoài giờ gửi tin — hệ thống sẽ tự gửi khi tới giờ làm việc',
          quota_capped: 'Nick này đã gửi đủ số tin trong ngày — sẽ tự gửi vào ngày mai',
          nick_offline: 'Nick đang ngắt kết nối — sẽ tự gửi ngay khi nick online lại',
          awaiting_reply: 'Khách vừa nhắn lại — tạm dừng gửi tự động để bạn trả lời trước',
        };
        toast(reasonMsg[d.deferReason ?? ''] ?? 'Đã ghi nhận — hệ thống đang chờ đủ điều kiện rồi tự gửi', 'warning');
      } else {
        toast('Đang gửi bước tiếp — hệ thống đang xử lý, tin sẽ hiện trong giây lát');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast(msg ?? 'Không gửi được bước tiếp ngay.', 'error');
    } finally {
      card.busy = false;
    }
    return;
  }
  if (kind === 'history') {
    historyCard.value = card;
    historyOpen.value = true;
    return;
  }

  // pause / stop → MỞ MODAL xác nhận đẹp (thay window.confirm/prompt — anh chốt 2026-06-15).
  // Modal confirm mới gọi API (runConfirmedAction). resume KHÔNG cần xác nhận → chạy ngay.
  if (kind === 'pause' || kind === 'stop') {
    confirmCard.value = card;
    confirmKind.value = kind;
    confirmOpen.value = true;
    return;
  }
  if (kind === 'resume') {
    card.busy = true;
    try {
      await api.post(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/resume`,
      );
      await fetchStatus();
      toast('Đã tiếp tục luồng — hệ thống đang gửi bước kế tiếp cho khách');
    } catch (err) {
      console.error('[resume] failed', err);
      toast('Lỗi tiếp tục — thử lại sau', 'error');
    } finally {
      card.busy = false;
    }
  }
}

// ── Modal xác nhận pause/stop (thay window.confirm/prompt) ──
const confirmOpen = ref(false);
const confirmKind = ref<'pause' | 'stop'>('pause');
const confirmCard = ref<AutomationStatusCard | null>(null);
// Lịch sử chi tiết bám đuổi (nút "Xem lịch sử") — office-hours 2026-06-18.
const historyOpen = ref(false);
const historyCard = ref<AutomationStatusCard | null>(null);
const confirmBusy = ref(false);

const confirmConfig = computed(() => {
  const name = confirmCard.value?.sequenceName || confirmCard.value?.triggerName || 'luồng bám đuổi';
  if (confirmKind.value === 'stop') {
    return {
      title: 'Dừng hẳn luồng bám đuổi?',
      message: `Dừng hẳn "${name}" cho khách này. Luồng sẽ không gửi tin nữa.`,
      tone: 'danger' as const,
      confirmText: 'Dừng hẳn',
      requireReason: true,
      reasonLabel: 'Lý do dừng',
      reasonPlaceholder: 'VD: khách đã chốt / không quan tâm / sai đối tượng...',
    };
  }
  return {
    title: 'Tạm dừng 24 giờ?',
    message: `Tạm dừng "${name}" trong 24h cho khách này. Hết 24h luồng tự chạy lại.`,
    tone: 'primary' as const,
    confirmText: 'Tạm dừng 24h',
    requireReason: false,
    reasonLabel: '',
    reasonPlaceholder: '',
  };
});

async function runConfirmedAction(reason: string): Promise<void> {
  const card = confirmCard.value;
  if (!card) return;
  confirmBusy.value = true;
  card.busy = true;
  try {
    if (confirmKind.value === 'pause') {
      await api.post(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/pause`,
        { hours: 24 },
      );
      toast('Đã tạm dừng 24h');
    } else {
      await api.post(
        `/automation/triggers/${card.triggerId}/contacts/${props.contactId}/stop`,
        { reason },
      );
      toast('Đã dừng hẳn luồng');
    }
    confirmOpen.value = false;
    await fetchStatus();
  } catch (err) {
    console.error(`[${confirmKind.value}] failed`, err);
    toast(confirmKind.value === 'pause' ? 'Lỗi tạm dừng — thử lại sau' : 'Lỗi dừng — thử lại sau', 'error');
  } finally {
    confirmBusy.value = false;
    card.busy = false;
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

/* ── Nhóm "đã xong / lịch sử" thu gọn (2026-06-15) ── */
.acl-sec__title--toggle {
  width: 100%;
  background: none;
  border: 0;
  font-family: inherit;
  cursor: pointer;
  padding: 4px 0;
}
.acl-sec__title--toggle:hover { color: var(--ink-2); }
.acl-chev { margin-left: 6px; color: var(--ink-4); transition: transform 0.15s; flex-shrink: 0; }
.acl-chev.open { transform: rotate(180deg); }
.acl-done-list { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
.acl-done-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  font-family: inherit;
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  transition: 0.12s;
}
.acl-done-row:hover { background: var(--surface-3); }
.acl-done-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acl-done-seq {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-3);
  background: var(--surface-3);
  border-radius: var(--r-pill);
  padding: 1px 7px;
}
.acl-done-when { flex-shrink: 0; font-size: 11px; color: var(--ink-4); }

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

/* ── FAB "+ Add" nổi gim góc dưới-phải (2026-06-18) ── */
.acl-fab {
  position: sticky;
  bottom: 14px;
  align-self: flex-end;
  margin-top: 6px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 46px;
  padding: 0 13px;
  max-width: 46px; /* gập: chỉ thấy icon + */
  overflow: hidden;
  border: 0;
  border-radius: 23px;
  background: var(--brand);
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(23, 134, 190, 0.42);
  transition: max-width 0.22s ease, box-shadow 0.15s;
}
.acl-fab:hover { max-width: 240px; box-shadow: 0 8px 22px rgba(23, 134, 190, 0.5); }
.acl-fab-ic { flex-shrink: 0; }
.acl-fab-lb { opacity: 0; transition: opacity 0.18s; }
.acl-fab:hover .acl-fab-lb { opacity: 1; }

svg { display: block; }
</style>
