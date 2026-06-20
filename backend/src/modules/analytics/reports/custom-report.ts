// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * custom-report.ts — Execute user-defined report from predefined metrics.
 * Supports 6 metrics, 5 groupBy options, optional filters.
 *
 * SECURITY: All user-supplied values (filters.userId, filters.source, etc.)
 * MUST be passed as bound params via Prisma.sql/$queryRaw. Static SQL fragments
 * (dateExpr, dateCol, statusFilter) are derived from server-side enums and
 * validated against an allow-list before being wrapped in Prisma.raw.
 * Never feed user input through Prisma.raw.
 */
import { Prisma } from '@prisma/client';
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

// Allow-list for groupBy values that map to a TO_CHAR/DATE_TRUNC fragment.
const GROUP_BY_DATE = new Set(['day', 'week', 'month']);
// Allow-list for date columns used in dynamic fragments.
const DATE_COLUMN = new Set(['created_at', 'updated_at', 'sent_at', 'appointment_date', 'stat_date']);

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
      return queryMessageMetric(orgId, metric, groupBy, gte, lt);
    case 'contacts_new':
      return queryContactMetric(orgId, 'new', groupBy, gte, lt, filters);
    case 'contacts_converted':
      return queryContactMetric(orgId, 'converted', groupBy, gte, lt, filters);
    case 'appointments':
      return queryAppointmentMetric(orgId, groupBy, gte, lt);
    case 'avg_response_time':
      return queryResponseTimeMetric(orgId, groupBy, gte, lt);
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
): Promise<{ labels: string[]; data: number[] }> {
  const senderType = metric === 'messages_sent' ? 'self' : 'contact';

  if (groupBy === 'user') {
    const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
      SELECT u.full_name AS label, COUNT(*)::bigint AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN users u ON u.id = m.replied_by_user_id
      WHERE c.org_id = ${orgId} AND m.sender_type = ${senderType}
        AND m.sent_at >= ${gte} AND m.sent_at < ${lt}
      GROUP BY u.full_name ORDER BY cnt DESC`;
    return { labels: rows.map((r) => r.label ?? 'N/A'), data: rows.map((r) => Number(r.cnt)) };
  }

  if (groupBy === 'source') {
    const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
      SELECT COALESCE(ct.source, 'N/A') AS label, COUNT(*)::bigint AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.org_id = ${orgId} AND m.sender_type = ${senderType}
        AND m.sent_at >= ${gte} AND m.sent_at < ${lt}
      GROUP BY ct.source ORDER BY cnt DESC`;
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  // groupBy in {day, week, month}: fragment derived from validated enum, safe to Prisma.raw.
  const dateExpr = groupByDateExpr(groupBy, 'm.sent_at');
  const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
    SELECT ${dateExpr} AS label, COUNT(*)::bigint AS cnt
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.org_id = ${orgId} AND m.sender_type = ${senderType}
      AND m.sent_at >= ${gte} AND m.sent_at < ${lt}
    GROUP BY label ORDER BY label ASC`;
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
  // Both derived from typed enum / server constant — safe after assertColumn.
  const dateColName = type === 'new' ? 'created_at' : 'updated_at';
  assertDateColumn(dateColName);
  const dateCol = Prisma.raw(dateColName);

  // statusFilter is a fixed-shape fragment, not user input.
  const statusFilter = type === 'converted'
    ? Prisma.sql`AND status = 'converted'`
    : Prisma.empty;

  // sourceFilter — user input. ALWAYS bound, never interpolated.
  const sourceFilter = filters?.source
    ? Prisma.sql`AND source = ${filters.source}`
    : Prisma.empty;

  if (groupBy === 'user') {
    // Note: c.${dateCol} below — dateCol is validated above.
    const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
      SELECT COALESCE(u.full_name, 'Chưa gán') AS label, COUNT(*)::bigint AS cnt
      FROM contacts c LEFT JOIN users u ON u.id = c.assigned_user_id
      WHERE c.org_id = ${orgId} AND c.${dateCol} >= ${gte} AND c.${dateCol} < ${lt}
        ${statusFilter} ${sourceFilter}
      GROUP BY u.full_name ORDER BY cnt DESC`;
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  if (groupBy === 'source') {
    const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
      SELECT COALESCE(source, 'N/A') AS label, COUNT(*)::bigint AS cnt
      FROM contacts WHERE org_id = ${orgId} AND ${dateCol} >= ${gte} AND ${dateCol} < ${lt}
        ${statusFilter}
      GROUP BY source ORDER BY cnt DESC`;
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  const dateExpr = groupByDateExpr(groupBy, dateColName);
  const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
    SELECT ${dateExpr} AS label, COUNT(*)::bigint AS cnt
    FROM contacts WHERE org_id = ${orgId} AND ${dateCol} >= ${gte} AND ${dateCol} < ${lt}
      ${statusFilter} ${sourceFilter}
    GROUP BY label ORDER BY label ASC`;
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Number(r.cnt)) };
}

