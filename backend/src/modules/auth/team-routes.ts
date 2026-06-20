// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Team management routes — CRUD for teams and member assignment within an org.
 * All routes require authentication; write operations require owner/admin role.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/teams — list all teams in org
  app.get('/api/v1/teams', { preHandler: requireGrant('department', 'access') }, async (request: FastifyRequest) => {
    const user = request.user!;
    const teams = await prisma.team.findMany({
      where: { orgId: user.orgId },
      include: { users: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { teams };
  });

  // POST /api/v1/teams — create team (owner/admin only)
  app.post(
    '/api/v1/teams',
    { preHandler: requireGrant('department', 'create') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { name } = request.body as { name: string };
      if (!name?.trim()) return reply.status(400).send({ error: 'Tên nhóm là bắt buộc' });

      const team = await prisma.team.create({
        data: { id: randomUUID(), orgId: user.orgId, name: name.trim() },
      });
      logger.info(`Team created: ${team.name} by ${user.email}`);
      return reply.status(201).send(team);
    },
  );

  // PUT /api/v1/teams/:id — update team name (owner/admin only)
  app.put(
    '/api/v1/teams/:id',
    { preHandler: requireGrant('department', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: string };
      if (!name?.trim()) return reply.status(400).send({ error: 'Tên nhóm là bắt buộc' });

      try {
        const team = await prisma.team.update({
          where: { id, orgId: user.orgId },
          data: { name: name.trim() },
        });
        return team;
      } catch {
        return reply.status(404).send({ error: 'Team not found' });
      }
    },
  );

  // DELETE /api/v1/teams/:id — delete team (owner only, unassigns members first)
  app.delete(
    '/api/v1/teams/:id',
    { preHandler: requireGrant('department', 'delete') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const team = await prisma.team.findFirst({ where: { id, orgId: user.orgId } });
      if (!team) return reply.status(404).send({ error: 'Team not found' });

      // Unassign all members before deleting
      await prisma.user.updateMany({ where: { teamId: id }, data: { teamId: null } });
      await prisma.team.delete({ where: { id } });

      logger.info(`Team deleted: ${team.name} by ${user.email}`);
      return reply.status(204).send();
    },
  );

  // GET /api/v1/teams/:id/members — list members of a team
  app.get('/api/v1/teams/:id/members', { preHandler: requireGrant('department', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const team = await prisma.team.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        users: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true },
        },
      },
    });
    if (!team) return reply.status(404).send({ error: 'Team not found' });

    return { members: team.users };
  });

  // POST /api/v1/teams/:id/members — assign user to team (owner/admin only)
  app.post(
    '/api/v1/teams/:id/members',
    { preHandler: requireGrant('department', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { userId } = request.body as { userId: string };
      if (!userId) return reply.status(400).send({ error: 'userId là bắt buộc' });

      const team = await prisma.team.findFirst({ where: { id, orgId: user.orgId } });
      if (!team) return reply.status(404).send({ error: 'Team not found' });

      try {
        const updated = await prisma.user.update({
          where: { id: userId, orgId: user.orgId },
          data: { teamId: id },
          select: { id: true, fullName: true, email: true, role: true, teamId: true },
        });
        return updated;
      } catch {
        return reply.status(404).send({ error: 'User not found in org' });
      }
    },
  );

  // DELETE /api/v1/teams/:id/members/:userId — remove user from team (owner/admin only)
  app.delete(
    '/api/v1/teams/:id/members/:userId',
    { preHandler: requireGrant('department', 'edit') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const { id, userId } = request.params as { id: string; userId: string };

      const team = await prisma.team.findFirst({ where: { id, orgId: user.orgId } });
      if (!team) return reply.status(404).send({ error: 'Team not found' });

      try {
        await prisma.user.update({
          where: { id: userId, orgId: user.orgId, teamId: id },
          data: { teamId: null },
        });
        return { success: true };
      } catch {
        return reply.status(404).send({ error: 'User not in this team' });
      }
    },
  );
}
