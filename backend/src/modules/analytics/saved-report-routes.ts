/**
 * saved-report-routes.ts — CRUD for SavedReport + run saved config.
 * All routes require JWT auth, scoped to user's orgId.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import {
  getConversionFunnel,
  getTeamPerformance,
  getResponseTimeAnalysis,
  executeCustomReport,
} from './analytics-service.js';
import type { ReportConfig } from './analytics-service.js';

export async function savedReportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/saved-reports — list all for org
  app.get('/api/v1/saved-reports', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const reports = await prisma.savedReport.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
      });
      return { data: reports };
    } catch (err) {
      logger.error('[saved-reports] List error:', err);
      return reply.status(500).send({ error: 'Failed to list saved reports' });
    }
  });

  // POST /api/v1/saved-reports — create
  app.post('/api/v1/saved-reports', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId, id: userId } = request.user!;
      const body = request.body as { name: string; type: string; config: any };
      if (!body.name || !body.type) {
        return reply.status(400).send({ error: 'name and type are required' });
      }
      const report = await prisma.savedReport.create({
        data: {
          orgId,
          name: body.name,
          type: body.type,
          config: body.config ?? {},
          createdBy: userId,
        },
      });
      return reply.status(201).send(report);
    } catch (err) {
      logger.error('[saved-reports] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create saved report' });
    }
  });

  // GET /api/v1/saved-reports/:id
  app.get('/api/v1/saved-reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };
      const report = await prisma.savedReport.findFirst({ where: { id, orgId } });
      if (!report) return reply.status(404).send({ error: 'Report not found' });
      return report;
    } catch (err) {
      logger.error('[saved-reports] Get error:', err);
      return reply.status(500).send({ error: 'Failed to fetch saved report' });
    }
  });

  // PUT /api/v1/saved-reports/:id
  app.put('/api/v1/saved-reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; config?: any };
      const existing = await prisma.savedReport.findFirst({ where: { id, orgId } });
      if (!existing) return reply.status(404).send({ error: 'Report not found' });
      const updated = await prisma.savedReport.update({
        where: { id },
        data: { name: body.name ?? existing.name, config: body.config ?? existing.config },
      });
      return updated;
    } catch (err) {
      logger.error('[saved-reports] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update saved report' });
    }
  });

  // DELETE /api/v1/saved-reports/:id
  app.delete('/api/v1/saved-reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };
      const existing = await prisma.savedReport.findFirst({ where: { id, orgId } });
      if (!existing) return reply.status(404).send({ error: 'Report not found' });
      await prisma.savedReport.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      logger.error('[saved-reports] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete saved report' });
    }
  });

  // POST /api/v1/saved-reports/:id/run — execute saved report
  app.post('/api/v1/saved-reports/:id/run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const { id } = request.params as { id: string };
      const report = await prisma.savedReport.findFirst({ where: { id, orgId } });
      if (!report) return reply.status(404).send({ error: 'Report not found' });

      const config = report.config as any;
      const from = config.dateRange?.from ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = config.dateRange?.to ?? new Date().toISOString().split('T')[0];

      switch (report.type) {
        case 'conversion_funnel':
          return await getConversionFunnel(orgId, from, to);
        case 'team_performance':
          return await getTeamPerformance(orgId, from, to);
        case 'response_time':
          return await getResponseTimeAnalysis(orgId, from, to);
        case 'custom':
          return await executeCustomReport(orgId, config as ReportConfig);
        default:
          return reply.status(400).send({ error: `Unknown report type: ${report.type}` });
      }
    } catch (err) {
      logger.error('[saved-reports] Run error:', err);
      return reply.status(500).send({ error: 'Failed to run saved report' });
    }
  });
}
