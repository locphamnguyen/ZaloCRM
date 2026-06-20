// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * push-targets.ts — resolve danh sách userId được phép nhận push cho 1 nick Zalo.
 *
 * Reverse của getZaloScope (zalo-scope.ts): getZaloScope nhận 1 user → trả các nick;
 * ở đây ta cần ngược lại — từ 1 nick → các user được phép xem nó, để biết bắn push cho ai.
 *
 * Policy khớp với getZaloScope (KHÔNG nới rộng hơn):
 *   - owner của nick (ownerUserId)
 *   - user được grant explicit qua ZaloAccountAccess
 *   - org admin (User.role ∈ {owner, admin}) — vì getZaloScope cho org admin thấy MỌI nick
 *
 * Lưu ý: KHÔNG đưa dept-leader/deputy cascade vào đây. Cascade trong getZaloScope dựa trên
 * "user là leader của dept chứa owner nick"; tính reverse rất tốn query và yêu cầu gốc chỉ
 * cần owner ∪ ACL ∪ org-admin. Giữ KISS, fail-closed (chỉ người chắc chắn có quyền).
 */
import { prisma } from '../../shared/database/prisma-client.js';

export async function resolvePushTargetUserIds(
  zaloAccountId: string,
  orgId: string,
  excludeUserId?: string | null,
): Promise<string[]> {
  const targets = new Set<string>();

  // 1. Owner của nick.
  const account = await prisma.zaloAccount.findFirst({
    where: { id: zaloAccountId, orgId },
    select: { ownerUserId: true },
  });
  if (account?.ownerUserId) targets.add(account.ownerUserId);

  // 2. User được grant explicit qua ZaloAccountAccess.
  const grants = await prisma.zaloAccountAccess.findMany({
    where: { zaloAccountId, user: { orgId } },
    select: { userId: true },
  });
  for (const g of grants) targets.add(g.userId);

  // 3. Org admin (owner/admin) — getZaloScope cho họ thấy tất cả nick.
  const admins = await prisma.user.findMany({
    where: { orgId, role: { in: ['owner', 'admin'] } },
    select: { id: true },
  });
  for (const a of admins) targets.add(a.id);

  if (excludeUserId) targets.delete(excludeUserId);
  return Array.from(targets);
}
