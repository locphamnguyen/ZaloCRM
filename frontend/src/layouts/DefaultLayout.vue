<template>
  <v-app class="smax-app">
    <!-- ════════ TOP NAV (Smax-style dark, h=52px) ════════ -->
    <header class="smax-topnav">
      <!-- Logo + Workspace selector -->
      <RouterLink to="/" class="logo" title="ZaloCRM">
        <img src="/brand/zalocrm-logo.png" alt="ZaloCRM" />
      </RouterLink>

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
          <v-icon class="ic" size="16">{{ tab.icon }}</v-icon>{{ tab.label }}
        </RouterLink>

        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isPathPrefix('/automation') }" v-bind="act">
              <v-icon class="ic" size="16">mdi-creation-outline</v-icon>Automation<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item to="/automation" title="Tổng quan" prepend-icon="mdi-view-grid-outline" />
            <v-list-item to="/automation?tab=send-message" title="Nhắn tin" prepend-icon="mdi-send-clock-outline" />
            <v-list-item to="/automation?tab=add-friend" title="Kết bạn" prepend-icon="mdi-account-plus-outline" />
            <v-list-item to="/automation?tab=follow-up" title="Bám đuổi" prepend-icon="mdi-target-account" />
          </v-list>
        </v-menu>

        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isSettingsActive }" v-bind="act">
              <v-icon class="ic" size="16">mdi-tune-variant</v-icon>Cài đặt<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item to="/zalo-accounts" title="Tài khoản Zalo" prepend-icon="mdi-cellphone-cog" />
            <v-list-item to="/api-settings" title="API &amp; Webhook" prepend-icon="mdi-cloud-braces" />
            <v-list-item to="/integrations" title="Tích hợp" prepend-icon="mdi-transit-connection-variant" />
            <v-divider />
            <v-list-item to="/settings" title="Nhân viên" prepend-icon="mdi-account-settings-outline" />
            <v-list-item to="/settings?tab=roles" title="Phân quyền" prepend-icon="mdi-shield-key-outline" />
          </v-list>
        </v-menu>
      </nav>

      <!-- Flexible spacer pushes everything after it to the right edge. -->
      <div class="topnav-spacer" />

      <!--
        ATTRIBUTION BANNER — moved into DashboardView per copyright holder
        (locnt@locnguyendata.com). Rendering still required by Apache 2.0 §4(d);
        see src/views/DashboardView.vue and src/composables/use-attribution.ts.
      -->

      <!-- Global search trigger -->
      <GlobalSearch class="topnav-search" />

      <!-- Right icon buttons -->
      <RouterLink to="/groups" class="icon-btn" title="Nhóm">
        <v-icon size="18">mdi-account-group</v-icon>
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
          <v-list-item to="/profile" title="Hồ sơ" prepend-icon="mdi-account-circle" />
          <v-list-item @click="toggleTheme" :title="isDark ? 'Theme sáng' : 'Theme tối golden'" :prepend-icon="isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" />
          <v-divider />
          <v-list-item @click="logout" title="Đăng xuất" prepend-icon="mdi-logout-variant" />
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

const isDark = ref((localStorage.getItem('theme') || 'golden-dark') === 'golden-dark');

onMounted(() => {
  const saved = localStorage.getItem('theme') || 'golden-dark';
  theme.global.name.value = saved;
  isDark.value = saved === 'golden-dark';
});

interface NavTab {
  path: string;
  label: string;
  icon: string;
  matchPrefix?: string;
}

// Excel-driven menu (cấp 1) — Automation/Cài đặt được render riêng với dropdown.
const primaryTabs: NavTab[] = [
  { path: '/',             label: 'Dashboard',  icon: 'mdi-view-dashboard-outline', matchPrefix: '/$' },
  { path: '/chat',         label: 'Tin nhắn',   icon: 'mdi-chat-outline' },
  { path: '/friends',      label: 'Bạn bè',     icon: 'mdi-account-multiple-plus-outline' },
  { path: '/contacts',     label: 'Khách hàng', icon: 'mdi-card-account-details-outline' },
  { path: '/appointments', label: 'Lịch hẹn',   icon: 'mdi-calendar-month-outline' },
  { path: '/analytics',    label: 'Phân tích',  icon: 'mdi-chart-timeline-variant' },
  { path: '/reports',      label: 'Báo cáo',    icon: 'mdi-file-chart-outline' },
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
const workspaceName = computed(() => authStore.user?.fullName || 'Huy Tran');
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
.smax-topnav {
  background: linear-gradient(180deg, rgba(16, 21, 34, 0.96), rgba(7, 10, 18, 0.92));
  color: var(--gold-text);
  height: var(--smax-topnav-h);
  display: flex; align-items: center;
  padding: 0 14px; gap: 6px;
  flex-shrink: 0;
  position: sticky; top: 0; z-index: 100;
  border-bottom: 1px solid var(--gold-border);
  backdrop-filter: blur(14px);
}

.logo {
  width: 36px; height: 36px;
  background: var(--gold-surface-elevated); border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  margin-right: 4px;
  text-decoration: none;
  overflow: hidden;
  padding: 2px;
  border: 1px solid var(--gold-border);
}
.logo img {
  width: 100%; height: 100%;
  object-fit: contain;
}

.workspace {
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--gold-border);
  display: flex; align-items: center; gap: 7px;
  padding: 7px 11px; border-radius: 10px;
  margin-right: 13px;
  cursor: pointer; color: var(--gold-text);
  font-size: 13px;
}
.workspace:hover { background: var(--gold-primary-soft); border-color: rgba(214, 168, 79, 0.34); }
.ws-logo {
  width: 24px; height: 24px;
  background: linear-gradient(135deg, var(--gold-primary), var(--gold-primary-hover));
  border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  color: #070a12; font-size: 11px; font-weight: 600;
}
.opacity-50 { opacity: 0.5; }

