/**
 * dashboard-action-hub-routes.ts — Dashboard redesign 2026-05-29.
 *
 * 3 endpoint scroll-stack theo role:
 *   GET /dashboard/me?asUserId=X     — section "Việc của tôi"
 *   GET /dashboard/team?deptIds=A,B  — section "Quản lý team"
 *   GET /dashboard/system            — section "Quản lý hệ thống" (admin only)
 *
 * Privacy v2 split: query nick privacyMode='sub' (public) vs 'main' (private).
 * Returns { public: N, private: M } cho mọi KPI — frontend show `N +🔒M`.
 *
 * RBAC check view-as-X:
 *   - X == self.id              → ok
 *   - X != self.id              → required getOwnerScope.visibleUserIds bao gồm X
 *   - admin                     → bypass (canViewAll)
 *
 * Audit log: chỉ log action POST/PATCH (impersonate-action middleware).
 *   GET endpoint KHÔNG log (anh chốt Q3 2026-05-29 — view spam).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { getOwnerScope } from '../rbac/owner-scope.js';
import { userHasGrant } from '../rbac/permission-group-service.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function todayRangeVN() {
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const todayVN = new Date(vnNow.getFullYear(), vnNow.getMonth(), vnNow.getDate());
  const today = new Date(todayVN.getTime() - vnOffset);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { today, tomorrow };
}

function monthStartVN() {
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const monthVN = new Date(vnNow.getFullYear(), vnNow.getMonth(), 1);
  return new Date(monthVN.getTime() - vnOffset);
}

/**
 * Split count theo privacyMode của nick. Trả {public, private}.
 * - public  = count từ nick privacyMode='sub'
 * - private = count từ nick privacyMode='main'
 *
 * Frontend hiển thị dạng `5 +🔒7` (anh chốt E2=B 2026-05-29 — transparent
 * về tổng tải, không lộ nội dung).
 */
interface PrivacySplit {
  public: number;
  private: number;
}

async function splitByPrivacy(
  orgId: string,
  ownerUserId: string,
  countFn: (zaloAccountIds: string[]) => Promise<number>,
): Promise<PrivacySplit> {
  const nicks = await prisma.zaloAccount.findMany({
    where: { orgId, ownerUserId },
    select: { id: true, privacyMode: true },
  });
  const publicIds = nicks.filter((n) => n.privacyMode === 'sub').map((n) => n.id);
  const privateIds = nicks.filter((n) => n.privacyMode === 'main').map((n) => n.id);
  const [pub, priv] = await Promise.all([
    publicIds.length > 0 ? countFn(publicIds) : Promise.resolve(0),
    privateIds.length > 0 ? countFn(privateIds) : Promise.resolve(0),
  ]);
  return { public: pub, private: priv };
}

/**
 * RBAC check: viewerId có quyền xem dashboard của targetUserId không?
 *
 * Rules:
 *   - viewer == target          → ok
 *   - viewer admin/owner        → ok (canViewAll)
 *   - viewer leader của dept    → ok nếu target ∈ subtree
 *   - others                    → 403
 */
