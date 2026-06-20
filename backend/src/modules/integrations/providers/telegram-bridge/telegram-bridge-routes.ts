/**
 * telegram-bridge-routes.ts — Endpoint quản lý Cầu Telegram (Phase 3).
 * POST provision/:zaloAccountId → tự tạo group + bật cầu cho nick (tài khoản công ty GramJS).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../../auth/auth-middleware.js';
import { requireGrant } from '../../../rbac/rbac-middleware.js';
import { provisionNickGroup, isProvisionerConfigured } from './provisioner.js';
import { generateLinkCode } from './link.js';

export async function telegramBridgeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Sinh mã liên kết cho user hiện tại — sale gõ `/link <mã>` cho bot Telegram để gắn.
  app.post('/api/v1/telegram-bridge/link-code', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const code = generateLinkCode(user.id, user.orgId);
    return reply.send({ code, expiresInMinutes: 10, hint: `Gõ trong Telegram: /link ${code}` });
  });

  // Bật cầu cho 1 nick — tự tạo supergroup + topics + thêm bot admin, lưu chat id.
  app.post(
    '/api/v1/telegram-bridge/provision/:zaloAccountId',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isProvisionerConfigured()) {
        return reply.status(400).send({ error: 'Tài khoản provisioner chưa cấu hình (TELEGRAM_PROVISIONER_*).' });
      }
      const { zaloAccountId } = request.params as { zaloAccountId: string };
      try {
        const result = await provisionNickGroup(zaloAccountId);
        if (!result) return reply.status(404).send({ error: 'Nick không tồn tại hoặc cấp group thất bại.' });
        return { ok: true, chatId: result.chatId };
      } catch (err) {
        return reply.status(500).send({ error: 'Cấp group lỗi: ' + String((err as Error)?.message || err) });
      }
    },
  );
}
