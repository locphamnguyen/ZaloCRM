<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ConnectNickWizard — luồng kết nối nick Zalo MỚI 4 bước (Anh chốt 2026-06-09).
  1 modal nhiều step, KHÔNG nhảy trang. BỎ "Tên hiển thị" + "Proxy".
    B1 phone   — nhập SĐT thật → Check
    B2 confirm — nick hệ thống findUser → hiện tên+avatar để xác nhận (fallback nếu lỗi)
    B3 qr      — quét QR ngay tại đây (parent quản lý socket → truyền qrImage/qrScanned)
    B4 done    — chúc mừng + NHẮC không dùng Zalo Web
  Component thuần UI: state SĐT/check ở đây; QR + connect do parent (socket ở composable).
-->
<template>
  <div class="cnw-backdrop" @click.self="onClose">
    <div class="cnw">
      <div class="cnw-head">
        <h3>{{ stepTitle }}</h3>
        <button class="cnw-x" @click="onClose">✕</button>
      </div>

      <!-- Stepper -->
      <div class="cnw-steps">
        <span v-for="(s, i) in stepLabels" :key="i" class="cnw-step"
          :class="{ active: i === stepIndex, done: i < stepIndex }">
          <span class="cnw-step-n">{{ i < stepIndex ? '✓' : i + 1 }}</span>{{ s }}
        </span>
      </div>

      <div class="cnw-body">
        <!-- ========== B1: NHẬP SĐT ========== -->
        <template v-if="step === 'phone'">
          <div class="cnw-field">
            <label>Số điện thoại của nick Zalo cần kết nối</label>
            <input
              v-model="phone" type="tel" inputmode="tel" placeholder="VD: 0901234567"
              :disabled="checking" @keyup.enter="onCheck"
            />
            <div class="cnw-hint">Nhập đúng SĐT thật của nick Zalo bạn sắp đăng nhập.</div>
            <div v-if="phoneError" class="cnw-err">{{ phoneError }}</div>
          </div>
        </template>

        <!-- ========== B2: XÁC NHẬN ========== -->
        <template v-else-if="step === 'confirm'">
          <div v-if="checkInfo?.found" class="cnw-confirm">
            <img v-if="checkInfo.info?.avatarUrl" :src="checkInfo.info.avatarUrl" class="cnw-avatar" alt="" />
            <div v-else class="cnw-avatar cnw-avatar-ph">{{ initials(checkInfo.info?.displayName) }}</div>
            <div class="cnw-confirm-name">{{ checkInfo.info?.displayName || 'Nick Zalo' }}</div>
            <div class="cnw-confirm-phone">{{ phone }}</div>

            <!-- Thứ tự v-if/else-if PHẢI là: dupOtherOwner → dupConnected → dupNeedsQr → dupOwnedByMe(passive)
                 → bình thường. Sai thứ tự sẽ nuốt nhánh (T2 2026-06-20). -->
            <!-- Trùng nick NGƯỜI KHÁC → CHẶN, hướng chủ tổ chức chuyển giao (fix ① + ③) -->
            <div v-if="dupOtherOwner" class="cnw-block-box">
              <v-icon size="18" color="#b42318">mdi-account-lock-outline</v-icon>
              <div>
                Nick này <b>đang do {{ checkInfo.duplicate.owner || 'nhân viên khác' }} quản lý</b>.
                Bạn không thể tự kết nối. Vui lòng <b>liên hệ chủ tổ chức</b> để được chuyển giao.
              </div>
            </div>
            <!-- T2: nick mình ĐANG CHẠY trong CRM → không cần làm gì -->
            <div v-else-if="dupConnected" class="cnw-info-box">
              <v-icon size="18" color="#0f6ea3">mdi-information-outline</v-icon>
              <div>
                Nick này <b>đang chạy trong CRM</b>, không cần kết nối lại.
              </div>
            </div>
            <!-- T2: nick mình đã NGẮT THỦ CÔNG / ĐÃ XÓA → phiên cũ đã đóng → phải QUÉT QR MỚI -->
            <div v-else-if="dupNeedsQr" class="cnw-info-box">
              <v-icon size="18" color="#0f6ea3">mdi-information-outline</v-icon>
              <div>
                Nick này <b>bạn đã ngắt/xóa trước đó</b>. Cần <b>QUÉT QR MỚI</b> để đăng nhập lại
                (phiên cũ đã đóng).
              </div>
            </div>
            <!-- Trùng nick mình (passive/null disconnected) → vẫn thử Kết nối lại bằng session cũ (fix ①) -->
            <div v-else-if="dupOwnedByMe" class="cnw-info-box">
              <v-icon size="18" color="#0f6ea3">mdi-information-outline</v-icon>
              <div>
                Nick này <b>bạn đã kết nối trước đó</b>. Không cần quét QR mới — hãy
                <b>Kết nối lại</b> để khôi phục phiên cũ.
              </div>
            </div>

            <p v-if="!dupOtherOwner" class="cnw-confirm-q">
              {{ dupConnected ? 'Nick đang sẵn sàng dùng.'
                : dupNeedsQr ? 'Quét QR mới để đăng nhập lại nick này chứ?'
                : dupOwnedByMe ? 'Khôi phục kết nối nick này chứ?'
                : 'Đúng nick bạn muốn kết nối chứ?' }}
            </p>
          </div>
          <div v-else class="cnw-confirm cnw-fallback">
            <v-icon size="40" color="#f5a524">mdi-help-circle-outline</v-icon>
            <p class="cnw-fallback-msg">{{ fallbackMsg }}</p>
            <p class="cnw-confirm-phone">{{ phone }}</p>
            <p class="cnw-fallback-sub">Bạn có thể quét QR trực tiếp nếu chắc chắn đây là nick của mình.</p>
          </div>
        </template>

        <!-- ========== B3: QUÉT QR ========== -->
        <template v-else-if="step === 'qr'">
          <div class="cnw-qr">
            <div v-if="qrImage && !qrScanned" class="cnw-qr-img">
              <img :src="'data:image/png;base64,' + qrImage" alt="QR" />
              <div class="cnw-qr-steps">
                <div class="qs active"><span>1</span> Mở app Zalo trên điện thoại</div>
                <div class="qs"><span>2</span> Cài đặt → Quản lý thiết bị → Quét QR</div>
                <div class="qs"><span>3</span> Đợi xác thực hoàn tất</div>
              </div>
            </div>
            <div v-else-if="qrScanned" class="cnw-scanned">
              <div class="cnw-spinner"></div>
              <p>Đã quét! Đang xác nhận trên điện thoại…</p>
              <p v-if="scannedName" class="cnw-muted">{{ scannedName }}</p>
            </div>
            <div v-else class="cnw-loading">
              <div class="cnw-spinner"></div>
              <p>Đang tạo mã QR…</p>
            </div>
            <!-- Phiên QR CHẾT (hết lượt tự sinh) → nút Tạo QR mới NỔI BẬT (fix #2). -->
            <div v-if="qrSessionDead" class="cnw-err cnw-qr-dead">
              <p>{{ qrError || 'Mã QR đã hết hiệu lực.' }}</p>
              <button class="btn btn-primary cnw-retry-btn" @click="$emit('retry-qr')">Tạo QR mới</button>
            </div>
            <div v-else-if="qrError" class="cnw-err cnw-qr-err">
              {{ qrError }}
              <button class="cnw-link" @click="$emit('retry-qr')">Tạo QR mới</button>
            </div>
          </div>
        </template>

        <!-- ========== B4: CHÚC MỪNG ========== -->
        <template v-else-if="step === 'done'">
          <div class="cnw-done">
            <div class="cnw-done-icon">🎉</div>
            <h4>{{ saleName }}, kết nối thành công!</h4>
            <p class="cnw-done-nick">Nick <b>{{ connectedNickName || phone }}</b> đã sẵn sàng dùng trong CRM.</p>
            <div class="cnw-remind">
              <v-icon size="18" color="#b45309">mdi-alert</v-icon>
              <div>
                <b>Lưu ý quan trọng:</b> Nick này đã đăng nhập vào Zalo CRM. <b>KHÔNG</b> dùng
                Zalo Web (chat.zalo.me) để đăng nhập/quét nick này nữa — sẽ làm <b>văng phiên</b>
                và nick bị <b>mất kết nối</b> khỏi CRM.
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="cnw-foot">
        <button v-if="step === 'phone'" class="btn" @click="onClose">Huỷ</button>
        <button v-if="step === 'phone'" class="btn btn-primary" :disabled="checking" @click="onCheck">
          {{ checking ? 'Đang kiểm tra…' : 'Kiểm tra' }}
        </button>

        <button v-if="step === 'confirm'" class="btn" @click="step = 'phone'">← Sửa SĐT</button>
        <!-- Thứ tự v-if/else-if PHẢI khớp nhánh info-box: dupOtherOwner → dupConnected → dupNeedsQr
             → dupOwnedByMe(passive) → bình thường (T2 2026-06-20). -->
        <!-- Trùng người khác → chỉ cho đóng, KHÔNG cho quét -->
        <button v-if="step === 'confirm' && dupOtherOwner" class="btn btn-primary" @click="onClose">
          Đã hiểu
        </button>
        <!-- T2: nick mình đang chạy → chỉ đóng -->
        <button
          v-else-if="step === 'confirm' && dupConnected"
          class="btn btn-primary"
          @click="onClose"
        >
          Đã hiểu
        </button>
        <!-- T2: nick mình manual/đã-xóa → QUÉT QR MỚI trên record cũ (KHÔNG reconnect ngầm) -->
        <button
          v-else-if="step === 'confirm' && dupNeedsQr"
          class="btn btn-primary"
          @click="$emit('rescan-existing', checkInfo.duplicate.accountId)"
        >
          Quét QR mới →
        </button>
        <!-- Trùng nick mình (passive) → Kết nối lại record cũ (không đẻ record mới) -->
        <button
          v-else-if="step === 'confirm' && dupOwnedByMe"
          class="btn btn-primary"
          @click="$emit('reconnect-existing', checkInfo.duplicate.accountId)"
        >
          Kết nối lại →
        </button>
        <!-- Bình thường → quét QR -->
        <button
          v-else-if="step === 'confirm'"
          class="btn btn-primary"
          @click="$emit('confirm-connect')"
        >
          Xác nhận, quét QR →
        </button>

        <button v-if="step === 'qr'" class="btn" @click="onClose">Huỷ</button>

        <button v-if="step === 'done'" class="btn btn-primary" @click="onClose">Xong</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api';

const props = defineProps<{
  step: 'phone' | 'confirm' | 'qr' | 'done';
  qrImage?: string;
  qrScanned?: boolean;
  scannedName?: string | null;
  qrError?: string;
  qrSessionDead?: boolean; // FIX #2: phiên QR đã chết (hết lượt tự sinh) → nổi nút "Tạo QR mới"
  saleName?: string | null;
  connectedNickName?: string | null;
}>();
const emit = defineEmits<{
  'update:step': [v: 'phone' | 'confirm' | 'qr' | 'done'];
  'checked': [payload: { phone: string; info: any }];   // sang B2
  'confirm-connect': [];                                  // B2 → B3 (parent tạo nick + login QR)
  'reconnect-existing': [accountId: string];             // trùng nick mình (passive) → reconnect record cũ (fix ①)
  'rescan-existing': [accountId: string];                // T2 2026-06-20: nick manual/đã-xóa → QUÉT QR MỚI trên record cũ
  'retry-qr': [];
  close: [];
}>();

const step = computed({
  get: () => props.step,
  set: (v) => emit('update:step', v),
});

const phone = ref('');
const checking = ref(false);
const phoneError = ref('');
const checkInfo = ref<any>(null);
const fallbackMsg = ref('');

// Phân loại trùng nick theo chủ sở hữu (fix ① — BE check-phone trả duplicate.ownedByMe).
const dupOwnedByMe = computed(() => checkInfo.value?.duplicate?.ownedByMe === true);
const dupOtherOwner = computed(
  () => !!checkInfo.value?.duplicate && checkInfo.value.duplicate.ownedByMe === false,
);
// 2026-06-20 (T2) — điều hướng theo LÝ DO ngắt của nick trùng (BE check-phone trả thêm
// duplicate.status / disconnectReason / archived). manual hoặc đã-xóa (archived) → phiên cũ ĐÃ ĐÓNG
// → bắt buộc QUÉT QR MỚI (KHÔNG reconnect ngầm — sẽ bị BE skip im lặng → sale kẹt). connected → đang
// chạy, không cần làm gì. passive/disconnected khác → vẫn thử reconnect bằng session cũ.
const dupStatus = computed(() => checkInfo.value?.duplicate?.status ?? null);
const dupReason = computed(() => checkInfo.value?.duplicate?.disconnectReason ?? null);
const dupArchived = computed(() => checkInfo.value?.duplicate?.archived === true);
const dupNeedsQr = computed(() => dupOwnedByMe.value && (dupReason.value === 'manual' || dupArchived.value));
const dupConnected = computed(() => dupOwnedByMe.value && dupStatus.value === 'connected');

const stepLabels = ['Nhập SĐT', 'Xác nhận', 'Quét QR', 'Hoàn tất'];
const stepIndex = computed(() => ({ phone: 0, confirm: 1, qr: 2, done: 3 }[props.step]));
const stepTitle = computed(() => ({
  phone: 'Kết nối nick Zalo mới', confirm: 'Xác nhận nick', qr: 'Quét QR đăng nhập', done: 'Hoàn tất',
}[props.step]));

async function onCheck() {
  phoneError.value = '';
  const p = phone.value.trim();
  const norm = p.replace(/[\s.\-()]/g, '');
  if (!/^(0|\+84)\d{9}$/.test(norm)) {
    phoneError.value = 'Số điện thoại không hợp lệ (10 số, bắt đầu 0).';
    return;
  }
  checking.value = true;
  try {
    const { data } = await api.post('/zalo-accounts/check-phone', { phone: norm });
    if (data.available === false) {
      // Fallback: nick hệ thống chưa cấu hình / lỗi → cho quét QR thẳng.
      checkInfo.value = { found: false };
      fallbackMsg.value = data.reason === 'system_nick_unavailable'
        ? 'Hệ thống chưa cấu hình nick để kiểm tra SĐT.'
        : 'Không kiểm tra được số này lúc này.';
    } else {
      checkInfo.value = data; // {found, info, duplicate}
    }
    emit('checked', { phone: norm, info: checkInfo.value });
    step.value = 'confirm';
  } catch (e: any) {
    phoneError.value = e.response?.data?.message || e.response?.data?.error || 'Lỗi kiểm tra SĐT';
  } finally {
    checking.value = false;
  }
}

function onClose() { emit('close'); }
function initials(name?: string | null): string {
  if (!name) return '?';
  return (name.trim().split(/\s+/).pop()?.[0] || '?').toUpperCase();
}

defineExpose({ phone });
</script>

<style scoped>
.cnw-backdrop { position: fixed; inset: 0; background: rgba(20,26,36,.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.cnw { background: #fff; border-radius: 16px; width: 440px; max-width: 94vw; max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.cnw-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 8px; }
.cnw-head h3 { font-size: 16px; font-weight: 700; color: #141a24; }
.cnw-x { border: none; background: none; font-size: 18px; color: #9ca3af; cursor: pointer; }

.cnw-steps { display: flex; gap: 4px; padding: 4px 20px 12px; }
.cnw-step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 10.5px; color: #9ca3af; }
.cnw-step-n { width: 24px; height: 24px; border-radius: 50%; background: #eef2f7; color: #9ca3af; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
.cnw-step.active .cnw-step-n { background: #1786be; color: #fff; }
.cnw-step.active { color: #0f6ea3; font-weight: 600; }
.cnw-step.done .cnw-step-n { background: #12b76a; color: #fff; }

.cnw-body { padding: 8px 20px 16px; min-height: 200px; }
.cnw-field label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
.cnw-field input { width: 100%; padding: 11px 13px; border: 1px solid #e7eaf0; border-radius: 9px; font-size: 15px; outline: none; }
.cnw-field input:focus { border-color: #1786be; }
.cnw-hint { font-size: 12px; color: #9ca3af; margin-top: 6px; }
.cnw-err { color: #b42318; font-size: 12.5px; margin-top: 8px; }

.cnw-confirm { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; }
.cnw-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; }
.cnw-avatar-ph { display: flex; align-items: center; justify-content: center; background: #e6f3fb; color: #0f6ea3; font-weight: 700; font-size: 26px; }
.cnw-confirm-name { font-size: 17px; font-weight: 700; color: #141a24; }
.cnw-confirm-phone { font-size: 14px; color: #6b7280; font-variant-numeric: tabular-nums; }
.cnw-confirm-q { margin-top: 8px; font-size: 13.5px; color: #374151; }
.cnw-warn { font-size: 12.5px; color: #b45309; background: #fef4e6; padding: 6px 10px; border-radius: 8px; }
/* fix ①: trùng nick mình (info xanh teal Atlas v2) / trùng người khác (block đỏ) */
.cnw-info-box { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: #0f6ea3; background: #e6f3fb; border: 1px solid #bfe2f4; padding: 9px 11px; border-radius: 9px; line-height: 1.5; text-align: left; }
.cnw-block-box { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: #b42318; background: #fef3f2; border: 1px solid #fecdca; padding: 9px 11px; border-radius: 9px; line-height: 1.5; text-align: left; }
.cnw-fallback { text-align: center; }
.cnw-fallback-msg { font-size: 14px; color: #374151; font-weight: 500; }
.cnw-fallback-sub { font-size: 12.5px; color: #9ca3af; }

.cnw-qr { display: flex; flex-direction: column; align-items: center; }
.cnw-qr-img img { width: 200px; height: 200px; }
.cnw-qr-steps { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.qs { font-size: 12.5px; color: #6b7280; display: flex; align-items: center; gap: 6px; }
.qs span { width: 18px; height: 18px; border-radius: 50%; background: #eef2f7; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.qs.active { color: #0f6ea3; font-weight: 600; }
.cnw-scanned, .cnw-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 30px; }
.cnw-spinner { width: 36px; height: 36px; border: 3px solid #e7eaf0; border-top-color: #1786be; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.cnw-muted { font-size: 12.5px; color: #9ca3af; }
.cnw-qr-err { text-align: center; margin-top: 10px; }
.cnw-link { border: none; background: none; color: #1786be; text-decoration: underline; cursor: pointer; font-size: 12.5px; margin-left: 6px; }
.cnw-qr-dead { text-align: center; margin-top: 12px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.cnw-qr-dead p { color: #b45309; font-size: 13.5px; margin: 0; }
.cnw-retry-btn { min-width: 140px; }

.cnw-done { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 8px; }
.cnw-done-icon { font-size: 44px; }
.cnw-done h4 { font-size: 17px; font-weight: 700; color: #047857; }
.cnw-done-nick { font-size: 14px; color: #374151; }
.cnw-remind { display: flex; gap: 8px; background: #fef4e6; border: 1px solid #f5d9a8; border-radius: 10px; padding: 11px 13px; font-size: 12.5px; color: #7a4a08; line-height: 1.5; text-align: left; margin-top: 6px; }

.cnw-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 20px 18px; border-top: 1px solid #f3f4f6; }
.btn { padding: 9px 16px; border: 1px solid #e7eaf0; background: #fff; border-radius: 9px; font-size: 13.5px; font-weight: 600; cursor: pointer; color: #374151; }
.btn-primary { background: #1786be; color: #fff; border-color: #1786be; }
.btn-primary:disabled { opacity: .6; cursor: default; }
</style>
