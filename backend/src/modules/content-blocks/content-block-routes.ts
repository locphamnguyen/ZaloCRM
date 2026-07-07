// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * content-block-routes.ts — Khối nội dung: kho nội dung tái dùng cho Broadcast tự động.
 *
 * Endpoints:
 *   GET    /api/v1/content-blocks       — danh sách (org scope)
 *   POST   /api/v1/content-blocks       — tạo
 *   PATCH  /api/v1/content-blocks/:id   — sửa
 *   DELETE /api/v1/content-blocks/:id   — xoá
 *
 * Mở cho mọi user đăng nhập trong org (giống Mẫu tin nhắn) — không cần owner/admin
 * vì bản thân khối nội dung không gửi gì, chỉ là nội dung soạn sẵn để Broadcast chọn.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';

interface BlockBody {
  name?: string;
  messageText?: string;
  imageUrl?: string | null;
}

export async function contentBlockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/content-blocks', async (request) => {
    const user = request.user!;
    const blocks = await prisma.contentBlock.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    });
    return { blocks };
  });

  app.post<{ Body: BlockBody }>('/api/v1/content-blocks', async (request, reply) => {
    const user = request.user!;
    const b = request.body ?? {};
    if (!b.name?.trim()) return reply.status(400).send({ error: 'name_required' });
    if (!b.messageText?.trim()) return reply.status(400).send({ error: 'messageText_required' });

    const block = await prisma.contentBlock.create({
      data: {
        orgId: user.orgId,
        createdById: user.id,
        name: b.name.trim(),
        messageText: b.messageText,
        imageUrl: b.imageUrl?.trim() || null,
      },
    });
    return reply.status(201).send({ block });
  });

  app.patch<{ Params: { id: string }; Body: BlockBody }>('/api/v1/content-blocks/:id', async (request, reply) => {
    const user = request.user!;
    const existing = await prisma.contentBlock.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'not_found' });

    const b = request.body ?? {};
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name.trim();
    if (b.messageText !== undefined) data.messageText = b.messageText;
    if (b.imageUrl !== undefined) data.imageUrl = b.imageUrl?.trim() || null;

    const block = await prisma.contentBlock.update({ where: { id: existing.id }, data });
    return { block };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/content-blocks/:id', async (request, reply) => {
    const user = request.user!;
    const existing = await prisma.contentBlock.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'not_found' });
    await prisma.contentBlock.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}
