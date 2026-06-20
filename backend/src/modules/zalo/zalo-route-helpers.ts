// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-route-helpers.ts — Shared helpers for Zalo route handlers.
 * Account resolution, permission checking, and error handling.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ZaloOpError } from '../../shared/zalo-operations.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export type Permission = 'read' | 'chat' | 'admin';
const hierarchy: Record<Permission, number> = { read: 1, chat: 2, admin: 3 };

/** Validate accountId belongs to user's org, throw 404 if not */
export async function resolveAccount(accountId: string, orgId: string) {
  const account = await prisma.zaloAccount.findFirst({ where: { id: accountId, orgId } });
  if (!account) throw new ZaloOpError('Account not found', 'INVALID_PARAMS', 404);
  return account;
}

/** Check user has sufficient permission on the Zalo account. Returns false and sends reply if denied. */
export async function checkAccess(request: FastifyRequest, reply: FastifyReply, accountId: string, minPermission: Permission): Promise<boolean> {
  const user = request.user!;
  if (['owner', 'admin'].includes(user.role)) return true;

  try {
    const access = await prisma.zaloAccountAccess.findFirst({
      where: { zaloAccountId: accountId, userId: user.id },
    });
    if (!access) {
      reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      return false;
    }
    const userLevel = hierarchy[access.permission as Permission] ?? 0;
    if (userLevel < hierarchy[minPermission]) {
      reply.status(403).send({ error: 'Không đủ quyền' });
      return false;
    }
  } catch {
    reply.status(500).send({ error: 'Internal error checking access' });
    return false;
  }
  return true;
}

/**
 * B3 fix — Get all Zalo account IDs current user has access to, in the same
 * hierarchy as checkAccess: owner/admin role → ALL accounts trong org;
 * non-admin → explicit ZaloAccountAccess rows + accounts user own.
 *
 * Reuse cho /friends-db/all-nicks (cross-nick aggregate FE) để admin nhìn được
 * toàn bộ nick org thay vì chỉ owned/explicit access (Codex flagged: admin all-nicks
 * incomplete).
 */
export async function getAccessibleZaloAccountIds(user: {
  id: string;
  orgId: string;
  role: string;
}): Promise<string[]> {
  // Owner/admin: tất cả nick trong org
  if (['owner', 'admin'].includes(user.role)) {
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: { id: true },
    });
    return accounts.map((a) => a.id);
  }
  // Non-admin: union explicit ACL + owned
  const [accessRows, ownedRows] = await Promise.all([
    prisma.zaloAccountAccess.findMany({
      where: { userId: user.id, zaloAccount: { orgId: user.orgId } },
      select: { zaloAccountId: true },
    }),
    prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, ownerUserId: user.id },
      select: { id: true },
    }),
  ]);
  return [
    ...new Set([
      ...accessRows.map((r) => r.zaloAccountId),
      ...ownedRows.map((r) => r.id),
    ]),
  ];
}

/** Map ZaloOpError to HTTP response, fallback 500 for unknown errors */
export function handleError(reply: FastifyReply, err: unknown, op: string) {
  if (err instanceof ZaloOpError) {
    return reply.status(err.statusCode).send({ error: err.message, code: err.code });
  }
  logger.error(`[zalo-routes] ${op} failed:`, err);
  return reply.status(500).send({ error: 'Internal server error' });
}
