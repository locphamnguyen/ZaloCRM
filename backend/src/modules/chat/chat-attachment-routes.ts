/**
 * chat-attachment-routes.ts — Upload chat attachments (image/video) and send via Zalo.
 * Accepts multipart form with 1+ files + optional caption.
 * Flow: validate → save to tmp → upload to MinIO → call zca-js sendImage/sendVideo with local path → persist Message rows.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'socket.io';
import { emitChatMessage } from '../../shared/realtime/emit-chat.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { generateThumbnail, sendNativeVideo } from '../../shared/video-processor.js';
import { uploadBuffer, type UploadResult } from '../../shared/storage/minio-client.js';
import { logger } from '../../shared/utils/logger.js';
// Fix 2026-06-03 — M11 optimistic badge cache (Anh báo "Sale CRM · Staff")
// 2026-06-11 — createMediaMessage gộp 4 block message.create lặp (DRY, eng review E4).
import { getUserFullName, createMediaMessage } from './chat-helpers.js';

export const IMAGE_MAX = 100 * 1024 * 1024;
export const VIDEO_MAX = 500 * 1024 * 1024;
export const FILE_MAX = 1024 * 1024 * 1024;
export const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
export const ALLOWED_FILE = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/zip', 'application/x-zip-compressed',
  'application/gzip', 'application/x-gzip',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-tar', 'application/x-gtar',
];

function isAllowed(mime: string): boolean {
  return ALLOWED_IMAGE.includes(mime) || ALLOWED_VIDEO.includes(mime) || ALLOWED_FILE.includes(mime);
}

interface ParsedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  kind: 'image' | 'video' | 'file';
  size: number;
}

function classify(mime: string): 'image' | 'video' | 'file' {
  if (ALLOWED_IMAGE.includes(mime)) return 'image';
  if (ALLOWED_VIDEO.includes(mime)) return 'video';
  return 'file';
}

export async function chatAttachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.post(
    '/api/v1/conversations/:id/attachments',
    { preHandler: requireZaloAccess('chat') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const conversation = await prisma.conversation.findFirst({
        where: { id, orgId: user.orgId },
        include: { zaloAccount: true },
      });
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

      // T7b (YC2 2026-06-20): chặn gửi file/ảnh qua nick ĐÃ XÓA (archivedAt).
      if (conversation.zaloAccount.archivedAt) {
        return reply.status(409).send({ error: 'Nick này đã bị xóa — chỉ xem lại lịch sử, không gửi được.', code: 'NICK_ARCHIVED' });
      }

      // Fix 2026-06-03 — optimistic badge "Sale CRM · {tên}"
      const userFullName = await getUserFullName(user.id);

      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

      // PRIVACY GUARD 2026-05-22: nick privacy=main → chỉ chính chủ upload được
      if (conversation.zaloAccount.privacyMode === 'main') {
        const senderUserId = (user as any).userId ?? user.id;
        if (conversation.zaloAccount.ownerUserId !== senderUserId) {
          return reply.status(403).send({
            error: 'Nick này đang bật Riêng tư — chỉ chính chủ mới gửi được file/ảnh.',
            code: 'PRIVACY_LOCKED',
          });
        }
      }

      const limits = await zaloRateLimiter.checkLimits(conversation.zaloAccountId);
      if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

      // Parse multipart parts
      let caption = '';
      const files: ParsedFile[] = [];
      try {
        for await (const part of request.parts()) {
          if (part.type === 'field' && part.fieldname === 'caption') {
            caption = String(part.value ?? '');
          } else if (part.type === 'file') {
            if (!isAllowed(part.mimetype)) {
              return reply.status(415).send({ error: `Unsupported file type: ${part.mimetype}` });
            }
            const kind = classify(part.mimetype);
            const buf = await part.toBuffer();
            const max = kind === 'image' ? IMAGE_MAX : kind === 'video' ? VIDEO_MAX : FILE_MAX;
            if (buf.length > max) {
              return reply.status(413).send({ error: `${kind} exceeds ${max / 1024 / 1024}MB` });
            }
            files.push({ buffer: buf, filename: part.filename, mimeType: part.mimetype, kind, size: buf.length });
          }
        }
      } catch (err: any) {
        return reply.status(400).send({ error: `multipart parse error: ${err?.message ?? err}` });
      }

      if (files.length === 0) return reply.status(400).send({ error: 'No files uploaded' });

      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const io = (app as any).io as Server;

      // Write each file to tmp + upload to MinIO in parallel
      const tmpRoot = path.join(tmpdir(), 'zalocrm-upload', randomUUID());
      await mkdir(tmpRoot, { recursive: true });
      const tmpPaths: string[] = [];
      const mirrors: UploadResult[] = [];
      try {
        await Promise.all(files.map(async (f, i) => {
          const tmpPath = path.join(tmpRoot, `${i}-${f.filename || 'upload'}`);
          await writeFile(tmpPath, f.buffer);
          tmpPaths[i] = tmpPath;
          mirrors[i] = await uploadBuffer(f.buffer, f.mimeType, f.filename);
        }));

        const created: any[] = [];

        // Split by kind — image batch vs video one-by-one vs file one-by-one
        const imageIndexes: number[] = [];
        const videoIndexes: number[] = [];
        const fileIndexes: number[] = [];
        files.forEach((f, i) => {
          if (f.kind === 'image') imageIndexes.push(i);
          else if (f.kind === 'video') videoIndexes.push(i);
          else fileIndexes.push(i);
        });

        // Send images as one zca-js call (supports multiple paths at once)
        if (imageIndexes.length > 0) {
          zaloRateLimiter.recordSend(conversation.zaloAccountId);
          const paths = imageIndexes.map((i) => tmpPaths[i]);
          const sendResult: any = await instance.api.sendMessage(
            { msg: caption, attachments: paths },
            threadId,
            threadType,
          );
          const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          for (const i of imageIndexes) {
            const mirror = mirrors[i];
            const msg = await createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'image',
              content: JSON.stringify({ href: mirror.url, thumb: mirror.url, size: mirror.size }),
              metadata: { sender: { kind: 'user_crm', name: userFullName } },
              sentVia: 'user',
            });
            created.push(msg);
          }
        }

        // Send videos one-by-one using native sendVideo
        for (const i of videoIndexes) {
          zaloRateLimiter.recordSend(conversation.zaloAccountId);
          let generatedThumbnail: Awaited<ReturnType<typeof generateThumbnail>> | null = null;
          let thumbnailMirror: UploadResult | null = null;
          try {
            generatedThumbnail = await generateThumbnail(tmpPaths[i]);
            const thumbnailBuffer = await readFile(generatedThumbnail.path);
            const baseName = path.parse(files[i].filename || 'video').name || 'video';
            thumbnailMirror = await uploadBuffer(thumbnailBuffer, 'image/jpeg', `${baseName}-thumbnail.jpg`);
          } catch (err) {
            logger.warn('[chat-attachment] Video thumbnail generation failed:', err);
          }
          try {
            const sendResult: any = await sendNativeVideo({
              api: instance.api as any,
              videoPath: tmpPaths[i],
              thumbnailPath: generatedThumbnail?.path,
              threadId,
              threadType: threadType as 0 | 1,
              message: caption,
            });
            const zaloMsgId = String((sendResult as any)?.msgId || (sendResult as any)?.data?.msgId || '');
            const mirror = mirrors[i];
            const thumbUrl = thumbnailMirror?.url ?? mirror.url;
            const msg = await createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'video',
              content: JSON.stringify({ href: mirror.url, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: mirror.size }),
              metadata: { sender: { kind: 'user_crm', name: userFullName } },
              sentVia: 'user',
            });
            created.push(msg);
          } catch (err) {
            logger.error('[chat-attachment] Native video send failed, trying fallback:', err);
            // Fallback: regular attachment send
            const sendResult: any = await zaloOps.sendFile(
              conversation.zaloAccountId,
              threadId,
              threadType as 0 | 1,
              [tmpPaths[i]],
              io,
            );
            const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
            const mirror = mirrors[i];
            const thumbUrl = thumbnailMirror?.url ?? mirror.url;
            const msg = await createMediaMessage({
              conversationId: id,
              zaloAccount: conversation.zaloAccount,
              repliedByUserId: user.id,
              zaloMsgId,
              contentType: 'video',
              content: JSON.stringify({ href: mirror.url, thumb: thumbUrl, thumbUrl, thumbnail: thumbUrl, size: mirror.size }),
              metadata: { sender: { kind: 'user_crm', name: userFullName } },
              sentVia: 'user',
            });
            created.push(msg);
          }
        }

        // Send files (generic) one-by-one
        for (const i of fileIndexes) {
          zaloRateLimiter.recordSend(conversation.zaloAccountId);
          const sendResult: any = await zaloOps.sendFile(
            conversation.zaloAccountId,
            threadId,
            threadType as 0 | 1,
            [tmpPaths[i]],
            io,
            caption,
          );
          const zaloMsgId = String(sendResult?.msgId || sendResult?.data?.msgId || '');
          const mirror = mirrors[i];
          const f = files[i];
          const msg = await createMediaMessage({
            conversationId: id,
            zaloAccount: conversation.zaloAccount,
            repliedByUserId: user.id,
            zaloMsgId,
            contentType: 'file',
            content: JSON.stringify({ href: mirror.url, name: f.filename, size: mirror.size, mime: f.mimeType }),
          });
          created.push(msg);
        }

        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });

        for (const m of created) {
          // PRIVACY 2026-06-11: redact + scope org (emit-chat). Nick main → URL file
          // KHÔNG ra room org (chỉ chính chủ đã unlock nhận bản thật).
          await emitChatMessage({
            io,
            orgId: user.orgId,
            accountId: conversation.zaloAccountId,
            conversationId: id,
            message: m,
            privacyMode: conversation.zaloAccount.privacyMode,
            ownerUserId: conversation.zaloAccount.ownerUserId,
          });
        }

        return { messages: created };
      } catch (err: any) {
        logger.error('[chat-attachment] upload error:', err);
        return reply.status(500).send({ error: err?.message ?? 'attachment send failed' });
      } finally {
        // Clean tmp files (best effort)
        for (const p of tmpPaths) {
          if (p) await unlink(p).catch(() => {});
        }
      }
    },
  );
}
