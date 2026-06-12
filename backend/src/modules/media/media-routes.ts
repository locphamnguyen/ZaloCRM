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
import { registerAsset, bumpUsage, resolveSavedVisibility, generateWatermarkVariant, disableWatermark, logMediaUsage, type MediaKind } from './media-service.js';
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
        include: { blobs: { where: { variantType: { in: ['original', 'watermarked'] } } } },
      });

      // Bộ ảnh yêu thích của user (để FE hiện trạng thái ⭐ ngay trong list/panel).
      const favAlbum = await prisma.mediaAlbum.findFirst({
        where: { orgId: user.orgId, ownerUserId: userId, kind: 'favorite' }, select: { id: true },
      });
      const favSet = new Set<string>();
      if (favAlbum) {
        const favItems = await prisma.mediaAlbumItem.findMany({
          where: { albumId: favAlbum.id }, select: { mediaAssetId: true },
        });
        for (const fi of favItems) favSet.add(fi.mediaAssetId);
      }

      const items = assets.map((a) => {
        const blob = a.blobs.find((b) => b.variantType === 'original');
        const wm = a.blobs.find((b) => b.variantType === 'watermarked');
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
          // Watermark per-ảnh (GĐ2).
          watermarkEnabled: a.watermarkEnabled,
          watermarkPosition: a.watermarkPosition,
          watermarkOpacity: a.watermarkOpacity,
          watermarkUrl: wm?.publicUrl ?? null,
          // D11: ảnh lưu từ nick Riêng tư → FE hỏi xác nhận trước khi chia sẻ công khai.
          sourceFromPrivateNick: !!a.sourceZaloAccountId,
          favorited: favSet.has(a.id),
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
        // AUDIT privacy (S8): ghi log "Lưu từ chat" + nguồn nick (riêng tư hay không).
        logger.info(`[media][audit] save_from_chat asset=${res.asset.id} user=${userId} visibility=${vis.visibility} fromPrivateNick=${isPrivateNick} deduped=${res.deduped}`);
        await logMediaUsage({
          orgId: user.orgId, mediaAssetId: res.asset.id, eventType: 'saved_from_chat', userId,
          conversationId: message.conversationId,
          meta: { visibility: vis.visibility, fromPrivateNick: isPrivateNick, deduped: res.deduped },
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
        include: { blobs: { where: { variantType: { in: ['original', 'watermarked'] } } } },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media trong kho' });
      // WATERMARK BẬT → gửi bản có logo; ngược lại gửi bản gốc. (Ảnh mới đóng dấu được.)
      const original = asset.blobs.find((b) => b.variantType === 'original');
      const watermarked = asset.blobs.find((b) => b.variantType === 'watermarked');
      const blob = (asset.kind === 'image' && asset.watermarkEnabled && watermarked) ? watermarked : original;
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
        // KHÔNG truyền filename=asset.name (name "Lưu từ chat" KHÔNG có đuôi → temp mất
        // đuôi → Zalo coi ảnh thành FILE). Để downloadMediaToTemp lấy tên từ URL (media/{hash}.webp).
        tmp = await downloadMediaToTemp({ url: blob.publicUrl }, asset.kind);
        zaloRateLimiter.recordSend(conversation.zaloAccountId);

        // Guard nick connected ở trên. Gửi qua zaloOps (check status + reconnect).
        let zaloMsgId = '';
        let content = '';
        if (asset.kind === 'image') {
          // ẢNH: sendImage (đã fix có msg) → temp CÓ đuôi .webp → Zalo nhận ẢNH INLINE.
          const sendResult: any = await zaloOps.sendImage(
            conversation.zaloAccountId, threadId, threadType as 0 | 1, [tmp.path], io, caption,
          );
          zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          content = JSON.stringify({ href: blob.publicUrl, thumb: blob.publicUrl, size: blob.sizeBytes });
        } else {
          // VIDEO/FILE: gửi qua sendFile (zca-js đọc local path → đính kèm file/video).
          const sendResult: any = await zaloOps.sendFile(
            conversation.zaloAccountId, threadId, threadType as 0 | 1, [tmp.path], io, caption,
          );
          zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
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
        await logMediaUsage({
          orgId: user.orgId, mediaAssetId: asset.id, eventType: 'sent_chat',
          userId, conversationId: conversation.id,
          meta: { watermarked: blob.variantType === 'watermarked' },
        });

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
      const body = request.body as {
        name?: string; visibility?: 'private' | 'public';
        tagIds?: string[]; folderId?: string | null; confirmShare?: boolean;
      };

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media (hoặc không thuộc bạn)' });

      // PRIVACY (D11 — anh chốt 2026-06-12: HỎI XÁC NHẬN thay vì chặn cứng):
      // Ảnh lưu từ nick Riêng tư → chuyển Công khai PHẢI kèm confirmShare=true (FE đã hiện
      // dialog "có thể chứa thông tin khách — chắc chắn chia sẻ?"). Thiếu → trả NEED_CONFIRM.
      const sharingPrivateNickAsset = body.visibility === 'public' && asset.sourceZaloAccountId;
      if (sharingPrivateNickAsset && !body.confirmShare) {
        return reply.status(409).send({
          error: 'Ảnh lưu từ nick Riêng tư — cần xác nhận trước khi chia sẻ Công khai.',
          code: 'NEED_SHARE_CONFIRM',
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

      // AUDIT privacy (S8): chuyển sang Công khai → ghi log (đặc biệt ảnh từ nick Riêng tư).
      if (body.visibility === 'public') {
        logger.info(`[media][audit] make_public asset=${id} user=${userId} fromPrivateNick=${!!asset.sourceZaloAccountId}`);
        await logMediaUsage({
          orgId: user.orgId, mediaAssetId: id, eventType: 'made_public', userId,
          meta: { fromPrivateNick: !!asset.sourceZaloAccountId, confirmed: !!body.confirmShare },
        });
      }
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

  // ── DELETE /api/v1/media/:id/watermark — TẮT watermark (gửi lại ảnh gốc) ────
  app.delete(
    '/api/v1/media/:id/watermark',
    { preHandler: requireGrant('media', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { ownerUserId: userId }) },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });
      try {
        await disableWatermark(user.orgId, id);
        return { ok: true };
      } catch (err: any) {
        logger.error('[media] disable watermark error:', err);
        return reply.status(400).send({ error: err?.message ?? 'disable watermark failed' });
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

  // ── GET /api/v1/media/suggest?conversationId= — gợi ý ảnh theo NGỮ CẢNH (GĐ3a-4)
  // Match MediaAsset.tagIds với tag/dự án của Contact đang chat. Chỉ ảnh CÔNG KHAI
  // hoặc CỦA CHÍNH sale (không lộ ảnh riêng tư người khác — privacy).
  app.get(
    '/api/v1/media/suggest',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const q = request.query as { conversationId?: string };
      if (!q.conversationId) return { items: [], matchedTags: [] };

      const conv = await prisma.conversation.findFirst({
        where: { id: q.conversationId, orgId: user.orgId },
        include: { contact: { select: { tags: true, autoTags: true } } },
      });
      if (!conv?.contact) return { items: [], matchedTags: [] };

      // Gom tag khách (manual + auto, lowercase). Bỏ prefix 'auto:'.
      const raw = [
        ...(Array.isArray(conv.contact.tags) ? conv.contact.tags : []),
        ...(Array.isArray(conv.contact.autoTags) ? conv.contact.autoTags : []),
      ].map((t) => String(t).replace(/^auto:/, '').trim().toLowerCase()).filter(Boolean);
      const custTags = [...new Set(raw)];
      if (custTags.length === 0) return { items: [], matchedTags: [] };

      // Ảnh kho có tagIds giao với tag khách + (public HOẶC của mình) + chưa archive.
      const assets = await prisma.mediaAsset.findMany({
        where: {
          orgId: user.orgId,
          archivedAt: null,
          kind: 'image',
          OR: [{ visibility: 'public' }, { ownerUserId: userId }],
        },
        orderBy: [{ usageCount: 'desc' }],
        take: 50,
        include: { blobs: { where: { variantType: 'original' }, take: 1 } },
      });

      // Lọc app-side: asset có ÍT NHẤT 1 tag khớp tag khách (so lowercase).
      const matched = assets
        .map((a) => ({ a, hits: a.tagIds.filter((t) => custTags.includes(t.toLowerCase())) }))
        .filter((x) => x.hits.length > 0)
        .slice(0, 8);

      const items = matched.map(({ a }) => ({
        id: a.id, name: a.name, kind: a.kind,
        url: a.blobs[0]?.publicUrl ?? null,
        thumbnailUrl: a.thumbnailUrl ?? a.blobs[0]?.publicUrl ?? null,
        tagIds: a.tagIds,
      }));
      return { items, matchedTags: [...new Set(matched.flatMap((m) => m.hits))] };
    },
  );

  // ── GET /api/v1/media/stats — top ảnh hay dùng + tổng quan (GĐ4 đo hiệu quả) ──
  app.get(
    '/api/v1/media/stats',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const scope = canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] };

      // Top 10 ảnh dùng nhiều nhất.
      const top = await prisma.mediaAsset.findMany({
        where: { orgId: user.orgId, archivedAt: null, usageCount: { gt: 0 }, ...scope },
        orderBy: { usageCount: 'desc' },
        take: 10,
        include: { blobs: { where: { variantType: 'original' }, take: 1 } },
      });

      // Tổng quan: số asset, tổng lượt dùng, ước lượng tiết kiệm (số blob vs số lần dùng).
      const totalAssets = await prisma.mediaAsset.count({ where: { orgId: user.orgId, archivedAt: null, ...scope } });
      const agg = await prisma.mediaAsset.aggregate({
        where: { orgId: user.orgId, archivedAt: null, ...scope },
        _sum: { usageCount: true },
      });
      const totalUsage = agg._sum.usageCount ?? 0;

      return {
        totalAssets,
        totalUsage,
        topUsed: top.map((a) => ({
          id: a.id, name: a.name, kind: a.kind, usageCount: a.usageCount,
          thumbnailUrl: a.thumbnailUrl ?? a.blobs[0]?.publicUrl ?? null,
        })),
      };
    },
  );

  // ── Bộ sưu tập YÊU THÍCH cá nhân (GĐ5) — MediaAlbum kind='favorite', 1/user ─
  async function getOrCreateFavoriteAlbum(orgId: string, userId: string) {
    let fav = await prisma.mediaAlbum.findFirst({ where: { orgId, ownerUserId: userId, kind: 'favorite' } });
    if (!fav) {
      fav = await prisma.mediaAlbum.create({
        data: { orgId, name: '⭐ Yêu thích của tôi', kind: 'favorite', visibility: 'private', ownerUserId: userId, createdById: userId },
      });
    }
    return fav;
  }

  // POST /media/:id/favorite — toggle yêu thích (thêm/bỏ khỏi bộ sưu tập cá nhân).
  app.post(
    '/api/v1/media/:id/favorite',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const { id } = request.params as { id: string };
      // asset phải thuộc org + thấy được (của mình hoặc public).
      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const asset = await prisma.mediaAsset.findFirst({
        where: { id, orgId: user.orgId, archivedAt: null, ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }) },
        select: { id: true },
      });
      if (!asset) return reply.status(404).send({ error: 'Không tìm thấy media' });

      const fav = await getOrCreateFavoriteAlbum(user.orgId, userId);
      const existing = await prisma.mediaAlbumItem.findUnique({
        where: { albumId_mediaAssetId: { albumId: fav.id, mediaAssetId: id } },
      });
      if (existing) {
        await prisma.mediaAlbumItem.delete({ where: { id: existing.id } });
        return { favorited: false };
      }
      await prisma.mediaAlbumItem.create({ data: { albumId: fav.id, mediaAssetId: id } });
      return { favorited: true };
    },
  );

  // GET /media/favorites — danh sách ảnh yêu thích của user.
  app.get(
    '/api/v1/media/favorites',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const fav = await prisma.mediaAlbum.findFirst({ where: { orgId: user.orgId, ownerUserId: userId, kind: 'favorite' } });
      if (!fav) return { items: [] };
      const items = await prisma.mediaAlbumItem.findMany({
        where: { albumId: fav.id, asset: { archivedAt: null } },
        include: { asset: { include: { blobs: { where: { variantType: 'original' }, take: 1 } } } },
        orderBy: { createdAt: 'desc' },
        take: 40,
      });
      return {
        items: items.map(({ asset: a }) => ({
          id: a.id, name: a.name, kind: a.kind, visibility: a.visibility,
          url: a.blobs[0]?.publicUrl ?? null,
          thumbnailUrl: a.thumbnailUrl ?? a.blobs[0]?.publicUrl ?? null,
          usageCount: a.usageCount,
        })),
      };
    },
  );

  // POST /media/album/send — gửi NHIỀU asset (cả album) vào 1 hội thoại 1 lần (GĐ5).
  app.post(
    '/api/v1/media/album/send',
    { preHandler: requireGrant('media', 'access') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const userId = (user as any).userId ?? user.id;
      const body = request.body as { assetIds: string[]; conversationId: string; caption?: string };
      if (!body?.assetIds?.length || !body.conversationId) return reply.status(400).send({ error: 'assetIds + conversationId required' });
      if (body.assetIds.length > 12) return reply.status(400).send({ error: 'Tối đa 12 ảnh/lần' });

      const canViewAll = await userHasGrant(userId, 'media', 'view_all');
      const assets = await prisma.mediaAsset.findMany({
        where: { id: { in: body.assetIds }, orgId: user.orgId, archivedAt: null, kind: 'image',
          ...(canViewAll ? {} : { OR: [{ ownerUserId: userId }, { visibility: 'public' }] }) },
        include: { blobs: { where: { variantType: { in: ['original', 'watermarked'] } } } },
      });
      if (assets.length === 0) return reply.status(404).send({ error: 'Không có ảnh hợp lệ' });

      // Chọn variant đúng cho từng ảnh: watermark BẬT → bản có logo, ngược lại bản gốc.
      const pickBlob = (a: typeof assets[number]) => {
        const orig = a.blobs.find((b) => b.variantType === 'original');
        const wm = a.blobs.find((b) => b.variantType === 'watermarked');
        return (a.watermarkEnabled && wm) ? wm : orig;
      };

      const conversation = await prisma.conversation.findFirst({
        where: { id: body.conversationId, orgId: user.orgId }, include: { zaloAccount: true },
      });
      if (!conversation) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });
      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api || instance.status !== 'connected') {
        return reply.status(400).send({ error: 'Nick Zalo chưa kết nối', code: 'NICK_NOT_CONNECTED' });
      }
      if (conversation.zaloAccount.privacyMode === 'main' && conversation.zaloAccount.ownerUserId !== userId) {
        return reply.status(403).send({ error: 'Nick Riêng tư — chỉ chính chủ gửi.', code: 'PRIVACY_LOCKED' });
      }
      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;
      const userFullName = await getUserFullName(user.id);

      // download tất cả ảnh về temp → gửi 1 lần (sendFile nhiều path).
      const tmps: Array<{ path: string; cleanup: () => Promise<void> }> = [];
      try {
        for (const a of assets) {
          const blob = pickBlob(a);
          if (!blob) continue;
          // KHÔNG truyền filename (name mất đuôi → file lạ). Để lấy đuôi .webp từ URL.
          const tmp = await downloadMediaToTemp({ url: blob.publicUrl }, 'image');
          tmps.push(tmp);
        }
        zaloRateLimiter.recordSend(conversation.zaloAccountId);
        // sendImage (KHÔNG sendFile) → album ảnh inline, không thành file.
        const sendResult: any = await zaloOps.sendImage(
          conversation.zaloAccountId, threadId, threadType as 0 | 1, tmps.map((t) => t.path), io, body.caption ?? '',
        );
        const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
        const msg = await createMediaMessage({
          conversationId: conversation.id, zaloAccount: conversation.zaloAccount, repliedByUserId: user.id,
          zaloMsgId, contentType: 'image',
          content: JSON.stringify({ href: assets[0].blobs[0]?.publicUrl, album: true, count: assets.length }),
          metadata: { sender: { kind: 'user_crm', name: userFullName } }, sentVia: 'user',
        });
        await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 } });
        for (const a of assets) {
          await bumpUsage(a.id);
          await logMediaUsage({
            orgId: user.orgId, mediaAssetId: a.id, eventType: 'sent_album',
            userId, conversationId: conversation.id, meta: { albumCount: assets.length },
          });
        }
        await emitChatMessage({ io, orgId: user.orgId, accountId: conversation.zaloAccountId, conversationId: conversation.id, message: msg, privacyMode: conversation.zaloAccount.privacyMode, ownerUserId: conversation.zaloAccount.ownerUserId });
        return { message: msg, sent: assets.length };
      } catch (err: any) {
        logger.error('[media] album send error:', err);
        return reply.status(500).send({ error: err?.message ?? 'gửi album lỗi' });
      } finally {
        for (const t of tmps) await t.cleanup().catch(() => {});
      }
    },
  );
}
