<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  InternalContactSetupPage — Phase Internal Contact 2-method 2026-05-23.

  Sale chọn 1 trong 2 cách nhận system notification:
    Cách 1 'crm_nick'       : nick OWN trong CRM
    Cách 2 'personal_phone' : SĐT Zalo cá nhân không có trong CRM
  Sau khi chọn → wizard 3 step:
    Step 1 — input (chọn nick OR nhập SĐT)
    Step 2 — handshake (gửi friend request, chờ accept)
    Step 3 — confirm (gõ verify code 4 số)
  Spec đầy đủ: docs/DESIGN-INTERNAL-CONTACT-2METHOD.md
-->
<template>
  <div class="ic-page">
    <div v-if="loading" class="ic-loading">
      <div class="skel" v-for="i in 3" :key="i"></div>
    </div>

    <!-- ════════════ STATE: ĐÃ SETUP XONG ════════════ -->
    <template v-else-if="state.status === 'ready'">
      <header class="ic-done-head">
        <div class="ic-done-badge">✅</div>
        <div>
          <h2>Đã thiết lập xong</h2>
          <p>Bạn đang nhận thông báo hệ thống qua kênh dưới đây.</p>
        </div>
      </header>

      <div class="ic-done-card">
        <div class="ic-done-method">
          <span class="ic-pill" :class="state.method === 'crm_nick' ? 'pill-crm' : 'pill-phone'">
            {{ state.method === 'crm_nick' ? '📱 Cách 1 — Nick CRM' : '☎ Cách 2 — SĐT cá nhân' }}
          </span>
        </div>
        <div class="ic-done-detail">
          <template v-if="state.method === 'crm_nick' && state.internalContactNick">
            <div class="ic-done-row">
              <span class="ic-label">Nick nhận:</span>
              <strong>{{ state.internalContactNick.displayName || 'Nick chưa đặt tên' }}</strong>
              <span class="ic-sub">{{ state.internalContactNick.phone || '—' }}</span>
            </div>
          </template>
          <template v-else>
            <div class="ic-done-row">
              <span class="ic-label">SĐT nhận:</span>
              <strong>{{ formatPhone(state.internalContactPhone) }}</strong>
            </div>
          </template>
          <div class="ic-done-row">
            <span class="ic-label">UID đã lưu:</span>
            <code>{{ state.recipient?.threadIdInSenderView || '—' }}</code>
          </div>
          <div class="ic-done-row">
            <span class="ic-label">Verified lúc:</span>
            <span>{{ formatDateTime(state.confirmedAt) }}</span>
          </div>
        </div>
      </div>

      <div class="ic-channels">
        <h3>Bạn sẽ nhận thông báo về 6 loại sự kiện:</h3>
        <div class="ic-channel-grid">
          <div class="ic-channel">🟢 Khách đồng ý kết bạn</div>
          <div class="ic-channel">🟡 Cảnh báo KH silent 30 ngày</div>
          <div class="ic-channel">🔵 Nhắc lịch hẹn 15 phút trước</div>
          <div class="ic-channel">🟣 Daily KPI 7h sáng</div>
          <div class="ic-channel">🟠 Bot tự động báo lỗi/hoàn thành</div>
          <div class="ic-channel">🔴 Broadcast / chiến dịch mới</div>
        </div>
      </div>

      <div class="ic-actions">
        <button class="ic-btn" @click="onReset">🔄 Đổi cách thiết lập</button>
      </div>

      <div v-if="resetError" class="ic-error">⚠ {{ resetError }}</div>
    </template>

    <!-- ════════════ STATE 0: CHƯA SETUP — CHỌN CÁCH ════════════ -->
    <template v-else-if="!wizardMethod && state.status !== 'pending_friend_request' && state.status !== 'pending_user_confirm'">
      <header class="ic-intro-head">
        <h2>🏠 Thiết lập kênh nhận thông báo</h2>
        <p>Chọn 1 trong 2 cách để hệ thống CRM gửi thông báo công việc cho bạn.</p>
      </header>

      <section class="ic-why">
        <h3>💎 Tại sao bạn CẦN thiết lập</h3>
        <p class="ic-why-sub">Mỗi ngày bạn bỏ lỡ những thông tin này = <strong>KHÁCH HÀNG MẤT TIỀN</strong>:</p>
        <ul class="ic-why-list">
          <li><span class="dot dot-green"></span> Khách đồng ý kết bạn — phải chốt trong 5 phút đầu</li>
          <li><span class="dot dot-yellow"></span> Khách 30 ngày không tương tác — cứu được hay mất luôn</li>
          <li><span class="dot dot-blue"></span> Lịch hẹn 15 phút nữa — bạn quên = khách bực</li>
          <li><span class="dot dot-purple"></span> Daily KPI 7h sáng — biết hôm nay phải làm gì</li>
          <li><span class="dot dot-orange"></span> Bot tự động báo lỗi/hoàn thành — sửa ngay hoặc bùng</li>
          <li><span class="dot dot-red"></span> Broadcast / chiến dịch mới — không bị bỏ qua</li>
        </ul>
        <p class="ic-why-cta">✨ TẤT CẢ gửi thẳng vào Zalo của bạn — không cần mở CRM</p>
      </section>

      <h3 class="ic-pick-title">Chọn cách thiết lập:</h3>

      <div class="ic-cards">
        <button class="ic-card" @click="wizardMethod = 'crm_nick'">
          <div class="ic-card-head">
            <span class="ic-card-icon">📱</span>
            <h4>Cách 1 — Nick CRM của tôi</h4>
          </div>
          <p class="ic-card-desc">
            Chọn 1 nick bạn đã đăng nhập vào CRM ({{ state.ownedNicks.length }} nick có sẵn). Nhanh, không cần thêm SĐT.
          </p>
          <ul class="ic-card-pros">
            <li>✅ Setup 1 phút</li>
            <li>✅ Không tốn nick mới</li>
            <li>✅ Thông báo + chat khách dùng chung 1 app Zalo</li>
          </ul>
          <span class="ic-card-cta">Chọn cách này →</span>
        </button>

        <button class="ic-card" @click="wizardMethod = 'personal_phone'">
          <div class="ic-card-head">
            <span class="ic-card-icon">☎</span>
            <h4>Cách 2 — SĐT Zalo cá nhân</h4>
          </div>
          <p class="ic-card-desc">
            Nhập SĐT Zalo cá nhân bạn KHÔNG đăng nhập vào CRM. Tách bạch chat khách hàng với thông báo công việc.
          </p>
          <ul class="ic-card-pros">
            <li>✅ Riêng tư hơn</li>
            <li>✅ Nick cá nhân không bị CRM động</li>
            <li>⚠ Cần SĐT có Zalo</li>
          </ul>
          <span class="ic-card-cta">Chọn cách này →</span>
        </button>
      </div>
    </template>

    <!-- ════════════ CÁCH 1 STEP 1: CHỌN NICK ════════════ -->
    <template v-else-if="wizardMethod === 'crm_nick' && !state.method">
      <header class="ic-wizard-head">
        <button class="ic-back" @click="wizardMethod = null">← Quay lại</button>
        <h2>Cách 1 — Bước 1/3: Chọn nick CRM nhận thông báo</h2>
      </header>

      <div v-if="state.ownedNicks.length === 0" class="ic-empty">
        Bạn chưa được gán làm chính chủ nick nào. Yêu cầu admin assign owner một nick hoặc dùng Cách 2.
      </div>

      <div v-else class="ic-nick-list">
        <label
          v-for="n in state.ownedNicks"
          :key="n.id"
          class="ic-nick-row"
          :class="{ selected: pickedNickId === n.id, disabled: n.status !== 'connected' }"
        >
          <input type="radio" v-model="pickedNickId" :value="n.id" :disabled="n.status !== 'connected'" />
          <div class="ic-nick-info">
            <div class="ic-nick-name">
              {{ n.displayName || 'Nick chưa đặt tên' }}
              <span v-if="n.status !== 'connected'" class="ic-nick-warn">offline</span>
            </div>
            <div class="ic-nick-meta">
              👥 {{ n.friendCount || 0 }} bạn<template v-if="n.phone"> · {{ n.phone }}</template>
            </div>
          </div>
        </label>
      </div>

      <p class="ic-tip">💡 Tip: chọn nick bạn check Zalo thường xuyên nhất</p>

      <div v-if="initError" class="ic-error">⚠ {{ initError }}</div>

      <div class="ic-step-actions">
        <button class="ic-btn-primary" :disabled="!pickedNickId || initing" @click="onInitiateCrmNick">
          <span v-if="initing">⏳ Đang gửi lời mời...</span>
          <span v-else>Tiếp theo →</span>
        </button>
      </div>
    </template>

    <!-- ════════════ CÁCH 2 STEP 1: NHẬP SĐT ════════════ -->
    <template v-else-if="wizardMethod === 'personal_phone' && !state.method">
      <header class="ic-wizard-head">
        <button class="ic-back" @click="wizardMethod = null">← Quay lại</button>
        <h2>Cách 2 — Bước 1/3: Nhập SĐT Zalo cá nhân</h2>
      </header>

      <label class="ic-input-label">Số điện thoại Zalo nhận thông báo:</label>
      <input
        class="ic-input"
        v-model="pickedPhone"
        type="tel"
        placeholder="0987 654 321"
        :disabled="initing"
        @keyup.enter="onInitiatePersonalPhone"
      />

      <div class="ic-warn-box">
        ⚠ <strong>Quan trọng:</strong> đây là SĐT nick Zalo bạn KHÔNG đăng nhập vào CRM.
        Hệ thống sẽ gửi lời mời kết bạn từ "Nick Hệ Thống CRM" tới SĐT này.
        Bạn cần accept trên Zalo cá nhân để hoàn tất.
      </div>

      <div class="ic-info-box">
        🔒 SĐT này CHỈ dùng cho thông báo hệ thống. CRM KHÔNG đọc tin nhắn cá nhân của bạn.
      </div>

      <div v-if="initError" class="ic-error">⚠ {{ initError }}</div>

      <div class="ic-step-actions">
        <button class="ic-btn-primary" :disabled="!pickedPhone || initing" @click="onInitiatePersonalPhone">
          <span v-if="initing">⏳ Đang gửi lời mời...</span>
          <span v-else>Gửi lời mời kết bạn →</span>
        </button>
      </div>
    </template>

    <!-- ════════════ STEP 2: CHỜ ACCEPT (CHỈ HIỆN CHO CÁCH 2 + EDGE CASES) ════════════ -->
    <template v-else-if="state.status === 'pending_friend_request'">
      <header class="ic-wizard-head">
        <h2>{{ methodLabel }} — Bước 2/3: Chấp nhận lời mời</h2>
      </header>

      <div class="ic-handshake">
        <div class="ic-handshake-line">
          <strong>"{{ senderDisplayName }}"</strong> vừa gửi lời mời kết bạn
          <template v-if="state.method === 'crm_nick'">tới nick "{{ state.internalContactNick?.displayName || '?' }}".</template>
          <template v-else>tới SĐT {{ formatPhone(state.internalContactPhone) }} trên Zalo cá nhân của bạn.</template>
        </div>
        <ol class="ic-handshake-steps">
          <li>Mở Zalo (<strong>{{ state.method === 'crm_nick' ? 'nick ' + (state.internalContactNick?.displayName || '') : 'Zalo cá nhân' }}</strong>) trên điện thoại</li>
          <li>Vào tab "Yêu cầu kết bạn"</li>
          <li>Tìm "{{ senderDisplayName }}" → bấm <strong>Chấp nhận</strong></li>
          <li>Quay lại đây bấm "Tôi đã chấp nhận"</li>
        </ol>
      </div>

      <div v-if="checkError" class="ic-error">⚠ {{ checkError }}</div>

      <div class="ic-step-actions">
        <button class="ic-btn-primary" :disabled="checking" @click="onCheckHandshake">
          <span v-if="checking">⏳ Đang kiểm tra...</span>
          <span v-else>Tôi đã chấp nhận — Kiểm tra ngay</span>
        </button>
        <button class="ic-btn" :disabled="resending" @click="onResendFriendRequest">
          <span v-if="resending">⏳ Gửi lại...</span>
          <span v-else>Gửi lại lời mời</span>
        </button>
        <button class="ic-btn-text" @click="onReset">Đổi cách thiết lập</button>
      </div>
    </template>

    <!-- ════════════ STEP 3: GÕ VERIFY CODE ════════════ -->
    <template v-else-if="state.status === 'pending_user_confirm'">
      <header class="ic-wizard-head">
        <h2>{{ methodLabel }} — Bước 3/3: Xác nhận mã 4 số</h2>
      </header>

      <div class="ic-verify-intro">
        📩 "<strong>{{ senderDisplayName }}</strong>" vừa gửi cho bạn tin nhắn chứa mã xác nhận 4 số. Mở Zalo
        <template v-if="state.method === 'crm_nick'">
          (nick "<strong>{{ state.internalContactNick?.displayName }}</strong>")
        </template>
        <template v-else>
          cá nhân (SĐT {{ formatPhone(state.internalContactPhone) }})
        </template>
        để đọc mã.
      </div>

      <div class="ic-code-row">
        <input
          v-for="i in 4"
          :key="i"
          :ref="(el) => setCodeInputRef(el, i - 1)"
          v-model="codeDigits[i - 1]"
          type="text"
          inputmode="numeric"
          maxlength="1"
          class="ic-code-input"
          @input="onCodeDigitInput(i - 1, $event)"
          @keydown="onCodeDigitKeyDown(i - 1, $event)"
          @paste="onCodeDigitPaste"
        />
      </div>

      <div v-if="confirmError" class="ic-error">⚠ {{ confirmError }}</div>

      <div class="ic-step-actions">
        <button class="ic-btn-primary" :disabled="!codeReady || confirming" @click="onConfirmCode">
          <span v-if="confirming">⏳ Đang xác nhận...</span>
          <span v-else>Xác nhận</span>
        </button>
        <button class="ic-btn" :disabled="resendingCode" @click="onResendVerifyCode">
          <span v-if="resendingCode">⏳ Gửi lại mã...</span>
          <span v-else>Chưa nhận tin? Gửi lại mã</span>
        </button>
        <button class="ic-btn-text" @click="onReset">Đổi cách thiết lập</button>
      </div>

      <div class="ic-note">
        💡 Mã hết hạn sau 30 phút. Nếu sai 5 lần, bạn cần bấm "Gửi lại mã".
      </div>
    </template>

    <!-- ════════════ STATE ERROR (uid_not_found, lookup_failed) ════════════ -->
    <template v-else-if="state.status === 'uid_not_found' || state.status === 'lookup_failed' || state.status === 'sender_disconnected'">
      <header class="ic-wizard-head">
        <h2>⚠ Setup chưa thành công</h2>
      </header>
      <div class="ic-error-state">
        {{ state.recipient?.error || 'Không tìm được UID hoặc lookup lỗi' }}
      </div>
      <div class="ic-step-actions">
        <button class="ic-btn-primary" @click="onReset">Thiết lập lại</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { api } from '@/api/index';

