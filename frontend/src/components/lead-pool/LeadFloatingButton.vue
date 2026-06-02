<!--
  LeadFloatingButton — Phase Lead Pool v3 2026-05-28.
  Dynamic FAB 3 mode (available/cooldown/pending) + hover tooltip rich + admin reset.
  Scale-ready cho 50 sale × 100 nick: cap 5 + "Xem tất cả" modal.
-->
<template>
  <!-- 2026-06-01: prop `inline` = anchor inside sidebar (no Teleport).
       Default (no inline) = legacy floating bottom-right qua Teleport. -->
  <component :is="inline ? 'div' : Teleport" :to="inline ? undefined : 'body'">
    <div
      v-if="state.enabled && (inline || isChatRoute)"
      class="lfb-wrap"
      :class="{ 'lfb-inline': inline }"
      @mouseenter="onHover"
      @mouseleave="onLeave"
    >

      <!-- Rich tooltip — Teleport ra body trong inline mode để không bị cột 2 che. -->
      <Teleport :to="inline ? 'body' : undefined" :disabled="!inline">
      <div
        v-if="showTooltip"
        class="lfb-tooltip-rich"
        :class="{ 'lfb-tooltip-floating': inline }"
        :style="inline && tooltipPos ? { top: tooltipPos.top + 'px', left: tooltipPos.left + 'px' } : undefined"
        @mouseenter="cancelHide"
        @mouseleave="onLeave"
      >
        <div v-if="loadingStats" class="lfb-tip-loading">Đang tải...</div>
        <div v-else-if="!stats" class="lfb-tip-loading">Không tải được dữ liệu</div>
        <template v-else>
          <div class="lfb-tip-head">
            <div class="lfb-tip-head-main">
              <span class="lfb-tip-title">🎁 Nhận khách</span>
              <span class="lfb-tip-subtitle" :title="'Số khách bạn có thể bấm Nhận khách để xin tiếp. Đã trừ khách bạn đang giữ + sale khác đang chăm + khách đang khoá.'">
                <strong>{{ stats.poolAvailable }}</strong> khách bạn có thể xin
              </span>
            </div>
            <span class="lfb-tip-role">{{ roleLabel }}</span>
          </div>

          <div class="lfb-tip-section">
            <div class="lfb-tip-section-title">Bạn hôm nay</div>
            <div class="lfb-tip-row" :title="'Số lượt cho phép: ' + (stats.my.bonusToday > 0 ? (stats.config.maxPerDay + ' lượt mặc định + ' + stats.my.bonusToday + ' lượt quản lý cấp thêm = ' + stats.my.effectiveCap) : stats.config.maxPerDay + ' lượt mặc định') + ' / ngày'">
              <span>Lượt còn</span>
              <strong>
                {{ stats.my.remainingToday }} / {{ stats.my.effectiveCap ?? stats.config.maxPerDay }} lượt
                <span v-if="stats.my.bonusToday > 0" class="bonus-tag">+{{ stats.my.bonusToday }} thưởng</span>
              </strong>
            </div>
            <div class="lfb-tip-row" title="Số khách thực tế trong kho có thể xin (sau khi trừ khách bạn đang giữ, sale khác đang chăm và khách đang khoá).">
              <span>Khách có sẵn</span><strong>{{ stats.poolAvailable }} khách</strong>
            </div>
            <div class="lfb-tip-row lfb-tip-row-highlight" title="Số khách bạn nhận được = số nhỏ hơn giữa (Lượt còn) và (Khách có sẵn)">
              <span>→ Xin được tiếp</span>
              <strong class="ok">{{ Math.min(stats.my.remainingToday, stats.poolAvailable) }} khách</strong>
            </div>
            <div class="lfb-tip-divider"></div>
            <div class="lfb-tip-row"><span>Đã nhận</span><strong>{{ stats.my.requestedToday }}</strong></div>
            <div class="lfb-tip-row"><span>Đã ghi chú</span><strong class="ok">{{ stats.my.noted }}</strong></div>
            <div v-if="stats.my.pending > 0" class="lfb-tip-row"><span>⚠ Chưa ghi chú</span><strong class="warn">{{ stats.my.pending }}</strong></div>
            <ul v-if="stats.my.history.length" class="lfb-tip-history">
              <li
                v-for="h in stats.my.history.slice(0, 5)"
                :key="h.id"
                class="lfb-tip-his-item"
                :class="'his-' + historyStatus(h)"
                :title="historyStatusTitle(h)"
              >
                <span class="lfb-tip-his-icon">{{ historyStatusIcon(h) }}</span>
                <span class="lfb-tip-his-name">{{ h.contactName }}</span>
                <span class="lfb-tip-his-tag">{{ historyStatusTag(h) }}</span>
                <span class="lfb-tip-his-time">{{ formatTime(h.requestedAt) }}</span>
              </li>
            </ul>
          </div>

          <div v-if="stats.team" class="lfb-tip-section lfb-tip-team">
            <div class="lfb-tip-section-title">👥 Phòng {{ stats.team.departmentName }} ({{ stats.team.memberCount }} nhân viên)</div>
            <div class="lfb-tip-row"><span>Tổng nhận hôm nay</span><strong>{{ stats.team.totalLeadsToday }}</strong></div>
            <ul class="lfb-tip-members">
              <li v-for="m in stats.team.members.slice(0, 5)" :key="m.userId" class="lfb-tip-member">
                <span class="lfb-tip-m-name">{{ m.fullName }}</span>
                <span class="lfb-tip-m-stats">{{ m.requestedToday }} nhận · <span class="ok">{{ m.notedToday }} ghi chú</span><span v-if="m.pendingNote > 0"> · <span class="warn">{{ m.pendingNote }} chưa ghi chú</span></span></span>
                <button
                  class="lfb-reset-btn"
                  :disabled="m.notedToday === 0 && m.requestedToday === 0"
                  :title="`Duyệt và cấp thêm lượt cho ${m.fullName}`"
                  @click.stop="openResetForUser(m.userId, m.fullName)"
                >🔄 Cấp thêm</button>
              </li>
            </ul>
            <button
              v-if="stats.team.members.length > 5"
              class="lfb-see-all"
              @click.stop="openTeamFullList(stats.team.members, `👥 Team ${stats.team.departmentName}`)"
            >Xem tất cả {{ stats.team.members.length }} người →</button>
          </div>

          <div v-if="stats.org" class="lfb-tip-section lfb-tip-org">
            <div class="lfb-tip-section-title">🏢 Toàn tổ chức</div>
            <div class="lfb-tip-row"><span>Khách chia hôm nay</span><strong>{{ stats.org.totalLeadsToday }}</strong></div>
            <div class="lfb-tip-row"><span>Nick Zalo rảnh ({{ stats.org.idleNickCount }})</span><strong>sẵn sàng chia</strong></div>
            <ul v-if="stats.org.idleNicks.length" class="lfb-tip-nicks">
              <li v-for="n in stats.org.idleNicks.slice(0, 5)" :key="n.id" class="lfb-tip-nick">
                💤 {{ n.displayName }} <span class="muted">— {{ n.ownerName }}</span>
              </li>
            </ul>
            <button
              v-if="stats.org.idleNicks.length > 5"
              class="lfb-see-all"
              @click.stop="openNicksFullList(stats.org.idleNicks, `💤 Nick rảnh trong org`)"
            >Xem tất cả {{ stats.org.idleNicks.length }} nick →</button>
            <div v-if="stats.org.topSales.length" class="lfb-tip-section-title" style="margin-top: 8px;">Nhân viên nhận nhiều nhất</div>
            <ul class="lfb-tip-members">
              <li v-for="s in stats.org.topSales" :key="s.userId" class="lfb-tip-member">
                <span class="lfb-tip-m-name">{{ s.fullName }}</span>
                <strong>{{ s.requestedToday }}</strong>
                <button
                  class="lfb-reset-btn"
                  :title="`Review & reset quota cho ${s.fullName}`"
                  @click.stop="openResetForUser(s.userId, s.fullName)"
                >🔄 Cấp thêm</button>
              </li>
            </ul>
          </div>
        </template>
      </div>
      </Teleport>

      <!-- Dynamic button -->
      <button
        class="lfb-btn"
        :class="{
          'lfb-disabled': btnMode === 'cooldown',
          'lfb-warn': btnMode === 'pending',
          'lfb-pulse': btnMode === 'available',
          'lfb-pending-blink': btnMode === 'pending',
        }"
        @click="onClick"
      >
        <span class="lfb-icon">🎁</span>

        <template v-if="btnMode === 'pending'">
          <span class="lfb-pending-info">
            <span class="lfb-pending-name">{{ pendingContactName }}</span>
            <span v-if="pendingPhone" class="lfb-pending-phone">{{ pendingPhone }}</span>
          </span>
          <span class="lfb-pending-countdown">⏱ {{ expiresLabel }}</span>
        </template>

        <template v-else-if="btnMode === 'cooldown'">
          <span class="lfb-text">Đợi {{ cooldownLabel }}</span>
        </template>

        <template v-else>
          <span class="lfb-text">Nhận khách</span>
          <!-- Badge = min(quota còn, pool sẵn) khi đã hover (stats loaded), fallback quota khi chưa.
               Đồng bộ với tooltip "→ Xin được tiếp" để anh thấy 1 con số nhất quán. -->
          <span
            v-if="effectiveAvailable !== undefined"
            class="lfb-badge"
            :title="badgeTitle"
          >{{ effectiveAvailable }}</span>
        </template>
      </button>
    </div>

    <div v-if="errorMessage" class="lfb-toast" @click="errorMessage = ''">
      <span class="lfb-toast-icon">{{ errorIsInfo ? 'ℹ' : '⚠' }}</span>
      <div class="lfb-toast-body">{{ errorMessage }}</div>
      <span class="lfb-toast-close">✕</span>
    </div>

    <LeadRequestModal
      v-if="leadOpen"
      :lead="leadData"
      @close="onLeadClose"
      @note-submitted="onAfterAction"
      @returned="onAfterAction"
    />

    <AdminQuotaResetModal
      :open="resetOpen"
      :target-user-id="resetTargetUserId"
      :target-user-name="resetTargetUserName"
      @close="resetOpen = false"
      @granted="onResetGranted"
    />

    <PoolListModal
      :open="poolListOpen"
      :kind="poolListKind"
      :title="poolListTitle"
      :items="poolListItems"
      :can-reset="poolListKind === 'members'"
      @close="poolListOpen = false"
      @reset="onPoolListReset"
    />
  </component>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, onUnmounted, Teleport, nextTick } from 'vue';

