<!--
═══════════════════════════════════════════════════════════════════════
 FollowUpCard — 1 card luồng bám đuổi trong tab FOLLOW-UP (redesign 2026-06-07)
═══════════════════════════════════════════════════════════════════════
 Chuẩn design system HS Holding (token --brand/--ink/--surface…), KHÔNG màu Jira.
 Mockup: ~/.gstack/projects/locphamnguyen-ZaloCRM/designs/chat-followup-20260607/

 State → action:
   active    → [Gửi bước tiếp ngay] + icon ⏸ Tạm dừng 24h + icon ⏹ Dừng hẳn
   paused    → [Tiếp tục ngay] + icon ⏹ Dừng hẳn
   completed → [Xem lịch sử]
   stopped   → [Xem lịch sử]

 NOTE: "Gửi bước tiếp ngay" cần endpoint BE (chưa có) → emit 'advance', parent
 xử lý (hiện disable + báo "sắp có" tới khi anh nối BullMQ). "Dự kiến xong luồng"
 chỉ hiện khi card.etaCompleteAt có giá trị (BE chưa trả → ẩn).
-->
<template>
  <div class="fcard" :class="card.state">
    <!-- head: name + badge — tên LUỒNG là chính (phase 2), trigger là dòng phụ -->
    <div class="fc-top">
      <div class="fc-name">
        <span class="fc-seqic" title="Luồng kịch bản">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </span>
        {{ displayTitle }}
      </div>
      <span class="fc-badge" :class="card.state">{{ badgeLabel }}</span>
    </div>

    <!-- cờ "Sale gắn tay" — KH vào luồng bằng enroll thủ công -->
    <div v-if="card.isManual" class="fc-manual" :title="manualTooltip">
      <span class="mi"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></span>
      Sale gắn tay<template v-if="card.enrolledByName">: {{ card.enrolledByName }}</template>
    </div>

    <!-- dòng phụ: vào qua mục tiêu nào (chỉ khi KHÔNG phải gắn tay, tránh thừa) -->
    <div v-if="sourceLabel && !card.isManual" class="fc-source">
      <span class="mi"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg></span>
      Vào qua: {{ sourceLabel }}
    </div>

    <!-- progress -->
    <div v-if="card.currentStep != null && card.totalSteps" class="fc-prog">
      <div class="fc-bar"><div class="fc-fill" :class="card.state" :style="{ width: progressPct + '%' }" /></div>
      <span class="fc-step">{{ stepLabel }}</span>
    </div>

    <!-- meta -->
    <div class="fc-meta">
      <!-- active: next run -->
      <div v-if="card.state === 'active' && card.nextRunAt" class="fc-line accent">
        <span class="mi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg></span>
        Lần gửi tiếp: {{ formatTime(card.nextRunAt) }}
      </div>
      <!-- paused: remaining -->
      <div v-else-if="card.state === 'paused'" class="fc-line warn">
        <span class="mi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg></span>
        KH đã tương tác · còn {{ formatRemaining(card.pausedUntilMs) }}
      </div>
      <!-- completed -->
      <div v-else-if="card.state === 'completed'" class="fc-line">
        <span class="mi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
        Đi hết chuỗi · {{ formatTime(card.latestAt) }}
      </div>
      <!-- stopped -->
      <div v-else-if="card.state === 'stopped'" class="fc-line">
        <span class="mi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" /></svg></span>
        Đã dừng · {{ formatTime(card.latestAt) }}
      </div>

      <!-- nick + sale (active/paused) -->
      <div v-if="(card.state === 'active' || card.state === 'paused') && (card.nickName || card.enrolledBy)" class="fc-line">
        <span class="mi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></span>
        <span v-if="card.nickName">Nick: {{ card.nickName }}</span>
        <span v-if="card.nickName && card.enrolledBy"> · </span>
        <span v-if="card.enrolledBy">Sale: {{ card.enrolledBy }}</span>
      </div>
    </div>

    <!-- ETA dự kiến xong (chỉ active, chỉ khi BE trả etaCompleteAt) -->
    <div v-if="card.state === 'active' && card.etaCompleteAt" class="fc-eta">
      <span class="mi"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg></span>
      Dự kiến xong luồng: <b>{{ formatTime(card.etaCompleteAt) }}</b>
    </div>

    <!-- actions -->
    <div class="fc-act" :class="{ 'no-border': card.state === 'completed' || card.state === 'stopped' }">
      <template v-if="card.state === 'active'">
        <button
          class="btn primary"
          :disabled="card.busy || !card.advanceEnabled"
          :title="card.advanceEnabled ? 'Gửi ngay bước kế tiếp, không chờ delay' : 'Tính năng gửi-ngay đang phát triển'"
          @click="emit('action', 'advance')"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
          Gửi bước tiếp ngay
        </button>
        <button class="ibtn warn" :disabled="card.busy" title="Tạm dừng 24h" @click="emit('action', 'pause')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        </button>
        <button class="ibtn danger" :disabled="card.busy" title="Dừng hẳn" @click="emit('action', 'stop')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
        </button>
      </template>

      <template v-else-if="card.state === 'paused'">
        <button class="btn primary-soft" :disabled="card.busy" @click="emit('action', 'resume')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          Tiếp tục ngay
        </button>
        <button class="ibtn danger" :disabled="card.busy" title="Dừng hẳn" @click="emit('action', 'stop')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
        </button>
      </template>

      <template v-else>
        <button class="btn ghost" :disabled="card.busy" @click="emit('action', 'history')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
          Xem lịch sử
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface FollowUpCardData {
  triggerId: string;
  triggerName: string;
  isSystemTrigger: boolean;
  state: 'active' | 'paused' | 'completed' | 'stopped';
  currentStep: number | null;
  totalSteps: number | null;
  nextRunAt?: string | null;
  latestAt?: string | null;
  pausedUntilMs: number;
  nickName?: string;
  enrolledBy?: string;
  busy?: boolean;
  // Sequence binding — card gom theo Sequence (phase 2 là cái chính). Anh chốt 2026-06-07.
  sequenceId?: string | null;
  sequenceName?: string | null;
  sourceTriggers?: string[];       // tên các Mục tiêu đã đẩy KH vào luồng này
  // Cờ "Sale gắn tay" — KH vào luồng bằng enroll thủ công từ chat.
  isManual?: boolean;
  enrolledByName?: string | null;  // tên sale đã gắn
  enrollReason?: string | null;    // lý do (hover xem)
  // BE chưa trả — UI ẩn nếu thiếu. Anh nối BullMQ sau.
  etaCompleteAt?: string | null;   // dự kiến hoàn thành cả luồng
  advanceEnabled?: boolean;        // bật nút "Gửi bước tiếp ngay" khi BE có endpoint
}