async function queryAppointmentMetric(
  orgId: string,
  groupBy: string,
  gte: Date,
  lt: Date,
): Promise<{ labels: string[]; data: number[] }> {
  if (groupBy === 'user') {
    const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
      SELECT COALESCE(u.full_name, 'Chưa gán') AS label, COUNT(*)::bigint AS cnt
      FROM appointments a LEFT JOIN users u ON u.id = a.assigned_user_id
      WHERE a.org_id = ${orgId} AND a.appointment_date >= ${gte} AND a.appointment_date < ${lt}
      GROUP BY u.full_name ORDER BY cnt DESC`;
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Number(r.cnt)) };
  }

  const dateExpr = groupByDateExpr(groupBy, 'appointment_date');
  const rows = await prisma.$queryRaw<Array<{ label: string; cnt: bigint }>>`
    SELECT ${dateExpr} AS label, COUNT(*)::bigint AS cnt
    FROM appointments WHERE org_id = ${orgId} AND appointment_date >= ${gte} AND appointment_date < ${lt}
    GROUP BY label ORDER BY label ASC`;
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Number(r.cnt)) };
}

async function queryResponseTimeMetric(
  orgId: string,
  groupBy: string,
  gte: Date,
  lt: Date,
): Promise<{ labels: string[]; data: number[] }> {
  if (groupBy === 'user') {
    const rows = await prisma.$queryRaw<Array<{ label: string; avg_rt: number }>>`
      SELECT u.full_name AS label, AVG(d.avg_response_time_seconds)::float AS avg_rt
      FROM daily_message_stats d JOIN users u ON u.id = d.user_id
      WHERE d.org_id = ${orgId} AND d.stat_date >= ${gte}::date AND d.stat_date < ${lt}::date
        AND d.avg_response_time_seconds IS NOT NULL
      GROUP BY u.full_name ORDER BY avg_rt ASC`;
    return { labels: rows.map((r) => r.label), data: rows.map((r) => Math.round(r.avg_rt)) };
  }

  const dateExpr = groupByDateExpr(groupBy, 'stat_date');
  const rows = await prisma.$queryRaw<Array<{ label: string; avg_rt: number }>>`
    SELECT ${dateExpr} AS label, AVG(avg_response_time_seconds)::float AS avg_rt
    FROM daily_message_stats
    WHERE org_id = ${orgId} AND stat_date >= ${gte}::date AND stat_date < ${lt}::date
      AND avg_response_time_seconds IS NOT NULL
    GROUP BY label ORDER BY label ASC`;
  return { labels: rows.map((r) => String(r.label)), data: rows.map((r) => Math.round(r.avg_rt)) };
}

/**
 * Build a TO_CHAR/DATE_TRUNC fragment for the given groupBy + column.
 * Both inputs MUST be validated against the allow-lists (Prisma.raw is otherwise unsafe).
 */
function groupByDateExpr(groupBy: string, col: string): Prisma.Sql {
  if (!GROUP_BY_DATE.has(groupBy)) {
    throw new Error(`Invalid groupBy for date expr: ${groupBy}`);
  }
  assertDateColumn(col.split('.').pop() || col); // accept "m.sent_at"
  const colRaw = Prisma.raw(col);
  switch (groupBy) {
    case 'week':
      return Prisma.sql`TO_CHAR(DATE_TRUNC('week', ${colRaw}), 'YYYY-"W"IW')`;
    case 'month':
      return Prisma.sql`TO_CHAR(${colRaw}, 'YYYY-MM')`;
    default: // day
      return Prisma.sql`TO_CHAR(${colRaw}, 'YYYY-MM-DD')`;
  }
}

function assertDateColumn(col: string): void {
  if (!DATE_COLUMN.has(col)) {
    throw new Error(`Invalid date column: ${col}`);
  }
}
