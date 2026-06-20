<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- 2026-06-09 (anh báo menu bar kẹt): v-model để đóng chủ động khi click thông báo
       → điều hướng. Trước đây close-on-content-click=false + không đóng trong handleClick
       làm menu (z-index 2000) kẹt mở phủ nav, nuốt click. -->
  <v-menu v-model="bellMenu" offset-y :close-on-content-click="false" max-width="380">
    <template #activator="{ props: menuProps }">
      <v-btn icon variant="text" v-bind="menuProps" class="mr-1">
        <v-badge
          :content="notifications.length"
          :model-value="notifications.length > 0"
          color="error"
          overlap
        >
          <v-icon>mdi-bell-outline</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-card style="max-height: 400px; overflow-y: auto;">
      <v-card-title class="text-body-1 font-weight-bold pa-3">Thông báo</v-card-title>
      <v-divider />
      <v-list density="compact" v-if="notifications.length > 0">
        <v-list-item
          v-for="n in notifications"
          :key="n.id"
          @click="handleClick(n)"
          class="py-2"
        >
          <template #prepend>
            <v-icon
              :color="n.type === 'error' ? 'red' : n.type === 'warning' ? 'orange' : 'blue'"
              size="20"
            >
              {{ n.type === 'error' ? 'mdi-alert-circle' : n.type === 'warning' ? 'mdi-alert' : 'mdi-information' }}
            </v-icon>
          </template>
          <v-list-item-title class="text-body-2">{{ n.title }}</v-list-item-title>
          <v-list-item-subtitle class="text-caption">{{ n.detail }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <div v-else class="pa-4 text-center text-caption text-grey">Không có thông báo</div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';

interface Notification {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
}

const notifications = ref<Notification[]>([]);
const router = useRouter();
const bellMenu = ref(false); // 2026-06-09 — điều khiển đóng menu chủ động
let interval: ReturnType<typeof setInterval>;

async function fetchNotifications() {
  try {
    const res = await api.get('/notifications');
    notifications.value = res.data.notifications || [];
  } catch {
    // silently ignore fetch errors
  }
}

function handleClick(n: Notification) {
  bellMenu.value = false; // đóng menu TRƯỚC khi điều hướng → tránh overlay kẹt phủ nav
  if (n.id === 'unreplied') router.push('/chat');
  else if (n.id.startsWith('apt-')) router.push('/appointments');
  else if (n.id.startsWith('zalo-')) router.push('/zalo-accounts');
  else if (n.id === 'tmr-apts') router.push('/appointments');
}

onMounted(() => {
  fetchNotifications();
  interval = setInterval(fetchNotifications, 60000);
});

onUnmounted(() => clearInterval(interval));
</script>
