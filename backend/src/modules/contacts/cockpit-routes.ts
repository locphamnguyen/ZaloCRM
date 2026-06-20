// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * cockpit-routes.ts — Sale Cockpit endpoints cho chat cột 4 tab "🎯 CRM".
 *
 * Design: docs/designs/CHAT-COL4-CRM-TAB.md (anh chốt 2026-05-22)
 *
 * Endpoints:
 *   GET /api/v1/contacts/:id/cockpit    — aggregate KH info (priority, timeline, engagement, Getfly link)
 *   GET /api/v1/contacts/:id/teammates  — danh sách Friend records cùng chăm KH (gom multi-nick)
 *
 * Auth: JWT + org-scoped, không cần role check (sale-level access).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { assertContactVisible } from './contact-scope.js';

type GetflyLinkStatus = {
  linked: boolean;
  getflyId: string | null;
  linkedAt: string | null;
};

function readGetflyLink(metadata: unknown): GetflyLinkStatus {
  if (!metadata || typeof metadata !== 'object') return { linked: false, getflyId: null, linkedAt: null };
  const meta = metadata as Record<string, unknown>;
  const getflyId = meta.getflyId != null ? String(meta.getflyId) : null;
  const linkedAt = meta.getflyLinkedAt != null ? String(meta.getflyLinkedAt) : null;
  return { linked: !!getflyId, getflyId, linkedAt };
}

