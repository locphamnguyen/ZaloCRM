/**
 * response-time.ts — Average response time analysis from DailyMessageStat.
 * Daily trend, overall avg, and per-user breakdown.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import type { ReportFilters } from '../csv-export.js';

export interface DailyResponseTime {
  date: string;
  avgSeconds: number;
}

export interface UserResponseTime {
  userId: string;
  fullName: string;
  avgSeconds: number;
}

export interface ResponseTimeResult {
  daily: DailyResponseTime[];
  overall: number | null;
  byUser: UserResponseTime[];
}

export async function getResponseTimeAnalysis(
  orgId: string,
  from: string,
  to: string,
  filters?: ReportFilters,
): Promise<ResponseTimeResult> {
  // daily_message_stats has user_id + zalo_account_id columns — both filters apply directly.
  const { zaloAccountId, assignedUserId } = filters ?? {};

  // Build extra filter fragments as template-literal-safe condition strings via parameterized queries
  const [dailyRows, overallRows, userRows] = await Promise.all([
    // Daily avg
    zaloAccountId && assignedUserId
      ? prisma.$queryRaw<Array<{ stat_date: Date; avg_rt: number }>>`
          SELECT stat_date, AVG(avg_response_time_seconds)::float AS avg_rt
          FROM daily_message_stats
          WHERE org_id = ${orgId}
            AND zalo_account_id = ${zaloAccountId}
            AND user_id = ${assignedUserId}
            AND stat_date >= ${from}::date AND stat_date <= ${to}::date
            AND avg_response_time_seconds IS NOT NULL
          GROUP BY stat_date ORDER BY stat_date ASC
        `
      : zaloAccountId
        ? prisma.$queryRaw<Array<{ stat_date: Date; avg_rt: number }>>`
            SELECT stat_date, AVG(avg_response_time_seconds)::float AS avg_rt
            FROM daily_message_stats
            WHERE org_id = ${orgId}
              AND zalo_account_id = ${zaloAccountId}
              AND stat_date >= ${from}::date AND stat_date <= ${to}::date
              AND avg_response_time_seconds IS NOT NULL
            GROUP BY stat_date ORDER BY stat_date ASC
          `
        : assignedUserId
          ? prisma.$queryRaw<Array<{ stat_date: Date; avg_rt: number }>>`
              SELECT stat_date, AVG(avg_response_time_seconds)::float AS avg_rt
              FROM daily_message_stats
              WHERE org_id = ${orgId}
                AND user_id = ${assignedUserId}
                AND stat_date >= ${from}::date AND stat_date <= ${to}::date
                AND avg_response_time_seconds IS NOT NULL
              GROUP BY stat_date ORDER BY stat_date ASC
            `
          : prisma.$queryRaw<Array<{ stat_date: Date; avg_rt: number }>>`
              SELECT stat_date, AVG(avg_response_time_seconds)::float AS avg_rt
              FROM daily_message_stats
              WHERE org_id = ${orgId}
                AND stat_date >= ${from}::date AND stat_date <= ${to}::date
                AND avg_response_time_seconds IS NOT NULL
              GROUP BY stat_date ORDER BY stat_date ASC
            `,
    // Overall avg
    zaloAccountId && assignedUserId
      ? prisma.$queryRaw<[{ avg_rt: number | null }]>`
          SELECT AVG(avg_response_time_seconds)::float AS avg_rt
          FROM daily_message_stats
          WHERE org_id = ${orgId}
            AND zalo_account_id = ${zaloAccountId}
            AND user_id = ${assignedUserId}
            AND stat_date >= ${from}::date AND stat_date <= ${to}::date
            AND avg_response_time_seconds IS NOT NULL
        `
      : zaloAccountId
        ? prisma.$queryRaw<[{ avg_rt: number | null }]>`
            SELECT AVG(avg_response_time_seconds)::float AS avg_rt
            FROM daily_message_stats
            WHERE org_id = ${orgId}
              AND zalo_account_id = ${zaloAccountId}
              AND stat_date >= ${from}::date AND stat_date <= ${to}::date
              AND avg_response_time_seconds IS NOT NULL
          `
        : assignedUserId
          ? prisma.$queryRaw<[{ avg_rt: number | null }]>`
              SELECT AVG(avg_response_time_seconds)::float AS avg_rt
              FROM daily_message_stats
              WHERE org_id = ${orgId}
                AND user_id = ${assignedUserId}
                AND stat_date >= ${from}::date AND stat_date <= ${to}::date
                AND avg_response_time_seconds IS NOT NULL
            `
          : prisma.$queryRaw<[{ avg_rt: number | null }]>`
              SELECT AVG(avg_response_time_seconds)::float AS avg_rt
              FROM daily_message_stats
              WHERE org_id = ${orgId}
                AND stat_date >= ${from}::date AND stat_date <= ${to}::date
                AND avg_response_time_seconds IS NOT NULL
            `,
    // Per-user avg
    zaloAccountId && assignedUserId
      ? prisma.$queryRaw<Array<{ user_id: string; full_name: string; avg_rt: number }>>`
          SELECT d.user_id, u.full_name, AVG(d.avg_response_time_seconds)::float AS avg_rt
          FROM daily_message_stats d
          JOIN users u ON u.id = d.user_id
          WHERE d.org_id = ${orgId}
            AND d.zalo_account_id = ${zaloAccountId}
            AND d.user_id = ${assignedUserId}
            AND d.stat_date >= ${from}::date AND d.stat_date <= ${to}::date
            AND d.avg_response_time_seconds IS NOT NULL
          GROUP BY d.user_id, u.full_name ORDER BY avg_rt ASC
        `
      : zaloAccountId
        ? prisma.$queryRaw<Array<{ user_id: string; full_name: string; avg_rt: number }>>`
            SELECT d.user_id, u.full_name, AVG(d.avg_response_time_seconds)::float AS avg_rt
            FROM daily_message_stats d
            JOIN users u ON u.id = d.user_id
            WHERE d.org_id = ${orgId}
              AND d.zalo_account_id = ${zaloAccountId}
              AND d.stat_date >= ${from}::date AND d.stat_date <= ${to}::date
              AND d.avg_response_time_seconds IS NOT NULL
            GROUP BY d.user_id, u.full_name ORDER BY avg_rt ASC
          `
        : assignedUserId
          ? prisma.$queryRaw<Array<{ user_id: string; full_name: string; avg_rt: number }>>`
              SELECT d.user_id, u.full_name, AVG(d.avg_response_time_seconds)::float AS avg_rt
              FROM daily_message_stats d
              JOIN users u ON u.id = d.user_id
              WHERE d.org_id = ${orgId}
                AND d.user_id = ${assignedUserId}
                AND d.stat_date >= ${from}::date AND d.stat_date <= ${to}::date
                AND d.avg_response_time_seconds IS NOT NULL
              GROUP BY d.user_id, u.full_name ORDER BY avg_rt ASC
            `
          : prisma.$queryRaw<Array<{ user_id: string; full_name: string; avg_rt: number }>>`
              SELECT d.user_id, u.full_name, AVG(d.avg_response_time_seconds)::float AS avg_rt
              FROM daily_message_stats d
              JOIN users u ON u.id = d.user_id
              WHERE d.org_id = ${orgId}
                AND d.stat_date >= ${from}::date AND d.stat_date <= ${to}::date
                AND d.avg_response_time_seconds IS NOT NULL
              GROUP BY d.user_id, u.full_name ORDER BY avg_rt ASC
            `,
  ]);

  return {
    daily: dailyRows.map((r) => ({
      date: r.stat_date instanceof Date
        ? r.stat_date.toISOString().split('T')[0]
        : String(r.stat_date),
      avgSeconds: Math.round(r.avg_rt),
    })),
    overall: overallRows[0]?.avg_rt ? Math.round(overallRows[0].avg_rt) : null,
    byUser: userRows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      avgSeconds: Math.round(r.avg_rt),
    })),
  };
}
