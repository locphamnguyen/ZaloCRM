// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * contact-sub-resource-routes.ts — Sub-resource endpoints for contacts.
 * Provides appointments scoped to a specific contact.
 * All routes require JWT auth and are scoped to the user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function contactSubResourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts/:id/appointments — appointments for contact ───────
  app.get('/api/v1/contacts/:id/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const appointments = await prisma.appointment.findMany({
        where: { contactId: id, orgId: user.orgId },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          statusChangedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { appointmentDate: 'desc' },
        take: 20,
      });

      return { appointments };
    } catch (err) {
      logger.error('[contacts] Appointments by contact error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  // ── GET /api/v1/contacts/by-zalo-uid/:uid — lookup CRM contact by Zalo UID
  // Trả contact info + assigned user + count conversations để dùng cho user dialog
  app.get('/api/v1/contacts/by-zalo-uid/:uid', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { uid } = request.params as { uid: string };

      const contact = await prisma.contact.findFirst({
        where: { zaloUid: uid, orgId: user.orgId, mergedInto: null },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          _count: { select: { conversations: true, appointments: true } },
        },
      });

      if (!contact) return reply.send({ contact: null });

      // Last conversation for "Nhắn tin" deep-link
      const lastConv = await prisma.conversation.findFirst({
        where: { contactId: contact.id, orgId: user.orgId, deletedAt: null },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, zaloAccountId: true },
      });

      return {
        contact: {
          id: contact.id,
          fullName: contact.fullName,
          crmName: contact.crmName,
          phone: contact.phone,
          email: contact.email,
          source: contact.source,
          status: contact.status,
          notes: contact.notes,
          tags: contact.tags,
          leadScore: contact.leadScore,
          firstContactDate: contact.firstContactDate,
          lastActivity: contact.lastActivity,
          assignedUser: contact.assignedUser,
          conversationsCount: contact._count.conversations,
          appointmentsCount: contact._count.appointments,
          lastConversationId: lastConv?.id ?? null,
        },
      };
    } catch (err) {
      logger.error('[contacts] By zalo uid error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });
}
