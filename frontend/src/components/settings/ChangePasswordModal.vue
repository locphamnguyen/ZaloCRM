<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3>Đổi mật khẩu</h3>
        <span class="x" @click="$emit('close')">×</span>
      </div>

      <form class="modal-body" @submit.prevent="onSubmit">
        <p class="hint">Mật khẩu nên dài ≥8 ký tự, có chữ HOA + thường + số.</p>

        <div class="mfield">
          <label for="cur-pw">Mật khẩu hiện tại</label>
          <div class="pw-wrap">
            <input id="cur-pw" v-model="currentPassword" :type="showCur ? 'text' : 'password'" autocomplete="current-password" required placeholder="Nhập mật khẩu đang dùng" />
            <button type="button" class="pw-eye" tabindex="-1"
                    :aria-label="showCur ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                    @click="showCur = !showCur">
              <EyeOff v-if="showCur" :size="17" /><Eye v-else :size="17" />
            </button>
          </div>
        </div>
        <div class="mfield">
          <label for="new-pw">Mật khẩu mới</label>
          <div class="pw-wrap">
            <input id="new-pw" v-model="newPassword" :type="showNew ? 'text' : 'password'" autocomplete="new-password" minlength="8" required placeholder="Tối thiểu 8 ký tự" />
            <button type="button" class="pw-eye" tabindex="-1"
                    :aria-label="showNew ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                    @click="showNew = !showNew">
              <EyeOff v-if="showNew" :size="17" /><Eye v-else :size="17" />
            </button>
          </div>
        </div>
        <ul v-if="newPassword" class="pwstrength">
          <li :class="{ ok: hasLength }">{{ hasLength ? '✓' : '○' }} Ít nhất 8 ký tự</li>
          <li :class="{ ok: hasUpper }">{{ hasUpper ? '✓' : '○' }} Có chữ HOA</li>
          <li :class="{ ok: hasLower }">{{ hasLower ? '✓' : '○' }} Có chữ thường</li>
          <li :class="{ ok: hasDigit }">{{ hasDigit ? '✓' : '○' }} Có chữ số</li>
        </ul>
        <div class="mfield">
          <label for="confirm-pw">Xác nhận mật khẩu</label>
          <div class="pw-wrap">
            <input id="confirm-pw" v-model="confirmPassword" :type="showConfirm ? 'text' : 'password'" autocomplete="new-password" required placeholder="Nhập lại mật khẩu mới" />
            <button type="button" class="pw-eye" tabindex="-1"
                    :aria-label="showConfirm ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                    @click="showConfirm = !showConfirm">
              <EyeOff v-if="showConfirm" :size="17" /><Eye v-else :size="17" />
            </button>
          </div>
          <span v-if="confirmPassword && confirmPassword !== newPassword" class="mismatch">Mật khẩu xác nhận không khớp</span>
        </div>

        <div v-if="error" class="form-error">{{ error }}</div>
        <p class="note">Sau khi đổi mật khẩu, bạn sẽ đăng xuất và cần đăng nhập lại bằng mật khẩu mới.</p>

        <div class="modal-foot">
          <button type="button" class="btn" @click="$emit('close')" :disabled="saving">Huỷ</button>
          <button type="submit" class="btn btn-primary" :disabled="!canSubmit || saving">
            <span v-if="saving">Đang lưu...</span><span v-else>💾 Đổi mật khẩu</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Eye, EyeOff } from 'lucide-vue-next';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

defineEmits<{ close: [] }>();

const authStore = useAuthStore();
const router = useRouter();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const error = ref('');
const showCur = ref(false);
const showNew = ref(false);
const showConfirm = ref(false);

// Giữ nguyên regex từ PersonalPasswordPage cũ (8+/HOA/thường/số) + dùng /me/change-password.
const hasLength = computed(() => newPassword.value.length >= 8);
const hasUpper = computed(() => /[A-Z]/.test(newPassword.value));
const hasLower = computed(() => /[a-z]/.test(newPassword.value));
const hasDigit = computed(() => /\d/.test(newPassword.value));
const allValid = computed(() => hasLength.value && hasUpper.value && hasLower.value && hasDigit.value);
const canSubmit = computed(() => !!currentPassword.value && allValid.value && newPassword.value === confirmPassword.value);

