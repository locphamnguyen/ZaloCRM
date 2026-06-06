<!--
  PrivacyUnlockOtpModal.vue — Phase Privacy OTP 2026-05-27

  Thay PrivacyUnlockModal cũ (PIN tự setup). 3 view:
    1. Block (chưa setup Liên lạc nội bộ) → banner + nút điều hướng
    2. Chọn duration (5/15/480/720 phút) + nút "Gửi OTP qua Zalo"
    3. Nhập 4 số OTP + countdown + resend

  Props: open (v-model)
  Emits: close, unlocked

  KHÔNG có PIN, KHÔNG setup, KHÔNG change PIN. Sale chỉ unlock qua OTP Zalo.
-->
<template>
  <div v-if="open" class="otp-overlay" @click.self="tryClose">
    <div class="otp-modal">
      <header class="otp-header">
        <h3>{{ headerTitle }}</h3>
        <button class="otp-close" :disabled="busy" @click="tryClose">×</button>
      </header>

      <!-- ── View 1: BLOCKED (no internal contact) ──────────────────── -->
      <div v-if="view === 'blocked'" class="otp-body">
        <div class="otp-banner banner-warn">
          <div class="banner-icon">⚠️</div>
          <div>
            <div class="banner-title">Anh chưa setup Liên lạc nội bộ</div>
            <div class="banner-sub">
              Cơ chế Riêng tư cần nick Zalo liên lạc nội bộ để gửi mã OTP. Vui lòng setup
              trước rồi quay lại.
            </div>
          </div>
        </div>
        <footer class="otp-footer">
          <button class="btn-secondary" @click="tryClose">Đóng</button>
          <RouterLink class="btn-primary" :to="'/settings/channels/zalo?tab=internal-contact'" @click="tryClose">
            🏠 Vào setup
          </RouterLink>
        </footer>
      </div>

      <!-- ── View 2: LOCKED (sai 5 lần liên tiếp) ───────────────────── -->
      <div v-else-if="view === 'locked'" class="otp-body">
        <div class="otp-banner banner-error">
          <div class="banner-icon">🔒</div>
          <div>
            <div class="banner-title">Tài khoản đang khóa</div>
            <div class="banner-sub">{{ lockedMessage }}</div>
            <div class="banner-sub muted-text">
              Nếu cần unlock gấp, vui lòng liên hệ admin để reset.
            </div>
          </div>
        </div>
        <footer class="otp-footer">
          <button class="btn-secondary" @click="tryClose">Đóng</button>
        </footer>
      </div>

      <!-- ── View 3: CHỌN DURATION ──────────────────────────────────── -->
      <div v-else-if="view === 'pick'" class="otp-body">
        <p class="otp-sub">
          Mở khóa để xem nội dung nick chính. Mã OTP 4 số sẽ gửi qua Zalo (nick Liên lạc nội bộ).
        </p>

        <div class="duration-grid">
          <button
            v-for="d in DURATIONS"
            :key="d.value"
            class="duration-card"
            :class="{ active: selectedDuration === d.value }"
            @click="selectedDuration = d.value"
          >
            <div class="dur-icon">{{ d.icon }}</div>
            <div class="dur-label">{{ d.label }}</div>
            <div class="dur-sub">{{ d.hint }}</div>
          </button>
        </div>

        <div v-if="errorText" class="otp-alert error">{{ errorText }}</div>

        <footer class="otp-footer">
          <button class="btn-secondary" :disabled="busy" @click="tryClose">Hủy</button>
          <button class="btn-primary" :disabled="busy || !selectedDuration" @click="onRequestOtp">
            <span v-if="busy">⏳ Đang gửi OTP...</span>
            <span v-else>📤 Gửi OTP qua Zalo</span>
          </button>
        </footer>
      </div>

      <!-- ── View 4: NHẬP OTP ────────────────────────────────────────── -->
      <div v-else-if="view === 'enter'" class="otp-body">
        <div class="otp-info">
          <div class="otp-info-icon">📨</div>
          <div>
            <div class="otp-info-title">Đã gửi OTP qua Zalo</div>
            <div class="otp-info-sub">
              Vui lòng kiểm tra Zalo nick liên lạc nội bộ. Mã có hiệu lực
              <strong class="text-orange">{{ countdownText }}</strong>.
            </div>
          </div>
        </div>

        <div class="otp-input-row">
          <input
            v-for="(_, i) in 4"
            :key="i"
            :ref="(el) => setDigitRef(el, i)"
            v-model="digits[i]"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="1"
            class="otp-digit"
            @input="onDigitInput(i, $event)"
            @keydown="onDigitKeydown(i, $event)"
            @paste="onPaste"
          />
        </div>

        <div v-if="errorText" class="otp-alert error">{{ errorText }}</div>

        <footer class="otp-footer">
          <button class="btn-secondary" :disabled="busy" @click="isToggleMode ? tryClose() : backToPick()">
            {{ isToggleMode ? '✕ Huỷ' : '← Quay lại' }}
          </button>
          <button
            class="btn-link"
            :disabled="busy || resendCooldown > 0"
            @click="onResend"
          >
            🔄 Gửi lại OTP<span v-if="resendCooldown > 0"> ({{ resendCooldown }}s)</span>
          </button>
        </footer>
      </div>

      <!-- ── View 5: SUCCESS ─────────────────────────────────────────── -->
      <div v-else-if="view === 'success'" class="otp-body">
        <div class="otp-banner banner-success">
          <div class="banner-icon">✅</div>
          <!-- Mode gạt bật/tắt -->
          <div v-if="isToggleMode">
            <div class="banner-title">
              Đã xác nhận {{ context?.action === 'enable' ? 'BẬT' : 'TẮT' }} Riêng tư
            </div>
            <div class="banner-sub">
              Nick <strong>{{ context?.nickName }}</strong> đã chuyển sang chế độ
              <strong>{{ context?.action === 'enable' ? 'Riêng tư' : 'Thường' }}</strong>.
            </div>
            <div v-if="context?.action === 'enable'" class="banner-sub muted-text">
              Muốn xem nội dung nick này, bấm "Mở khoá" để mở phiên xem.
            </div>
          </div>
          <!-- Mode mở khoá xem -->
          <div v-else>
            <div class="banner-title">Đã mở khóa Riêng tư</div>
            <div class="banner-sub">
              Phiên có hiệu lực <strong>{{ successDurationText }}</strong>.
            </div>
            <div class="banner-sub muted-text">
              Tin nhắn xác nhận đã gửi qua Zalo nick liên lạc nội bộ — anh có thể kiểm tra audit.
            </div>
          </div>
        </div>
        <footer class="otp-footer">
          <button class="btn-primary" @click="finish">Đóng</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { usePrivacyStore } from '@/stores/privacy';

