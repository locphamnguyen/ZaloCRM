// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * permission-types.ts — Resource × Action matrix định nghĩa
 *
 * Reference: GetflyCRM screenshot (matrix 7 cột × 15 resource).
 * Lock 2026-05-21 trong design doc thanh-rbac-m2-design-20260521.md.
 */

// 7 action columns (giống Getfly)
export const ACTIONS = [
  'access',       // Truy cập
  'create',       // Thêm mới
  'edit',         // Chỉnh sửa
  'delete',       // Xóa
  'approve',      // Duyệt
  'pay',          // Thanh toán
  'view_all',     // Xem tất cả — KEY FLAG bypass dept scope
] as const;
export type Action = (typeof ACTIONS)[number];

// 15 resources trong ZaloCRM (map từ Getfly + thêm cụ thể cho Zalo domain)
export const RESOURCES = [
  'department',         // Quản lý phòng ban
  'user',               // Quản lý người dùng
  'permission_group',   // Quản lý quyền
  'conversation',       // Hội thoại
  'contact',            // Khách hàng
  'friend',             // Friends (Zalo per-account)
  'customer_list',      // Tệp KH
  'broadcast',          // Chiến dịch
  'sequence',           // Sequence automation
  'trigger',            // Trigger automation
  'block',              // Message block
  'zalo_account',       // Nick Zalo
  'webhook',            // Webhook outbound
  'engagement_score',   // Engagement + Score (metadata)
  'audit_log',          // Activity / Audit log
  'settings',           // App settings
  'care_session',       // Phiên chăm sóc (CareSession) — 2026-06-07
  'media',              // Kho phương tiện (ảnh/album/file/video) — 2026-06-11
] as const;
export type Resource = (typeof RESOURCES)[number];

// Mỗi resource declare actions hợp lệ (subset của ACTIONS).
// Vd Engagement không có "create/edit/delete" — chỉ computed.
export const RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  department: ['access', 'create', 'edit', 'delete'],
  user: ['access', 'create', 'edit', 'delete'],
  permission_group: ['access', 'create', 'edit', 'delete'],
  conversation: ['access', 'edit', 'delete', 'view_all'],
  contact: ['access', 'create', 'edit', 'delete', 'view_all'],
  friend: ['access', 'create', 'edit', 'delete', 'view_all'],
  customer_list: ['access', 'create', 'edit', 'delete', 'approve', 'view_all'],
  broadcast: ['access', 'create', 'edit', 'delete', 'approve', 'view_all'],
  sequence: ['access', 'create', 'edit', 'delete', 'approve', 'view_all'],
  trigger: ['access', 'create', 'edit', 'delete', 'view_all'],
  block: ['access', 'create', 'edit', 'delete', 'view_all'],
  zalo_account: ['access', 'create', 'edit', 'delete', 'view_all'],
  webhook: ['access', 'create', 'edit', 'delete'],
  engagement_score: ['access', 'view_all'],
  audit_log: ['access', 'view_all'],
  settings: ['access', 'create', 'edit'],
  // Phiên chăm sóc — access=xem phiên mình, view_all=xem cả org (scope theo dept tree).
  care_session: ['access', 'view_all'],
  // Kho phương tiện — access=xem/dùng kho, create=tải lên/lưu, edit=sửa quyền/tag/watermark,
  // delete=archive, view_all=xem cả org bỏ qua scope owner (admin/marketing).
  media: ['access', 'create', 'edit', 'delete', 'view_all'],
};

// JSON shape lưu trong permission_groups.grants:
//   { "<resource>": { "<action>": boolean } }
// Vd:
//   { "conversation": { "access": true, "view_all": true, "edit": true } }
export type GrantsJson = {
  [R in Resource]?: {
    [A in Action]?: boolean;
  };
};

/**
 * Check 1 action có grant không.
 * Default deny (return false nếu thiếu).
 */
export function hasGrant(grants: GrantsJson, resource: Resource, action: Action): boolean {
  return grants?.[resource]?.[action] === true;
}

/**
 * Validate grants JSON từ user input — strip mọi key không nằm trong whitelist.
 * Tránh injection: grants.adminBackdoor = true sẽ bị strip.
 */
