// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * rbac-middleware.ts — RBAC Phase Phân Quyền 2026-05-21
 *
 * Reusable middleware factories cho RBAC check trên Fastify routes.
 * Dùng anywhere thay vì duplicate trong từng routes file.
 *
 * Usage:
 *   app.delete('/api/v1/contacts/:id', {
 *     preHandler: [authMiddleware, requireGrant('contact', 'delete')]
 *   }, handler);
 *
 * Privacy integration (D8 design):
 *   Reply payload từ endpoint có contentClass='content' sẽ được Privacy phase
 *   middleware redact main-nick content. RBAC layer 1, Privacy layer 2.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { userHasGrant } from './permission-group-service.js';
import { RESOURCES, ACTIONS, type Resource, type Action } from './permission-types.js';

/**
 * Require user có grant cho (resource, action). 403 nếu không.
 * Fallback legacy `role='owner'` → bypass (dual-read window 2 tuần).
 */
export function requireGrant(resource: Resource, action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const allowed = await userHasGrant(user.userId ?? user.id, resource, action);
    if (!allowed) {
      return reply.status(403).send({
        error: `Bạn không có quyền ${action} trên ${resource}`,
        code: 'RBAC_FORBIDDEN',
        resource,
        action,
      });
    }
  };
}

/**
 * Require ANY of grants (OR semantics).
 * VD: user phải có (contact.view_all OR contact.edit) để xem conversation list.
 */
export function requireAnyGrant(...checks: Array<[Resource, Action]>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const userId = user.userId ?? user.id;
    for (const [r, a] of checks) {
      if (await userHasGrant(userId, r, a)) return; // pass
    }
    return reply.status(403).send({
      error: `Bạn không có quyền truy cập (yêu cầu một trong: ${checks.map(([r, a]) => `${r}.${a}`).join(', ')})`,
      code: 'RBAC_FORBIDDEN',
    });
  };
}

/**
 * Content classifier annotation cho Privacy phase integration.
 *
 * Sử dụng qua Fastify route config:
 *   app.get('/api/v1/messages/:id', {
 *     config: { contentClass: 'content' }
 *   }, handler);
 *
 * Privacy middleware (sẽ ship Privacy phase) đọc config này để quyết định
 * có redact main-nick content hay không.
 */
export type ContentClass = 'content' | 'metadata' | 'mixed';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Privacy phase integration: 'content' redact, 'metadata' không, 'mixed' field-level */
    contentClass?: ContentClass;
    /** RBAC resource/action hint cho audit log */
    rbacResource?: Resource;
    rbacAction?: Action;
  }
}

/**
 * Sanity check: log mọi route đã setup contentClass + RBAC grant.
 * Chạy 1 lần khi app start để verify ~50 endpoint đều có annotation.
 */
export function logRouteAuditCoverage(app: any): void {
  // Sẽ implement khi Fastify provide route inspection API
  // Hiện tại: developer phải tự check qua grep
}

/** Re-export types để các route file dùng */
export { RESOURCES, ACTIONS };
export type { Resource, Action };