const props = defineProps<{
  open: boolean;
  /** Context hành động — tin OTP nêu cụ thể nick + bật/tắt. action quyết flow:
   *  'unlock' = mở khoá XEM (chọn duration → có session); 'enable'/'disable' = gạt nick (no session). */
  context?: { action: 'enable' | 'disable' | 'unlock'; nickName?: string; nickId?: string };
}>();

// Gạt bật/tắt 1 nick → KHÔNG chọn session, vào thẳng nhập OTP. unlock → giữ bước chọn duration.
const isToggleMode = computed(() => props.context?.action === 'enable' || props.context?.action === 'disable');
const headerTitle = computed(() => {
  if (props.context?.action === 'enable') return '🔒 Xác nhận BẬT Riêng tư';
  if (props.context?.action === 'disable') return '🔓 Xác nhận TẮT Riêng tư';
  return '🔒 Mở khóa Riêng tư';
});
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'unlocked'): void;
}>();

const privacyStore = usePrivacyStore();

const DURATIONS = [
  { value: 5, label: '5 phút', icon: '⚡', hint: 'Vào nhanh xem 1 tin' },
  { value: 15, label: '15 phút', icon: '⏱', hint: 'Khuyến nghị (mặc định)' },
  { value: 480, label: '8 giờ', icon: '☀️', hint: 'Cả ca làm việc' },
  { value: 720, label: '12 giờ', icon: '🌙', hint: 'Nửa ngày' },
] as const;

