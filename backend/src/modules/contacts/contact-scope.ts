// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * contact-scope.ts — quyết định user được thấy KH (Contact) nào.
 *
 * Phase Contact Scope Hybrid 2026-05-27. Mirror cấu trúc zalo-scope.ts.
 *
 * Quy tắc (anh chốt 2026-05-27):
 *   - role='owner'/'admin' (Chủ tổ chức / quản trị) → MỌI Contact trong org (full view, không scope)
 *   - Trưởng phòng / Phó phòng của dept X → MỌI Contact có ContactAccess.userId thuộc dept X
 *     + tất cả dept con (cascade theo dept tree materialized path)
 *   - Member thường (Sale) → CHỈ Contact mà user là primary owner HOẶC collaborator
 *     trong bảng ContactAccess. Collaborator auto-tạo khi sale có Friend row qua nick mình
 *     (hook applyFriendAggregate / handshake).
 *
 * Output: `accessibleContactIds` để inject vào Prisma `where: { id: { in: ... } }`.
 * Lưu ý: org-admin trả `isOrgAdmin=true` + `accessibleContactIds=null` (caller bỏ filter).
 */
import { prisma } from '../../shared/database/prisma-client.js';

export interface ContactScope {
  /** True nếu user có quyền view toàn org (skip filter) */
  isOrgAdmin: boolean;
  /** Set userIds mà KH gán cho họ user này được thấy (chính mình + dept-subtree members nếu leader) */
  visibleUserIds: Set<string>;
  /**
   * accessibleContactIds:
   *   - null nếu isOrgAdmin = true (skip filter, see all org)
   *   - array of contact IDs nếu user là sale/manager (apply via `where: { id: { in: ids } }`)
   */
  accessibleContactIds: string[] | null;
  /** Set contactIds mà user là primary owner — dùng để badge "Phụ trách chính" */
  primaryContactIds: Set<string>;
}

/**
 * Compute contact scope cho user. Sử dụng trong moi route trả về Contact data.
 */
export async function getContactScope(
  userId: string,
  orgId: string,
  legacyRole: string,
): Promise<ContactScope> {
  const isOrgAdmin = legacyRole === 'owner' || legacyRole === 'admin';

  // Org admin → skip filter, see all
  if (isOrgAdmin) {
    return {
      isOrgAdmin: true,
      visibleUserIds: new Set<string>(),
      accessibleContactIds: null,
      primaryContactIds: new Set<string>(),
    };
  }

  // Load user dept-membership (replicate logic zalo-scope.ts)
  const me = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: {
      id: true,
      departmentMember: {
        select: {
          deptRole: true,
          departmentId: true,
          department: { select: { id: true, path: true } },
        },
      },
    },
  });

  // Build visibleUserIds: self + (if leader/deputy) all members of dept subtree
  const visibleUserIds = new Set<string>([userId]);
  if (
    me?.departmentMember &&
    (me.departmentMember.deptRole === 'leader' || me.departmentMember.deptRole === 'deputy')
  ) {
    const myDept = me.departmentMember.department;
    const subtreeDepts = await prisma.department.findMany({
      where: { orgId, path: { startsWith: myDept.path } },
      select: { id: true },
    });
    const subtreeDeptIds = subtreeDepts.map((d) => d.id);
    const subtreeMembers = await prisma.departmentMember.findMany({
      where: { departmentId: { in: subtreeDeptIds } },
      select: { userId: true },
    });
    for (const m of subtreeMembers) visibleUserIds.add(m.userId);
  }

  // Resolve accessibleContactIds via ContactAccess for any user in visibleUserIds.
  // Manager → union của primary+collaborator của mọi sale dưới nhánh.
  // Sale → chỉ mình → union primary+collaborator của chính mình.
  const accessRows = await prisma.contactAccess.findMany({
    where: { orgId, userId: { in: Array.from(visibleUserIds) } },
    select: { contactId: true, userId: true, role: true },
  });

  const accessibleContactIds = Array.from(new Set(accessRows.map((r) => r.contactId)));
  const primaryContactIds = new Set(
    accessRows.filter((r) => r.userId === userId && r.role === 'primary').map((r) => r.contactId),
  );

  return {
    isOrgAdmin: false,
    visibleUserIds,
    accessibleContactIds,
    primaryContactIds,
  };
}

/**
 * Quick gate cho route detail/sub-resource: user có quyền access Contact này không?
 * Throws/returns false nếu không. Dùng đầu mỗi handler `GET /contacts/:id/*`.
 */