async function canViewUserDashboard(args: {
  viewerId: string;
  viewerOrgId: string;
  viewerRole: string;
  targetUserId: string;
}): Promise<boolean> {
  const { viewerId, viewerOrgId, viewerRole, targetUserId } = args;
  if (viewerId === targetUserId) return true;

  const scope = await getOwnerScope({
    userId: viewerId,
    orgId: viewerOrgId,
    legacyRole: viewerRole,
    resource: 'contact',
  });
  if (scope.canViewAll) return true;
  return scope.visibleUserIds.includes(targetUserId);
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function dashboardActionHubRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ─── GET /dashboard/me ────────────────────────────────────────────────
  // Section 1: "Việc của tôi". Sale chỉ self. Trưởng phòng/admin có thể
  // pass ?asUserId=X để xem dashboard cá nhân của NV cấp dưới (full action,
  // anh chốt B 2026-05-29).
  app.get('/api/v1/dashboard/action-hub/me', async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const viewer = request.user!;
      const query = request.query as { asUserId?: string };
      const targetUserId = query.asUserId ?? viewer.id;

      // RBAC check view-as-X
      const canView = await canViewUserDashboard({
        viewerId: viewer.id,
        viewerOrgId: viewer.orgId,
        viewerRole: viewer.role,
        targetUserId,
      });
      if (!canView) {
        return reply.status(403).send({
          error: 'Bạn không có quyền xem dashboard của user này',
          code: 'DASHBOARD_FORBIDDEN',
        });
      }

      const { today, tomorrow } = todayRangeVN();
      const monthStart = monthStartVN();

      // KPI split theo privacy của nick owner. countFn nhận zaloAccountIds
      // và trả count từ conversation/appointment theo các id đó.
      const [unrepliedSplit, todayApptSplit, dormantSplit, contactsCount, closedThisMonth] =
        await Promise.all([
          // 📥 Chưa rep (conversation.isReplied=false, unreadCount>0)
          // CRM rule 2026-05-29: chỉ user 1-1, KHÔNG nhóm Zalo.
          splitByPrivacy(viewer.orgId, targetUserId, async (zIds) =>
            prisma.conversation.count({
              where: {
                orgId: viewer.orgId,
                zaloAccountId: { in: zIds },
                threadType: 'user',
                isReplied: false,
                unreadCount: { gt: 0 },
              },
            }),
          ),
          // 📅 Hẹn hôm nay (Appointment.assignedUserId = target, hôm nay)
          splitByPrivacy(viewer.orgId, targetUserId, async (zIds) => {
            const _ = zIds; // appointment không có FK trực tiếp tới zaloAccount
            return prisma.appointment.count({
              where: {
                orgId: viewer.orgId,
                assignedUserId: targetUserId,
                appointmentDate: { gte: today, lt: tomorrow },
                status: 'scheduled',
              },
            });
          }),
          // 💤 KH đình trệ (conversation.lastMessageAt < 7 ngày, isReplied=true,
          // không có msg mới — proxy: lastMessageAt < now-7d)
          // CRM rule 2026-05-29: chỉ user 1-1, nhóm Zalo không phải KH cần chăm sóc.
          splitByPrivacy(viewer.orgId, targetUserId, async (zIds) => {
            const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
            return prisma.conversation.count({
              where: {
                orgId: viewer.orgId,
                zaloAccountId: { in: zIds },
                threadType: 'user',
                lastMessageAt: { lt: sevenDaysAgo },
                contactId: { not: null },
              },
            });
          }),
          // 🎯 KH của tôi (Contact.assignedUserId = target) — count đơn (không split,
          // vì Contact không có FK zaloAccount; privacy chỉ áp Conversation/Friend)
          prisma.contact.count({
            where: { orgId: viewer.orgId, assignedUserId: targetUserId },
          }),
          // ✅ Chốt tháng (Contact.status='closed_won' hoặc tương đương — TODO map
          // chính xác sau khi anh confirm pipeline status)
          prisma.contact.count({
            where: {
              orgId: viewer.orgId,
              assignedUserId: targetUserId,
              status: { in: ['closed_won', 'chot', 'closed'] },
              updatedAt: { gte: monthStart },
            },
          }),
        ]);

      // Urgent list — top 5 conversation chưa rep, chỉ nick public (privacy blur
      // ở client cho main-nick, BE không trả nội dung của main-nick)
      const publicNicks = await prisma.zaloAccount.findMany({
        where: { orgId: viewer.orgId, ownerUserId: targetUserId, privacyMode: 'sub' },
        select: { id: true },
      });
      // Urgent list — CRM rule 2026-05-29: "🔥 Cần rep gấp" chỉ rep với user 1-1.
      const urgentConvs = await prisma.conversation.findMany({
        where: {
          orgId: viewer.orgId,
          zaloAccountId: { in: publicNicks.map((n) => n.id) },
          threadType: 'user',
          isReplied: false,
          unreadCount: { gt: 0 },
          contactId: { not: null },
        },
        select: {
          id: true,
          unreadCount: true,
          lastMessageAt: true,
          contact: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              status: true,
            },
          },
          zaloAccount: { select: { id: true, displayName: true } },
        },
        orderBy: { lastMessageAt: 'asc' }, // oldest first → most urgent
        take: 5,
      });

      // Today appointments (no privacy split — appointment không gắn nick)
      const todayAppts = await prisma.appointment.findMany({
        where: {
          orgId: viewer.orgId,
          assignedUserId: targetUserId,
          appointmentDate: { gte: today, lt: tomorrow },
          status: 'scheduled',
        },
        select: {
          id: true,
          title: true,
          appointmentDate: true,
          appointmentTime: true,
          location: true,
          contact: { select: { id: true, fullName: true } },
        },
        orderBy: { appointmentDate: 'asc' },
        take: 5,
      });

      // Quota nick — count msg today + friend req today per nick (public only)
      const quotaNicks = await prisma.zaloAccount.findMany({
        where: { orgId: viewer.orgId, ownerUserId: targetUserId },
        select: {
          id: true,
          displayName: true,
          privacyMode: true,
        },
      });
      const quotaData = await Promise.all(
        quotaNicks.map(async (n) => {
          if (n.privacyMode === 'main') {
            return {
              id: n.id,
              displayName: '🔒 Nick riêng tư',
              isPrivate: true,
              messagesToday: null,
              friendsToday: null,
            };
          }
          const [msgs, friends] = await Promise.all([
            prisma.message.count({
              where: {
                conversation: { zaloAccountId: n.id },
                senderType: 'self',
                sentAt: { gte: today, lt: tomorrow },
              },
            }),
            prisma.friendshipAttempt.count({
              where: {
                zaloAccountId: n.id,
                queuedAt: { gte: today, lt: tomorrow },
              },
            }),
          ]);
          return {
            id: n.id,
            displayName: n.displayName,
            isPrivate: false,
            messagesToday: msgs,
            friendsToday: friends,
          };
        }),
      );

      return {
        targetUserId,
        isViewingSelf: targetUserId === viewer.id,
        kpi: {
          unreplied: unrepliedSplit,
          todayAppointments: todayApptSplit,
          dormantContacts: dormantSplit,
          totalContacts: contactsCount,
          closedThisMonth,
        },
        urgent: urgentConvs.map((c) => ({
          conversationId: c.id,
          contactId: c.contact?.id,
          contactName: c.contact?.fullName ?? 'Không tên',
          contactAvatar: c.contact?.avatarUrl,
          unreadCount: c.unreadCount,
          lastMessageAt: c.lastMessageAt,
          nickName: c.zaloAccount.displayName,
          status: c.contact?.status,
        })),
        appointments: todayAppts.map((a) => ({
          id: a.id,
          title: a.title,
          appointmentDate: a.appointmentDate,
          appointmentTime: a.appointmentTime,
          location: a.location,
          contactId: a.contact?.id,
          contactName: a.contact?.fullName,
        })),
        quotaNicks: quotaData,
      };
    } catch (err) {
      logger.error('[dashboard-action-hub] /me error:', err);
      return reply.status(500).send({ error: 'Failed to fetch /me dashboard' });
    }
  });

  // ─── GET /dashboard/team ──────────────────────────────────────────────
  // Section 2: "Quản lý team". Trưởng phòng/admin only. ?deptIds=A,B
  // multi-select (admin) hoặc subtree (trưởng phòng).
  app.get('/api/v1/dashboard/action-hub/team', async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const viewer = request.user!;
      const query = request.query as { deptIds?: string };

      // Required grant: contact.view_all (CEO/Trưởng phòng/Admin/Marketing có)
      const canViewTeam = await userHasGrant(viewer.id, 'contact', 'view_all').catch(() => false);
      const isAdminLike = viewer.role === 'owner' || viewer.role === 'admin';
      if (!canViewTeam && !isAdminLike) {
        return reply.status(403).send({
          error: 'Section "Quản lý team" yêu cầu quyền view_all trên contact',
          code: 'DASHBOARD_TEAM_FORBIDDEN',
        });
      }

      // Resolve scope: visible users = self + dept subtree members
      const scope = await getOwnerScope({
        userId: viewer.id,
        orgId: viewer.orgId,
        legacyRole: viewer.role,
        resource: 'contact',
      });

      // Filter by deptIds nếu admin pass — kiểm tra mỗi dept ∈ allowed scope
      let visibleUserIds: string[];
      if (scope.canViewAll) {
        if (query.deptIds) {
          const deptIds = query.deptIds.split(',').filter(Boolean);
          const members = await prisma.departmentMember.findMany({
            where: { department: { orgId: viewer.orgId, id: { in: deptIds } } },
            select: { userId: true },
          });
          visibleUserIds = members.map((m) => m.userId);
        } else {
          // canViewAll + no deptIds → all users in org
          const allUsers = await prisma.user.findMany({
            where: { orgId: viewer.orgId },
            select: { id: true },
          });
          visibleUserIds = allUsers.map((u) => u.id);
        }
      } else {
        visibleUserIds = scope.visibleUserIds;
      }

      const { today, tomorrow } = todayRangeVN();
      const weekAgo = new Date(today.getTime() - 7 * 86400000);

      // Per-user breakdown — bảng team table
      const usersInScope = await prisma.user.findMany({
        where: { id: { in: visibleUserIds }, orgId: viewer.orgId },
        select: {
          id: true,
          fullName: true,
          email: true,
          departmentMember: {
            select: {
              deptRole: true,
              department: { select: { id: true, name: true } },
            },
          },
        },
      });

      const perUser = await Promise.all(
        usersInScope.map(async (u) => {
          const [unrepliedSplit, apptSplit, contactsCount, closedWeek] = await Promise.all([
            // CRM rule 2026-05-29: chỉ user 1-1, bỏ nhóm.
            splitByPrivacy(viewer.orgId, u.id, async (zIds) =>
              prisma.conversation.count({
                where: {
                  orgId: viewer.orgId,
                  zaloAccountId: { in: zIds },
                  threadType: 'user',
                  isReplied: false,
                  unreadCount: { gt: 0 },
                },
              }),
            ),
            splitByPrivacy(viewer.orgId, u.id, async () =>
              prisma.appointment.count({
                where: {
                  orgId: viewer.orgId,
                  assignedUserId: u.id,
                  appointmentDate: { gte: today, lt: tomorrow },
                  status: 'scheduled',
                },
              }),
            ),
            prisma.contact.count({
              where: { orgId: viewer.orgId, assignedUserId: u.id },
            }),
            prisma.contact.count({
              where: {
                orgId: viewer.orgId,
                assignedUserId: u.id,
                status: { in: ['closed_won', 'chot', 'closed'] },
                updatedAt: { gte: weekAgo },
              },
            }),
          ]);

          // Has private nick?
          const privateCount = await prisma.zaloAccount.count({
            where: { orgId: viewer.orgId, ownerUserId: u.id, privacyMode: 'main' },
          });

          return {
            userId: u.id,
            fullName: u.fullName,
            email: u.email,
            departmentName: u.departmentMember?.department.name ?? null,
            deptRole: u.departmentMember?.deptRole ?? null,
            hasPrivateNick: privateCount > 0,
            privateNickCount: privateCount,
            unreplied: unrepliedSplit,
            todayAppointments: apptSplit,
            totalContacts: contactsCount,
            closedThisWeek: closedWeek,
          };
        }),
      );

      // Aggregate KPI team — sum tất cả perUser
      const teamKpi = perUser.reduce(
        (acc, u) => ({
          unreplied: {
            public: acc.unreplied.public + u.unreplied.public,
            private: acc.unreplied.private + u.unreplied.private,
          },
          todayAppointments: {
            public: acc.todayAppointments.public + u.todayAppointments.public,
            private: acc.todayAppointments.private + u.todayAppointments.private,
          },
          totalContacts: acc.totalContacts + u.totalContacts,
          closedThisWeek: acc.closedThisWeek + u.closedThisWeek,
        }),
        {
          unreplied: { public: 0, private: 0 },
          todayAppointments: { public: 0, private: 0 },
          totalContacts: 0,
          closedThisWeek: 0,
        },
      );

      // Top performer
      const topUser = [...perUser].sort((a, b) => b.closedThisWeek - a.closedThisWeek)[0];

      return {
        scope: {
          canViewAll: scope.canViewAll,
          deptIds: query.deptIds?.split(',') ?? [],
          userCount: usersInScope.length,
        },
        teamKpi,
        topUser: topUser
          ? { userId: topUser.userId, fullName: topUser.fullName, closedThisWeek: topUser.closedThisWeek }
          : null,
        perUser: perUser.sort((a, b) => b.closedThisWeek - a.closedThisWeek),
      };
    } catch (err) {
      logger.error('[dashboard-action-hub] /team error:', err);
      return reply.status(500).send({ error: 'Failed to fetch /team dashboard' });
    }
  });

  // ─── GET /dashboard/system ────────────────────────────────────────────
  // Section 3: "Quản lý hệ thống". Admin only.
  app.get('/api/v1/dashboard/action-hub/system', async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const viewer = request.user!;
      const isAdminLike = viewer.role === 'owner' || viewer.role === 'admin';
      if (!isAdminLike) {
        return reply.status(403).send({
          error: 'Section "Quản lý hệ thống" chỉ dành cho admin/owner',
          code: 'DASHBOARD_SYSTEM_FORBIDDEN',
        });
      }

      const { today, tomorrow } = todayRangeVN();
      const monthStart = monthStartVN();

      // Nick health 50 nick
      const [nicksHealthy, nicksOverlimit, nicksBanned, nicksOffline, nicksPrivate, totalNicks] =
        await Promise.all([
          prisma.zaloAccount.count({ where: { orgId: viewer.orgId, status: 'connected' } }),
          // overlimit: TODO — chưa có flag, tạm 0
          Promise.resolve(0),
          prisma.zaloAccount.count({ where: { orgId: viewer.orgId, status: 'banned' } }),
          prisma.zaloAccount.count({ where: { orgId: viewer.orgId, status: 'disconnected' } }),
          prisma.zaloAccount.count({ where: { orgId: viewer.orgId, privacyMode: 'main' } }),
          prisma.zaloAccount.count({ where: { orgId: viewer.orgId } }),
        ]);

      // Department ranking — chốt tháng + DT (DT chưa có schema, để 0)
      const depts = await prisma.department.findMany({
        where: { orgId: viewer.orgId },
        select: { id: true, name: true, members: { select: { userId: true } } },
      });

      const deptRanking = await Promise.all(
        depts.map(async (d) => {
          const memberIds = d.members.map((m) => m.userId);
          if (memberIds.length === 0) {
            return {
              departmentId: d.id,
              departmentName: d.name,
              memberCount: 0,
              newLeadsThisMonth: 0,
              closedThisMonth: 0,
            };
          }
          const [newLeads, closed] = await Promise.all([
            prisma.contact.count({
              where: {
                orgId: viewer.orgId,
                assignedUserId: { in: memberIds },
                createdAt: { gte: monthStart },
              },
            }),
            prisma.contact.count({
              where: {
                orgId: viewer.orgId,
                assignedUserId: { in: memberIds },
                status: { in: ['closed_won', 'chot', 'closed'] },
                updatedAt: { gte: monthStart },
              },
            }),
          ]);
          return {
            departmentId: d.id,
            departmentName: d.name,
            memberCount: memberIds.length,
            newLeadsThisMonth: newLeads,
            closedThisMonth: closed,
          };
        }),
      );

      // Recent audit log (top 5 impersonate action)
      const recentAudit = await prisma.activityLog.findMany({
        where: {
          orgId: viewer.orgId,
          category: 'impersonate',
          createdAt: { gte: today },
        },
        select: {
          id: true,
          action: true,
          details: true,
          createdAt: true,
          user: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      // Audit count today
      const auditCountToday = await prisma.activityLog.count({
        where: {
          orgId: viewer.orgId,
          category: 'impersonate',
          createdAt: { gte: today, lt: tomorrow },
        },
      });

      // Funnel tháng (toàn org) — count contact theo status
      const funnelGroups = await prisma.contact.groupBy({
        by: ['status'],
        where: { orgId: viewer.orgId, status: { not: null } },
        _count: true,
      });

      // New leads tháng
      const newLeadsThisMonth = await prisma.contact.count({
        where: { orgId: viewer.orgId, createdAt: { gte: monthStart } },
      });

      // Total contacts in org
      const totalContacts = await prisma.contact.count({
        where: { orgId: viewer.orgId },
      });

      return {
        orgKpi: {
          totalNicks,
          nickHealth: {
            healthy: nicksHealthy,
            overlimit: nicksOverlimit,
            banned: nicksBanned,
            offline: nicksOffline,
            private: nicksPrivate,
          },
          newLeadsThisMonth,
          totalContacts,
          auditCountToday,
        },
        deptRanking: deptRanking.sort((a, b) => b.closedThisMonth - a.closedThisMonth),
        funnel: funnelGroups.map((g) => ({ status: g.status, count: g._count })),
        recentAudit: recentAudit.map((a) => ({
          id: a.id,
          actorName: a.user?.fullName ?? 'Hệ thống',
          actorId: a.user?.id,
          action: a.action,
          details: a.details,
          createdAt: a.createdAt,
        })),
      };
    } catch (err) {
      logger.error('[dashboard-action-hub] /system error:', err);
      return reply.status(500).send({ error: 'Failed to fetch /system dashboard' });
    }
  });

  // ─── GET /dashboard/picker/users ──────────────────────────────────────
  // Picker chip section 1: list users viewerId được phép xem dashboard cá nhân.
  app.get('/api/v1/dashboard/action-hub/picker/users', async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const viewer = request.user!;
      const scope = await getOwnerScope({
        userId: viewer.id,
        orgId: viewer.orgId,
        legacyRole: viewer.role,
        resource: 'contact',
      });

      let users;
      if (scope.canViewAll) {
        users = await prisma.user.findMany({
          where: { orgId: viewer.orgId },
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentMember: {
              select: { department: { select: { id: true, name: true } } },
            },
          },
          orderBy: { fullName: 'asc' },
        });
      } else {
        users = await prisma.user.findMany({
          where: { id: { in: scope.visibleUserIds }, orgId: viewer.orgId },
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentMember: {
              select: { department: { select: { id: true, name: true } } },
            },
          },
          orderBy: { fullName: 'asc' },
        });
      }

      return {
        canViewAll: scope.canViewAll,
        users: users.map((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          departmentId: u.departmentMember?.department.id,
          departmentName: u.departmentMember?.department.name,
          isSelf: u.id === viewer.id,
        })),
      };
    } catch (err) {
      logger.error('[dashboard-action-hub] /picker/users error:', err);
      return reply.status(500).send({ error: 'Failed to fetch picker users' });
    }
  });

  // ─── GET /dashboard/picker/depts ──────────────────────────────────────
  // Picker chip section 2: list dept viewerId được phép multi-select.
  app.get('/api/v1/dashboard/action-hub/picker/depts', async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const viewer = request.user!;
      const scope = await getOwnerScope({
        userId: viewer.id,
        orgId: viewer.orgId,
        legacyRole: viewer.role,
        resource: 'contact',
      });

      type DeptRow = { id: string; name: string; path: string; _count: { members: number } };
      let depts: DeptRow[];
      if (scope.canViewAll) {
        depts = await prisma.department.findMany({
          where: { orgId: viewer.orgId },
          select: {
            id: true,
            name: true,
            path: true,
            _count: { select: { members: true } },
          },
          orderBy: { path: 'asc' },
        });
      } else {
        // Leader/deputy: depts trong subtree
        const me = await prisma.user.findFirst({
          where: { id: viewer.id, orgId: viewer.orgId },
          select: {
            departmentMember: {
              select: { department: { select: { path: true } } },
            },
          },
        });
        if (!me?.departmentMember) {
          depts = [];
        } else {
          depts = await prisma.department.findMany({
            where: {
              orgId: viewer.orgId,
              path: { startsWith: me.departmentMember.department.path },
            },
            select: {
              id: true,
              name: true,
              path: true,
              _count: { select: { members: true } },
            },
            orderBy: { path: 'asc' },
          });
        }
      }

      return {
        canViewAll: scope.canViewAll,
        depts: depts.map((d) => ({
          id: d.id,
          name: d.name,
          path: d.path,
          memberCount: d._count.members,
        })),
      };
    } catch (err) {
      logger.error('[dashboard-action-hub] /picker/depts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch picker depts' });
    }
  });
}