type View = 'blocked' | 'locked' | 'pick' | 'enter' | 'success';
const view = ref<View>('pick');
const selectedDuration = ref<5 | 15 | 480 | 720>(15);

const tokenId = ref('');
const expiresAt = ref<Date | null>(null);
const digits = ref(['', '', '', '']);
const digitRefs = ref<(HTMLInputElement | null)[]>([null, null, null, null]);

const busy = ref(false);
const errorText = ref('');
const lockedMessage = ref('');
const successDurationText = ref('');

// Countdown timer for OTP expiry (5 phút)
const remainingMs = ref(0);
let countdownTimer: number | undefined;

// Resend cooldown (5s)
const resendCooldown = ref(0);
let resendTimer: number | undefined;

const countdownText = computed(() => {
  if (remainingMs.value <= 0) return 'hết hạn';
  const totalSec = Math.ceil(remainingMs.value / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

function setDigitRef(el: any, i: number) {
  if (el && el instanceof HTMLInputElement) digitRefs.value[i] = el;
}

function startCountdown() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(() => {
    if (!expiresAt.value) return;
    remainingMs.value = expiresAt.value.getTime() - Date.now();
    if (remainingMs.value <= 0) {
      window.clearInterval(countdownTimer);
      errorText.value = 'Mã đã hết hạn. Bấm "Gửi lại OTP".';
    }
  }, 500);
}

function startResendCooldown(seconds = 5) {
  resendCooldown.value = seconds;
  if (resendTimer) window.clearInterval(resendTimer);
  resendTimer = window.setInterval(() => {
    resendCooldown.value--;
    if (resendCooldown.value <= 0) window.clearInterval(resendTimer);
  }, 1000);
}

async function checkInitialStatus() {
  errorText.value = '';
  try {
    const s = await privacyStore.fetchOtpStatus();
    if (s.blockedReason === 'no_internal_contact') {
      view.value = 'blocked';
    } else if (s.blockedReason === 'locked' && s.lockedUntil) {
      const min = Math.ceil((new Date(s.lockedUntil).getTime() - Date.now()) / 60000);
      lockedMessage.value = `Sai mã 5 lần liên tiếp. Vui lòng đợi ${min} phút.`;
      view.value = 'locked';
    } else if (isToggleMode.value) {
      // Gạt nick → KHÔNG chọn duration, gửi OTP ngay rồi vào 'enter'.
      await onRequestOtp();
    } else {
      view.value = 'pick';
    }
  } catch (err: any) {
    errorText.value = err?.response?.data?.error || 'Không kiểm tra được trạng thái';
    view.value = isToggleMode.value ? 'enter' : 'pick';
  }
}

async function onRequestOtp() {
  busy.value = true;
  errorText.value = '';
  try {
    const result = await privacyStore.requestOtp(selectedDuration.value, props.context);
    tokenId.value = result.tokenId;
    expiresAt.value = new Date(result.expiresAt);
    remainingMs.value = expiresAt.value.getTime() - Date.now();
    digits.value = ['', '', '', ''];
    view.value = 'enter';
    startCountdown();
    startResendCooldown(5);
    // Focus 1st digit
    setTimeout(() => digitRefs.value[0]?.focus(), 100);
  } catch (err: any) {
    const code = err?.response?.data?.code;
    const msg = err?.response?.data?.error || 'Gửi OTP thất bại';
    if (code === 'NO_INTERNAL_CONTACT') {
      view.value = 'blocked';
    } else if (code === 'LOCKED') {
      lockedMessage.value = msg;
      view.value = 'locked';
    } else {
      errorText.value = msg;
    }
  } finally {
    busy.value = false;
  }
}

async function onResend() {
  await onRequestOtp();
}

async function onVerify() {
  const code = digits.value.join('');
  if (code.length !== 4) return;
  busy.value = true;
  errorText.value = '';
  try {
    const result = await privacyStore.verifyOtp(tokenId.value, code);
    // Chỉ mode unlock mới có durationMinutes (gạt không có session).
    if (result.action === 'unlock' && result.durationMinutes) {
      successDurationText.value = formatDuration(result.durationMinutes);
    }
    view.value = 'success';
    emit('unlocked');
  } catch (err: any) {
    const code = err?.response?.data?.code;
    const msg = err?.response?.data?.error || 'Verify OTP thất bại';
    if (code === 'NOW_LOCKED') {
      lockedMessage.value = msg;
      view.value = 'locked';
    } else if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_USED') {
      errorText.value = msg + ' — bấm "Gửi lại OTP".';
      digits.value = ['', '', '', ''];
    } else {
      errorText.value = msg;
      // Clear digits + refocus
      digits.value = ['', '', '', ''];
      setTimeout(() => digitRefs.value[0]?.focus(), 50);
    }
  } finally {
    busy.value = false;
  }
}

function formatDuration(m: number): string {
  if (m >= 60) {
    const h = m / 60;
    return Number.isInteger(h) ? `${h} giờ` : `${h.toFixed(1)} giờ`;
  }
  return `${m} phút`;
}

function onDigitInput(i: number, event: Event) {
  const target = event.target as HTMLInputElement;
  const v = target.value.replace(/\D/g, '');
  digits.value[i] = v.slice(0, 1);
  // Auto-focus next
  if (digits.value[i] && i < 3) {
    digitRefs.value[i + 1]?.focus();
  }
  // Auto-submit when all 4 filled
  if (i === 3 && digits.value.every((d) => d.length === 1)) {
    onVerify();
  }
}

function onDigitKeydown(i: number, event: KeyboardEvent) {
  if (event.key === 'Backspace' && !digits.value[i] && i > 0) {
    digitRefs.value[i - 1]?.focus();
  } else if (event.key === 'Enter' && digits.value.every((d) => d.length === 1)) {
    onVerify();
  }
}

function onPaste(event: ClipboardEvent) {
  event.preventDefault();
  const text = event.clipboardData?.getData('text') ?? '';
  const cleaned = text.replace(/\D/g, '').slice(0, 4).padEnd(4, '');
  for (let i = 0; i < 4; i++) {
    digits.value[i] = cleaned[i] === ' ' ? '' : cleaned[i];
  }
  if (digits.value.every((d) => d.length === 1)) {
    setTimeout(() => onVerify(), 50);
  }
}

function backToPick() {
  view.value = 'pick';
  digits.value = ['', '', '', ''];
  errorText.value = '';
  expiresAt.value = null;
  tokenId.value = '';
  if (countdownTimer) window.clearInterval(countdownTimer);
}

function tryClose() {
  if (busy.value) return;
  emit('close');
}

function finish() {
  emit('close');
}

// Reset state when opening
watch(
  () => props.open,
  (open) => {
    if (open) {
      // Toggle mode bỏ view 'pick' → hiện loading tạm tới khi checkInitialStatus chuyển 'enter'.
      view.value = isToggleMode.value ? 'enter' : 'pick';
      digits.value = ['', '', '', ''];
      errorText.value = '';
      tokenId.value = '';
      expiresAt.value = null;
      selectedDuration.value = 15;
      checkInitialStatus();
    } else {
      if (countdownTimer) window.clearInterval(countdownTimer);
      if (resendTimer) window.clearInterval(resendTimer);
    }
  },
);

onBeforeUnmount(() => {
  if (countdownTimer) window.clearInterval(countdownTimer);
  if (resendTimer) window.clearInterval(resendTimer);
});
</script>

<style scoped>
.otp-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1000;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.otp-modal {
  background: white; border-radius: 14px; width: 100%; max-width: 480px;
  max-height: 90vh; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}
.otp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.otp-header h3 { margin: 0; font-size: 17px; font-weight: 600; color: #181d26; }
.otp-close {
  border: 0; background: transparent; font-size: 24px; cursor: pointer;
  width: 32px; height: 32px; line-height: 1; border-radius: 6px; color: #555;
}
.otp-close:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
.otp-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
.otp-sub { font-size: 13px; color: #555; margin: 0; line-height: 1.5; }

.duration-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.duration-card {
  border: 1.5px solid #d6d8de; background: white; border-radius: 9px;
  padding: 14px 12px; cursor: pointer; transition: all 0.15s;
  font: inherit; text-align: center;
  display: flex; flex-direction: column; gap: 4px;
}
.duration-card:hover { border-color: #6b8cdf; background: #f5f7fb; }
.duration-card.active { border-color: #2d6cdf; background: #e8f0fc; box-shadow: 0 0 0 3px rgba(45, 108, 223, 0.15); }
.dur-icon { font-size: 20px; }
.dur-label { font-weight: 600; font-size: 14px; color: #181d26; }
.dur-sub { font-size: 11px; color: #888; }

.otp-info {
  display: flex; gap: 12px; padding: 12px 14px;
  background: #eef4ff; border-radius: 9px; border-left: 3px solid #2d6cdf;
}
.otp-info-icon { font-size: 22px; }
.otp-info-title { font-weight: 600; font-size: 14px; color: #1a4ba8; }
.otp-info-sub { font-size: 13px; color: #444; margin-top: 3px; line-height: 1.5; }
.text-orange { color: #d97706; }

.otp-input-row { display: flex; gap: 12px; justify-content: center; margin: 8px 0; }
.otp-digit {
  width: 56px; height: 64px; text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 28px; font-weight: 700;
  border: 2px solid #d6d8de; border-radius: 9px; background: white;
  color: #181d26;
}
.otp-digit:focus { outline: 2px solid #2d6cdf55; border-color: #2d6cdf; }

.otp-banner { display: flex; gap: 12px; padding: 14px; border-radius: 10px; }
.banner-icon { font-size: 28px; }
.banner-title { font-weight: 600; font-size: 15px; }
.banner-sub { font-size: 13px; line-height: 1.5; margin-top: 4px; }
.muted-text { color: #888; }
.banner-warn { background: #fff8e1; color: #6d4c00; border-left: 3px solid #fbc02d; }
.banner-error { background: #fdecea; color: #b71c1c; border-left: 3px solid #d9534f; }
.banner-success { background: #e6f4ea; color: #1e6e2c; border-left: 3px solid #34a853; }

.otp-alert {
  padding: 9px 12px; border-radius: 7px; font-size: 13px;
  border-left: 3px solid;
}
.otp-alert.error { background: #fdecea; color: #b71c1c; border-color: #d9534f; }

.otp-footer {
  display: flex; gap: 10px; justify-content: flex-end; align-items: center;
  padding-top: 12px; border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.btn-primary {
  background: #2d6cdf; color: white; border: 0; padding: 9px 16px;
  border-radius: 7px; font: inherit; font-weight: 500; cursor: pointer;
  text-decoration: none; display: inline-block;
}
.btn-primary:disabled { background: #aac4ec; cursor: not-allowed; }
.btn-secondary {
  background: transparent; color: #555; border: 1px solid #cfcfcf;
  padding: 9px 16px; border-radius: 7px; font: inherit; cursor: pointer;
}
.btn-link {
  background: transparent; border: 0; color: #2d6cdf; cursor: pointer;
  font: inherit; padding: 6px 8px; margin-right: auto;
}
.btn-link:disabled { color: #aac4ec; cursor: not-allowed; }
</style>
