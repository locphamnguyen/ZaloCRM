// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
// Open-core: extension route injection (empty in Community edition via @ee stub).
import { eeSettingsChildren, eeReportsChildren, eeTopRoutes } from '@ee/routes';

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
  // Trang CÔNG KHAI (không cần đăng nhập) — sale bấm link trong tin Zalo để
  // đánh dấu Lịch hẹn Hoàn thành / Huỷ. Xác thực bằng token ?t= (2026-06-16).
  {
    path: '/appointments/action',
    name: 'AppointmentAction',
    component: () => import('@/views/AppointmentActionView.vue'),
    // public: trang mở từ link Zalo khi sale CHƯA đăng nhập → không ép login,
    // và chặn axios/socket 401-interceptor redirect về /login (xem clearAuthAndRedirect).
    meta: { layout: 'auth', public: true },
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
    meta: { requiresAuth: true, resource: 'conversation' },
  },
  {
    path: '/contacts',
    name: 'Contacts',
    component: () => import('@/views/ContactsView.vue'),
    meta: { requiresAuth: true, resource: 'contact' },
  },
  {
    path: '/media',
    name: 'Media',
    component: () => import('@/views/MediaView.vue'),
    meta: { requiresAuth: true, resource: 'media' },
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
  // ════════ Module Báo cáo — shell + 7 màn (2026-06-17) ════════
  {
    path: '/reports',
    component: () => import('@/views/reports/ReportsShell.vue'),
    meta: { requiresAuth: true, resource: 'engagement_score' },
    redirect: '/reports/tong-quan',
    children: [
      { path: 'tong-quan',  name: 'Reports.Overview',   component: () => import('@/views/reports/OverviewReport.vue'),   meta: { resource: 'engagement_score' } },
      { path: 'nick',       name: 'Reports.Nick',       component: () => import('@/views/reports/NickFleetReport.vue'),  meta: { resource: 'engagement_score' } },
      { path: 'sale',       name: 'Reports.Sales',      component: () => import('@/views/reports/SalesReport.vue'),      meta: { resource: 'engagement_score' } },
      { path: 'pipeline',   name: 'Reports.Pipeline',   component: () => import('@/views/reports/PipelineReport.vue'),   meta: { resource: 'engagement_score' } },
      { path: 'engagement', name: 'Reports.Engagement', component: () => import('@/views/reports/EngagementReport.vue'), meta: { resource: 'engagement_score' } },
      { path: 'audit',      name: 'Reports.Audit',      component: () => import('@/views/reports/AuditReport.vue'),      meta: { resource: 'engagement_score' } },
      ...eeReportsChildren,
    ],
  },
  // Báo cáo cơ bản cũ — giữ deep-link không gãy.
  { path: '/reports-co-ban', name: 'Reports', component: () => import('@/views/ReportsView.vue'), meta: { requiresAuth: true, resource: 'engagement_score' } },
  {
    path: '/analytics',
    name: 'Analytics',
    component: () => import('@/views/AnalyticsView.vue'),
    meta: { requiresAuth: true, resource: 'engagement_score' },
  },
  // ════════ NEW Settings — 6-group sidebar layout ════════
  {
    path: '/settings',
    component: () => import('@/views/settings/SettingsLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      // Default: root /settings → role-based default route (handled in SettingsLayout onMounted)
      { path: '', name: 'Settings', component: () => import('@/views/settings/PersonalAccountPage.vue') },

      // 👤 Personal — Module Cá nhân gom 2026-06-13: 1 trang "Tài khoản của tôi".
      { path: 'personal/profile',       name: 'Settings.Profile',       component: () => import('@/views/settings/PersonalAccountPage.vue') },
      // Đổi mật khẩu giờ là modal trong trang Tài khoản → giữ link cũ không gãy bằng redirect.
      { path: 'personal/password',      name: 'Settings.Password',      redirect: '/settings/personal/profile' },
      { path: 'personal/notifications', name: 'Settings.Notifications', component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'notifications' } },
      { path: 'personal/theme',         name: 'Settings.Theme',         component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'theme' } },
      { path: 'personal/sessions',      name: 'Settings.Sessions',      component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'sessions' } },

      // 🏢 Org
      { path: 'org/profile', name: 'Settings.OrgProfile', component: () => import('@/components/settings/OrgSettings.vue'), meta: { resource: 'settings' } },
      { path: 'org/system-notifications', name: 'Settings.SystemNotifications', component: () => import('@/views/settings/SystemNotificationsPage.vue'), meta: { resource: 'settings' } },
      { path: 'org/billing', name: 'Settings.Billing',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'billing' }, meta: { resource: 'settings' } },
      { path: 'org/audit',   name: 'Settings.Audit',     component: () => import('@/views/settings/AuditLogView.vue'), meta: { resource: 'audit_log' } },

      // 👥 Team — Variant C menu reorg 2026-05-22: legacy team/* redirect → rbac/*
      // Em giữ 3 route legacy nhưng redirect sang RBAC pages mới để không break deep link.
      { path: 'team/users', redirect: '/settings/rbac/users' },
      { path: 'team/teams', redirect: '/settings/rbac/departments' },
      { path: 'team/roles', redirect: '/settings/rbac/permission-groups' },
      // RBAC Phase Phân Quyền 2026-05-21 (HS internal, branch private-hs)
      { path: 'rbac/departments',       name: 'Settings.RbacDepartments',       component: () => import('@/views/rbac/DepartmentsView.vue'), meta: { resource: 'department' } },
      { path: 'rbac/permission-groups', name: 'Settings.RbacPermissionGroups',  component: () => import('@/views/rbac/PermissionGroupsView.vue'), meta: { resource: 'permission_group' } },
      { path: 'rbac/users',             name: 'Settings.RbacUsers',             component: () => import('@/views/rbac/UsersRbacView.vue'), meta: { resource: 'user' } },
      // Phase Riêng Tư: trang /settings/privacy GỠ 2026-06-06 (trùng với tab Privacy
      // trong /settings/channels/zalo). Quản lý Riêng tư giờ DUY NHẤT ở tab Privacy.

      // ⚙ CRM Config — toàn bộ là cấu hình admin-level → resource 'settings'
      { path: 'crm/statuses',    name: 'Settings.Statuses',    component: () => import('@/components/settings/StatusManagement.vue'), meta: { resource: 'settings' } },
      { path: 'crm/tags',        name: 'Settings.Tags',        component: () => import('@/components/settings/CrmTagManagement.vue'), meta: { resource: 'settings' } },
      // Tag Taxonomy v2 — M57 /plan-eng-review 2026-05-31 (Wave 4a dual-write window).
      // Khi Wave 5 ship, route /crm/tags này sẽ thành alias của tags-v2.
      { path: 'crm/tags-v2',     name: 'Settings.TagsV2',      component: () => import('@/views/settings/TagTaxonomyV2Page.vue'), meta: { resource: 'settings' } },
      { path: 'crm/zalo-labels', name: 'Settings.ZaloLabels',  component: () => import('@/components/settings/ZaloLabelsManagement.vue'), meta: { resource: 'settings' } },
      { path: 'crm/scoring',     name: 'Settings.Scoring',     component: () => import('@/views/ScoringSettingsView.vue'), meta: { resource: 'settings' } },
      // Lịch hẹn → nhắc hẹn Zalo (2026-06-16) — bật/tắt + delay phút gửi link đánh dấu.
      { path: 'crm/appointments', name: 'Settings.Appointments', component: () => import('@/views/settings/AppointmentSettingsPage.vue'), meta: { resource: 'settings' } },
      { path: 'crm/stuck',       name: 'Settings.Stuck',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'stuck' }, meta: { resource: 'settings' } },
      { path: 'crm/folders',     name: 'Settings.Folders',     component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'folders' }, meta: { resource: 'settings' } },
      { path: 'crm/templates',   name: 'Settings.Templates',   component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'templates' }, meta: { resource: 'settings' } },
      // Lead Pool routes → extension bundle (eeSettingsChildren).
      // M53 2026-05-30 — Trợ Lý AI Virtual Chat
      { path: 'crm/ai-assistant',      name: 'Settings.AiAssistant',     component: () => import('@/views/settings/AiAssistantPage.vue'), meta: { resource: 'settings' } },
      // 🔌 Channels & Integrations
      { path: 'channels/zalo',             name: 'Settings.ZaloAccounts',    component: () => import('@/views/ZaloAccountsView.vue'), meta: { resource: 'zalo_account' } },
      // 2026-06-18 — Trần SDK dời sang Cài đặt (gate 'settings', KHÔNG 'zalo_account') → sale ko đổi được.
      { path: 'channels/sdk-limits',       name: 'Settings.SdkLimits',       component: () => import('@/views/settings/SdkLimitsSettingsPage.vue'), meta: { resource: 'settings' } },
      // Facebook Lead Ads route → extension bundle (eeSettingsChildren).
      { path: 'channels/rate-limit',       name: 'Settings.RateLimit',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'rate-limit' }, meta: { resource: 'settings' } },
      // Automation tech-settings route → extension bundle (eeSettingsChildren).
      { path: 'channels/integrations',     name: 'Settings.Integrations',    component: () => import('@/views/IntegrationsView.vue'), meta: { resource: 'settings' } },

      // 🛠 Dev & API
      { path: 'dev/api',           name: 'Settings.Api',          component: () => import('@/views/ApiSettingsView.vue'), meta: { resource: 'webhook' } },
      { path: 'dev/public-token',  name: 'Settings.PublicToken',  component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'public-token' }, meta: { resource: 'settings' } },
      { path: 'dev/feature-flags', name: 'Settings.FeatureFlags', component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'feature-flags' }, meta: { resource: 'settings' } },
      { path: 'dev/backup',        name: 'Settings.Backup',       component: () => import('@/views/settings/SettingsComingSoon.vue'), props: { feature: 'backup' }, meta: { resource: 'settings' } },
      ...eeSettingsChildren,
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
    meta: { requiresAuth: true, resource: 'contact' },
  },
  {
    // Tab "Hồ sơ KH tổng hợp" — SKELETON, render 3 field ẩn cột 4 (email/address/occupation)
    // + aggregate Friend rows. Backend route stub, full impl ở phase sau.
    path: '/contacts/:id/profile',
    name: 'ContactProfile',
    component: () => import('@/views/ContactProfileView.vue'),
    meta: { requiresAuth: true, resource: 'contact' },
  },
  {
    path: '/leads/stuck',
    name: 'StuckLeads',
    component: () => import('@/views/StuckLeadsView.vue'),
    meta: { requiresAuth: true, resource: 'contact' },
  },
  // Legacy redirects — old routes moved under /settings/*
  { path: '/settings/scoring', redirect: '/settings/crm/scoring' },
  { path: '/api-settings',     redirect: '/settings/dev/api' },
  { path: '/integrations',     redirect: '/settings/channels/integrations' },
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
    meta: { requiresAuth: true, resource: 'friend' },
  },
  // Open-core: extension top-level routes (empty in Community edition).
  ...eeTopRoutes,
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

    // RBAC page-level guard 2026-06-08 — chặn theo nhóm quyền (grants).
    // Route khai báo meta.resource → user phải canAccess(resource, action) mới vào.
    // owner/admin = full (canAccess tự bypass). Default action = 'access'.
    const required = to.meta.resource as string | undefined;
    if (required && !authStore.canAccess(required, (to.meta.action as string) ?? 'access')) {
      try { useToast().error('Bạn không có quyền truy cập trang này'); } catch { /* toast chưa sẵn sàng */ }
      // Đến từ trang hợp lệ → giữ nguyên (next(false)); vào thẳng bằng URL → về Dashboard.
      if (_from?.name) { next(false); return; }
      next('/'); return;
    }
  }

  next();
});

