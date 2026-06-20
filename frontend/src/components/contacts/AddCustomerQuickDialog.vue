<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="480"
    persistent
    transition="dialog-bottom-transition"
  >
    <v-card class="acqd-card" elevation="24">
      <!-- Header -->
      <header class="acqd-head">
        <h2 class="acqd-title">＋ Thêm khách hàng nhanh</h2>
        <v-btn icon variant="text" size="small" @click="close" :aria-label="'Đóng'">
          <v-icon size="20">mdi-close</v-icon>
        </v-btn>
      </header>

      <!-- Body -->
      <div class="acqd-body">
        <!-- Field: Họ tên -->
        <div class="acqd-field">
          <label class="acqd-label" for="acqd-name">
            Họ tên
            <span class="acqd-required">*</span>
          </label>
          <input
            id="acqd-name"
            v-model.trim="form.fullName"
            ref="nameInputRef"
            type="text"
            class="acqd-input"
            placeholder="Vd: Nguyễn Văn A"
            autocomplete="name"
            :disabled="loading"
            @keydown.enter.prevent="onEnterName"
          />
        </div>

        <!-- Field: SĐT -->
        <div class="acqd-field">
          <label class="acqd-label" for="acqd-phone">
            Số điện thoại
            <span class="acqd-required">*</span>
          </label>
          <input
            id="acqd-phone"
            v-model.trim="form.phone"
            ref="phoneInputRef"
            type="tel"
            class="acqd-input acqd-input--phone"
            :class="{
              'has-error': phoneError,
              'has-warning': duplicateContact,
            }"
            placeholder="0936 668 266 hoặc 84936668266"
            autocomplete="tel"
            :disabled="loading"
            @input="onPhoneInput"
            @keydown.enter.prevent="onSubmit"
          />
          <!-- Hint default -->
          <div
            v-if="!phoneError && !duplicateContact"
            class="acqd-hint"
          >
            Hệ thống tự nhận diện số Việt Nam (0xxx / 84xxx / +84xxx)
          </div>
          <!-- Error state -->
          <div v-if="phoneError" class="acqd-msg acqd-msg--error">
            🔴 {{ phoneError }}
          </div>
          <!-- Duplicate warning state -->
          <div v-if="duplicateContact" class="acqd-msg acqd-msg--warning">
            🟡 KH
            <strong>"{{ duplicateContact.fullName || '—' }}"</strong>
            đã có trong hệ thống với SĐT này
            <a class="acqd-link" @click.prevent="openDuplicate">Mở chi tiết</a>
          </div>
          <!-- Owner info nếu trùng có chủ -->
          <div
            v-if="duplicateContact && duplicateContact.ownerName"
            class="acqd-hint"
          >
            Sale đang chăm: <strong>{{ duplicateContact.ownerName }}</strong>
          </div>
          <!-- M55.2: Note gần nhất ngày — chỉ ngày, không nội dung (privacy + compact) -->
          <div
            v-if="duplicateContact && duplicateContact.lastNoteAt"
            class="acqd-hint"
          >
            📝 Note gần nhất: <strong>{{ formatNoteDate(duplicateContact.lastNoteAt) }}</strong>
          </div>
        </div>
      </div>

      <!-- Footer hint -->
      <div class="acqd-footer-hint">
        💡 Sau khi lưu, anh có thể bổ sung thông tin chi tiết (email, địa chỉ, tag, sale phụ trách...)
        bằng cách click vào KH trong danh sách.
      </div>

      <!-- Actions -->
      <div class="acqd-actions">
        <button
          type="button"
          class="acqd-btn acqd-btn--secondary"
          @click="close"
          :disabled="loading"
        >
          Hủy
        </button>
        <!-- M55.2: Khi trùng SĐT → CTA chính là "Mở chat" (sale flow liền mạch) -->
        <button
          v-if="duplicateContact"
          type="button"
          class="acqd-btn acqd-btn--primary"
          :disabled="openingChat"
          @click="openChatWithDuplicate"
        >
          <span v-if="openingChat" class="acqd-spinner" />
          {{ openingChat ? 'Đang mở...' : '💬 Mở chat' }}
        </button>
        <button
          v-else
          type="button"
          class="acqd-btn acqd-btn--primary"
          :disabled="!canSubmit || loading"
          @click="onSubmit"
        >
          <span v-if="loading" class="acqd-spinner" />
          {{ loading ? 'Đang lưu...' : 'Lưu nhanh' }}
        </button>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api/index';

interface Props {
  modelValue: boolean;
  /** Optional: nguồn lead — defaults to 'quick_add'. Override: 'lead_pool' | 'manual' | 'chat_fab' | 'chat_compose_lookup_miss' */
  leadSource?: string;
  /** Pre-fill SĐT — dùng từ NewMessageDialog khi lookup Zalo miss (sale đã gõ SĐT) */
  defaultPhone?: string;
  /** M53.3 2026-05-30: Dialog tự navigate /chat/:convId sau khi tạo virtual conv.
   *  Default true (ContactsView FAB). Set false khi parent tự xử lý emit `created`
   *  (vd NewMessageDialog đang ở /chat, không cần dialog navigate gây race). */
  autoOpenVirtualChat?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  leadSource: 'quick_add',
  defaultPhone: '',
  autoOpenVirtualChat: true,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created', contact: { id: string; fullName: string | null; phone: string | null }): void;
}>();

