// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo Socket.IO event handlers.
 * Manages room subscriptions for org-level and per-account events.
 *
 * Phase 1b 2026-06-07 — Bảo mật:
 *   - BỎ 'org:join' (client tự khai orgId). Room org giờ auto-join từ token
 *     trong socket-auth.ts (io.use). Giữ 'org:join' như no-op để FE cũ chưa
 *     kịp deploy không lỗi (server KHÔNG join theo orgId client gửi).
 *   - 'zalo:subscribe' validate account THUỘC org của user (từ token) trước
 *     khi join account room — chống nghe lén QR/status account org khác.
 */
import type { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { getSocketAuth } from '../../shared/realtime/socket-auth.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    // DEPRECATED no-op: room org đã auto-join từ token (socket-auth). KHÔNG
    // join theo orgId do client gửi nữa (đó là lỗ hổng cross-tenant cũ).
    socket.on('org:join', () => {
      /* no-op — server bỏ qua orgId client gửi */
    });

    // Subscribe QR/status của một Zalo account — chỉ cho account cùng org.
    socket.on('zalo:subscribe', async (data: { accountId: string }) => {
      if (!data?.accountId) return;
      const ctx = getSocketAuth(socket);
      if (!ctx) return; // chưa auth → bỏ qua (io.use lẽ ra đã chặn)
      try {
        // Bọc withTenant: socket chạy ngoài request context — cần scope tenant
        // tường minh để qua tenant-guard khi bật enforce (Phase 1a).
        const account = await withTenant(ctx.orgId, () =>
          prisma.zaloAccount.findUnique({
            where: { id: data.accountId },
            select: { orgId: true },
          }),
        );
        // IDOR guard: account không tồn tại hoặc khác org → từ chối join.
        if (!account || account.orgId !== ctx.orgId) {
          logger.warn(
            `[zalo-socket] từ chối subscribe account ${data.accountId} — không thuộc org ${ctx.orgId}`,
          );
          return;
        }
        socket.join(`account:${data.accountId}`);
        logger.debug(`Socket ${socket.id} joined account:${data.accountId}`);
      } catch (err) {
        logger.error('[zalo-socket] zalo:subscribe error:', err);
      }
    });

    // Unsubscribe — leave room luôn an toàn (không lộ dữ liệu).
    socket.on('zalo:unsubscribe', (data: { accountId: string }) => {
      if (!data?.accountId) return;
      socket.leave(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} left account:${data.accountId}`);
    });
  });
}
