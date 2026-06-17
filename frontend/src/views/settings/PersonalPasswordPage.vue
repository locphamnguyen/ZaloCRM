<template>
  <div class="password-page">
    <div class="page-head">
      <h2 class="page-title">Đổi mật khẩu</h2>
      <p class="page-desc">Đặt mật khẩu mới cho tài khoản. Mật khẩu nên dài ≥8 ký tự, chứa chữ + số.</p>
    </div>

    <form class="password-form" @submit.prevent="onSubmit">
      <div class="form-row">
        <label for="current-pw">Mật khẩu hiện tại</label>
        <div class="pw-wrap">
          <input
            id="current-pw"
            v-model="currentPassword"
            :type="showCur ? 'text' : 'password'"
            autocomplete="current-password"
            required
            placeholder="Nhập mật khẩu đang dùng"
          />
          <button type="button" class="pw-eye" tabindex="-1"
                  :aria-label="showCur ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                  @click="showCur = !showCur">
            <EyeOff v-if="showCur" :size="17" /><Eye v-else :size="17" />
          </button>
        </div>
      </div>
      <div class="form-row">
        <label for="new-pw">Mật khẩu mới</label>
        <div class="pw-wrap">
          <input
            id="new-pw"
            v-model="newPassword"
            :type="showNew ? 'text' : 'password'"
            autocomplete="new-password"
            minlength="8"
            required
            placeholder="Tối thiểu 8 ký tự, có hoa + thường + số"
          />
          <button type="button" class="pw-eye" tabindex="-1"
                  :aria-label="showNew ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                  @click="showNew = !showNew">
            <EyeOff v-if="showNew" :size="17" /><Eye v-else :size="17" />
          </button>
        </div>
      </div>
      <ul v-if="newPassword" class="pw-strength">
        <li :class="{ ok: hasLength }">{{ hasLength ? '✓' : '○' }} Ít nhất 8 ký tự</li>
        <li :class="{ ok: hasUpper }">{{ hasUpper ? '✓' : '○' }} Có chữ HOA</li>
        <li :class="{ ok: hasLower }">{{ hasLower ? '✓' : '○' }} Có chữ thường</li>
        <li :class="{ ok: hasDigit }">{{ hasDigit ? '✓' : '○' }} Có chữ số</li>
      </ul>
      <div class="form-row">
        <label for="confirm-pw">Xác nhận mật khẩu</label>
        <div class="pw-wrap">
          <input
            id="confirm-pw"
            v-model="confirmPassword"
            :type="showConfirm ? 'text' : 'password'"
            autocomplete="new-password"
            required
            placeholder="Nhập lại mật khẩu mới"
          />
          <button type="button" class="pw-eye" tabindex="-1"
                  :aria-label="showConfirm ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                  @click="showConfirm = !showConfirm">
            <EyeOff v-if="showConfirm" :size="17" /><Eye v-else :size="17" />
          </button>
        </div>
        <span v-if="confirmPassword && confirmPassword !== newPassword" class="pw-mismatch">Mật khẩu xác nhận không khớp</span>
      </div>

      <div v-if="error" class="form-error">{{ error }}</div>
      <div v-if="success" class="form-success">✓ Đã đổi mật khẩu thành công</div>

      <div class="actions">
        <RouterLink to="/settings/personal/profile" class="btn-ghost">Huỷ</RouterLink>
        <button type="submit" class="btn-primary" :disabled="!canSubmit || saving">
          <span v-if="saving">Đang lưu...</span>
          <span v-else>💾 Đổi mật khẩu</span>
        </button>
      </div>
    </form>

    <div class="note">
      <strong>Lưu ý:</strong> Sau khi đổi mật khẩu, các phiên đăng nhập trên thiết bị khác có thể vẫn còn hiệu lực
      cho đến khi token hiện tại hết hạn. Vào <RouterLink to="/settings/personal/sessions">Phiên đăng nhập</RouterLink>
      để đăng xuất thiết bị khác (sắp ra mắt).
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { Eye, EyeOff } from 'lucide-vue-next';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
const router = useRouter();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const error = ref('');
const success = ref(false);
const showCur = ref(false);
const showNew = ref(false);
const showConfirm = ref(false);

// 2026-06-11 FIX: trước đây gọi PUT /users/:id/password (field 'password', reset
// owner/admin) → FE gửi 'newPassword' lệch → luôn báo "tối thiểu 6 ký tự". Giờ dùng
// POST /me/change-password (verify mật khẩu cũ) như /setup-password, regex 8+/hoa/thường/số.
const hasLength = computed(() => newPassword.value.length >= 8);
const hasUpper = computed(() => /[A-Z]/.test(newPassword.value));
const hasLower = computed(() => /[a-z]/.test(newPassword.value));
const hasDigit = computed(() => /\d/.test(newPassword.value));
const allValid = computed(() => hasLength.value && hasUpper.value && hasLower.value && hasDigit.value);

const canSubmit = computed(() =>
  !!currentPassword.value && allValid.value && newPassword.value === confirmPassword.value
);

async function onSubmit() {
  if (!canSubmit.value) return;
  error.value = '';
  success.value = false;
  saving.value = true;
  try {
    await api.post('/me/change-password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    success.value = true;
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
.password-page { max-width: 480px; font-family: inherit; }
.page-head { margin-bottom: 24px; }
.page-title { font-size: 20px; font-weight: 700; color: #1F2D3D; margin: 0 0 4px; }
.page-desc { font-size: 13px; color: #6B7785; margin: 0; line-height: 1.5; }

.password-form {
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 12px;
  padding: 24px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.form-row label {
  font-size: 11.5px;
  font-weight: 600;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.form-row input {
  padding: 9px 12px;
  font-size: 14px;
  border: 1px solid #E4E5E9;
  border-radius: 8px;
  outline: none;
  font-family: inherit;
  background: white;
}
.form-row input:focus {
  border-color: #5E6AD2;
  box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.12);
}

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

.pw-strength {
  list-style: none;
  margin: -8px 0 16px;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
}
.pw-strength li { font-size: 11.5px; color: #9CA3AF; }
.pw-strength li.ok { color: #16A34A; }
.pw-mismatch { font-size: 11.5px; color: #EF4444; margin-top: 2px; }

.form-error {
  font-size: 12.5px;
  color: #EF4444;
  background: #FEF2F2;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.form-success {
  font-size: 12.5px;
  color: #166534;
  background: #DCFCE7;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 8px;
}
.btn-ghost,
.btn-primary {
  padding: 9px 18px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid #E4E5E9;
  background: white;
  color: #1F2D3D;
  cursor: pointer;
  font-family: inherit;
  text-decoration: none;
}
.btn-primary {
  background: #5E6AD2;
  border-color: #5E6AD2;
  color: white;
}
.btn-primary:hover:not(:disabled) { background: #4E5AB8; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost:hover { background: #F4F4F7; }

.note {
  margin-top: 16px;
  padding: 12px 16px;
  background: #FAFAFC;
  border-left: 3px solid #5E6AD2;
  border-radius: 6px;
  font-size: 12.5px;
  color: #6B7785;
  line-height: 1.55;
}
.note a {
  color: #5E6AD2;
  text-decoration: none;
  font-weight: 500;
}
.note a:hover { text-decoration: underline; }
</style>
