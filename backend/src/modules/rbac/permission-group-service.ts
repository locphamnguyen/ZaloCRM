// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * permission-group-service.ts — RBAC Phase Phân Quyền 2026-05-21
 *
 * CRUD permission groups (tree shape, JSONB grants matrix).
 * Reference: GetflyCRM screenshot Phân quyền tab.
 *
 * Concurrency note: 1 user ∈ 1 permission_group. Grants thay đổi → in-memory cache
 * phải invalidate (xem D8 RBAC middleware).
 */
import { randomUUID } from 'node:crypto';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { sanitizeGrants, hasGrant, type GrantsJson, type Resource, type Action } from './permission-types.js';

export interface PermissionGroupNode {
  id: string;
  name: string;
  parentId: string | null;
  isSystem: boolean;
  displayOrder: number;
  archivedAt: Date | null;
  grants: GrantsJson;
  memberCount: number;
  children: PermissionGroupNode[];
}

export async function getOrgPermissionGroups(orgId: string): Promise<PermissionGroupNode[]> {
  const [groups, userCounts] = await Promise.all([
    prisma.permissionGroup.findMany({
      where: { orgId, archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    }),
    // Count users per group
    prisma.user.groupBy({
      by: ['permissionGroupId'],
      where: { orgId, permissionGroupId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const countMap = new Map<string, number>();
  for (const c of userCounts) {
    if (c.permissionGroupId) countMap.set(c.permissionGroupId, c._count._all);
  }

  const nodeMap = new Map<string, PermissionGroupNode>();
  for (const g of groups) {
    nodeMap.set(g.id, {
      id: g.id,
      name: g.name,
      parentId: g.parentId,
      isSystem: g.isSystem,
      displayOrder: g.displayOrder,
      archivedAt: g.archivedAt,
      grants: (g.grants ?? {}) as GrantsJson,
      memberCount: countMap.get(g.id) ?? 0,
      children: [],
    });
  }

  const roots: PermissionGroupNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === null) roots.push(node);
    else {
      const parent = nodeMap.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  return roots;
}

export async function getPermissionGroup(orgId: string, id: string): Promise<{
  id: string;
  name: string;
  parentId: string | null;
  isSystem: boolean;
  grants: GrantsJson;
  memberCount: number;
} | null> {
  const g = await prisma.permissionGroup.findFirst({
    where: { id, orgId, archivedAt: null },
  });
  if (!g) return null;
  const memberCount = await prisma.user.count({
    where: { orgId, permissionGroupId: id },
  });
  return {
    id: g.id,
    name: g.name,
    parentId: g.parentId,
    isSystem: g.isSystem,
    grants: (g.grants ?? {}) as GrantsJson,
    memberCount,
  };
}

export async function createPermissionGroup(input: {
  orgId: string;
  name: string;
  parentId: string | null;
  cloneFromId?: string;
  grants?: GrantsJson;
}): Promise<{ id: string; name: string; grants: GrantsJson }> {
  if (!input.name?.trim()) throw new Error('Tên nhóm quyền không được trống');

  let grants: GrantsJson = sanitizeGrants(input.grants ?? {});

  // Clone từ group khác
  if (input.cloneFromId) {
    const src = await prisma.permissionGroup.findFirst({
      where: { id: input.cloneFromId, orgId: input.orgId },
      select: { grants: true },
    });
    if (!src) throw new Error('Nhóm quyền clone-from không tồn tại');
    grants = sanitizeGrants(src.grants as object);
  }

  // Validate parent
  if (input.parentId) {
    const parent = await prisma.permissionGroup.findFirst({
      where: { id: input.parentId, orgId: input.orgId, archivedAt: null },
      select: { id: true },
    });
    if (!parent) throw new Error('Nhóm quyền cha không tồn tại');
  }

  const id = randomUUID();
  await prisma.permissionGroup.create({
    data: {
      id,
      orgId: input.orgId,
      name: input.name.trim(),
      parentId: input.parentId,
      isSystem: false, // Custom group, không phải system
      grants: grants as object,
    },
  });
  return { id, name: input.name.trim(), grants };
}

export async function updatePermissionGroup(input: {
  orgId: string;
  id: string;
  name?: string;
  parentId?: string | null;
  grants?: GrantsJson;
  displayOrder?: number;
}): Promise<{ id: string; name: string; grants: GrantsJson }> {
  const existing = await prisma.permissionGroup.findFirst({
    where: { id: input.id, orgId: input.orgId, archivedAt: null },
  });
  if (!existing) throw new Error('Nhóm quyền không tồn tại');

  // System group: chỉ cho phép grants thay đổi (anh có thể tweak Admin), KHÔNG đổi name/parent
  if (existing.isSystem) {
    if (input.name !== undefined && input.name !== existing.name) {
      throw new Error('Không thể đổi tên nhóm quyền hệ thống');
    }
    if (input.parentId !== undefined && input.parentId !== existing.parentId) {
      throw new Error('Không thể đổi vị trí nhóm quyền hệ thống');
    }
  }

  if (input.name !== undefined && !input.name?.trim()) {
    throw new Error('Tên nhóm quyền không được trống');
  }
  if (input.parentId === input.id) {
    throw new Error('Nhóm quyền không thể là cha của chính nó');
  }

  // FIX codex review #5: validate parent thuộc đúng org + active TRƯỚC khi anti-cycle.
  // FIX codex review #2: wrap check + update trong 1 tx atomic.
  return await tenantTransaction(async (tx) => {
    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = await tx.permissionGroup.findFirst({
        where: { id: input.parentId, orgId: input.orgId, archivedAt: null },
        select: { id: true },
      });
      if (!parent) throw new Error('Nhóm quyền cha không tồn tại (hoặc khác tổ chức)');
      const isDescendant = await checkIsDescendant(input.orgId, input.parentId, input.id, tx);
      if (isDescendant) {
        throw new Error('Không thể move nhóm quyền vào trong nhánh con của chính nó');
      }
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.parentId !== undefined) data.parentId = input.parentId;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.grants !== undefined) data.grants = sanitizeGrants(input.grants) as object;

    const updated = await tx.permissionGroup.update({
      where: { id: input.id },
      data,
    });
    return {
      id: updated.id,
      name: updated.name,
      grants: (updated.grants ?? {}) as GrantsJson,
    };
  });
}

/**
 * Recursive check: descendantId có nằm trong subtree của ancestorId không?
 * Pass tx để chia sẻ snapshot transaction (consistent read).
 */
async function checkIsDescendant(
  orgId: string,
  descendantId: string,
  ancestorId: string,
  client: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0] = prisma,
): Promise<boolean> {
  let currentId: string | null = descendantId;
  let hops = 0;
  while (currentId && hops < 20) {
    if (currentId === ancestorId) return true;
    const parent: { parentId: string | null } | null = await (client as any).permissionGroup.findFirst({
      where: { id: currentId, orgId },
      select: { parentId: true },
    });
    if (!parent) break;
    currentId = parent.parentId;
    hops++;
  }
  return false;
}

export async function archivePermissionGroup(orgId: string, id: string): Promise<void> {
  // FIX codex review #7: wrap count + archive trong 1 tx, lock group row → tránh race.
  await tenantTransaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string; is_system: boolean }>>(
      `SELECT id, is_system FROM permission_groups
       WHERE id = $1 AND org_id = $2 AND archived_at IS NULL FOR UPDATE`,
      id,
      orgId,
    );
    if (rows.length === 0) throw new Error('Nhóm quyền không tồn tại');
    if (rows[0].is_system) throw new Error('Không thể xóa nhóm quyền hệ thống');

    const memberCount = await tx.user.count({ where: { orgId, permissionGroupId: id } });
    if (memberCount > 0) {
      throw new Error(`Nhóm quyền còn ${memberCount} user — chuyển hết user sang nhóm khác trước khi xóa`);
    }
    const childCount = await tx.permissionGroup.count({
      where: { parentId: id, archivedAt: null },
    });
    if (childCount > 0) {
      throw new Error(`Nhóm quyền còn ${childCount} nhóm con — xóa hoặc move các nhóm con trước`);
    }

    await tx.permissionGroup.update({ where: { id }, data: { archivedAt: new Date() } });
  });
}

/**
 * Check permission của 1 user trên 1 (resource, action).
 * Đây là hot path RBAC — cache layer ở D8.
 */
export async function userHasGrant(
  userId: string,
  resource: Resource,
  action: Action,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      permissionGroupId: true,
      permissionGroup: { select: { grants: true, archivedAt: true } },
      role: true, // legacy fallback
    },
  });
  if (!user) return false;

  // Permission group active
  if (user.permissionGroup && !user.permissionGroup.archivedAt) {
    const grants = (user.permissionGroup.grants ?? {}) as GrantsJson;
    if (hasGrant(grants, resource, action)) return true;
  }

  // Fallback: legacy role='owner' hoặc 'admin' → bypass mọi quyền.
  // Anh chốt 2026-06-08: admin toàn quyền như owner (khớp canAccess frontend + getProfile.isFullAccess).
  if (user.role === 'owner' || user.role === 'admin') return true;

  return false;
}
