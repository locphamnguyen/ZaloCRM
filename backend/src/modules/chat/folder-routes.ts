// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * folder-routes.ts — Account Folder CRUD cho Inbox Triage Filter (Phase 6+).
 *
 * Folder = gom 2-3 ZaloAccount thành 1 "thư mục" per-user.
 * UI Cột 1 Smax-style flat list: mỗi folder hiện composite avatar + name + count.
 *
 * Endpoints:
 *   GET    /api/v1/account-folders          — list folder của user, kèm members
 *   POST   /api/v1/account-folders          — tạo folder + assign members
 *   PUT    /api/v1/account-folders/:id      — đổi tên/màu/order
 *   DELETE /api/v1/account-folders/:id      — xoá folder (cascade members)
 *   PUT    /api/v1/account-folders/:id/members — replace toàn bộ members
 *   POST   /api/v1/account-folders/reorder  — drag-drop sắp xếp
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /account-folders ────────────────────────────────────────────────
  app.get('/api/v1/account-folders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      // 2026-06-11 — số đếm folder cột 1 lọc theo CÙNG key tab đang chọn (Cá nhân/
      // Nhóm/Chính/Ưu tiên) để các bộ lọc link với nhau (anh chốt). Cá nhân/Nhóm
      // (threadType) loại trừ hội thoại đã chuyển Ưu tiên (mặc định tab=main).
      const { threadType = '', tab = '' } = request.query as { threadType?: string; tab?: string };
      const tabCountWhere: Record<string, unknown> = {};
      if (tab) tabCountWhere.tab = tab;
      if (threadType === 'user' || threadType === 'group') {
        tabCountWhere.threadType = threadType;
        if (!tab) tabCountWhere.tab = 'main';
      }
      const folders = await prisma.accountFolder.findMany({
        where: { userId: user.id, orgId: user.orgId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          members: {
            include: {
              zaloAccount: {
                select: {
                  id: true,
                  zaloUid: true,
                  displayName: true,
                  avatarUrl: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      // Hydrate counts per folder (unread + total conv)
      const folderIds = folders.map((f) => f.id);
      const counts: Record<string, { unread: number; total: number }> = {};

      for (const f of folders) {
        const accountIds = f.members.map((m) => m.zaloAccountId);
        if (accountIds.length === 0) {
          counts[f.id] = { unread: 0, total: 0 };
          continue;
        }
        // Lấy aggregate cho tất cả account trong folder (lọc theo tab + bỏ đã xóa mềm)
        const [unreadCount, totalCount] = await Promise.all([
          prisma.conversation.count({
            where: {
              orgId: user.orgId,
              zaloAccountId: { in: accountIds },
              deletedAt: null,
              ...tabCountWhere,
              unreadCount: { gt: 0 },
            },
          }),
          prisma.conversation.count({
            where: { orgId: user.orgId, zaloAccountId: { in: accountIds }, deletedAt: null, ...tabCountWhere },
          }),
        ]);
        counts[f.id] = { unread: unreadCount, total: totalCount };
      }

      return {
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color,
          sortOrder: f.sortOrder,
          members: f.members.map((m) => m.zaloAccount),
          unreadCount: counts[f.id]?.unread ?? 0,
          totalCount: counts[f.id]?.total ?? 0,
          createdAt: f.createdAt,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'GET account-folders failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── POST /account-folders ───────────────────────────────────────────────
  app.post('/api/v1/account-folders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as { name: string; color?: string; accountIds?: string[] };
      if (!body.name || !body.name.trim()) {
        return reply.status(400).send({ error: 'name_required' });
      }

      // Check duplicate (unique [userId, name])
      const dupe = await prisma.accountFolder.findFirst({
        where: { userId: user.id, name: body.name.trim() },
      });
      if (dupe) return reply.status(409).send({ error: 'duplicate_name' });

      // Calculate next sortOrder (last + 1)
      const last = await prisma.accountFolder.findFirst({
        where: { userId: user.id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const nextOrder = (last?.sortOrder ?? -1) + 1;

      const folder = await prisma.accountFolder.create({
        data: {
          orgId: user.orgId,
          userId: user.id,
          name: body.name.trim(),
          color: body.color || '#6366F1',
          sortOrder: nextOrder,
        },
      });

      // Bulk insert members
      if (body.accountIds && body.accountIds.length > 0) {
        await prisma.accountFolderMember.createMany({
          data: body.accountIds.map((accountId) => ({
            folderId: folder.id,
            zaloAccountId: accountId,
          })),
          skipDuplicates: true,
        });
      }

      return reply.status(201).send(folder);
    } catch (err) {
      logger.error({ err }, 'POST account-folders failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── PUT /account-folders/:id ────────────────────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/api/v1/account-folders/:id',
    async (request, reply) => {
      try {
        const user = request.user!;
        const body = request.body as {
          name?: string;
          color?: string;
          sortOrder?: number;
        };

        const folder = await prisma.accountFolder.findUnique({
          where: { id: request.params.id },
        });
        if (!folder || folder.userId !== user.id) {
          return reply.status(404).send({ error: 'folder_not_found' });
        }

        const updated = await prisma.accountFolder.update({
          where: { id: request.params.id },
          data: {
            name: body.name?.trim() ?? undefined,
            color: body.color ?? undefined,
            sortOrder: body.sortOrder ?? undefined,
          },
        });
        return updated;
      } catch (err) {
        logger.error({ err }, 'PUT account-folder failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── DELETE /account-folders/:id ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/v1/account-folders/:id',
    async (request, reply) => {
      try {
        const user = request.user!;
        const folder = await prisma.accountFolder.findUnique({
          where: { id: request.params.id },
        });
        if (!folder || folder.userId !== user.id) {
          return reply.status(404).send({ error: 'folder_not_found' });
        }
        await prisma.accountFolder.delete({ where: { id: request.params.id } });
        return reply.status(204).send();
      } catch (err) {
        logger.error({ err }, 'DELETE account-folder failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── PUT /account-folders/:id/members — replace toàn bộ ─────────────────
  app.put<{ Params: { id: string } }>(
    '/api/v1/account-folders/:id/members',
    async (request, reply) => {
      try {
        const user = request.user!;
        const body = request.body as { accountIds: string[] };
        if (!Array.isArray(body.accountIds)) {
          return reply.status(400).send({ error: 'accountIds_required' });
        }

        const folder = await prisma.accountFolder.findUnique({
          where: { id: request.params.id },
        });
        if (!folder || folder.userId !== user.id) {
          return reply.status(404).send({ error: 'folder_not_found' });
        }

        // Replace strategy: delete all + insert
        await tenantTransaction(async (tx) => {
          await tx.accountFolderMember.deleteMany({
            where: { folderId: request.params.id },
          });
          if (body.accountIds.length > 0) {
            await tx.accountFolderMember.createMany({
              data: body.accountIds.map((accountId) => ({
                folderId: request.params.id,
                zaloAccountId: accountId,
              })),
              skipDuplicates: true,
            });
          }
        });

        return { ok: true, count: body.accountIds.length };
      } catch (err) {
        logger.error({ err }, 'PUT folder members failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ── POST /account-folders/reorder ────────────────────────────────────────
  app.post('/api/v1/account-folders/reorder', async (request, reply) => {
    try {
      const user = request.user!;
      const body = request.body as { folderIds: string[] };
      if (!Array.isArray(body.folderIds)) {
        return reply.status(400).send({ error: 'folderIds_required' });
      }

      // Apply order
      await tenantTransaction(async (tx) => {
        for (let idx = 0; idx < body.folderIds.length; idx++) {
          await tx.accountFolder.update({
            where: { id: body.folderIds[idx] },
            data: { sortOrder: idx },
          });
        }
      });

      return { ok: true };
    } catch (err) {
      logger.error({ err }, 'POST folder reorder failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ── POST /account-folders/sync-by-owner ──────────────────────────────────
  // 2026-06-11 (anh chốt) — TỰ TẠO thư mục theo nick: mỗi USER (sale) có nick zalo
  // trong phạm vi xem của viewer → 1 thư mục gom các nick của user đó.
  // ĐỒNG BỘ THÔNG MINH (idempotent): tạo thư mục còn thiếu + thêm nick mới vào đúng
  // thư mục; KHÔNG xóa thư mục/nick admin đã chỉnh tay. Chạy lại nhiều lần an toàn.
  // Match thư mục auto theo TÊN = tên owner (unique [userId,name] đã đảm bảo không trùng).
  app.post('/api/v1/account-folders/sync-by-owner', async (request, reply) => {
    try {
      const user = request.user!;
      const { getZaloScope } = await import('../zalo/zalo-scope.js');
      const scope = await getZaloScope(user.id, user.orgId, user.role);

      // Nick trong phạm vi xem của viewer (admin = tất cả), bỏ nick đã xóa mềm.
      // ownerUserId là NOT NULL trong schema nên mọi nick đều có owner.
      const nicks = await prisma.zaloAccount.findMany({
        where: {
          orgId: user.orgId,
          archivedAt: null,
          ...(scope.isOrgAdmin ? {} : { id: { in: scope.accessibleIds } }),
        },
        select: { id: true, ownerUserId: true, owner: { select: { fullName: true, email: true } } },
      });

      // Gom nick theo owner. Tên thư mục = tên owner (fallback email).
      const byOwner = new Map<string, { name: string; accountIds: string[] }>();
      for (const n of nicks) {
        if (!n.ownerUserId) continue;
        const name = (n.owner?.fullName?.trim() || n.owner?.email || 'Không tên').slice(0, 64);
        const entry = byOwner.get(n.ownerUserId) ?? { name, accountIds: [] };
        entry.accountIds.push(n.id);
        byOwner.set(n.ownerUserId, entry);
      }

      // Palette màu xoay vòng cho thư mục auto (atlas v2).
      const PALETTE = ['#5E6AD2', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0EA5E9', '#EC4899', '#14B8A6'];

      let createdFolders = 0;
      let addedMembers = 0;
      let paletteIdx = 0;

      await tenantTransaction(async (tx) => {
        // sortOrder kế tiếp (đặt thư mục auto sau thư mục đã có).
        const last = await tx.accountFolder.findFirst({
          where: { userId: user.id },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        let nextOrder = (last?.sortOrder ?? -1) + 1;

        for (const [, entry] of byOwner) {
          // Tìm thư mục cùng tên của viewer (đồng bộ thông minh — không tạo trùng).
          let folder = await tx.accountFolder.findFirst({
            where: { userId: user.id, name: entry.name },
            select: { id: true },
          });
          if (!folder) {
            folder = await tx.accountFolder.create({
              data: {
                orgId: user.orgId,
                userId: user.id,
                name: entry.name,
                color: PALETTE[paletteIdx % PALETTE.length],
                sortOrder: nextOrder++,
              },
              select: { id: true },
            });
            createdFolders++;
          }
          paletteIdx++;

          // Thêm nick CÒN THIẾU (skipDuplicates → không đụng nick đã có).
          const existing = await tx.accountFolderMember.findMany({
            where: { folderId: folder.id },
            select: { zaloAccountId: true },
          });
          const have = new Set(existing.map((m) => m.zaloAccountId));
          const toAdd = entry.accountIds.filter((id) => !have.has(id));
          if (toAdd.length > 0) {
            await tx.accountFolderMember.createMany({
              data: toAdd.map((zaloAccountId) => ({ folderId: folder!.id, zaloAccountId })),
              skipDuplicates: true,
            });
            addedMembers += toAdd.length;
          }
        }
      });

      logger.info(
        `[folder-sync] user=${user.id} tạo ${createdFolders} thư mục + thêm ${addedMembers} nick (${byOwner.size} owner có nick)`,
      );
      return {
        ok: true,
        ownersWithNicks: byOwner.size,
        createdFolders,
        addedMembers,
      };
    } catch (err) {
      logger.error({ err }, 'POST folder sync-by-owner failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}