// 2026-06-01: prop `inline` chuyển anchor từ floating bottom-right → inline trong parent (sidebar).
const props = defineProps<{ inline?: boolean }>();

// Tooltip position cho inline mode — compute từ button rect, position fixed body
const tooltipPos = ref<{ top: number; left: number } | null>(null);
import { useRoute } from 'vue-router';
import { api } from '@/api/index';
import { useLeadPool, type LeadPayload, type Eligibility } from '@/composables/use-lead-pool';
import LeadRequestModal from './LeadRequestModal.vue';
import AdminQuotaResetModal from './AdminQuotaResetModal.vue';
import PoolListModal from './PoolListModal.vue';

const route = useRoute();

const {
  eligibility,
  cooldownSecondsLeft,
  cooldownLabel,
  fetchEligibility,
  requestNewLead,
  fetchStats,
  requesting,
  error: leadError,
} = useLeadPool();

const leadOpen = ref(false);
const leadData = ref<LeadPayload | null>(null);
const errorMessage = ref('');
const errorIsInfo = ref(false);
let errorTimer: number | null = null;

const showTooltip = ref(false);
const stats = ref<any>(null);
const loadingStats = ref(false);
let hoverTimer: number | null = null;
let hideTimer: number | null = null;

// Live tick mỗi giây cho countdown thu hồi pending lead
const nowTick = ref(Date.now());
let tickInterval: number | null = null;

