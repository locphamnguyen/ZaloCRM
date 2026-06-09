<template>
  <v-app class="smax-app">
    <!-- ════════ TOP NAV — HS Holding teal-navy shell (redesign 2026-06-05, đảo lock Variant A) ════════ -->
    <!-- Gradient teal-navy + monogram HS + wordmark · 7 tab + Báo cáo + Cài đặt · MDI line icon · active HS -->
    <header class="smax-topnav">
      <!-- Brand — monogram HS + wordmark "HS Holding / CRM" (single-tenant) -->
      <RouterLink to="/" class="hs-brand" title="HS Holding CRM">
        <span class="hs-bbox"><img src="/brand/hs-monogram.png" alt="HS Holding" /></span>
        <span class="hs-bwm"><span class="hs-b1">HS Holding</span><span class="hs-b2">CRM</span></span>
      </RouterLink>

      <!-- Primary nav tabs -->
      <nav class="nav-tabs">
        <RouterLink
          v-for="tab in visiblePrimaryTabs"
          :key="tab.path"
          :to="tab.path"
          class="nav-tab"
          :class="{ active: isActive(tab) }"
        >
          <v-icon :icon="tab.icon" size="16" class="ic-svg" />{{ tab.label }}
        </RouterLink>

        <!-- Báo cáo dropdown — gộp Phân tích + Báo cáo (anh chốt 2026-05-28).
             RBAC: chỉ hiện cho ai có engagement_score (Sale Senior trở lên). -->
        <v-menu v-if="authStore.canAccess('engagement_score')" open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isReportsActive }" v-bind="act">
              <v-icon icon="mdi-chart-box-outline" size="16" class="ic-svg" />Báo cáo<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="200">
            <v-list-item to="/analytics" title="Phân tích" prepend-icon="mdi-chart-line" />
            <v-list-item to="/reports" title="Báo cáo tổng hợp" prepend-icon="mdi-chart-bar" />
          </v-list>
        </v-menu>

        <!-- Cài đặt dropdown -->
        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isSettingsActive }" v-bind="act">
              <v-icon icon="mdi-cog-outline" size="16" class="ic-svg" />Cài đặt<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="240">
            <v-list-item to="/settings/personal/profile" title="Hồ sơ của tôi" prepend-icon="mdi-account-circle-outline" />
            <!-- RBAC 2026-06-08 — lọc per-item theo grants; subheader/divider chỉ hiện khi nhóm còn item con. -->
            <template v-if="showOrgGroup">
              <v-divider />
              <v-list-subheader>Tổ chức &amp; Nhân sự</v-list-subheader>
              <v-list-item v-if="authStore.canAccess('user')" to="/settings/team/users" title="Nhân viên" prepend-icon="mdi-account-cog-outline" />
              <v-list-item v-if="authStore.canAccess('department')" to="/settings/team/teams" title="Đội nhóm" prepend-icon="mdi-account-group-outline" />
              <v-list-item v-if="authStore.canAccess('permission_group')" to="/settings/team/roles" title="Vai trò &amp; Phân quyền" prepend-icon="mdi-shield-account-outline" />
            </template>
            <template v-if="showCrmGroup">
              <v-divider />
              <v-list-subheader>CRM &amp; Kênh</v-list-subheader>
              <v-list-item v-if="authStore.canAccess('settings')" to="/settings/crm/tags" title="Tag CRM" prepend-icon="mdi-tag-multiple-outline" />
              <v-list-item v-if="authStore.canAccess('settings')" to="/settings/crm/scoring" title="Lead scoring" prepend-icon="mdi-chart-line" />
              <v-list-item v-if="authStore.canAccess('zalo_account')" to="/settings/channels/zalo" title="Tài khoản Zalo" prepend-icon="mdi-cellphone-link" />
              <v-list-item v-if="authStore.canAccess('settings')" to="/settings/channels/integrations" title="Tích hợp" prepend-icon="mdi-connection" />
            </template>
            <template v-if="authStore.canAccess('webhook')">
              <v-divider />
              <v-list-item to="/settings/dev/api" title="API &amp; Webhook" prepend-icon="mdi-api" />
            </template>
            <v-divider />
            <v-list-item to="/settings" title="Xem tất cả cài đặt" prepend-icon="mdi-cog-outline" />
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

    <!-- Phase Internal Contact 2-method 2026-05-23 — banner persistent nếu sale chưa setup -->
    <div v-if="showInternalContactBanner" class="ic-banner">
      <span class="ic-banner-icon">⚠</span>
      <div class="ic-banner-text">
        <strong>Bạn đang BỎ LỠ thông báo quan trọng từ CRM!</strong>
        <span class="ic-banner-sub">Khách đồng ý kết bạn, cảnh báo silent 30 ngày, lịch hẹn, daily KPI...</span>
      </div>
      <button class="ic-banner-cta" @click="goSetupInternalContact">⚙ Thiết lập ngay</button>
      <button class="ic-banner-dismiss" @click="dismissInternalContactBanner" title="Ẩn 24h">✕</button>
    </div>

    <!-- ════════ MAIN ════════ -->
    <v-main class="smax-main">
      <slot />
    </v-main>

    <!-- 2026-06-04: Anh chốt gỡ MiniOnboardingIndicator — badge 4/4 hiện đè
         mọi UI gây rối mắt sau khi sale hoàn tất. Sẽ code lại setup 4 bước. -->

    <!-- 2026-06-01: LeadFloatingButton moved → ConversationFilterSidebar (chỉ render trong /chat).
         Floating bottom-right bị bỏ. Sale thấy nút "Nhận khách" trong sidebar cột 1 (expanded card / collapsed icon hộp quà pulse). -->

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
// 2026-06-04: gỡ MiniOnboardingIndicator (Anh chốt code lại setup 4 bước sau)
// LeadFloatingButton moved to ConversationFilterSidebar 2026-06-01
// 2026-06-08: gỡ import api — banner "BỎ LỠ thông báo" đã tắt (checkInternalContactSetup no-op).
const theme = useTheme();
const route = useRoute();
const authStore = useAuthStore();
const router = useRouter();

