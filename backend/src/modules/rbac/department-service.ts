// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * department-service.ts — RBAC Phase Phân Quyền 2026-05-21
 *
 * Business logic cho Department tree (M2 Getfly Clone).
 * Reference: ~/.gstack/projects/zalocrm/thanh-rbac-m2-design-20260521.md
 *
 * Tree: max 5 level (depth 0-4). Materialized path auto-computed bởi Postgres
 * trigger trg_dept_recompute_path → query subtree bằng `path LIKE 'parent/%'`.
 *
 * Constraints enforced ở DB layer:
 * - 1 user ∈ 1 department (UNIQUE department_members.user_id)
 * - 1 leader + 1 deputy mỗi department (partial unique index)
 * - depth ≤ 4 (CHECK + trigger raise)
 * - Anti-cycle move (trigger raise nếu new parent nằm trong subtree)
 */
import { randomUUID } from 'node:crypto';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';

export type DeptRole = 'leader' | 'deputy' | 'member';

export interface DepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  displayOrder: number;
  archivedAt: Date | null;
  memberCount: number;
  leaderUserId: string | null;
  deputyUserId: string | null;
  children: DepartmentNode[];
}

/**
 * Get full department tree for an org, with member counts + leader/deputy ids.
 * Single query strategy: pull all departments + members, build tree in-memory.
 * Scale assumption: < 500 dept per org (HS = ~10-30).
 */
