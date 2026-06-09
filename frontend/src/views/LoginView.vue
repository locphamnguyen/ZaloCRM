<template>
  <!-- 2026-06-09 (anh chốt): login 2 cột — banner thương hiệu HS Holding + form.
       Banner teal-navy: logo HS + ZaloCRM + slogan "Bền vững · Trường tồn".
       HD-first 1366×768; ≤900px xếp dọc (banner gọn trên, form dưới). -->
  <div class="login-card">
    <!-- ══ Cột trái: banner thương hiệu ══ -->
    <aside class="login-brand">
      <div class="brand-glow"></div>
      <div class="brand-inner">
        <div class="brand-logo">
          <img src="/brand/hs-monogram.png" alt="HS Holding" />
        </div>
        <h1 class="brand-name">HS Holding</h1>
        <div class="brand-product">ZaloCRM</div>
        <div class="brand-divider"></div>
        <p class="brand-slogan">Bền vững <span class="dot">·</span> Trường tồn</p>
      </div>
      <div class="brand-foot">© {{ year }} HS Holding</div>
    </aside>

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
            placeholder="admin@hs.com hoặc 0987 654 321"
            persistent-placeholder
            class="mb-4"
          />
          <v-text-field
            v-model="password"
            label="Mật khẩu"
            type="password"
            variant="outlined"
            prepend-inner-icon="mdi-lock-outline"
            required
            autocomplete="current-password"
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
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const identifier = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const year = computed(() => new Date().getFullYear());

// Phase Onboarding v1 — sau khi force change password thành công, redirect về /login?password-changed=1
const passwordChangedNotice = ref(route.query['password-changed'] === '1');

onMounted(async () => {
  try {
    const needs = await authStore.checkSetup();
    if (needs) router.replace('/setup');
  } catch {}
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

/* ══ Cột trái: banner teal-navy HS Holding ══ */
.login-brand {
  position: relative;
  flex: 0 0 42%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 40px 32px;
  background: linear-gradient(160deg, #0e445a 0%, #06222f 100%);
  color: #fff;
  overflow: hidden;
  text-align: center;
}
/* Vầng sáng cyan trang trí */
.brand-glow {
  position: absolute;
  top: -80px; right: -80px;
  width: 280px; height: 280px;
  background: radial-gradient(circle, rgba(23, 134, 190, 0.45) 0%, transparent 70%);
  pointer-events: none;
}
.brand-inner { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; }
.brand-logo {
  width: 92px; height: 92px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  margin-bottom: 20px;
}
.brand-logo img { width: 60px; height: 60px; object-fit: contain; }
.brand-name {
  font-size: 26px; font-weight: 800; letter-spacing: 0.5px;
  margin: 0; line-height: 1.1;
}
.brand-product {
  margin-top: 6px;
  font-size: 13px; font-weight: 600; letter-spacing: 3px;
  color: #6fc5ea; text-transform: uppercase;
}
.brand-divider {
  width: 44px; height: 3px; border-radius: 2px;
  background: linear-gradient(90deg, #1786be, #6fc5ea);
  margin: 22px 0 16px;
}
.brand-slogan {
  font-size: 17px; font-weight: 600; letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.92);
  margin: 0;
}
.brand-slogan .dot { color: #6fc5ea; margin: 0 4px; }
.brand-foot {
  position: relative; z-index: 1;
  margin-top: auto; padding-top: 28px;
  font-size: 11px; color: rgba(255, 255, 255, 0.45);
}

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

/* ══ Responsive: ≤900px xếp dọc (banner gọn trên) ══ */
@media (max-width: 900px) {
  .login-card { flex-direction: column; max-width: 420px; min-height: 0; }
  .login-brand { flex: none; padding: 28px 24px; }
  .brand-logo { width: 64px; height: 64px; border-radius: 16px; margin-bottom: 12px; }
  .brand-logo img { width: 42px; height: 42px; }
  .brand-name { font-size: 21px; }
  .brand-divider { margin: 14px 0 10px; }
  .brand-slogan { font-size: 15px; }
  .brand-foot { display: none; }
  .login-form-wrap { padding: 32px 28px; }
  .form-inner { max-width: 100%; }
}
</style>
