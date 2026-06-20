// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * user-create-with-zalo-routes.ts — Phase user-create-with-zalo 2026-05-27
 *
 * 3 endpoint cho flow Admin tạo user gộp Zalo handshake:
 *   POST /api/v1/users/check-zalo-by-phone
 *   POST /api/v1/users/create-with-zalo
 *   POST /api/v1/users/:userId/resend-credentials
 *
 * Tất cả routes gate qua requireGrant theo nhóm quyền (resource 'user').
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import {
  UserCreateWithZaloError,
  checkZaloByPhone,
  createUserAndSendLogin,
  resendLoginMessage,
} from './user-create-with-zalo-service.js';

export async function userCreateWithZaloRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.post(
    '/api/v1/users/check-zalo-by-phone',
    { preHandler: requireGrant('user', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const body = (request.body ?? {}) as { phone?: string };
      if (!body.phone) {
        return reply.status(400).send({ error: 'phone bắt buộc' });
      }
      const result = await checkZaloByPhone({
        orgId: currentUser.orgId,
        currentUserId: currentUser.id,
        phone: body.phone,
      });
      if (result.error) {
        return reply.status(400).send(result);
      }
      return result;
    },
  );

  app.post(
    '/api/v1/users/create-with-zalo',
    { preHandler: requireGrant('user', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const body = (request.body ?? {}) as {
        fullName?: string;
        phone?: string;
        email?: string | null;
        departmentId?: string | null;
        permissionGroupId?: string | null;
        role?: string;
        confirmedUid?: string;
      };

      if (!body.fullName || !body.phone || !body.confirmedUid) {
        return reply.status(400).send({
          error: 'Thiếu field: fullName, phone, confirmedUid đều bắt buộc',
        });
      }
      if (body.role === 'owner') {
        return reply.status(400).send({ error: 'Không thể tạo thêm owner' });
      }
      if (body.role === 'admin' && currentUser.role !== 'owner') {
        return reply.status(403).send({ error: 'Chỉ owner có thể tạo admin' });
      }

      try {
        const result = await createUserAndSendLogin({
          orgId: currentUser.orgId,
          currentUserId: currentUser.id,
          fullName: body.fullName,
          phone: body.phone,
          email: body.email ?? null,
          departmentId: body.departmentId ?? null,
          permissionGroupId: body.permissionGroupId ?? null,
          role: body.role ?? 'member',
          confirmedUid: body.confirmedUid,
        });
        return result;
      } catch (err) {
        if (err instanceof UserCreateWithZaloError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
        }
        throw err;
      }
    },
  );

  app.post(
    '/api/v1/users/:userId/resend-credentials',
    { preHandler: requireGrant('user', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const { userId } = request.params as { userId: string };

      try {
        const result = await resendLoginMessage({
          orgId: currentUser.orgId,
          currentUserId: currentUser.id,
          targetUserId: userId,
        });
        return result;
      } catch (err) {
        if (err instanceof UserCreateWithZaloError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
        }
        throw err;
      }
    },
  );
}
