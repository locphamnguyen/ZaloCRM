<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- 2026-06-09 (anh chốt): login 2 cột — banner thương hiệu HS Holding + form.
       Banner teal-navy: logo HS + ZaloCRM + slogan "Bền vững · Trường tồn".
       HD-first 1366×768; ≤900px xếp dọc (banner gọn trên, form dưới). -->
  <div class="login-card">
    <!-- ══ Cột trái: banner thương hiệu (component dùng chung với preview) ══ -->
    <LoginBrandBanner
      :logo-url="brandLogo"
      :name="brandName"
      :slogan="brandSlogan"
      :copyright="brandCopyright"
    />

    <!-- ══ Cột phải: form đăng nhập ══ -->
    <section class="login-form-wrap">
      <div class="form-inner">
        <h2 class="form-title">Đăng nhập</h2>
        <p class="form-sub">Chào mừng Anh/Chị quay lại hệ thống</p>

        <v-form @submit.prevent="handleLogin">
          <v-text-field
            v-model="identifier"
            label="Email hoặc số điện thoại"
            type="text"
            variant="outlined"
            prepend-inner-icon="mdi-account-outline"
            required
            autocomplete="username"
            :placeholder="emailPlaceholder"
            persistent-placeholder
            class="mb-4"
          />
          <v-text-field
            v-model="password"
            label="Mật khẩu"
            :type="showPassword ? 'text' : 'password'"
            variant="outlined"
            prepend-inner-icon="mdi-lock-outline"
            :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner="showPassword = !showPassword"
            required
            autocomplete="current-password"
            placeholder="Nhập mật khẩu"
            persistent-placeholder
            class="mb-5"
          />
          <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="lg" class="login-btn">
            <v-icon start>mdi-login</v-icon>
            Đăng nhập
          </v-btn>
        </v-form>

        <v-alert v-if="passwordChangedNotice" type="success" class="mt-4" density="compact" closable variant="tonal">
          ✅ Mật khẩu đã đổi thành công. Vui lòng đăng nhập lại với mật khẩu mới.
        </v-alert>
        <v-alert v-if="error" type="error" class="mt-4" density="compact" closable variant="tonal">
          {{ error }}
        </v-alert>

        <!-- AGPL-3.0 §13: cung cấp mã nguồn cho người dùng tương tác qua mạng. -->
        <p class="agpl-source text-center text-caption mt-6">
          ZaloCRM — phần mềm tự do
          <a href="https://github.com/locphamnguyen/ZaloCRM" target="_blank" rel="noopener noreferrer">AGPL-3.0</a>
          · <a href="https://github.com/locphamnguyen/ZaloCRM" target="_blank" rel="noopener noreferrer">Mã nguồn</a>
        </p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { fetchPublicBranding } from '@/api/public-branding';
import LoginBrandBanner from '@/components/branding/LoginBrandBanner.vue';

// SĐT mẫu cố định trong gợi ý ô đăng nhập (kèm sau email theo tên miền tổ chức).
const SAMPLE_PHONE = '0901 234 567';

const identifier = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

// ── Branding hiển thị (mặc định = giá trị hardcode HS Holding) ────────────────
// Login chạy pre-auth: render mặc định NGAY, fetch org-branding xong mới thay vào
// (D4-A). Nếu endpoint lỗi/chậm/chưa có org → giữ mặc định, login không bị chặn.
const DEFAULT_LOGO = '/brand/hs-monogram.png';
const DEFAULT_PLACEHOLDER = `admin@hs.com hoặc ${SAMPLE_PHONE}`;
const brandLogo = ref(DEFAULT_LOGO);
const brandName = ref('HS Holding');
const brandSlogan = ref('Bền vững · Trường tồn');
const brandCopyright = ref(`© ${new Date().getFullYear()} HS Holding`);
const emailPlaceholder = ref(DEFAULT_PLACEHOLDER);

// Phase Onboarding v1 — sau khi force change password thành công, redirect về /login?password-changed=1
const passwordChangedNotice = ref(route.query['password-changed'] === '1');

onMounted(() => {
  // Setup-check (điều hướng /setup) và branding fetch chạy song song, độc lập.
  authStore
    .checkSetup()
    .then((needs) => {
      if (needs) router.replace('/setup');
    })
    .catch(() => {});

  fetchPublicBranding()
    .then((b) => {
      if (!b) return; // fetch lỗi → giữ mặc định hardcode (resilience)
      // Org tồn tại → hiển thị ĐÚNG cấu hình: trường trống thì ẩn (banner v-if),
      // KHÔNG giữ chữ mặc định (fix slogan vẫn ra "Bền vững · Trường tồn").
      brandLogo.value = b.logoUrl || DEFAULT_LOGO;
      brandName.value = b.name || 'HS Holding';
      brandSlogan.value = b.slogan || '';
      brandCopyright.value = b.copyright || '';
      emailPlaceholder.value = b.emailDomain
        ? `user@${b.emailDomain} hoặc ${SAMPLE_PHONE}`
        : DEFAULT_PLACEHOLDER;
    })
    .catch(() => {});
});

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.login(identifier.value, password.value);
    router.push('/');
  } catch (err: any) {
    // 2026-06-09 (anh báo lỗi "Unauthorized"): server trả {error:'Unauthorized', message:'...'}
    // cho lỗi 401 — field `error` là tên HTTP status (xấu), `message` mới là câu tiếng Việt.
    // Ưu tiên đọc message; nếu là tên status thì fallback câu dễ hiểu.
    const data = err.response?.data;
    const raw = data?.message || data?.error || '';
    const isStatusName = /^(unauthorized|bad request|forbidden|internal server error)$/i.test(raw);
    error.value = (raw && !isStatusName) ? raw : 'Email/SĐT hoặc mật khẩu không đúng';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-card {
  display: flex;
  width: 100%;
  max-width: 880px;
  min-height: 460px;
  margin: 0 16px;
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px -12px rgba(6, 34, 47, 0.28), 0 8px 24px -8px rgba(6, 34, 47, 0.18);
}

/* Banner cột trái đã tách sang component LoginBrandBanner.vue (DRY). */

/* ══ Cột phải: form ══ */
.login-form-wrap {
  flex: 1 1 58%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 44px 40px;
}
.form-inner { width: 100%; max-width: 340px; }
.form-title {
  font-size: 24px; font-weight: 700; color: #0e445a;
  margin: 0 0 4px;
}
.form-sub {
  font-size: 13.5px; color: #6b7884;
  margin: 0 0 26px;
}
.login-btn { font-weight: 600; letter-spacing: 0.3px; margin-top: 2px; }

/* ══ Responsive: ≤900px xếp dọc (banner tự thu gọn trong component) ══ */
@media (max-width: 900px) {
  .login-card { flex-direction: column; max-width: 420px; min-height: 0; }
  .login-form-wrap { padding: 32px 28px; }
  .form-inner { max-width: 100%; }
}
</style>
