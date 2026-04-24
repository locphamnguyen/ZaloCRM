/**
 * chat-attachment-routes.ts — Upload chat attachments (image/video) and send via Zalo.
 * Accepts multipart form with 1+ files + optional caption.
 * Flow: validate → save to tmp → upload to MinIO → call zca-js sendImage/sendVideo with local path → persist Message rows.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { sendNativeVideo } from '../../shared/video-processor.js';
import { uploadBuffer, type UploadResult } from '../../shared/storage/minio-client.js';
import { logger } from '../../shared/utils/logger.js';

const IMAGE_MAX = 100 * 1024 * 1024;
const VIDEO_MAX = 500 * 1024 * 1024;
const FILE_MAX = 1024 * 1024 * 1024;
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_FILE = [
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

      const instance = zaloPool.getInstance(conversation.zaloAccountId);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

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
            const msg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: id,
                zaloMsgId: zaloMsgId || null,
                senderType: 'self',
                senderUid: conversation.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: JSON.stringify({ href: mirror.url, thumb: mirror.url, size: mirror.size }),
                contentType: 'image',
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
            });
            created.push(msg);
          }
        }

        // Send videos one-by-one using native sendVideo
        for (const i of videoIndexes) {
          zaloRateLimiter.recordSend(conversation.zaloAccountId);
          try {
            const sendResult: any = await sendNativeVideo({
              api: instance.api as any,
              videoPath: tmpPaths[i],
              threadId,
              threadType: threadType as 0 | 1,
              message: caption,
            });
            const zaloMsgId = String((sendResult as any)?.msgId || (sendResult as any)?.data?.msgId || '');
            const mirror = mirrors[i];
            const msg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: id,
                zaloMsgId: zaloMsgId || null,
                senderType: 'self',
                senderUid: conversation.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: JSON.stringify({ href: mirror.url, thumb: mirror.url, size: mirror.size }),
                contentType: 'video',
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
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
            const msg = await prisma.message.create({
              data: {
                id: randomUUID(),
                conversationId: id,
                zaloMsgId: zaloMsgId || null,
                senderType: 'self',
                senderUid: conversation.zaloAccount.zaloUid || '',
                senderName: 'Staff',
                content: JSON.stringify({ href: mirror.url, thumb: mirror.url, size: mirror.size }),
                contentType: 'video',
                sentAt: new Date(),
                repliedByUserId: user.id,
              },
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
          const msg = await prisma.message.create({
            data: {
              id: randomUUID(),
              conversationId: id,
              zaloMsgId: zaloMsgId || null,
              senderType: 'self',
              senderUid: conversation.zaloAccount.zaloUid || '',
              senderName: 'Staff',
              content: JSON.stringify({ href: mirror.url, name: f.filename, size: mirror.size, mime: f.mimeType }),
              contentType: 'file',
              sentAt: new Date(),
              repliedByUserId: user.id,
            },
          });
          created.push(msg);
        }

        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
        });

        for (const m of created) {
          io?.emit('chat:message', { accountId: conversation.zaloAccountId, message: m, conversationId: id });
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
