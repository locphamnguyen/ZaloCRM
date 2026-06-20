// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * seed-default-groups.ts — Seed 7 default permission groups (system, is_system=true)
 *
 * Idempotent: chạy nhiều lần OK, chỉ tạo nếu group chưa tồn tại trong org.
 * Gọi từ migration script D13 hoặc admin endpoint.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { DEFAULT_PERMISSION_GROUPS } from './permission-types.js';

export interface SeedResult {
  created: number;
  existing: number;
  groups: Array<{ id: string; name: string; isSystem: boolean }>;
}

export async function seedDefaultPermissionGroups(orgId: string): Promise<SeedResult> {
  const result: SeedResult = { created: 0, existing: 0, groups: [] };

  for (const tmpl of DEFAULT_PERMISSION_GROUPS) {
    // Idempotent: check by (orgId, name, isSystem)
    const existing = await prisma.permissionGroup.findFirst({
      where: { orgId, name: tmpl.name, isSystem: true },
      select: { id: true, name: true, isSystem: true },
    });
    if (existing) {
      result.existing++;
      result.groups.push(existing);
      continue;
    }

    const created = await prisma.permissionGroup.create({
      data: {
        id: randomUUID(),
        orgId,
        name: tmpl.name,
        isSystem: tmpl.isSystem,
        grants: tmpl.grants as object,
      },
      select: { id: true, name: true, isSystem: true },
    });
    result.created++;
    result.groups.push(created);
  }

  return result;
}

/**
 * Map legacy `users.role` → permission_group_id mới.
 * Dual-read window: code mới đọc cả 2, sau 2 tuần drop legacy role.
 */
export async function migrateLegacyUsersToPermissionGroups(orgId: string): Promise<{
  ownerCount: number;
  adminCount: number;
  memberCount: number;
}> {
  // Lấy ID của 3 group system mapping legacy role
  const [adminGrp, ceoGrp, saleGrp] = await Promise.all([
    prisma.permissionGroup.findFirst({ where: { orgId, name: 'Admin', isSystem: true }, select: { id: true } }),
    prisma.permissionGroup.findFirst({ where: { orgId, name: 'CEO', isSystem: true }, select: { id: true } }),
    prisma.permissionGroup.findFirst({ where: { orgId, name: 'Sale', isSystem: true }, select: { id: true } }),
  ]);
  if (!adminGrp || !ceoGrp || !saleGrp) {
    throw new Error('Default groups chưa seed — chạy seedDefaultPermissionGroups() trước');
  }

  // Migrate: owner → Admin, admin → CEO, member → Sale
  // Chỉ update user chưa có permission_group_id (idempotent)
  const [ownerRes, adminRes, memberRes] = await Promise.all([
    prisma.user.updateMany({
      where: { orgId, role: 'owner', permissionGroupId: null },
      data: { permissionGroupId: adminGrp.id },
    }),
    prisma.user.updateMany({
      where: { orgId, role: 'admin', permissionGroupId: null },
      data: { permissionGroupId: ceoGrp.id },
    }),
    prisma.user.updateMany({
      where: { orgId, role: 'member', permissionGroupId: null },
      data: { permissionGroupId: saleGrp.id },
    }),
  ]);

  return {
    ownerCount: ownerRes.count,
    adminCount: adminRes.count,
    memberCount: memberRes.count,
  };
}