async function onSubmit() {
  if (!canSubmit.value) return;
  error.value = '';
  saving.value = true;
  try {
    await api.post('/me/change-password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    // change-password revoke JWT cũ → logout + về login đăng nhập lại bằng mật khẩu mới.
    authStore.logout();
    router.push('/login?password-changed=1');
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Không thể đổi mật khẩu';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(12,28,38,.42);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: #fff; border-radius: var(--r-lg, 14px);
  box-shadow: var(--sh-lg, 0 12px 32px rgba(20,26,36,.18));
  width: 440px; max-width: 92vw; overflow: hidden;
}
.modal-head {
  padding: 18px 22px; border-bottom: 1px solid var(--line-2, #eef1f6);
  display: flex; align-items: center; justify-content: space-between;
}
.modal-head h3 { font-size: 16px; font-weight: 700; margin: 0; color: var(--ink, #141a24); }
.modal-head .x { cursor: pointer; color: var(--ink-4, #97a0b3); font-size: 22px; line-height: 1; }
.modal-head .x:hover { color: var(--ink-2, #475066); }
.modal-body { padding: 20px 22px; }
.hint { font-size: 12.5px; color: var(--ink-3, #6b7488); margin: 0 0 16px; }

.mfield { margin-bottom: 14px; }
.mfield label {
  display: block; font-size: 11.5px; font-weight: 600; color: var(--ink-3, #6b7488);
  text-transform: uppercase; letter-spacing: .04em; margin-bottom: 5px;
}
.mfield input {
  width: 100%; padding: 9px 12px; font-size: 14px;
  border: 1px solid var(--line, #e7eaf0); border-radius: var(--r-sm, 8px);
  outline: none; font-family: inherit;
}
.mfield input:focus { border-color: var(--brand, #1786be); box-shadow: 0 0 0 3px rgba(23,134,190,.12); }

.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 40px; width: 100%; box-sizing: border-box; }
.pw-eye {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0; margin: 0;
  border: none; background: transparent; cursor: pointer;
  color: var(--ink-4, #97a0b3); border-radius: 6px;
}
.pw-eye:hover { color: var(--ink-2, #475066); background: rgba(0,0,0,.04); }
.mismatch { font-size: 11.5px; color: var(--error, #f04438); margin-top: 4px; display: block; }

.pwstrength {
  list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px;
  margin: -4px 0 14px; padding: 0; font-size: 11.5px; color: var(--ink-4, #97a0b3);
}
.pwstrength li.ok { color: var(--success, #12b76a); }

.form-error {
  font-size: 12.5px; color: var(--error, #f04438); background: var(--error-soft, #fdeceb);
  padding: 8px 12px; border-radius: var(--r-sm, 8px); margin-bottom: 12px;
}
.note { font-size: 12px; color: var(--ink-3, #6b7488); margin: 0 0 4px; line-height: 1.5; }

.modal-foot {
  padding: 14px 22px; border-top: 1px solid var(--line-2, #eef1f6);
  display: flex; justify-content: flex-end; gap: 10px; background: var(--surface-2, #f7f9fc);
  margin: 16px -22px -20px;
}
.btn {
  padding: 9px 18px; font-size: 13px; font-weight: 600;
  border-radius: var(--r-sm, 8px); border: 1px solid var(--line, #e7eaf0);
  background: #fff; color: var(--ink, #141a24); cursor: pointer; font-family: inherit;
}
.btn:hover:not(:disabled) { background: var(--surface-3, #f1f4f9); }
.btn:disabled { opacity: .55; cursor: default; }
.btn-primary { background: var(--brand, #1786be); border-color: var(--brand, #1786be); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--brand-600, #0f6fa0); }
</style>