// 2026-05-28: FAB chỉ hiện ở UI chat (anh chốt — các trang khác ẩn để không vướng)
const isChatRoute = computed(() => route.path.startsWith('/chat'));

const state = computed(() => {
  const e = eligibility.value;
  if (!e) return { enabled: false, canRequest: false, remainingToday: undefined as number | undefined, reason: undefined as Eligibility['reason'], pendingNoteLead: undefined as Eligibility['pendingNoteLead'], config: { noteMinLength: 20 } as any };
  return { enabled: e.config.enabled, canRequest: e.canRequest, remainingToday: e.remainingToday, reason: e.reason, pendingNoteLead: e.pendingNoteLead, config: e.config };
});

type BtnMode = 'available' | 'cooldown' | 'pending';
const btnMode = computed<BtnMode>(() => {
  if (state.value.reason === 'unsubmitted_note') return 'pending';
  if (state.value.reason === 'cooldown') return 'cooldown';
  return 'available';
});

const pendingContactName = computed(() => state.value.pendingNoteLead?.contactName || 'KH chưa đặt tên');
const pendingPhone = computed(() => {
  const p = state.value.pendingNoteLead?.contactPhone;
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) {
    return '0' + digits.slice(2, 5) + ' ' + digits.slice(5, 8) + ' ' + digits.slice(8);
  }
  return p;
});

