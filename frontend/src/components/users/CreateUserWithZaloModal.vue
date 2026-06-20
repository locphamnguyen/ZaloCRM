<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  CreateUserWithZaloModal.vue — Phase user-create-with-zalo 2026-05-27

  2-step modal cho admin tạo user mới gộp Zalo handshake:
    Step 1: form 4 trường (họ tên + SĐT + dept + role) + nút "Kiểm tra Zalo"
    Step 2: preview avatar/tên/quan hệ Zalo + cảnh báo dedup → "Xác nhận tạo" / "Quay lại sửa"
    Step 3: success — show credentials + tình trạng gửi tin (đã gửi qua Zalo / fail fallback admin)

  Props:
    - open: v-model boolean
    - departments: cây phòng ban (để dropdown)
    - permissionGroups: cây nhóm quyền

  Emits:
    - update:open
    - created (CreateResult) — parent refresh user list
-->
<template>
  <div v-if="open" class="cuwz-overlay" @click.self="tryClose">
    <div class="cuwz-modal">
      <header class="cuwz-header">
        <h2>
          <span v-if="step === 1">➕ Thêm nhân viên (qua Zalo)</span>
          <span v-else-if="step === 2">🔍 Xác nhận thông tin Zalo</span>
          <span v-else>✅ Tạo thành công</span>
        </h2>
        <button class="cuwz-close" @click="tryClose" :disabled="creating">×</button>
      </header>

      <div class="cuwz-stepper">
        <span :class="['step', { active: step === 1 }]">1. Thông tin</span>
        <span :class="['step', { active: step === 2 }]">2. Xác nhận Zalo</span>
        <span :class="['step', { active: step === 3 }]">3. Hoàn tất</span>
      </div>

      <!-- ── STEP 1: Form ──────────────────────────────────────────────── -->
      <div v-if="step === 1" class="cuwz-body">
        <div class="cuwz-field">
          <label>Họ và tên đầy đủ <span class="req">*</span></label>
          <input v-model="form.fullName" type="text" placeholder="VD: Nguyễn Văn A" />
        </div>

        <div class="cuwz-field">
          <label>Số điện thoại Zalo (login + nhận thông báo) <span class="req">*</span></label>
          <input
            v-model="form.phone"
            type="tel"
            placeholder="VD: 0908278807"
            :class="{ 'has-check': zaloCheck.result.value }"
          />
          <div class="cuwz-hint">SĐT này dùng để: (1) Sale đăng nhập CRM, (2) Nick hệ thống tìm + gửi tin login qua Zalo</div>
        </div>

        <div class="cuwz-field">
          <label>Email (tuỳ chọn)</label>
          <input v-model="form.email" type="email" placeholder="Bỏ trống nếu sale không có email" />
        </div>

        <div class="cuwz-row">
          <div class="cuwz-field flex1">
            <label>Phòng ban</label>
            <select v-model="form.departmentId">
              <option value="">— Chưa gán —</option>
              <option v-for="d in flatDepts" :key="d.id" :value="d.id">
                {{ '— '.repeat(d._depth) }}{{ d.name }}
              </option>
            </select>
          </div>

          <div class="cuwz-field flex1">
            <label>Nhóm quyền</label>
            <select v-model="form.permissionGroupId">
              <option value="">— Chưa gán —</option>
              <option v-for="g in flatGroups" :key="g.id" :value="g.id">
                {{ '— '.repeat(g._depth) }}{{ g.name }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="zaloCheck.error.value" class="cuwz-alert error">{{ zaloCheck.error.value }}</div>

        <footer class="cuwz-footer">
          <button class="btn-secondary" @click="tryClose">Huỷ</button>
          <button
            class="btn-primary"
            :disabled="!canCheck || zaloCheck.loading.value"
            @click="onCheckPhone"
          >
            <span v-if="zaloCheck.loading.value">⏳ Đang check Zalo...</span>
            <span v-else>🔍 Kiểm tra Zalo</span>
          </button>
        </footer>
      </div>

      <!-- ── STEP 2: Preview & confirm ─────────────────────────────────── -->
      <div v-else-if="step === 2 && zaloCheck.result.value" class="cuwz-body">
        <div class="cuwz-preview">
          <img
            v-if="zaloCheck.result.value.preview?.avatar"
            :src="zaloCheck.result.value.preview.avatar"
            alt="Zalo avatar"
            class="cuwz-avatar"
          />
          <div class="cuwz-preview-info">
            <div class="cuwz-displayname">{{ zaloCheck.result.value.preview?.displayName || '(Không có tên)' }}</div>
            <div v-if="zaloCheck.result.value.preview?.zaloName" class="cuwz-zaloname">
              Zalo Name: {{ zaloCheck.result.value.preview.zaloName }}
            </div>
            <div class="cuwz-meta">
              <span v-if="zaloCheck.result.value.preview?.sdob">🎂 {{ zaloCheck.result.value.preview.sdob }}</span>
              <span v-if="genderText"> · {{ genderText }}</span>
            </div>
            <div class="cuwz-uid">UID: <code>{{ zaloCheck.result.value.preview?.uid }}</code></div>
          </div>
        </div>

        <div :class="['cuwz-relation', `relation-${zaloCheck.result.value.relation}`]">
          <span class="rel-emoji">{{ relationInfo.emoji }}</span>
          <div>
            <div class="rel-label">{{ relationInfo.label }}</div>
            <div class="rel-help">{{ relationInfo.help }}</div>
          </div>
        </div>

        <div v-if="zaloCheck.result.value.warnings.length > 0" class="cuwz-warnings">
          <div v-for="w in zaloCheck.result.value.warnings" :key="w" class="cuwz-alert warning">{{ w }}</div>
        </div>

        <div class="cuwz-summary">
          <div><strong>Họ tên:</strong> {{ form.fullName }}</div>
          <div><strong>SĐT login:</strong> {{ form.phone }}</div>
          <div v-if="form.email"><strong>Email:</strong> {{ form.email }}</div>
          <div v-if="selectedDeptName"><strong>Phòng ban:</strong> {{ selectedDeptName }}</div>
          <div v-if="selectedGroupName"><strong>Nhóm quyền:</strong> {{ selectedGroupName }}</div>
        </div>

        <div v-if="createError" class="cuwz-alert error">{{ createError }}</div>

        <footer class="cuwz-footer">
          <button class="btn-secondary" :disabled="creating" @click="step = 1">← Quay lại sửa</button>
          <button class="btn-primary" :disabled="creating" @click="onConfirmCreate">
            <span v-if="creating">⏳ Đang tạo + gửi tin...</span>
            <span v-else>✅ Xác nhận tạo nhân viên</span>
          </button>
        </footer>
      </div>

      <!-- ── STEP 3: Success ────────────────────────────────────────────── -->
      <div v-else-if="step === 3 && createResult" class="cuwz-body">
        <div class="cuwz-success-banner">
          <div class="cuwz-success-icon">✅</div>
          <div>
            <div class="cuwz-success-title">Đã tạo {{ createResult.user.fullName }}</div>
            <div class="cuwz-success-sub">
              <span v-if="createResult.zalo.autoAccepted">🟡 Đã tự accept friend request từ sale · </span>
              <span v-if="createResult.zalo.messageSent && createResult.zalo.deliveryChannel === 'inbox'">
                ✅ Tin login đã gửi vào hộp chat chính
              </span>
              <span v-else-if="createResult.zalo.messageSent && createResult.zalo.deliveryChannel === 'strangers'">
                ⚠️ Tin login đã gửi vào tab "Người lạ" — dặn sale check
              </span>
              <span v-else-if="createResult.zalo.fallbackSentToAdmin">
                ❌ Tin gửi sale fail — đã gửi credentials qua Zalo admin để chuyển thủ công
              </span>
              <span v-else>
                ❌ Tin login gửi sale fail
              </span>
            </div>
          </div>
        </div>

        <div class="cuwz-creds">
          <h4>Thông tin đăng nhập (copy gửi cho sale)</h4>
          <textarea
            class="cuwz-cred-textarea"
            :value="credentialsText"
            readonly
            rows="6"
            @focus="($event.target as HTMLTextAreaElement).select()"
          ></textarea>
          <button class="btn-copy-all" @click="copy(credentialsText)">
            {{ copiedAll ? '✅ Đã copy' : '📋 Copy toàn bộ' }}
          </button>
          <div class="cuwz-cred-note">Sale sẽ bị bắt buộc đổi mật khẩu ngay lần đăng nhập đầu tiên.</div>
        </div>

        <div v-if="createResult.zalo.error" class="cuwz-alert warning">
          Chi tiết lỗi gửi tin: {{ createResult.zalo.error }}
        </div>

        <footer class="cuwz-footer">
          <button class="btn-primary" @click="finish">Đóng + xem danh sách</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { api } from '@/api/index';
import { useZaloPhoneCheck, type FriendRelation } from '@/composables/use-zalo-phone-check';

interface DeptNode {
  id: string;
  name: string;
  _depth: number;
}
interface GroupNode {
  id: string;
  name: string;
  _depth: number;
}

interface Props {
  open: boolean;
  departments: DeptNode[];
  permissionGroups: GroupNode[];
}
const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'created'): void;
}>();

