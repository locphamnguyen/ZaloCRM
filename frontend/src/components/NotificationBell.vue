<template>
  <v-menu offset-y :close-on-content-click="false" max-width="420">
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
    <v-card style="max-height: 480px; overflow-y: auto;">
      <v-card-title class="text-body-1 font-weight-bold pa-3">Thông báo</v-card-title>
      <v-divider />
      <div class="push-panel">
        <div class="push-copy">
          <div class="push-title">Thông báo Web/PWA</div>
          <div v-if="push.status.value === 'unsupported'" class="push-status">Trình duyệt không hỗ trợ</div>
          <div v-else-if="push.status.value === 'unavailable'" class="push-status">Chưa cấu hình Web Push</div>
          <div v-else-if="push.status.value === 'denied'" class="push-status">Thông báo bị chặn</div>
          <div v-else-if="push.isSubscribed.value" class="push-status">Đã bật thông báo</div>
          <div v-else class="push-status">Bật để nhận tin nhắn và cảnh báo khi app ở nền</div>
        </div>
        <div class="push-actions">
          <button v-if="push.canEnable.value" class="push-btn primary" :disabled="push.busy.value" @click.stop="push.enable">
            Bật thông báo
          </button>
          <button v-if="push.isSubscribed.value" class="push-btn" :disabled="push.busy.value" @click.stop="push.sendTest">
            Gửi thử
          </button>
          <button v-if="push.isSubscribed.value" class="push-btn" :disabled="push.busy.value" @click.stop="push.disable">
            Tắt
          </button>
        </div>
      </div>
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
import { useWebPush } from '@/composables/use-web-push';

interface AppNotification {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt?: string;
  url?: string;
}

const notifications = ref<AppNotification[]>([]);
const router = useRouter();
const push = useWebPush();
let interval: ReturnType<typeof setInterval>;

async function fetchNotifications() {
  try {
    const res = await api.get('/notifications');
    notifications.value = res.data.notifications || [];
  } catch {
    // Existing behavior: the bell stays quiet when polling fails.
  }
}

function handleClick(n: AppNotification) {
  if (n.url) router.push(n.url);
  else if (n.id === 'unreplied') router.push('/chat');
  else if (n.id.startsWith('apt-')) router.push('/appointments');
  else if (n.id.startsWith('zalo-')) router.push('/zalo-accounts');
  else if (n.id === 'tmr-apts') router.push('/appointments');
}

onMounted(() => {
  fetchNotifications();
  void push.init();
  interval = setInterval(fetchNotifications, 60000);
});

onUnmounted(() => clearInterval(interval));
</script>

<style scoped>
.push-panel {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}
.push-copy { min-width: 0; }
.push-title { font-size: 0.8rem; font-weight: 700; color: #f8fafc; }
.push-status { margin-top: 2px; font-size: 0.72rem; color: #94a3b8; }
.push-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.push-btn {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  padding: 5px 9px;
  color: #e5e7eb;
  background: rgba(15, 23, 42, 0.85);
  font-size: 0.72rem;
}
.push-btn.primary { color: #17120a; background: #d6a84f; border-color: #d6a84f; }
.push-btn:disabled { opacity: 0.55; cursor: wait; }
</style>
