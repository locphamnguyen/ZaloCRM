/**
 * media-routes.ts — Phase Media Library 2026-06-11 (GĐ1).
 *
 * Kho phương tiện: list / upload / "Lưu từ chat" / chèn vào chat.
 * RBAC (checklist điều 2-3): authMiddleware toàn route + requireGrant('media', …).
 * Scope owner (checklist điều 1): sale chỉ thấy asset của mình (ownerUserId) HOẶC
 *   asset Công khai (visibility='public'); media.view_all bypass scope (admin/marketing).
 * Privacy (checklist điều 4): "Lưu từ chat" của nick Riêng tư (privacyMode='main')
 *   → asset mặc định private + ghi sourceZaloAccountId; chỉ chính chủ nick lưu được.
 * UID per-cặp-nick (checklist điều 7): chèn vào chat gửi theo conversation.externalThreadId.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { registerAsset, bumpUsage, resolveSavedVisibility, generateWatermarkVariant, type MediaKind } from './media-service.js';
import { downloadMediaToTemp } from '../chat/chat-media-helpers.js';
import { createMediaMessage, getUserFullName } from '../chat/chat-helpers.js';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { logger } from '../../shared/utils/logger.js';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
// File types: tái dùng list của chat-attachment (KHÔNG mở rộng tùy tiện — checklist reuse).
const ALLOWED_FILE = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/zip', 'application/x-zip-compressed',
];
// Giới hạn (design review E5): ảnh >15MB báo quá lớn.
const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 500 * 1024 * 1024;
const FILE_MAX = 1024 * 1024 * 1024;

function classify(mime: string): MediaKind | null {
  if (ALLOWED_IMAGE.includes(mime)) return 'image';
  if (ALLOWED_VIDEO.includes(mime)) return 'video';
  if (ALLOWED_FILE.includes(mime)) return 'file';
  return null;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/media — list kho (scope owner + visibility) ────────────────
  app.get(
    '/api/v1/media',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as {
        kind?: string; tag?: string; folderId?: string;
        visibility?: string; q?: string; limit?: string;
      };

      // view_all → xem cả org; thường → chỉ asset của mình HOẶC public.
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const scopeWhere = canViewAll
        ? {}
        : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] };

      const where: any = {
        orgId: user.orgId,
        archivedAt: null,
        ...scopeWhere,
      };
      if (q.kind) where.kind = q.kind;
      if (q.visibility) where.visibility = q.visibility;
      if (q.folderId) where.folderId = q.folderId;
      if (q.tag) where.tagIds = { has: q.tag };
      if (q.q) where.name = { contains: q.q, mode: 'insensitive' };

      const limit = Math.min(parseInt(q.limit ?? '60', 10) || 60, 200);
      const assets = await prisma.mediaAsset.findMany({
        where,
        orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: limit,
        include: { blobs: { where: { variantType: 'original' }, take: 1 } },
      });

      const items = assets.map((a) => {
        const blob = a.blobs[0];
        return {
          id: a.id,
          kind: a.kind,
          name: a.name,
          visibility: a.visibility,
          ownerUserId: a.ownerUserId,
          tagIds: a.tagIds,
          usageCount: a.usageCount,
          url: blob?.publicUrl ?? null,
          thumbnailUrl: a.thumbnailUrl ?? blob?.publicUrl ?? null,
          sizeBytes: blob?.sizeBytes ?? null,
          createdAt: a.createdAt,
        };
      });
      return { items };
    },
  );

  // ── POST /api/v1/media/upload — tải ảnh/file lên kho (multipart) ───────────
  app.post(
    '/api/v1/media/upload',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      let visibility: 'private' | 'public' = 'private';
      let folderId: string | null = null;
      let tagIds: string[] = [];
      // BUG self-verify 2026-06-11: field 'visibility' có thể đến SAU file trong multipart
      // → đọc khi register thì còn 'private'. Fix: GOM file buffers + fields TRƯỚC, register SAU.
      const pending: Array<{ buffer: Buffer; mimeType: string; kind: MediaKind; filename: string }> = [];

      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (part.fieldname === 'visibility' && part.value === 'public') visibility = 'public';
            if (part.fieldname === 'folderId' && part.value) folderId = String(part.value);
            if (part.fieldname === 'tagIds' && part.value) {
              try { tagIds = JSON.parse(String(part.value)); } catch { /* ignore */ }
            }
            continue;
          }
          if (part.type !== 'file') continue;
          const kind = classify(part.mimetype);
          if (!kind) {
            return reply.status(415).send({ error: `Loại tệp không hỗ trợ: ${part.mimetype}` });
          }
          const buf = await part.toBuffer();
          const max = kind === 'image' ? IMAGE_MAX : kind === 'video' ? VIDEO_MAX : FILE_MAX;
          if (buf.length > max) {
            return reply.status(413).send({
              error: kind === 'image' ? 'Ảnh quá lớn (tối đa 15MB)' : `${kind} vượt ${max / 1024 / 1024}MB`,
            });
          }
          pending.push({ buffer: buf, mimeType: part.mimetype, kind, filename: part.filename });
        }

        // Register SAU khi đã đọc hết parts → visibility/folderId/tagIds chắc chắn đầy đủ.
        const created: any[] = [];
        for (const p of pending) {
          const res = await registerAsset({
            orgId: user.orgId,
            buffer: p.buffer,
            mimeType: p.mimeType,
            kind: p.kind,
            originalFilename: p.filename,
            ownerUserId: userId,
            createdById: userId,
            visibility,
            source: 'upload',
            tagIds,
            folderId,
          });
          created.push({ id: res.asset.id, name: res.asset.name, deduped: res.deduped });
        }
        if (created.length === 0) return reply.status(400).send({ error: 'Không có tệp nào' });
        return { assets: created };
      } catch (err: any) {
        logger.error('[media] upload error:', err);
        return reply.status(500).send({ error: err?.message ?? 'upload failed' });
      }
    },
  );

  // ── POST /api/v1/media/save-from-chat — "Lưu vào Media" từ bong bóng chat ──
  app.post(
    '/api/v1/media/save-from-chat',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { messageId: string; visibility?: 'private' | 'public' };
      if (!body?.messageId) return reply.status(400).send({ error: 'messageId required' });

      const message = await prisma.message.findFirst({
        where: { id: body.messageId, conversation: { orgId: user.orgId } },
        include: { conversation: { include: { zaloAccount: true } } },
      });
      if (!message) return reply.status(404).send({ error: 'Không tìm thấy tin nhắn' });

      const nick = message.conversation.zaloAccount;
      // PRIVACY (điều 4 + D11): quyết định qua hàm thuần đã test (resolveSavedVisibility).
      const isPrivateNick = nick.privacyMode === 'main';
      const vis = resolveSavedVisibility({
        nickPrivacyMode: nick.privacyMode,
        nickOwnerUserId: nick.ownerUserId,
        viewerUserId: userId,
        requested: body.visibility,
      });
      if (vis.blocked) {
        return reply.status(403).send({
          error: 'Tin từ nick Riêng tư — chỉ chính chủ nick mới lưu vào Media được.',
          code: 'PRIVACY_LOCKED',
        });
      }

      // Lấy URL media từ content. Tin khách gửi đã mirror lên MinIO (URL ổn định).
      let parsed: any = {};
      try { parsed = JSON.parse(message.content || '{}'); } catch { /* not json */ }
      const url: string | undefined = parsed.href || parsed.hdUrl || parsed.normalUrl || parsed.url || parsed.fileUrl;
      if (!url) return reply.status(400).send({ error: 'Tin này không có media để lưu' });

      const ct = message.contentType;
      const kind: MediaKind = ct === 'image' ? 'image' : ct === 'video' ? 'video' : 'file';

      // Tải media về buffer rồi đăng ký vào kho (qua dedup — không tốn thêm nếu trùng).
      let tmp: { path: string; cleanup: () => Promise<void> } | null = null;
      try {
        tmp = await downloadMediaToTemp({ url, filename: parsed.name }, ct);
        const { readFile } = await import('node:fs/promises');
        const buf = await readFile(tmp.path);
        const mimeType = parsed.mime
          || (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'application/octet-stream');
        const res = await registerAsset({
          orgId: user.orgId,
          buffer: buf,
          mimeType,
          kind,
          name: parsed.name || `Lưu từ chat`,
          originalFilename: parsed.name,
          ownerUserId: userId,
          createdById: userId,
          // GUARD privacy: nick Riêng tư → ép private + ghi nguồn (resolveSavedVisibility).
          visibility: vis.visibility,
          source: 'saved_from_chat',
          sourceZaloAccountId: isPrivateNick ? nick.id : null,
        });
        return { asset: { id: res.asset.id, name: res.asset.name }, deduped: res.deduped };
      } catch (err: any) {
        logger.error('[media] save-from-chat error:', err);
        return reply.status(500).send({ error: err?.message ?? 'save failed' });
      } finally {
        await tmp?.cleanup().catch(() => {});
      }
    },
  );

  // ── POST /api/v1/media/:id/send — chèn 1 asset từ kho vào 1 hội thoại ──────
  app.post(
    '/api/v1/media/:id/send',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const body = request.body as { conversationId: string; caption?: string };
      if (!body?.conversationId) return reply.status(400).send({ error: 'conversationId required' });

      // Asset phải thuộc org + (của mình HOẶC public HOẶC có view_all).
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: {
          id, orgId: user.orgId, archivedAt: null,
          ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }),
        },
        include: { blobs: { where: { variantType: 'original' }, take: 1 } },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media trong kho' });
      const blob = asset.blobs[0];
      if (!blob) return reply.status(400).send({ error: 'Media chưa có dữ liệu (đã xóa khỏi kho?)' });

      const conversation = await prisma.conversation.findFirst({
        where: { id: body.conversationId, orgId: user.orgId },
        include: { zaloAccount: true },
      });
      if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });

      // Guard sớm: nick phải đang KẾT NỐI (status connected) — tránh treo khi nick
      // QR-pending/disconnected. zaloOps cũng check lại, nhưng báo sớm rõ hơn cho sale.
      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api || instance.status !== 'connected') {
        return reply.status(400).send({
          error: 'Nick Zalo chưa kết nối (cần quét QR đăng nhập lại nick).',
          code: 'NICK_NOT_CONNECTED',
        });
      }

      // PRIVACY: nick Riêng tư → chỉ chính chủ gửi được (như chat-attachment).
      if (conversation.zaloAccount.privacyMode === 'main'
        && conversation.zaloAccount.ownerUserId !== userId) {
        return reply.status(403).send({ error: 'Nick Riêng tư — chỉ chính chủ gửi được.', code: 'PRIVACY_LOCKED' });
      }

      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      const threadId = conversation.externalThreadId || ''; // UID per-cặp-nick (điều 7)
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;
      const userFullName = await getUserFullName(user.id);
      const caption = body.caption ?? '';

      // GĐ1: tải object kho về temp → gửi từ local path (như chat hiện tại).
      // (GĐ3 sẽ tối ưu forward/cache per-nick — chưa làm ở GĐ1.)
      let tmp: { path: string; cleanup: () => Promise<void> } | null = null;
      try {
        tmp = await downloadMediaToTemp({ url: blob.publicUrl, filename: asset.name }, asset.kind);
        zaloRateLimiter.recordSend(conversation.zaloAccountId);

        // Gửi QUA zaloOps (KHÔNG gọi instance.api trực tiếp): zaloOps.exec check
        // status==='connected' TRƯỚC → nick mất kết nối thì throw NOT_CONNECTED ngay,
        // KHÔNG treo (bug anh báo: nick QR-pending làm sendMessage trực tiếp đứng vô hạn).
        let zaloMsgId = '';
        let content = '';
        // Dùng zaloOps.sendFile cho MỌI loại: nó build api.sendMessage({ msg: caption,
        // attachments }) — LUÔN có `msg` (kể cả ''). Tránh bug zca-js sendMessage.cjs:445
        // đọc `msg.length` khi sendImage build {attachments} KHÔNG có msg → crash undefined.
        const sendResult: any = await zaloOps.sendFile(
          conversation.zaloAccountId, threadId, threadType as 0 | 1, [tmp.path], io, caption,
        );
        zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
        if (asset.kind === 'image') {
          content = JSON.stringify({ href: blob.publicUrl, thumb: blob.publicUrl, size: blob.sizeBytes });
        } else {
          content = asset.kind === 'video'
            ? JSON.stringify({ href: blob.publicUrl, thumb: asset.thumbnailUrl ?? blob.publicUrl, size: blob.sizeBytes })
            : JSON.stringify({ href: blob.publicUrl, name: asset.name, size: blob.sizeBytes, mime: blob.mimeType });
        }

        const msg = await createMediaMessage({
          conversationId: conversation.id,
          zaloAccount: conversation.zaloAccount,
          repliedByUserId: user.id,
          zaloMsgId,
          contentType: asset.kind as 'image' | 'video' | 'file',
          content,
          metadata: { sender: { kind: 'user_crm', name: userFullName } },
          sentVia: 'user',
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });
        await bumpUsage(asset.id);

        await emitChatMessage({
          io,
          orgId: user.orgId,
          accountId: conversation.zaloAccountId,
          conversationId: conversation.id,
          message: msg,
          privacyMode: conversation.zaloAccount.privacyMode,
          ownerUserId: conversation.zaloAccount.ownerUserId,
        });
        return { message: msg };
      } catch (err: any) {
        logger.error('[media] send error:', err);
        return reply.status(500).send({ error: err?.message ?? 'send failed' });
      } finally {
        await tmp?.cleanup().catch(() => {});
      }
    },
  );

  // ── PATCH /api/v1/media/:id — sửa quyền/tên/tag (GĐ2) ──────────────────────
  app.patch(
    '/api/v1/media/:id',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; visibility?: 'private' | 'public'; tagIds?: string[]; folderId?: string | null };

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media (hoặc không thuộc bạn)' });

      // PRIVACY: asset lưu từ nick Riêng tư → KHÔNG cho đổi sang public (chống lộ PII khách).
      if (body.visibility === 'public' && asset.sourceZaloAccountId) {
        return reply.status(403).send({
          error: 'Ảnh lưu từ nick Riêng tư — không thể chuyển Công khai (bảo vệ thông tin khách).',
          code: 'PRIVACY_LOCKED',
        });
      }

      const updated = await prisma.mediaAsset.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
          ...(body.tagIds !== undefined ? { tagIds: body.tagIds } : {}),
          ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
        },
      });
      return { asset: { id: updated.id, name: updated.name, visibility: updated.visibility, tagIds: updated.tagIds } };
    },
  );

  // ── DELETE /api/v1/media/:id — archive (xóa MỀM, giữ object MinIO) ─────────
  // archive: grant 'edit' đủ (sale archive ảnh CỦA MÌNH). Xóa của người khác cần
  // view_all (admin/marketing). delete grant không bắt buộc — archive ≠ hard delete.
  app.delete(
    '/api/v1/media/:id',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });
      // INVARIANT: archive thôi, KHÔNG xóa object MinIO (giữ lịch sử chat cũ trỏ tới).
      await prisma.mediaAsset.update({ where: { id }, data: { archivedAt: new Date() } });
      return { ok: true };
    },
  );

  // ── POST /api/v1/media/:id/watermark — đóng dấu logo HS (sinh variant) ─────
  app.post(
    '/api/v1/media/:id/watermark',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { position?: any; opacity?: number };

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });
      try {
        const res = await generateWatermarkVariant({
          orgId: user.orgId, assetId: id, position: body.position, opacity: body.opacity,
        });
        return { blobId: res.blobId, url: res.url };
      } catch (err: any) {
        logger.error('[media] watermark error:', err);
        return reply.status(400).send({ error: err?.message ?? 'watermark failed' });
      }
    },
  );

  // ── GET /api/v1/media/folders — cây thư mục (scope owner + visibility) ─────
  app.get(
    '/api/v1/media/folders',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const folders = await prisma.mediaAlbum.findMany({
        where: {
          orgId: user.orgId,
          ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, kind: true, visibility: true, ownerUserId: true },
      });
      return { folders };
    },
  );

  // ── POST /api/v1/media/folders — tạo thư mục ──────────────────────────────
  app.post(
    '/api/v1/media/folders',
    { preHandler: requireGrant('media', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { name: string; visibility?: 'private' | 'public' };
      if (!body?.name?.trim()) return reply.status(400).send({ error: 'Tên thư mục bắt buộc' });
      const folder = await prisma.mediaAlbum.create({
        data: {
          orgId: user.orgId,
          name: body.name.trim(),
          kind: 'folder',
          visibility: body.visibility ?? 'private',
          ownerUserId: userId,
          createdById: userId,
        },
      });
      return { folder: { id: folder.id, name: folder.name } };
    },
  );
}