// ── Tiêu đề tab trình duyệt theo màn hình (2026-06-16) ─────────────────────────
// Map route.name → tên màn hình hiển thị trên tab Chrome. Gom 1 chỗ cho dễ bảo
// trì (khỏi rải meta.title khắp ~70 route). Route không có trong map → chỉ hiện
// brand. Title dạng "Tên màn hình · ZaloCRM".
const BRAND = 'ZaloCRM';
const ROUTE_TITLES: Record<string, string> = {
  // Top-level
  Login: 'Đăng nhập',
  Setup: 'Khởi tạo',
  SetupPassword: 'Đổi mật khẩu',
  Dashboard: 'Tổng quan',
  Chat: 'Hội thoại',
  Contacts: 'Khách hàng',
  Media: 'Kho phương tiện',
  Profile: 'Hồ sơ cá nhân',
  Appointments: 'Lịch hẹn',
  Reports: 'Báo cáo',
  'Reports.Overview': 'Báo cáo · Tổng quan điều hành',
  'Reports.Nick': 'Báo cáo · Vận hành Nick Zalo',
  'Reports.Sales': 'Báo cáo · Hiệu suất Sale & Team',
  'Reports.Pipeline': 'Báo cáo · Pipeline & Lead Pool',
  'Reports.Automation': 'Báo cáo · Automation & Chăm sóc',
  'Reports.Engagement': 'Báo cáo · Engagement KH',
  'Reports.Audit': 'Báo cáo · Audit & Sức khỏe hệ thống',
  Analytics: 'Phân tích',
  CustomerActivityLog: 'Nhật ký hoạt động KH',
  ContactProfile: 'Hồ sơ khách hàng',
  StuckLeads: 'Lead bị kẹt',
  Automation: 'Tự động hóa',
  Groups: 'Nhóm',
  Friends: 'Bạn bè',
  NotFound: 'Không tìm thấy trang',
  // Cài đặt
  Settings: 'Cài đặt',
  'Settings.Profile': 'Tài khoản của tôi',
  'Settings.Notifications': 'Thông báo',
  'Settings.Theme': 'Giao diện',
  'Settings.Sessions': 'Phiên đăng nhập',
  'Settings.OrgProfile': 'Hồ sơ tổ chức',
  'Settings.SystemNotifications': 'Thông báo hệ thống',
  'Settings.Billing': 'Thanh toán',
  'Settings.Audit': 'Nhật ký kiểm toán',
  'Settings.RbacDepartments': 'Phòng ban',
  'Settings.RbacPermissionGroups': 'Nhóm quyền',
  'Settings.RbacUsers': 'Người dùng',
  'Settings.Statuses': 'Trạng thái',
  'Settings.Tags': 'Thẻ (tag)',
  'Settings.TagsV2': 'Thẻ (taxonomy)',
  'Settings.ZaloLabels': 'Nhãn Zalo',
  'Settings.Scoring': 'Chấm điểm tương tác',
  'Settings.Appointments': 'Lịch hẹn & Nhắc hẹn',
  'Settings.Stuck': 'KH bị kẹt',
  'Settings.Folders': 'Thư mục',
  'Settings.Templates': 'Mẫu tin',
  'Settings.LeadPool': 'Lead Pool',
  'Settings.AiAssistant': 'Trợ lý AI',
  'Settings.ZaloAccounts': 'Tài khoản Zalo',
  'Settings.FacebookLeadAds': 'Facebook Lead Ads',
  'Settings.RateLimit': 'Giới hạn tốc độ',
  'Settings.Automation': 'Cài đặt Automation',
  'Settings.Integrations': 'Tích hợp',
  'Settings.Api': 'API & Webhook',
  'Settings.PublicToken': 'Public Token',
  'Settings.FeatureFlags': 'Feature Flags',
  'Settings.Backup': 'Sao lưu',
  // Marketing
  'Marketing.MucTieuList': 'Mục tiêu',
  'Marketing.MucTieuCreate': 'Tạo Mục tiêu',
  'Marketing.MucTieuDetail': 'Chi tiết Mục tiêu',
  'Marketing.FriendInviteCreate': 'Tạo lời mời kết bạn',
  'Marketing.ManualFollowup': 'Bám đuổi thủ công',
  'Marketing.CareSessions': 'Phiên chăm sóc',
  'Marketing.Blocks': 'Khối',
  'Marketing.Templates': 'Mẫu tin nhắn',
  'Marketing.Sequences': 'Luồng kịch bản',
  'Marketing.SequenceStats': 'Thống kê luồng',
  'Marketing.Broadcasts': 'Broadcast',
  'Marketing.BroadcastWizard': 'Tạo Broadcast',
  'Marketing.BroadcastDetail': 'Chi tiết Broadcast',
  'Marketing.Lists': 'Danh sách KH',
  'Marketing.ListDetail': 'Chi tiết danh sách',
};

router.afterEach((to) => {
  const key = typeof to.name === 'string' ? to.name : '';
  const screen = ROUTE_TITLES[key];
  document.title = screen ? `${screen} · ${BRAND}` : BRAND;
});