// Phase Internal Contact 2-method 2026-05-23 — banner cho sale chưa setup
// Phase Onboarding v1 redesign 2026-05-24: ẨN banner khi đang ở Dashboard route
// vì OnboardingChecklist đã cover. Banner chỉ nhắc ở các tab khác (Chat, Bạn bè,...).
const IC_BANNER_DISMISS_KEY = 'ic-banner-dismissed-until';
const _showICBannerRaw = ref(false);
const showInternalContactBanner = computed(() => {
  // Hide trên Dashboard — checklist đã hiện
  if (route.path === '/') return false;
  return _showICBannerRaw.value;
});
async function checkInternalContactSetup() {
  // 2026-06-08 (Anh chốt): TẮT banner "Bạn đang BỎ LỠ thông báo quan trọng từ CRM".
  // Lý do: giờ user được tạo bằng SĐT đã verify có Zalo 100% (wizard create-with-zalo),
  // recipient.threadIdInSenderView được điền sẵn lúc tạo → không cần nhắc sale tự vào
  // Cài đặt thiết lập nick liên lạc nội bộ nữa. Giữ lại logic bên dưới (comment) để dễ
  // bật lại nếu sau này cần.
  return;
  // if (!authStore.user) return;
  // const dismissedUntil = Number(localStorage.getItem(IC_BANNER_DISMISS_KEY) || '0');
  // if (dismissedUntil > Date.now()) return;
  // try {
  //   const { data } = await api.get('/me/internal-contact');
  //   if (!data.method || data.recipient?.status !== 'ready') {
  //     _showICBannerRaw.value = true;
  //   }
  // } catch { /* silent */ }
}
function goSetupInternalContact() {
  _showICBannerRaw.value = false;
  router.push('/settings/channels/zalo?tab=internal-contact');
}
function dismissInternalContactBanner() {
  _showICBannerRaw.value = false;
  localStorage.setItem(IC_BANNER_DISMISS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
}

const isDark = ref((localStorage.getItem('theme') || 'hsLight') === 'legacy-dark');

onMounted(() => {
  // HS redesign 2026-06-05: mặc định hsLight. Giá trị cũ 'smax-light' trong
  // localStorage được nâng cấp sang hsLight (chỉ giữ legacy-dark nếu user chọn).
  let saved = localStorage.getItem('theme') || 'hsLight';
  if (saved === 'smax-light') saved = 'hsLight';
  theme.global.name.value = saved;
  isDark.value = saved === 'legacy-dark';
  void checkInternalContactSetup();
});

interface NavTab {
  path: string;
  label: string;
  icon: string;
  matchPrefix?: string;
  // RBAC 2026-06-08 — resource cần để thấy tab. Không có resource = luôn hiện.
  resource?: string;
}

// HD-first redesign 2026-05-28 (anh chốt Variant A): 7 primary tabs + 2 dropdown.
// Bỏ: "KH đình trệ" (move vào Dashboard alert), "Phân tích" (gộp Báo cáo dropdown),
//     "Báo cáo" tab riêng (gộp dropdown), Automation legacy dropdown (Marketing thay).
// Icons MDI line stroke-2 (mdi-*-outline) thay emoji để nhất quán + đổi màu theo theme.
const primaryTabs: NavTab[] = [
  { path: '/',                       label: 'Dashboard',   icon: 'mdi-view-dashboard-outline', matchPrefix: '/$' },
  { path: '/chat',                   label: 'Tin nhắn',    icon: 'mdi-message-text-outline', resource: 'conversation' },
  { path: '/friends',                label: 'Bạn bè',      icon: 'mdi-account-multiple-outline', resource: 'friend' },
  { path: '/contacts',               label: 'Khách hàng',  icon: 'mdi-account-outline', resource: 'contact' },
  { path: '/appointments',           label: 'Lịch hẹn',    icon: 'mdi-calendar-outline' },
];

// RBAC 2026-06-09 — tab Marketing là module gồm nhiều chức năng. Hiện nếu user có
// quyền BẤT KỲ chức năng nào, và trỏ tới chức năng ĐẦU TIÊN user có quyền (vd Sale
// chỉ có Khối → tab Marketing trỏ thẳng /marketing/blocks). Thứ tự = thứ tự sidebar.
const MARKETING_FUNCTIONS: Array<{ path: string; resource: string }> = [
  { path: '/marketing/triggers',     resource: 'trigger' },
  { path: '/marketing/care-sessions',resource: 'care_session' },
  { path: '/marketing/sequences',    resource: 'sequence' },
  { path: '/marketing/blocks',       resource: 'block' },
  { path: '/marketing/broadcasts',   resource: 'broadcast' },
  { path: '/marketing/lists',        resource: 'customer_list' },
];
const marketingEntry = computed(() =>
  MARKETING_FUNCTIONS.find((f) => authStore.canAccess(f.resource))?.path ?? null,
);

// RBAC 2026-06-08 — chỉ hiện tab user có quyền (Dashboard + Lịch hẹn luôn hiện).
const visiblePrimaryTabs = computed(() => {
  const tabs = primaryTabs.filter((t) => !t.resource || authStore.canAccess(t.resource));
  // Chèn tab Marketing nếu user có quyền ít nhất 1 chức năng Marketing.
  if (marketingEntry.value) {
    tabs.push({
      path: marketingEntry.value,
      label: 'Marketing',
      icon: 'mdi-bullhorn-outline',
      matchPrefix: '/marketing',
    });
  }
  return tabs;
});
// Subheader nhóm trong dropdown Cài đặt chỉ hiện khi còn item con — tránh subheader mồ côi.
const showOrgGroup = computed(
  () => authStore.canAccess('user') || authStore.canAccess('department') || authStore.canAccess('permission_group'),
);
const showCrmGroup = computed(
  () => authStore.canAccess('settings') || authStore.canAccess('zalo_account'),
);

function isActive(tab: NavTab): boolean {
  if (tab.matchPrefix === '/$') return route.path === '/';
  if (tab.matchPrefix) {
    return route.path === tab.matchPrefix || route.path.startsWith(tab.matchPrefix + '/');
  }
  return route.path === tab.path || route.path.startsWith(tab.path + '/');
}
const isSettingsActive = computed(() =>
  route.path === '/settings' || route.path.startsWith('/settings/'),
);
// Báo cáo dropdown active khi ở /analytics hoặc /reports
const isReportsActive = computed(
  () => route.path.startsWith('/analytics') || route.path.startsWith('/reports'),
);

// Workspace selector đã ẩn ở Variant A 2026-05-28 (single-tenant chưa cần switch).
// Sau này multi-tenant → revert back template + uncomment block dưới.

const initials = computed(() => {
  const name = authStore.user?.fullName || 'U';
  return name.split(' ').map(p => p[0]).slice(-2).join('').toUpperCase();
});

function toggleTheme() {
  const next = isDark.value ? 'hsLight' : 'legacy-dark';
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
/* Phase Internal Contact 2-method 2026-05-23 — banner persistent */
.ic-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 20px;
  background: linear-gradient(90deg, #FEF3C7 0%, #FDE68A 100%);
  border-bottom: 1px solid #FCD34D;
  color: #78350F;
  font-size: 13.5px;
}
.ic-banner-icon { font-size: 20px; flex-shrink: 0; }
.ic-banner-text { flex: 1; display: flex; flex-direction: column; gap: 2px; line-height: 1.3; }
.ic-banner-text strong { color: #92400E; font-weight: 700; }
.ic-banner-sub { font-size: 12px; color: #92400E; opacity: 0.85; }
.ic-banner-cta {
  background: #B45309; color: white; border: none;
  padding: 8px 16px; border-radius: 8px;
  font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.ic-banner-cta:hover { background: #92400E; }
.ic-banner-dismiss {
  background: transparent; color: #92400E; border: none;
  padding: 8px 10px; cursor: pointer; font-family: inherit;
  font-size: 14px; font-weight: 700;
}
.ic-banner-dismiss:hover { color: #78350F; }

/* HS Holding shell — teal-navy gradient nav (redesign 2026-06-05, đảo lock Variant A sáng) */
.smax-topnav {
  background: linear-gradient(180deg, var(--nav-grad-a, #0e445a) 0%, var(--nav-grad-b, #06222f) 100%);
  color: rgba(255, 255, 255, 0.85);
  height: 48px;
  display: flex; align-items: center;
  padding: 0 14px; gap: 4px;
  flex-shrink: 0;
  position: sticky; top: 0; z-index: 100;
  box-shadow: 0 1px 0 rgba(255,255,255,.06), 0 2px 8px rgba(0,0,0,.18);
}

/* Brand lockup — monogram HS + wordmark "HS Holding / CRM" */
.hs-brand {
  display: flex; align-items: center; gap: 10px;
  margin-right: 14px; flex: none; text-decoration: none;
}
.hs-bbox {
  width: 34px; height: 34px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #1786be 0%, #0b5880 100%);
  box-shadow: inset 0 1px 1px rgba(255,255,255,.18), 0 1px 2px rgba(0,0,0,.25);
  flex: none;
}
.hs-bbox img { width: 24px; height: auto; display: block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
.hs-bwm { display: flex; flex-direction: column; line-height: 1.08; white-space: nowrap; }
.hs-b1 { font-size: 13.5px; font-weight: 800; color: #fff; letter-spacing: .01em; }
.hs-b2 { font-size: 9.5px; font-weight: 700; letter-spacing: .26em; color: var(--nav-accent, #5bb8e5); text-transform: uppercase; }

.nav-tabs {
  display: flex; align-items: center; gap: 2px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}
.nav-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 12px; border-radius: var(--r-sm, 8px);
  cursor: pointer;
  color: var(--shell-ink, #cfe2ec);
  font-size: 13px; font-weight: 600;
  background: transparent; border: none;
  white-space: nowrap;
  text-decoration: none;
  height: 36px;
  line-height: 1.2;
  position: relative;
}
.nav-tab .ic-svg { color: var(--shell-ink-2, #7fa6b8); transition: color .14s; }
.nav-tab .caret { font-size: 9px; opacity: 0.55; margin-left: -2px; }
.nav-tab:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.nav-tab:hover .ic-svg { color: var(--shell-ink, #cfe2ec); }
.nav-tab.active {
  background: rgba(91, 184, 229, 0.16);
  color: #fff;
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--nav-accent, #5bb8e5);
}
.nav-tab.active .ic-svg { color: var(--nav-accent, #5bb8e5); }

/* HD compact — chỉ kick in khi viewport < 1280 (rất hiếm với HD-first target) */
@media (max-width: 1280px) {
  .nav-tab { padding: 7px 9px; font-size: 12px; gap: 5px; }
}
@media (max-width: 1100px) {
  .nav-tab { padding: 6px 7px; gap: 4px; }
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
  .topnav-search { max-width: 200px; }
}
@media (max-width: 1280px) {
  .topnav-search { max-width: 160px; }
}
@media (max-width: 1100px) {
  .topnav-search { display: none; }
}
.topnav-search :deep(.v-field) {
  background: rgba(255, 255, 255, 0.08) !important;
  color: white;
  border-radius: 7px !important;
}
.topnav-search :deep(input) { color: white !important; }
.topnav-search :deep(input::placeholder) { color: rgba(255, 255, 255, 0.5) !important; }

.icon-btn,
:deep(.icon-btn-wrap) > * {
  width: 32px; height: 32px;
  border-radius: 7px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.85);
  position: relative;
  font-size: 16px;
  text-decoration: none;
  background: transparent; border: none;
  margin-left: 2px;
}
.icon-btn:hover,
:deep(.icon-btn-wrap) > *:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.user-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fcd34d, #f59e0b);
  color: white; font-weight: 700;
  border: none; cursor: pointer;
  margin-left: 6px;
  font-size: 11.5px;
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
