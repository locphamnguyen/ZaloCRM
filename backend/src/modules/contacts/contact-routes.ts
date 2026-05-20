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
import { backfillMissingFriends } from './backfill-missing-friends.js';
import { backfillFriendDisplayName } from './backfill-friend-display-name.js';
import { migrateStatusTable } from './status-migration.js';
import { computeAggregateDisplay, AGGREGATE_INCLUDE } from './contact-aggregate-display.js';
import { runAutomationRules } from '../automation/automation-service.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { logActivity, computeDiff } from '../activity/activity-logger.js';
import { emitWebhook } from '../api/webhook-service.js';

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
        status = '',          // legacy enum
        statusId = '',        // dynamic Status table
        assignedUserId = '',
        threadType = '',      // 'user' | 'group' — filter qua conversations relation
        hasZalo = '',         // 'true' | 'false' | 'unknown'
        multiNick = '',       // 'true' = childrenCount > 1 (đa Zalo identity)
        scoreMin = '',
        scoreMax = '',
        relationshipKindAny = '', // CSV: 'friend,pending_friend,...' — match KH có ≥1 Friend kind đó
        dateFrom = '',
        dateTo = '',
      } = request.query as QueryParams;

      const where: any = { orgId: user.orgId, mergedInto: null };
      // Model B: mỗi Contact tự nó là "KH Cha"; con = Friend rows. KHÔNG filter parentContactId.
      if (source) where.source = source;
      if (status) where.status = status;
      if (statusId) where.statusId = statusId;
      if (assignedUserId) where.assignedUserId = assignedUserId;
      if (hasZalo === 'true') where.hasZalo = true;
      else if (hasZalo === 'false') where.hasZalo = false;
      else if (hasZalo === 'unknown') where.hasZalo = null;
      // Score range — fallback Contact.leadScore (aggregate displayLeadScore tính sau)
      if (scoreMin || scoreMax) {
        where.leadScore = {};
        if (scoreMin) where.leadScore.gte = Number(scoreMin) || 0;
        if (scoreMax) where.leadScore.lte = Number(scoreMax) || 100;
      }
      // Date range — theo lastActivity (sort cũng dùng field này → khớp UX intent)
      if (dateFrom || dateTo) {
        where.lastActivity = {};
        if (dateFrom) where.lastActivity.gte = new Date(dateFrom);
        if (dateTo) where.lastActivity.lte = new Date(dateTo + 'T23:59:59.999Z');
      }
      // ThreadType filter qua Conversation relation: KH có ≥1 conv loại đó
      if (threadType === 'user' || threadType === 'group') {
        where.conversations = { some: { threadType, orgId: user.orgId } };
      }
      // RelationshipKind aggregate: KH có ≥1 Friend với kind trong list
      if (relationshipKindAny) {
        const kinds = relationshipKindAny.split(',').map(s => s.trim()).filter(Boolean);
        if (kinds.length > 0) {
          where.friends = { some: { relationshipKind: { in: kinds } } };
        }
      }
      if (search) {
        // Fast path: phone chính match phoneNormalized indexed exact (normalize input
        // canonical về 84xxx). phone2/phone3 vẫn dùng contains variants (ít dùng).
        const canonicalPhone = normalizePhone(search);
        const digits = search.replace(/[^\d]/g, '');
        const phone2_3Variants: string[] = [];
        if (digits.length >= 9) {
          phone2_3Variants.push(digits);
          if (digits.startsWith('0')) phone2_3Variants.push('84' + digits.slice(1));
          else if (digits.startsWith('84')) phone2_3Variants.push('0' + digits.slice(2));
        }
        const phone23Clauses = phone2_3Variants.flatMap(p => [
          { phone2: { contains: p } },
          { phone3: { contains: p } },
        ]);
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { crmName: { contains: search, mode: 'insensitive' } },
          ...(canonicalPhone ? [{ phoneNormalized: { equals: canonicalPhone } }] : []),
          ...phone23Clauses,
          { email: { contains: search, mode: 'insensitive' } },
          { zaloUid: { equals: search } },
          { zaloGlobalId: { equals: search } },
          { zaloUsername: { equals: search } },
        ];
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Sort: tương tác mới nhất lên đầu (theo design D2 trong office-hours doc).
      // lastActivity null → cuối cùng. Indexed @@index([orgId, lastActivity]).
      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          include: {
            assignedUser: { select: { id: true, fullName: true, email: true } },
            _count: { select: { conversations: true, appointments: true } },
            ...AGGREGATE_INCLUDE,
          },
          orderBy: [
            { lastActivity: { sort: 'desc', nulls: 'last' } },
            { updatedAt: 'desc' },
          ],
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.contact.count({ where }),
      ]);

      // Aggregate + multiNick post-filter (childrenCount requires friends count after load)
      const multiNickOnly = multiNick === 'true';
      const enriched = contacts
        .map((c) => {
          const nicksByKind: Record<string, number> = {};
          for (const f of c.friends ?? []) {
            nicksByKind[f.relationshipKind] = (nicksByKind[f.relationshipKind] || 0) + 1;
          }
          const display = computeAggregateDisplay(c);
          return { ...c, nicksByKind, ...display };
        })
        .filter((c) => !multiNickOnly || (c.childrenCount ?? 0) > 1);

      return { contacts: enriched, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contacts' });
    }
  });

  // ── GET /api/v1/contacts/stats — metrics cho stats row đầu ContactsView ──
  // Tổng hợp số liệu nhanh (count theo dimension) cho dashboard mini phía top.
  // Tất cả filter scoped theo orgId + mergedInto IS NULL (skip merged secondaries).
  app.get('/api/v1/contacts/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const base = { orgId: user.orgId, mergedInto: null };
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
      const sevenDaysAhead = new Date(now.getTime() + 7 * 86_400_000);

      const [
        total,
        withNick,
        multiClaim3,
        revoked,
        noZalo,
        newToday,
        activeRecently,
        upcomingApt,
        highScore,
      ] = await Promise.all([
        prisma.contact.count({ where: base }),
        // Có nick chăm = có ≥1 Friend row
        prisma.contact.count({ where: { ...base, friends: { some: {} } } }),
        // Multi-claim ≥3 nick (Friend per-account distinct → count distinct zaloAccountId).
        // Proxy: ≥3 Friend rows (đủ chính xác vì Friend unique theo (account, uid)).
        prisma.contact.count({ where: { ...base, friends: { some: {} } } }).then(async () => {
          const rows = await prisma.contact.findMany({
            where: { ...base, friends: { some: {} } },
            select: { id: true, _count: { select: { friends: true } } },
          });
          return rows.filter(r => r._count.friends >= 3).length;
        }),
        prisma.contact.count({ where: { ...base, consentStatus: 'revoked' } }),
        prisma.contact.count({ where: { ...base, hasZalo: false } }),
        prisma.contact.count({ where: { ...base, createdAt: { gte: startOfToday } } }),
        prisma.contact.count({ where: { ...base, lastActivity: { gte: sevenDaysAgo } } }),
        prisma.contact.count({
          where: {
            ...base,
            appointments: { some: { appointmentDate: { gte: now, lte: sevenDaysAhead } } },
          },
        }),
        prisma.contact.count({ where: { ...base, leadScore: { gte: 50 } } }),
      ]);

      return {
        total,
        withNick,
        multiClaim: multiClaim3,
        revoked,
        noZalo,
        newToday,
        activeRecently,
        upcomingApt,
        highScore,
      };
    } catch (err) {
      logger.error('[contacts] Stats error:', err);
      return reply.status(500).send({ error: 'Failed to compute stats' });
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

      // Phase 7 — emit AutomationEvent for engine triggers bound to contact_created
      void (async () => {
        try {
          const { automationEventBus } = await import('../automation/engine/event-bus.js');
          automationEventBus.emit({
            type: 'contact_created',
            orgId: user.orgId,
            occurredAt: new Date(),
            contactId: contact.id,
            payload: {
              source: contact.source,
              status: contact.status,
              hasPhone: Boolean(contact.phone),
              hasZalo: Boolean(contact.zaloUid || contact.zaloGlobalId),
            },
          });
        } catch {
          // engine not loaded — silent
        }
      })();

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
        select: {
          id: true, status: true, fullName: true, phone: true, source: true,
          assignedUserId: true, crmName: true, email: true, gender: true,
          birthDate: true, leadScore: true, addressLine: true, occupation: true,
        },
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

      // ── ACTIVITY LOG — diff với existing để log đúng action types ─────────
      // Tách action-specific logs (status, score) vs bulk customer_update.
      // Status change ưu tiên (workflow critical), score change track delta.
      if (existing.status !== updated.status) {
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'status_change',
          entityType: 'contact',
          entityId: updated.id,
          details: { old: existing.status, new: updated.status },
        });
      }
      if (existing.leadScore !== updated.leadScore) {
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'score_change',
          entityType: 'contact',
          entityId: updated.id,
          details: { old: existing.leadScore, new: updated.leadScore, delta: updated.leadScore - existing.leadScore },
        });
      }
      // Bulk customer_info changes (fullName/phone/email/gender/birthDate/...) → 1 log
      const infoDiff = computeDiff(
        existing as Record<string, unknown>,
        updated as Record<string, unknown>,
        ['fullName', 'crmName', 'phone', 'email', 'gender', 'birthDate', 'addressLine', 'occupation', 'assignedUserId'],
      );
      if (Object.keys(infoDiff).length > 0) {
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'customer_update',
          entityType: 'contact',
          entityId: updated.id,
          details: { changes: infoDiff },
        });
        // Outbound webhook cho external systems (vd GetFly sync) — fire-and-forget
        void emitWebhook(user.orgId, 'contact.updated', {
          contactId: updated.id,
          changes: infoDiff,
          contact: {
            id: updated.id,
            fullName: updated.fullName,
            crmName: updated.crmName,
            phone: updated.phone,
            email: updated.email,
            source: updated.source,
            status: updated.status,
            gender: updated.gender,
            leadScore: updated.leadScore,
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

      // Defensive: strip Zalo-mirror tags (🔵 X) trước khi ghi Contact.tags.
      // Zalo-mirror là per-nick, sống ở Friend.crmTagsPerNick — KHÔNG bao giờ
      // được phép viết vào Contact.tags (cross-nick) qua endpoint này.
      const filteredTags = tags.filter(t => typeof t === 'string' && !t.startsWith('🔵 '));

      const existing = await prisma.contact.findFirst({ where: { id, orgId: user.orgId }, select: { id: true, tags: true } });
      if (!existing) return reply.status(404).send({ error: 'Contact not found' });

      const oldTags = Array.isArray(existing.tags) ? (existing.tags as string[]) : [];
      const updated = await prisma.contact.update({ where: { id }, data: { tags: filteredTags } });

      // ── ACTIVITY LOG — diff tags added/removed (so với filteredTags vì đó là DB state mới)
      const added = filteredTags.filter(t => !oldTags.includes(t));
      const removed = oldTags.filter(t => !filteredTags.includes(t));
      for (const t of added) {
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'tag_add_crm',
          entityType: 'contact',
          entityId: updated.id,
          details: { tag: t, level: 'contact' },
        });
      }
      for (const t of removed) {
        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'tag_remove_crm',
          entityType: 'contact',
          entityId: updated.id,
          details: { tag: t, level: 'contact' },
        });
      }

      // ── Phase 6 polish P2 quick win — VIP tag → +intent signal ───────────
      if (added.length > 0) {
        const { onCrmTagsAdded } = await import('../scoring/scoring-hooks.js');
        onCrmTagsAdded(user.orgId, updated.id, added);
      }

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

      // Expand contact data for each group. Sort theo "richness" — KH có nhiều
      // data hơn (friends, convs, fullName, phone, globalId) đứng TRƯỚC làm
      // primary đề xuất. Tie-break: createdAt cũ hơn lên trước.
      const expanded = await Promise.all(
        groups.map(async (group) => {
          const contacts = await prisma.contact.findMany({
            where: { id: { in: group.contactIds } },
            select: {
              id: true, fullName: true, crmName: true, phone: true, email: true,
              zaloUid: true, zaloGlobalId: true, zaloUsername: true,
              avatarUrl: true, source: true, status: true,
              tags: true, createdAt: true, leadScore: true, lastActivity: true,
              hasZalo: true, lastInboundAt: true, lastOutboundAt: true,
              totalInbound: true, totalOutbound: true,
              assignedUser: { select: { id: true, fullName: true } },
              statusRef: { select: { id: true, name: true, color: true } },
              _count: { select: { conversations: true, appointments: true, friends: true } },
            },
          });
          // Compute richness score — số field có data + bonus cho friends/convs/apts.
          const scored = contacts.map(c => {
            const richness =
              (c.fullName ? 1 : 0) + (c.crmName ? 1 : 0) + (c.phone ? 1 : 0) +
              (c.email ? 1 : 0) + (c.zaloUid ? 1 : 0) + (c.zaloGlobalId ? 1 : 0) +
              (c.zaloUsername ? 1 : 0) + (c.avatarUrl ? 1 : 0) +
              (c._count.friends || 0) * 3 +
              (c._count.conversations || 0) * 2 +
              (c._count.appointments || 0) * 2 +
              (Array.isArray(c.tags) && c.tags.length > 0 ? 1 : 0);
            return { ...c, _richness: richness };
          });
          // Sort: richness DESC, then createdAt ASC (older first)
          scored.sort((a, b) => {
            if (a._richness !== b._richness) return b._richness - a._richness;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          });
          return { ...group, contacts: scored };
        }),
      );

      return { groups: expanded, total, page: pageNum, limit: limitNum };
    } catch (err) {
      logger.error('[contacts] Duplicates list error:', err);
      return reply.status(500).send({ error: 'Failed to fetch duplicate groups' });
    }
  });

  // ── POST /api/v1/contacts/duplicates/:groupId/dismiss — bỏ qua group (false positive) ──
  // Mark group resolved without merging. Dùng khi sale review thấy 2 contact thực sự
  // là 2 người khác nhau (vd cùng tên SDT nhưng khác Zalo identity / khác giới tính).
  app.post('/api/v1/contacts/duplicates/:groupId/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { groupId } = request.params as { groupId: string };
      const group = await prisma.duplicateGroup.findFirst({
        where: { id: groupId, orgId: user.orgId, resolved: false },
      });
      if (!group) return reply.status(404).send({ error: 'Duplicate group not found' });
      await prisma.duplicateGroup.update({ where: { id: groupId }, data: { resolved: true } });
      await prisma.activityLog.create({
        data: {
          orgId: user.orgId, userId: user.id,
          action: 'duplicate_group_dismissed', entityType: 'duplicate_group', entityId: groupId,
          details: { contactIds: group.contactIds, matchType: group.matchType },
        },
      }).catch(() => {});
      return reply.send({ dismissed: true });
    } catch (err) {
      logger.error('[contacts] Dismiss duplicate error:', err);
      return reply.status(500).send({ error: 'Failed to dismiss duplicate group' });
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

  // ── PATCH /api/v1/friends/:id — update per-pair status / leadScore / tags ──
  app.patch('/api/v1/friends/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as {
        statusId?: string | null;
        leadScore?: number;
        crmTagsPerNick?: string[];
        aliasInNick?: string | null;
      };
      const friend = await prisma.friend.findFirst({
        where: { id, orgId: user.orgId },
        select: {
          id: true, contactId: true, statusId: true, leadScore: true,
          crmTagsPerNick: true, aliasInNick: true,
          zaloAccountId: true, zaloUidInNick: true,  // cần để push alias qua SDK
        },
      });
      if (!friend) return reply.status(404).send({ error: 'Friend not found' });

      if (body.statusId !== undefined && body.statusId !== null) {
        const s = await prisma.status.findFirst({ where: { id: body.statusId, orgId: user.orgId } });
        if (!s) return reply.status(400).send({ error: 'Invalid statusId' });
      }
      // Tags: chỉ accept array string, dedup, trim, max 20 tags để tránh abuse.
      let cleanTags: string[] | undefined;
      if (body.crmTagsPerNick !== undefined) {
        if (!Array.isArray(body.crmTagsPerNick)) {
          return reply.status(400).send({ error: 'crmTagsPerNick must be array of strings' });
        }
        cleanTags = [...new Set(
          body.crmTagsPerNick.map(t => String(t).trim()).filter(Boolean),
        )].slice(0, 20);
      }
      const updated = await prisma.friend.update({
        where: { id },
        data: {
          ...(body.statusId !== undefined ? { statusId: body.statusId } : {}),
          ...(body.leadScore !== undefined ? { leadScore: Math.max(0, Math.min(100, body.leadScore)) } : {}),
          ...(cleanTags !== undefined ? { crmTagsPerNick: cleanTags } : {}),
          ...(body.aliasInNick !== undefined ? { aliasInNick: body.aliasInNick } : {}),
        },
      });

      // ── ACTIVITY LOG — per-pair mutations log với entityType='contact' để timeline KH thấy
      const entityId = friend.contactId;
      if (entityId) {
        if (body.statusId !== undefined && body.statusId !== friend.statusId) {
          logActivity({
            orgId: user.orgId,
            userId: user.id,
            action: 'status_change',
            entityType: 'contact',
            entityId,
            details: { old: friend.statusId, new: body.statusId, scope: 'friend', friendId: friend.id },
          });
        }
        if (body.leadScore !== undefined && body.leadScore !== friend.leadScore) {
          logActivity({
            orgId: user.orgId,
            userId: user.id,
            action: 'score_change',
            entityType: 'contact',
            entityId,
            details: { old: friend.leadScore, new: body.leadScore, delta: body.leadScore - friend.leadScore, scope: 'friend', friendId: friend.id },
          });
        }
        if (body.aliasInNick !== undefined && body.aliasInNick !== friend.aliasInNick) {
          logActivity({
            orgId: user.orgId,
            userId: user.id,
            action: 'friend_alias_change',
            entityType: 'contact',
            entityId,
            details: { old: friend.aliasInNick, new: body.aliasInNick, friendId: friend.id, trigger: 'crm_edit' },
          });

          // CRM → Zalo Real: push alias via SDK. Fire-and-forget — không block PUT
          // response. Nếu SDK fail (account offline / network), log warn; lần sync
          // alias periodic sẽ thấy mismatch và reconcile (CRM là source of truth ở
          // moment user edit, nhưng nếu Zalo Real bị thay đổi parallel → race lần
          // touch sau resolve).
          const newAlias = body.aliasInNick;
          const uidToTarget = friend.zaloUidInNick;
          const accountIdToCall = friend.zaloAccountId;
          if (uidToTarget && accountIdToCall) {
            void (async () => {
              try {
                const { zaloOps } = await import('../../shared/zalo-operations.js');
                if (newAlias && newAlias.trim()) {
                  await zaloOps.changeFriendAlias(accountIdToCall, newAlias.trim(), uidToTarget);
                  logger.info(`[friends] Pushed alias "${newAlias}" → Zalo for uid=${uidToTarget}`);
                } else {
                  await zaloOps.removeFriendAlias(accountIdToCall, uidToTarget);
                  logger.info(`[friends] Removed alias on Zalo for uid=${uidToTarget}`);
                }
              } catch (err) {
                logger.warn(`[friends] Push alias to Zalo failed (uid=${uidToTarget}):`, err);
              }
            })();
          }
        }
        if (cleanTags !== undefined) {
          const oldT = Array.isArray(friend.crmTagsPerNick) ? (friend.crmTagsPerNick as string[]) : [];
          const added = cleanTags.filter(t => !oldT.includes(t));
          const removed = oldT.filter(t => !cleanTags!.includes(t));
          for (const t of added) {
            logActivity({
              orgId: user.orgId, userId: user.id, action: 'tag_add_crm',
              entityType: 'contact', entityId,
              details: { tag: t, level: 'friend', friendId: friend.id },
            });
          }
          for (const t of removed) {
            logActivity({
              orgId: user.orgId, userId: user.id, action: 'tag_remove_crm',
              entityType: 'contact', entityId,
              details: { tag: t, level: 'friend', friendId: friend.id },
            });
          }
        }
      }

      // Outbound webhook cho external systems (vd GetFly sync per-pair) — fire-and-forget.
      // Mỗi loại change emit event riêng để external system filter dễ hơn.
      if (entityId) {
        if (body.aliasInNick !== undefined && body.aliasInNick !== friend.aliasInNick) {
          void emitWebhook(user.orgId, 'friend.alias_changed', {
            friendId: friend.id, contactId: entityId,
            zaloAccountId: friend.zaloAccountId, zaloUidInNick: friend.zaloUidInNick,
            old: friend.aliasInNick, new: body.aliasInNick,
            origin: 'crm',
          });
        }
        if (body.statusId !== undefined && body.statusId !== friend.statusId) {
          void emitWebhook(user.orgId, 'friend.status_changed', {
            friendId: friend.id, contactId: entityId,
            old: friend.statusId, new: body.statusId,
          });
        }
        if (body.leadScore !== undefined && body.leadScore !== friend.leadScore) {
          void emitWebhook(user.orgId, 'friend.score_changed', {
            friendId: friend.id, contactId: entityId,
            old: friend.leadScore, new: body.leadScore,
          });
        }
      }

      return reply.send(updated);
    } catch (err) {
      logger.error('[friends] update error:', err);
      return reply.status(500).send({ error: 'Failed to update friend' });
    }
  });

  // ── POST /api/v1/friends/:id/ensure-conversation — tạo (hoặc lấy) Conversation cho Friend ──
  // Use case: sale muốn nhắn KH lần đầu (Friend từ sync, chưa có hội thoại). Trả convId
  // để FE router.push thẳng vào Chat. Idempotent — gọi nhiều lần vẫn trả cùng convId.
  app.post('/api/v1/friends/:id/ensure-conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: friendId } = request.params as { id: string };

      const friend = await prisma.friend.findFirst({
        where: { id: friendId, orgId: user.orgId },
        select: { id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true },
      });
      if (!friend) return reply.status(404).send({ error: 'Friend not found' });

      // Find-or-create conversation for (zaloAccount, externalThreadId=zaloUidInNick).
      // threadType='user' vì Friend = 1-1 Zalo identity (group conv không qua đây).
      const existing = await prisma.conversation.findFirst({
        where: {
          zaloAccountId: friend.zaloAccountId,
          externalThreadId: friend.zaloUidInNick,
        },
        select: { id: true },
      });
      if (existing) return reply.send({ conversationId: existing.id, created: false });

      const created = await prisma.conversation.create({
        data: {
          orgId: user.orgId,
          zaloAccountId: friend.zaloAccountId,
          contactId: friend.contactId,
          threadType: 'user',
          externalThreadId: friend.zaloUidInNick,
          lastMessageAt: new Date(),
          unreadCount: 0,
          isReplied: false,
        },
        select: { id: true },
      });
      return reply.send({ conversationId: created.id, created: true });
    } catch (err) {
      logger.error('[friends] ensure-conversation error:', err);
      return reply.status(500).send({ error: 'Ensure conversation failed', detail: String(err) });
    }
  });

  // ── POST /api/v1/zalo-accounts/:accountId/groups/:groupId/ensure-conversation ─
  //    Tạo (hoặc lấy) Conversation cho 1 nhóm Zalo. Use case: sale click nút "Mở
  //    chat" từ danh sách group trong tab Nhóm → cần convId để nav /chat/:convId.
  //    Idempotent — gọi nhiều lần vẫn trả cùng convId.
  app.post('/api/v1/zalo-accounts/:accountId/groups/:groupId/ensure-conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { accountId, groupId } = request.params as { accountId: string; groupId: string };

      // Verify account thuộc org user (security)
      const account = await prisma.zaloAccount.findFirst({
        where: { id: accountId, orgId: user.orgId },
        select: { id: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });
      if (!groupId) return reply.status(400).send({ error: 'groupId required' });

      // Find existing — group conv uniqueness: (zaloAccountId, externalThreadId, threadType='group')
      const existing = await prisma.conversation.findFirst({
        where: {
          zaloAccountId: accountId,
          externalThreadId: groupId,
          threadType: 'group',
        },
        select: { id: true },
      });
      if (existing) return reply.send({ conversationId: existing.id, created: false });

      // Group conv chưa có → tạo. Note: contactId nullable (group conv không bind 1
      // contact cụ thể, listener sẽ tạo group-contact khi có msg đầu).
      const created = await prisma.conversation.create({
        data: {
          orgId: user.orgId,
          zaloAccountId: accountId,
          contactId: null,
          threadType: 'group',
          externalThreadId: groupId,
          lastMessageAt: new Date(),
          unreadCount: 0,
          isReplied: false,
        },
        select: { id: true },
      });
      return reply.send({ conversationId: created.id, created: true });
    } catch (err) {
      logger.error('[groups] ensure-conversation error:', err);
      return reply.status(500).send({ error: 'Ensure conversation failed', detail: String(err) });
    }
  });

  // ── POST /api/v1/contacts/resolve-by-keys — server exhaustive lookup ────────
  // Tìm Contact theo thứ tự độ tin cậy: globalId > username > zaloUid > phone.
  // Dùng cho NewMessageDialog sau Zalo lookup: tra đúng Contact đã có trong CRM
  // (không bị giới hạn bởi search results frontend).
  app.post('/api/v1/contacts/resolve-by-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = (request.body || {}) as {
        zaloGlobalId?: string;
        zaloUsername?: string;
        zaloUid?: string;
        phone?: string;
      };
      const baseWhere = { orgId: user.orgId, mergedInto: null };
      const include = {
        assignedUser: { select: { id: true, fullName: true, email: true } },
        statusRef: { select: { id: true, name: true, color: true, order: true, isTerminal: true } },
        _count: { select: { conversations: true, appointments: true } },
      };

      // Order: globally-unique trước, phone sau cùng (vì có thể trùng/đổi chủ).
      if (body.zaloGlobalId) {
        const c = await prisma.contact.findFirst({
          where: { ...baseWhere, zaloGlobalId: body.zaloGlobalId },
          include,
        });
        if (c) return reply.send({ matched: true, by: 'zaloGlobalId', contact: c });
      }
      if (body.zaloUsername) {
        const c = await prisma.contact.findFirst({
          where: { ...baseWhere, zaloUsername: body.zaloUsername },
          include,
        });
        if (c) return reply.send({ matched: true, by: 'zaloUsername', contact: c });
      }
      if (body.zaloUid) {
        const c = await prisma.contact.findFirst({
          where: { ...baseWhere, zaloUid: body.zaloUid },
          include,
        });
        if (c) return reply.send({ matched: true, by: 'zaloUid', contact: c });
      }
      const canonicalPhone = normalizePhone(body.phone);
      if (canonicalPhone) {
        const c = await prisma.contact.findFirst({
          where: { ...baseWhere, phoneNormalized: canonicalPhone },
          include,
        });
        if (c) return reply.send({ matched: true, by: 'phone', contact: c });
      }
      return reply.send({ matched: false });
    } catch (err) {
      logger.error('[contacts] resolve-by-keys error:', err);
      return reply.status(500).send({ error: 'Resolve failed', detail: String(err) });
    }
  });

  // ── POST /api/v1/conversations/ensure-by-uid — find-or-create Conv (account, uid) ─
  // Use case: user click "Nhắn tin" trong ZaloUserInfoDialog HOẶC sau khi
  // lookup-by-phone discover UID per-nick. UID phải là **UID per-viewer của nick này**
  // (lấy từ findUser/getUserInfo của chính account đó) — UID từ nick khác sẽ KHÔNG
  // gửi tin được vì Zalo per-account UID.
  //
  // Body cờ `commit=true` (default false): khi true sẽ upsert Friend row + link/backfill
  // Contact — dùng cho NewMessageDialog "Bắt đầu chat" (commitment). Khi false (default,
  // dùng cho ZaloUserInfoDialog avatar click) chỉ tạo Conv, KHÔNG sinh Friend row "ma"
  // để Contacts view không hiện KH Con chưa thực sự chat.
  //
  // Friend row chính thức sinh ra khi:
  //  - Có inbound/outbound msg đầu tiên (qua applyFriendAggregate)
  //  - Friend sync từ Zalo getAllFriends (đã kết bạn)
  //  - commit=true ở đây (explicit user action)
  app.post('/api/v1/conversations/ensure-by-uid', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = (request.body || {}) as {
        zaloAccountId?: string;
        uid?: string;
        // commit=true → tạo Friend + link Contact ngay (explicit "Bắt đầu chat")
        commit?: boolean;
        // Snapshot từ lookup result (chỉ dùng khi commit=true)
        zaloName?: string;
        zaloAvatarUrl?: string;
        zaloGlobalId?: string;
        zaloUsername?: string;
        phone?: string;
        // Contact link mode khi commit=true:
        //   'auto' (default) = match theo zaloUid/zaloGlobalId/phone, không tạo mới
        //   'attach:<contactId>' = attach Friend vào Contact cụ thể (user picked)
        //   'create' = tạo Contact mới
        contactMode?: string;
      };
      if (!body.zaloAccountId || !body.uid) {
        return reply.status(400).send({ error: 'zaloAccountId và uid required' });
      }
      const account = await prisma.zaloAccount.findFirst({
        where: { id: body.zaloAccountId, orgId: user.orgId },
        select: { id: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      // Resolve contactId (chỉ tìm, KHÔNG tạo Friend ở chế độ default).
      // Order: zaloGlobalId > zaloUsername > zaloUid > phone (theo độ tin cậy globally-unique).
      let linkedContactId: string | null = null;
      if (body.zaloGlobalId) {
        const c = await prisma.contact.findFirst({
          where: { orgId: user.orgId, zaloGlobalId: body.zaloGlobalId, mergedInto: null },
          select: { id: true },
        });
        if (c) linkedContactId = c.id;
      }
      if (!linkedContactId && body.zaloUsername) {
        const c = await prisma.contact.findFirst({
          where: { orgId: user.orgId, zaloUsername: body.zaloUsername, mergedInto: null },
          select: { id: true },
        });
        if (c) linkedContactId = c.id;
      }
      if (!linkedContactId) {
        const c = await prisma.contact.findFirst({
          where: { orgId: user.orgId, zaloUid: body.uid, mergedInto: null },
          select: { id: true },
        });
        if (c) linkedContactId = c.id;
      }
      if (!linkedContactId && body.phone) {
        const canonical = normalizePhone(body.phone);
        if (canonical) {
          const c = await prisma.contact.findFirst({
            where: { orgId: user.orgId, phoneNormalized: canonical, mergedInto: null },
            select: { id: true },
          });
          if (c) linkedContactId = c.id;
        }
      }

      // commit=true → explicit commitment (NewMessageDialog "Bắt đầu chat")
      if (body.commit) {
        // contactMode handling
        if (body.contactMode?.startsWith('attach:')) {
          const cid = body.contactMode.slice(7);
          const c = await prisma.contact.findFirst({
            where: { id: cid, orgId: user.orgId, mergedInto: null },
            select: { id: true },
          });
          if (!c) return reply.status(400).send({ error: 'attach contact not found' });
          linkedContactId = cid;
        } else if (body.contactMode === 'create' || (!linkedContactId && body.phone)) {
          // Tạo Contact mới khi không match, hoặc khi user explicit chọn 'create'
          const newC = await prisma.contact.create({
            data: {
              orgId: user.orgId,
              zaloUid: body.uid,
              zaloGlobalId: body.zaloGlobalId || null,
              zaloUsername: body.zaloUsername || null,
              phone: body.phone || null,
              fullName: body.zaloName || (body.phone ? `KH ${body.phone}` : `KH-${body.uid.slice(-4)}`),
              avatarUrl: body.zaloAvatarUrl || null,
              hasZalo: true,
              source: 'compose_new',
            },
            select: { id: true },
          });
          linkedContactId = newC.id;
        } else if (linkedContactId) {
          // Backfill zaloUid/global/username vào Contact đã có (nếu thiếu)
          await prisma.contact.update({
            where: { id: linkedContactId },
            data: {
              ...(body.uid ? { zaloUid: body.uid } : {}),
              ...(body.zaloGlobalId ? { zaloGlobalId: body.zaloGlobalId } : {}),
              ...(body.zaloUsername ? { zaloUsername: body.zaloUsername } : {}),
              hasZalo: true,
            },
          }).catch(() => {});
        }

        // Upsert Friend cho cặp (nick, uid) — commitment thực sự
        if (linkedContactId) {
          await prisma.friend.upsert({
            where: {
              zaloAccountId_zaloUidInNick: {
                zaloAccountId: body.zaloAccountId,
                zaloUidInNick: body.uid,
              },
            },
            create: {
              orgId: user.orgId,
              contactId: linkedContactId,
              zaloAccountId: body.zaloAccountId,
              zaloUidInNick: body.uid,
              relationshipKind: 'chatting_stranger',
              hasConversation: true,
              zaloDisplayName: body.zaloName || null,
              zaloAvatarUrl: body.zaloAvatarUrl || null,
              zaloGlobalId: body.zaloGlobalId || null,
              zaloUsername: body.zaloUsername || null,
            },
            update: {
              hasConversation: true,
              ...(body.zaloName ? { zaloDisplayName: body.zaloName } : {}),
              ...(body.zaloAvatarUrl ? { zaloAvatarUrl: body.zaloAvatarUrl } : {}),
              ...(body.zaloGlobalId ? { zaloGlobalId: body.zaloGlobalId } : {}),
              ...(body.zaloUsername ? { zaloUsername: body.zaloUsername } : {}),
            },
          }).catch((err: unknown) => {
            logger.warn('[ensure-by-uid] Friend upsert failed:', err);
          });
        }
      }

      const existing = await prisma.conversation.findFirst({
        where: { zaloAccountId: body.zaloAccountId, externalThreadId: body.uid },
        select: { id: true },
      });
      if (existing) return reply.send({ conversationId: existing.id, created: false });

      const created = await prisma.conversation.create({
        data: {
          orgId: user.orgId,
          zaloAccountId: body.zaloAccountId,
          contactId: linkedContactId,
          threadType: 'user',
          externalThreadId: body.uid,
          lastMessageAt: new Date(),
          unreadCount: 0,
          isReplied: false,
        },
        select: { id: true },
      });
      return reply.send({ conversationId: created.id, created: true });
    } catch (err) {
      logger.error('[conversations] ensure-by-uid error:', err);
      return reply.status(500).send({ error: 'Ensure conversation failed', detail: String(err) });
    }
  });

  // ── POST /api/v1/friends/:id/promote-to-parent — gỡ Friend Con thành KH Cha mới ──
  // Tạo Contact mới từ Friend (1 Zalo identity per nick CRM), move Friend +
  // Conversation tương ứng sang Contact mới. Cha cũ giữ lại các Friend khác.
  // Copy statusId + leadScore từ Friend sang Contact mới (giữ data per-pair).
  app.post('/api/v1/friends/:id/promote-to-parent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: friendId } = request.params as { id: string };
      const body = (request.body || {}) as { fullName?: string };

      const friend = await prisma.friend.findFirst({
        where: { id: friendId, orgId: user.orgId },
        select: {
          id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true,
          statusId: true, leadScore: true, aliasInNick: true,
          zaloDisplayName: true, zaloAvatarUrl: true,
        },
      });
      if (!friend) return reply.status(404).send({ error: 'Friend not found' });

      // Get default status for org (fallback)
      const defaultStatus = await prisma.status.findFirst({
        where: { orgId: user.orgId, isDefault: true },
        select: { id: true },
      });

      // Build display name: body override > zaloDisplayName (per-identity snapshot)
      // > aliasInNick > "KH-{last4 UID}". KHÔNG dùng parent name vì sẽ leak tên Cha.
      const last4 = friend.zaloUidInNick.slice(-4);
      const fullName = body.fullName?.trim()
        || friend.zaloDisplayName
        || friend.aliasInNick
        || `KH-${last4}`;

      const result = await prisma.$transaction(async (tx) => {
        // 1. Create new Contact with friend's per-pair status/score/avatar
        const newContact = await tx.contact.create({
          data: {
            orgId: user.orgId,
            zaloUid: friend.zaloUidInNick,
            fullName,
            avatarUrl: friend.zaloAvatarUrl,
            statusId: friend.statusId ?? defaultStatus?.id ?? null,
            leadScore: friend.leadScore,
            hasZalo: true,
          },
        });

        // 2. Move Friend to new Contact
        await tx.friend.update({
          where: { id: friend.id },
          data: { contactId: newContact.id },
        });

        // 3. Move Conversations matching (zaloAccountId, externalThreadId=zaloUidInNick)
        const movedConvs = await tx.conversation.updateMany({
          where: {
            zaloAccountId: friend.zaloAccountId,
            externalThreadId: friend.zaloUidInNick,
            orgId: user.orgId,
          },
          data: { contactId: newContact.id },
        });

        // 4. Audit log
        await tx.activityLog.create({
          data: {
            orgId: user.orgId,
            userId: user.id,
            action: 'friend_promoted_to_parent',
            entityType: 'contact',
            entityId: newContact.id,
            details: {
              fromContactId: friend.contactId,
              friendId: friend.id,
              zaloUidInNick: friend.zaloUidInNick,
              movedConversations: movedConvs.count,
            },
          },
        });

        return { newContact, movedConversations: movedConvs.count };
      });

      return reply.send(result);
    } catch (err) {
      logger.error('[friends] promote-to-parent error:', err);
      return reply.status(500).send({ error: 'Promote failed', detail: String(err) });
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

  // ── POST /api/v1/admin/run-detector — chạy duplicate-detector ngay, không đợi 02:30 UTC cron
  //    Endpoint admin-only (owner/admin role). Trả về stats sau khi chạy xong.
  //    Use case: sau khi sync backfill globalId cho Contact stub legacy, anh muốn detector
  //    auto-merge ngay không đợi cron daily next.
  app.post('/api/v1/admin/run-detector', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được phép trigger detector' });
      }
      const startedAt = Date.now();
      logger.info(`[admin] run-detector triggered by user ${user.id}`);
      // Lazy import — tránh circular dep + chỉ load khi cần
      const { runContactIntelligence } = await import('./contact-intelligence.js');
      await runContactIntelligence();
      const durationMs = Date.now() - startedAt;
      // Stats sau khi chạy: count parent candidates undismissed, duplicate groups unresolved
      const [candidates, duplicates] = await Promise.all([
        prisma.parentCandidate.count({ where: { orgId: user.orgId, dismissed: false } }),
        prisma.duplicateGroup.count({ where: { orgId: user.orgId, resolved: false } }),
      ]);
      return reply.send({
        ok: true,
        durationMs,
        parentCandidates: candidates,
        duplicateGroups: duplicates,
      });
    } catch (err) {
      logger.error('[admin] run-detector error:', err);
      return reply.status(500).send({ error: 'Detector run failed', detail: String(err) });
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

  // ── POST /api/v1/contacts/backfill-missing-friends — tạo Friend row thiếu cho conversations ──
  app.post('/api/v1/contacts/backfill-missing-friends', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await backfillMissingFriends();
      return reply.send(result);
    } catch (err) {
      logger.error('[contacts] Backfill missing friends error:', err);
      return reply.status(500).send({ error: 'Backfill failed', detail: String(err) });
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

  // ── POST /api/v1/contacts/backfill-friend-display-name — resolve per-identity Zalo name+avatar ─
  app.post('/api/v1/contacts/backfill-friend-display-name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await backfillFriendDisplayName();
      return reply.send(result);
    } catch (err) {
      logger.error('[contacts] Backfill friend display name error:', err);
      return reply.status(500).send({ error: 'Backfill failed', detail: String(err) });
    }
  });
}
