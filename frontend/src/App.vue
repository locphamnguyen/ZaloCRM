<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <component :is="layout">
    <router-view />
  </component>
  <!-- 2026-06-16 — hộp xác nhận HS theme global (thay window.confirm toàn app) -->
  <ConfirmHost />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import MobileLayout from '@/layouts/MobileLayout.vue';
import ConfirmHost from '@/components/ui/ConfirmHost.vue';
import { useMobile } from '@/composables/use-mobile';
import { useAuthStore } from '@/stores/auth';
import { usePrivacyStore } from '@/stores/privacy';

const route = useRoute();
const { isMobile } = useMobile();
const auth = useAuthStore();
const privacy = usePrivacyStore();

const layout = computed(() => {
  const name = (route.meta?.layout as string) || 'default';
  if (name === 'auth') return AuthLayout;
  return isMobile.value ? MobileLayout : DefaultLayout;
});

// Anh chốt 2026-05-22: sau F5 refresh, gọi privacyStore.fetchStatus() để rebuild
// isUnlocked + expiresAt từ HttpOnly cookie. Trước fix: cookie vẫn còn ở browser
// nhưng FE state mặc định isUnlocked=false → bubble blur vẫn hiện → click → bắt
// nhập PIN lại dù session vẫn alive.
watch(
  () => auth.user?.id,
  (uid) => { if (uid) privacy.fetchStatus(true).catch(() => {}); },
  { immediate: true },
);
</script>
