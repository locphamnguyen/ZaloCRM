import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
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
      { path: 'org/billing', name: 'Settings.Billing',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'billing' } },
      { path: 'org/audit',   name: 'Settings.Audit',     component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'audit' } },

      // 👥 Team
      { path: 'team/users', name: 'Settings.Users', component: () => import('@/components/settings/UserManagement.vue') },
      { path: 'team/teams', name: 'Settings.Teams', component: () => import('@/components/settings/TeamManagement.vue') },
      { path: 'team/roles', name: 'Settings.Roles', component: () => import('@/views/settings/RolesPage.vue') },

      // ⚙ CRM Config
      { path: 'crm/statuses',    name: 'Settings.Statuses',    component: () => import('@/components/settings/StatusManagement.vue') },
      { path: 'crm/tags',        name: 'Settings.Tags',        component: () => import('@/components/settings/CrmTagManagement.vue') },
      { path: 'crm/zalo-labels', name: 'Settings.ZaloLabels',  component: () => import('@/components/settings/ZaloLabelsManagement.vue') },
      { path: 'crm/scoring',     name: 'Settings.Scoring',     component: () => import('@/views/ScoringSettingsView.vue') },
      { path: 'crm/stuck',       name: 'Settings.Stuck',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'stuck' } },
      { path: 'crm/folders',     name: 'Settings.Folders',     component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'folders' } },
      { path: 'crm/templates',   name: 'Settings.Templates',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'templates' } },

      // 🔌 Channels & Integrations
      { path: 'channels/zalo',         name: 'Settings.ZaloAccounts', component: () => import('@/views/ZaloAccountsView.vue') },
      { path: 'channels/rate-limit',   name: 'Settings.RateLimit',    component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'rate-limit' } },
      { path: 'channels/automation',   name: 'Settings.Automation',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'automation' } },
      { path: 'channels/integrations', name: 'Settings.Integrations', component: () => import('@/views/IntegrationsView.vue') },

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
  // Phase 7 — Bot-Auto framework (Block / Sequence / Trigger / Broadcast)
  {
    path: '/automation/bot',
    component: () => import('@/views/automation/BotAutoShell.vue'),
    meta: { requiresAuth: true },
    redirect: '/automation/bot/triggers',
    children: [
      { path: 'triggers',   name: 'BotAuto.Triggers',   component: () => import('@/views/automation/TriggersView.vue') },
      { path: 'blocks',     name: 'BotAuto.Blocks',     component: () => import('@/views/automation/BlocksView.vue') },
      { path: 'sequences',  name: 'BotAuto.Sequences',  component: () => import('@/views/automation/SequencesView.vue') },
      { path: 'broadcasts', name: 'BotAuto.Broadcasts', component: () => import('@/views/automation/BroadcastsView.vue') },
      { path: 'lists',      name: 'BotAuto.Lists',      component: () => import('@/views/automation/ListsView.vue') },
      { path: 'lists/:id',  name: 'BotAuto.ListDetail', component: () => import('@/views/automation/ListDetailView.vue') },
    ],
  },
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
  }

  next();
});