export function sanitizeGrants(input: unknown): GrantsJson {
  if (!input || typeof input !== 'object') return {};
  const result: GrantsJson = {};
  for (const [r, actions] of Object.entries(input as Record<string, unknown>)) {
    if (!RESOURCES.includes(r as Resource)) continue;
    if (!actions || typeof actions !== 'object') continue;
    const validActions = RESOURCE_ACTIONS[r as Resource];
    const cleanActions: Record<string, boolean> = {};
    for (const [a, v] of Object.entries(actions as Record<string, unknown>)) {
      if (!validActions.includes(a as Action)) continue;
      if (typeof v === 'boolean') cleanActions[a] = v;
    }
    if (Object.keys(cleanActions).length > 0) {
      result[r as Resource] = cleanActions as any;
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// DEFAULT PERMISSION GROUPS (system, ship khi migration D13)
// 7 group anh chốt trong design doc.
// ════════════════════════════════════════════════════════════════════════

function fullCrud(resource: Resource): GrantsJson[Resource] {
  const actions: any = {};
  for (const a of RESOURCE_ACTIONS[resource]) actions[a] = true;
  return actions;
}

function readOnly(resource: Resource): GrantsJson[Resource] {
  return { access: true };
}

function viewAll(resource: Resource): GrantsJson[Resource] {
  return { access: true, view_all: true };
}

/**
 * Default groups. Migration D13 sẽ tạo các group này với is_system=true.
 * Admin → full mọi resource × mọi action.
 * Marketing → anh chốt A: contact.view_all=true (Zalo test loop 2026-05-21 13:25).
 */
export const DEFAULT_PERMISSION_GROUPS = [
  {
    name: 'Admin',
    isSystem: true,
    grants: Object.fromEntries(
      RESOURCES.map((r) => [r, fullCrud(r)])
    ) as GrantsJson,
  },
  {
    name: 'CEO',
    isSystem: true,
    grants: {
      // CEO xem mọi resource business, không sửa permission/department/user
      department: { access: true },
      user: { access: true },
      permission_group: { access: true },
      conversation: viewAll('conversation'),
      contact: viewAll('contact'),
      friend: viewAll('friend'),
      customer_list: { access: true, view_all: true, create: true, edit: true, approve: true },
      broadcast: { access: true, view_all: true, create: true, edit: true, approve: true },
      sequence: { access: true, view_all: true, create: true, edit: true, approve: true },
      trigger: viewAll('trigger'),
      block: viewAll('block'),
      zalo_account: viewAll('zalo_account'),
      engagement_score: viewAll('engagement_score'),
      audit_log: viewAll('audit_log'),
      settings: { access: true },
      media: viewAll('media'), // xem cả kho org
    } as GrantsJson,
  },
  {
    name: 'Trưởng phòng',
    isSystem: true,
    grants: {
      // Manager full CRUD trong scope dept + sub-depts (view_all = false vì scope dept tree, không phải global)
      department: { access: true },
      user: { access: true },
      conversation: { access: true, edit: true, delete: true, view_all: true }, // view_all trong scope dept
      contact: fullCrud('contact'),
      friend: fullCrud('friend'),
      customer_list: { access: true, create: true, edit: true, delete: true, approve: true, view_all: true },
      broadcast: { access: true, create: true, edit: true, delete: true, approve: true, view_all: true },
      sequence: { access: true, create: true, edit: true, approve: true, view_all: true },
      trigger: { access: true, create: true, edit: true, view_all: true },
      block: { access: true, create: true, edit: true, delete: true, view_all: true },
      zalo_account: { access: true, view_all: true },
      engagement_score: viewAll('engagement_score'),
      audit_log: { access: true },
      settings: { access: true },
      media: { access: true, create: true, edit: true, delete: true, view_all: true }, // full trong scope dept
    } as GrantsJson,
  },
  {
    name: 'Sale Senior',
    isSystem: true,
    grants: {
      // Sale Senior CRUD KH + Conversation của mình, có Xóa
      conversation: { access: true, edit: true, delete: true },
      contact: { access: true, create: true, edit: true, delete: true },
      friend: { access: true, create: true, edit: true },
      customer_list: { access: true, create: true, edit: true },
      broadcast: { access: true, create: true, edit: true },
      sequence: { access: true, create: true, edit: true },
      trigger: { access: true },
      block: { access: true, create: true, edit: true },
      zalo_account: { access: true },
      engagement_score: { access: true },
      audit_log: { access: true },
      media: { access: true, create: true, edit: true }, // kho của mình (scope owner)
    } as GrantsJson,
  },
  {
    name: 'Sale',
    isSystem: true,
    grants: {
      // Sale CR KH của mình, không Xóa Conversation
      conversation: { access: true, edit: true },
      contact: { access: true, create: true, edit: true },
      friend: { access: true, create: true, edit: true },
      customer_list: { access: true },
      broadcast: { access: true },
      sequence: { access: true },
      trigger: { access: true },
      block: { access: true },
      // 2026-06-09 (Anh chốt): sale tự kết nối nick mới + xóa MỀM nick CỦA MÌNH.
      // Ownership check ở requireAccountManagement đảm bảo chỉ đụng nick mình owner.
      zalo_account: { access: true, create: true, delete: true },
      engagement_score: { access: true },
      media: { access: true, create: true, edit: true }, // kho của mình (scope owner) — sale dùng nhiều nhất
    } as GrantsJson,
  },
  {
    name: 'Marketing',
    isSystem: true,
    grants: {
      // Marketing CRUD Broadcast/Sequence/Trigger/Block, view_all Contact (anh chốt A 2026-05-21 13:25)
      contact: { access: true, view_all: true },
      friend: { access: true, view_all: true },
      customer_list: { access: true, create: true, edit: true, view_all: true },
      broadcast: { access: true, create: true, edit: true, delete: true, view_all: true },
      sequence: { access: true, create: true, edit: true, delete: true, view_all: true },
      trigger: { access: true, create: true, edit: true, delete: true, view_all: true },
      block: { access: true, create: true, edit: true, delete: true, view_all: true },
      engagement_score: viewAll('engagement_score'),
      audit_log: { access: true },
      media: { access: true, create: true, edit: true, delete: true, view_all: true }, // tài sản marketing dùng chung
    } as GrantsJson,
  },
  {
    name: 'Hành chính - Nhân sự',
    isSystem: true,
    grants: {
      // HC-NS view-only User + report, không access Conversation/Contact content
      user: { access: true, create: true, edit: true },
      department: { access: true },
      engagement_score: { access: true },
      audit_log: { access: true, view_all: true },
      settings: { access: true },
    } as GrantsJson,
  },
];
