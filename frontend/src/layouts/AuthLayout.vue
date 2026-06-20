<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- 2026-06-09 (anh chốt): login 2 cột — banner thương hiệu HS Holding trái + form phải.
       Bỏ container 450px cũ, để LoginView tự dựng 2 cột full màn. -->
  <v-app class="auth-shell">
    <v-main class="d-flex align-center justify-center" style="min-height: 100vh;">
      <slot />
    </v-main>
  </v-app>
</template>

<style scoped>
/* Nền tổng teal-navy nhạt — đồng bộ thương hiệu HS Holding */
.auth-shell {
  background: linear-gradient(135deg, #e8eef1 0%, #d3dde2 100%);
}
</style>
