/**
 * heatmap.ts — Response-time heatmap by day-of-week × hour.
 * Uses raw SQL window function: pairs incoming → next outgoing in same conversation within 24h.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface HeatmapCell {
  dow: number;       // 0 = Sunday … 6 = Saturday (Postgres EXTRACT DOW)
  hour: number;      // 0-23
  avgSeconds: number;
  sampleCount: number;
}

export interface HeatmapResult {
  cells: HeatmapCell[];
}

const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

function clampRange(from: string, to: string): { from: string; to: string } {
  const toDate = new Date(to);
  const fromDate = new Date(from);
  const diffDays = (toDate.getTime() - fromDate.getTime()) / 86400000;
  if (diffDays > MAX_DAYS) {
    const cappedFrom = new Date(toDate.getTime() - MAX_DAYS * 86400000)
      .toISOString()
      .split('T')[0];
    return { from: cappedFrom, to };
  }
  return { from, to };
}

export async function getResponseHeatmap(
  orgId: string,
  fromParam?: string,
  toParam?: string,
): Promise<HeatmapResult> {
  const toDate = toParam ?? new Date().toISOString().split('T')[0];
  const fromDefault = new Date(Date.now() - DEFAULT_DAYS * 86400000)
    .toISOString()
    .split('T')[0];
  const { from, to } = clampRange(fromParam ?? fromDefault, toDate);

  // Window function: for each incoming message, find the next message in the same conversation.
  // If that next message is outgoing (sender_type = 'self') and within 24h, it's a response pair.
  const rows = await prisma.$queryRaw<
    Array<{ dow: number; hour: number; avg_seconds: number; sample_count: bigint }>
  >`
    WITH ranked AS (
      SELECT
        m.id,
        m.conversation_id,
        m.sender_type,
        m.sent_at,
        LEAD(m.sent_at)     OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS next_sent_at,
        LEAD(m.sender_type) OVER (PARTITION BY m.conversation_id ORDER BY m.sent_at) AS next_sender_type
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.org_id = ${orgId}
        AND m.sent_at >= ${from}::date
        AND m.sent_at <  (${to}::date + INTERVAL '1 day')
        AND m.is_deleted = false
    ),
    pairs AS (
      SELECT
        EXTRACT(DOW  FROM sent_at)::int AS dow,
        EXTRACT(HOUR FROM sent_at)::int AS hour,
        EXTRACT(EPOCH FROM (next_sent_at - sent_at))::float AS response_seconds
      FROM ranked
      WHERE sender_type = 'contact'
        AND next_sender_type = 'self'
        AND next_sent_at - sent_at <= INTERVAL '24 hours'
        AND next_sent_at - sent_at > INTERVAL '0 seconds'
    )
    SELECT
      dow,
      hour,
      AVG(response_seconds)::float AS avg_seconds,
      COUNT(*)                      AS sample_count
    FROM pairs
    GROUP BY dow, hour
    ORDER BY dow, hour
  `;

  return {
    cells: rows.map((r) => ({
      dow: r.dow,
      hour: r.hour,
      avgSeconds: Math.round(r.avg_seconds),
      sampleCount: Number(r.sample_count),
    })),
  };
}
