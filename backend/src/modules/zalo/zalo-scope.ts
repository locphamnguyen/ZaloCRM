// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo account scope helper — quyết định user được thấy nick nào.
 *
 * Quy tắc (anh chốt 2026-05-22):
 *   - role='owner' (Chủ tổ chức) → tất cả nick trong org
 *   - Trưởng phòng / Phó phòng của dept X → nick của user thuộc dept X + tất cả dept con
 *     (cascade theo dept tree materialized path)
 *   - Member thường → chỉ nick mà user là ownerUserId HOẶC được grant ZaloAccountAccess
 *
 * Output: array of zaloAccount IDs user được phép xem.
 * Caller dùng `where: { id: { in: ids }, orgId: ... }` để filter list.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface ZaloScope {
  /** Account IDs user được phép xem (read scope) — nick còn SỐNG (archivedAt=null). Dùng cho picker/gửi. */
  accessibleIds: string[];
  /**
   * 2026-06-20 (YC2): Account IDs user XEM được — gồm nick còn sống + nick ĐÃ XÓA-có-uid (đọc-only).
   * Loại nick-ma (zaloUid=null). Dùng cho list/detail chat (nick xóa vẫn hiện lịch sử).
   */
  displayableIds: string[];
  /** True nếu user có quyền manage org-wide (bulk actions, edit any) */
  isOrgAdmin: boolean;
  /** Set của account IDs mà user là owner (owns the nick) — dùng để gate Action buttons */
  ownedIds: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// T4 (YC2 2026-06-20) — 2 predicate Prisma DÙNG CHUNG cho lọc nick theo tầng NICK.
// CHỈ chạm cột ZaloAccount (archivedAt, zaloUid, status). TUYỆT ĐỐI KHÔNG đụng tầng
// FRIEND (Friend.relationshipKind='ghost') — trộn vào = lộ Friend-ma. Cũng KHÔNG nhúng
// orgId/ownerUserId/scope vào đây — caller tự AND thêm để giữ privacy + tenant.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Predicate "HIỂN THỊ ĐƯỢC" (đọc-only): nick còn sống HOẶC nick đã xóa nhưng ĐÃ TỪNG login
 * (zaloUid != null). Loại nick-ma (archivedAt != null mà zaloUid = null = chưa từng login).
 * Dùng cho list/detail chat. Nhúng relation: `zaloAccount: DISPLAYABLE_NICK_WHERE`.
 * Filter trực tiếp bảng ZaloAccount: `{ ...DISPLAYABLE_NICK_WHERE, orgId }`.
 */
export const DISPLAYABLE_NICK_WHERE: Prisma.ZaloAccountWhereInput = {
  OR: [
    { archivedAt: null },
    { archivedAt: { not: null }, zaloUid: { not: null } },
  ],
};

/** Predicate "GỬI ĐƯỢC": nick còn sống VÀ đang kết nối. */
export const ACTIVE_SEND_NICK_WHERE: Prisma.ZaloAccountWhereInput = {
  archivedAt: null,
  status: 'connected',
};

export async function getZaloScope(userId: string, orgId: string, legacyRole: string): Promise<ZaloScope> {
  const isOrgAdmin = legacyRole === 'owner' || legacyRole === 'admin';

  // Org admin → tất cả accounts (trừ nick đã xóa mềm).
  // 2026-06-10 FIX: lọc archivedAt → nick đã xóa KHÔNG còn trong accessibleIds, nên
  // mọi picker/màn hình dùng getZaloScope tự động hết pick được nick đã xóa.
  if (isOrgAdmin) {
    // T6 (YC2): lấy CẢ nick xóa-có-uid để XEM; accessibleIds (gửi) chỉ nick còn sống.
    const all = await prisma.zaloAccount.findMany({
      where: { orgId, ...DISPLAYABLE_NICK_WHERE },
      select: { id: true, ownerUserId: true, archivedAt: true },
    });
    return {
      displayableIds: all.map((a) => a.id),
      accessibleIds: all.filter((a) => a.archivedAt === null).map((a) => a.id),
      isOrgAdmin: true,
      ownedIds: new Set(all.filter((a) => a.ownerUserId === userId && a.archivedAt === null).map((a) => a.id)),
    };
  }

  // Load user's dept membership
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

  // Build set of "manageable" userIds (chính mình + nếu là leader/deputy thì + sale thuộc dept subtree)
  const visibleUserIds = new Set<string>([userId]);

  if (me?.departmentMember && (me.departmentMember.deptRole === 'leader' || me.departmentMember.deptRole === 'deputy')) {
    const myDept = me.departmentMember.department;
    // Find all descendant dept IDs via materialized path LIKE
    const subtreeDepts = await prisma.department.findMany({
      where: { orgId, path: { startsWith: myDept.path } },
      select: { id: true },
    });
    const subtreeDeptIds = subtreeDepts.map((d) => d.id);

    // All users in those depts
    const subtreeMembers = await prisma.departmentMember.findMany({
      where: { departmentId: { in: subtreeDeptIds } },
      select: { userId: true },
    });
    for (const m of subtreeMembers) visibleUserIds.add(m.userId);
  }

  // Accounts owned by any of visible users. T6 (YC2): lấy CẢ nick xóa-có-uid (DISPLAYABLE)
  // để XEM được; tách archivedAt=null cho accessibleIds (gửi). GIỮ NGUYÊN luật owner/dept.
  const ownedAccounts = await prisma.zaloAccount.findMany({
    where: { orgId, ownerUserId: { in: Array.from(visibleUserIds) }, ...DISPLAYABLE_NICK_WHERE },
    select: { id: true, ownerUserId: true, archivedAt: true },
  });

  // PLUS accounts user được grant access explicit (qua ZaloAccountAccess) — gồm nick xóa-có-uid.
  const grantedAccess = await prisma.zaloAccountAccess.findMany({
    where: { userId, zaloAccount: { orgId, ...DISPLAYABLE_NICK_WHERE } },
    select: { zaloAccountId: true, zaloAccount: { select: { archivedAt: true } } },
  });

  const displayableSet = new Set<string>();
  const accessibleSet = new Set<string>();
  for (const a of ownedAccounts) {
    displayableSet.add(a.id);
    if (a.archivedAt === null) accessibleSet.add(a.id);
  }
  for (const g of grantedAccess) {
    displayableSet.add(g.zaloAccountId);
    if (g.zaloAccount?.archivedAt === null) accessibleSet.add(g.zaloAccountId);
  }

  return {
    displayableIds: Array.from(displayableSet),
    accessibleIds: Array.from(accessibleSet),
    isOrgAdmin: false,
    // ownedIds = nick mình sở hữu CÒN SỐNG (gate action buttons) — loại nick đã xóa.
    ownedIds: new Set(ownedAccounts.filter((a) => a.ownerUserId === userId && a.archivedAt === null).map((a) => a.id)),
  };
}

/**
 * Quick check: user có quyền manage (edit/delete/disconnect) account này không?
 * Rule: owner-of-nick HOẶC org admin.
 */
export function canManageAccount(
  accountOwnerUserId: string | null,
  userId: string,
  legacyRole: string,
): boolean {
  if (legacyRole === 'owner' || legacyRole === 'admin') return true;
  return accountOwnerUserId === userId;
}

/**
 * Phase Zalo Account Mutation Gate 2026-05-27 — gate cho mọi mutation
 * (POST/PUT/PATCH/DELETE) trên `:id` của ZaloAccount.
 *
 * Quy tắc: chỉ OWNER của nick hoặc ORG admin/owner mới được mutate.
 * Trưởng phòng KHÔNG được delete/login/proxy nick cấp dưới (đọc OK qua
 * requireAccountVisible).
 *
 * Sử dụng trong Fastify route preHandler hoặc đầu handler:
 *   const account = await requireAccountManagement(request, reply, accountId);
 *   if (!account) return;  // reply đã send 401/403/404
 *
 * Trả về account row { id, ownerUserId, orgId, status, ... } nếu pass,
 * hoặc null nếu đã reply error (caller phải return ngay).
 */
export async function requireAccountManagement(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
): Promise<{ id: string; ownerUserId: string | null; orgId: string; status: string } | null> {
  const user = (request as any).user;
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  // NOTE: KHÔNG lọc archivedAt ở đây — gate này dùng cho cả route /restore (cần tìm
  // được nick đã archived để khôi phục). Việc "ẩn nick đã xóa khỏi list/picker" do
  // getZaloScope + các endpoint LIST lo (đã lọc archivedAt 2026-06-10).
  const account = await prisma.zaloAccount.findFirst({
    where: { id: accountId, orgId: user.orgId },
    select: { id: true, ownerUserId: true, orgId: true, status: true },
  });
  if (!account) {
    reply.status(404).send({ error: 'Account not found' });
    return null;
  }
  if (!canManageAccount(account.ownerUserId, user.id, user.role)) {
    reply.status(403).send({
      error: 'Bạn không có quyền thao tác trên nick này',
      code: 'not_account_owner',
    });
    return null;
  }
  return account;
}

/**
 * Phase Zalo Account Mutation Gate 2026-05-27 — gate cho mọi READ endpoint
 * trên `:id` (uptime, status, labels-overview, friends-db nick-id, ...).
 *
 * Quy tắc: id PHẢI thuộc `getZaloScope().accessibleIds` (owner + ACL grant +
 * dept-subtree cascade nếu leader/deputy). Khác với requireAccountManagement,
 * trưởng phòng ĐƯỢC đọc nick cấp dưới.
 */
export async function requireAccountVisible(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
): Promise<{ id: string; ownerUserId: string | null; orgId: string } | null> {
  const user = (request as any).user;
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  const account = await prisma.zaloAccount.findFirst({
    where: { id: accountId, orgId: user.orgId },
    select: { id: true, ownerUserId: true, orgId: true },
  });
  if (!account) {
    reply.status(404).send({ error: 'Account not found' });
    return null;
  }
  const scope = await getZaloScope(user.id, user.orgId, user.role);
  // T6 (YC2): dùng displayableIds để XEM (gồm nick xóa-có-uid đọc-only). Gửi vẫn gate riêng (T7/T7b).
  if (!scope.isOrgAdmin && !scope.displayableIds.includes(accountId)) {
    reply.status(403).send({
      error: 'Bạn không có quyền xem nick này',
      code: 'not_in_scope',
    });
    return null;
  }
  return account;
}

/**
 * T7b (YC2 2026-06-20) — lý do CHẶN GỬI qua 1 nick, dùng chung mọi cửa gửi (chat/attachment/
 * media/public-api/automation) để thông điệp + mã lỗi nhất quán. Thứ tự ưu tiên: nick đã XÓA
 * (archivedAt) trước → chưa kết nối sau. null = gửi được.
 */
export function nickSendBlockReason(
  acc: { archivedAt: Date | null; status: string },
): { code: string; message: string } | null {
  if (acc.archivedAt) {
    return { code: 'NICK_ARCHIVED', message: 'Nick này đã bị xóa — chỉ xem lại lịch sử, không gửi được. Kết nối lại nick để tiếp tục.' };
  }
  if (acc.status !== 'connected') {
    return { code: 'NICK_NOT_CONNECTED', message: 'Nick Zalo chưa kết nối.' };
  }
  return null;
}
