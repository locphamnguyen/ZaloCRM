// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * socket-auth.ts — Phase 1b Socket.IO auth (Bảo mật xác thực 2026-06-07)
 *
 * VÁ P0 IDOR: trước đây io.on('connection') KHÔNG verify token, và client tự
 * khai org qua emit('org:join', { orgId }) → bất kỳ ai cũng join room org khác
 * và nhận realtime của org đó.
 *
 * Sau bản vá:
 *   1. io.use() verify JWT lúc handshake — không token / token sai → reject.
 *   2. Room org lấy TỪ TOKEN (socket.data.authCtx.orgId), không nhận từ client.
 *   3. Ngắt socket khi access token hết hạn (T3-A) — đóng lỗ "socket sống mãi"
 *      vượt qua thu hồi token.
 *
 *   client ──auth.token──▶ io.use() verify ──ok──▶ join org:<orgId từ token>
 *                              │ fail
 *                              ▼
 *                          reject connection
 */
import type { Server, Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';
import { config } from '../../config/index.js';

export interface SocketAuthCtx {
  userId: string;
  orgId: string;
  role: string;
}

/** Lấy auth context đã verify từ socket (undefined nếu chưa qua io.use auth). */
export function getSocketAuth(socket: Socket): SocketAuthCtx | undefined {
  return socket.data?.authCtx as SocketAuthCtx | undefined;
}

/**
 * Đăng ký auth middleware + connection lifecycle cho Socket.IO.
 * PHẢI gọi TRƯỚC mọi registerXxxSocketHandlers để io.use() chạy trước.
 */
export function registerSocketAuth(io: Server, app: FastifyInstance): void {
  io.use((socket, next) => {
    try {
      // Token ưu tiên từ handshake.auth.token (FE gửi khi connect); fallback header.
      const authToken =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, ''));

      if (!authToken) {
        return next(new Error('unauthorized'));
      }

      // app.jwt.verify throw nếu token sai/hết hạn.
      const payload = app.jwt.verify<{
        id: string;
        orgId: string;
        role: string;
        exp?: number;
        typ?: string;
      }>(authToken);

      // C2 2026-06-08 — sau cutover, từ chối token legacy (thiếu typ:'access') để
      // socket không sống lâu hơn SLA 15' bằng token 7d cũ. Gate qua env.
      if (config.socketRequireAccessTyp && payload.typ !== 'access') {
        return next(new Error('legacy_token_rejected'));
      }

      socket.data.authCtx = {
        userId: payload.id,
        orgId: payload.orgId,
        role: payload.role,
      } satisfies SocketAuthCtx;

      // T3-A: ngắt socket đúng lúc token hết hạn (access token ngắn 15' ở Phase 2).
      if (typeof payload.exp === 'number') {
        const msLeft = payload.exp * 1000 - Date.now();
        if (msLeft <= 0) {
          return next(new Error('token_expired'));
        }
        // setTimeout cap ~24 ngày (int32) — token đời ngắn nên an toàn.
        socket.data.expiryTimer = setTimeout(() => {
          logger.debug(`[socket-auth] token hết hạn, ngắt socket ${socket.id}`);
          socket.disconnect(true);
        }, msLeft);
      }

      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const ctx = getSocketAuth(socket);
    if (ctx) {
      // Room org lấy từ token — KHÔNG nhận orgId từ client nữa.
      socket.join(`org:${ctx.orgId}`);
      // Privacy 2026-06-11 — room riêng theo user, để emit bản nội dung THẬT của
      // nick Riêng tư CHỈ tới chính chủ (per-recipient redaction). Người khác trong
      // org nhận bản đã làm mờ ở room org. userId lấy từ token (không nhận từ client).
      socket.join(`user:${ctx.userId}`);
    }
    socket.on('disconnect', () => {
      const t = socket.data?.expiryTimer as NodeJS.Timeout | undefined;
      if (t) clearTimeout(t);
    });
  });
}
