/**
 * use-settings-nav.ts — Central config cho Settings sidebar.
 *
 * Định nghĩa 6 group × 19 items. Mỗi item:
 *   - permission: ai thấy được (everyone / admin / owner)
 *   - comingSoon: scaffold cho feature sắp ra mắt
 *   - route: deep-link path
 *
 * Thêm item mới chỉ cần edit file này + tạo component + register route.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

export type SettingsPermission = 'everyone' | 'admin' | 'owner';

export interface SettingsItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  permission: SettingsPermission;
  /** RBAC 2026-06-08 — resource cần để thấy item. Không có resource = luôn hiện (vd Cá nhân). */
  resource?: string;
  action?: string;
  /** True nếu route trỏ tới SettingsComingSoon placeholder */
  comingSoon?: boolean;
  /** Search alias bổ sung (vd "phân quyền" → tìm "roles") */
  aliases?: string[];
}

export interface SettingsGroup {
  id: string;
  label: string;
  icon: string;
  permission: SettingsPermission;
  items: SettingsItem[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  // ─── 👤 CÁ NHÂN ──────────────────────────────────────
  {
    id: 'personal',
    label: 'Cá nhân',
    icon: '👤',
    permission: 'everyone',
    items: [
      { id: 'profile', label: 'Hồ sơ của tôi', icon: '👤', route: '/settings/personal/profile', permission: 'everyone' },
      { id: 'password', label: 'Đổi mật khẩu', icon: '🔑', route: '/settings/personal/password', permission: 'everyone' },
      // Phase Riêng Tư — 2026-06-06: trang riêng /settings/privacy GỠ, trỏ thẳng tab Privacy
      // trong trang Zalo (nơi quản lý Riêng tư DUY NHẤT). Unlock qua OTP Zalo, không còn PIN.
      { id: 'privacy', label: 'Riêng tư', icon: '🔒', route: '/settings/channels/zalo?tab=privacy', permission: 'everyone', aliases: ['privacy', 'otp', 'riêng tư', 'blur', 'nick chính'] },
      { id: 'notifications', label: 'Thông báo của tôi', icon: '🔔', route: '/settings/channels/zalo?tab=internal-contact', permission: 'everyone', aliases: ['internal contact', 'liên lạc nội bộ', 'system notify', 'thông báo zalo'] },
      { id: 'theme', label: 'Giao diện', icon: '🎨', route: '/settings/personal/theme', permission: 'everyone', comingSoon: true },
      { id: 'sessions', label: 'Phiên đăng nhập', icon: '📱', route: '/settings/personal/sessions', permission: 'everyone', comingSoon: true },
    ],
  },

  // ─── 🏢 TỔ CHỨC ──────────────────────────────────────
  // Variant C 2026-05-22: gộp 'Tổ chức' + 'Nhân sự' cũ thành 1 group.
  // RBAC phase shipped → "Sơ đồ tổ chức" replace "Đội nhóm", "Phân quyền" replace "Vai trò".
  // Legacy routes /settings/team/* 301 redirect → /settings/rbac/* (xem router/index.ts).
  {
    id: 'org',
    label: 'Tổ chức',
    icon: '🏢',
    permission: 'admin',
    items: [
      { id: 'profile', label: 'Hồ sơ tổ chức', icon: '🏢', route: '/settings/org/profile', permission: 'admin', resource: 'settings' },
      { id: 'system-notifications', label: 'Thông báo hệ thống', icon: '🔔', route: '/settings/org/system-notifications', permission: 'admin', resource: 'settings', aliases: ['system notify', 'thông báo', 'zalo notify', 'uid'] },
      { id: 'departments', label: 'Sơ đồ tổ chức', icon: '🌳', route: '/settings/rbac/departments', permission: 'admin', resource: 'department', aliases: ['phòng ban', 'department', 'tree', 'đội nhóm', 'team'] },
      { id: 'users', label: 'Nhân viên', icon: '👤', route: '/settings/rbac/users', permission: 'admin', resource: 'user', aliases: ['user', 'sale', 'nhân sự'] },
      { id: 'permission-groups', label: 'Phân quyền', icon: '🛡', route: '/settings/rbac/permission-groups', permission: 'owner', resource: 'permission_group', aliases: ['phân quyền', 'permission', 'role', 'vai trò', 'nhóm quyền'] },
      { id: 'audit', label: 'Audit log', icon: '📜', route: '/settings/org/audit', permission: 'owner', resource: 'audit_log', comingSoon: true },
      { id: 'billing', label: 'Gói cước & Billing', icon: '💳', route: '/settings/org/billing', permission: 'owner', resource: 'settings', comingSoon: true },
    ],
  },

  // ─── ⚙ CRM CONFIG ───────────────────────────────────
  {
    id: 'crm',
    label: 'CRM Config',
    icon: '⚙',
    permission: 'admin',
    items: [
      { id: 'statuses', label: 'Trạng thái KH', icon: '🎯', route: '/settings/crm/statuses', permission: 'admin', resource: 'settings', aliases: ['stage', 'pipeline'] },
      { id: 'tags', label: 'Tag CRM (cũ)', icon: '🏷', route: '/settings/crm/tags', permission: 'admin', resource: 'settings' },
      { id: 'tags-v2', label: 'Tag v2 — 2 Nhóm', icon: '🆕', route: '/settings/crm/tags-v2', permission: 'admin', resource: 'settings', aliases: ['tag mới', 'tag taxonomy', 'friend tag', 'crm tag'] },
      { id: 'zalo-labels', label: 'Tag Zalo native', icon: '⚑', route: '/settings/crm/zalo-labels', permission: 'admin', resource: 'settings', aliases: ['zalo label'] },
      { id: 'scoring', label: 'Lead scoring', icon: '📊', route: '/settings/crm/scoring', permission: 'admin', resource: 'settings', aliases: ['điểm', 'chấm điểm'] },
      // Phase Lead Pool — bố trí menu 2026-05-29
      { id: 'lead-pool', label: 'Nhận Lead', icon: '🎁', route: '/settings/crm/lead-pool', permission: 'admin', resource: 'settings', aliases: ['pool lead', 'lead pool', 'nhận lead', 'pool', 'quota', 'câu chào', 'greeting'] },
      { id: 'lead-pool-queue', label: 'Queue chia Lead', icon: '🎯', route: '/settings/crm/lead-pool/queue', permission: 'admin', resource: 'settings', aliases: ['queue lead', 'preview pool', 'xem trước'] },
      // M53 2026-05-30: AI Trợ Lý Virtual Chat
      { id: 'ai-assistant', label: 'Trợ lý AI (Chat nội bộ)', icon: '🤖', route: '/settings/crm/ai-assistant', permission: 'admin', resource: 'settings', aliases: ['ai', 'tro ly', 'virtual chat', 'gemini', 'prompt'] },
      { id: 'stuck', label: 'Stuck detection', icon: '⏸', route: '/settings/crm/stuck', permission: 'admin', resource: 'settings', comingSoon: true },
      { id: 'folders', label: 'Folder mặc định', icon: '📁', route: '/settings/crm/folders', permission: 'admin', resource: 'settings', comingSoon: true },
      { id: 'templates', label: 'Template tin nhắn', icon: '📝', route: '/settings/crm/templates', permission: 'admin', resource: 'settings', comingSoon: true },
    ],
  },

  // ─── 🔌 KÊNH & TÍCH HỢP ─────────────────────────────
  {
    id: 'channels',
    label: 'Kênh & Tích hợp',
    icon: '🔌',
    permission: 'admin',
    items: [
      { id: 'zalo', label: 'Tài khoản Zalo', icon: '💬', route: '/settings/channels/zalo', permission: 'admin', resource: 'zalo_account', aliases: ['nick', 'zalo account'] },
      // Phase Multi-Source Lead Ads 2026-05-27
      { id: 'fb-leadads', label: 'Facebook Lead Ads', icon: '📘', route: '/settings/channels/facebook-leadads', permission: 'admin', resource: 'settings', aliases: ['fb', 'facebook', 'lead ads', 'leadads', 'meta'] },
      { id: 'rate-limit', label: 'Rate limit per nick', icon: '⏱', route: '/settings/channels/rate-limit', permission: 'admin', resource: 'settings', comingSoon: true },
      { id: 'automation', label: 'Cài đặt kỹ thuật tự động hoá', icon: '⚙️', route: '/settings/channels/automation', permission: 'admin', resource: 'settings', aliases: ['automation', 'kỹ thuật', 'nhịp quét', 'timeout', 'bám đuổi kỹ thuật'] },
      { id: 'integrations', label: 'Tích hợp 3rd party', icon: '🔗', route: '/settings/channels/integrations', permission: 'admin', resource: 'settings' },
    ],
  },

  // ─── 🛠 DEV & API ───────────────────────────────────
  {
    id: 'dev',
    label: 'Dev & API',
    icon: '🛠',
    permission: 'owner',
    items: [
      { id: 'api', label: 'API Key & Webhook', icon: '🔌', route: '/settings/dev/api', permission: 'owner', resource: 'webhook', aliases: ['webhook', 'api key'] },
      { id: 'public-token', label: 'Public API token', icon: '🎫', route: '/settings/dev/public-token', permission: 'owner', resource: 'settings', comingSoon: true },
      { id: 'feature-flags', label: 'Feature flags', icon: '🚩', route: '/settings/dev/feature-flags', permission: 'owner', resource: 'settings', comingSoon: true },
      { id: 'backup', label: 'Backup & Restore', icon: '💾', route: '/settings/dev/backup', permission: 'owner', resource: 'settings', comingSoon: true },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────

export function useSettingsNav() {
  const auth = useAuthStore();
  const route = useRoute();

  /**
   * Groups + items đã filter theo NHÓM QUYỀN (grants) của user hiện tại.
   * RBAC enforce 2026-06-08: item không có resource → luôn hiện (vd Cá nhân);
   * có resource → cần canAccess. Group ẩn nếu không còn item con.
   * (Trước đây lọc theo legacy role nên Trưởng phòng/Marketing role=member bị ẩn oan.)
   */
  const visibleGroups = computed<SettingsGroup[]>(() => {
    return SETTINGS_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => !item.resource || auth.canAccess(item.resource, item.action)),
      }))
      .filter((g) => g.items.length > 0);
  });

