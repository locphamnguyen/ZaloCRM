// Mẫu tin nhắn (MessageTemplate) — câu mẫu sale gửi tay trong chat (gõ "/").
//
// NÂNG CẤP 2026-06-09 (Anh chốt) đồng bộ Khối: folder + visibility per-item + tagIds
// (4 tag dự án) + contentRich {text, styles[]} (định dạng Zalo đậm/màu/cỡ).
//
// Quyền GỘP CHUNG resource 'block' + mô hình "LÀ CHỦ HOẶC CÓ GRANT":
//   - Tạo/sửa/xóa mẫu RIÊNG của mình (visibility='private', createdById=user.id) → KHÔNG cần grant.
//   - Tạo/đăng mẫu CÔNG KHAI (visibility='public') hoặc đụng mẫu người khác → cần grant block.{create|edit|delete}.
//   - Chuyển private → public PHẢI có grant block.create (chống lách: tạo private free rồi tự công khai).
//
// `content` (plain, dùng search + chèn chat) LUÔN derive = contentRich.text ở route — KHÔNG nhận rời từ FE.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { getOwnerScope } from '../rbac/owner-scope.js';
import { logger } from '../../shared/utils/logger.js';
import { AVAILABLE_VARIABLES } from './template-renderer.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Greeting vars (single-brace) — đồng bộ blocks/render-template.ts (anh chốt 2026-05-28). */
const GREETING_VARIABLES = [
  { token: '{gender}', label: 'Xưng hô (Anh/Chị)', sample: 'Anh' },
  { token: '{name}', label: 'Tên khách', sample: 'Thành' },
  { token: '{sale}', label: 'Tên sale', sample: 'Ngọc' },
];

type RichPayload = { text: string; styles?: Array<{ st: string; start: number; len: number }> };

/** Trích plain text từ contentRich; LUÔN là nguồn chuẩn của field content. */
function deriveContent(body: Record<string, unknown>): { content: string; contentRich: RichPayload | null } {
  const rich = body.contentRich as RichPayload | undefined;
  if (rich && typeof rich.text === 'string') {
    const styles = Array.isArray(rich.styles) ? rich.styles : [];
    return { content: rich.text, contentRich: { text: rich.text, styles } };
  }
  // Fallback mẫu chỉ có content plain (legacy / API cũ)
  const content = typeof body.content === 'string' ? body.content : '';
  return { content, contentRich: null };
}

/**
 * Chuẩn hóa từ khóa gõ tắt: bỏ "/" đầu, bỏ khoảng trắng, về lowercase, bỏ dấu tiếng Việt.
 * Vd "Giá EGV" → "giaegv". Trả null nếu rỗng. Sale gõ "/giaegv" → match prefix.
 */