export async function cockpitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /contacts/:id/cockpit — aggregate cockpit data ────────────────────
  app.get('/api/v1/contacts/:id/cockpit', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      // Phase Contact Scope Hybrid 2026-05-27: scope gate
      const visible = await assertContactVisible({
        userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId: id,
      });
      if (!visible) return reply.status(404).send({ error: 'Contact not found' });

      const contact = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId, mergedInto: null },
        select: {
          id: true,
          fullName: true,
          crmName: true,
          phone: true,
          source: true,
          sourceDate: true,
          firstContactDate: true,
          status: true,
          metadata: true,
          notes: true,
          tags: true,
          autoTags: true,
          parentContactId: true,
          // Phase 8 score
          priorityScore: true,
          priorityUpdatedAt: true,
          engagementPattern: true,
          engagementTrend: true,
          engagementScore: true,
          engagementUpdatedAt: true,
          // Aggregate timeline
          lastInboundAt: true,
          lastInboundPreview: true,
          lastOutboundAt: true,
          lastOutboundPreview: true,
          lastInteractionAt: true,
          nextAppointment: true,
          stuckSinceAggregate: true,
          // Counters
          totalInbound: true,
          totalOutbound: true,
          totalAppointments: true,
          // Lead
          leadScore: true,
          // Assigned
          assignedUser: { select: { id: true, fullName: true } },
          statusRef: { select: { id: true, name: true, color: true } },
        },
      });

      if (!contact) {
        return reply.status(404).send({ error: 'Contact not found' });
      }

      // Tìm appointment kế tiếp (status active, đủ chi tiết để FE hiển thị)
      const upcomingAppointment = await prisma.appointment.findFirst({
        where: {
          contactId: contact.id,
          orgId: user.orgId,
          appointmentDate: { gte: new Date() },
          status: 'scheduled',
        },
        orderBy: { appointmentDate: 'asc' },
        select: {
          id: true,
          title: true,
          appointmentDate: true,
          type: true,
          location: true,
          status: true,
          durationMin: true,
        },
      });

      return {
        contactId: contact.id,
        fullName: contact.fullName,
        crmName: contact.crmName,
        phone: contact.phone,
        source: contact.source,
        sourceDate: contact.sourceDate,
        firstContactDate: contact.firstContactDate,
        status: contact.status,
        statusRef: contact.statusRef,
        notes: contact.notes,
        tags: contact.tags,
        autoTags: contact.autoTags,
        assignedUser: contact.assignedUser,
        getflyLink: readGetflyLink(contact.metadata),
        // Phase 8 — 3 score system
        priorityScore: contact.priorityScore,
        priorityUpdatedAt: contact.priorityUpdatedAt,
        engagementPattern: contact.engagementPattern,
        engagementTrend: contact.engagementTrend,
        engagementScore: contact.engagementScore,
        engagementUpdatedAt: contact.engagementUpdatedAt,
        leadScore: contact.leadScore,
        // Timeline
        lastInboundAt: contact.lastInboundAt,
        lastInboundPreview: contact.lastInboundPreview,
        lastOutboundAt: contact.lastOutboundAt,
        lastOutboundPreview: contact.lastOutboundPreview,
        lastInteractionAt: contact.lastInteractionAt,
        nextAppointment: upcomingAppointment
          ? {
              id: upcomingAppointment.id,
              title: upcomingAppointment.title,
              at: upcomingAppointment.appointmentDate,
              type: upcomingAppointment.type,
              location: upcomingAppointment.location,
              status: upcomingAppointment.status,
              durationMin: upcomingAppointment.durationMin,
            }
          : contact.nextAppointment
            ? { at: contact.nextAppointment }
            : null,
        stuckSinceAggregate: contact.stuckSinceAggregate,
        // Counters
        totalInbound: contact.totalInbound,
        totalOutbound: contact.totalOutbound,
        totalAppointments: contact.totalAppointments,
      };
    } catch (err) {
      logger.error('[cockpit] Get cockpit error:', err);
      return reply.status(500).send({ error: 'Failed to fetch cockpit' });
    }
  });

  // ── GET /contacts/:id/teammates — Friend records cùng chăm KH ─────────────
  //
  // Query params:
  //   excludeZaloAccountId — nick hiện tại (ẩn khỏi list — anh đã chốt 2026-05-22)
  //
  // Logic:
  //   - Tìm Contact + nhảy lên parent nếu có (gom tất cả Friend của KH Cha + con)
  //   - Trả Friend records cùng contactId family + ZaloAccount info + sale owner User
  //   - Sắp xếp: lastInboundAt DESC (nick chăm tích cực nhất lên đầu)
  app.get('/api/v1/contacts/:id/teammates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const query = request.query as { excludeZaloAccountId?: string };

      // Phase Contact Scope Hybrid 2026-05-27: scope gate
      const visibleAccess = await assertContactVisible({
        userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId: id,
      });
      if (!visibleAccess) return reply.status(404).send({ error: 'Contact not found' });

      // Tìm contact để xác định "family" (parent + children)
      const contact = await prisma.contact.findFirst({
        where: { id, orgId: user.orgId, mergedInto: null },
        select: { id: true, parentContactId: true },
      });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const rootId = contact.parentContactId || contact.id;
      const childIds = await prisma.contact.findMany({
        where: { orgId: user.orgId, OR: [{ id: rootId }, { parentContactId: rootId }], mergedInto: null },
        select: { id: true },
      });
      const familyIds = childIds.map((c) => c.id);

      const friends = await prisma.friend.findMany({
        where: {
          orgId: user.orgId,
          contactId: { in: familyIds },
          ...(query.excludeZaloAccountId ? { zaloAccountId: { not: query.excludeZaloAccountId } } : {}),
        },
        select: {
          id: true,
          contactId: true,
          zaloAccountId: true,
          zaloUidInNick: true,
          relationshipKind: true,
          friendshipStatus: true,
          aliasInNick: true,
          totalInbound: true,
          totalOutbound: true,
          lastInboundAt: true,
          lastOutboundAt: true,
          lastInteractionAt: true,
          becameFriendAt: true,
          firstMessageAt: true,
          zaloAccount: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
              zaloUid: true,
              phone: true,
              status: true,
              owner: { select: { id: true, fullName: true, email: true } },
            },
          },
        },
        orderBy: [{ lastInboundAt: 'desc' }, { lastInteractionAt: 'desc' }],
      });

      return {
        teammates: friends.map((f) => ({
          friendId: f.id,
          contactId: f.contactId,
          zaloAccountId: f.zaloAccountId,
          zaloUidInNick: f.zaloUidInNick,
          relationshipKind: f.relationshipKind,
          friendshipStatus: f.friendshipStatus,
          aliasInNick: f.aliasInNick,
          totalInbound: f.totalInbound,
          totalOutbound: f.totalOutbound,
          lastInboundAt: f.lastInboundAt,
          lastOutboundAt: f.lastOutboundAt,
          lastInteractionAt: f.lastInteractionAt,
          becameFriendAt: f.becameFriendAt,
          firstMessageAt: f.firstMessageAt,
          nick: {
            id: f.zaloAccount.id,
            displayName: f.zaloAccount.displayName,
            avatarUrl: f.zaloAccount.avatarUrl,
            zaloUid: f.zaloAccount.zaloUid,
            phone: f.zaloAccount.phone,
            status: f.zaloAccount.status,
          },
          owner: f.zaloAccount.owner
            ? {
                id: f.zaloAccount.owner.id,
                fullName: f.zaloAccount.owner.fullName,
                email: f.zaloAccount.owner.email,
              }
            : null,
        })),
      };
    } catch (err) {
      logger.error('[cockpit] Get teammates error:', err);
      return reply.status(500).send({ error: 'Failed to fetch teammates' });
    }
  });
}