const router = useRouter();
const toast = useToast();

const form = ref({ fullName: '', phone: '' });
const loading = ref(false);
const phoneError = ref<string | null>(null);
const duplicateContact = ref<null | {
  id: string;
  fullName: string | null;
  phone: string | null;
  hasZalo: boolean | null;
  ownerUserId: string | null;
  ownerName: string | null;
  /** M55.2 2026-05-30 — Note gần nhất ngày (ISO), không nội dung */
  lastNoteAt: string | null;
}>(null);

// M55.2 — Mở chat trực tiếp từ duplicate warning (sale flow liền mạch)
const openingChat = ref(false);

const nameInputRef = ref<HTMLInputElement | null>(null);
const phoneInputRef = ref<HTMLInputElement | null>(null);

const canSubmit = computed(() => {
  return form.value.fullName.trim().length > 0 && form.value.phone.trim().length > 0;
});

watch(() => props.modelValue, async (open) => {
  if (open) {
    form.value = { fullName: '', phone: props.defaultPhone || '' };
    phoneError.value = null;
    duplicateContact.value = null;
    await nextTick();
    // Luôn focus Họ tên — sale gõ tên trước, Enter xuống SĐT (đã pre-fill thì Enter lần 2 = Lưu)
    nameInputRef.value?.focus();
  }
});

function onPhoneInput() {
  // Clear validation lúc user gõ — chỉ re-validate khi submit
  phoneError.value = null;
  duplicateContact.value = null;
}

function onEnterName() {
  phoneInputRef.value?.focus();
}

function close() {
  if (loading.value) return;
  emit('update:modelValue', false);
}

function openDuplicate() {
  if (!duplicateContact.value) return;
  const id = duplicateContact.value.id;
  emit('update:modelValue', false);
  router.push({ path: '/contacts', query: { focus: id } });
}

// M55.2 2026-05-30 — Format Note date: "Hôm nay" / "Hôm qua" / "N ngày trước" / dd/MM/yyyy
function formatNoteDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const dayMs = 86_400_000;
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / dayMs);
    if (diffDays === 0) {
      return `Hôm nay (${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })})`;
    }
    if (diffDays === 1) return 'Hôm qua';
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  } catch {
    return iso;
  }
}

