<template>
  <v-bottom-navigation grow :model-value="activeTab" @update:model-value="navigate" class="golden-bottom-nav" style="position: fixed; bottom: 0; left: 0; right: 0; z-index: 100; padding-bottom: env(safe-area-inset-bottom);">
    <v-btn v-for="tab in tabs" :key="tab.path" :value="tab.path">
      <v-icon>{{ tab.icon }}</v-icon>
      <span class="text-caption">{{ tab.title }}</span>
    </v-btn>
  </v-bottom-navigation>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const tabs = [
  { title: 'Chat', icon: 'mdi-message-text-outline', path: '/chat' },
  { title: 'Khách hàng', icon: 'mdi-account-group-outline', path: '/contacts' },
  { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments' },
  { title: 'Tổng quan', icon: 'mdi-view-dashboard-outline', path: '/' },
];

const activeTab = computed(() => {
  return tabs.find(t => t.path === route.path)?.path ?? '/chat';
});

function navigate(path: string) {
  router.push(path);
}
</script>


<style scoped>
.golden-bottom-nav {
  background: rgba(16, 21, 34, 0.96) !important;
  border-top: 1px solid var(--gold-border);
  color: var(--gold-text-secondary) !important;
  backdrop-filter: blur(14px);
}

.golden-bottom-nav :deep(.v-btn--active) {
  color: var(--gold-primary) !important;
}

.golden-bottom-nav :deep(.v-btn) {
  min-width: 64px;
}
</style>