export async function assertContactVisible(args: {
  userId: string;
  orgId: string;
  legacyRole: string;
  contactId: string;
}): Promise<boolean> {
  if (args.legacyRole === 'owner' || args.legacyRole === 'admin') return true;
  // Cheap path: 1 query check ContactAccess. Manager cascade qua getContactScope path.
  const direct = await prisma.contactAccess.findUnique({
    where: { contactId_userId: { contactId: args.contactId, userId: args.userId } },
    select: { id: true },
  });
  if (direct) return true;

  // Cascade path: nếu là leader/deputy thì check Contact thuộc subordinate
  const scope = await getContactScope(args.userId, args.orgId, args.legacyRole);
  if (scope.accessibleContactIds === null) return true; // shouldn't happen given above branch
  return scope.accessibleContactIds.includes(args.contactId);
}

/**
 * Auto-share hook: khi Friend row tạo mới (handshake hoặc applyFriendAggregate first-message)
 * → upsert ContactAccess role=collaborator cho owner của ZaloAccount đó.
 *
 * Idempotent qua unique (contactId, userId). KHÔNG override role=primary nếu đã có
 * (sale primary chăm nick chính giữ primary; nick phụ chỉ là collaborator).
 *
 * Best-effort: nuốt error để không block message flow.
 */
export async function ensureContactCollaborator(args: {
  orgId: string;
  contactId: string;
  zaloAccountId: string;
}): Promise<void> {
  try {
    const account = await prisma.zaloAccount.findUnique({
      where: { id: args.zaloAccountId },
      select: { ownerUserId: true, orgId: true },
    });
    if (!account?.ownerUserId) return;
    if (account.orgId !== args.orgId) return;

    await prisma.contactAccess.upsert({
      where: { contactId_userId: { contactId: args.contactId, userId: account.ownerUserId } },
      update: {}, // no-op nếu đã có (giữ role primary nếu đang là primary)
      create: {
        orgId: args.orgId,
        contactId: args.contactId,
        userId: account.ownerUserId,
        role: 'collaborator',
        source: 'auto_from_friend',
      },
    });
  } catch {
    // best-effort, nuốt lỗi
  }
}

/**
 * M55 2026-05-30: Attach ContactAccess.collaborator theo userId trực tiếp.
 * Dùng khi sale touch KH no-Zalo (add trùng SĐT, mở virtual chat, gửi tin
 * trong virtual conv). Idempotent — skip nếu user đã là primary hoặc đã
 * có ContactAccess. Best-effort: nuốt lỗi để không block flow.
 */
export async function attachContactCollaboratorByUser(args: {
  orgId: string;
  contactId: string;
  userId: string;
  source: string; // 'quick_add_duplicate' | 'virtual_chat_open' | 'virtual_chat_message' | ...
}): Promise<void> {
  try {
    // Check user thuộc org
    const user = await prisma.user.findFirst({
      where: { id: args.userId, orgId: args.orgId },
      select: { id: true },
    });
    if (!user) return;

    // Idempotent upsert — giữ role primary nếu đã có
    const result = await prisma.contactAccess.upsert({
      where: { contactId_userId: { contactId: args.contactId, userId: args.userId } },
      update: {}, // no-op
      create: {
        orgId: args.orgId,
        contactId: args.contactId,
        userId: args.userId,
        role: 'collaborator',
        source: args.source,
      },
    });

    // M57 v2 2026-06-01: trigger recompute auto-tag "Cùng chăm" sau khi
    // ContactAccess count có thể đổi. Fire-and-forget, không block flow.
    if (result) {
      void (async () => {
        try {
          const { recomputeCungChamTag } = await import('../tags/cung-cham-tag-service.js');
          await recomputeCungChamTag(args.contactId);
        } catch {
          /* best-effort */
        }
      })();
    }
  } catch {
    // best-effort
  }
}

/**
 * M55 2026-05-30: Kiểm tra user có quyền EDIT contact không.
 * Org admin/owner luôn pass. User khác phải có ContactAccess (role
 * primary hoặc collaborator). Throw 403 nếu không có quyền.
 */
export async function assertContactEditable(args: {
  userId: string;
  orgId: string;
  legacyRole: string;
  contactId: string;
}): Promise<void> {
  // Org admin/owner luôn có quyền
  if (args.legacyRole === 'owner' || args.legacyRole === 'admin') return;

  // Check ContactAccess
  const access = await prisma.contactAccess.findUnique({
    where: { contactId_userId: { contactId: args.contactId, userId: args.userId } },
    select: { role: true },
  });

  if (!access) {
    const err = new Error('KH này không thuộc danh sách chăm của bạn — không thể sửa thông tin');
    (err as any).statusCode = 403;
    (err as any).code = 'CONTACT_EDIT_FORBIDDEN';
    throw err;
  }
  // primary + collaborator đều full-edit như nhau (M55: không phân quyền theo role)
}
