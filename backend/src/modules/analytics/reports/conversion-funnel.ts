/**
 * conversion-funnel.ts — Pipeline conversion rates: count per stage + conversion %.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface FunnelStage {
  status: string;
  count: number;
  rate: number; // % of total contacts that reached this stage
}

export interface ConversionFunnelResult {
  stages: FunnelStage[];
  totalContacts: number;
  avgConversionDays: number | null; // avg days from creation to "converted"
}

const STAGE_ORDER = ['new', 'contacted', 'interested', 'converted', 'lost'];

export async function getConversionFunnel(
  orgId: string,
  from: string,
  to: string,
): Promise<ConversionFunnelResult> {
  const gte = new Date(from);
  const lt = new Date(to);
  lt.setDate(lt.getDate() + 1);

  const groups = await prisma.contact.groupBy({
    by: ['status'],
    where: { orgId, createdAt: { gte, lt }, status: { not: null } },
    _count: true,
  });

  const countMap: Record<string, number> = {};
  let total = 0;
  for (const g of groups) {
    const s = g.status ?? 'unknown';
    countMap[s] = g._count;
    total += g._count;
  }

  const stages: FunnelStage[] = STAGE_ORDER.map((status) => ({
    status,
    count: countMap[status] ?? 0,
    rate: total > 0 ? Math.round(((countMap[status] ?? 0) / total) * 1000) / 10 : 0,
  }));

  // Avg days from createdAt to updatedAt for converted contacts
  const avgResult = await prisma.$queryRaw<[{ avg_days: number | null }]>`
    SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::float AS avg_days
    FROM contacts
    WHERE org_id = ${orgId}
      AND status = 'converted'
      AND created_at >= ${gte}
      AND created_at < ${lt}
  `;

  const avgDays = avgResult[0]?.avg_days;

  return {
    stages,
    totalContacts: total,
    avgConversionDays: avgDays ? Math.round(avgDays * 10) / 10 : null,
  };
}
