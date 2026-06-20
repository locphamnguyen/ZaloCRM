<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- Banner thương hiệu cột trái của trang đăng nhập. Dùng chung cho /login và
       preview trong Cài đặt › Hồ sơ tổ chức (DRY — 1 nguồn giao diện duy nhất). -->
  <aside class="login-brand">
    <div class="brand-glow"></div>
    <div class="brand-inner">
      <div class="brand-logo">
        <img :src="logo" :alt="name" @error="onLogoError" />
      </div>
      <h1 class="brand-name">{{ name }}</h1>
      <div class="brand-product">ZaloCRM</div>
      <div class="brand-divider"></div>
      <p v-if="slogan" class="brand-slogan">{{ slogan }}</p>
    </div>
    <div v-if="copyright" class="brand-foot">{{ copyright }}</div>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  logoUrl?: string | null;
  name: string;
  slogan?: string | null;
  copyright?: string | null;
}>();

const DEFAULT_LOGO = '/brand/hs-monogram.png';
const logo = ref(props.logoUrl || DEFAULT_LOGO);

// Logo cấu hình hỏng (404/URL sai) → fallback ảnh mặc định.
function onLogoError() {
  if (logo.value !== DEFAULT_LOGO) logo.value = DEFAULT_LOGO;
}

// Đồng bộ khi prop đổi (preview cập nhật realtime theo form).
watch(
  () => props.logoUrl,
  (v) => { logo.value = v || DEFAULT_LOGO; },
);
</script>

<style scoped>
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
.brand-foot {
  position: relative; z-index: 1;
  margin-top: auto; padding-top: 28px;
  font-size: 11px; color: rgba(255, 255, 255, 0.45);
}

/* ≤900px: banner gọn lại (login xếp dọc) */
@media (max-width: 900px) {
  .login-brand { flex: none; padding: 28px 24px; }
  .brand-logo { width: 64px; height: 64px; border-radius: 16px; margin-bottom: 12px; }
  .brand-logo img { width: 42px; height: 42px; }
  .brand-name { font-size: 21px; }
  .brand-divider { margin: 14px 0 10px; }
  .brand-slogan { font-size: 15px; }
  .brand-foot { display: none; }
}
</style>