.nav-tabs {
  display: flex; align-items: center; gap: 2px;
  flex-wrap: nowrap;
  flex-shrink: 0; /* never compress — menu must stay visible */
}
.nav-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 9px 13px; border-radius: 7px;
  cursor: pointer;
  color: var(--gold-text-secondary);
  font-size: 13px;
  background: transparent; border: 1px solid transparent;
  white-space: nowrap;
  text-decoration: none;
}

/* Compact nav progressively as viewport shrinks so all tabs stay visible */
@media (max-width: 1500px) {
  .nav-tab { padding: 9px 9px; gap: 4px; font-size: 12.5px; }
}
@media (max-width: 1280px) {
  .nav-tab { padding: 8px 7px; font-size: 12px; }
  .nav-tab .ic { font-size: 13px; }
  .workspace { padding: 6px 9px; margin-right: 8px; font-size: 12px; }
}
@media (max-width: 1100px) {
  .nav-tab { padding: 7px 6px; gap: 3px; }
  .nav-tab .ic { display: none; } /* drop emoji icons, keep labels */
  .workspace span:nth-of-type(2) { display: none; } /* workspace name → only logo */
}
.nav-tab .ic { font-size: 14px; line-height: 1; }
.nav-tab .caret { font-size: 10px; opacity: 0.7; margin-left: 2px; }
.nav-tab:hover {
  color: var(--gold-text);
  background: rgba(255,255,255,0.05);
  border-color: var(--gold-border);
}
.nav-tab.active {
  color: var(--gold-primary);
  background: var(--gold-primary-soft);
  border-color: rgba(214, 168, 79, 0.32);
  font-weight: 500;
}

.topnav-spacer { flex: 1; min-width: 0; }

.contact-marquee {
  flex: 0 0 320px;
  margin-right: 12px;
  height: 32px;
  display: flex;
  align-items: center;
  overflow: hidden;
  background: linear-gradient(90deg, rgba(0,242,255,0.12), rgba(0,119,182,0.12));
  border: 1px solid rgba(0,242,255,0.30);
  border-radius: 6px;
  text-decoration: none;
  color: #00F2FF;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
}
.contact-marquee:hover {
  background: linear-gradient(90deg, rgba(0,242,255,0.20), rgba(0,119,182,0.20));
  border-color: rgba(0,242,255,0.50);
}
.marquee-track {
  display: inline-block;
  white-space: nowrap;
  animation: marquee-scroll 32s linear infinite;
  will-change: transform;
}
.contact-marquee:hover .marquee-track {
  animation-play-state: paused;
}
@keyframes marquee-scroll {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@media (max-width: 1280px) {
  .contact-marquee { display: none; }
}

.topnav-search {
  max-width: 240px;
  flex-shrink: 1;
}
@media (max-width: 1500px) {
  .topnav-search { max-width: 180px; }
}
@media (max-width: 1280px) {
  .topnav-search { max-width: 140px; }
}
@media (max-width: 1100px) {
  .topnav-search { display: none; } /* prioritize menu over inline search */
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
  background:
    radial-gradient(circle at top left, rgba(214, 168, 79, 0.14), transparent 30rem),
    var(--gold-bg);
  color: var(--gold-text);
}
.smax-main :deep(.v-main__wrap) { min-height: calc(100vh - var(--smax-topnav-h)); }

/* Vuetify menus rendered from v-menu inherit theme automatically.
   Force light surface in case parent has legacy-dark applied. */
:deep(.v-overlay__content > .v-list) {
  background: var(--smax-bg);
  color: var(--smax-text);
}
</style>