const props = defineProps<{ card: FollowUpCardData }>();
const emit = defineEmits<{ action: ['advance' | 'pause' | 'stop' | 'resume' | 'history'] }>();

const BADGE: Record<string, string> = {
  active: 'Đang chạy', paused: 'Tạm dừng', completed: 'Xong', stopped: 'Đã dừng',
};
const badgeLabel = computed(() => BADGE[props.card.state] ?? '');

// Tiêu đề = tên LUỒNG kịch bản (ưu tiên). Fallback tên mục tiêu nếu trigger gắn
// block/broadcast (không có sequence).
const displayTitle = computed(() =>
  props.card.sequenceName || props.card.triggerName || 'Luồng bám đuổi',
);

// Tooltip cờ gắn tay: tên sale + lý do.
const manualTooltip = computed(() => {
  const parts: string[] = [];
  if (props.card.enrolledByName) parts.push(`Sale gắn: ${props.card.enrolledByName}`);
  if (props.card.enrollReason) parts.push(`Lý do: ${props.card.enrollReason}`);
  return parts.join(' · ') || 'KH được gắn vào luồng thủ công từ chat';
});

// Dòng "Vào qua" — danh sách mục tiêu nguồn. Gọn nếu >2: "A, B (+N)".
const sourceLabel = computed(() => {
  const src = props.card.sourceTriggers?.length
    ? props.card.sourceTriggers
    : (props.card.triggerName ? [props.card.triggerName] : []);
  if (!src.length) return '';
  // Chỉ hiện khi card là theo sequence (có sequenceName); nếu card chính là trigger
  // thì tiêu đề đã là tên đó → không lặp.
  if (!props.card.sequenceName) return '';
  if (src.length <= 2) return src.join(', ');
  return `${src.slice(0, 2).join(', ')} (+${src.length - 2})`;
});

