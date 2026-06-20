// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { getZaloScope } from '../zalo/zalo-scope.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { resolveSystemNotifyRecipient, sendSystemNotificationToUser, resolveUidBySenderFindUser } from './system-notify-service.js';
import { DEFAULT_WELCOME_TEMPLATE, buildWelcomeMessage, validateTemplate, toZaloStyles } from './welcome-message-builder.js';
import { formatMessage } from '../../shared/text-formatter.js';
import { uploadBuffer } from '../../shared/storage/minio-client.js';
import { config } from '../../config/index.js';

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim()).digest('hex');
}

async function logPhoneSearch(args: {
  orgId: string;
  accountId: string;
  userId: string;
  phone: string;
  result: string;
  foundUid: string | null;
  errorCode: string | null;
}) {
  try {
    await prisma.phoneSearchEvent.create({
      data: {
        orgId: args.orgId,
        accountId: args.accountId,
        userId: args.userId,
        phoneHash: hashPhone(args.phone),
        result: args.result,
        foundUid: args.foundUid,
        errorCode: args.errorCode,
      },
    });
  } catch (err) {
    logger.warn(`[system-notify-phone-search-log] failed: ${String(err)}`);
  }
}

async function listRecipientRows(orgId: string) {
  const users = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      avatarUrl: true,
      role: true,
      permissionGroup: { select: { id: true, name: true, isSystem: true } },
      departmentMember: {
        select: {
          deptRole: true,
          department: { select: { id: true, name: true, path: true } },
        },
      },
      internalContactNick: {
        select: { id: true, displayName: true, avatarUrl: true, phone: true, status: true },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  return Promise.all(users.map(async (user) => {
    const resolved = await resolveSystemNotifyRecipient(orgId, user.id);
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: user.role,
        departmentMember: user.departmentMember,
        permissionGroup: user.permissionGroup,
      },
      internalContactNick: user.internalContactNick,
      recipient: {
        id: resolved.recipient.id,
        status: resolved.status,
        error: resolved.error,
        conversationId: resolved.conversationId,
        threadIdInSenderView: resolved.threadIdInSenderView,
        lastVerifiedAt: resolved.recipient.lastVerifiedAt,
      },
    };
  }));
}