interface OwnedNick {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  zaloUid: string | null;
  phone: string | null;
  status: string;
  friendCount: number;
}
interface SystemSender {
  id: string;
  displayName: string | null;
  status: string;
  phone?: string | null;
}
interface RecipientState {
  id: string;
  status: string;
  error: string | null;
  threadIdInSenderView: string | null;
  verifyCodeExpiresAt: string | null;
  verifyAttempts: number;
  friendRequestSentAt: string | null;
  lastVerifiedAt: string | null;
}
interface InternalContactState {
  status: string; // derived từ recipient.status hoặc 'not_setup'
  method: 'crm_nick' | 'personal_phone' | null;
  internalContactZaloAccountId: string | null;
  internalContactPhone: string | null;
  internalContactNick: { id: string; displayName: string | null; avatarUrl?: string | null; phone?: string | null; status: string } | null;
  setupAt: string | null;
  confirmedAt: string | null;
  ownedNicks: OwnedNick[];
  systemSender: SystemSender | null;
  recipient: RecipientState | null;
}

const loading = ref(true);
const state = ref<InternalContactState>({
  status: 'not_setup', method: null,
  internalContactZaloAccountId: null, internalContactPhone: null,
  internalContactNick: null, setupAt: null, confirmedAt: null,
  ownedNicks: [], systemSender: null, recipient: null,
});

