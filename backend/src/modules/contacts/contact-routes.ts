/**
 * contact-routes.ts — REST API for CRM contact management.
 * Supports list, detail, create, update, delete, pipeline view, and tag updates.
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { mergeContacts } from './merge-service.js';
import { runContactIntelligence } from './contact-intelligence.js';
import { backfillGlobalId, backfillOrphanFriends } from './backfill-global-id.js';
import { migrateStatusTable } from './status-migration.js';
import { computeAggregateDisplay, AGGREGATE_INCLUDE } from './contact-aggregate-display.js';
import { runAutomationRules } from '../automation/automation-service.js';

type QueryParams = Record<string, string>;

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts — list with filters and pagination ───────────────
  app.get('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        page = '1',
        limit = '50',
        search = '',
        source = '',
        status = '',
        assignedUserId = '',
      } = request.query as QueryParams;

      const where: any = { orgId: user.orgId, mergedInto: null };
      // Model B: mỗi Contact tự nó là "KH Cha"; con = Friend rows. KHÔNG filter parentContactId.
      if (source) where.source = source;
      if (status) where.status = status;
      if (assignedUserId) where.assignedUserId = assignedUserId;
      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { crmName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          include: {
            assignedUser: { select: { id: true, fullName: true, email: true } },
            _count: { select: { conversations: true, appointments: true } },
            ...AGGREGATE_INCLUDE,
          },
          orderBy: { updatedAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.contact.count({ where }),
      ]);

      // Aggregate counts per relationshipKind từ friends đã include sẵn.
      // Model B: friends = "KH Con". Hiển thị 4 chip nick chăm trên master row.
      const enriched = contacts.map((c) => {
        const nicksByKind: Record<string, number> = {};
        for (const f of c.friends ?? []) {
          nicksByKind[f.relationshipKind] = (nicksByKind[f.relationshipKind] || 0) + 1;
        }
        const display = computeAggregateDisplay(c);
        return { ...c, nicksByKind, ...display };
      });

      return { contacts: enriched, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  // ── GET /api/v1/contacts/pipeline — kanban grouped by generic status ──────
  app.get('/api/v1/contacts/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const orgId = user.orgId;

      const pipeline = await prisma.contact.groupBy({
        by: ['status'],
        where: { orgId, status: { not: null }, mergedInto: null },
        _count: true,
      });

      // Fetch contacts per status for kanban cards (limit 20 per column)
      const statuses = pipeline.map((g) => g.status ?? 'unknown');
      const contactsByStatus: Record<string, any[]> = {};

      await Promise.all(
        statuses.map(async (st) => {
          const where: any = { orgId, status: st ?? null, mergedInto: null };
          const contacts = await prisma.contact.findMany({
            where,
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              avatarUrl: true,
              status: true,
              nextAppointment: true,
              assignedUser: { select: { id: true, fullName: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          });
          contactsByStatus[st ?? 'unknown'] = contacts;
        }),
      );

      const result = pipeline.map((g) => ({
        status: g.status ?? 'unknown',
        count: g._count,
        contacts: contactsByStatus[g.status ?? 'unknown'] ?? [],
      }));

      return { pipeline: result };
    } catch (err) {
      logger.error('[contacts] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline' });
    }
  });

  // ── GET /api/v1/contacts/:id — detail + friends (per nick) + appointments ──
  // Model B: KH Con = Friend row. Cha aggregate displayStatus/displayLeadScore/
  // displayHasZalo từ friends (xem contact-aggregate-display.ts).
  app.get('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const contact = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
          ...AGGREGATE_INCLUDE,
        },
      });

      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const display = computeAggregateDisplay(contact);
      return { ...contact, ...display };
    } catch (err) {
      logger.error('[contacts] Detail error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });

  // ── POST /api/v1/contacts — create new contact ────────────────────────────
  app.post('/api/v1/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      const contact = await prisma.contact.create({
        data: {
          orgId: user.orgId,
          fullName: body.fullName,
          crmName: body.crmName,
          phone: body.phone,
          email: body.email,
          zaloUid: body.zaloUid,
          avatarUrl: body.avatarUrl,
          source: body.source,
          sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
          status: body.status ?? 'new',
          nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
          assignedUserId: body.assignedUserId,
          notes: body.notes,
          tags: body.tags ?? [],
          metadata: body.metadata ?? {},
        },
      });

      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { id: true, name: true },
      });
      void runAutomationRules({
        trigger: 'contact_created',
        orgId: user.orgId,
        org,
        contact: {
          id: contact.id,
          fullName: contact.fullName,
          phone: contact.phone,
          status: contact.status,
          source: contact.source,
          assignedUserId: contact.assignedUserId,
        },
      });

      return reply.status(201).send(contact);
    } catch (err) {
      logger.error('[contacts] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create contact' });
    }
  });

  // ── PUT /api/v1/contacts/:id — update CRM fields ─────────────────────────
  app.put('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, status: true, fullName: true, phone: true, source: true, assignedUserId: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updateData: any = {
        fullName: body.fullName,
        crmName: body.crmName,
        phone: body.phone,
        email: body.email,
        avatarUrl: body.avatarUrl,
        source: body.source,
        sourceDate: body.sourceDate ? new Date(body.sourceDate) : undefined,
        status: body.status,
        nextAppointment: body.nextAppointment ? new Date(body.nextAppointment) : undefined,
        assignedUserId: body.assignedUserId,
        notes: body.notes,
        tags: body.tags,
        metadata: body.metadata,
      };
      if (body.firstContactDate !== undefined) {
        updateData.firstContactDate = body.firstContactDate ? new Date(body.firstContactDate) : null;
      }

      const updated = await prisma.contact.update({
        where: { id },
        data: updateData,
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          appointments: { orderBy: { appointmentDate: 'desc' }, take: 10 },
          _count: { select: { conversations: true } },
        },
      });

      if (existing.status !== updated.status) {
        const org = await prisma.organization.findUnique({
          where: { id: user.orgId },
          select: { id: true, name: true },
        });
        void runAutomationRules({
          trigger: 'status_changed',
          orgId: user.orgId,
          org,
          contact: {
            id: updated.id,
            fullName: updated.fullName,
            phone: updated.phone,
            status: updated.status,
            source: updated.source,
            assignedUserId: updated.assignedUserId,
          },
        });
      }

      return updated;
    } catch (err) {
      logger.error('[contacts] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update contact' });
    }
  });

  // ── PUT /api/v1/contacts/:id/tags — update tags only ─────────────────────
  app.put('/api/v1/contacts/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { tags } = request.body as { tags: string[] };

      if (!Array.isArray(tags)) return reply.status(400).send({ error: 'tags must be an array' });

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const updated = await prisma.contact.update({ where: { id }, data: { tags } });
      return updated;
    } catch (err) {
      logger.error('[contacts] Update tags error:', err);
      return reply.status(500).send({ error: 'Failed to update tags' });
    }
  });

  // ── DELETE /api/v1/contacts/:id ───────────────────────────────────────────
  app.delete('/api/v1/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      await prisma.contact.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[contacts] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete contact' });
    }
  });

  // ── GET /api/v1/contacts/duplicates — list unresolved duplicate groups ────
  app.get('/api/v1/contacts/duplicates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { page = '1', limit = '20', resolved = 'false' } = request.query as QueryParams;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const where = { orgId: user.orgId, resolved: resolved === 'true' };

      const [groups, total] = await Promise.all([
        prisma.duplicateGroup.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.duplicateGroup.count({ where }),
      ]);

      // Expand contact data for each group
      const expanded = await Promise.all(
        groups.map(async (group) => {
          const contacts = await prisma.contact.findMany({
            where: { id: { in: group.contactIds } },
            select: {
              id: true, fullName: true, phone: true, email: true,
              zaloUid: true, avatarUrl: true, source: true, status: true,
              tags: true, createdAt: true, leadScore: true, lastActivity: true,
            },
          });
          return { ...group, contacts };
        }),
      );

      return { groups: expanded, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] Duplicates list error:', err);
      return reply.status(500).send({ error: 'Failed to fetch duplicate groups' });
    }
  });

  // ── POST /api/v1/contacts/duplicates/:groupId/merge — merge a group ──────
  app.post('/api/v1/contacts/duplicates/:groupId/merge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { groupId } = request.params as { groupId: string };
      const { primaryContactId } = request.body as { primaryContactId: string };

      if (!primaryContactId) return reply.status(400).send({ error: 'primaryContactId is required' });

      const group = await prisma.duplicateGroup.findFirst({
        where: { id: groupId, orgId: user.orgId, resolved: false },
      });
      if (!group) return reply.status(404).send({ error: 'Duplicate group not found' });

      const secondaryIds = group.contactIds.filter((id) => id !== primaryContactId);
      if (secondaryIds.length === 0) return reply.status(400).send({ error: 'Primary must be in the group' });

      const merged = await mergeContacts(user.orgId, user.id, primaryContactId, secondaryIds);

      // Resolve the group
      await prisma.duplicateGroup.update({ where: { id: groupId }, data: { resolved: true } });

      return merged;
    } catch (err: any) {
      logger.error('[contacts] Merge error:', err);
      return reply.status(400).send({ error: err.message || 'Failed to merge contacts' });
    }
  });

  // ── POST /api/v1/contacts/intelligence/recompute — manual trigger ────────
  app.post('/api/v1/contacts/intelligence/recompute', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Fire and forget — return 202 immediately
      runContactIntelligence().catch((err) => {
        logger.error('[contacts] Recompute error:', err);
      });
      return reply.status(202).send({ message: 'Intelligence recompute started' });
    } catch (err) {
      logger.error('[contacts] Recompute trigger error:', err);
      return reply.status(500).send({ error: 'Failed to start recompute' });
    }
  });

  // ── GET /api/v1/contacts/:id/friendships — list Friend rows (per CRM nick chăm KH) ─
  app.get('/api/v1/contacts/:id/friendships', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const contact = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const friendships = await prisma.friend.findMany({
        where: { contactId: id, orgId: user.orgId },
        include: {
          zaloAccount: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              zaloUid: true,
              avatarUrl: true,
              owner: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: { lastInboundAt: { sort: 'desc', nulls: 'last' } },
      });
      return { friendships };
    } catch (err) {
      logger.error('[contacts] List friendships error:', err);
      return reply.status(500).send({ error: 'Failed to list friendships' });
    }
  });

  // ── POST /api/v1/contacts/backfill-global-id — one-off Zalo globalId backfill ──
  // Resolve zaloGlobalId + zaloUsername cho contact đã có zaloUid, sau đó auto-merge
  // những contact có cùng globalId (cross-account dedup). Sync (block) để admin
  // thấy result ngay, có thể chạy lại idempotent.
  app.post('/api/v1/contacts/backfill-global-id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await backfillGlobalId();
      return reply.send(result);
    } catch (err) {
      logger.error('[contacts] Backfill globalId error:', err);
      return reply.status(500).send({ error: 'Backfill failed', detail: String(err) });
    }
  });

  // ── PATCH /api/v1/friends/:id — update per-pair status + leadScore ─────
  app.patch('/api/v1/friends/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as { statusId?: string | null; leadScore?: number };
      const friend = await prisma.friend.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!friend) return reply.status(404).send({ error: 'Friend not found' });

      // Validate statusId nếu set
      if (body.statusId !== undefined && body.statusId !== null) {
        const s = await prisma.status.findFirst({ where: { id: body.statusId, orgId: user.orgId } });
        if (!s) return reply.status(400).send({ error: 'Invalid statusId' });
      }
      const updated = await prisma.friend.update({
        where: { id },
        data: {
          ...(body.statusId !== undefined ? { statusId: body.statusId } : {}),
          ...(body.leadScore !== undefined ? { leadScore: Math.max(0, Math.min(100, body.leadScore)) } : {}),
        },
      });
      return reply.send(updated);
    } catch (err) {
      logger.error('[friends] update error:', err);
      return reply.status(500).send({ error: 'Failed to update friend' });
    }
  });

  // ── POST /api/v1/contacts/:id/merge-into — gắn Contact này làm Friends của Contact Cha ──
  // Move all Friends + Conversations + Appointments từ source → target, mark source mergedInto.
  // Use case: sale realize 2 Contact thực ra là cùng person (vd 2 Zalo account khác globalId).
  app.post('/api/v1/contacts/:id/merge-into', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: sourceId } = request.params as { id: string };
      const { parentContactId: targetId } = (request.body || {}) as { parentContactId?: string };
      if (!targetId) return reply.status(400).send({ error: 'parentContactId (target) required' });
      if (targetId === sourceId) return reply.status(400).send({ error: 'Cannot merge into itself' });

      // Validate both contacts cùng org + chưa merged
      const [source, target] = await Promise.all([
        prisma.contact.findFirst({ where: { id: sourceId, orgId: user.orgId, mergedInto: null } }),
        prisma.contact.findFirst({ where: { id: targetId, orgId: user.orgId, mergedInto: null } }),
      ]);
      if (!source) return reply.status(404).send({ error: 'Source contact not found' });
      if (!target) return reply.status(404).send({ error: 'Target contact not found' });

      // Reuse mergeContacts helper (handles Friend conflict via unique constraint).
      await mergeContacts(user.orgId, user.id, targetId, [sourceId]);
      return reply.send({ merged: true, sourceId, targetId });
    } catch (err) {
      logger.error('[contacts] merge-into error:', err);
      return reply.status(500).send({ error: 'Merge failed', detail: String(err) });
    }
  });

  // ── POST /api/v1/contacts/:id/link-parent — gắn 1 Contact (son) vào 1 Contact khác (father) ──
  app.post('/api/v1/contacts/:id/link-parent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { parentContactId } = (request.body || {}) as { parentContactId?: string };
      if (!parentContactId) return reply.status(400).send({ error: 'parentContactId required' });
      if (parentContactId === id) return reply.status(400).send({ error: 'Cannot link contact to itself' });

      // Cha + con phải cùng org
      const [child, parent] = await Promise.all([
        prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true, mergedInto: true, children: { select: { id: true } } } }),
        prisma.contact.findFirst({ where: { id: parentContactId, orgId: user.orgId }, select: { id: true, parentContactId: true, mergedInto: true } }),
      ]);
      if (!child) return reply.status(404).send({ error: 'Child contact not found' });
      if (!parent) return reply.status(404).send({ error: 'Parent contact not found' });
      if (child.mergedInto) return reply.status(400).send({ error: 'Child already hard-merged via globalId' });
      if (parent.mergedInto) return reply.status(400).send({ error: 'Parent already hard-merged via globalId' });
      // Block 3-level hierarchy: parent phải là root (parentContactId=NULL)
      if (parent.parentContactId) return reply.status(400).send({ error: 'Parent must itself be a root contact (no parent)' });
      // Block cycle: nếu child đang có children, không cho biến nó thành con
      if (child.children.length > 0) return reply.status(400).send({ error: 'This contact has children — split them out first before linking as child' });

      const updated = await prisma.contact.update({
        where: { id },
        data: { parentContactId },
      });
      // Audit
      await prisma.activityLog.create({
        data: {
          orgId: user.orgId,
          userId: user.id,
          action: 'contact_link_parent',
          entityType: 'contact',
          entityId: id,
          details: { parentContactId },
        },
      });
      return reply.send(updated);
    } catch (err) {
      logger.error('[contacts] link-parent error:', err);
      return reply.status(500).send({ error: 'Failed to link parent' });
    }
  });

  // ── POST /api/v1/contacts/:id/unlink-parent — tách Contact thành KH Cha riêng ─
  app.post('/api/v1/contacts/:id/unlink-parent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const contact = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, parentContactId: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });
      if (!contact.parentContactId) return reply.status(400).send({ error: 'Contact already a root (no parent)' });

      const updated = await prisma.contact.update({
        where: { id },
        data: { parentContactId: null },
      });
      await prisma.activityLog.create({
        data: {
          orgId: user.orgId,
          userId: user.id,
          action: 'contact_unlink_parent',
          entityType: 'contact',
          entityId: id,
          details: { previousParentId: contact.parentContactId },
        },
      });
      return reply.send(updated);
    } catch (err) {
      logger.error('[contacts] unlink-parent error:', err);
      return reply.status(500).send({ error: 'Failed to unlink parent' });
    }
  });

  // ── GET /api/v1/contacts/parent-candidates — list undismissed suggestion ────
  app.get('/api/v1/contacts/parent-candidates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const candidates = await prisma.parentCandidate.findMany({
        where: { orgId: user.orgId, dismissed: false, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      // Hydrate contact info cho mỗi candidate
      const allIds = Array.from(new Set(candidates.flatMap(c => c.contactIds)));
      const contacts = allIds.length === 0 ? [] : await prisma.contact.findMany({
        where: { id: { in: allIds }, orgId: user.orgId },
        select: { id: true, fullName: true, phone: true, zaloUid: true, zaloGlobalId: true, avatarUrl: true, parentContactId: true },
      });
      const byId = new Map(contacts.map(c => [c.id, c]));
      const enriched = candidates.map(c => ({
        ...c,
        contacts: c.contactIds.map(id => byId.get(id)).filter(Boolean),
      }));
      return reply.send({ candidates: enriched });
    } catch (err) {
      logger.error('[contacts] list parent-candidates error:', err);
      return reply.status(500).send({ error: 'Failed to list candidates' });
    }
  });

  // ── POST /api/v1/contacts/parent-candidates/:id/accept ───────────────────────
  // body: { parentContactId } — chỉ định contact nào làm Cha (canonical), các còn lại làm Con
  app.post('/api/v1/contacts/parent-candidates/:id/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { parentContactId } = (request.body || {}) as { parentContactId?: string };
      if (!parentContactId) return reply.status(400).send({ error: 'parentContactId required' });

      const candidate = await prisma.parentCandidate.findFirst({
        where: { id, orgId: user.orgId, dismissed: false, resolvedAt: null },
      });
      if (!candidate) return reply.status(404).send({ error: 'Candidate not found or already resolved' });
      if (!candidate.contactIds.includes(parentContactId)) {
        return reply.status(400).send({ error: 'parentContactId must be in candidate group' });
      }

      // Set parentContactId cho các contact khác trong cụm
      const childrenIds = candidate.contactIds.filter(cid => cid !== parentContactId);
      await prisma.$transaction([
        ...childrenIds.map(cid => prisma.contact.updateMany({
          where: { id: cid, orgId: user.orgId, mergedInto: null, parentContactId: null },
          data: { parentContactId },
        })),
        prisma.parentCandidate.update({
          where: { id },
          data: { resolvedAt: new Date(), resolvedBy: user.id, dismissed: false },
        }),
        prisma.activityLog.create({
          data: {
            orgId: user.orgId, userId: user.id,
            action: 'parent_candidate_accept', entityType: 'contact', entityId: parentContactId,
            details: { candidateId: id, childrenIds, matchType: candidate.matchType },
          },
        }),
      ]);
      return reply.send({ accepted: true, parentContactId, childrenCount: childrenIds.length });
    } catch (err) {
      logger.error('[contacts] accept parent-candidate error:', err);
      return reply.status(500).send({ error: 'Failed to accept candidate' });
    }
  });

  // ── POST /api/v1/contacts/parent-candidates/:id/dismiss ──────────────────────
  app.post('/api/v1/contacts/parent-candidates/:id/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const candidate = await prisma.parentCandidate.findFirst({ where: { id, orgId: user.orgId } });
      if (!candidate) return reply.status(404).send({ error: 'Candidate not found' });
      await prisma.parentCandidate.update({
        where: { id },
        data: { dismissed: true, resolvedAt: new Date(), resolvedBy: user.id },
      });
      return reply.send({ dismissed: true });
    } catch (err) {
      logger.error('[contacts] dismiss parent-candidate error:', err);
      return reply.status(500).send({ error: 'Failed to dismiss candidate' });
    }
  });

  // ── POST /api/v1/admin/migrate-status-table — one-off seed + convert enum ────
  app.post('/api/v1/admin/migrate-status-table', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await migrateStatusTable();
      return reply.send(result);
    } catch (err) {
      logger.error('[contacts] migrate-status-table error:', err);
      return reply.status(500).send({ error: 'Migration failed', detail: String(err) });
    }
  });

  // ── POST /api/v1/contacts/backfill-orphan-friends — fix Friend rows trỏ vào contact đã merged ──
  app.post('/api/v1/contacts/backfill-orphan-friends', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await backfillOrphanFriends();
      return reply.send(result);
    } catch (err) {
      logger.error('[contacts] Backfill orphan friends error:', err);
      return reply.status(500).send({ error: 'Backfill failed', detail: String(err) });
    }
  });
}
