<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-card class="pa-6" elevation="8">
    <div class="text-center mb-6">
      <v-icon icon="mdi-cog" size="64" color="primary" />
      <h1 class="text-h5 mt-2">Thiết lập ban đầu</h1>
      <p class="text-body-2 text-grey mt-1">Tạo tổ chức và tài khoản quản trị viên</p>
    </div>
    <v-form @submit.prevent="handleSetup" ref="form">
      <v-text-field v-model="orgName" label="Tên tổ chức / phòng khám" prepend-inner-icon="mdi-domain" :rules="[v => !!v || 'Bắt buộc']" class="mb-2" />
      <v-text-field v-model="fullName" label="Họ tên quản trị viên" prepend-inner-icon="mdi-account" :rules="[v => !!v || 'Bắt buộc']" class="mb-2" />
      <v-text-field v-model="email" label="Email đăng nhập" type="email" prepend-inner-icon="mdi-email" :rules="[v => !!v || 'Bắt buộc']" class="mb-2" />
      <v-text-field v-model="phone" label="Số điện thoại chủ tổ chức" type="tel" inputmode="tel" prepend-inner-icon="mdi-phone" :rules="phoneRules" class="mb-2" />
      <v-text-field v-model="password" label="Mật khẩu" :type="showPassword ? 'text' : 'password'" prepend-inner-icon="mdi-lock" :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'" @click:append-inner="showPassword = !showPassword" :rules="[v => v.length >= 6 || 'Tối thiểu 6 ký tự']" class="mb-4" />
      <v-btn type="submit" color="primary" block size="large" :loading="loading">Tạo tài khoản</v-btn>
    </v-form>
    <v-alert v-if="error" type="error" class="mt-4" density="compact" closable>{{ error }}</v-alert>
    <v-alert v-if="success" type="success" class="mt-4" density="compact">Tạo thành công! Đang chuyển hướng...</v-alert>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const orgName = ref('');
const fullName = ref('');
const email = ref('');
const phone = ref('');
const password = ref('');
// SĐT chủ tổ chức: bắt buộc + định dạng VN cơ bản (10–11 số, cho phép +84/khoảng trắng).
const phoneRules = [
  (v: string) => !!v || 'Bắt buộc',
  (v: string) => /^(\+?84|0)\d{8,10}$/.test((v || '').replace(/[\s.]/g, '')) || 'Số điện thoại không hợp lệ',
];
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');
const success = ref(false);
const router = useRouter();
const authStore = useAuthStore();

async function handleSetup() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.setup({ orgName: orgName.value, fullName: fullName.value, email: email.value, password: password.value, phone: phone.value });
    success.value = true;
    setTimeout(() => router.push('/'), 1000);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Thiết lập thất bại';
  } finally {
    loading.value = false;
  }
}
</script>
