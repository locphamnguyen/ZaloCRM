/**
 * custom-report.ts — Execute user-defined report from predefined metrics.
 * Supports 6 metrics, 5 groupBy options, optional filters.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface ReportConfig {
  metrics: string[]; // messages_sent | messages_received | contacts_new | contacts_converted | appointments | avg_response_time
  groupBy: 'day' | 'week' | 'month' | 'user' | 'source';
  dateRange: { from: string; to: string };
  filters?: { userId?: string; source?: string; status?: string };
}

export interface CustomReportResult {
  labels: string[];
  datasets: { metric: string; data: number[] }[];
}

export async function executeCustomReport(
  orgId: string,
  config: ReportConfig,
): Promise<CustomReportResult> {
  const { from, to } = config.dateRange;
  const gte = new Date(from);
  const lt = new Date(to);
  lt.setDate(lt.getDate() + 1);

  const datasets: { metric: string; data: number[] }[] = [];
  let labels: string[] = [];

  for (const metric of config.metrics) {
    const result = await queryMetric(orgId, metric, config.groupBy, gte, lt, config.filters);
    if (!labels.length) labels = result.labels;
    datasets.push({ metric, data: result.data });
  }

  return { labels, datasets };
}

async function queryMetric(
  orgId: string,
  metric: string,
  groupBy: string,
  gte: Date,
  lt: Date,
  filters?: ReportConfig['filters'],
): Promise<{ labels: string[]; data: number[] }> {
  switch (metric) {
    case 'messages_sent':
    case 'messages_received':
      return queryMessageMetric(orgId, metric, groupBy, gte, lt, filters);
    case 'contacts_new':
      return queryContactMetric(orgId, 'new', groupBy, gte, lt, filters);
    case 'contacts_converted':
      return queryContactMetric(orgId, 'converted', groupBy, gte, lt, filters);
    case 'appointments':
      return queryAppointmentMetric(orgId, groupBy, gte, lt);
    case 'avg_response_time':
      return queryResponseTimeMetric(orgId, groupBy, gte, lt, filters);
    default:
      return { labels: [], data: [] };
  }
}

async function queryMessageMetric(
  orgId: string,
  metric: string,
  groupBy: string,
  gte: Date,
  lt: Date,
  filters?: ReportConfig['filters'],
): Promise<{ labels: string[]; data: number[] }> {
  const senderType = metric === 'messages_sent' ? 'self' : 'contact';
  const dateExpr = groupByDateExpr(groupBy, 'm.sent_at');
  const userFilter = filters?.userId ? `AND m.replied_by_user_id = '${filters.userId}'` : '';

  if (groupBy === 'user') {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
      `SELECT u.full_name AS label, COUNT(*)::bigint AS cnt
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN users u ON u.id = m.replied_by_user_id
       WHERE c.org_id = $1 AND m.sender_type = $2
         AND m.sent_at >= $3 AND m.sent_at < $4
       GROUP BY u.full_name ORDER BY cnt DESC`,
      orgId, senderType, gte, lt,
    );
    return { labels: rows.map((r) => r.label ?? 'N/A'), data: rows.map((r) => Number(r.cnt)) };
  }

  if (groupBy === 'source') {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
      `SELECT COALESCE(ct.source, 'N/A') AS label, COUNT(*)::bigint AS cnt
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.org_id = $1 AND m.sender_type = $2
         AND m.sent_at >= $3 AND m.sent_at < $4
       GROUP BY ct.source ORDER BY cnt DESC`,
      orgId, senderType, gte, lt,
    );
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
    `SELECT ${dateExpr} AS label, COUNT(*)::bigint AS cnt
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.org_id = $1 AND m.sender_type = $2
       AND m.sent_at >= $3 AND m.sent_at < $4
     GROUP BY label ORDER BY label ASC`,
    orgId, senderType, gte, lt,
  );
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Number(r.cnt)) };
}

async function queryContactMetric(
  orgId: string,
  type: 'new' | 'converted',
  groupBy: string,
  gte: Date,
  lt: Date,
  filters?: ReportConfig['filters'],
): Promise<{ labels: string[]; data: number[] }> {
  const dateCol = type === 'new' ? 'created_at' : 'updated_at';
  const statusFilter = type === 'converted' ? `AND status = 'converted'` : '';
  const sourceFilter = filters?.source ? `AND source = '${filters.source}'` : '';

  if (groupBy === 'user') {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
      `SELECT COALESCE(u.full_name, 'Chưa gán') AS label, COUNT(*)::bigint AS cnt
       FROM contacts c LEFT JOIN users u ON u.id = c.assigned_user_id
       WHERE c.org_id = $1 AND c.${dateCol} >= $2 AND c.${dateCol} < $3
         ${statusFilter} ${sourceFilter}
       GROUP BY u.full_name ORDER BY cnt DESC`,
      orgId, gte, lt,
    );
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  if (groupBy === 'source') {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
      `SELECT COALESCE(source, 'N/A') AS label, COUNT(*)::bigint AS cnt
       FROM contacts WHERE org_id = $1 AND ${dateCol} >= $2 AND ${dateCol} < $3
         ${statusFilter}
       GROUP BY source ORDER BY cnt DESC`,
      orgId, gte, lt,
    );
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  const dateExpr = groupByDateExpr(groupBy, dateCol);
  const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
    `SELECT ${dateExpr} AS label, COUNT(*)::bigint AS cnt
     FROM contacts WHERE org_id = $1 AND ${dateCol} >= $2 AND ${dateCol} < $3
       ${statusFilter} ${sourceFilter}
     GROUP BY label ORDER BY label ASC`,
    orgId, gte, lt,
  );
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Number(r.cnt)) };
}

async function queryAppointmentMetric(
  orgId: string,
  groupBy: string,
  gte: Date,
  lt: Date,
): Promise<{ labels: string[]; data: number[] }> {
  if (groupBy === 'user') {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
      `SELECT COALESCE(u.full_name, 'Chưa gán') AS label, COUNT(*)::bigint AS cnt
       FROM appointments a LEFT JOIN users u ON u.id = a.assigned_user_id
       WHERE a.org_id = $1 AND a.appointment_date >= $2 AND a.appointment_date < $3
       GROUP BY u.full_name ORDER BY cnt DESC`,
      orgId, gte, lt,
    );
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  const dateExpr = groupByDateExpr(groupBy, 'appointment_date');
  const rows = await prisma.$queryRawUnsafe<Array<{ label: string; cnt: bigint }>>(
    `SELECT ${dateExpr} AS label, COUNT(*)::bigint AS cnt
     FROM appointments WHERE org_id = $1 AND appointment_date >= $2 AND appointment_date < $3
     GROUP BY label ORDER BY label ASC`,
    orgId, gte, lt,
  );
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Number(r.cnt)) };
}

async function queryResponseTimeMetric(
  orgId: string,
  groupBy: string,
  gte: Date,
  lt: Date,
  filters?: ReportConfig['filters'],
): Promise<{ labels: string[]; data: number[] }> {
  if (groupBy === 'user') {
    const rows = await prisma.$queryRawUnsafe<Array<{ label: string; avg_rt: number }>>(
      `SELECT u.full_name AS label, AVG(d.avg_response_time_seconds)::float AS avg_rt
       FROM daily_message_stats d JOIN users u ON u.id = d.user_id
       WHERE d.org_id = $1 AND d.stat_date >= $2::date AND d.stat_date < $3::date
         AND d.avg_response_time_seconds IS NOT NULL
       GROUP BY u.full_name ORDER BY avg_rt ASC`,
      orgId, gte, lt,
    );
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Math.round(r.avg_rt)) };
  }

  const dateExpr = groupByDateExpr(groupBy, 'stat_date');
  const rows = await prisma.$queryRawUnsafe<Array<{ label: string; avg_rt: number }>>(
    `SELECT ${dateExpr} AS label, AVG(avg_response_time_seconds)::float AS avg_rt
     FROM daily_message_stats
     WHERE org_id = $1 AND stat_date >= $2::date AND stat_date < $3::date
       AND avg_response_time_seconds IS NOT NULL
     GROUP BY label ORDER BY label ASC`,
    orgId, gte, lt,
  );
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Math.round(r.avg_rt)) };
}

function groupByDateExpr(groupBy: string, col: string): string {
  switch (groupBy) {
    case 'week':
      return `TO_CHAR(DATE_TRUNC('week', ${col}), 'YYYY-"W"IW')`;
    case 'month':
      return `TO_CHAR(${col}, 'YYYY-MM')`;
    default: // day
      return `TO_CHAR(${col}, 'YYYY-MM-DD')`;
  }
}