const expiresLabel = computed(() => {
  const exp = state.value.pendingNoteLead?.expiresAt;
  if (!exp) return '—';
  const diff = new Date(exp).getTime() - nowTick.value;
  if (diff <= 0) return '00:00:00';
  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
});

const roleLabel = computed(() => {
  const r = stats.value?.role;
  if (r === 'owner') return '👑 Chủ tổ chức';
  if (r === 'admin') return '🛡 Quản trị';
  if (stats.value?.team) return '🎖 Quản lý';
  return '👤 Nhân viên';
});

// Bug fix: auto-refresh khi countdown cooldown hết
watch(cooldownSecondsLeft, (val, oldVal) => {
  if (oldVal > 0 && val === 0) setTimeout(() => void fetchEligibility(), 500);
});

// 2026-05-28: lead pending đã quá expiresAt → server tự reap. Watch expiresLabel
// về "00:00:00" trong pending mode → re-fetch để FAB hết hiện pending.
watch(expiresLabel, (val, oldVal) => {
  if (btnMode.value === 'pending' && oldVal && oldVal !== '00:00:00' && val === '00:00:00') {
    setTimeout(() => void fetchEligibility(), 600);
  }
});

function computeTooltipPos() {
  // 2026-06-01: inline mode — compute tooltip position từ button rect (fixed body).
  if (!props.inline) return;
  const btn = document.querySelector('.lfb-wrap.lfb-inline .lfb-btn') as HTMLElement | null;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const TOOLTIP_W = 320;
  const TOOLTIP_MAX_H = window.innerHeight * 0.7;
  // Default: render bên phải button + 12px gap
  let left = r.right + 12;
  // Clamp nếu tràn viewport phải → render bên trái
  if (left + TOOLTIP_W > window.innerWidth - 16) {
    left = r.left - TOOLTIP_W - 12;
  }
  // Clamp top để không tràn viewport dọc
  let top = r.top;
  if (top + TOOLTIP_MAX_H > window.innerHeight - 16) {
    top = window.innerHeight - TOOLTIP_MAX_H - 16;
  }
  if (top < 16) top = 16;
  tooltipPos.value = { top, left };
}

function onHover() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (showTooltip.value) return;
  hoverTimer = window.setTimeout(async () => {
    showTooltip.value = true;
    if (props.inline) nextTick(computeTooltipPos);
    if (!stats.value) {
      loadingStats.value = true;
      stats.value = await fetchStats();
      loadingStats.value = false;
    }
  }, 250);
}
function onLeave() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  hideTimer = window.setTimeout(() => { showTooltip.value = false; }, 200);
}
function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }

function showToast(msg: string, info = false) {
  errorMessage.value = msg;
  errorIsInfo.value = info;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => { errorMessage.value = ''; }, 5000);
}

// Re-open modal lead cũ khi sale có pending lead (note chưa)
async function reopenPendingLead() {
  const pending = state.value.pendingNoteLead;
  if (!pending) return;
  try {
    // 2026-05-28: gọi endpoint mới rebuild full payload (hasZaloFromMyNick + autoLookup +
    // gender personalize). Trước fix: load từ /contacts/:id → thiếu data → tag sai +
    // câu chào "anh/chị" generic + nút "Mở chat" không biết nick nào.
    const { data } = await api.get(`/lead-pool/${pending.leadRequestId}/payload`);
    leadData.value = data as LeadPayload;
    leadOpen.value = true;
  } catch (err: any) {
    showToast(err?.response?.data?.error || 'Không tải được khách cũ. Vui lòng tải lại trang.');
  }
}

