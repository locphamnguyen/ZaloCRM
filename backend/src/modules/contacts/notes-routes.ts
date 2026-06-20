// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * notes-routes.ts — CRM-style notes thread on a Contact.
 *
 * - Notes are flat-threaded: root notes + 1-level replies (parentNoteId).
 * - Each note can have multiple emoji reactions; (note, user, emoji) is unique.
 * - AI parse endpoint takes free-form note body → returns structured appointment
 *   proposal (date / time / type / summary) for the "🤖 Tạo lịch hẹn" button.
 *
 * All routes require JWT auth and are scoped to user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { parseAppointmentFromText } from '../ai/ai-service.js';
import { assertContactVisible } from './contact-scope.js';

const NOTE_INCLUDE = {
  author:    { select: { id: true, fullName: true, email: true } },
  reactions: {
    select: { id: true, emoji: true, userId: true, user: { select: { fullName: true } } },
  },
  appointment: { select: { id: true, appointmentDate: true, appointmentTime: true, status: true, type: true } },
} as const;

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts/:contactId/notes ─────────────────────────────────
  // Returns root notes (parentNoteId IS NULL) newest first, each with replies
  // ASC by createdAt (Facebook-style: replies under root in chronological order).
  app.get('/api/v1/contacts/:contactId/notes', async (request: FastifyRequest<{ Params: { contactId: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { contactId } = request.params;

      // Phase Contact Scope Hybrid 2026-05-27: scope gate
      const visible = await assertContactVisible({
        userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId,
      });
      if (!visible) return reply.status(404).send({ error: 'Contact not found' });
      const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId: user.orgId }, select: { id: true } });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      const rootNotes = await prisma.note.findMany({
        where: { orgId: user.orgId, contactId, parentNoteId: null },
        include: {
          ...NOTE_INCLUDE,
          replies: {
            include: NOTE_INCLUDE,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Count: tổng root notes (không tính replies) → hiển thị badge #N
      const totalRoot = rootNotes.length;
      return { notes: rootNotes, total: totalRoot };
    } catch (err) {
      logger.error('[notes] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch notes' });
    }
  });

  // ── POST /api/v1/contacts/:contactId/notes ────────────────────────────────
  app.post('/api/v1/contacts/:contactId/notes', async (request: FastifyRequest<{
    Params: { contactId: string };
    Body: { body: string; parentNoteId?: string | null };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { contactId } = request.params;
      const body = (request.body?.body || '').trim();
      const parentNoteId = request.body?.parentNoteId || null;

      if (!body) return reply.status(400).send({ error: 'Note body is required' });
      if (body.length > 5000) return reply.status(400).send({ error: 'Note body exceeds 5000 chars' });

      // Phase Contact Scope Hybrid 2026-05-27: scope gate
      const visible = await assertContactVisible({
        userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId,
      });
      if (!visible) return reply.status(404).send({ error: 'Contact not found' });
      const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId: user.orgId }, select: { id: true } });
      if (!contact) return reply.status(404).send({ error: 'Contact not found' });

      // Validate parent (must be a root note in same contact, same org) — enforce flat thread
      if (parentNoteId) {
        const parent = await prisma.note.findFirst({
          where: { id: parentNoteId, orgId: user.orgId, contactId },
          select: { id: true, parentNoteId: true },
        });
        if (!parent) return reply.status(400).send({ error: 'Parent note not found' });
        if (parent.parentNoteId) return reply.status(400).send({ error: 'Cannot reply to a reply (flat thread only)' });
      }

      const note = await prisma.note.create({
        data: {
          orgId: user.orgId,
          contactId,
          parentNoteId,
          authorUserId: user.id,
          body,
        },
        include: NOTE_INCLUDE,
      });

      // Phase 6 polish P2 quick win — note dài (>100 chars) → +engagement signal
      // Chỉ trigger với root note (không trigger với reply trong thread, tránh inflate)
      if (!parentNoteId && body.length >= 100) {
        const { onNoteAdded } = await import('../scoring/scoring-hooks.js');
        onNoteAdded(user.orgId, contactId, body);
      }

      return reply.status(201).send({ note });
    } catch (err) {
      logger.error('[notes] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create note' });
    }
  });

  // ── PATCH /api/v1/notes/:id ───────────────────────────────────────────────
  app.patch('/api/v1/notes/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: { body: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const note = await prisma.note.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
      if (!note) return reply.status(404).send({ error: 'Note not found' });
      // Author only — manager/admin có thể override sau (Phase 2)
      if (note.authorUserId !== user.id) return reply.status(403).send({ error: 'Forbidden — not your note' });

      const body = (request.body?.body || '').trim();
      if (!body) return reply.status(400).send({ error: 'Body required' });
      if (body.length > 5000) return reply.status(400).send({ error: 'Body too long' });

      const updated = await prisma.note.update({
        where: { id: note.id },
        data: { body },
        include: NOTE_INCLUDE,
      });
      return { note: updated };
    } catch (err) {
      logger.error('[notes] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update note' });
    }
  });

  // ── DELETE /api/v1/notes/:id ──────────────────────────────────────────────
  app.delete('/api/v1/notes/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const note = await prisma.note.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
      if (!note) return reply.status(404).send({ error: 'Note not found' });
      if (note.authorUserId !== user.id && user.role !== 'admin' && user.role !== 'owner') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      await prisma.note.delete({ where: { id: note.id } });
      return { ok: true };
    } catch (err) {
      logger.error('[notes] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete note' });
    }
  });

  // ── POST /api/v1/notes/:id/reactions ──────────────────────────────────────
  // Toggle: nếu (note, user, emoji) đã tồn tại → xoá; chưa có → tạo.
  app.post('/api/v1/notes/:id/reactions', async (request: FastifyRequest<{ Params: { id: string }; Body: { emoji: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const emoji = (request.body?.emoji || '').trim();
      if (!emoji || emoji.length > 16) return reply.status(400).send({ error: 'Invalid emoji' });

      const note = await prisma.note.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true } });
      if (!note) return reply.status(404).send({ error: 'Note not found' });

      const existing = await prisma.noteReaction.findUnique({
        where: { noteId_userId_emoji: { noteId: note.id, userId: user.id, emoji } },
      });

      if (existing) {
        await prisma.noteReaction.delete({ where: { id: existing.id } });
        return { toggled: 'removed', emoji };
      }
      const created = await prisma.noteReaction.create({
        data: { noteId: note.id, userId: user.id, emoji },
        select: { id: true, emoji: true, userId: true, user: { select: { fullName: true } } },
      });
      return { toggled: 'added', reaction: created };
    } catch (err) {
      logger.error('[notes] Reaction error:', err);
      return reply.status(500).send({ error: 'Failed to toggle reaction' });
    }
  });

  // ── POST /api/v1/notes/:id/ai-parse ───────────────────────────────────────
  // Run AI extract on note body → return parsed appointment proposal.
  // KHÔNG tạo appointment ở đây — frontend hiện dialog với prefilled values,
  // user confirm sau thì gọi POST /appointments riêng.
  app.post('/api/v1/notes/:id/ai-parse', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const note = await prisma.note.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true, body: true } });
      if (!note) return reply.status(404).send({ error: 'Note not found' });

      const parsed = await parseAppointmentFromText({ orgId: user.orgId, text: note.body });
      if (!parsed || !parsed.hasIntent) {
        return { parsed: null, reason: 'Không phát hiện ý định hẹn rõ ràng trong ghi chú này' };
      }
      return { parsed, source: parsed.source };
    } catch (err) {
      logger.error('[notes] AI parse error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to parse note';
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/v1/notes/:id/link-appointment ───────────────────────────────
  // Sau khi user confirm tạo appointment từ note → wire suggestedAppointmentId
  // để hiển thị badge "✓ Đã tạo lịch" trên note.
  app.post('/api/v1/notes/:id/link-appointment', async (request: FastifyRequest<{ Params: { id: string }; Body: { appointmentId: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { appointmentId } = request.body;
      const [note, appt] = await Promise.all([
        prisma.note.findFirst({ where: { id: request.params.id, orgId: user.orgId } }),
        prisma.appointment.findFirst({ where: { id: appointmentId, orgId: user.orgId }, select: { id: true } }),
      ]);
      if (!note) return reply.status(404).send({ error: 'Note not found' });
      if (!appt) return reply.status(404).send({ error: 'Appointment not found' });

      const updated = await prisma.note.update({
        where: { id: note.id },
        data: { suggestedAppointmentId: appointmentId },
        include: NOTE_INCLUDE,
      });
      return { note: updated };
    } catch (err) {
      logger.error('[notes] Link appointment error:', err);
      return reply.status(500).send({ error: 'Failed to link appointment' });
    }
  });
}
