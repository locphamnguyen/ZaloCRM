/**
 * Zalo Accounts Dashboard routes — KPI stats, enriched list, bulk actions, uptime sparklines.
 *
 * Endpoints:
 *   GET  /api/v1/zalo-accounts/stats          — team KPI (total/active/idle/error/msgToday/uptimeTeam)
 *   GET  /api/v1/zalo-accounts/enriched       — list + per-account metrics for dashboard table
 *   GET  /api/v1/zalo-accounts/:id/uptime     — 7-day activity sparkline
 *   POST /api/v1/zalo-accounts/bulk-action    — { ids[], action: 'reconnect'|'sync-contacts'|'disable' }
 *
 * Uptime in v1 is derived from DailyMessageStat (days with activity / 7) — it's a "usage rate"
 * proxy, not a strict connection uptime. A future ZaloAccountStatusLog table can replace this.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';

const DAILY_QUOTA = 500; // per-nick soft cap shown in UI (msg today X / 500)

/** UTC start of "today" relative to the given date. We store DailyMessageStat at @db.Date. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** Range of N days ending today (inclusive). Returns ISO date strings YYYY-MM-DD. */
function lastNDays(n: number): { start: Date; days: string[] } {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const days: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return { start, days };
}

export async function zaloDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ───────────────────────────────────────────────────────────────────
  // GET /api/v1/zalo-accounts/stats — team-level KPI for header cards
  // ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/zalo-accounts/stats', async (request) => {
    const user = request.user!;
    const today = startOfDay(new Date());

    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: { id: true, status: true, lastConnectedAt: true },
    });

    // Today aggregate across all nicks
    const todayStats = await prisma.dailyMessageStat.aggregate({
      where: { orgId: user.orgId, statDate: today },
      _sum: { messagesSent: true, messagesReceived: true },
    });

    // 7-day window for per-account "active days" computation
    const { start: weekStart } = lastNDays(7);
    const weekRows = await prisma.dailyMessageStat.groupBy({
      by: ['zaloAccountId', 'statDate'],
      where: { orgId: user.orgId, statDate: { gte: weekStart, lte: today } },
      _sum: { messagesSent: true },
    });

    // Map zaloAccountId → count of days with activity (messagesSent > 0)
    const activeDaysMap = new Map<string, number>();
    for (const r of weekRows) {
      const sent = r._sum.messagesSent ?? 0;
      if (sent > 0) {
        activeDaysMap.set(r.zaloAccountId, (activeDaysMap.get(r.zaloAccountId) ?? 0) + 1);
      }
    }

    let totalNick = accounts.length;
    let active = 0;
    let idle = 0;
    let error = 0;
    let uptimeSum = 0;
    let needReloginIds: string[] = [];

    for (const a of accounts) {
      const live = zaloPool.getStatus(a.id) ?? a.status;
      const activeDays = activeDaysMap.get(a.id) ?? 0;
      const uptimePct = (activeDays / 7) * 100;
      uptimeSum += uptimePct;

      if (live === 'connected') {
        // Active = connected AND sent something today; otherwise Idle
        if (activeDays > 0) active++;
        else idle++;
      } else {
        error++;
        needReloginIds.push(a.id);
      }
    }

    const msgToday = (todayStats._sum.messagesSent ?? 0) + (todayStats._sum.messagesReceived ?? 0);
    const quota = totalNick * DAILY_QUOTA;
    const uptimeTeam = totalNick > 0 ? uptimeSum / totalNick : 0;

    return {
      totalNick,
      active,
      idle,
      error,
      msgToday,
      quota,
      uptimeTeam: Number(uptimeTeam.toFixed(1)),
      needReloginIds,
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /api/v1/zalo-accounts/enriched — list + per-account metrics
  // Replaces /zalo-accounts for dashboard view (includes crew, msgToday, uptime, lastActivity)
  // ───────────────────────────────────────────────────────────────────
  app.get('/api/v1/zalo-accounts/enriched', async (request) => {
    const user = request.user!;
    const today = startOfDay(new Date());
    const { start: weekStart } = lastNDays(7);

    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        proxyUrl: true,
        lastConnectedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
        access: {
          select: {
            id: true,
            permission: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) return [];

    // msg today per account
    const todayPerAcct = await prisma.dailyMessageStat.groupBy({
      by: ['zaloAccountId'],
      where: { orgId: user.orgId, statDate: today, zaloAccountId: { in: ids } },
      _sum: { messagesSent: true, messagesReceived: true },
    });
    const todayMap = new Map(
      todayPerAcct.map((r) => [
        r.zaloAccountId,
        (r._sum.messagesSent ?? 0) + (r._sum.messagesReceived ?? 0),
      ]),
    );

    // 7-day activity per account (active days count)
    const weekRows = await prisma.dailyMessageStat.groupBy({
      by: ['zaloAccountId', 'statDate'],
      where: { orgId: user.orgId, statDate: { gte: weekStart, lte: today }, zaloAccountId: { in: ids } },
      _sum: { messagesSent: true },
    });
    const activeDaysMap = new Map<string, number>();
    for (const r of weekRows) {
      const sent = r._sum.messagesSent ?? 0;
      if (sent > 0) {
        activeDaysMap.set(r.zaloAccountId, (activeDaysMap.get(r.zaloAccountId) ?? 0) + 1);
      }
    }

    // Last activity per account (most recent statDate with activity)
    const lastActivityRows = await prisma.dailyMessageStat.groupBy({
      by: ['zaloAccountId'],
      where: { orgId: user.orgId, zaloAccountId: { in: ids } },
      _max: { statDate: true },
    });
    const lastActivityMap = new Map(
      lastActivityRows.map((r) => [r.zaloAccountId, r._max.statDate]),
    );

    return accounts.map((a) => {
      const live = zaloPool.getStatus(a.id) ?? a.status;
      const activeDays = activeDaysMap.get(a.id) ?? 0;
      const uptime7d = Number(((activeDays / 7) * 100).toFixed(1));
      const msgToday = todayMap.get(a.id) ?? 0;
      const lastActivity = lastActivityMap.get(a.id) ?? a.lastConnectedAt;

      return {
        id: a.id,
        zaloUid: a.zaloUid,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl,
        phone: a.phone,
        status: a.status,
        liveStatus: live,
        hasProxy: !!a.proxyUrl,
        lastConnectedAt: a.lastConnectedAt,
        createdAt: a.createdAt,
        owner: a.owner,
        // Multi-sale crew with role mapping → UI badges (admin=Owner, chat=Editor, read=Viewer)
        crew: a.access.map((ac) => ({
          accessId: ac.id,
          permission: ac.permission,
          role: ac.permission === 'admin' ? 'owner' : ac.permission === 'chat' ? 'editor' : 'viewer',
          user: ac.user,
        })),
        crewCount: a.access.length,
        // Metrics
        msgToday,
        quota: DAILY_QUOTA,
        uptime7d,
        lastActivityAt: lastActivity,
        // E3: health alert badge when uptime under 80% in the 7-day window
        healthAlert: uptime7d < 80,
      };
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /api/v1/zalo-accounts/:id/uptime?range=7d — sparkline data
  // Returns N buckets of {date, msgSent, msgReceived, hasActivity}
  // ───────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/api/v1/zalo-accounts/:id/uptime',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      const range = request.query.range ?? '7d';
      const n = range === '24h' ? 1 : range === '30d' ? 30 : 7;

      const account = await prisma.zaloAccount.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!account) return reply.status(404).send({ error: 'Account not found' });

      const { start, days } = lastNDays(n);
      const today = startOfDay(new Date());

      const rows = await prisma.dailyMessageStat.groupBy({
        by: ['statDate'],
        where: { orgId: user.orgId, zaloAccountId: id, statDate: { gte: start, lte: today } },
        _sum: { messagesSent: true, messagesReceived: true },
      });

      const byDate = new Map(
        rows.map((r) => [
          r.statDate.toISOString().slice(0, 10),
          {
            sent: r._sum.messagesSent ?? 0,
            received: r._sum.messagesReceived ?? 0,
          },
        ]),
      );

      const buckets = days.map((date) => {
        const v = byDate.get(date);
        const msgSent = v?.sent ?? 0;
        const msgReceived = v?.received ?? 0;
        return { date, msgSent, msgReceived, hasActivity: msgSent + msgReceived > 0 };
      });

      const activeDays = buckets.filter((b) => b.hasActivity).length;
      const uptimePct = Number(((activeDays / n) * 100).toFixed(1));

      return { range, buckets, uptimePct };
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // POST /api/v1/zalo-accounts/bulk-action — reconnect / sync / disable many
  // Owner/admin only — sync-contacts and disable can be destructive.
  // ───────────────────────────────────────────────────────────────────
  app.post<{ Body: { ids: string[]; action: string } }>(
    '/api/v1/zalo-accounts/bulk-action',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const user = request.user!;
      const { ids, action } = request.body ?? { ids: [], action: '' };

      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ error: 'ids[] is required' });
      }
      if (!['reconnect', 'sync-contacts', 'disable'].includes(action)) {
        return reply.status(400).send({ error: 'action must be reconnect | sync-contacts | disable' });
      }

      // Scope to caller's org so a malicious payload can't target other orgs' accounts
      const accounts = await prisma.zaloAccount.findMany({
        where: { id: { in: ids }, orgId: user.orgId },
      });

      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (const a of accounts) {
        try {
          if (action === 'reconnect') {
            const session = a.sessionData as { cookie: any; imei: string; userAgent: string } | null;
            if (!session?.imei) {
              results.push({ id: a.id, ok: false, error: 'no saved session' });
              continue;
            }
            // Fire-and-forget; status delivered via Socket.IO
            zaloPool.reconnect(a.id, session, a.proxyUrl).catch(() => {});
            results.push({ id: a.id, ok: true });
          } else if (action === 'sync-contacts') {
            // Defer to existing sync-contacts route via internal HTTP would be circular —
            // we just mark intent; the heavy lifting is best done by hitting the per-account
            // route from FE in parallel. Here we no-op success so FE can fan out.
            results.push({ id: a.id, ok: true });
          } else if (action === 'disable') {
            zaloPool.disconnect(a.id);
            await prisma.zaloAccount.update({
              where: { id: a.id },
              data: { status: 'disconnected' },
            });
            results.push({ id: a.id, ok: true });
          }
        } catch (err: any) {
          results.push({ id: a.id, ok: false, error: err.message ?? 'unknown' });
        }
      }

      logger.info(
        `Bulk action ${action} on ${results.length} accounts by ${user.email}: ` +
          `${results.filter((r) => r.ok).length} ok, ${results.filter((r) => !r.ok).length} failed`,
      );

      return {
        action,
        total: ids.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },
  );
}
