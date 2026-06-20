// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo access middleware — checks if user has sufficient permission on a Zalo account.
 * Permission hierarchy: admin > chat > read.
 * Owner/admin roles bypass the check (they have access to all accounts in their org).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

type Permission = 'read' | 'chat' | 'admin';

const hierarchy: Record<Permission, number> = { read: 1, chat: 2, admin: 3 };

// 2026-06-18 — Lõi kiểm quyền THUẦN (không phụ thuộc HTTP req). Tách ra để dùng chung
// cho middleware HTTP LẪN cầu Telegram (gọi ngoài request — Phase 2). Trả mã kết quả để
// caller map lỗi phù hợp. Cùng quy tắc với middleware cũ (DRY, không phát minh lại).
//   'ok'           — đủ quyền
//   'no_grant'     — không có grant ZaloAccountAccess
//   'insufficient' — có grant nhưng thấp hơn minPermission
export type ZaloAccessResult = 'ok' | 'no_grant' | 'insufficient';

export async function checkZaloAccess(args: {
  userId: string;
  orgId: string;
  role: string;
  zaloAccountId: string;
  minPermission: Permission;
}): Promise<ZaloAccessResult> {
  const { userId, orgId, role, zaloAccountId, minPermission } = args;

  // Owner/admin org → full access mọi nick trong org.
  if (['owner', 'admin'].includes(role)) return 'ok';

  // Fix 2026-06-07: CHÍNH CHỦ nick (ownerUserId) luôn full quyền — kể cả role 'member'.
  const account = await prisma.zaloAccount.findFirst({
    where: { id: zaloAccountId, orgId },
    select: { ownerUserId: true },
  });
  if (account?.ownerUserId === userId) return 'ok';

  const access = await prisma.zaloAccountAccess.findFirst({
    where: { zaloAccountId, userId },
  });
  if (!access) return 'no_grant';

  const userLevel = hierarchy[access.permission as Permission] ?? 0;
  return userLevel >= hierarchy[minPermission] ? 'ok' : 'insufficient';
}

// Tiện ích boolean cho caller chỉ cần đúng/sai (vd cầu Telegram khi sale gửi từ Telegram).
export async function hasZaloAccess(args: {
  userId: string;
  orgId: string;
  role: string;
  zaloAccountId: string;
  minPermission: Permission;
}): Promise<boolean> {
  return (await checkZaloAccess(args)) === 'ok';
}

// Factory: preHandler HTTP — GIỮ NGUYÊN hành vi cũ (resolve accountId từ params/conversation,
// 404/403/500, đúng 2 thông báo 403 như trước), nay ủy quyết định cho checkZaloAccess.
export function requireZaloAccess(minPermission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;

    // Owner/admin bypass — full access to all accounts in their org
    if (['owner', 'admin'].includes(user.role)) return;

    const params = request.params as Record<string, string>;
    let zaloAccountId = params.zaloAccountId || params.id;

    // If accessing via conversation, look up the Zalo account from the conversation
    if (params.id && !params.zaloAccountId) {
      try {
        const conv = await prisma.conversation.findFirst({
          where: { id: params.id, orgId: user.orgId },
          select: { zaloAccountId: true },
        });
        if (conv) zaloAccountId = conv.zaloAccountId;
      } catch {
        return reply.status(500).send({ error: 'Internal error checking access' });
      }
    }

    if (!zaloAccountId) return reply.status(404).send({ error: 'Not found' });

    try {
      const result = await checkZaloAccess({
        userId: user.id,
        orgId: user.orgId,
        role: user.role,
        zaloAccountId,
        minPermission,
      });
      if (result === 'no_grant') {
        return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      }
      if (result === 'insufficient') {
        return reply.status(403).send({ error: 'Không đủ quyền' });
      }
    } catch {
      return reply.status(500).send({ error: 'Internal error checking access' });
    }
  };
}
