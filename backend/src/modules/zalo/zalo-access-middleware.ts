/**
 * Zalo access middleware — checks if user has sufficient permission on a Zalo account.
 * Permission hierarchy: admin > chat > read.
 * Owner/admin roles bypass the check (they have access to all accounts in their org).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';

type Permission = 'read' | 'chat' | 'admin';

const hierarchy: Record<Permission, number> = { read: 1, chat: 2, admin: 3 };

// Factory: returns a preHandler that checks the user has at least minPermission on the Zalo account
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
      // Fix 2026-06-07: CHÍNH CHỦ nick (ownerUserId) luôn có full access — kể cả role 'member'.
      // Trước đây chỉ bypass theo ROLE owner/admin + check ZaloAccountAccess grant → sale member
      // owner nick (vd Đức owner Evo Sport) KHÔNG có grant record → bị 403 ở cột 3 messages +
      // không gửi được tin, dù route conversation LIST (getZaloScope) đã cho thấy owner.
      const account = await prisma.zaloAccount.findFirst({
        where: { id: zaloAccountId, orgId: user.orgId },
        select: { ownerUserId: true },
      });
      if (account?.ownerUserId === user.id) return; // owner nick → full quyền

      const access = await prisma.zaloAccountAccess.findFirst({
        where: { zaloAccountId, userId: user.id },
      });

      if (!access) {
        return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      }

      const userLevel = hierarchy[access.permission as Permission] ?? 0;
      if (userLevel < hierarchy[minPermission]) {
        return reply.status(403).send({ error: 'Không đủ quyền' });
      }
    } catch {
      return reply.status(500).send({ error: 'Internal error checking access' });
    }
  };
}
