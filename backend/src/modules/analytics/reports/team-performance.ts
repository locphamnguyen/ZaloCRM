/**
 * team-performance.ts — Per-user metrics: messages sent, contacts converted,
 * appointments completed, avg response time.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface TeamMember {
  userId: string;
  fullName: string;
  messagesSent: number;
  contactsConverted: number;
  appointmentsCompleted: number;
  avgResponseTime: number | null; // seconds
}

export interface TeamPerformanceResult {
  users: TeamMember[];
}

export async function getTeamPerformance(
  orgId: string,
  from: string,
  to: string,
): Promise<TeamPerformanceResult> {
  const gte = new Date(from);
  const lt = new Date(to);
  lt.setDate(lt.getDate() + 1);

  // Get all active users in org
  const orgUsers = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: { id: true, fullName: true },
  });

  if (!orgUsers.length) return { users: [] };

  const userIds = orgUsers.map((u) => u.id);

  // Parallel queries
  const [msgRows, convertedRows, aptRows, rtRows] = await Promise.all([
    // Messages sent per user (replied_by_user_id)
    prisma.$queryRaw<Array<{ user_id: string; cnt: bigint }>>`
      SELECT m.replied_by_user_id AS user_id, COUNT(*)::bigint AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.org_id = ${orgId}
        AND m.sender_type = 'self'
        AND m.replied_by_user_id = ANY(${userIds})
        AND m.sent_at >= ${gte} AND m.sent_at < ${lt}
      GROUP BY m.replied_by_user_id
    `,
    // Contacts converted per user
    prisma.contact.groupBy({
      by: ['assignedUserId'],
      where: {
        orgId,
        status: 'converted',
        assignedUserId: { in: userIds },
        updatedAt: { gte, lt },
      },
      _count: true,
    }),
    // Appointments completed per user
    prisma.appointment.groupBy({
      by: ['assignedUserId'],
      where: {
        orgId,
        status: 'completed',
        assignedUserId: { in: userIds },
        appointmentDate: { gte, lt },
      },
      _count: true,
    }),
    // Avg response time from DailyMessageStat
    prisma.$queryRaw<Array<{ user_id: string; avg_rt: number | null }>>`
      SELECT user_id, AVG(avg_response_time_seconds)::float AS avg_rt
      FROM daily_message_stats
      WHERE org_id = ${orgId}
        AND user_id = ANY(${userIds})
        AND stat_date >= ${gte}::date AND stat_date < ${lt}::date
        AND avg_response_time_seconds IS NOT NULL
      GROUP BY user_id
    `,
  ]);

  // Build lookup maps
  const msgMap = new Map(msgRows.map((r) => [r.user_id, Number(r.cnt)]));
  const convMap = new Map(
    convertedRows.map((r) => [r.assignedUserId, r._count]),
  );
  const aptMap = new Map(aptRows.map((r) => [r.assignedUserId, r._count]));
  const rtMap = new Map(rtRows.map((r) => [r.user_id, r.avg_rt]));

  const users: TeamMember[] = orgUsers.map((u) => ({
    userId: u.id,
    fullName: u.fullName,
    messagesSent: msgMap.get(u.id) ?? 0,
    contactsConverted: convMap.get(u.id) ?? 0,
    appointmentsCompleted: aptMap.get(u.id) ?? 0,
    avgResponseTime: rtMap.get(u.id) ?? null,
  }));

  // Sort by contactsConverted desc
  users.sort((a, b) => b.contactsConverted - a.contactsConverted);

  return { users };
}
