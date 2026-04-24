/**
 * analytics-routes.ts — Conversion funnel, team performance, response time, custom report.
 * All routes require JWT auth, scoped to user's orgId.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import {
  getConversionFunnel,
  getTeamPerformance,
  getResponseTimeAnalysis,
  executeCustomReport,
  getResponseHeatmap,
  getTagDistribution,
  getDripKpi,
} from './analytics-service.js';
import type { ReportConfig } from './analytics-service.js';
import { exportCsv, isValidExportType } from './csv-export.js';
import type { ReportFilters } from './csv-export.js';

type QueryParams = Record<string, string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultDateRange() {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  return { from, to };
}

/** Parse optional filter query params; silently ignore if absent or not a valid UUID. */
function parseFilters(query: QueryParams): ReportFilters {
  const filters: ReportFilters = {};
  if (query.zaloAccountId && UUID_RE.test(query.zaloAccountId)) {
    filters.zaloAccountId = query.zaloAccountId;
  }
  if (query.assignedUserId && UUID_RE.test(query.assignedUserId)) {
    filters.assignedUserId = query.assignedUserId;
  }
  return filters;
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/analytics/conversion-funnel?from=&to=&zaloAccountId=&assignedUserId=
  app.get('/api/v1/analytics/conversion-funnel', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from, to } = { ...defaultDateRange(), ...query };
      const result = await getConversionFunnel(orgId, from, to, parseFilters(query));
      return result;
    } catch (err) {
      logger.error('[analytics] Conversion funnel error:', err);
      return reply.status(500).send({ error: 'Failed to fetch conversion funnel' });
    }
  });

  // GET /api/v1/analytics/team-performance?from=&to=&zaloAccountId=&assignedUserId=
  app.get('/api/v1/analytics/team-performance', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from, to } = { ...defaultDateRange(), ...query };
      const result = await getTeamPerformance(orgId, from, to, parseFilters(query));
      return result;
    } catch (err) {
      logger.error('[analytics] Team performance error:', err);
      return reply.status(500).send({ error: 'Failed to fetch team performance' });
    }
  });

  // GET /api/v1/analytics/response-time?from=&to=&zaloAccountId=&assignedUserId=
  app.get('/api/v1/analytics/response-time', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from, to } = { ...defaultDateRange(), ...query };
      const result = await getResponseTimeAnalysis(orgId, from, to, parseFilters(query));
      return result;
    } catch (err) {
      logger.error('[analytics] Response time error:', err);
      return reply.status(500).send({ error: 'Failed to fetch response time' });
    }
  });

  // POST /api/v1/analytics/custom — body: ReportConfig
  app.post('/api/v1/analytics/custom', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const config = request.body as ReportConfig;
      if (!config.metrics?.length || !config.groupBy || !config.dateRange) {
        return reply.status(400).send({ error: 'metrics, groupBy, and dateRange are required' });
      }
      const result = await executeCustomReport(orgId, config);
      return result;
    } catch (err) {
      logger.error('[analytics] Custom report error:', err);
      return reply.status(500).send({ error: 'Failed to execute custom report' });
    }
  });

  // GET /api/v1/analytics/response-heatmap?from=&to=&zaloAccountId=&assignedUserId=
  app.get('/api/v1/analytics/response-heatmap', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from, to } = query;
      const result = await getResponseHeatmap(orgId, from, to, parseFilters(query));
      return result;
    } catch (err) {
      logger.error('[analytics] Response heatmap error:', err);
      return reply.status(500).send({ error: 'Failed to fetch response heatmap' });
    }
  });

  // GET /api/v1/analytics/tag-distribution?assignedUserId= (date range ignored — whole-org snapshot)
  app.get('/api/v1/analytics/tag-distribution', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const result = await getTagDistribution(orgId, parseFilters(query));
      return result;
    } catch (err) {
      logger.error('[analytics] Tag distribution error:', err);
      return reply.status(500).send({ error: 'Failed to fetch tag distribution' });
    }
  });

  // GET /api/v1/analytics/drip-kpi?from=&to=&assignedUserId=
  app.get('/api/v1/analytics/drip-kpi', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from, to } = query;
      const result = await getDripKpi(orgId, from, to, parseFilters(query));
      return result;
    } catch (err) {
      logger.error('[analytics] Drip KPI error:', err);
      return reply.status(500).send({ error: 'Failed to fetch drip KPI' });
    }
  });

  // GET /api/v1/analytics/export?type=<funnel|team|response|heatmap|tags|drip>&from=&to=&zaloAccountId=&assignedUserId=
  app.get('/api/v1/analytics/export', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;

      const { type } = query;
      if (!type || !isValidExportType(type)) {
        return reply.status(400).send({
          error: 'invalid_type',
          hint: `type must be one of: funnel, team, response, heatmap, tags, drip`,
        });
      }

      const { from, to } = { ...defaultDateRange(), ...query };
      const filters = parseFilters(query);

      const result = await exportCsv(orgId, type, from, to, filters);

      if ('error' in result) {
        if (result.error === 'too_large') {
          return reply.status(413).send({
            error: 'export_too_large',
            hint: 'narrow date range (max 50000 rows)',
          });
        }
        return reply.status(400).send({ error: 'unknown_type' });
      }

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send('﻿' + result.csv);
    } catch (err) {
      logger.error('[analytics] Export error:', err);
      return reply.status(500).send({ error: 'Failed to export report' });
    }
  });
}