export async function getOrgDepartmentTree(orgId: string): Promise<DepartmentNode[]> {
  const [depts, members] = await Promise.all([
    prisma.department.findMany({
      where: { orgId, archivedAt: null },
      orderBy: [{ depth: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.departmentMember.findMany({
      where: { department: { orgId } },
      select: { departmentId: true, userId: true, deptRole: true },
    }),
  ]);

  // Index member info per dept
  const memberCount = new Map<string, number>();
  const leader = new Map<string, string>();
  const deputy = new Map<string, string>();
  for (const m of members) {
    memberCount.set(m.departmentId, (memberCount.get(m.departmentId) ?? 0) + 1);
    if (m.deptRole === 'leader') leader.set(m.departmentId, m.userId);
    else if (m.deptRole === 'deputy') deputy.set(m.departmentId, m.userId);
  }

  // Build node map
  const nodeMap = new Map<string, DepartmentNode>();
  for (const d of depts) {
    nodeMap.set(d.id, {
      id: d.id,
      name: d.name,
      parentId: d.parentId,
      path: d.path,
      depth: d.depth,
      displayOrder: d.displayOrder,
      archivedAt: d.archivedAt,
      memberCount: memberCount.get(d.id) ?? 0,
      leaderUserId: leader.get(d.id) ?? null,
      deputyUserId: deputy.get(d.id) ?? null,
      children: [],
    });
  }

  // Attach children
  const roots: DepartmentNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan (parent archived), promote to root
    }
  }
  return roots;
}

/**
 * Get subtree of a dept (including self).
 * Uses materialized path LIKE query → 1 indexed scan.
 */
export async function getDepartmentSubtree(orgId: string, deptId: string): Promise<string[]> {
  const root = await prisma.department.findFirst({
    where: { id: deptId, orgId },
    select: { id: true, path: true },
  });
  if (!root) return [];

  const subtree = await prisma.department.findMany({
    where: { orgId, path: { startsWith: root.path }, archivedAt: null },
    select: { id: true },
  });
  return subtree.map((d) => d.id);
}

export async function createDepartment(input: {
  orgId: string;
  name: string;
  parentId: string | null;
  displayOrder?: number;
}): Promise<{ id: string; name: string; path: string; depth: number }> {
  if (!input.name?.trim()) throw new Error('Tên phòng ban không được trống');
  if (input.name.length > 100) throw new Error('Tên phòng ban quá dài (>100 ký tự)');

  // FIX codex review #4: parent read + create cùng tx (atomic, không race).
  return await tenantTransaction(async (tx) => {
    const newId = randomUUID();
    let path = '/' + newId + '/';
    let depth = 0;

    if (input.parentId) {
      // Lock parent row trong tx (FOR UPDATE)
      const parentRows = await tx.$queryRawUnsafe<Array<{ id: string; depth: number; path: string }>>(
        `SELECT id, depth, path FROM departments
         WHERE id = $1 AND org_id = $2 AND archived_at IS NULL FOR UPDATE`,
        input.parentId,
        input.orgId,
      );
      const parent = parentRows[0];
      if (!parent) throw new Error('Phòng ban cha không tồn tại');
      if (parent.depth >= 4) throw new Error('Cây phòng ban đã max 5 level — không thể thêm con');
      path = parent.path + newId + '/';
      depth = parent.depth + 1;
    }

    const created = await tx.department.create({
      data: {
        id: newId,
        orgId: input.orgId,
        name: input.name.trim(),
        parentId: input.parentId,
        displayOrder: input.displayOrder ?? 0,
        path,
        depth,
      },
      select: { id: true, name: true, path: true, depth: true },
    });
    return created;
  });
}

export async function updateDepartment(input: {
  orgId: string;
  id: string;
  name?: string;
  parentId?: string | null;
  displayOrder?: number;
}): Promise<{ id: string; name: string; path: string; depth: number }> {
  if (input.parentId === input.id) {
    throw new Error('Phòng ban không thể là con của chính nó');
  }
  if (input.name !== undefined && !input.name?.trim()) {
    throw new Error('Tên phòng ban không được trống');
  }

  // FIX 2026-05-21: trigger Postgres bị Prisma db push drop. Logic recompute
  // path + cascade vào TS tx (transaction atomic, all-or-nothing).
  return await tenantTransaction(async (tx) => {
    const existing = await tx.department.findFirst({
      where: { id: input.id, orgId: input.orgId, archivedAt: null },
      select: { id: true, parentId: true, path: true, depth: true },
    });
    if (!existing) throw new Error('Phòng ban không tồn tại');

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;

    // Move case: đổi parent → recompute path + cascade
    const movingParent = input.parentId !== undefined && input.parentId !== existing.parentId;
    if (movingParent) {
      let newPath: string;
      let newDepth: number;
      if (input.parentId === null) {
        newPath = '/' + input.id + '/';
        newDepth = 0;
      } else {
        const parent = await tx.department.findFirst({
          where: { id: input.parentId!, orgId: input.orgId, archivedAt: null },
          select: { id: true, depth: true, path: true },
        });
        if (!parent) throw new Error('Phòng ban cha mới không tồn tại');
        // Anti-cycle: new parent không nằm trong subtree của self
        if (parent.path.startsWith(existing.path)) {
          throw new Error('Không thể move phòng ban vào trong subtree của chính nó');
        }
        if (parent.depth >= 4) throw new Error('Cây phòng ban đã max 5 level');
        newPath = parent.path + input.id + '/';
        newDepth = parent.depth + 1;
      }

      // Cascade update subtree: replace prefix old_path → new_path, adjust depth
      const depthDelta = newDepth - existing.depth;
      // Update self
      data.parentId = input.parentId;
      data.path = newPath;
      data.depth = newDepth;
      // Update descendants (everyone whose path starts with old self path, excluding self)
      // Postgres: UPDATE ... SET path = new_path || substring(path FROM length(old_path) + 1)
      await tx.$executeRawUnsafe(
        `UPDATE departments
         SET path = $1 || substring(path FROM $2),
             depth = depth + $3,
             updated_at = NOW()
         WHERE path LIKE $4 AND id != $5`,
        newPath,
        existing.path.length + 1,
        depthDelta,
        existing.path + '%',
        input.id,
      );
      // Check max depth của subtree sau cascade
      const overflow = await tx.department.findFirst({
        where: { orgId: input.orgId, path: { startsWith: newPath }, depth: { gt: 4 } },
        select: { id: true, depth: true },
      });
      if (overflow) {
        throw new Error('Move sẽ làm cây vượt 5 level — hủy thao tác');
      }
    }

    const updated = await tx.department.update({
      where: { id: input.id },
      data,
      select: { id: true, name: true, path: true, depth: true },
    });
    return updated;
  });
}

export async function archiveDepartment(orgId: string, id: string): Promise<void> {
  // FIX codex review #7: wrap count + archive trong 1 tx, lock dept row → tránh race.
  await tenantTransaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM departments
       WHERE id = $1 AND org_id = $2 AND archived_at IS NULL FOR UPDATE`,
      id,
      orgId,
    );
    if (rows.length === 0) throw new Error('Phòng ban không tồn tại');

    const memberCount = await tx.departmentMember.count({ where: { departmentId: id } });
    if (memberCount > 0) {
      throw new Error(`Phòng ban còn ${memberCount} thành viên — chuyển hết sang phòng khác trước khi xóa`);
    }
    const childCount = await tx.department.count({ where: { parentId: id, archivedAt: null } });
    if (childCount > 0) {
      throw new Error(`Phòng ban còn ${childCount} phòng ban con — xóa hoặc move các phòng con trước`);
    }

    await tx.department.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  });
}

/**
 * Assign user vào dept (1 user ∈ 1 dept).
 * Nếu user đang ở dept khác → move (auto remove old DepartmentMember row vì UNIQUE).
 */
export async function assignUserToDepartment(input: {
  orgId: string;
  departmentId: string;
  userId: string;
  deptRole: DeptRole;
}): Promise<void> {
  // Validate dept trong org
  const dept = await prisma.department.findFirst({
    where: { id: input.departmentId, orgId: input.orgId, archivedAt: null },
    select: { id: true },
  });
  if (!dept) throw new Error('Phòng ban không tồn tại');

  // Validate user trong org
  const user = await prisma.user.findFirst({
    where: { id: input.userId, orgId: input.orgId },
    select: { id: true },
  });
  if (!user) throw new Error('User không tồn tại trong tổ chức');

  // Pre-check uniqueness leader/deputy (2026-05-22 anh chốt BLOCK semantic):
  // Trước fix: 2 UI (Sơ đồ tổ chức + Chi tiết NV) đều cho phép gán dup vì
  // DB partial unique index bị drift. Giờ DB đã có index (migration 20260522)
  // → upsert sẽ throw P2002. Em pre-check để trả error message rõ ràng kèm
  // tên người đang giữ chức vụ thay vì raw P2002 generic.
  if (input.deptRole === 'leader' || input.deptRole === 'deputy') {
    const existing = await prisma.departmentMember.findFirst({
      where: {
        departmentId: input.departmentId,
        deptRole: input.deptRole,
        userId: { not: input.userId },
      },
      select: {
        userId: true,
        user: { select: { fullName: true, email: true } },
      },
    });
    if (existing) {
      const which = input.deptRole === 'leader' ? 'Trưởng phòng' : 'Phó phòng';
      const name = existing.user.fullName || existing.user.email;
      throw new Error(
        `Vị trí ${which} đã được bổ nhiệm cho ${name} — bỏ chức vụ của họ trước khi gán cho người khác`,
      );
    }
  }

  // Upsert (UNIQUE user_id sẽ trigger delete-then-create dạng move)
  await prisma.departmentMember.upsert({
    where: { userId: input.userId },
    update: { departmentId: input.departmentId, deptRole: input.deptRole },
    create: {
      id: randomUUID(),
      departmentId: input.departmentId,
      userId: input.userId,
      deptRole: input.deptRole,
    },
  });
}

export async function removeUserFromDepartment(orgId: string, userId: string, deptId?: string): Promise<void> {
  // Sanity: ensure user ∈ org
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: { id: true },
  });
  if (!user) throw new Error('User không tồn tại trong tổ chức');

  // FIX codex review #6: nếu caller pass deptId → enforce user ĐANG ở dept đó
  // Tránh trick "delete /departments/random/members/userX" remove user khỏi dept thật
  if (deptId) {
    const dept = await prisma.department.findFirst({
      where: { id: deptId, orgId },
      select: { id: true },
    });
    if (!dept) throw new Error('Phòng ban không tồn tại');
    await prisma.departmentMember.deleteMany({ where: { userId, departmentId: deptId } });
    return;
  }

  await prisma.departmentMember.deleteMany({ where: { userId } });
}

/**
 * Get users trực thuộc 1 dept + tất cả sub-depts (theo materialized path).
 * Dùng trong RBAC scope check: leader xem được KH của ai dưới quyền.
 */
export async function getUsersUnderDepartment(orgId: string, deptId: string): Promise<string[]> {
  const subtreeIds = await getDepartmentSubtree(orgId, deptId);
  if (subtreeIds.length === 0) return [];

  const members = await prisma.departmentMember.findMany({
    where: { departmentId: { in: subtreeIds } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/**
 * Get dept của 1 user (1 user ∈ 1 dept hoặc null nếu chưa assigned).
 */
export async function getUserDepartment(userId: string): Promise<{
  departmentId: string;
  deptRole: DeptRole;
} | null> {
  const m = await prisma.departmentMember.findUnique({
    where: { userId },
    select: { departmentId: true, deptRole: true },
  });
  return m ? { departmentId: m.departmentId, deptRole: m.deptRole as DeptRole } : null;
}

/**
 * Resolve "quản lý trực tiếp" của 1 user theo sơ đồ tổ chức (CareSession notify
 * manager — 2026-06-07). Dùng cho thông báo "để biết" tới cấp trên.
 *
 * Quy tắc (cha xem con):
 *   - User là member/deputy của dept D → manager = leader của D.
 *   - User là leader của dept D → manager = leader của dept CHA của D (lên 1 cấp).
 *   - Không có cha hoặc cha không có leader → null (không gửi manager).
 *
 * @returns userId của manager, hoặc null.
 */
export async function getManagerOfUser(userId: string): Promise<string | null> {
  const m = await prisma.departmentMember.findUnique({
    where: { userId },
    select: { departmentId: true, deptRole: true },
  });
  if (!m) return null;

  // member/deputy → leader của chính dept này.
  if (m.deptRole !== 'leader') {
    const leader = await prisma.departmentMember.findFirst({
      where: { departmentId: m.departmentId, deptRole: 'leader' },
      select: { userId: true },
    });
    if (leader && leader.userId !== userId) return leader.userId;
  }

  // leader (hoặc dept không có leader khác) → lên dept cha.
  const dept = await prisma.department.findUnique({
    where: { id: m.departmentId },
    select: { parentId: true },
  });
  if (!dept?.parentId) return null;

  const parentLeader = await prisma.departmentMember.findFirst({
    where: { departmentId: dept.parentId, deptRole: 'leader' },
    select: { userId: true },
  });
  return parentLeader && parentLeader.userId !== userId ? parentLeader.userId : null;
}
