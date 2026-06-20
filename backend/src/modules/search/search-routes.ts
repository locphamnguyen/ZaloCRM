// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Global search routes — searches contacts, messages, and appointments by keyword.
 * Requires minimum 2 characters to avoid expensive full-table scans.
 *
 * Phase Contact Scope Hybrid 2026-05-27 — sale chỉ thấy hit của riêng mình:
 *   - Contact / Appointment scope qua ContactAccess (helper getContactScope)
 *   - Message scope qua ZaloAccountAccess (helper getZaloScope)
 *   - Privacy v2 main-nick: pipe message qua redactMessage
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { getContactScope } from '../contacts/contact-scope.js';
import { getZaloScope } from '../zalo/zalo-scope.js';

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/search', async (request) => {
    const user = request.user!;
    const { q = '' } = request.query as { q: string };
    if (!q || q.length < 2) return { contacts: [], messages: [], appointments: [] };

    const searchTerm = q.trim();

    const [cScope, zScope] = await Promise.all([
      getContactScope(user.id, user.orgId, user.role),
      getZaloScope(user.id, user.orgId, user.role),
    ]);

    const contactWhere: any = {
      orgId: user.orgId,
      OR: [
        { fullName: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm } },
        { notes: { contains: searchTerm, mode: 'insensitive' } },
      ],
    };
    if (!cScope.isOrgAdmin && cScope.accessibleContactIds !== null) {
      contactWhere.id = { in: cScope.accessibleContactIds };
    }

    const messageWhere: any = {
      conversation: { orgId: user.orgId },
      content: { contains: searchTerm, mode: 'insensitive' },
    };
    if (!zScope.isOrgAdmin && zScope.accessibleIds.length >= 0) {
      messageWhere.conversation = {
        orgId: user.orgId,
        zaloAccountId: { in: zScope.accessibleIds },
      };
    }

    const appointmentWhere: any = {
      orgId: user.orgId,
      OR: [
        { notes: { contains: searchTerm, mode: 'insensitive' } },
        { contact: { fullName: { contains: searchTerm, mode: 'insensitive' } } },
      ],
    };
    if (!cScope.isOrgAdmin && cScope.accessibleContactIds !== null) {
      appointmentWhere.contactId = { in: cScope.accessibleContactIds };
    }

    const [contacts, messages, appointments] = await Promise.all([
      prisma.contact.findMany({
        where: contactWhere,
        select: { id: true, fullName: true, phone: true },
        take: 10,
      }),
      prisma.message.findMany({
        where: messageWhere,
        select: {
          id: true,
          content: true,
          senderName: true,
          sentAt: true,
          conversation: {
            select: {
              id: true,
              zaloAccountId: true,
              contact: { select: { fullName: true } },
              zaloAccount: { select: { privacyMode: true, ownerUserId: true } },
            },
          },
        },
        orderBy: { sentAt: 'desc' },
        take: 10,
      }),
      prisma.appointment.findMany({
        where: appointmentWhere,
        select: {
          id: true,
          contactId: true,
          appointmentDate: true,
          appointmentTime: true,
          notes: true,
          contact: { select: { fullName: true } },
        },
        take: 10,
      }),
    ]);

    // Phase Riêng Tư v2: blur message content khi conversation thuộc nick main-nick non-owned.
    const { buildPrivacyContext, redactMessage, buildOffendingContactIds, PRIVACY_BLUR_TOKEN } =
      await import('../privacy/redact.js');
    const privacyCtx = await buildPrivacyContext(request);
    const redactedMessages = messages.map((m: any) => {
      const conv = m.conversation;
      if (!conv?.zaloAccount) return m;
      return redactMessage(
        { ...m, conversationId: conv.id },
        { zaloAccount: conv.zaloAccount },
        privacyCtx,
      );
    });

    // PRIVACY 2026-06-11 (audit H8/H9): nhánh contacts + appointments cũng trả PII KH
    // (fullName/phone + appointment.notes) — phải redact KH thuộc nick main non-owner.
    // Batch 1 query qua tất cả contactId của 2 nhánh.
    const apptContactIds = appointments
      .map((a: any) => a.contactId)
      .filter((id: any): id is string => !!id);
    const offending = await buildOffendingContactIds(
      [...contacts.map((c) => c.id), ...apptContactIds],
      privacyCtx,
    );
    const redactedContacts = contacts.map((c) =>
      offending.has(c.id) ? { id: c.id, fullName: PRIVACY_BLUR_TOKEN, phone: null, redacted: true } : c,
    );
    const redactedAppointments = appointments.map((a: any) =>
      a.contactId && offending.has(a.contactId)
        ? { ...a, notes: a.notes ? PRIVACY_BLUR_TOKEN : a.notes, contact: a.contact ? { fullName: PRIVACY_BLUR_TOKEN } : a.contact }
        : a,
    );

    return { contacts: redactedContacts, messages: redactedMessages, appointments: redactedAppointments };
  });
}