const wizardMethod = ref<'crm_nick' | 'personal_phone' | null>(null);
const pickedNickId = ref<string | null>(null);
const pickedPhone = ref('');
const initing = ref(false);
const initError = ref('');
const checking = ref(false);
const checkError = ref('');
const resending = ref(false);
const resendingCode = ref(false);
const confirming = ref(false);
const confirmError = ref('');
const resetError = ref('');
let pollTimer: number | null = null;

const codeDigits = ref(['', '', '', '']);
const codeInputRefs: HTMLInputElement[] = [];
function setCodeInputRef(el: any, idx: number) {
  if (el) codeInputRefs[idx] = el as HTMLInputElement;
}
const codeReady = computed(() => codeDigits.value.every((d) => /^\d$/.test(d)));

const senderDisplayName = computed(() => state.value.systemSender?.displayName || 'Nick Hệ Thống CRM');
const methodLabel = computed(() => state.value.method === 'crm_nick' ? 'Cách 1' : 'Cách 2');

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) {
    return '0' + digits.slice(2, 5) + ' ' + digits.slice(5, 8) + ' ' + digits.slice(8);
  }
  return phone;
}
function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth() + 1).padStart(2,'0')}/${d.getFullYear()}`;
}

async function fetchState() {
  loading.value = true;
  try {
    const { data } = await api.get('/me/internal-contact');
    state.value = {
      status: data.recipient?.status || (data.method ? 'invalid' : 'not_setup'),
      method: data.method,
      internalContactZaloAccountId: data.internalContactZaloAccountId,
      internalContactPhone: data.internalContactPhone,
      internalContactNick: data.internalContactNick,
      setupAt: data.setupAt,
      confirmedAt: data.confirmedAt,
      ownedNicks: data.ownedNicks || [],
      systemSender: data.systemSender,
      recipient: data.recipient,
    };
    // Auto-poll khi đang pending_friend_request
    if (data.recipient?.status === 'pending_friend_request') {
      startPolling();
    } else {
      stopPolling();
    }
  } catch (err: any) {
    console.error('[internal-contact] fetch failed:', err);
  } finally {
    loading.value = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(() => { void doCheck(true); }, 5000);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function doCheck(silent = false) {
  if (!silent) checking.value = true;
  checkError.value = '';
  try {
    const { data } = await api.post('/me/internal-contact/check-handshake');
    if (data.recipient) {
      state.value.recipient = data.recipient;
      state.value.status = data.recipient.status;
      if (data.recipient.status === 'pending_user_confirm') stopPolling();
      if (data.recipient.status === 'ready') stopPolling();
    }
  } catch (err: any) {
    if (!silent) checkError.value = err?.response?.data?.error || 'Lỗi kiểm tra trạng thái';
  } finally {
    if (!silent) checking.value = false;
  }
}

async function onInitiateCrmNick() {
  if (!pickedNickId.value) return;
  initing.value = true; initError.value = '';
  try {
    const { data } = await api.patch('/me/internal-contact', {
      method: 'crm_nick',
      zaloAccountId: pickedNickId.value,
    });
    if (data.recipient) {
      state.value.recipient = data.recipient;
      state.value.status = data.recipient.status;
      state.value.method = 'crm_nick';
      state.value.internalContactZaloAccountId = pickedNickId.value;
      state.value.internalContactNick = state.value.ownedNicks.find((n) => n.id === pickedNickId.value) || null;
      wizardMethod.value = null;
      if (data.recipient.status === 'pending_friend_request') startPolling();
      // Refresh để có sender data
      await fetchState();
    }
  } catch (err: any) {
    initError.value = err?.response?.data?.error || 'Lỗi khởi tạo handshake';
  } finally {
    initing.value = false;
  }
}

async function onInitiatePersonalPhone() {
  if (!pickedPhone.value) return;
  initing.value = true; initError.value = '';
  try {
    const { data } = await api.patch('/me/internal-contact', {
      method: 'personal_phone',
      phone: pickedPhone.value,
    });
    if (data.recipient) {
      state.value.recipient = data.recipient;
      state.value.status = data.recipient.status;
      state.value.method = 'personal_phone';
      state.value.internalContactPhone = pickedPhone.value;
      wizardMethod.value = null;
      startPolling();
      await fetchState();
    }
  } catch (err: any) {
    initError.value = err?.response?.data?.error || 'Lỗi khởi tạo handshake';
  } finally {
    initing.value = false;
  }
}

async function onCheckHandshake() {
  await doCheck(false);
}

async function onResendFriendRequest() {
  resending.value = true; checkError.value = '';
  try {
    await api.post('/me/internal-contact/resend-friend-request');
    await fetchState();
  } catch (err: any) {
    checkError.value = err?.response?.data?.error || 'Lỗi gửi lại lời mời';
  } finally {
    resending.value = false;
  }
}

async function onResendVerifyCode() {
  resendingCode.value = true; confirmError.value = '';
  try {
    await api.post('/me/internal-contact/resend-verify-code');
    codeDigits.value = ['', '', '', ''];
    await fetchState();
  } catch (err: any) {
    confirmError.value = err?.response?.data?.error || 'Lỗi gửi lại mã';
  } finally {
    resendingCode.value = false;
  }
}

async function onConfirmCode() {
  if (!codeReady.value) return;
  confirming.value = true; confirmError.value = '';
  try {
    await api.post('/me/internal-contact/confirm', { code: codeDigits.value.join('') });
    await fetchState();
  } catch (err: any) {
    confirmError.value = err?.response?.data?.error || 'Mã không đúng';
    codeDigits.value = ['', '', '', ''];
    nextTick(() => codeInputRefs[0]?.focus());
  } finally {
    confirming.value = false;
  }
}

async function onReset() {
  resetError.value = '';
  try {
    await api.delete('/me/internal-contact');
    wizardMethod.value = null;
    pickedNickId.value = null;
    pickedPhone.value = '';
    codeDigits.value = ['', '', '', ''];
    stopPolling();
    await fetchState();
  } catch (err: any) {
    resetError.value = err?.response?.data?.error || 'Lỗi reset setup';
  }
}

function onCodeDigitInput(idx: number, e: Event) {
  const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(-1);
  codeDigits.value[idx] = v;
  if (v && idx < 3) nextTick(() => codeInputRefs[idx + 1]?.focus());
  if (idx === 3 && codeReady.value) void onConfirmCode();
}

function onCodeDigitKeyDown(idx: number, e: KeyboardEvent) {
  if (e.key === 'Backspace' && !codeDigits.value[idx] && idx > 0) {
    nextTick(() => codeInputRefs[idx - 1]?.focus());
  }
}

function onCodeDigitPaste(e: ClipboardEvent) {
  e.preventDefault();
  const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4);
  for (let i = 0; i < 4; i++) codeDigits.value[i] = text[i] || '';
  if (codeReady.value) nextTick(() => void onConfirmCode());
}

onMounted(fetchState);
onUnmounted(stopPolling);
</script>

<style scoped>
.ic-page { padding: 20px 4px; display: flex; flex-direction: column; gap: 16px; max-width: 920px; }
.ic-loading { display: flex; flex-direction: column; gap: 12px; }
.skel { height: 64px; background: linear-gradient(90deg, #F3F4F6 0%, #E5E7EB 50%, #F3F4F6 100%); background-size: 200% 100%; animation: skel 1.5s linear infinite; border-radius: 10px; }
@keyframes skel { from { background-position: 200% 0 } to { background-position: -200% 0 } }

/* ═══════ INTRO STATE ═══════ */
.ic-intro-head h2 { font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 4px; }
.ic-intro-head p { color: #475569; margin: 0; font-size: 14px; }

.ic-why { background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%); border: 1px solid #FCD34D; border-radius: 14px; padding: 18px 22px; }
.ic-why h3 { margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #92400E; }
.ic-why-sub { color: #78350F; font-size: 13px; margin: 0 0 12px; }
.ic-why-list { list-style: none; padding: 0; margin: 0 0 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
.ic-why-list li { font-size: 13px; color: #374151; display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #10B981; }
.dot-yellow { background: #F59E0B; }
.dot-blue { background: #3B82F6; }
.dot-purple { background: #8B5CF6; }
.dot-orange { background: #F97316; }
.dot-red { background: #EF4444; }
.ic-why-cta { font-size: 13px; font-weight: 700; color: #B45309; margin: 0; padding-top: 6px; border-top: 1px dashed #FCD34D; }

.ic-pick-title { font-size: 14px; font-weight: 700; color: #0F172A; margin: 4px 0; }
.ic-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ic-card { background: white; border: 2px solid #E5E7EB; border-radius: 14px; padding: 18px 20px; text-align: left; cursor: pointer; font-family: inherit; transition: border-color 0.15s, transform 0.15s; }
.ic-card:hover { border-color: #5E6AD2; transform: translateY(-1px); }
.ic-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.ic-card-icon { font-size: 24px; }
.ic-card h4 { margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; }
.ic-card-desc { font-size: 13px; color: #475569; line-height: 1.5; margin: 0 0 12px; }
.ic-card-pros { list-style: none; padding: 0; margin: 0 0 14px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: #374151; }
.ic-card-cta { color: #5E6AD2; font-weight: 700; font-size: 13px; }

/* ═══════ WIZARD ═══════ */
.ic-wizard-head { display: flex; align-items: center; gap: 12px; padding-bottom: 6px; border-bottom: 1px solid #E5E7EB; }
.ic-wizard-head h2 { font-size: 18px; font-weight: 700; color: #0F172A; margin: 0; }
.ic-back { background: transparent; border: none; color: #5E6AD2; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; padding: 4px 8px; }
.ic-back:hover { text-decoration: underline; }

.ic-nick-list { display: flex; flex-direction: column; gap: 8px; }
.ic-nick-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: white; border: 2px solid #E5E7EB; border-radius: 10px; cursor: pointer; transition: border-color 0.15s; }
.ic-nick-row:hover:not(.disabled) { border-color: #C7D2FE; }
.ic-nick-row.selected { border-color: #5E6AD2; background: #EEF0FF; }
.ic-nick-row.disabled { opacity: 0.5; cursor: not-allowed; }
.ic-nick-row input { width: 18px; height: 18px; cursor: pointer; }
.ic-nick-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.ic-nick-name { font-size: 14px; font-weight: 600; color: #0F172A; display: flex; align-items: center; gap: 8px; }
.ic-nick-warn { background: #FEF2F2; color: #B91C1C; font-size: 11px; padding: 2px 8px; border-radius: 9999px; font-weight: 700; }
.ic-nick-meta { font-size: 12px; color: #6B7280; }

.ic-tip { font-size: 12px; color: #6B7280; font-style: italic; margin: 4px 0 0; }

.ic-input-label { font-size: 13px; font-weight: 600; color: #374151; }
.ic-input { padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-family: inherit; outline: none; transition: border-color 0.15s; }
.ic-input:focus { border-color: #5E6AD2; }

.ic-warn-box { background: #FEF3C7; border: 1px solid #FCD34D; color: #78350F; padding: 12px 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
.ic-info-box { background: #EEF0FF; border: 1px solid #C7D2FE; color: #3730A3; padding: 12px 16px; border-radius: 10px; font-size: 13px; line-height: 1.5; }

.ic-handshake { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 18px 22px; }
.ic-handshake-line { font-size: 14px; color: #374151; margin-bottom: 12px; }
.ic-handshake-steps { padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.8; margin: 0; }

.ic-verify-intro { font-size: 14px; color: #374151; line-height: 1.6; background: #F9FAFB; padding: 12px 16px; border-radius: 10px; border: 1px solid #E5E7EB; }
.ic-code-row { display: flex; gap: 10px; justify-content: center; padding: 16px 0; }
.ic-code-input { width: 60px; height: 72px; font-size: 32px; font-weight: 700; text-align: center; border: 2px solid #E5E7EB; border-radius: 12px; font-family: inherit; color: #0F172A; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
.ic-code-input:focus { border-color: #5E6AD2; box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.15); }

.ic-note { font-size: 12px; color: #6B7280; font-style: italic; }

.ic-step-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding-top: 8px; }
.ic-btn-primary { background: #5E6AD2; color: white; border: none; padding: 11px 22px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; font-family: inherit; }
.ic-btn-primary:hover:not(:disabled) { background: #4F46E5; }
.ic-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.ic-btn { background: white; color: #374151; border: 1px solid #D1D5DB; padding: 11px 18px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.ic-btn:hover:not(:disabled) { background: #F9FAFB; }
.ic-btn-text { background: transparent; color: #B91C1C; border: none; padding: 11px 8px; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.ic-btn-text:hover { text-decoration: underline; }

.ic-error { background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
.ic-error-state { background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5; padding: 16px 20px; border-radius: 12px; font-size: 14px; }
.ic-empty { background: #F9FAFB; border: 1px dashed #D1D5DB; padding: 24px; border-radius: 12px; text-align: center; color: #6B7280; font-size: 13.5px; }

/* ═══════ DONE STATE ═══════ */
.ic-done-head { display: flex; align-items: center; gap: 14px; padding-bottom: 8px; }
.ic-done-badge { width: 52px; height: 52px; border-radius: 14px; background: linear-gradient(135deg, #D1FAE5, #6EE7B7); display: flex; align-items: center; justify-content: center; font-size: 28px; }
.ic-done-head h2 { margin: 0; font-size: 20px; font-weight: 700; color: #0F172A; }
.ic-done-head p { margin: 2px 0 0; font-size: 13px; color: #6B7280; }

.ic-done-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px 20px; }
.ic-done-method { margin-bottom: 12px; }
.ic-pill { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; }
.pill-crm { background: #EEF0FF; color: #3730A3; }
.pill-phone { background: #FEF3C7; color: #92400E; }
.ic-done-detail { display: flex; flex-direction: column; gap: 8px; }
.ic-done-row { display: flex; align-items: baseline; gap: 10px; font-size: 13.5px; }
.ic-label { color: #6B7280; min-width: 100px; }
.ic-sub { color: #9CA3AF; font-size: 12px; }
code { font-family: ui-monospace, monospace; font-size: 12px; background: #F3F4F6; padding: 2px 8px; border-radius: 4px; }

.ic-channels h3 { font-size: 14px; font-weight: 700; color: #0F172A; margin: 8px 0; }
.ic-channel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.ic-channel { font-size: 13px; color: #374151; padding: 4px 0; }

.ic-actions { display: flex; gap: 10px; padding-top: 4px; }
</style>
