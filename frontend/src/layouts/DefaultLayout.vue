<template>
  <v-app class="smax-app">
    <!-- ════════ TOP NAV (Smax-style dark, h=52px) ════════ -->
    <header class="smax-topnav">
      <!-- Logo + Workspace selector -->
      <RouterLink to="/" class="logo" title="ZaloCRM">S</RouterLink>

      <v-menu open-on-hover>
        <template #activator="{ props: act }">
          <button class="workspace" v-bind="act">
            <span class="ws-logo">{{ workspaceShort }}</span>
            <span>{{ workspaceName }}</span>
            <span class="opacity-50">▾</span>
          </button>
        </template>
        <v-list density="compact" min-width="220">
          <v-list-item v-for="ws in workspaces" :key="ws.id" :title="ws.name" />
          <v-divider />
          <v-list-item title="Quản lý workspace" prepend-icon="mdi-cog" />
        </v-list>
      </v-menu>

      <!-- Primary nav tabs (Excel structure) -->
      <nav class="nav-tabs">
        <RouterLink
          v-for="tab in primaryTabs"
          :key="tab.path"
          :to="tab.path"
          class="nav-tab"
          :class="{ active: isActive(tab) }"
        >
          <span class="ic">{{ tab.icon }}</span>{{ tab.label }}
        </RouterLink>

        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isPathPrefix('/automation') }" v-bind="act">
              <span class="ic">⚡</span>Automation<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item to="/automation" title="Tổng quan" prepend-icon="mdi-chart-box-outline" />
            <v-list-item to="/automation?tab=send-message" title="Nhắn tin" prepend-icon="mdi-message-fast-outline" />
            <v-list-item to="/automation?tab=add-friend" title="Kết bạn" prepend-icon="mdi-account-plus-outline" />
            <v-list-item to="/automation?tab=follow-up" title="Bám đuổi" prepend-icon="mdi-radar" />
          </v-list>
        </v-menu>

        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isSettingsActive }" v-bind="act">
              <span class="ic">⚙</span>Cài đặt<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item to="/zalo-accounts" title="Tài khoản Zalo" prepend-icon="mdi-cellphone-link" />
            <v-list-item to="/api-settings" title="API &amp; Webhook" prepend-icon="mdi-api" />
            <v-list-item to="/integrations" title="Tích hợp" prepend-icon="mdi-connection" />
            <v-divider />
            <v-list-item to="/settings" title="Nhân viên" prepend-icon="mdi-account-cog-outline" />
            <v-list-item to="/settings?tab=roles" title="Phân quyền" prepend-icon="mdi-shield-account-outline" />
          </v-list>
        </v-menu>
      </nav>

      <div class="spacer" />

      <!-- Global search trigger -->
      <GlobalSearch class="topnav-search" />

      <!-- Right icon buttons -->
      <RouterLink to="/groups" class="icon-btn" title="Nhóm">
        <v-icon size="18">mdi-account-group-outline</v-icon>
      </RouterLink>

      <NotificationBell class="icon-btn-wrap" />

      <v-menu>
        <template #activator="{ props: act }">
          <button class="user-avatar" v-bind="act" :title="authStore.user?.fullName || 'Tài khoản'">
            {{ initials }}
          </button>
        </template>
        <v-list density="compact" min-width="200">
          <v-list-item :title="authStore.user?.fullName || ''" :subtitle="authStore.user?.email || ''" />
          <v-divider />
          <v-list-item to="/profile" title="Hồ sơ" prepend-icon="mdi-account-circle-outline" />
          <v-list-item @click="toggleTheme" :title="isDark ? 'Theme sáng' : 'Theme tối (legacy)'" :prepend-icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'" />
          <v-divider />
          <v-list-item @click="logout" title="Đăng xuất" prepend-icon="mdi-logout" />
        </v-list>
      </v-menu>
    </header>

    <!-- ════════ MAIN ════════ -->
    <v-main class="smax-main">
      <slot />
    </v-main>

    <!-- Global toast queue -->
    <ToastContainer />
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useRoute, RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';

const theme = useTheme();
const route = useRoute();
const authStore = useAuthStore();
const router = useRouter();

const isDark = ref((localStorage.getItem('theme') || 'smax-light') === 'legacy-dark');

onMounted(() => {
  const saved = localStorage.getItem('theme') || 'smax-light';
  theme.global.name.value = saved;
  isDark.value = saved === 'legacy-dark';
});

interface NavTab {
  path: string;
  label: string;
  icon: string;
  matchPrefix?: string;
}

