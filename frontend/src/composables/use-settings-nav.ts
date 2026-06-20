// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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
// Open-core: extension settings items merged in by group id (empty in Community).
import { eeSettingsItems } from '@ee/nav';
// Open-core: edition flag — gate items whose code stays in Community but UI is hidden.
import { isExtension } from '@ee/edition';

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
  /** Open-core: item chỉ hiện ở bản Extension (code vẫn ở Community, chỉ ẩn menu). */
  extensionOnly?: boolean;
}

export interface SettingsGroup {
  id: string;
  label: string;
  icon: string;
  permission: SettingsPermission;
  items: SettingsItem[];
}

// ════════════════════════════════════════════════════════════════════════
// Redesign menu 2026-06-10 (CEO-review, anh duyệt mockup):
//   - 5 nhóm theo CHỨC NĂNG, tên tiếng Việt dễ hiểu cho sale.
//   - CẮT 11 mục rỗng (SettingsComingSoon) + trùng: Giao diện, Phiên đăng nhập,
//     Billing, Stuck detection, Folder mặc định, Template tin nhắn, Rate limit,
//     Public API token, Feature flags, Backup, "Tag CRM (cũ)". Route vẫn giữ
//     (router/index.ts), chỉ ẩn khỏi menu — thêm lại khi làm xong feature thật.
//   - GỘP: Nhận Lead + Queue chia Lead → "Lead Pool" (1 mục, 2 tab). Tag v2 → "Nhãn KH".
//   - ICON: dùng MDI line icon (Atlas v2), KHÔNG emoji.
// ════════════════════════════════════════════════════════════════════════
export const SETTINGS_GROUPS: SettingsGroup[] = [
  // ─── CÁ NHÂN ─────────────────────────────────────────
  {
    id: 'personal',
    label: 'Cá nhân',
    icon: 'mdi-account-circle-outline',
    permission: 'everyone',
    items: [
      // Module Cá nhân gom 2026-06-13 — "Hồ sơ" + "Đổi mật khẩu" gộp thành 1 mục
      // "Tài khoản của tôi" (1 trang: avatar + thông tin + đổi mật khẩu modal).
      { id: 'account', label: 'Tài khoản của tôi', icon: 'mdi-account-outline', route: '/settings/personal/profile', permission: 'everyone', aliases: ['hồ sơ', 'profile', 'avatar', 'ảnh đại diện', 'đổi mật khẩu', 'mật khẩu', 'password', 'tài khoản'] },
      // Riêng Tư 2026-06-06: trỏ thẳng tab Privacy trong trang Zalo (nơi quản lý DUY NHẤT).
      { id: 'privacy', label: 'Riêng tư', icon: 'mdi-shield-lock-outline', route: '/settings/channels/zalo?tab=privacy', permission: 'everyone', extensionOnly: true, aliases: ['privacy', 'otp', 'riêng tư', 'blur', 'nick chính'] },
      { id: 'notifications', label: 'Thông báo của tôi', icon: 'mdi-bell-outline', route: '/settings/channels/zalo?tab=internal-contact', permission: 'everyone', aliases: ['internal contact', 'liên lạc nội bộ', 'system notify', 'thông báo zalo'] },
    ],
  },

  // ─── TỔ CHỨC ─────────────────────────────────────────
  {
    id: 'org',
    label: 'Tổ chức',
    icon: 'mdi-domain',
    permission: 'admin',
    items: [
      { id: 'profile', label: 'Hồ sơ tổ chức', icon: 'mdi-office-building-outline', route: '/settings/org/profile', permission: 'admin', resource: 'settings' },
      { id: 'users', label: 'Nhân viên', icon: 'mdi-account-group-outline', route: '/settings/rbac/users', permission: 'admin', resource: 'user', aliases: ['user', 'sale', 'nhân sự'] },
      { id: 'departments', label: 'Sơ đồ tổ chức', icon: 'mdi-file-tree-outline', route: '/settings/rbac/departments', permission: 'admin', resource: 'department', aliases: ['phòng ban', 'department', 'tree', 'đội nhóm', 'team'] },
      { id: 'permission-groups', label: 'Phân quyền', icon: 'mdi-shield-account-outline', route: '/settings/rbac/permission-groups', permission: 'owner', resource: 'permission_group', aliases: ['phân quyền', 'permission', 'role', 'vai trò', 'nhóm quyền'] },
      { id: 'audit', label: 'Audit log', icon: 'mdi-history', route: '/settings/org/audit', permission: 'owner', resource: 'audit_log', aliases: ['audit', 'nhật ký', 'log bảo mật'] },
    ],
  },

  // ─── KHÁCH HÀNG & LEAD ───────────────────────────────
  {
    id: 'customer',
    label: 'Khách hàng & Lead',
    icon: 'mdi-target-account',
    permission: 'admin',
    items: [
      { id: 'statuses', label: 'Trạng thái KH', icon: 'mdi-flag-outline', route: '/settings/crm/statuses', permission: 'admin', resource: 'settings', aliases: ['stage', 'pipeline', 'trạng thái'] },
      { id: 'tags-v2', label: 'Nhãn KH', icon: 'mdi-tag-multiple-outline', route: '/settings/crm/tags-v2', permission: 'admin', resource: 'settings', aliases: ['tag', 'tag mới', 'tag taxonomy', 'friend tag', 'crm tag', 'nhãn'] },
      { id: 'zalo-labels', label: 'Tag Zalo native', icon: 'mdi-label-outline', route: '/settings/crm/zalo-labels', permission: 'admin', resource: 'settings', aliases: ['zalo label', 'nhãn zalo'] },
      { id: 'scoring', label: 'Lead scoring', icon: 'mdi-chart-line', route: '/settings/crm/scoring', permission: 'admin', resource: 'settings', aliases: ['điểm', 'chấm điểm', 'score'] },
      { id: 'appointments', label: 'Lịch hẹn & Nhắc hẹn', icon: 'mdi-calendar-clock-outline', route: '/settings/crm/appointments', permission: 'admin', resource: 'settings', aliases: ['lịch hẹn', 'appointment', 'nhắc hẹn', 'reminder', 'zalo reminder', 'nhắc lịch'] },
      // Lead Pool — gộp Nhận Lead + Queue chia Lead thành 1 mục 2 tab (2026-06-10).
      // Lead Pool nav item → extension bundle (eeSettingsItems.customer).
    ],
  },

  // ─── KÊNH & TỰ ĐỘNG ──────────────────────────────────
  {
    id: 'channels',
    label: 'Kênh & Tự động',
    icon: 'mdi-connection',
    permission: 'admin',
    items: [
      { id: 'zalo', label: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', route: '/settings/channels/zalo', permission: 'admin', resource: 'zalo_account', aliases: ['nick', 'zalo account'] },
      // 2026-06-18 — Trần SDK dời từ trang Zalo sang đây (gate resource 'settings', KHÔNG 'zalo_account')
      // → sale quản nick không thấy/không đổi được trần (trần SDK nguy hiểm).
      { id: 'sdk-limits', label: 'Trần an toàn SDK Zalo', icon: 'mdi-shield-alert-outline', route: '/settings/channels/sdk-limits', permission: 'admin', resource: 'settings', aliases: ['trần', 'rate limit', 'sdk', 'giới hạn', 'an toàn nick', 'khoá nick', 'quota nick', 'giới hạn gửi'] },
      // Facebook Lead Ads item → extension bundle (eeSettingsItems.channels).
      // Automation tech-settings nav item → extension bundle (eeSettingsItems.channels).
      { id: 'integrations', label: 'Tích hợp 3rd party', icon: 'mdi-puzzle-outline', route: '/settings/channels/integrations', permission: 'admin', resource: 'settings', aliases: ['tích hợp', 'integration', '3rd party'] },
    ],
  },

  // ─── HỆ THỐNG ────────────────────────────────────────
  // Gộp "Thông báo hệ thống" (từ Tổ chức cũ) + "Trợ lý AI" (từ CRM cũ) + Dev/API.
  {
    id: 'system',
    label: 'Hệ thống',
    icon: 'mdi-cog-outline',
    permission: 'admin',
    items: [
      { id: 'system-notifications', label: 'Thông báo hệ thống', icon: 'mdi-bell-cog-outline', route: '/settings/org/system-notifications', permission: 'admin', resource: 'settings', aliases: ['system notify', 'thông báo', 'zalo notify', 'uid', 'check live'] },
      { id: 'ai-assistant', label: 'Trợ lý AI', icon: 'mdi-robot-outline', route: '/settings/crm/ai-assistant', permission: 'admin', resource: 'settings', aliases: ['ai', 'tro ly', 'virtual chat', 'gemini', 'prompt'] },
      { id: 'api', label: 'API & Webhook', icon: 'mdi-api', route: '/settings/dev/api', permission: 'owner', resource: 'webhook', aliases: ['webhook', 'api key', 'dev'] },
    ],
  },
];

// Open-core: append extension items to their target groups (no-op in Community
// edition where eeSettingsItems is empty). Done once at module load.
for (const group of SETTINGS_GROUPS) {
  const extra = eeSettingsItems[group.id];
  if (extra?.length) group.items.push(...extra);
}

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
        items: g.items.filter(
          (item) =>
            (!item.extensionOnly || isExtension) &&
            (!item.resource || auth.canAccess(item.resource, item.action)),
        ),
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
