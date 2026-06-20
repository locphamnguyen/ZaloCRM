// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * report-analytics-routes.ts — Analytics report endpoints for the Reports module.
 * 8 GET endpoints: overview, nick-fleet, sales-performance, pipeline, lead-pool,
 * automation, engagement, audit. All JWT-auth + gated by gateReportAccess, scoped
 * to request.user!.orgId, accept ?from=&to= (defaultDateRange fallback).
 * Follows _API_CONTRACT.md response shapes. Numbers always JS numbers (bigint→Number).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { getContactScope } from '../contacts/contact-scope.js';

type QueryParams = Record<string, string>;

/**
 * Phase Marketing+Analytics Scope 2026-05-27 — gate report routes:
 * - admin/owner → full org
 * - leader/deputy → dept-subtree (qua getContactScope cascade)
 * - member thường → 403 (sale không cần xem report team-wide)
 */
async function gateReportAccess(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = request.user!;
  if (user.role === 'owner' || user.role === 'admin') return true;
  const cScope = await getContactScope(user.id, user.orgId, user.role);
  if (cScope.isOrgAdmin) return true;
  // Leader/deputy: visibleUserIds.size > 1 (có người dưới dept)
  if (cScope.visibleUserIds.size > 1) return true;
  reply.status(403).send({
    error: 'Sale member không có quyền xem báo cáo team. Liên hệ trưởng phòng.',
    code: 'reports_member_forbidden',
  });
  return false;
}

function defaultDateRange() {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  return { from, to };
}

const N = (v: unknown): number => Number(v ?? 0);

function dateBounds(from: string, to: string) {
  const start = new Date(from + 'T00:00:00.000Z');
  const end = new Date(to + 'T00:00:00.000Z');
  end.setUTCDate(end.getUTCDate() + 1); // inclusive end-of-day
  return { start, end };
}

