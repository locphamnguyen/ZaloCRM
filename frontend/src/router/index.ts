import { createRouter, createWebHistory, type RouteLocation, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { layout: 'auth' },
  },
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('@/views/SetupView.vue'),
    meta: { layout: 'auth' },
  },
  // Phase Onboarding v1 2026-05-24 — force change password lần đầu
  {
    path: '/setup-password',
    name: 'SetupPassword',
    component: () => import('@/views/ForcePasswordChangeView.vue'),
    meta: { layout: 'auth', requiresAuth: true, allowUnchangedPassword: true },
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chat/:convId?',
    name: 'Chat',
    component: () => import('@/views/ChatView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/contacts',
    name: 'Contacts',
    component: () => import('@/views/ContactsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Legacy redirect — now nested under /settings
    path: '/zalo-accounts',
    redirect: '/settings/channels/zalo',
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/appointments',
    name: 'Appointments',
    component: () => import('@/views/AppointmentsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('@/views/ReportsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/analytics',
    name: 'Analytics',
    component: () => import('@/views/AnalyticsView.vue'),
    meta: { requiresAuth: true },
  },
  // ════════ NEW Settings — 6-group sidebar layout ════════
  {
    path: '/settings',
    component: () => import('@/views/settings/SettingsLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      // Default: root /settings → role-based default route (handled in SettingsLayout onMounted)
      { path: '', name: 'Settings', component: () => import('@/views/settings/PersonalProfilePage.vue') },

      // 👤 Personal
      { path: 'personal/profile',       name: 'Settings.Profile',       component: () => import('@/views/settings/PersonalProfilePage.vue') },
      { path: 'personal/password',      name: 'Settings.Password',      component: () => import('@/views/settings/PersonalPasswordPage.vue') },
      { path: 'personal/notifications', name: 'Settings.Notifications', component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'notifications' } },
      { path: 'personal/theme',         name: 'Settings.Theme',         component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'theme' } },
      { path: 'personal/sessions',      name: 'Settings.Sessions',      component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'sessions' } },

      // 🏢 Org
      { path: 'org/profile', name: 'Settings.OrgProfile', component: () => import('@/components/settings/OrgSettings.vue') },
      { path: 'org/system-notifications', name: 'Settings.SystemNotifications', component: () => import('@/views/settings/SystemNotificationsPage.vue') },
      { path: 'org/billing', name: 'Settings.Billing',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'billing' } },
      { path: 'org/audit',   name: 'Settings.Audit',     component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'audit' } },

      // 👥 Team — Variant C menu reorg 2026-05-22: legacy team/* redirect → rbac/*
      // Em giữ 3 route legacy nhưng redirect sang RBAC pages mới để không break deep link.
      { path: 'team/users', redirect: '/settings/rbac/users' },
      { path: 'team/teams', redirect: '/settings/rbac/departments' },
      { path: 'team/roles', redirect: '/settings/rbac/permission-groups' },
      // RBAC Phase Phân Quyền 2026-05-21 (HS internal, branch private-hs)
      { path: 'rbac/departments',       name: 'Settings.RbacDepartments',       component: () => import('@/views/rbac/DepartmentsView.vue') },
      { path: 'rbac/permission-groups', name: 'Settings.RbacPermissionGroups',  component: () => import('@/views/rbac/PermissionGroupsView.vue') },
      { path: 'rbac/users',             name: 'Settings.RbacUsers',             component: () => import('@/views/rbac/UsersRbacView.vue') },
      // Phase Riêng Tư 2026-05-22 — per-user privacy page (vào nhóm Cá nhân ở sidebar)
      { path: 'privacy',                name: 'Settings.Privacy',               component: () => import('@/views/privacy/PrivacySettingsView.vue') },

      // ⚙ CRM Config
      { path: 'crm/statuses',    name: 'Settings.Statuses',    component: () => import('@/components/settings/StatusManagement.vue') },
      { path: 'crm/tags',        name: 'Settings.Tags',        component: () => import('@/components/settings/CrmTagManagement.vue') },
      // Tag Taxonomy v2 — M57 /plan-eng-review 2026-05-31 (Wave 4a dual-write window).
      // Khi Wave 5 ship, route /crm/tags này sẽ thành alias của tags-v2.
      { path: 'crm/tags-v2',     name: 'Settings.TagsV2',      component: () => import('@/views/settings/TagTaxonomyV2Page.vue') },
      { path: 'crm/zalo-labels', name: 'Settings.ZaloLabels',  component: () => import('@/components/settings/ZaloLabelsManagement.vue') },
      { path: 'crm/scoring',     name: 'Settings.Scoring',     component: () => import('@/views/ScoringSettingsView.vue') },
      { path: 'crm/stuck',       name: 'Settings.Stuck',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'stuck' } },
      { path: 'crm/folders',     name: 'Settings.Folders',     component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'folders' } },
      { path: 'crm/templates',   name: 'Settings.Templates',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'templates' } },
      // Phase Lead Pool 2026-05-24 — bố trí menu 2026-05-29
      { path: 'crm/lead-pool',         name: 'Settings.LeadPool',        component: () => import('@/views/settings/LeadPoolConfigPage.vue') },
      { path: 'crm/lead-pool/queue',   name: 'Settings.LeadPoolQueue',   component: () => import('@/views/settings/LeadPoolPreviewPage.vue') },
      // M53 2026-05-30 — Trợ Lý AI Virtual Chat
      { path: 'crm/ai-assistant',      name: 'Settings.AiAssistant',     component: () => import('@/views/settings/AiAssistantPage.vue') },
      // 🔌 Channels & Integrations
      { path: 'channels/zalo',             name: 'Settings.ZaloAccounts',    component: () => import('@/views/ZaloAccountsView.vue') },
      // Phase Multi-Source Lead Ads 2026-05-27
      { path: 'channels/facebook-leadads', name: 'Settings.FacebookLeadAds', component: () => import('@/views/settings/FacebookLeadAdsPage.vue') },
      { path: 'channels/rate-limit',       name: 'Settings.RateLimit',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'rate-limit' } },
      { path: 'channels/automation',       name: 'Settings.Automation',      component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'automation' } },
      { path: 'channels/integrations',     name: 'Settings.Integrations',    component: () => import('@/views/IntegrationsView.vue') },

      // 🛠 Dev & API
      { path: 'dev/api',           name: 'Settings.Api',          component: () => import('@/views/ApiSettingsView.vue') },
      { path: 'dev/public-token',  name: 'Settings.PublicToken',  component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'public-token' } },
      { path: 'dev/feature-flags', name: 'Settings.FeatureFlags', component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'feature-flags' } },
      { path: 'dev/backup',        name: 'Settings.Backup',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'backup' } },
    ],
  },

  // ════════ Legacy redirects ════════
  // Old query-tab URLs → new nested routes
  {
    path: '/settings/zalo-labels',
    redirect: '/settings/crm/zalo-labels',
  },
  {
    path: '/customers/:id/activity',
    name: 'CustomerActivityLog',
    component: () => import('@/views/CustomerActivityLogView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Tab "Hồ sơ KH tổng hợp" — SKELETON, render 3 field ẩn cột 4 (email/address/occupation)
    // + aggregate Friend rows. Backend route stub, full impl ở phase sau.
    path: '/contacts/:id/profile',
    name: 'ContactProfile',
    component: () => import('@/views/ContactProfileView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/leads/stuck',
    name: 'StuckLeads',
    component: () => import('@/views/StuckLeadsView.vue'),
    meta: { requiresAuth: true },
  },
  // Legacy redirects — old routes moved under /settings/*
  { path: '/settings/scoring', redirect: '/settings/crm/scoring' },
  { path: '/api-settings',     redirect: '/settings/dev/api' },
  { path: '/integrations',     redirect: '/settings/channels/integrations' },
  {
    path: '/automation',
    name: 'Automation',
    component: () => import('@/views/AutomationView.vue'),
    meta: { requiresAuth: true },
  },
  // Phase 7 — Marketing framework (Khối / Luồng kịch bản / Mục tiêu / Broadcast)
  {
    path: '/marketing',
    component: () => import('@/views/automation/BotAutoShell.vue'),
    meta: { requiresAuth: true },
    redirect: '/marketing/triggers',
    children: [
      { path: 'triggers',                   name: 'Marketing.Triggers',           component: () => import('@/views/automation/TriggersView.vue') },
      { path: 'triggers/new/friend-invite', name: 'Marketing.FriendInviteCreate', component: () => import('@/views/automation/FriendInviteCreateView.vue') },
      { path: 'triggers/:id',               name: 'Marketing.TriggerDetail',      component: () => import('@/views/automation/TriggerDetailView.vue') },
      { path: 'blocks',     name: 'Marketing.Blocks',     component: () => import('@/views/automation/BlocksView.vue') },
      { path: 'sequences',  name: 'Marketing.Sequences',  component: () => import('@/views/automation/SequencesView.vue') },
      { path: 'broadcasts', name: 'Marketing.Broadcasts', component: () => import('@/views/automation/BroadcastsView.vue') },
      { path: 'lists',      name: 'Marketing.Lists',      component: () => import('@/views/automation/ListsView.vue') },
      { path: 'lists/:id',  name: 'Marketing.ListDetail', component: () => import('@/views/automation/ListDetailView.vue') },
    ],
  },
  // Phase Marketing rename 2026-05-23 — "Mục tiêu" namespace alias.
  // Ngày 2 (2026-05-30): refactored thành MucTieuWizard 3-step chính chủ + accept ?listId query.
  // Route /marketing/triggers/new/friend-invite vẫn alias cho backward compat (xem trên).
  {
    path: '/automation/muc-tieu/tao-moi',
    name: 'Marketing.MucTieuCreate',
    component: () => import('@/views/automation/MucTieuWizard.vue'),
    meta: { requiresAuth: true },
  },
  // Wave 3 (2026-05-30) — MucTieuListView v1 (table + side panel)
  // Đặt dưới shell BotAutoShell để có sidebar Marketing chung.
  {
    path: '/automation/muc-tieu',
    component: () => import('@/views/automation/BotAutoShell.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Marketing.MucTieuList', component: () => import('@/views/automation/MucTieuListView.vue') },
      // Wave 3 Day 1 (2026-05-30) — Mục tiêu detail v1 (Dashboard + Log tab).
      // Legacy /marketing/triggers/:id (TriggerDetailView.vue) vẫn alive cho deep link cũ.
      { path: ':id', name: 'Marketing.MucTieuDetail', component: () => import('@/views/automation/MucTieuDetailView.vue') },
    ],
  },
  // Alias mới /marketing/muc-tieu trỏ về list view (giữ namespace marketing thống nhất)
  { path: '/marketing/muc-tieu', redirect: '/automation/muc-tieu' },
  // Alias detail page dưới namespace marketing/* (memory: keep marketing namespace unified)
  {
    path: '/marketing/muc-tieu/:id',
    redirect: (to: RouteLocation) => ({ path: `/automation/muc-tieu/${to.params.id}` }),
  },
  // Backward compat redirect — URL /automation/bot/* cũ vẫn hoạt động
  { path: '/automation/bot',              redirect: '/marketing/triggers' },
  { path: '/automation/bot/triggers',     redirect: '/marketing/triggers' },
  { path: '/automation/bot/blocks',       redirect: '/marketing/blocks' },
  { path: '/automation/bot/sequences',    redirect: '/marketing/sequences' },
  { path: '/automation/bot/broadcasts',   redirect: '/marketing/broadcasts' },
  { path: '/automation/bot/lists',        redirect: '/marketing/lists' },
  { path: '/automation/bot/lists/:id',    redirect: (to: RouteLocation) => ({ path: `/marketing/lists/${to.params.id}` }) },
  {
    path: '/groups',
    name: 'Groups',
    component: () => import('@/views/GroupsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/friends',
    name: 'Friends',
    component: () => import('@/views/FriendsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Legacy /settings?tab=X → /settings/<group>/<sub> redirect map
const LEGACY_TAB_MAP: Record<string, string> = {
  users:        '/settings/team/users',
  teams:        '/settings/team/teams',
  roles:        '/settings/team/roles',
  org:          '/settings/org/profile',
  statuses:     '/settings/crm/statuses',
  'crm-tags':   '/settings/crm/tags',
  'zalo-labels':'/settings/crm/zalo-labels',
  scoring:      '/settings/crm/scoring',
};

// Auth guard + legacy tab redirect
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // Legacy: /settings?tab=X → /settings/<new-path>
  if (to.path === '/settings' && typeof to.query.tab === 'string') {
    const target = LEGACY_TAB_MAP[to.query.tab];
    if (target) return next(target);
  }

  // Skip guard for setup and login pages
  if (to.name === 'Setup' || to.name === 'Login') {
    return next();
  }

  // Check auth for protected routes
  if (to.meta.requiresAuth) {
    if (!authStore.token) {
      return next('/login');
    }
    // Fetch profile if not loaded yet
    if (!authStore.user) {
      await authStore.init();
      if (!authStore.isAuthenticated) {
        return next('/login');
      }
    }
    // Phase Onboarding v1 2026-05-24 — force change password lần đầu.
    // passwordChangedAt = null → block tất cả route khác, ép sale qua /setup-password.
    // allowUnchangedPassword cho phép /setup-password route bypass (chính nó).
    if (
      authStore.user?.passwordChangedAt === null &&
      !to.meta.allowUnchangedPassword
    ) {
      return next('/setup-password');
    }
    // Ngược lại: nếu user đã đổi pw mà vẫn vào /setup-password → redirect dashboard
    if (
      authStore.user?.passwordChangedAt !== null &&
      to.meta.allowUnchangedPassword
    ) {
      return next('/');
    }
  }

  next();
});
