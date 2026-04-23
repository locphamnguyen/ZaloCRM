/**
 * credential-routes.ts — Export/import Zalo session credentials for backup/restore.
 * Endpoints: GET /accounts/:id/credentials/export, POST /accounts/:id/credentials/import
 * Credentials contain sensitive cookies — access restricted to account admins.
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

/** Shape matching openzca StoredCredentials */
interface StoredCredentials {
  cookie: Record<string, string>;
  imei: string;
  userAgent: string;
}

function isValidCredentials(obj: unknown): obj is StoredCredentials {
  if (!obj || typeof obj !== 'object') return false;
  const c = obj as Record<string, unknown>;
  return (
    typeof c.imei === 'string' && c.imei.length > 0 &&
    typeof c.userAgent === 'string' && c.userAgent.length > 0 &&
    typeof c.cookie === 'object' && c.cookie !== null
  );
}

const BASE = '/api/v1/zalo-accounts/:accountId/credentials';

export async function credentialRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET .../credentials/export — download session credentials as JSON
  app.get(`${BASE}/export`, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;

    const account = await prisma.zaloAccount.findFirst({
      where: { id: accountId, orgId: user.orgId },
      select: { id: true, sessionData: true, displayName: true },
    });
    if (!account) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    // Only owner/admin or explicit admin permission on account
    if (!['owner', 'admin'].includes(user.role)) {
      const access = await prisma.zaloAccountAccess.findFirst({
        where: { zaloAccountId: accountId, userId: user.id },
      });
      if (!access || access.permission !== 'admin') {
        return reply.status(403).send({ error: 'Admin permission required to export credentials' });
      }
    }

    if (!account.sessionData) {
      return reply.status(404).send({ error: 'No credentials saved for this account' });
    }

    const filename = `zalo-credentials-${account.displayName ?? accountId}-${Date.now()}.json`;
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    logger.info(`[credential-routes] Exporting credentials for account ${accountId}`);
    return reply.send(JSON.stringify(account.sessionData, null, 2));
  });

  // POST .../credentials/import — restore credentials from uploaded JSON
  app.post<{ Body: unknown }>(`${BASE}/import`, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;

    const account = await prisma.zaloAccount.findFirst({
      where: { id: accountId, orgId: user.orgId },
      select: { id: true },
    });
    if (!account) {
      return reply.status(404).send({ error: 'Account not found' });
    }

    // Only owner/admin or explicit admin permission on account
    if (!['owner', 'admin'].includes(user.role)) {
      const access = await prisma.zaloAccountAccess.findFirst({
        where: { zaloAccountId: accountId, userId: user.id },
      });
      if (!access || access.permission !== 'admin') {
        return reply.status(403).send({ error: 'Admin permission required to import credentials' });
      }
    }

    const body = request.body;
    if (!isValidCredentials(body)) {
      return reply.status(400).send({
        error: 'Invalid credential format. Expected: { cookie: object, imei: string, userAgent: string }',
      });
    }

    try {
      await prisma.zaloAccount.update({
        where: { id: accountId },
        data: {
          sessionData: body as any,
          status: 'disconnected',
        },
      });

      logger.info(`[credential-routes] Credentials imported for account ${accountId}`);
      return { success: true, message: 'Credentials imported. Use reconnect to activate.' };
    } catch (err) {
      logger.error(`[credential-routes] Import failed for account ${accountId}:`, err);
      return reply.status(500).send({ error: 'Failed to save credentials' });
    }
  });
}