export async function reportAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET /api/v1/reports/overview
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const { start, end } = dateBounds(from, to);

      const now = new Date();
      const todayStart = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z');

      // Terminal statuses (closed-stage); "Chốt" = won
      const terminalStatuses = await prisma.status.findMany({
        where: { orgId, isTerminal: true },
        select: { id: true, name: true },
      });
      const wonStatusIds = terminalStatuses
        .filter((s) => (s.name || '').includes('Chốt'))
        .map((s) => s.id);
      const closedStatusIds = (wonStatusIds.length > 0 ? wonStatusIds : terminalStatuses.map((s) => s.id));

      const [
        totalContacts,
        newContacts,
        closedInRange,
        nicks,
        apptToday,
        apptDone,
        leadPoolWaiting,
        statuses,
      ] = await Promise.all([
        prisma.contact.count({ where: { orgId, mergedInto: null } }),
        prisma.contact.count({ where: { orgId, mergedInto: null, createdAt: { gte: start, lt: end } } }),
        prisma.contact.count({
          where: { orgId, mergedInto: null, statusId: { in: closedStatusIds.length ? closedStatusIds : ['__none__'] }, createdAt: { gte: start, lt: end } },
        }),
        prisma.zaloAccount.findMany({
          where: { orgId, archivedAt: null },
          select: { status: true },
        }),
        prisma.appointment.count({ where: { orgId, appointmentDate: { gte: todayStart } } }),
        prisma.appointment.count({ where: { orgId, status: 'completed', appointmentDate: { gte: start, lt: end } } }),
        prisma.leadRequest.count({ where: { orgId, releaseReason: null } }),
        prisma.status.findMany({ where: { orgId }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
      ]);

      const nicksTotal = nicks.length;
      const nicksOnline = nicks.filter((n) => n.status === 'connected').length;
      const nicksNeedRelogin = nicks.filter((n) => n.status !== 'connected').length;

      const totalInRange = await prisma.contact.count({
        where: { orgId, mergedInto: null, createdAt: { gte: start, lt: end } },
      });
      const closeRate = totalInRange > 0 ? Math.round((closedInRange / totalInRange) * 1000) / 10 : 0;

      // funnel by status.order
      const funnelCounts = await prisma.contact.groupBy({
        by: ['statusId'],
        where: { orgId, mergedInto: null, statusId: { not: null } },
        _count: true,
      });
      const countByStatus = new Map(funnelCounts.map((f) => [f.statusId, f._count]));
      const funnel = statuses.map((s) => ({ status: s.name, count: N(countByStatus.get(s.id)) }));

      // topSales — top 5 by closed
      const salesUsers = await prisma.user.findMany({
        where: { orgId, isActive: true },
        select: { id: true, fullName: true, departmentMember: { select: { department: { select: { name: true } } } } },
      });
      const topSalesRaw = await Promise.all(
        salesUsers.map(async (u) => {
          const [newC, closed] = await Promise.all([
            prisma.contact.count({ where: { orgId, mergedInto: null, assignedUserId: u.id, createdAt: { gte: start, lt: end } } }),
            prisma.contact.count({ where: { orgId, mergedInto: null, assignedUserId: u.id, statusId: { in: closedStatusIds.length ? closedStatusIds : ['__none__'] } } }),
          ]);
          return {
            userId: u.id,
            name: u.fullName,
            deptName: u.departmentMember?.department?.name || 'Chưa phân phòng',
            newContacts: newC,
            sent: 0, // TODO: deepen — heavy message aggregation
            closed,
          };
        })
      );
      const topSales = topSalesRaw.sort((a, b) => b.closed - a.closed || b.newContacts - a.newContacts).slice(0, 5);

      // riskNicks — top 5
      const nickRows = await prisma.zaloAccount.findMany({
        where: { orgId, archivedAt: null },
        select: { id: true, displayName: true, status: true, owner: { select: { fullName: true } } },
        take: 50,
      });
      const riskNicks = nickRows
        .map((n) => ({
          id: n.id,
          name: n.displayName,
          ownerName: n.owner?.fullName || '',
          status: n.status,
          quotaPct: 0, // TODO: deepen — quota from nick-metrics-service
          uptime7d: 0, // TODO: deepen
          risk: (n.status !== 'connected' ? 'disconnect' : 'ok') as 'disconnect' | 'quota' | 'stranger' | 'ok',
        }))
        .sort((a, b) => (a.risk === 'disconnect' ? -1 : 1) - (b.risk === 'disconnect' ? -1 : 1))
        .slice(0, 5);

      // msgSeries last 14d — TODO heavy message aggregation, return shape with zeros
      const msgSeries: Array<{ date: string; sent: number; received: number }> = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
        msgSeries.push({ date: d, sent: 0, received: 0 }); // TODO: deepen — real msg series
      }

      return {
        from,
        to,
        kpis: {
          totalContacts,
          newContacts,
          newContactsDelta: 0, // TODO: deepen — vs previous period
          nicksOnline,
          nicksTotal,
          nicksNeedRelogin,
          msgToday: 0, // TODO: deepen
          msgByBot: 0, // TODO: deepen
          apptToday,
          apptDone,
          leadPoolWaiting,
          leadPoolAutoReturnSoon: 0, // TODO: deepen — expiresAt within window
          closeRate,
          closeRateDelta: 0, // TODO: deepen
          friendAcceptRate: 0, // TODO: deepen
          friendInviteSent: 0, // TODO: deepen
          friendInviteAccepted: 0, // TODO: deepen
        },
        msgSeries,
        funnel,
        topSales,
        riskNicks,
      };
    } catch (err) {
      logger.error('[reports] Overview error:', err);
      return reply.status(500).send({ error: 'Failed to fetch overview report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GET /api/v1/reports/nick-fleet
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/nick-fleet', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;

      const nickRows = await prisma.zaloAccount.findMany({
        where: { orgId, archivedAt: null },
        select: { id: true, displayName: true, status: true, owner: { select: { fullName: true } } },
      });

      const total = nickRows.length;
      const online = nickRows.filter((n) => n.status === 'connected').length;
      const needRelogin = nickRows.filter((n) => n.status !== 'connected').length;

      const nicks = nickRows.map((n) => ({
        id: n.id,
        name: n.displayName,
        ownerName: n.owner?.fullName || '',
        status: n.status,
        uptime7d: 0, // TODO: deepen — uptimeWindowBatch service
        msgUser: 0, // TODO: deepen — nick-metrics-service
        msgBot: 0, // TODO: deepen
        friendSent: 0, // TODO: deepen
        friendAcceptPct: 0, // TODO: deepen
        sdkUsed: 0, // TODO: deepen — zaloRateLimiter
        sdkCap: 0, // TODO: deepen
        phoneFoundPct: 0, // TODO: deepen
      }));

      // alerts derived from disconnected count
      const alerts: Array<{ level: 'danger' | 'warn'; text: string }> = [];
      if (needRelogin > 0) {
        alerts.push({ level: 'danger', text: `${needRelogin} nick mất kết nối — cần đăng nhập lại` });
      }

      const uptimeHeat = nickRows.map((n) => ({
        nickId: n.id,
        name: n.displayName,
        days: [false, false, false, false, false, false, false], // TODO: deepen — last 7d activity
      }));

      return {
        from,
        to,
        kpis: {
          total,
          online,
          needRelogin,
          msgByBotToday: 0, // TODO: deepen
          uptimeTeamAvg: 0, // TODO: deepen
          friendAcceptAvg: 0, // TODO: deepen
          sdkUsedAvgPct: 0, // TODO: deepen
          phoneFoundPct: 0, // TODO: deepen
        },
        alerts,
        nicks,
        uptimeHeat,
        sdkByCategory: [], // TODO: deepen — sdk category breakdown
      };
    } catch (err) {
      logger.error('[reports] Nick-fleet error:', err);
      return reply.status(500).send({ error: 'Failed to fetch nick-fleet report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET /api/v1/reports/sales-performance
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/sales-performance', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const { start, end } = dateBounds(from, to);

      const terminalStatuses = await prisma.status.findMany({
        where: { orgId, isTerminal: true },
        select: { id: true, name: true },
      });
      const wonIds = terminalStatuses.filter((s) => (s.name || '').includes('Chốt')).map((s) => s.id);
      const closedStatusIds = wonIds.length > 0 ? wonIds : terminalStatuses.map((s) => s.id);
      const closedFilter = closedStatusIds.length ? closedStatusIds : ['__none__'];

      const users = await prisma.user.findMany({
        where: { orgId, isActive: true },
        select: {
          id: true,
          fullName: true,
          departmentMember: { select: { department: { select: { name: true } } } },
        },
      });

      const sales = await Promise.all(
        users.map(async (u) => {
          const [contacts, apptGroups, closed, leadPoolUsed] = await Promise.all([
            prisma.contact.count({ where: { orgId, mergedInto: null, assignedUserId: u.id } }),
            prisma.appointment.groupBy({
              by: ['status'],
              where: { orgId, assignedUserId: u.id, appointmentDate: { gte: start, lt: end } },
              _count: true,
            }),
            prisma.contact.count({ where: { orgId, mergedInto: null, assignedUserId: u.id, statusId: { in: closedFilter } } }),
            prisma.leadRequest.count({ where: { orgId, requestedByUserId: u.id, requestedAt: { gte: start, lt: end } } }),
          ]);
          const apptDone = N(apptGroups.find((g) => g.status === 'completed')?._count);
          const apptNoShow = N(apptGroups.find((g) => g.status === 'no_show')?._count);
          const score = closed * 10 + apptDone * 2;
          return {
            userId: u.id,
            name: u.fullName,
            deptName: u.departmentMember?.department?.name || 'Chưa phân phòng',
            contacts,
            sent: 0, // TODO: deepen — heavy message aggregation
            avgResponseMin: 0, // TODO: deepen — response-time service
            apptDone,
            apptNoShow,
            closed,
            leadPoolUsed,
            score,
          };
        })
      );
      sales.sort((a, b) => b.score - a.score);

      const activeSales = sales.filter((s) => s.contacts > 0).length;
      const totalSales = sales.length;
      const avgCloseRateNum = sales.length
        ? sales.reduce((acc, s) => acc + (s.contacts > 0 ? s.closed / s.contacts : 0), 0) / sales.length
        : 0;

      // byDept
      const deptMap = new Map<string, { contacts: number; sent: number; closed: number }>();
      for (const s of sales) {
        const cur = deptMap.get(s.deptName) || { contacts: 0, sent: 0, closed: 0 };
        cur.contacts += s.contacts;
        cur.closed += s.closed;
        deptMap.set(s.deptName, cur);
      }
      const byDept = Array.from(deptMap.entries()).map(([deptName, v]) => ({
        deptName,
        contacts: v.contacts,
        sent: v.sent,
        closed: v.closed,
        closeRate: v.contacts > 0 ? Math.round((v.closed / v.contacts) * 1000) / 10 : 0,
      }));

      // responseBuckets — 5 labels, TODO real distribution
      const responseBuckets = [
        { label: '<5p', count: 0 },
        { label: '5-15p', count: 0 },
        { label: '15-30p', count: 0 },
        { label: '30-60p', count: 0 },
        { label: '>1h', count: 0 },
      ]; // TODO: deepen — real response-time buckets

      return {
        from,
        to,
        kpis: {
          activeSales,
          totalSales,
          avgSentPerSale: 0, // TODO: deepen
          avgResponseMin: 0, // TODO: deepen
          avgCloseRate: Math.round(avgCloseRateNum * 1000) / 10,
        },
        sales,
        byDept,
        responseBuckets,
      };
    } catch (err) {
      logger.error('[reports] Sales-performance error:', err);
      return reply.status(500).send({ error: 'Failed to fetch sales-performance report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. GET /api/v1/reports/pipeline
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const { start, end } = dateBounds(from, to);

      const statuses = await prisma.status.findMany({
        where: { orgId },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, isTerminal: true },
      });
      const terminalIds = statuses.filter((s) => s.isTerminal && (s.name || '').includes('Chốt')).map((s) => s.id);
      const closedStatusIds = terminalIds.length > 0 ? terminalIds : statuses.filter((s) => s.isTerminal).map((s) => s.id);

      const funnelCounts = await prisma.contact.groupBy({
        by: ['statusId'],
        where: { orgId, mergedInto: null, statusId: { not: null } },
        _count: true,
      });
      const countByStatus = new Map(funnelCounts.map((f) => [f.statusId, f._count]));

      let prev = 0;
      const funnel = statuses.map((s, idx) => {
        const count = N(countByStatus.get(s.id));
        const dropPct = idx === 0 || prev === 0 ? 0 : Math.round(((prev - count) / prev) * 1000) / 10;
        prev = count;
        return { status: s.name, count, dropPct };
      });

      const timeInStage = statuses.map((s) => ({ status: s.name, avgDays: 0 })); // TODO: deepen — avg time in stage

      const totalInRange = await prisma.contact.count({
        where: { orgId, mergedInto: null, createdAt: { gte: start, lt: end } },
      });
      const closedInRange = await prisma.contact.count({
        where: { orgId, mergedInto: null, statusId: { in: closedStatusIds.length ? closedStatusIds : ['__none__'] }, createdAt: { gte: start, lt: end } },
      });
      const closeRate = totalInRange > 0 ? Math.round((closedInRange / totalInRange) * 1000) / 10 : 0;

      const leadPoolWaiting = await prisma.leadRequest.count({ where: { orgId, releaseReason: null } });
      const totalLead = await prisma.leadRequest.count({ where: { orgId } });
      const autoReturned = await prisma.leadRequest.count({ where: { orgId, autoReturnedAt: { not: null } } });
      const returnRate = totalLead > 0 ? Math.round((autoReturned / totalLead) * 1000) / 10 : 0;

      // bySource — Contact groupBy source with leads + closed
      const bySourceGroups = await prisma.contact.groupBy({
        by: ['source'],
        where: { orgId, mergedInto: null },
        _count: true,
      });
      const bySource = await Promise.all(
        bySourceGroups.map(async (g) => {
          const closed = await prisma.contact.count({
            where: { orgId, mergedInto: null, source: g.source, statusId: { in: closedStatusIds.length ? closedStatusIds : ['__none__'] } },
          });
          const leads = g._count;
          return {
            source: g.source || 'Không rõ',
            leads,
            contactedPct: 0, // TODO: deepen — contacted ratio
            closed,
            closeRate: leads > 0 ? Math.round((closed / leads) * 1000) / 10 : 0,
          };
        })
      );

      return {
        from,
        to,
        kpis: {
          closeRate,
          avgTimeInStageDays: 0, // TODO: deepen
          leadPoolWaiting,
          returnRate,
        },
        funnel,
        timeInStage,
        bySource,
      };
    } catch (err) {
      logger.error('[reports] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET /api/v1/reports/lead-pool
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/lead-pool', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const { start, end } = dateBounds(from, to);
      const now = new Date();

      const [waiting, totalLead, autoReturned, distributedThisPeriod] = await Promise.all([
        prisma.leadRequest.count({ where: { orgId, releaseReason: null } }),
        prisma.leadRequest.count({ where: { orgId } }),
        prisma.leadRequest.count({ where: { orgId, autoReturnedAt: { not: null } } }),
        prisma.leadPoolDistribution.count({ where: { orgId, distributedAt: { gte: start, lt: end } } }),
      ]);
      const returnRate = totalLead > 0 ? Math.round((autoReturned / totalLead) * 1000) / 10 : 0;

      // byUser: distribution received + requests state
      const [distGroups, users] = await Promise.all([
        prisma.leadPoolDistribution.groupBy({
          by: ['assignedToUserId'],
          where: { orgId },
          _count: true,
        }),
        prisma.user.findMany({ where: { orgId }, select: { id: true, fullName: true } }),
      ]);
      const userName = new Map(users.map((u) => [u.id, u.fullName]));
      const receivedByUser = new Map(distGroups.map((g) => [g.assignedToUserId, g._count]));

      // build set of users that appear in either distributions or requests
      const reqGroups = await prisma.leadRequest.groupBy({
        by: ['requestedByUserId'],
        where: { orgId },
        _count: true,
      });
      const userIds = new Set<string>();
      for (const g of distGroups) if (g.assignedToUserId) userIds.add(g.assignedToUserId);
      for (const g of reqGroups) if (g.requestedByUserId) userIds.add(g.requestedByUserId);

      const byUser = await Promise.all(
        Array.from(userIds).map(async (uid) => {
          const [holding, returned, overdue] = await Promise.all([
            prisma.leadRequest.count({ where: { orgId, requestedByUserId: uid, releaseReason: null } }),
            prisma.leadRequest.count({ where: { orgId, requestedByUserId: uid, releaseReason: { in: ['auto_return', 'manual_return'] } } }),
            prisma.leadRequest.count({ where: { orgId, requestedByUserId: uid, releaseReason: null, expiresAt: { lt: now } } }),
          ]);
          return {
            userId: uid,
            name: userName.get(uid) || '',
            received: N(receivedByUser.get(uid)),
            holding,
            returned,
            overdue,
          };
        })
      );

      // stuck: Contact with stuckSinceAggregate not null, top 10
      const stuckContacts = await prisma.contact.findMany({
        where: { orgId, mergedInto: null, stuckSinceAggregate: { not: null } },
        orderBy: { stuckSinceAggregate: 'asc' },
        take: 10,
        select: {
          id: true,
          fullName: true,
          stuckSinceAggregate: true,
          statusRef: { select: { name: true } },
          assignedUser: { select: { fullName: true } },
        },
      });
      const stuck = stuckContacts.map((c) => ({
        contactId: c.id,
        contactName: c.fullName,
        stage: c.statusRef?.name || '',
        daysStuck: c.stuckSinceAggregate
          ? Math.floor((now.getTime() - new Date(c.stuckSinceAggregate).getTime()) / 86400000)
          : 0,
        saleName: c.assignedUser?.fullName || '',
      }));

      return {
        from,
        to,
        kpis: {
          waiting,
          avgHoldHours: 0, // TODO: deepen — avg hold duration
          returnRate,
          distributedThisPeriod,
        },
        byUser,
        stuck,
      };
    } catch (err) {
      logger.error('[reports] Lead-pool error:', err);
      return reply.status(500).send({ error: 'Failed to fetch lead-pool report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. GET /api/v1/reports/automation
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/automation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const last24h = new Date(Date.now() - 24 * 3600000);

      const sequences = await prisma.automationSequence.findMany({
        where: { orgId },
        select: {
          id: true,
          name: true,
          enrolledCountCached: true,
          completedCountCached: true,
          replyCountCached: true,
          failedCount: true,
          blockCountCached: true,
          enabled: true,
        },
      });

      const enrolled = sequences.reduce((a, s) => a + N(s.enrolledCountCached), 0);
      const replied = sequences.reduce((a, s) => a + N(s.replyCountCached), 0);
      const activeSequences = sequences.filter((s) => s.enabled).length;
      const replyRate = enrolled > 0 ? Math.round((replied / enrolled) * 1000) / 10 : 0;

      // failedRate24h from AutomationEventLog
      const [totalEvents24h, failedEvents24h] = await Promise.all([
        prisma.automationEventLog.count({ where: { orgId, createdAt: { gte: last24h } } }),
        prisma.automationEventLog.count({ where: { orgId, createdAt: { gte: last24h }, eventType: { contains: 'failed', mode: 'insensitive' } } }),
      ]);
      const failedRate24h = totalEvents24h > 0 ? Math.round((failedEvents24h / totalEvents24h) * 1000) / 10 : 0;

      const sequencesOut = sequences.map((s) => {
        const enr = N(s.enrolledCountCached);
        const rep = N(s.replyCountCached);
        return {
          id: s.id,
          name: s.name,
          enrolled: enr,
          sent: 0, // TODO: deepen — sent count not cached on sequence
          replied: rep,
          completed: N(s.completedCountCached),
          replyRatePct: enr > 0 ? Math.round((rep / enr) * 1000) / 10 : 0,
        };
      });

      // skipReasons — AutomationEventLog where eventType contains 'skip'
      const skipGroups = await prisma.automationEventLog.groupBy({
        by: ['eventType'],
        where: { orgId, eventType: { contains: 'skip', mode: 'insensitive' } },
        _count: true,
      });
      const skipReasons = skipGroups.map((g) => ({
        reason: g.eventType,
        count: g._count,
        category: 'benign' as 'throttle' | 'capacity' | 'config_error' | 'benign', // TODO: deepen — categorize
      }));

      // careOutcomes — CareSession groupBy closedReason where state closed
      const careGroups = await prisma.careSession.groupBy({
        by: ['closedReason'],
        where: { orgId, state: 'closed' },
        _count: true,
      });
      const careOutcomes = careGroups.map((g) => ({ reason: g.closedReason || 'Không rõ', count: g._count }));

      // broadcasts — recent 5
      const broadcastRows = await prisma.automationBroadcast.findMany({
        where: { orgId },
        orderBy: { id: 'desc' },
        take: 5,
        select: { id: true, name: true, totalRecipients: true, sentCount: true, deliveredCount: true, failedCount: true, state: true },
      });
      const broadcasts = broadcastRows.map((b) => {
        const tot = N(b.totalRecipients);
        const sent = N(b.sentCount);
        const delivered = N(b.deliveredCount);
        return {
          id: b.id,
          name: b.name,
          totalRecipients: tot,
          sentPct: tot > 0 ? Math.round((sent / tot) * 1000) / 10 : 0,
          successPct: sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0,
          state: b.state,
        };
      });

      return {
        from,
        to,
        kpis: {
          activeSequences,
          enrolled,
          replyRate,
          friendAcceptRate: 0, // TODO: deepen
        },
        health: {
          workerLagSec: 0, // TODO: deepen — worker queue lag
          stuckTasks: 0, // TODO: deepen
          failedRate24h,
        },
        sequences: sequencesOut,
        skipReasons,
        careOutcomes,
        broadcasts,
      };
    } catch (err) {
      logger.error('[reports] Automation error:', err);
      return reply.status(500).send({ error: 'Failed to fetch automation report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. GET /api/v1/reports/engagement
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/engagement', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const { start, end } = dateBounds(from, to);

      const now = new Date();
      const days28Start = new Date(now.getTime() - 27 * 86400000);
      days28Start.setUTCHours(0, 0, 0, 0);

      // pattern distribution
      const patternGroups = await prisma.contact.groupBy({
        by: ['engagementPattern'],
        where: { orgId, mergedInto: null, engagementPattern: { not: null } },
        _count: true,
      });
      const patternDist = patternGroups.map((g) => ({ pattern: g.engagementPattern || 'unknown', count: g._count }));

      const patternCount = (names: string[]) =>
        patternGroups.filter((g) => names.includes((g.engagementPattern || '').toLowerCase())).reduce((a, g) => a + g._count, 0);
      const hotCount = patternCount(['hot', 'champion']);
      const coolingCount = patternCount(['cooling', 'cold']);

      // customerInitiatedPct = % ngày KH nhắn trước (Boolean → count true / total).
      const [ciTrue, ciTotal] = await Promise.all([
        prisma.contactEngagementDaily.count({ where: { orgId, date: { gte: start, lt: end }, customerInitiated: true } }),
        prisma.contactEngagementDaily.count({ where: { orgId, date: { gte: start, lt: end } } }),
      ]);
      const customerInitiatedPct = ciTotal ? Math.round((ciTrue / ciTotal) * 1000) / 10 : 0;

      // heatmap: top 15 contacts by recent sum(dailyIntensity)
      const intensityGroups = await prisma.contactEngagementDaily.groupBy({
        by: ['contactId'],
        where: { orgId, date: { gte: days28Start } },
        _sum: { dailyIntensity: true },
        orderBy: { _sum: { dailyIntensity: 'desc' } },
        take: 15,
      });
      const topContactIds = intensityGroups.map((g) => g.contactId);
      const heatContacts = await prisma.contact.findMany({
        where: { id: { in: topContactIds.length ? topContactIds : ['__none__'] } },
        select: { id: true, fullName: true },
      });
      const heatNameMap = new Map(heatContacts.map((c) => [c.id, c.fullName]));
      const dailyRows = await prisma.contactEngagementDaily.findMany({
        where: { orgId, contactId: { in: topContactIds.length ? topContactIds : ['__none__'] }, date: { gte: days28Start } },
        select: { contactId: true, date: true, dailyIntensity: true },
      });
      const bucket = (v: number) => {
        if (v <= 0) return 0;
        if (v <= 20) return 1;
        if (v <= 40) return 2;
        if (v <= 60) return 3;
        if (v <= 80) return 4;
        return 5;
      };
      // build day index list (28 days)
      const dayKeys: string[] = [];
      for (let i = 0; i < 28; i++) {
        dayKeys.push(new Date(days28Start.getTime() + i * 86400000).toISOString().split('T')[0]);
      }
      const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));
      const cellsByContact = new Map<string, number[]>();
      for (const cid of topContactIds) cellsByContact.set(cid, new Array(28).fill(0));
      for (const r of dailyRows) {
        const key = new Date(r.date).toISOString().split('T')[0];
        const idx = dayIndex.get(key);
        if (idx === undefined) continue;
        const arr = cellsByContact.get(r.contactId);
        if (arr) arr[idx] = bucket(N(r.dailyIntensity));
      }
      const heatmap = topContactIds.map((cid) => ({
        contactId: cid,
        name: heatNameMap.get(cid) || '',
        cells: cellsByContact.get(cid) || new Array(28).fill(0),
      }));

      // interactionTypes — sum over range
      const interAgg = await prisma.contactEngagementDaily.aggregate({
        where: { orgId, date: { gte: start, lt: end } },
        _sum: {
          inboundMsgCount: true,
          outboundMsgCount: true,
          reactionCount: true,
          voiceMsgCount: true,
          callCount: true,
        },
      });
      const interactionTypes = {
        inbound: N(interAgg._sum.inboundMsgCount),
        outbound: N(interAgg._sum.outboundMsgCount),
        reaction: N(interAgg._sum.reactionCount),
        voiceCall: N(interAgg._sum.voiceMsgCount) + N(interAgg._sum.callCount),
      };

      // avgInteractionsPerDay
      const totalInter = interactionTypes.inbound + interactionTypes.outbound;
      const dayCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
      const avgInteractionsPerDay = Math.round((totalInter / dayCount) * 10) / 10;

      // cooling: top 5 contacts pattern cooling/cold
      const coolingContacts = await prisma.contact.findMany({
        where: { orgId, mergedInto: null, engagementPattern: { in: ['cooling', 'cold'] } },
        orderBy: { stuckSinceAggregate: 'asc' },
        take: 5,
        select: { id: true, fullName: true, leadScore: true, stuckSinceAggregate: true, assignedUser: { select: { fullName: true } } },
      });
      const cooling = coolingContacts.map((c) => ({
        contactId: c.id,
        name: c.fullName,
        saleName: c.assignedUser?.fullName || '',
        silentDays: c.stuckSinceAggregate
          ? Math.floor((now.getTime() - new Date(c.stuckSinceAggregate).getTime()) / 86400000)
          : 0,
        score: N(c.leadScore),
      }));

      // hot: top 5 contacts pattern hot/champion
      const hotContacts = await prisma.contact.findMany({
        where: { orgId, mergedInto: null, engagementPattern: { in: ['hot', 'champion'] } },
        orderBy: { leadScore: 'desc' },
        take: 5,
        select: { id: true, fullName: true, leadScore: true, engagementPattern: true, assignedUser: { select: { fullName: true } } },
      });
      const hot = hotContacts.map((c) => ({
        contactId: c.id,
        name: c.fullName,
        saleName: c.assignedUser?.fullName || '',
        signal: c.engagementPattern || '',
        score: N(c.leadScore),
      }));

      return {
        from,
        to,
        kpis: {
          hotCount,
          coolingCount,
          customerInitiatedPct,
          avgInteractionsPerDay,
        },
        heatmap,
        patternDist,
        cooling,
        hot,
        interactionTypes,
      };
    } catch (err) {
      logger.error('[reports] Engagement error:', err);
      return reply.status(500).send({ error: 'Failed to fetch engagement report' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. GET /api/v1/reports/audit
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/api/v1/reports/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;

      const now = new Date();
      const todayStart = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z');
      const last24h = new Date(now.getTime() - 24 * 3600000);

      const [changesToday, nickDisconnect24h, totalEvents24h, failedEvents24h] = await Promise.all([
        prisma.activityLog.count({ where: { orgId, createdAt: { gte: todayStart } } }),
        prisma.zaloAccountStatusLog.count({ where: { orgId, status: 'disconnected', startedAt: { gte: last24h } } }),
        prisma.automationEventLog.count({ where: { orgId, createdAt: { gte: last24h } } }),
        prisma.automationEventLog.count({ where: { orgId, createdAt: { gte: last24h }, eventType: { contains: 'failed', mode: 'insensitive' } } }),
      ]);
      const errorRate24h = totalEvents24h > 0 ? Math.round((failedEvents24h / totalEvents24h) * 1000) / 10 : 0;

      // systemHealth.cronJobs — 6 known job names (TODO real registry)
      const cronJobs = [
        { name: 'lead-pool-auto-return', ok: true, lastRunMinAgo: null as number | null },
        { name: 'engagement-daily-rollup', ok: true, lastRunMinAgo: null },
        { name: 'contact-aggregate-refresh', ok: true, lastRunMinAgo: null },
        { name: 'nick-uptime-monitor', ok: true, lastRunMinAgo: null },
        { name: 'automation-scheduler', ok: true, lastRunMinAgo: null },
        { name: 'stuck-contact-detector', ok: true, lastRunMinAgo: null },
      ]; // TODO: deepen — read real cron registry for lastRunMinAgo + ok

      // activity feed — latest 20
      const activityRows = await prisma.activityLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          actorType: true,
          botName: true,
          systemSource: true,
          category: true,
          action: true,
          entityType: true,
          entityId: true,
          user: { select: { fullName: true } },
        },
      });
      const activity = activityRows.map((a) => ({
        id: a.id,
        ts: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
        actorName: a.user?.fullName || a.botName || a.systemSource || 'Hệ thống',
        actorType: a.actorType,
        isBot: a.actorType !== 'user',
        category: a.category,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
      }));

      // disconnects — ZaloAccountStatusLog disconnect events 24h
      const disconnectRows = await prisma.zaloAccountStatusLog.findMany({
        where: { orgId, status: 'disconnected', startedAt: { gte: last24h } },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          startedAt: true,
          endedAt: true,
          reason: true,
          account: { select: { displayName: true } },
        },
      });
      const disconnects = disconnectRows.map((d) => ({
        ts: d.startedAt instanceof Date ? d.startedAt.toISOString() : String(d.startedAt),
        nickName: d.account?.displayName || '',
        reason: d.reason || '',
        downMinutes: d.endedAt
          ? Math.round((new Date(d.endedAt).getTime() - new Date(d.startedAt).getTime()) / 60000)
          : 0,
      }));

      return {
        from,
        to,
        kpis: {
          changesToday,
          cronOk: cronJobs.filter((c) => c.ok).length, // khớp với systemHealth.cronJobs
          cronTotal: cronJobs.length,
          queueWaiting: 0, // TODO: deepen — real queue depth
          nickDisconnect24h,
        },
        systemHealth: {
          cronJobs,
          queues: [], // TODO: deepen — real queue registry
          errorRate24h,
          errorBreakdown: [], // TODO: deepen — error category breakdown
        },
        activity,
        disconnects,
      };
    } catch (err) {
      logger.error('[reports] Audit error:', err);
      return reply.status(500).send({ error: 'Failed to fetch audit report' });
    }
  });

  // 9. GET /api/v1/reports/crm-usage — mức độ dùng CRM của sale (anh chốt 2026-06-17):
  // thời gian dùng/ngày (ƯỚC TÍNH từ sessionize ActivityLog), module dùng nhiều, xếp hạng
  // dùng CRM HIỆU QUẢ = kết quả (chốt + lịch hẹn xong) ÷ giờ dùng. Login (security) neo phiên.
  app.get('/api/v1/reports/crm-usage', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!(await gateReportAccess(request, reply))) return;
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: dF, to: dT } = defaultDateRange();
      const from = query.from || dF;
      const to = query.to || dT;
      const { start, end } = dateBounds(from, to);
      const todayStart = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z');

      // category → tên module hiển thị. security/system/admin = phụ trợ (vẫn tính giờ, không là "module chính").
      const MODULE_MAP: Record<string, string> = {
        customer_info: 'Khách hàng', tags_crm: 'Gắn thẻ', status_care: 'Trạng thái & Chăm sóc',
        appointment: 'Lịch hẹn', interaction: 'Tương tác', score: 'Chấm điểm', tags_zalo: 'Nhãn Zalo',
        automation: 'Automation', security: 'Đăng nhập', system: 'Hệ thống', admin: 'Quản trị',
      };
      const AUX = new Set(['security', 'system', 'admin']);

      // Sale list + phòng ban.
      const users = await prisma.user.findMany({
        where: { orgId, isActive: true },
        select: { id: true, fullName: true, departmentMember: { select: { department: { select: { name: true } } } } },
      });
      const userMap = new Map(users.map((u) => [u.id, {
        name: u.fullName || '—', deptName: u.departmentMember?.department?.name || 'Chưa phân phòng',
      }]));
      const saleIds = users.map((u) => u.id);

      // Sự kiện hoạt động (timeline + module count). Bao gồm cả security (login) để neo phiên.
      const events = saleIds.length === 0 ? [] : await prisma.activityLog.findMany({
        where: { orgId, actorType: 'user', userId: { in: saleIds }, createdAt: { gte: start, lt: end } },
        select: { userId: true, category: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 100000,
      });

      // Kết quả (chốt + lịch hẹn hoàn thành) để tính hiệu quả.
      const terminal = await prisma.status.findMany({ where: { orgId, isTerminal: true }, select: { id: true, name: true } });
      const wonIds = terminal.filter((s) => (s.name || '').includes('Chốt')).map((s) => s.id);
      const closedFilter = wonIds.length > 0 ? wonIds : terminal.map((s) => s.id);
      const outcomes = await Promise.all(saleIds.map(async (uid) => {
        const [closed, apptDone] = await Promise.all([
          prisma.contact.count({ where: { orgId, mergedInto: null, assignedUserId: uid, statusId: { in: closedFilter } } }),
          prisma.appointment.count({ where: { orgId, assignedUserId: uid, status: 'completed', appointmentDate: { gte: start, lt: end } } }),
        ]);
        return { uid, closed, apptDone };
      }));
      const outcomeMap = new Map(outcomes.map((o) => [o.uid, o]));

      // Thêm dữ liệu cho phễu (C: tin gửi → KH phản hồi → lịch hẹn → chốt) + so sánh kỳ (D).
      const periodMs = end.getTime() - start.getTime();
      const prevStart = new Date(start.getTime() - periodMs);
      const [prevEvents, sentRows, apptGroups, repliedGroups] = await Promise.all([
        saleIds.length === 0
          ? Promise.resolve([] as Array<{ userId: string | null; createdAt: Date }>)
          : prisma.activityLog.findMany({
            where: { orgId, actorType: 'user', userId: { in: saleIds }, createdAt: { gte: prevStart, lt: start } },
            select: { userId: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 100000,
          }),
        prisma.$queryRaw<Array<{ uid: string; sent: bigint }>>`
          SELECT za.owner_user_id AS uid, COUNT(*) AS sent
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          JOIN zalo_accounts za ON za.id = c.zalo_account_id
          WHERE c.org_id = ${orgId} AND m.sender_type = 'self' AND za.owner_user_id IS NOT NULL
            AND m.sent_at >= ${start} AND m.sent_at < ${end}
          GROUP BY za.owner_user_id`,
        prisma.appointment.groupBy({ by: ['assignedUserId'], where: { orgId, appointmentDate: { gte: start, lt: end } }, _count: true }),
        prisma.contact.groupBy({ by: ['assignedUserId'], where: { orgId, mergedInto: null, lastInboundAt: { gte: start, lt: end } }, _count: true }),
      ]);
      const sentBySale = new Map(sentRows.map((r) => [r.uid, Number(r.sent)]));
      const apptBySale = new Map(apptGroups.map((g) => [g.assignedUserId, g._count]));
      const repliedBySale = new Map(repliedGroups.map((g) => [g.assignedUserId, g._count]));

      // Gom theo sale theo NGÀY (giờ VN); sessionize TỪNG NGÀY (phiên không vắt nửa đêm) →
      // vừa ra giờ dùng/ngày (line chart) vừa tổng. Đồng thời dựng hourHeat (thứ × giờ).
      const TZ = 7 * 3600_000, GAP = 30 * 60_000, FLOOR = 5 * 60_000;
      const dayKey = (ms: number) => new Date(ms + TZ).toISOString().slice(0, 10);
      function dayActiveMs(ts: number[]): number {
        if (!ts.length) return 0;
        let ms = 0, sStart = ts[0], prev = ts[0];
        for (let i = 1; i < ts.length; i++) {
          if (ts[i] - prev > GAP) { ms += Math.max(FLOOR, prev - sStart); sStart = ts[i]; }
          prev = ts[i];
        }
        return ms + Math.max(FLOOR, prev - sStart);
      }

      const perUser = new Map<string, { byDay: Map<string, number[]>; cats: Map<string, number> }>();
      const moduleTotals = new Map<string, number>();
      const heat = new Map<string, number>();
      let heatMax = 0;
      for (const e of events) {
        if (!e.userId) continue;
        let u = perUser.get(e.userId);
        if (!u) { u = { byDay: new Map(), cats: new Map() }; perUser.set(e.userId, u); }
        const ms = e.createdAt.getTime();
        const dk = dayKey(ms);
        const arr = u.byDay.get(dk); if (arr) arr.push(ms); else u.byDay.set(dk, [ms]);
        const cat = e.category || 'system';
        u.cats.set(cat, (u.cats.get(cat) || 0) + 1);
        if (!AUX.has(cat)) moduleTotals.set(cat, (moduleTotals.get(cat) || 0) + 1);
        const local = new Date(ms + TZ);
        const hk = `${(local.getUTCDay() + 6) % 7}-${local.getUTCHours()}`; // d: 0=T2..6=CN
        const hv = (heat.get(hk) || 0) + 1; heat.set(hk, hv); if (hv > heatMax) heatMax = hv;
      }

      // Trục ngày liên tục cho line chart.
      const dayList: string[] = [];
      for (let t = start.getTime(); t < end.getTime(); t += 86400_000) dayList.push(dayKey(t));

      let totalActions = 0;
      const bySaleRaw = saleIds.map((uid) => {
        const u = perUser.get(uid);
        const info = userMap.get(uid)!;
        let actions = 0, activeMs = 0;
        const dayMs = new Map<string, number>();
        for (const [dk, ts] of (u?.byDay ?? new Map<string, number[]>())) {
          actions += ts.length;
          const m = dayActiveMs(ts.sort((a, b) => a - b));
          dayMs.set(dk, m); activeMs += m;
        }
        totalActions += actions;
        const activeDays = dayMs.size;
        const activeHours = Math.round((activeMs / 3600_000) * 10) / 10;
        const avgActiveMinPerDay = activeDays > 0 ? Math.round(activeMs / 60_000 / activeDays) : 0;
        let topModule = '—', topN = 0;
        for (const [cat, n] of (u?.cats ?? new Map<string, number>())) {
          if (AUX.has(cat)) continue;
          if (n > topN) { topN = n; topModule = MODULE_MAP[cat] || cat; }
        }
        const oc = outcomeMap.get(uid) || { closed: 0, apptDone: 0 };
        const results = oc.closed + oc.apptDone * 0.5;
        const effRaw = activeHours > 0 ? results / Math.max(activeHours, 0.5) : 0;
        const closesPerHour = activeHours > 0 ? Math.round((results / activeHours) * 100) / 100 : 0;
        return {
          userId: uid, name: info.name, deptName: info.deptName,
          activeDays, avgActiveMinPerDay, activeHours, actions, topModule,
          results, closed: oc.closed, apptDone: oc.apptDone, closesPerHour, effRaw, dayMs,
        };
      }).filter((s) => s.actions > 0);

      // effScore + bySale (bỏ field nội bộ).
      const maxEff = Math.max(0.0001, ...bySaleRaw.map((s) => s.effRaw));
      const bySale = bySaleRaw
        .map(({ effRaw, dayMs, ...s }) => ({ ...s, effScore: Math.round((effRaw / maxEff) * 100) }))
        .sort((a, b) => b.effScore - a.effScore || b.results - a.results);

      // (#1) Line chart: giờ dùng/ngày, mỗi sale 1 đường. Top 8 sale (nhiều giờ nhất) cho dễ đọc.
      const PALETTE = ['#1786be', '#7a4fb0', '#b0734f', '#4fb09a', '#b04f6e', '#5b8def', '#d39237', '#157f3c'];
      const dailySeries = [...bySaleRaw].sort((a, b) => b.activeHours - a.activeHours).slice(0, 8).map((s, i) => ({
        userId: s.userId, name: s.name, color: PALETTE[i % PALETTE.length],
        points: dayList.map((d) => ({ date: d, min: Math.round((s.dayMs.get(d) || 0) / 60_000) })),
      }));

      // (A) hourHeat (thứ × giờ).
      const hourHeat = {
        max: heatMax,
        cells: Array.from(heat.entries()).map(([k, count]) => {
          const [d, h] = k.split('-').map(Number); return { d, h, count };
        }),
      };

      // (C) phễu hoạt động → chốt / sale.
      const funnel = bySaleRaw.map((s) => ({
        userId: s.userId, name: s.name,
        sent: sentBySale.get(s.userId) || 0,
        replied: repliedBySale.get(s.userId) || 0,
        appts: apptBySale.get(s.userId) || 0,
        closed: s.closed,
      })).sort((a, b) => b.sent - a.sent).slice(0, 8);

      // (D) so sánh kỳ trước: actions + giờ dùng TB.
      const prevPerUser = new Map<string, Map<string, number[]>>();
      for (const e of prevEvents) {
        if (!e.userId) continue;
        let m = prevPerUser.get(e.userId); if (!m) { m = new Map(); prevPerUser.set(e.userId, m); }
        const ms = e.createdAt.getTime(); const dk = dayKey(ms);
        const arr = m.get(dk); if (arr) arr.push(ms); else m.set(dk, [ms]);
      }
      const compare = bySaleRaw.map((s) => {
        let pAct = 0, pMs = 0, pDays = 0;
        for (const [, ts] of (prevPerUser.get(s.userId) ?? new Map<string, number[]>())) {
          pAct += ts.length; pMs += dayActiveMs(ts.sort((a, b) => a - b)); pDays++;
        }
        const prevAvgMin = pDays > 0 ? Math.round(pMs / 60_000 / pDays) : 0;
        return {
          userId: s.userId, name: s.name,
          actions: s.actions, prevActions: pAct, dActions: s.actions - pAct,
          avgMin: s.avgActiveMinPerDay, prevAvgMin, dAvgMin: s.avgActiveMinPerDay - prevAvgMin,
        };
      }).sort((a, b) => b.actions - a.actions).slice(0, 10);

      // Module usage org-wide.
      const moduleTotalSum = Array.from(moduleTotals.values()).reduce((a, b) => a + b, 0) || 1;
      const moduleUsage = Array.from(moduleTotals.entries())
        .map(([cat, n]) => ({ module: cat, label: MODULE_MAP[cat] || cat, actions: n, pct: Math.round((n / moduleTotalSum) * 1000) / 10 }))
        .sort((a, b) => b.actions - a.actions);

      // KPIs.
      const activeSalesToday = new Set(events.filter((e) => e.createdAt >= todayStart).map((e) => e.userId)).size;
      const withTime = bySale.filter((s) => s.activeDays > 0);
      const avgActiveMinPerDay = withTime.length > 0
        ? Math.round(withTime.reduce((a, s) => a + s.avgActiveMinPerDay, 0) / withTime.length) : 0;
      const topModule = moduleUsage[0]?.label || '—';

      return {
        from, to,
        kpis: { activeSalesToday, avgActiveMinPerDay, totalActions, topModule },
        bySale, moduleUsage, dailySeries, days: dayList, hourHeat, funnel, compare,
        note: 'Thời gian dùng là ƯỚC TÍNH từ nhịp thao tác trên CRM (chưa có tracking phiên chính xác).',
      };
    } catch (err) {
      logger.error('[reports] CRM-usage error:', err);
      return reply.status(500).send({ error: 'Failed to fetch CRM usage report' });
    }
  });
}
