<template>
  <component :is="layout">
    <router-view />
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import MobileLayout from '@/layouts/MobileLayout.vue';
import { useMobile } from '@/composables/use-mobile';

const route = useRoute();
const { isMobile } = useMobile();

const layout = computed(() => {
  const name = (route.meta?.layout as string) || 'default';
  if (name === 'auth') return AuthLayout;
  return isMobile.value ? MobileLayout : DefaultLayout;
});
</script>