  /** Find item by route path + query. Items có query (vd ?tab=internal-contact) match riêng;
   *  items không query match chỉ khi current route cũng không có tab matching item khác. */
  const activeItem = computed<{ group: SettingsGroup; item: SettingsItem } | null>(() => {
    const path = route.path;
    const currentTab = route.query.tab as string | undefined;
    // Pass 1: items có query — match path + ?tab=<x>
    for (const g of visibleGroups.value) {
      for (const item of g.items) {
        const [itemPath, itemQuery] = item.route.split('?');
        if (itemQuery && itemPath === path) {
          const expectedTab = new URLSearchParams(itemQuery).get('tab');
          if (expectedTab && expectedTab === currentTab) return { group: g, item };
        }
      }
    }
    // Pass 2: items không query — match path, current route phải không có tab hoặc tab khác
    for (const g of visibleGroups.value) {
      for (const item of g.items) {
        if (item.route === path) return { group: g, item };
      }
    }
    return null;
  });

  /** Search filter (live filter sidebar items) */
  function searchItems(query: string): SettingsItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: SettingsItem[] = [];
    for (const g of visibleGroups.value) {
      for (const item of g.items) {
        const matchLabel = item.label.toLowerCase().includes(q);
        const matchGroup = g.label.toLowerCase().includes(q);
        const matchAlias = item.aliases?.some((a) => a.toLowerCase().includes(q));
        if (matchLabel || matchGroup || matchAlias) results.push(item);
      }
    }
    return results;
  }

  /** Default route when user lands on /settings — RBAC theo grants */
  const defaultRoute = computed<string>(() => {
    if (auth.canAccess('user')) return '/settings/rbac/users';
    return '/settings/personal/profile';
  });

  return { visibleGroups, activeItem, searchItems, defaultRoute };
}