export async function systemNotifyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get(
    '/api/v1/system-notifications/settings',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const currentUser = request.user!;
      // 2026-06-10 FIX: dropdown chọn nick gửi — getZaloScope (Trưởng phòng/HR không
      // thấy nick ngoài quyền) + ẩn nick đã xóa mềm. Union với nick gửi hiện tại để
      // nick đang chọn vẫn render (dù org-wide ngoài scope cá nhân).
      const scope = await getZaloScope(currentUser.id, currentUser.orgId, currentUser.role);
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.orgId },
        select: {
          systemNotifyZaloAccountId: true,
          systemNotifyNick: { select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true } },
        },
      });
      const allowIds = scope.isOrgAdmin
        ? null
        : Array.from(new Set([...scope.accessibleIds, ...(org?.systemNotifyZaloAccountId ? [org.systemNotifyZaloAccountId] : [])]));
      const nicks = await prisma.zaloAccount.findMany({
        where: {
          orgId: currentUser.orgId,
          archivedAt: null,
          ...(allowIds ? { id: { in: allowIds } } : {}),
        },
        select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, phone: true, status: true },
        orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
      });

      // 2026-06-11 FIX: trả status SỐNG từ pool thay DB status — DB hay kẹt 'qr_pending'
      // sau re-QR dù pool đang connected → picker nick gửi hiện "(offline)"/Offline sai.
      const withLive = <T extends { id: string; status: string }>(n: T): T =>
        ({ ...n, status: zaloPool.getStatus(n.id) });
      return {
        systemNotifyZaloAccountId: org?.systemNotifyZaloAccountId ?? null,
        systemNotifyNick: org?.systemNotifyNick ? withLive(org.systemNotifyNick) : null,
        nicks: nicks.map(withLive),
      };
    },
  );

  app.patch(
    '/api/v1/system-notifications/settings/sender',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const body = (request.body ?? {}) as { zaloAccountId?: string | null };
      const accountId = body.zaloAccountId ?? null;

      if (accountId !== null) {
        const nick = await prisma.zaloAccount.findFirst({
          where: { id: accountId, orgId: currentUser.orgId },
          select: { id: true, status: true, displayName: true },
        });
        if (!nick) return reply.status(404).send({ error: 'Nick không tồn tại trong org' });
        if (nick.status !== 'connected') {
          logger.warn(`Org system-notify sender set to disconnected nick: ${nick.displayName} (${accountId})`);
        }
      }

      await prisma.organization.update({
        where: { id: currentUser.orgId },
        data: { systemNotifyZaloAccountId: accountId },
      });

      return { ok: true, systemNotifyZaloAccountId: accountId };
    },
  );

  app.get(
    '/api/v1/system-notifications/recipients',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const currentUser = request.user!;
      const recipients = await listRecipientRows(currentUser.orgId);
      const summary = recipients.reduce<Record<string, number>>((acc, row) => {
        acc[row.recipient.status] = (acc[row.recipient.status] ?? 0) + 1;
        return acc;
      }, {});
      return { summary, recipients };
    },
  );

  app.get(
    '/api/v1/system-notifications/recipients/health',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const currentUser = request.user!;
      const recipients = await listRecipientRows(currentUser.orgId);
      const summary = recipients.reduce<Record<string, number>>((acc, row) => {
        acc[row.recipient.status] = (acc[row.recipient.status] ?? 0) + 1;
        return acc;
      }, {});
      return { summary, recipients };
    },
  );

  // ── POST /recipients/:userId/check-live ───────────────────────────────────
  // CHECK LIVE (2026-06-10 CEO-review): nick gửi findUser(SĐT user) → UID đúng
  // góc nhìn nick gửi → đối chiếu TÊN → khớp: set ready + lưu UID; lệch: trả
  // mismatch + KHÔNG set ready (chống gửi nhầm người như "Song Hào"/"Văn Vỹ").
  // Thay route lookup-uid cũ (dùng nick nội bộ user tự chọn → nguồn sai).
  app.post(
    '/api/v1/system-notifications/recipients/:userId/check-live',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const { userId } = request.params as { userId: string };

      const [org, targetUser] = await Promise.all([
        prisma.organization.findUnique({
          where: { id: currentUser.orgId },
          select: { systemNotifyZaloAccountId: true },
        }),
        prisma.user.findFirst({
          where: { id: userId, orgId: currentUser.orgId, isActive: true },
          select: { id: true, fullName: true, phone: true },
        }),
      ]);

      const senderId = org?.systemNotifyZaloAccountId ?? null;

      if (!targetUser) return reply.status(404).send({ error: 'User không tồn tại trong org' });
      if (!senderId) return reply.status(400).send({ error: 'Org chưa chọn nick gửi thông báo hệ thống', status: 'missing_system_sender' });
      if (!targetUser.phone) {
        await resolveSystemNotifyRecipient(currentUser.orgId, userId);
        return reply.status(400).send({ error: 'Nhân viên chưa có SĐT để tìm UID', status: 'missing_internal_phone' });
      }

      const sender = await prisma.zaloAccount.findFirst({
        where: { id: senderId, orgId: currentUser.orgId },
        select: { id: true, status: true },
      });
      if (!sender || sender.status !== 'connected') {
        await resolveSystemNotifyRecipient(currentUser.orgId, userId);
        return reply.status(400).send({ error: 'Nick gửi hệ thống đang offline', status: 'sender_disconnected' });
      }

      // Lấy UID hiện đang lưu (để báo admin biết có thay đổi không)
      const existing = await prisma.systemNotifyRecipient.findUnique({
        where: { targetUserId_senderZaloAccountId: { targetUserId: userId, senderZaloAccountId: senderId } },
        select: { threadIdInSenderView: true },
      });
      const previousUid = existing?.threadIdInSenderView ?? null;

      const phone = normalizePhone(targetUser.phone) || targetUser.phone;
      const outcome = await resolveUidBySenderFindUser(senderId, phone, targetUser.fullName);
      await logPhoneSearch({
        orgId: currentUser.orgId, accountId: senderId, userId: currentUser.id, phone,
        result: outcome.result === 'found' ? 'found_zalo' : outcome.result,
        foundUid: outcome.uid, errorCode: outcome.errorCode,
      });

      // Không tìm thấy UID
      if (!outcome.uid) {
        const recipient = await prisma.systemNotifyRecipient.upsert({
          where: { targetUserId_senderZaloAccountId: { targetUserId: userId, senderZaloAccountId: senderId } },
          create: {
            orgId: currentUser.orgId, targetUserId: userId, senderZaloAccountId: senderId,
            status: outcome.result === 'lookup_failed' ? 'lookup_failed' : 'uid_not_found',
            error: outcome.errorMessage, lastVerifiedAt: new Date(),
          },
          update: {
            status: outcome.result === 'lookup_failed' ? 'lookup_failed' : 'uid_not_found',
            error: outcome.errorMessage, lastVerifiedAt: new Date(),
          },
        });
        return reply.status(outcome.result === 'lookup_failed' ? 503 : 200).send({
          ok: false, found: false, verdict: outcome.result === 'lookup_failed' ? 'lookup_failed' : 'no_zalo',
          error: outcome.errorMessage, recipient,
        });
      }

      // Tìm thấy UID nhưng TÊN LỆCH → CHẶN, không set ready, báo admin
      if (!outcome.nameMatched) {
        const recipient = await prisma.systemNotifyRecipient.upsert({
          where: { targetUserId_senderZaloAccountId: { targetUserId: userId, senderZaloAccountId: senderId } },
          create: {
            orgId: currentUser.orgId, targetUserId: userId, senderZaloAccountId: senderId,
            status: 'uid_not_found',
            error: `UID tìm được trỏ tới "${outcome.zaloName}" — KHÔNG khớp nhân viên "${targetUser.fullName}". Đã chặn để tránh gửi nhầm.`,
            lastVerifiedAt: new Date(),
          },
          update: {
            status: 'uid_not_found',
            error: `UID tìm được trỏ tới "${outcome.zaloName}" — KHÔNG khớp nhân viên "${targetUser.fullName}". Đã chặn để tránh gửi nhầm.`,
            lastVerifiedAt: new Date(),
          },
        });
        return reply.send({
          ok: false, found: true, verdict: 'name_mismatch',
          uid: outcome.uid, zaloName: outcome.zaloName, userName: targetUser.fullName,
          previousUid, changed: previousUid !== outcome.uid, recipient,
        });
      }

      // Khớp tên → set ready + lưu UID đúng
      const recipient = await prisma.systemNotifyRecipient.upsert({
        where: { targetUserId_senderZaloAccountId: { targetUserId: userId, senderZaloAccountId: senderId } },
        create: {
          orgId: currentUser.orgId, targetUserId: userId, senderZaloAccountId: senderId,
          threadIdInSenderView: outcome.uid, status: 'ready', error: null, lastVerifiedAt: new Date(),
        },
        update: {
          threadIdInSenderView: outcome.uid, status: 'ready', error: null, lastVerifiedAt: new Date(),
        },
      });
      return reply.send({
        ok: true, found: true,
        verdict: previousUid && previousUid !== outcome.uid ? 'updated' : 'pass',
        uid: outcome.uid, zaloName: outcome.zaloName, userName: targetUser.fullName,
        previousUid, changed: previousUid !== outcome.uid, recipient,
      });
    },
  );

  // ── POST /recipients/recheck-all ──────────────────────────────────────────
  // CHECK HÀNG LOẠT (2026-06-10): re-resolve UID toàn bộ recipient theo nick gửi
  // HIỆN TẠI. Backup khi đổi nick gửi (nick chết / đổi số) — mọi UID per-viewer
  // đổi theo nick mới. Chạy tuần tự (findUser có rate limit), bỏ qua user no-phone.
  app.post(
    '/api/v1/system-notifications/recipients/recheck-all',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.orgId },
        select: { systemNotifyZaloAccountId: true },
      });
      const senderId = org?.systemNotifyZaloAccountId ?? null;
      if (!senderId) return reply.status(400).send({ error: 'Org chưa chọn nick gửi thông báo hệ thống', status: 'missing_system_sender' });

      const sender = await prisma.zaloAccount.findFirst({
        where: { id: senderId, orgId: currentUser.orgId }, select: { id: true, status: true },
      });
      if (!sender || sender.status !== 'connected') {
        return reply.status(400).send({ error: 'Nick gửi hệ thống đang offline', status: 'sender_disconnected' });
      }

      const users = await prisma.user.findMany({
        where: { orgId: currentUser.orgId, isActive: true, phone: { not: null } },
        select: { id: true, fullName: true, phone: true },
        orderBy: { fullName: 'asc' },
      });

      const summary = { total: users.length, ready: 0, updated: 0, mismatch: 0, no_zalo: 0, failed: 0, skipped: 0 };
      const changes: Array<{ userName: string | null; verdict: string; zaloName: string | null }> = [];

      for (const u of users) {
        const phone = normalizePhone(u.phone) || u.phone!;
        const existing = await prisma.systemNotifyRecipient.findUnique({
          where: { targetUserId_senderZaloAccountId: { targetUserId: u.id, senderZaloAccountId: senderId } },
          select: { threadIdInSenderView: true },
        });
        const previousUid = existing?.threadIdInSenderView ?? null;
        const outcome = await resolveUidBySenderFindUser(senderId, phone, u.fullName);
        await logPhoneSearch({
          orgId: currentUser.orgId, accountId: senderId, userId: currentUser.id, phone,
          result: outcome.result === 'found' ? 'found_zalo' : outcome.result, foundUid: outcome.uid, errorCode: outcome.errorCode,
        });

        if (outcome.result === 'lookup_failed') { summary.failed++; continue; }
        if (!outcome.uid) {
          summary.no_zalo++;
          await prisma.systemNotifyRecipient.upsert({
            where: { targetUserId_senderZaloAccountId: { targetUserId: u.id, senderZaloAccountId: senderId } },
            create: { orgId: currentUser.orgId, targetUserId: u.id, senderZaloAccountId: senderId, status: 'uid_not_found', error: outcome.errorMessage, lastVerifiedAt: new Date() },
            update: { status: 'uid_not_found', error: outcome.errorMessage, lastVerifiedAt: new Date() },
          });
          continue;
        }
        if (!outcome.nameMatched) {
          summary.mismatch++;
          changes.push({ userName: u.fullName, verdict: 'name_mismatch', zaloName: outcome.zaloName });
          await prisma.systemNotifyRecipient.upsert({
            where: { targetUserId_senderZaloAccountId: { targetUserId: u.id, senderZaloAccountId: senderId } },
            create: { orgId: currentUser.orgId, targetUserId: u.id, senderZaloAccountId: senderId, status: 'uid_not_found', error: `UID trỏ tới "${outcome.zaloName}" KHÔNG khớp "${u.fullName}"`, lastVerifiedAt: new Date() },
            update: { status: 'uid_not_found', error: `UID trỏ tới "${outcome.zaloName}" KHÔNG khớp "${u.fullName}"`, lastVerifiedAt: new Date() },
          });
          continue;
        }
        const changed = previousUid !== null && previousUid !== outcome.uid;
        if (changed) { summary.updated++; changes.push({ userName: u.fullName, verdict: 'updated', zaloName: outcome.zaloName }); }
        else summary.ready++;
        await prisma.systemNotifyRecipient.upsert({
          where: { targetUserId_senderZaloAccountId: { targetUserId: u.id, senderZaloAccountId: senderId } },
          create: { orgId: currentUser.orgId, targetUserId: u.id, senderZaloAccountId: senderId, threadIdInSenderView: outcome.uid, status: 'ready', error: null, lastVerifiedAt: new Date() },
          update: { threadIdInSenderView: outcome.uid, status: 'ready', error: null, lastVerifiedAt: new Date() },
        });
      }

      logger.info(`[system-notify] recheck-all org=${currentUser.orgId}: ${JSON.stringify(summary)}`);
      return { ok: true, summary, changes };
    },
  );

  app.post(
    '/api/v1/system-notifications/test',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const body = (request.body ?? {}) as { targetUserId?: string; title?: string; content?: string; priority?: 'low' | 'normal' | 'high' };
      if (!body.targetUserId) return reply.status(400).send({ error: 'targetUserId là bắt buộc' });

      const target = await prisma.user.findFirst({
        where: { id: body.targetUserId, orgId: currentUser.orgId, isActive: true },
        select: { id: true },
      });
      if (!target) return reply.status(404).send({ error: 'User không tồn tại trong org' });

      const notification = await sendSystemNotificationToUser({
        orgId: currentUser.orgId,
        targetUserId: body.targetUserId,
        type: 'test',
        title: body.title?.trim() || 'Test thông báo hệ thống',
        content: body.content?.trim() || `Đây là tin test từ CRM gửi bởi ${currentUser.email}.`,
        priority: body.priority ?? 'normal',
      });

      return { ok: notification.status === 'sent', notification };
    },
  );

  // ── Org config: welcome message template + image + admin fallback phone ──
  // Phase user-create-with-zalo 2026-05-27. Dùng chung trang Thông báo hệ thống,
  // admin sửa template + upload ảnh + nhập SĐT admin fallback.

  app.get(
    '/api/v1/system-notifications/org-config',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const currentUser = request.user!;
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.orgId },
        select: {
          welcomeMessageTemplate: true,
          welcomeImageUrl: true,
          adminFallbackPhone: true,
        },
      });
      return {
        welcomeMessageTemplate: org?.welcomeMessageTemplate ?? null,
        welcomeImageUrl: org?.welcomeImageUrl ?? null,
        adminFallbackPhone: org?.adminFallbackPhone ?? null,
        defaultTemplate: DEFAULT_WELCOME_TEMPLATE,
      };
    },
  );

  // ── Compile RAW template → {text, styles} cho WYSIWYG editor (Atlas v3 2026-06-08) ──
  // Khác preview-welcome: KHÔNG substitute placeholder ({{fullName}}...) — giữ nguyên literal
  // để editor hiển thị đúng chữ "{{fullName}}" cho admin chèn/sửa. formatMessage compile
  // markup (**đậm**, {red}, # tiêu đề, - bullet) → styles; toZaloStyles → mã Zalo (b/i/c_HEX/f_NN)
  // mà RichTextEditor.applyRichPayload hiểu được. Trả cả compile của template default để Reset.
  app.post(
    '/api/v1/system-notifications/compile-template',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const body = (request.body ?? {}) as { template?: string };
      const raw = typeof body.template === 'string' ? body.template : DEFAULT_WELCOME_TEMPLATE;
      const formatted = formatMessage(raw);
      return {
        text: formatted.text,
        styles: toZaloStyles(formatted.styles),
      };
    },
  );

  app.patch(
    '/api/v1/system-notifications/org-config',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const body = (request.body ?? {}) as {
        welcomeMessageTemplate?: string | null;
        welcomeImageUrl?: string | null;
        adminFallbackPhone?: string | null;
      };

      const data: Record<string, string | null> = {};
      if (Object.prototype.hasOwnProperty.call(body, 'welcomeMessageTemplate')) {
        const tpl = body.welcomeMessageTemplate;
        if (tpl !== null && tpl !== undefined) {
          if (typeof tpl !== 'string' || tpl.length > 4000) {
            return reply.status(400).send({ error: 'Template phải là string ≤ 4000 ký tự' });
          }
          const errors = validateTemplate(tpl);
          if (errors.length > 0) {
            return reply.status(400).send({ error: errors.join('; ') });
          }
        }
        data.welcomeMessageTemplate = tpl ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'welcomeImageUrl')) {
        const url = body.welcomeImageUrl;
        // FIX codex LOW-8: chỉ cho phép URL từ MinIO public CDN (do BE tự upload), không phải URL bất kỳ.
        // Null/empty = xoá ảnh, OK.
        if (url !== null && url !== undefined && url !== '') {
          if (typeof url !== 'string' || !url.startsWith(config.s3PublicUrl)) {
            return reply.status(400).send({ error: 'welcomeImageUrl phải là URL MinIO của hệ thống (upload qua /welcome-image)' });
          }
        }
        data.welcomeImageUrl = url || null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'adminFallbackPhone')) {
        const phone = body.adminFallbackPhone;
        if (phone !== null && phone !== undefined && phone !== '') {
          const norm = normalizePhone(String(phone));
          if (!norm) {
            return reply.status(400).send({ error: 'SĐT admin fallback không hợp lệ' });
          }
          data.adminFallbackPhone = norm;
        } else {
          data.adminFallbackPhone = null;
        }
      }

      await prisma.organization.update({
        where: { id: currentUser.orgId },
        data,
      });
      return { ok: true };
    },
  );

  app.post(
    '/api/v1/system-notifications/welcome-image',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file' && part.fieldname === 'image') {
            if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(part.mimetype)) {
              return reply.status(415).send({ error: `Mime không support: ${part.mimetype}` });
            }
            const buf = await part.toBuffer();
            if (buf.length > 5 * 1024 * 1024) {
              return reply.status(413).send({ error: 'Ảnh quá 5MB' });
            }
            const result = await uploadBuffer(buf, part.mimetype, part.filename);
            await prisma.organization.update({
              where: { id: currentUser.orgId },
              data: { welcomeImageUrl: result.url },
            });
            return { ok: true, url: result.url };
          }
        }
      } catch (err) {
        return reply.status(400).send({ error: `Upload fail: ${(err as Error)?.message}` });
      }
      return reply.status(400).send({ error: 'Không tìm thấy field "image" trong multipart' });
    },
  );

  app.post(
    '/api/v1/system-notifications/preview-welcome',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const currentUser = request.user!;
      const body = (request.body ?? {}) as {
        templateOverride?: string;
        variant?: 'friend' | 'stranger';
      };
      const org = await prisma.organization.findUnique({
        where: { id: currentUser.orgId },
        select: { name: true, welcomeMessageTemplate: true, welcomeImageUrl: true, adminFallbackPhone: true },
      });
      const template = body.templateOverride ?? org?.welcomeMessageTemplate ?? null;
      const payload = buildWelcomeMessage(template, {
        fullName: 'Nguyễn Văn A',
        email: 'nguyenvana@example.com',
        phone: '0931536109',
        password: 'a3k7p9',
        loginUrl: process.env.CRM_LOGIN_URL || process.env.APP_URL || 'https://zalo.hsholding.vn',
        orgName: org?.name ?? 'Tổ chức',
        departmentName: 'Phòng Kinh Doanh',
        roleName: 'Nhân viên Sale',
        adminPhone: org?.adminFallbackPhone ?? '0908278807',
        variant: body.variant ?? 'stranger',
      }, { welcomeImagePath: org?.welcomeImageUrl ?? null });
      return {
        text: payload.formatted.text,
        styles: payload.formatted.styles,
        attachments: payload.attachments,
      };
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // 2026-06-04 (Anh chốt) — LOG THÔNG BÁO HỆ THỐNG
  // GET /logs: list SystemNotification (filter type/status/channel/date) +
  //   JOIN Message theo zaloMsgId lấy deliveredAt/seenAt (đã nhận/đã xem).
  //   delivered/seen ĐÃ CÓ SẴN (Message.delivered_at/seen_at, listener Zalo
  //   seen_messages/delivered_messages) — chỉ đọc, không thêm cột.
  // POST /logs/:id/retry: gửi lại tin failed.
  // ════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/v1/system-notifications/logs',
    { preHandler: requireGrant('settings', 'access') },
    async (request: FastifyRequest) => {
      const currentUser = request.user!;
      const q = (request.query ?? {}) as {
        type?: string;
        status?: string;
        channel?: string;
        from?: string;
        to?: string;
        targetUserId?: string;
        limit?: string;
        offset?: string;
      };
      const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);

      const where: Record<string, unknown> = { orgId: currentUser.orgId };
      if (q.type) where.type = q.type;
      if (q.status) where.status = q.status;
      if (q.channel) where.channel = q.channel;
      if (q.targetUserId) where.targetUserId = q.targetUserId;
      if (q.from || q.to) {
        const createdAt: Record<string, Date> = {};
        if (q.from) { const d = new Date(q.from); if (!Number.isNaN(d.getTime())) createdAt.gte = d; }
        if (q.to) { const d = new Date(q.to); if (!Number.isNaN(d.getTime())) createdAt.lte = d; }
        if (Object.keys(createdAt).length) where.createdAt = createdAt;
      }

      // Summary counts theo status + theo type (cho chip + thống kê đầu trang).
      // Dùng where KHÔNG kèm status để đếm toàn bộ scope filter còn lại.
      const summaryWhere = { ...where };
      delete summaryWhere.status;
      delete summaryWhere.type;
      const [rows, total, byStatus, byType] = await Promise.all([
        prisma.systemNotification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            type: true,
            title: true,
            content: true,
            priority: true,
            channel: true,
            status: true,
            zaloMsgId: true,
            error: true,
            createdAt: true,
            sentAt: true,
            conversationId: true,
            targetUser: { select: { id: true, fullName: true, email: true } },
            senderZaloAccount: { select: { id: true, displayName: true } },
          },
        }),
        prisma.systemNotification.count({ where }),
        prisma.systemNotification.groupBy({
          by: ['status'],
          where: summaryWhere,
          _count: { _all: true },
        }),
        prisma.systemNotification.groupBy({
          by: ['type'],
          where: summaryWhere,
          _count: { _all: true },
        }),
      ]);

      // JOIN Message theo zaloMsgId (tin gửi qua Zalo) lấy delivered/seen.
      const msgIds = rows.map((r) => r.zaloMsgId).filter((x): x is string => !!x);
      const msgMap = new Map<string, { deliveredAt: Date | null; seenAt: Date | null }>();
      if (msgIds.length) {
        const msgs = await prisma.message.findMany({
          where: { zaloMsgId: { in: msgIds }, senderType: 'self' },
          select: { zaloMsgId: true, deliveredAt: true, seenAt: true },
        });
        for (const m of msgs) {
          if (m.zaloMsgId) msgMap.set(m.zaloMsgId, { deliveredAt: m.deliveredAt, seenAt: m.seenAt });
        }
      }

      const items = rows.map((r) => {
        const m = r.zaloMsgId ? msgMap.get(r.zaloMsgId) : undefined;
        return {
          id: r.id,
          type: r.type,
          title: r.title,
          content: r.content,
          priority: r.priority,
          channel: r.channel,
          status: r.status,
          error: r.error,
          createdAt: r.createdAt,
          sentAt: r.sentAt,
          conversationId: r.conversationId,
          targetUser: r.targetUser,
          senderNick: r.senderZaloAccount,
          // Đã nhận / đã xem (chỉ tin gửi qua Zalo thành công mới có).
          deliveredAt: m?.deliveredAt ?? null,
          seenAt: m?.seenAt ?? null,
        };
      });

      const statusCounts = byStatus.reduce<Record<string, number>>((acc, g) => {
        acc[g.status] = g._count._all;
        return acc;
      }, {});
      const typeCounts = byType.reduce<Record<string, number>>((acc, g) => {
        acc[g.type] = g._count._all;
        return acc;
      }, {});

      return { items, total, limit, offset, statusCounts, typeCounts };
    },
  );

  app.post(
    '/api/v1/system-notifications/logs/:id/retry',
    { preHandler: requireGrant('settings', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const currentUser = request.user!;
      const { id } = request.params as { id: string };

      const original = await prisma.systemNotification.findFirst({
        where: { id, orgId: currentUser.orgId },
        select: { id: true, type: true, title: true, content: true, priority: true, targetUserId: true, status: true },
      });
      if (!original) return reply.status(404).send({ error: 'Không tìm thấy thông báo' });

      // Gửi lại = tạo bản ghi gửi mới (giữ log gốc làm lịch sử). Reuse service.
      const notification = await sendSystemNotificationToUser({
        orgId: currentUser.orgId,
        targetUserId: original.targetUserId,
        type: original.type,
        title: original.title,
        content: original.content,
        priority: (original.priority as 'low' | 'normal' | 'high') ?? 'normal',
      });

      return { ok: notification.status === 'sent', notification };
    },
  );
}
