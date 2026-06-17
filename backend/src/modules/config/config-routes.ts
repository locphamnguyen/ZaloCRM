/**
 * config-routes.ts — Client config endpoint.
 * GET /api/v1/config (auth) trả về MIME whitelist + size limit upload để FE/mobile
 * validate trước khi gửi (DRY: tái dùng hằng từ chat-attachment-routes, không copy).
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  ALLOWED_IMAGE,
  ALLOWED_VIDEO,
  ALLOWED_FILE,
  IMAGE_MAX,
  VIDEO_MAX,
  FILE_MAX,
} from '../chat/chat-attachment-routes.js';

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/config', { preHandler: authMiddleware }, async () => {
    return {
      upload: {
        maxFileSizeGlobal: 524288000, // 500MB — app.ts multipart fileSize limit
        maxFilesPerRequest: 10, // app.ts multipart files limit
        image: { mimeTypes: ALLOWED_IMAGE, maxSize: IMAGE_MAX },
        video: { mimeTypes: ALLOWED_VIDEO, maxSize: VIDEO_MAX },
        file: { mimeTypes: ALLOWED_FILE, maxSize: FILE_MAX },
      },
    };
  });
}