function normalizeShortcut(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .trim()
    .replace(/^\/+/, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // bỏ dấu tiếng Việt
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return s || null;
}

/**
 * Fragment Prisma where lọc mẫu user được THẤY/DÙNG (READ scope).
 * canViewAll → {} (thấy hết org). Sale:
 *   - mẫu CÔNG KHAI (visibility='public' hoặc folder public),
 *   - mẫu RIÊNG của chính mình (createdById=user.id hoặc ownerUserId legacy),
 *   - mẫu trong folder RIÊNG của mình.
 * QUY TẮC: READ gồm public; WRITE/ownership KHÔNG bao giờ gồm public của người khác.
 */
function templateVisibilityWhere(
  ownerScope: { canViewAll: boolean },
  userId: string,
): Record<string, unknown> {
  if (ownerScope.canViewAll) return {};
  return {
    OR: [
      { visibility: 'public' },
      { folder: { visibility: 'public' } },
      { createdById: userId },
      { ownerUserId: userId }, // legacy team/personal
      { folder: { visibility: 'private', ownerUserId: userId } },
    ],
  };
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /variables — register before /:id to avoid shadowing
  app.get('/api/v1/automation/templates/variables', async () => {
    return { greeting: GREETING_VARIABLES, legacy: AVAILABLE_VARIABLES };
  });

  // GET /templates — list visible to current user (public + own private), with filters
  app.get('/api/v1/automation/templates', async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;

    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'block',
    });

    // base filter
    const and: Record<string, unknown>[] = [{ orgId: user.orgId }];
    if (q.includeArchived !== 'true') and.push({ archivedAt: null });
    if (q.folderId) and.push({ folderId: q.folderId });
    if (q.visibility) and.push({ visibility: q.visibility });
    if (q.category) and.push({ category: q.category });
    if (q.tags) {
      const tagList = q.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) and.push({ tagIds: { hasSome: tagList } });
    }
    if (q.search) {
      and.push({
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { content: { contains: q.search, mode: 'insensitive' } },
          { shortcut: { contains: q.search, mode: 'insensitive' } },
        ],
      });
    }
    // visibility scope (AND-of-OR — không nuốt filter khác)
    const visWhere = templateVisibilityWhere(ownerScope, user.id);
    if (Object.keys(visWhere).length > 0) and.push(visWhere);

    const templates = await prisma.messageTemplate.findMany({
      where: { AND: and },
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.min(Number(q.limit) || 200, 500),
      select: {
        id: true, name: true, shortcut: true, content: true, contentRich: true, category: true,
        folderId: true, visibility: true, tagIds: true, ownerUserId: true, createdById: true,
        usageCount: true, manualSendCount: true, createdAt: true, updatedAt: true,
        folder: { select: { id: true, name: true, visibility: true } },
      },
    });

    return {
      templates: templates.map((t) => ({
        ...t,
        isPersonal: t.visibility === 'private',
        // FE quyết hiện nút Sửa/Xóa = canAccess('block','edit') AND (isMine OR canViewAll)
        isMine: t.createdById === user.id || t.ownerUserId === user.id,
      })),
    };
  });

  // POST /templates — create. "Là chủ HOẶC có grant".
  app.post('/api/v1/automation/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, unknown>;
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }

      const { content, contentRich } = deriveContent(body);
      if (!content.trim()) {
        return reply.status(400).send({ error: 'content is required' });
      }

      const visibility = body.visibility === 'public' ? 'public' : 'private';
      // Tạo CÔNG KHAI → cần grant block.create. Tạo RIÊNG → mọi sale tạo được (chủ tự quản).
      if (visibility === 'public') {
        const ok = await userHasGrant(user.id, 'block', 'create');
        if (!ok) {
          return reply.status(403).send({
            error: 'Cần quyền tạo nội dung Khối để đăng mẫu CÔNG KHAI. Mẫu Riêng tư thì tạo được luôn.',
            code: 'RBAC_FORBIDDEN', resource: 'block', action: 'create',
          });
        }
      }

      // Validate folder thuộc org + (nếu public) folder phải public
      let folderId: string | null = null;
      if (typeof body.folderId === 'string' && body.folderId) {
        const folder = await prisma.messageTemplateFolder.findFirst({
          where: { id: body.folderId, orgId: user.orgId },
          select: { id: true },
        });
        if (!folder) return reply.status(400).send({ error: 'folder not found' });
        folderId = folder.id;
      }

      const template = await prisma.messageTemplate.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          ownerUserId: visibility === 'private' ? user.id : null, // legacy mirror
          createdById: user.id,
          folderId,
          visibility,
          name: body.name.trim(),
          shortcut: normalizeShortcut(body.shortcut),
          content,
          ...(contentRich ? { contentRich: contentRich as object } : {}),
          category: typeof body.category === 'string' ? body.category : null,
          tagIds: Array.isArray(body.tagIds) ? (body.tagIds as string[]).filter((t) => typeof t === 'string') : [],
        },
      });
      return reply.status(201).send({ ...template, isPersonal: visibility === 'private', isMine: true });
    } catch (error) {
      logger.error('[template] create error:', error);
      return reply.status(500).send({ error: 'Failed to create message template' });
    }
  });

  // PUT /templates/:id — edit. Chủ sửa free; người ngoài cần grant. private→public cần grant.
  app.put('/api/v1/automation/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const existing = await prisma.messageTemplate.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, ownerUserId: true, createdById: true, visibility: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Message template not found' });

      const isMine = existing.createdById === user.id || existing.ownerUserId === user.id;
      // Sửa mẫu KHÔNG phải của mình → cần grant block.edit.
      if (!isMine) {
        const ok = await userHasGrant(user.id, 'block', 'edit');
        if (!ok) return reply.status(403).send({ error: 'Bạn không có quyền sửa mẫu này', code: 'RBAC_FORBIDDEN' });
      }

      const data: Record<string, unknown> = {};
      if (typeof body.name === 'string') data.name = body.name.trim();
      if (body.shortcut !== undefined) data.shortcut = normalizeShortcut(body.shortcut);
      if (body.contentRich !== undefined || typeof body.content === 'string') {
        const { content, contentRich } = deriveContent(body);
        data.content = content;
        if (contentRich) data.contentRich = contentRich as object;
      }
      if (body.category !== undefined) data.category = typeof body.category === 'string' ? body.category : null;
      if (Array.isArray(body.tagIds)) data.tagIds = (body.tagIds as string[]).filter((t) => typeof t === 'string');
      if (body.folderId !== undefined) data.folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : null;

      // Đổi visibility: private → public BẮT BUỘC grant block.create (chống lách quyền công khai).
      if (body.visibility === 'public' || body.visibility === 'private') {
        if (body.visibility === 'public' && existing.visibility !== 'public') {
          const ok = await userHasGrant(user.id, 'block', 'create');
          if (!ok) {
            return reply.status(403).send({
              error: 'Cần quyền tạo nội dung Khối để công khai mẫu cho cả công ty.',
              code: 'RBAC_FORBIDDEN', resource: 'block', action: 'create',
            });
          }
        }
        data.visibility = body.visibility;
        data.ownerUserId = body.visibility === 'private' ? user.id : null;
      }

      const template = await prisma.messageTemplate.update({ where: { id }, data });
      return { ...template, isPersonal: template.visibility === 'private', isMine: true };
    } catch (error) {
      logger.error('[template] update error:', error);
      return reply.status(500).send({ error: 'Failed to update message template' });
    }
  });

  // DELETE /templates/:id — soft delete (archivedAt). Chủ xóa free; người ngoài cần grant.
  app.delete('/api/v1/automation/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.messageTemplate.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, ownerUserId: true, createdById: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Message template not found' });

      const isMine = existing.createdById === user.id || existing.ownerUserId === user.id;
      if (!isMine) {
        const ok = await userHasGrant(user.id, 'block', 'delete');
        if (!ok) return reply.status(403).send({ error: 'Bạn không có quyền xóa mẫu này', code: 'RBAC_FORBIDDEN' });
      }

      await prisma.messageTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
      return { success: true };
    } catch (error) {
      logger.error('[template] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete message template' });
    }
  });

  // POST /templates/:id/track-use — tăng manualSendCount khi sale chèn mẫu xuống chat.
  app.post('/api/v1/automation/templates/:id/track-use', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const r = await prisma.messageTemplate.updateMany({
        where: { id, orgId: user.orgId },
        data: { manualSendCount: { increment: 1 }, lastManualSentAt: new Date(), usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      return { success: r.count > 0 };
    } catch (error) {
      logger.error('[template] track-use error:', error);
      return reply.status(500).send({ error: 'Failed to track template use' });
    }
  });
}