async function onClick() {
  if (requesting.value) return;
  errorMessage.value = '';

  if (btnMode.value === 'pending') {
    await reopenPendingLead();
    return;
  }

  if (btnMode.value === 'cooldown') {
    showToast(`Đợi ${cooldownLabel.value} nữa để nhận khách tiếp`);
    return;
  }

  if (!state.value.canRequest) {
    if (state.value.reason === 'daily_cap') showToast('Bạn đã hết lượt nhận khách hôm nay. Quay lại ngày mai nhé.');
    else if (state.value.reason === 'disabled') showToast('Tính năng Nhận khách đang tắt');
    else showToast('Không thể nhận khách lúc này');
    return;
  }

  const lead = await requestNewLead();
  if (lead) {
    leadData.value = lead;
    leadOpen.value = true;
    stats.value = null;
  } else {
    showToast(leadError.value || 'Không nhận được khách');
    void fetchEligibility();
  }
}

function onLeadClose() { leadOpen.value = false; leadData.value = null; }
function onAfterAction() { leadOpen.value = false; leadData.value = null; stats.value = null; void fetchEligibility(); }

// ── Admin reset quota (2026-05-28) ──
const resetOpen = ref(false);
const resetTargetUserId = ref<string | null>(null);
const resetTargetUserName = ref<string | null>(null);
function openResetForUser(userId: string, userName: string) {
  resetTargetUserId.value = userId;
  resetTargetUserName.value = userName;
  resetOpen.value = true;
  showTooltip.value = false;
}
function onResetGranted(payload: { bonusCount: number; reviewedCount: number }) {
  showToast(`✅ Đã cấp thêm +${payload.bonusCount} lượt. Đã duyệt ${payload.reviewedCount} khách.`, true);
  stats.value = null;
  void fetchEligibility();
}