interface CreateResult {
  user: { id: string; fullName: string; email: string | null; phone: string; role: string };
  tempPassword: string;
  zalo: {
    relation: FriendRelation;
    autoAccepted: boolean;
    messageSent: boolean;
    deliveryChannel: 'inbox' | 'strangers' | 'failed';
    fallbackSentToAdmin: boolean;
    error: string | null;
  };
}

const step = ref<1 | 2 | 3>(1);
const form = reactive({
  fullName: '',
  phone: '',
  email: '',
  departmentId: '',
  permissionGroupId: '',
});
const creating = ref(false);
const createError = ref('');
const createResult = ref<CreateResult | null>(null);

const zaloCheck = useZaloPhoneCheck();

const canCheck = computed(() => form.fullName.trim().length > 0 && form.phone.trim().length > 0);

const flatDepts = computed(() => props.departments || []);
const flatGroups = computed(() => props.permissionGroups || []);

const selectedDeptName = computed(() => {
  const d = flatDepts.value.find((x) => x.id === form.departmentId);
  return d?.name ?? '';
});
const selectedGroupName = computed(() => {
  const g = flatGroups.value.find((x) => x.id === form.permissionGroupId);
  return g?.name ?? '';
});

const relationInfo = computed(() => {
  const r = zaloCheck.result.value?.relation ?? 'none';
  return zaloCheck.RELATION_LABEL[r];
});

