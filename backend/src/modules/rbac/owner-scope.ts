// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * owner-scope.ts — Phase Marketing + Analytics Scope 2026-05-27.
 *
 * Helper chung cho LIST endpoints có field `createdById` (Block, Broadcast,
 * Sequence, Trigger, CustomerList, SavedReport...). Áp scope theo cùng quy
 * tắc với getContactScope:
 *
 *   - owner/admin (org-wide)      → không filter (xem tất cả)
 *   - leader/deputy của dept X    → filter createdById ∈ dept subtree
 *   - member thường (Sale)        → filter createdById === userId (chỉ của mình)
 *
 * Trả về Prisma `where` fragment để caller spread vào query. Skip filter
 * nếu user có grant `<resource>.view_all` qua permission group RBAC.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { userHasGrant } from './permission-group-service.js';
import type { Resource } from './permission-types.js';

export interface OwnerScope {
  /** True nếu user xem tất cả (admin/owner hoặc có grant view_all) */
  canViewAll: boolean;
  /** userIds visible (chính mình + dept subtree nếu leader/deputy) */
  visibleUserIds: string[];
}

/**
 * Compute scope createdBy. Dùng cho mọi list endpoint trên resource có
 * createdById. Cache theo userId trong cùng request không cần, vì gọi 1 lần.
 */
export async function getOwnerScope(args: {
  userId: string;
  orgId: string;
  legacyRole: string;
  /** Resource for view_all grant check. Optional — skip nếu resource chưa có trong RBAC matrix. */
  resource?: Resource;
}): Promise<OwnerScope> {
  const { userId, orgId, legacyRole, resource } = args;

  // Org admin/owner → view all
  if (legacyRole === 'owner' || legacyRole === 'admin') {
    return { canViewAll: true, visibleUserIds: [] };
  }

  // Check grant view_all qua permission group RBAC nếu resource cung cấp
  if (resource) {
    const hasViewAll = await userHasGrant(userId, resource, 'view_all').catch(() => false);
    if (hasViewAll) {
      return { canViewAll: true, visibleUserIds: [] };
    }
  }

  // Load dept-membership để cascade
  const me = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: {
      departmentMember: {
        select: {
          deptRole: true,
          department: { select: { id: true, path: true } },
        },
      },
    },
  });

  const visible = new Set<string>([userId]);
  if (
    me?.departmentMember &&
    (me.departmentMember.deptRole === 'leader' || me.departmentMember.deptRole === 'deputy')
  ) {
    const myPath = me.departmentMember.department.path;
    const subtreeDepts = await prisma.department.findMany({
      where: { orgId, path: { startsWith: myPath } },
      select: { id: true },
    });
    const subtreeDeptIds = subtreeDepts.map((d) => d.id);
    const subtreeMembers = await prisma.departmentMember.findMany({
      where: { departmentId: { in: subtreeDeptIds } },
      select: { userId: true },
    });
    for (const m of subtreeMembers) visible.add(m.userId);
  }

  return { canViewAll: false, visibleUserIds: Array.from(visible) };
}

/**
 * Tạo Prisma `where` fragment apply scope createdById.
 * Caller spread vào query: `where: { ...baseWhere, ...applyOwnerScope(scope, 'createdById') }`.
 *
 * Field name có thể là 'createdById' (Block, Broadcast, ...) hoặc 'createdBy' (SavedReport).
 */
export function applyOwnerScope(
  scope: OwnerScope,
  fieldName: string = 'createdById',
): Record<string, unknown> {
  if (scope.canViewAll) return {};
  return { [fieldName]: { in: scope.visibleUserIds } };
}
