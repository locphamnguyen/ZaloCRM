<template>
  <v-app>
    <OfflineIndicator />

    <!-- Slim mobile app bar -->
    <v-app-bar density="compact" flat class="mobile-golden-appbar">
      <div class="d-flex align-center ml-3" style="gap: 8px;">
        <div class="d-flex align-center justify-center mobile-brand-mark">
          <v-icon size="16">mdi-robot</v-icon>
        </div>
        <span class="font-weight-bold text-body-1">Zalo<span class="mobile-brand-accent">CRM</span></span>
      </div>

      <v-spacer />

      <NotificationBell />
      <v-btn icon size="small" variant="text" @click="toggleTheme">
        <v-icon size="20">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon size="small" variant="text" @click="logout">
        <v-icon size="20">mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Main content with padding for bottom nav -->
    <v-main>
      <div style="padding-bottom: 72px;">
        <slot />
      </div>
    </v-main>

    <BottomNav />
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import BottomNav from '@/components/BottomNav.vue';
import OfflineIndicator from '@/components/OfflineIndicator.vue';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();
const isDark = ref((localStorage.getItem('theme') || 'golden-dark') === 'golden-dark');

onMounted(() => {
  const saved = localStorage.getItem('theme') || 'golden-dark';
  theme.global.name.value = saved;
  isDark.value = saved === 'golden-dark';
});

function toggleTheme() {
  const next = isDark.value ? 'smax-light' : 'golden-dark';
  isDark.value = !isDark.value;
  theme.global.name.value = next;
  localStorage.setItem('theme', next);
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>


<style scoped>
.mobile-golden-appbar {
  background: linear-gradient(180deg, rgba(16, 21, 34, 0.96), rgba(7, 10, 18, 0.92)) !important;
  border-bottom: 1px solid var(--gold-border);
  color: var(--gold-text) !important;
  padding-top: env(safe-area-inset-top);
}

.mobile-brand-mark {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, var(--gold-primary), var(--gold-primary-hover));
  border-radius: 8px;
  color: #070a12;
}

.mobile-brand-accent {
  color: var(--gold-primary);
}
</style>
