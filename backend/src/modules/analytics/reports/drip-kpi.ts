/**
 * drip-kpi.ts — Per-campaign KPI rollup: enrollment counts by status, send success rate,
 * and average days-to-complete. Org-scoped via DripCampaign.orgId.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface DripCampaignKpi {
  id: string;
  name: string;
  enrolled: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  sendSuccessRate: number | null;  // percent 0-100, null if no logs
  avgDaysToComplete: number | null; // null if no completed enrollments
}

export interface DripKpiResult {
  campaigns: DripCampaignKpi[];
}

export async function getDripKpi(
  orgId: string,
  fromParam?: string,
  toParam?: string,
): Promise<DripKpiResult> {
  const to = toParam ?? new Date().toISOString().split('T')[0];
  const from = fromParam ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  // Enrollment counts grouped by campaign + status
  const enrollmentRows = await prisma.$queryRaw<
    Array<{ campaign_id: string; status: string; cnt: bigint }>
  >`
    SELECT e.campaign_id, e.status, COUNT(*)::bigint AS cnt
    FROM drip_enrollments e
    JOIN drip_campaigns dc ON dc.id = e.campaign_id
    WHERE dc.org_id = ${orgId}
      AND e.started_at >= ${from}::date
      AND e.started_at <  (${to}::date + INTERVAL '1 day')
    GROUP BY e.campaign_id, e.status
  `;

  if (enrollmentRows.length === 0) return { campaigns: [] };

  // Collect unique campaign IDs
  const campaignIds = [...new Set(enrollmentRows.map((r) => r.campaign_id))];

  // Campaign names
  const campaignRows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT id, name FROM drip_campaigns
    WHERE id = ANY(${campaignIds}::uuid[])
      AND org_id = ${orgId}
  `;

  // Avg days-to-complete per campaign (only completed enrollments)
  const daysRows = await prisma.$queryRaw<
    Array<{ campaign_id: string; avg_days: number | null }>
  >`
    SELECT
      e.campaign_id,
      AVG(
        EXTRACT(EPOCH FROM (e.completed_at - e.started_at)) / 86400.0
      )::float AS avg_days
    FROM drip_enrollments e
    JOIN drip_campaigns dc ON dc.id = e.campaign_id
    WHERE dc.org_id = ${orgId}
      AND e.status = 'completed'
      AND e.completed_at IS NOT NULL
      AND e.started_at >= ${from}::date
      AND e.started_at <  (${to}::date + INTERVAL '1 day')
    GROUP BY e.campaign_id
  `;

  // AutomationLog send success rate per campaign
  const logRows = await prisma.$queryRaw<
    Array<{ campaign_id: string; total: bigint; sent: bigint }>
  >`
    SELECT
      e.campaign_id,
      COUNT(*)::bigint          AS total,
      SUM(CASE WHEN al.status = 'sent' THEN 1 ELSE 0 END)::bigint AS sent
    FROM automation_logs al
    JOIN drip_enrollments e ON e.id = al.enrollment_id
    JOIN drip_campaigns dc ON dc.id = e.campaign_id
    WHERE dc.org_id = ${orgId}
      AND e.started_at >= ${from}::date
      AND e.started_at <  (${to}::date + INTERVAL '1 day')
    GROUP BY e.campaign_id
  `;

  // Index lookups
  const nameMap = new Map(campaignRows.map((r) => [r.id, r.name]));
  const daysMap = new Map(daysRows.map((r) => [r.campaign_id, r.avg_days]));
  const logMap = new Map(logRows.map((r) => [r.campaign_id, r]));

  // Aggregate enrollment counts per campaign
  const countMap = new Map<string, Record<string, number>>();
  for (const row of enrollmentRows) {
    if (!countMap.has(row.campaign_id)) {
      countMap.set(row.campaign_id, { active: 0, completed: 0, failed: 0, cancelled: 0 });
    }
    const entry = countMap.get(row.campaign_id)!;
    const status = row.status as keyof typeof entry;
    if (status in entry) entry[status] = Number(row.cnt);
  }

  const campaigns: DripCampaignKpi[] = [];
  for (const [campaignId, counts] of countMap.entries()) {
    const logs = logMap.get(campaignId);
    const total = logs ? Number(logs.total) : 0;
    const sent = logs ? Number(logs.sent) : 0;
    const enrolled = counts.active + counts.completed + counts.failed + counts.cancelled;
    const avgDays = daysMap.get(campaignId) ?? null;

    campaigns.push({
      id: campaignId,
      name: nameMap.get(campaignId) ?? campaignId,
      enrolled,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      cancelled: counts.cancelled,
      sendSuccessRate: total > 0 ? Math.round((sent / total) * 1000) / 10 : null,
      avgDaysToComplete: avgDays !== null ? Math.round(avgDays * 10) / 10 : null,
    });
  }

  // Sort by enrolled desc
  campaigns.sort((a, b) => b.enrolled - a.enrolled);

  return { campaigns };
}