// ── PoolListModal — Xem tất cả team members + idle nicks ──
const poolListOpen = ref(false);
const poolListKind = ref<'members' | 'nicks'>('members');
const poolListTitle = ref('');
const poolListItems = ref<any[]>([]);
function openTeamFullList(items: any[], title: string) {
  poolListKind.value = 'members';
  poolListTitle.value = title;
  poolListItems.value = items;
  poolListOpen.value = true;
  showTooltip.value = false;
}
function openNicksFullList(items: any[], title: string) {
  poolListKind.value = 'nicks';
  poolListTitle.value = title;
  poolListItems.value = items;
  poolListOpen.value = true;
  showTooltip.value = false;
}
function onPoolListReset(payload: { userId: string; fullName: string }) {
  poolListOpen.value = false;
  openResetForUser(payload.userId, payload.fullName);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 2026-05-29 — Badge button hiển thị số lead anh THỰC SỰ nhận được = min(quota còn, pool sẵn).
// Khi chưa load stats (chưa hover tooltip) → fallback remainingToday (quota).
// Khi load stats rồi → min(quota, pool).
const effectiveAvailable = computed<number | undefined>(() => {
  const quota = state.value.remainingToday;
  if (quota === undefined) return undefined;
  const pool = stats.value?.poolAvailable;
  if (pool === undefined || pool === null) return quota;
  return Math.min(quota, pool);
});
const badgeTitle = computed(() => {
  const quota = state.value.remainingToday;
  const pool = stats.value?.poolAvailable;
  if (quota === undefined) return 'Số lead bạn xin được tiếp';
  if (pool === undefined || pool === null) return `Còn ${quota} lượt quota hôm nay (chưa biết pool size)`;
  if (pool < quota) return `Pool chỉ có ${pool} lead (quota còn ${quota} lượt) → nhận được ${pool}`;
  return `Còn ${quota} lượt quota · pool có ${pool} lead`;
});

// 2026-05-29 — phân biệt 4 trạng thái lead trong tooltip FAB.
// BE trả về h.status. Fallback derive nếu cũ.
type LeadStatusKey = 'caring' | 'manual_return' | 'auto_return' | 'pending';
interface HistoryItem { id: string; contactName: string; requestedAt: string; noted?: boolean; returned?: boolean; status?: LeadStatusKey; source?: string }
function historyStatus(h: HistoryItem): LeadStatusKey {
  if (h.status) return h.status;
  if (h.noted && h.returned) return 'manual_return'; // best-effort fallback
  if (h.returned) return 'auto_return';
  if (h.noted) return 'caring';
  return 'pending';
}
function historyStatusIcon(h: HistoryItem): string {
  const s = historyStatus(h);
  return ({ caring: '✓', manual_return: '↩', auto_return: '⏱', pending: '⏳' } as Record<LeadStatusKey, string>)[s];
}
function historyStatusTag(h: HistoryItem): string {
  const s = historyStatus(h);
  return ({ caring: 'Đang chăm', manual_return: 'Đã trả', auto_return: 'Tự trả', pending: 'Chưa ghi chú' } as Record<LeadStatusKey, string>)[s];
}
function historyStatusTitle(h: HistoryItem): string {
  const s = historyStatus(h);
  const t = ({
    caring: 'Đã ghi chú, đang chăm khách',
    manual_return: 'Đã chủ động trả lại kho',
    auto_return: 'Quá hạn ghi chú — hệ thống tự trả lại',
    pending: 'Đang chờ bạn ghi chú',
  } as Record<LeadStatusKey, string>)[s];
  return `${h.contactName} · ${t}`;
}

onMounted(() => {
  void fetchEligibility();
  tickInterval = window.setInterval(() => { nowTick.value = Date.now(); }, 1000);
});
onUnmounted(() => { if (tickInterval) clearInterval(tickInterval); });

watch(() => route.path, (path) => {
  if (path.startsWith('/chat')) { void fetchEligibility(); stats.value = null; }
});
</script>

<style scoped>
.lfb-wrap {
  position: fixed; bottom: 24px; right: 24px; z-index: 95;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
}
/* 2026-06-01: inline mode trong sidebar — RESET hết position legacy (bottom/right từ FAB cũ). */
.lfb-wrap.lfb-inline {
  position: relative;
  bottom: auto;
  right: auto;
  top: auto;
  left: auto;
  inset: auto;
  z-index: auto;
  align-items: stretch;
  gap: 6px;
  width: 100%;
}
/* Inline tooltip — teleport ra body + fixed position theo button rect (tránh bị cột 2 che). */
.lfb-tooltip-rich.lfb-tooltip-floating {
  position: fixed;
  z-index: 9999;
  margin: 0;
}
.lfb-wrap.lfb-inline .lfb-btn {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 2px 8px rgba(255, 105, 5, 0.15);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lfb-wrap.lfb-inline .lfb-btn::before {
  /* Pulse ring effect cho inline mode */
  content: '';
  position: absolute;
  inset: -3px;
  border: 1.5px solid #FF6905;
  border-radius: 10px;
  opacity: 0;
  animation: lfb-pulse 2s ease-out infinite;
  pointer-events: none;
}
@keyframes lfb-pulse {
  0% { opacity: 0.6; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.06); }
}

/* Tooltip rich */
.lfb-tooltip-rich {
  background: white; border: 1px solid #E5E7EB; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  width: 320px; max-height: 70vh;
  overflow-y: auto; /* Fix 2026-05-29: scroll dọc khi content dài (admin có team+org section) */
  font-size: 12.5px; color: #0F172A;
  animation: lfb-tip-in 0.15s ease-out;
  /* overflow:hidden BỎ — gây không scroll. Header gradient sẽ tự fit nhờ overflow-y: auto clip Y */
}
/* Custom scrollbar slim — không chiếm chỗ */
.lfb-tooltip-rich::-webkit-scrollbar { width: 6px; }
.lfb-tooltip-rich::-webkit-scrollbar-track { background: transparent; }
.lfb-tooltip-rich::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
.lfb-tooltip-rich::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
/* Header phải có border-radius top để khớp wrapper khi scroll */
.lfb-tip-head { border-radius: 12px 12px 0 0; }
@keyframes lfb-tip-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.lfb-tip-loading { padding: 20px; text-align: center; color: #94A3B8; }

/* Header gradient indigo — anh chốt 2026-05-29 */
.lfb-tip-head {
  background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
  padding: 10px 14px; display: flex; justify-content: space-between;
  align-items: center; gap: 8px; color: white;
}
.lfb-tip-head-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.lfb-tip-title { font-weight: 800; color: white; font-size: 14px; letter-spacing: -0.01em; line-height: 1.15; }
.lfb-tip-subtitle { font-size: 11px; color: rgba(255, 255, 255, 0.82); font-weight: 500; line-height: 1.2; }
.lfb-tip-subtitle strong { color: #FCD34D; font-weight: 800; font-size: 12px; }
.lfb-tip-role {
  font-size: 10.5px; background: rgba(255, 255, 255, 0.18);
  color: white; padding: 3px 9px; border-radius: 9999px;
  font-weight: 700; white-space: nowrap; flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.22); letter-spacing: 0.01em;
  backdrop-filter: blur(2px);
}

.lfb-tip-section { padding: 10px 14px; }
.lfb-tip-section + .lfb-tip-section { border-top: 1px dashed #E5E7EB; }
.lfb-tip-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #94A3B8; font-weight: 700; margin-bottom: 6px; }
.lfb-tip-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; }
.lfb-tip-row span { color: #64748B; }
.lfb-tip-row strong { color: #0F172A; font-weight: 700; }
.lfb-tip-row strong.ok { color: #047857; }
.lfb-tip-row strong.warn { color: #B91C1C; }
.lfb-tip-row-highlight { background: #ECFDF5; margin: 2px -4px; padding: 4px 6px; border-radius: 6px; border-left: 3px solid #10B981; }
.lfb-tip-row-highlight span { color: #047857; font-weight: 600; }
.lfb-tip-divider { height: 1px; background: #E5E7EB; margin: 4px 0; }
.bonus-tag { display: inline-block; background: linear-gradient(135deg, #FBBF24, #F59E0B); color: white; font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 8px; margin-left: 4px; vertical-align: middle; letter-spacing: 0.03em; box-shadow: 0 1px 2px rgba(245, 158, 11, 0.3); }
.ok { color: #047857; }
.warn { color: #B91C1C; }
.muted { color: #94A3B8; }
.lfb-tip-history, .lfb-tip-members, .lfb-tip-nicks { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 4px; }
.lfb-tip-his-item {
  display: flex; align-items: center; gap: 6px; font-size: 11.5px;
  padding: 4px 8px; background: #F8FAFC; border-radius: 6px;
  border-left: 3px solid transparent;
}
.lfb-tip-his-icon { font-size: 12px; flex-shrink: 0; width: 14px; text-align: center; }
.lfb-tip-his-name { flex: 1; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lfb-tip-his-tag {
  font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 8px;
  text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;
}
.lfb-tip-his-time { color: #94A3B8; font-variant-numeric: tabular-nums; font-size: 11px; flex-shrink: 0; }
/* 4 trạng thái — anh chốt 2026-05-29 */
.lfb-tip-his-item.his-caring { background: #ECFDF5; border-left-color: #10B981; }
.lfb-tip-his-item.his-caring .lfb-tip-his-icon { color: #047857; }
.lfb-tip-his-item.his-caring .lfb-tip-his-tag { background: #D1FAE5; color: #065F46; }
.lfb-tip-his-item.his-manual_return { background: #FFF7ED; border-left-color: #F97316; }
.lfb-tip-his-item.his-manual_return .lfb-tip-his-icon { color: #C2410C; }
.lfb-tip-his-item.his-manual_return .lfb-tip-his-tag { background: #FFEDD5; color: #9A3412; }
.lfb-tip-his-item.his-auto_return { background: #FEF2F2; border-left-color: #EF4444; }
.lfb-tip-his-item.his-auto_return .lfb-tip-his-icon { color: #B91C1C; }
.lfb-tip-his-item.his-auto_return .lfb-tip-his-tag { background: #FEE2E2; color: #991B1B; }
.lfb-tip-his-item.his-pending { background: #FEFCE8; border-left-color: #EAB308; }
.lfb-tip-his-item.his-pending .lfb-tip-his-icon { color: #A16207; }
.lfb-tip-his-item.his-pending .lfb-tip-his-tag { background: #FEF3C7; color: #92400E; }
.lfb-tip-member { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; padding: 4px 8px; background: #F8FAFC; border-radius: 6px; }
.lfb-reset-btn {
  background: #EEF0FF; border: 1px solid #C7D2FE;
  color: #4F46E5; font-weight: 700; font-size: 10.5px;
  padding: 2px 7px; border-radius: 6px;
  cursor: pointer; font-family: inherit;
  white-space: nowrap; flex-shrink: 0;
}
.lfb-reset-btn:hover:not(:disabled) { background: #5E6AD2; color: white; border-color: #5E6AD2; }
.lfb-reset-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.lfb-see-all {
  display: block; width: 100%;
  margin-top: 6px; padding: 5px 10px;
  background: transparent;
  border: 1px dashed #C7D2FE;
  border-radius: 6px;
  font-size: 11px; font-weight: 600; color: #5E6AD2;
  cursor: pointer; font-family: inherit;
  text-align: center; transition: all 0.12s;
}
.lfb-see-all:hover { background: #EEF0FF; border-style: solid; }
.lfb-tip-m-name { color: #0F172A; font-weight: 600; }
.lfb-tip-m-stats { color: #64748B; font-size: 11px; }
.lfb-tip-nick { font-size: 11.5px; color: #475569; padding: 3px 8px; background: #F1F5F9; border-radius: 6px; }

/* Button */
.lfb-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 20px; border: none; border-radius: 9999px;
  background: linear-gradient(135deg, #5E6AD2 0%, #4F46E5 100%);
  color: white; font-weight: 700; font-size: 14px;
  font-family: inherit; cursor: pointer;
  box-shadow: 0 8px 24px rgba(94, 106, 210, 0.35);
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
  position: relative;
  max-width: 360px;
}
.lfb-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(94, 106, 210, 0.45); }
.lfb-btn:active { transform: translateY(0); }
.lfb-disabled {
  background: linear-gradient(135deg, #94A3B8 0%, #64748B 100%);
  cursor: not-allowed;
  box-shadow: 0 4px 12px rgba(100, 116, 139, 0.25);
}
.lfb-warn {
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
  box-shadow: 0 8px 24px rgba(217, 119, 6, 0.4);
}
.lfb-pulse::before {
  content: ''; position: absolute; inset: 0;
  border-radius: inherit; border: 2px solid #5E6AD2;
  animation: lfb-pulse 2s infinite; pointer-events: none;
}
@keyframes lfb-pulse {
  0% { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(1.25); opacity: 0; }
}
.lfb-pending-blink {
  animation: lfb-blink 1.5s ease-in-out infinite;
}
@keyframes lfb-blink {
  0%, 100% { box-shadow: 0 8px 24px rgba(217, 119, 6, 0.4); }
  50% { box-shadow: 0 8px 24px rgba(220, 38, 38, 0.55), 0 0 0 4px rgba(217, 119, 6, 0.3); }
}

.lfb-icon { font-size: 18px; flex-shrink: 0; }
.lfb-text { letter-spacing: 0.02em; }
.lfb-badge {
  background: rgba(255, 255, 255, 0.25);
  color: white; padding: 2px 9px; border-radius: 9999px;
  font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
}

/* Pending mode */
.lfb-pending-info {
  display: flex; flex-direction: column; gap: 0;
  font-size: 12px; line-height: 1.2;
  min-width: 0; flex: 1;
}
.lfb-pending-name {
  font-weight: 800;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 130px;
}
.lfb-pending-phone {
  font-size: 10.5px; opacity: 0.85;
  font-variant-numeric: tabular-nums;
  animation: lfb-phone-blink 1.2s ease-in-out infinite;
}
@keyframes lfb-phone-blink {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 0.3; }
}
.lfb-pending-countdown {
  background: rgba(255, 255, 255, 0.95);
  color: #B91C1C;
  font-size: 11.5px; font-weight: 800;
  font-variant-numeric: tabular-nums;
  padding: 3px 8px; border-radius: 6px;
  flex-shrink: 0;
}

/* Toast */
.lfb-toast {
  background: white; border: 1px solid #FCA5A5;
  border-left: 4px solid #DC2626;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex; align-items: center; gap: 10px;
  box-shadow: 0 8px 24px rgba(220, 38, 38, 0.2);
  max-width: 360px;
  cursor: pointer;
  animation: lfb-tip-in 0.18s ease-out;
}
.lfb-toast-icon { font-size: 16px; }
.lfb-toast-body { flex: 1; font-size: 12.5px; color: #0F172A; line-height: 1.4; }
.lfb-toast-close { font-size: 14px; color: #94A3B8; }
</style>
