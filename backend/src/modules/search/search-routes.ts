/**
 * Global search routes — searches contacts, messages, and appointments by keyword.
 * Requires minimum 2 characters to avoid expensive full-table scans.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/search', async (request) => {
    const user = request.user!;
    const { q = '' } = request.query as { q: string };
    if (!q || q.length < 2) return { contacts: [], messages: [], appointments: [] };

    const searchTerm = q.trim();

    const [contacts, messages, appointments] = await Promise.all([
      prisma.contact.findMany({
        where: {
          orgId: user.orgId,
          OR: [
            { fullName: { contains: searchTerm, mode: 'insensitive' } },
            { phone: { contains: searchTerm } },
            { notes: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { id: true, fullName: true, phone: true },
        take: 10,
      }),
      prisma.message.findMany({
        where: {
          conversation: { orgId: user.orgId },
          content: { contains: searchTerm, mode: 'insensitive' },
        },
        select: {
          id: true,
          content: true,
          senderName: true,
          sentAt: true,
          conversation: { select: { id: true, contact: { select: { fullName: true } } } },
        },
        orderBy: { sentAt: 'desc' },
        take: 10,
      }),
      prisma.appointment.findMany({
        where: {
          orgId: user.orgId,
          OR: [
            { notes: { contains: searchTerm, mode: 'insensitive' } },
            { contact: { fullName: { contains: searchTerm, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          appointmentDate: true,
          appointmentTime: true,
          notes: true,
          contact: { select: { fullName: true } },
        },
        take: 10,
      }),
    ]);

    return { contacts, messages, appointments };
  });
}