const genderText = computed(() => {
  const g = zaloCheck.result.value?.preview?.gender;
  if (g === 0) return 'Nam';
  if (g === 1) return 'Nữ';
  return '';
});

async function onCheckPhone() {
  await zaloCheck.check(form.phone.trim());
  if (zaloCheck.result.value?.found) {
    step.value = 2;
  }
}

async function onConfirmCreate() {
  if (!zaloCheck.result.value?.preview) return;
  creating.value = true;
  createError.value = '';
  try {
    const { data } = await api.post('/users/create-with-zalo', {
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      departmentId: form.departmentId || null,
      permissionGroupId: form.permissionGroupId || null,
      role: 'member',
      confirmedUid: zaloCheck.result.value.preview.uid,
    });
    createResult.value = data as CreateResult;
    step.value = 3;
  } catch (err: any) {
    createError.value = err?.response?.data?.error || 'Tạo user thất bại';
  } finally {
    creating.value = false;
  }
}

function tryClose() {
  if (creating.value) return;
  emit('update:open', false);
}

function finish() {
  emit('created');
  emit('update:open', false);
}

// 2026-06-07 anh chốt: bước 3 gộp credentials thành 1 text copy gửi sale thủ công.
const loginUrl = window.location.origin + '/login';
const credentialsText = computed(() => {
  const r = createResult.value;
  if (!r) return '';
  const lines = [
    `Tài khoản CRM — ${r.user.fullName}`,
    '',
    `SĐT đăng nhập: ${r.user.phone}`,
  ];
  if (r.user.email) lines.push(`Email: ${r.user.email}`);
  lines.push(`Mật khẩu tạm: ${r.tempPassword}`);
  lines.push(`Link đăng nhập: ${loginUrl}`);
  lines.push('');
  lines.push('Lưu ý: Đăng nhập lần đầu sẽ được yêu cầu đổi sang mật khẩu riêng.');
  return lines.join('\n');
});