// Excel-driven menu (cấp 1) — Automation/Cài đặt được render riêng với dropdown.
const primaryTabs: NavTab[] = [
  { path: '/',             label: 'Dashboard',  icon: '🏠', matchPrefix: '/$' },
  { path: '/chat',         label: 'Tin nhắn',   icon: '💬' },
  { path: '/friends',      label: 'Bạn bè',     icon: '👥' },
  { path: '/contacts',     label: 'Khách hàng', icon: '🧑' },
  { path: '/appointments', label: 'Lịch hẹn',   icon: '📅' },
  { path: '/analytics',    label: 'Phân tích',  icon: '📈' },
  { path: '/reports',      label: 'Báo cáo',    icon: '📊' },
];

function isActive(tab: NavTab): boolean {
  if (tab.matchPrefix === '/$') return route.path === '/';
  return route.path === tab.path || route.path.startsWith(tab.path + '/');
}
function isPathPrefix(prefix: string): boolean {
  return route.path === prefix || route.path.startsWith(prefix + '/');
}
const isSettingsActive = computed(() =>
  ['/settings', '/api-settings', '/integrations', '/zalo-accounts'].some(p =>
    route.path === p || route.path.startsWith(p + '/'),
  ),
);

// Workspace — placeholder single-tenant cho Phase 1
const workspaceName = computed(() => authStore.user?.fullName?.split(' ')[0] || 'hsholding');
const workspaceShort = computed(() =>
  workspaceName.value.slice(0, 2).toUpperCase(),
);
const workspaces = [
  { id: 'default', name: workspaceName.value },
];

const initials = computed(() => {
  const name = authStore.user?.fullName || 'U';
  return name.split(' ').map(p => p[0]).slice(-2).join('').toUpperCase();
});

function toggleTheme() {
  const next = isDark.value ? 'smax-light' : 'legacy-dark';
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
.smax-topnav {
  background: var(--smax-header-bg);
  color: white;
  height: var(--smax-topnav-h);
  display: flex; align-items: center;
  padding: 0 13px; gap: 4px;
  flex-shrink: 0;
  position: sticky; top: 0; z-index: 100;
}

.logo {
  width: 35px; height: 35px;
  background: white; color: var(--smax-primary);
  font-weight: 700; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  margin-right: 4px;
  font-size: 16px;
  text-decoration: none;
}

.workspace {
  background: rgba(255,255,255,0.06);
  border: none;
  display: flex; align-items: center; gap: 7px;
  padding: 7px 11px; border-radius: 7px;
  margin-right: 13px;
  cursor: pointer; color: white;
  font-size: 13px;
}
.workspace:hover { background: rgba(255,255,255,0.10); }
.ws-logo {
  width: 24px; height: 24px;
  background: linear-gradient(135deg, #ff5722, #d84315);
  border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 11px; font-weight: 600;
}
.opacity-50 { opacity: 0.5; }

.nav-tabs {
  display: flex; align-items: center; gap: 2px;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-tabs::-webkit-scrollbar { display: none; }
.nav-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 9px 13px; border-radius: 7px;
  cursor: pointer;
  color: rgba(255,255,255,0.75);
  font-size: 13px;
  background: transparent; border: none;
  white-space: nowrap;
  text-decoration: none;
}
.nav-tab .ic { font-size: 14px; line-height: 1; }
.nav-tab .caret { font-size: 10px; opacity: 0.7; margin-left: 2px; }
.nav-tab:hover { background: rgba(255,255,255,0.06); color: white; }
.nav-tab.active { background: rgba(255,255,255,0.12); color: white; font-weight: 500; }

.spacer { flex: 1; }

.topnav-search {
  max-width: 240px;
}
.topnav-search :deep(.v-field) {
  background: rgba(255,255,255,0.06) !important;
  color: white;
  border-radius: 7px !important;
}
.topnav-search :deep(input) { color: white !important; }

.icon-btn,
:deep(.icon-btn-wrap) > * {
  width: 39px; height: 39px;
  border-radius: 50%;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.78);
  position: relative;
  font-size: 16px;
  text-decoration: none;
  background: transparent; border: none;
}
.icon-btn:hover,
:deep(.icon-btn-wrap) > *:hover {
  background: rgba(255,255,255,0.08);
  color: white;
}

.user-avatar {
  width: 35px; height: 35px;
  border-radius: 50%;
  background: linear-gradient(135deg,#fbc02d,#f57c00);
  color: white; font-weight: 600;
  border: none; cursor: pointer;
  margin-left: 9px;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}

.smax-main {
  background: var(--smax-grey-100);
}
.smax-main :deep(.v-main__wrap) { min-height: calc(100vh - var(--smax-topnav-h)); }

/* Vuetify menus rendered from v-menu inherit theme automatically.
   Force light surface in case parent has legacy-dark applied. */
:deep(.v-overlay__content > .v-list) {
  background: var(--smax-bg);
  color: var(--smax-text);
}
</style>