// M55.2 — Mở chat virtual ngay từ dialog warning (skip /contacts navigate vòng)
async function openChatWithDuplicate() {
  if (!duplicateContact.value || openingChat.value) return;
  openingChat.value = true;
  try {
    const res = await api.post<{ conversationId: string; created: boolean }>(
      `/contacts/${duplicateContact.value.id}/virtual-conversation`, {},
    );
    const convId = res.data?.conversationId;
    emit('update:modelValue', false);
    if (convId) {
      await router.push(`/chat/${convId}`);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.response?.data?.error || 'Không mở được chat';
    toast.error(msg);
  } finally {
    openingChat.value = false;
  }
}

async function onSubmit() {
  if (!canSubmit.value || loading.value) return;
  phoneError.value = null;
  duplicateContact.value = null;
  loading.value = true;
  try {
    const res = await api.post('/contacts/quick-create', {
      fullName: form.value.fullName.trim(),
      phone: form.value.phone.trim(),
      leadSource: props.leadSource,
    });

    // exists = true → behavior khác nhau theo entry point
    if (res.data?.exists) {
      const dup = res.data.contact;
      // M55.3 2026-05-30: NewMessageDialog flow (autoOpenVirtualChat=false) → KHÔNG
      // hiện duplicate warning UI (sale đang bận gửi tin, muốn vào chat ngay).
      // Skip warning, emit 'created' với KH cũ — parent onQuickAddCreated sẽ chain
      // POST virtual-conv + emit opened. Backend AI welcome msg #2 sẽ thông báo
      // "KH đã có sale chăm, note gần nhất ..." vào virtual chat.
      if (!props.autoOpenVirtualChat) {
        toast.success(`KH "${dup.fullName || dup.phone}" đã có — mở chat ngay`);
        emit('created', { id: dup.id, fullName: dup.fullName, phone: dup.phone });
        emit('update:modelValue', false);
        return;
      }
      // ContactsView FAB: vẫn show warning để sale review trước khi vào chat
      duplicateContact.value = dup;
      return;
    }

    // M53.1 2026-05-30: Tạo xong KH → tự mở virtual chat để sale ghi nhật ký
    // + AI Trợ Lý welcome ngay. Anh chốt: nhảy thẳng /chat để workflow liền mạch.
    // M53.3 2026-05-30: Nếu autoOpenVirtualChat=false (NewMessageDialog),
    // chỉ emit 'created' để parent tự xử lý — tránh race condition 2 lần POST virtual-conv.
    const createdContact = res.data.contact;
    if (!props.autoOpenVirtualChat) {
      // Parent quyết định flow (vd NewMessageDialog onQuickAddCreated chain virtual-conv + emit opened)
      toast.success('Đã lưu khách hàng');
      emit('created', createdContact);
      emit('update:modelValue', false);
      return;
    }

    toast.success('Đã lưu khách hàng — đang mở chat nội bộ...');
    emit('created', createdContact);

    try {
      const vcRes = await api.post(`/contacts/${createdContact.id}/virtual-conversation`, {});
      const conversationId = vcRes.data?.conversationId;
      emit('update:modelValue', false);
      if (conversationId) {
        await router.push(`/chat/${conversationId}`);
      }
    } catch (vcErr: any) {
      // Tạo virtual conv fail (vd chưa kết nối nick Zalo) → vẫn báo thành công create KH,
      // không block flow. Sale có thể vào Contacts > KH > nút "Mở chat nội bộ" sau.
      const vcMsg = vcErr?.response?.data?.message;
      toast.warning(vcMsg || 'KH đã lưu. Mở chat nội bộ ở trang Liên hệ khi cần.', 4000);
      emit('update:modelValue', false);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.message || err?.response?.data?.error;
    if (msg === 'invalid_phone' || err?.response?.data?.error === 'invalid_phone') {
      phoneError.value = 'SĐT không hợp lệ — vui lòng nhập đúng định dạng Việt Nam';
    } else if (msg) {
      phoneError.value = msg;
    } else {
      toast.error('Lưu khách hàng thất bại');
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
/* Token palette giữ với mockup HTML chốt 2026-05-28 */
.acqd-card {
  border-radius: 12px !important;
  overflow: hidden;
  background: #ffffff;
}

.acqd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 14px;
  border-bottom: 1px solid #dddddd;
}
.acqd-title {
  font-size: 17px;
  font-weight: 500;
  color: #181d26;
  letter-spacing: -0.01em;
  margin: 0;
}

.acqd-body {
  padding: 18px 24px 20px;
}

.acqd-field { margin-bottom: 16px; }
.acqd-field:last-child { margin-bottom: 0; }

.acqd-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 500;
  color: #181d26;
  margin-bottom: 6px;
}
.acqd-required { color: #aa2d00; }

.acqd-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #dddddd;
  border-radius: 7px;
  font-size: 14px;
  font-family: inherit;
  color: #181d26;
  background: #ffffff;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.acqd-input:focus {
  outline: none;
  border-color: #181d26;
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08);
}
.acqd-input:disabled {
  background: #f8fafc;
  cursor: not-allowed;
}
.acqd-input.has-error { border-color: #b91c1c; }
.acqd-input.has-warning { border-color: #d97706; }
.acqd-input--phone {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 13.5px;
  letter-spacing: 0.02em;
}

.acqd-hint {
  margin-top: 5px;
  font-size: 11.5px;
  color: #41454d;
  line-height: 1.4;
}

.acqd-msg {
  margin-top: 5px;
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  line-height: 1.4;
}
.acqd-msg--error { color: #b91c1c; }
.acqd-msg--warning { color: #d97706; }

.acqd-link {
  margin-left: 4px;
  color: #1b61c9;
  text-decoration: underline;
  cursor: pointer;
  font-weight: 500;
}

.acqd-footer-hint {
  font-size: 11px;
  color: #41454d;
  background: #f8fafc;
  border-top: 1px solid #dddddd;
  padding: 10px 24px;
  line-height: 1.4;
}

.acqd-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 14px 24px;
  border-top: 1px solid #dddddd;
}

.acqd-btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 7px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
}
.acqd-btn--primary {
  background: #181d26;
  color: #ffffff;
  border-color: #181d26;
}
.acqd-btn--primary:hover:not(:disabled) { background: #0d1218; }
.acqd-btn--primary:active:not(:disabled) { transform: translateY(1px); }
.acqd-btn--primary:disabled {
  background: #e0e2e6;
  color: #41454d;
  border-color: #e0e2e6;
  cursor: not-allowed;
}
.acqd-btn--secondary {
  background: #ffffff;
  color: #181d26;
  border-color: #dddddd;
}
.acqd-btn--secondary:hover:not(:disabled) { background: #f8fafc; }
.acqd-btn--secondary:disabled { cursor: not-allowed; opacity: 0.6; }

.acqd-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: acqd-spin 0.6s linear infinite;
}
@keyframes acqd-spin {
  to { transform: rotate(360deg); }
}

/* FHD 1920 */
@media (min-width: 1920px) {
  .acqd-head { padding: 22px 28px 16px; }
  .acqd-body { padding: 20px 28px 22px; }
  .acqd-actions { padding: 16px 28px; }
  .acqd-footer-hint { padding: 12px 28px; }
  .acqd-title { font-size: 18px; }
}
/* 2K 2560 */
@media (min-width: 2560px) {
  .acqd-title { font-size: 20px; }
  .acqd-input { height: 42px; font-size: 15px; }
  .acqd-btn { height: 42px; font-size: 14.5px; }
}
</style>