const copiedAll = ref(false);
function copy(text: string) {
  try {
    navigator.clipboard?.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  copiedAll.value = true;
  window.setTimeout(() => { copiedAll.value = false; }, 2000);
}

// Reset state when modal opens fresh
watch(
  () => props.open,
  (open) => {
    if (open) {
      step.value = 1;
      form.fullName = '';
      form.phone = '';
      form.email = '';
      form.departmentId = '';
      form.permissionGroupId = '';
      createError.value = '';
      createResult.value = null;
      zaloCheck.reset();
    }
  },
);
</script>

<style scoped>
.cuwz-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1000;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.cuwz-modal {
  background: var(--cream, #fffaf2); border-radius: 14px; width: 100%; max-width: 560px;
  max-height: 90vh; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}
.cuwz-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.cuwz-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
.cuwz-close {
  border: 0; background: transparent; font-size: 24px; cursor: pointer;
  width: 32px; height: 32px; line-height: 1; border-radius: 6px;
}
.cuwz-close:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
.cuwz-stepper {
  display: flex; gap: 8px; padding: 12px 22px; font-size: 13px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05); color: #888;
}
.cuwz-stepper .step.active { color: #2d6cdf; font-weight: 600; }
.cuwz-body { padding: 20px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.cuwz-field { display: flex; flex-direction: column; gap: 6px; }
.cuwz-field label { font-size: 13px; font-weight: 500; color: #444; }
.cuwz-field .req { color: #d9534f; }
.cuwz-field input,
.cuwz-field select {
  font: inherit; padding: 9px 11px; border: 1px solid #cfcfcf; border-radius: 7px;
  background: white;
}
.cuwz-field input:focus,
.cuwz-field select:focus { outline: 2px solid #2d6cdf55; border-color: #2d6cdf; }
.cuwz-field .has-check { border-color: #2d6cdf; }
.cuwz-hint { font-size: 12px; color: #888; }
.cuwz-row { display: flex; gap: 12px; }
.flex1 { flex: 1; }
.cuwz-footer {
  display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.06); margin-top: auto;
}
.btn-primary {
  background: #2d6cdf; color: white; border: 0; padding: 9px 16px;
  border-radius: 7px; font: inherit; font-weight: 500; cursor: pointer;
}
.btn-primary:disabled { background: #aac4ec; cursor: not-allowed; }
.btn-secondary {
  background: transparent; color: #555; border: 1px solid #cfcfcf;
  padding: 9px 16px; border-radius: 7px; font: inherit; cursor: pointer;
}
.cuwz-preview {
  display: flex; gap: 14px; padding: 14px;
  background: rgba(45, 108, 223, 0.06); border-radius: 10px;
}
.cuwz-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; }
.cuwz-displayname { font-size: 17px; font-weight: 600; }
.cuwz-zaloname { font-size: 13px; color: #666; }
.cuwz-meta { font-size: 12px; color: #888; margin-top: 4px; }
.cuwz-uid { font-size: 11px; color: #aaa; margin-top: 2px; }
.cuwz-uid code { font-family: monospace; background: rgba(0, 0, 0, 0.04); padding: 1px 5px; border-radius: 3px; }
.cuwz-relation {
  display: flex; gap: 10px; padding: 12px 14px; border-radius: 9px;
  border: 1px solid; align-items: flex-start;
}
.cuwz-relation .rel-emoji { font-size: 22px; }
.cuwz-relation .rel-label { font-weight: 600; }
.cuwz-relation .rel-help { font-size: 12px; opacity: 0.8; margin-top: 2px; }
.relation-friend { background: #e6f4ea; border-color: #34a85333; color: #1e6e2c; }
.relation-received_from_them { background: #fff8e1; border-color: #fbc02d55; color: #8a6300; }
.relation-sent_by_me { background: #e3f2fd; border-color: #2196f355; color: #1976d2; }
.relation-none { background: #f5f5f5; border-color: #ccc; color: #555; }
.cuwz-warnings { display: flex; flex-direction: column; gap: 6px; }
.cuwz-alert {
  padding: 9px 12px; border-radius: 7px; font-size: 13px;
  border-left: 3px solid;
}
.cuwz-alert.error { background: #fdecea; color: #b71c1c; border-color: #d9534f; }
.cuwz-alert.warning { background: #fff8e1; color: #6d4c00; border-color: #fbc02d; }
.cuwz-summary {
  background: rgba(0, 0, 0, 0.03); padding: 12px; border-radius: 9px; font-size: 13px;
  display: flex; flex-direction: column; gap: 4px;
}
.cuwz-success-banner {
  display: flex; gap: 14px; padding: 14px;
  background: #e6f4ea; border-radius: 10px;
}
.cuwz-success-icon { font-size: 30px; }
.cuwz-success-title { font-size: 17px; font-weight: 600; color: #1e6e2c; }
.cuwz-success-sub { font-size: 13px; color: #555; margin-top: 2px; }
.cuwz-creds {
  padding: 14px; background: rgba(0, 0, 0, 0.03); border-radius: 9px;
}
.cuwz-creds h4 { margin: 0 0 10px 0; font-size: 14px; }
.cuwz-cred-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 13px; }
.cuwz-cred-row span { color: #666; min-width: 130px; }
.cuwz-cred-row code {
  font-family: monospace; background: white; padding: 3px 9px; border-radius: 5px;
  border: 1px solid #ddd; flex: 1;
}
.btn-copy {
  border: 1px solid #cfcfcf; background: white; padding: 4px 10px;
  border-radius: 5px; font-size: 12px; cursor: pointer;
}
.btn-copy:hover { background: #f5f5f5; }
.cuwz-cred-note { font-size: 12px; color: #888; margin-top: 6px; }
/* 2026-06-07 — credentials gộp 1 text copy gửi sale thủ công */
.cuwz-cred-textarea {
  width: 100%; box-sizing: border-box; font-family: var(--mono, monospace);
  font-size: 12.5px; line-height: 1.6; background: white; border: 1px solid #ddd;
  border-radius: 7px; padding: 10px 12px; color: #1f2937; resize: vertical;
}
.cuwz-cred-textarea:focus { outline: none; border-color: var(--brand, #1786be); }
.btn-copy-all {
  margin-top: 8px; border: none; background: var(--brand, #1786be); color: white;
  padding: 8px 16px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.btn-copy-all:hover { filter: brightness(0.95); }
</style>