// currentStep = số bước ĐÃ GỬI (1-based từ BE). Progress = đã gửi / tổng.
// Số bước ĐÃ GỬI THẬT (anh chốt 2026-06-07): khi còn job pending (active+nextRunAt),
// currentStep = bước ĐANG CHỜ gửi → đã gửi = currentStep - 1. Tránh nhầm "3/3 đã xong"
// trong khi mới gửi 2, bước 3 đang chờ.
const sentSteps = computed(() => {
  const c = props.card;
  if (c.currentStep == null || !c.totalSteps) return 0;
  if (c.state === 'completed') return c.totalSteps;
  if (c.state === 'active' && c.nextRunAt) return Math.max(0, c.currentStep - 1); // bước đang chờ chưa tính
  return Math.min(c.totalSteps, c.currentStep);
});
const progressPct = computed(() => {
  const c = props.card;
  if (!c.totalSteps) return 0;
  if (c.state === 'completed') return 100;
  return Math.min(100, Math.round((sentSteps.value / c.totalSteps) * 100));
});
const stepLabel = computed(() => {
  const c = props.card;
  if (c.currentStep == null || !c.totalSteps) return '';
  // Đang chạy + chờ gửi bước tiếp → "Đã gửi X/N · chờ bước Y".
  if (c.state === 'active' && c.nextRunAt && sentSteps.value < c.totalSteps) {
    return `Đã gửi ${sentSteps.value}/${c.totalSteps} · chờ bước ${sentSteps.value + 1}`;
  }
  return `${sentSteps.value}/${c.totalSteps}`;
});

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffH = (d.getTime() - now.getTime()) / 3600_000;
  const hhmm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  if (diffH >= 0 && diffH < 24) return `${hhmm} hôm nay`;
  if (diffH >= 24 && diffH < 48) return `${hhmm} mai`;
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
function formatRemaining(ms: number): string {
  if (!ms || ms <= 0) return '0m';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
</script>

<style scoped>
.fcard {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  border-left: 3px solid var(--line);
  padding: 11px 12px;
  box-shadow: var(--sh-xs);
  transition: box-shadow .14s;
}
.fcard:hover { box-shadow: var(--sh-sm); }
.fcard.active { border-left-color: var(--brand); }
.fcard.paused { border-left-color: var(--warning); }
.fcard.completed { border-left-color: var(--success); }
.fcard.stopped { border-left-color: var(--ink-4); background: var(--surface-2); }

.fc-top { display: flex; align-items: flex-start; gap: 8px; }
.fc-name {
  font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.32;
  flex: 1; display: flex; align-items: center; gap: 5px; min-width: 0;
}
.fc-lock { color: var(--brand-700); display: inline-flex; flex-shrink: 0; }
.fc-seqic { color: var(--brand); display: inline-flex; flex-shrink: 0; }
.fc-source {
  display: flex; align-items: center; gap: 5px; margin-top: 5px;
  font-size: 11px; color: var(--ink-3);
}
.fc-source .mi { color: var(--ink-4); display: inline-flex; flex-shrink: 0; }

/* cờ "Sale gắn tay" — chip mềm brand-soft, cursor help (hover xem lý do) */
.fc-manual {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 6px;
  font-size: 10.5px; font-weight: 600; color: var(--brand-700);
  background: var(--brand-soft); border-radius: var(--r-pill);
  padding: 2px 8px; cursor: help; align-self: flex-start; width: fit-content;
}
.fc-manual .mi { display: inline-flex; flex-shrink: 0; }
.fc-badge {
  flex-shrink: 0; font-size: 10.5px; font-weight: 600; padding: 2px 8px;
  border-radius: var(--r-pill); line-height: 1.5; white-space: nowrap;
}
.fc-badge.active { color: var(--brand-700); background: var(--brand-soft); }
.fc-badge.paused { color: #92400e; background: var(--warning-soft); }
.fc-badge.completed { color: #1b6b46; background: var(--success-soft); }
.fc-badge.stopped { color: var(--ink-3); background: var(--surface-3); }

.fc-prog { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.fc-bar { flex: 1; height: 5px; background: var(--surface-3); border-radius: var(--r-pill); overflow: hidden; }
.fc-fill { height: 100%; border-radius: var(--r-pill); }
.fc-fill.active { background: var(--brand); }
.fc-fill.paused { background: var(--warning); }
.fc-fill.completed { background: var(--success); }
.fc-fill.stopped { background: var(--ink-4); }
.fc-step { font-family: var(--mono); font-size: 11px; font-weight: 500; color: var(--ink-2); white-space: nowrap; }

.fc-meta { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
.fc-line { font-size: 11.5px; color: var(--ink-3); display: flex; align-items: center; gap: 5px; line-height: 1.4; }
.fc-line .mi { color: var(--ink-4); display: inline-flex; flex-shrink: 0; }
.fc-line.accent { color: var(--brand-700); font-weight: 500; }
.fc-line.accent .mi { color: var(--brand); }
.fc-line.warn { color: #92400e; font-weight: 500; }
.fc-line.warn .mi { color: var(--warning); }

.fc-eta {
  display: flex; align-items: center; gap: 5px; margin-top: 8px;
  font-size: 11px; font-weight: 500; color: var(--ink-2);
  background: var(--surface-3); border-radius: var(--r-xs); padding: 4px 8px;
}
.fc-eta .mi { color: var(--brand); display: inline-flex; flex-shrink: 0; }
.fc-eta b { font-weight: 600; color: var(--ink); }

.fc-act { display: flex; gap: 6px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--line-2); }
.fc-act.no-border { border-top: 0; padding-top: 2px; }

.btn {
  flex: 1.6; height: 30px; border-radius: var(--r-sm); font-family: inherit;
  font-size: 11.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--line);
  background: var(--surface); color: var(--ink-2); display: inline-flex;
  align-items: center; justify-content: center; gap: 4px; transition: .12s; padding: 0 8px;
}
.btn:hover:not(:disabled) { background: var(--surface-3); }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.btn.primary:hover:not(:disabled) { background: var(--brand-600); }
.btn.primary-soft { background: var(--brand-soft); color: var(--brand-700); border-color: transparent; }
.btn.primary-soft:hover:not(:disabled) { background: #d4e8f4; }
.btn.ghost { flex: 1; color: var(--ink-3); }

.ibtn {
  width: 30px; height: 30px; flex: 0 0 30px; border-radius: var(--r-sm); cursor: pointer;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-3);
  display: inline-flex; align-items: center; justify-content: center; transition: .12s; padding: 0;
}
.ibtn:hover:not(:disabled) { background: var(--surface-3); color: var(--ink); }
.ibtn:disabled { opacity: .55; cursor: not-allowed; }
.ibtn.warn:hover:not(:disabled) { background: var(--warning-soft); color: #92400e; border-color: #f7d9a3; }
.ibtn.danger:hover:not(:disabled) { background: var(--error-soft); color: var(--error); border-color: #f6c5c1; }
</style>
