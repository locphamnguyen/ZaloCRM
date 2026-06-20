<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- Preview trang /login trong Cài đặt › Hồ sơ tổ chức. Dựng lại y hệt login
       (banner dùng chung LoginBrandBanner + form tĩnh) rồi scale gọn để vừa khung.
       Không tương tác — chỉ để xem trước branding sẽ hiển thị thế nào. -->
  <div class="login-card">
    <LoginBrandBanner
      :logo-url="logoUrl"
      :name="name"
      :slogan="slogan"
      :copyright="copyright"
    />
    <section class="login-form-wrap">
      <div class="form-inner">
        <h2 class="form-title">Đăng nhập</h2>
        <p class="form-sub">Chào mừng Anh/Chị quay lại hệ thống</p>
        <v-text-field
          :model-value="''"
          label="Email hoặc số điện thoại"
          variant="outlined"
          prepend-inner-icon="mdi-account-outline"
          :placeholder="emailPlaceholder"
          persistent-placeholder
          readonly
          hide-details
          class="mb-4"
        />
        <v-text-field
          :model-value="''"
          label="Mật khẩu"
          type="password"
          variant="outlined"
          prepend-inner-icon="mdi-lock-outline"
          placeholder="Nhập mật khẩu"
          persistent-placeholder
          readonly
          hide-details
          class="mb-5"
        />
        <v-btn color="primary" block size="large" rounded="lg">
          <v-icon start>mdi-login</v-icon>
          Đăng nhập
        </v-btn>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import LoginBrandBanner from './LoginBrandBanner.vue';

defineProps<{
  logoUrl?: string | null;
  name: string;
  slogan?: string | null;
  copyright?: string | null;
  emailPlaceholder: string;
}>();
</script>

<style scoped>
/* Preview để KÍCH THƯỚC THẬT 880×460 (anh chốt 2026-06-12), không scale.
   max-width: none để THẮNG rule global hs-crm-theme.css (.login-card{max-width:384px})
   — theme login cũ rò vào class trùng tên, làm preview bị bóp ~384px. */
.login-card {
  display: flex;
  width: 880px;
  max-width: none;
  height: 460px;
  pointer-events: none;  /* preview tĩnh, không click được */
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 60px -12px rgba(6, 34, 47, 0.28), 0 8px 24px -8px rgba(6, 34, 47, 0.18);
}
.login-form-wrap {
  flex: 1 1 58%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 44px 40px;
}
.form-inner { width: 100%; max-width: 340px; }
.form-title { font-size: 24px; font-weight: 700; color: #0e445a; margin: 0 0 4px; }
.form-sub { font-size: 13.5px; color: #6b7884; margin: 0 0 26px; }
</style>
