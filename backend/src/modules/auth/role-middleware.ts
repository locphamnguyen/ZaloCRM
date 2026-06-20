// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Role middleware — factory that returns a preHandler checking user role.
 * Usage: { preHandler: [authMiddleware, requireRole('owner', 'admin')] }
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

// Returns a preHandler that rejects requests unless the user has one of the specified roles
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      return reply.status(403).send({ error: 'Không có quyền truy cập' });
    }
  };
}
