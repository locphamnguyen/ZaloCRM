// ════════════════════════════════════════════════════════════════════════
// CareSession (Phiên chăm sóc) — HTTP Routes — 2026-06-07 (T10)
// ════════════════════════════════════════════════════════════════════════
//
// Mục "Phiên chăm sóc" trong khu automation (ngang hàng Mục tiêu):
//   GET  /api/v1/automation/care-sessions          — list phiên (filter + page)
//   GET  /api/v1/automation/care-sessions/:id       — chi tiết 1 phiên + events
//   POST /api/v1/automation/care-sessions/:id/close — sale đánh dấu đã xử lý
//
// RBAC scope (D-frontend, eng-review): dùng cột ownerUserId NATIVE (không
// materialize IN-list 10k contactIds). sale → ownerUserId=mình; admin → cả org.
// Manager scope (cha xem con) chờ RBAC M2 — tạm: admin thấy hết, sale thấy mình.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { closeCareSessionById, createCareSession } from './care-session-service.js';
import { getOwnerScope } from '../../rbac/owner-scope.js';

interface ListQuery {
  state?: string; // 'active' | 'closed' | 'all'
  sourceType?: string; // 'trigger' | 'sequence_manual'
  ownerUserId?: string; // admin filter theo sale
  limit?: string;
  offset?: string;
}

export async function careSessionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET list phiên ────────────────────────────────────────────────────────
  app.get<{ Querystring: ListQuery }>(
    '/api/v1/automation/care-sessions',
    async (request: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) => {
      const user = request.user!;
      const q = request.query ?? {};

      const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50) || 50));
      const offset = Math.max(0, Number(q.offset ?? 0) || 0);

      // RBAC scope (T11): admin/view_all → cả org; leader/deputy → dept subtree;
      // sale → chỉ mình. Dùng ownerUserId native (KHÔNG materialize IN-list contact).
      const scope = await getOwnerScope({
        userId: user.id,
        orgId: user.orgId,
        legacyRole: user.role,
        resource: 'care_session',
      });
      const where: Record<string, unknown> = { orgId: user.orgId };
      if (!scope.canViewAll) {
        where.ownerUserId = { in: scope.visibleUserIds };
      } else if (q.ownerUserId) {
        where.ownerUserId = q.ownerUserId;
      }
      if (q.state === 'active' || q.state === 'closed') where.state = q.state;
      if (q.sourceType === 'trigger' || q.sourceType === 'sequence_manual') {
        where.sourceType = q.sourceType;
      }

      const [rows, total] = await Promise.all([
        prisma.careSession.findMany({
          where,
          orderBy: { openedAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            contactId: true,
            nickId: true,
            ownerUserId: true,
            sourceType: true,
            sourceTriggerId: true,
            sourceSequenceId: true,
            state: true,
            closedReason: true,
            interestWindowUntil: true,
            lastCustomerActivityAt: true,
            lastReplyAt: true,
            pausedUntil: true,
            openedAt: true,
            closedAt: true,
            trigger: { select: { name: true, state: true } },
          },
        }),
        prisma.careSession.count({ where }),
      ]);

      // Enrich: tên KH + tên sale (1 query gộp tránh N+1).
      const contactIds = [...new Set(rows.map((r) => r.contactId))];
      const ownerIds = [...new Set(rows.map((r) => r.ownerUserId))];
      const [contacts, owners] = await Promise.all([
        prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, fullName: true, crmName: true, phone: true, avatarUrl: true, gender: true },
        }),
        prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, fullName: true },
        }),
      ]);
      const contactMap = new Map(contacts.map((c) => [c.id, c]));
      const ownerMap = new Map(owners.map((o) => [o.id, o.fullName]));

      // ── Enrich tiến độ luồng cho card (anh chốt 2026-06-07): nick + đã gửi X/N + gửi tiếp ──
      // BATCH (tránh N+1): 1 query nick + 1 groupBy event log + 1 scan BullMQ toàn list.
      const nickIds = [...new Set(rows.map((r) => r.nickId))];
      const seqIds = [...new Set(rows.map((r) => r.sourceSequenceId).filter(Boolean) as string[])];
      const [nicks, sentLogs, seqSteps] = await Promise.all([
        prisma.zaloAccount.findMany({
          where: { id: { in: nickIds }, orgId: user.orgId },
          select: { id: true, displayName: true },
        }),
        // Đếm bước đã gửi per (trigger, contact).
        prisma.automationEventLog.groupBy({
          by: ['triggerId', 'contactId'],
          where: {
            orgId: user.orgId,
            eventType: 'sequence_step_sent',
            triggerId: { in: [...new Set(rows.map((r) => r.sourceTriggerId).filter(Boolean) as string[])] },
            contactId: { in: contactIds },
          },
          _count: { id: true },
        }),
        // Tên + tổng bước của sequence (anh chốt 2026-06-07: show sequence là CHÍNH).
        seqIds.length
          ? prisma.automationSequence.findMany({
              where: { id: { in: seqIds } },
              select: { id: true, name: true, steps: true },
            })
          : Promise.resolve([]),
      ]);
      const nickMap = new Map(nicks.map((n) => [n.id, n.displayName]));
      const sentMap = new Map(sentLogs.map((l) => [`${l.triggerId}|${l.contactId}`, l._count.id]));
      const totalStepsMap = new Map(
        seqSteps.map((s) => [s.id, Array.isArray(s.steps) ? (s.steps as unknown[]).length : 0]),
      );
      const seqNameMap = new Map(seqSteps.map((s) => [s.id, s.name]));

      // nextRunAt: scan BullMQ delayed/waiting 1 lần, map theo jobId prefix triggerId-contactId-.
      const nextRunMap = new Map<string, Date>();
      try {
        const { getSequenceStepQueue } = await import('../queues/queue-registry.js');
        const queue = getSequenceStepQueue();
        const jobs = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 5000);
        for (const job of jobs) {
          if (!job.id) continue;
          const at = new Date((job.timestamp ?? Date.now()) + (job.opts?.delay ?? 0));
          // jobId = triggerId-contactId-stepIdx → key = triggerId|contactId, giữ lần sớm nhất.
          const lastDash = job.id.lastIndexOf('-');
          if (lastDash < 0) continue;
          const tcPart = job.id.slice(0, lastDash); // triggerId-contactId
          const sep = tcPart.lastIndexOf('-'); // contactId là uuid có dash → tách cuối
          // jobId pattern: <uuid trigger>-<uuid contact>-<step>. Khớp trực tiếp theo rows.
          for (const r of rows) {
            if (r.sourceTriggerId && job.id.startsWith(`${r.sourceTriggerId}-${r.contactId}-`)) {
              const key = `${r.sourceTriggerId}|${r.contactId}`;
              const prev = nextRunMap.get(key);
              if (!prev || at < prev) nextRunMap.set(key, at);
            }
          }
          void sep;
        }
      } catch {
        /* BullMQ không sẵn → bỏ qua nextRunAt (best-effort) */
      }

      const now = Date.now();
      const RECENT_REPLY_MS = 2 * 3600_000; // reply <2h = "cần xử lý gấp"
      const items = rows.map((r) => {
        const ct = contactMap.get(r.contactId);
        // Derive uiState cho FE group (anh chốt 2026-06-07):
        //   closed → đã đóng
        //   reply  → KH vừa trả lời (<2h) + luồng đang pause → CẦN XỬ LÝ NGAY
        //   paused → đang tạm dừng (pausedUntil còn) nhưng reply đã cũ
        //   active → đang chăm sóc bình thường
        let uiState: 'reply' | 'paused' | 'active' | 'closed' = 'active';
        if (r.state === 'closed') uiState = 'closed';
        else if (r.pausedUntil && r.pausedUntil.getTime() > now) {
          uiState =
            r.lastReplyAt && now - r.lastReplyAt.getTime() < RECENT_REPLY_MS ? 'reply' : 'paused';
        }
        return {
          id: r.id,
          contactName: ct?.crmName?.trim() || ct?.fullName?.trim() || ct?.phone || '(KH)',
          contactPhone: ct?.phone ?? null,
          contactAvatar: ct?.avatarUrl ?? null,
          contactGender: ct?.gender ?? null, // 'male' | 'female' | null
          ownerName: ownerMap.get(r.ownerUserId) ?? '',
          sourceType: r.sourceType,
          // sourceLabel = LUỒNG bám đuổi (chính, anh chốt 2026-06-07) — fallback trigger/Gắn tay.
          sourceLabel:
            (r.sourceSequenceId ? seqNameMap.get(r.sourceSequenceId) : null) ||
            (r.sourceType === 'trigger' ? (r.trigger?.name ?? 'Mục tiêu') : 'Gắn tay'),
          // triggerLabel = MỤC TIÊU (phụ, dòng mờ "từ: ..."). Null nếu phiên gắn tay thuần.
          triggerLabel: r.sourceType === 'trigger' ? (r.trigger?.name ?? null) : null,
          state: r.state,
          uiState,
          closedReason: r.closedReason,
          interestWindowUntil: r.interestWindowUntil,
          lastCustomerActivityAt: r.lastCustomerActivityAt,
          lastReplyAt: r.lastReplyAt,
          pausedUntil: r.pausedUntil,
          // "Đã báo sale" = có lastReplyAt (reply đã trigger dispatchCareNotify).
          notifiedSale: r.lastReplyAt != null,
          openedAt: r.openedAt,
          closedAt: r.closedAt,
          // Tiến độ luồng cho card "đang chăm" (anh chốt 2026-06-07).
          nickName: nickMap.get(r.nickId) ?? null,
          sentSteps: r.sourceTriggerId ? (sentMap.get(`${r.sourceTriggerId}|${r.contactId}`) ?? 0) : 0,
          totalSteps: r.sourceSequenceId ? (totalStepsMap.get(r.sourceSequenceId) ?? 0) : 0,
          nextRunAt: r.sourceTriggerId
            ? (nextRunMap.get(`${r.sourceTriggerId}|${r.contactId}`) ?? null)
            : null,
        };
      });

      return reply.send({ items, total, limit, offset });
    },
  );

  // ── GET chi tiết 1 phiên + events ─────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/v1/automation/care-sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const scope = await getOwnerScope({ userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'care_session' });

      const session = await prisma.careSession.findFirst({
        where: {
          id: request.params.id,
          orgId: user.orgId,
          ...(scope.canViewAll ? {} : { ownerUserId: { in: scope.visibleUserIds } }),
        },
        include: {
          trigger: { select: { name: true, state: true } },
          events: { orderBy: { createdAt: 'asc' }, take: 200 },
        },
      });
      if (!session) return reply.status(404).send({ error: 'care_session_not_found' });

      // Lịch sử thông báo đã gửi cho phiên này (SystemNotification — best-effort).
      const notifications = await prisma.systemNotification.findMany({
        where: { orgId: user.orgId, recipientId: session.contactId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, content: true, status: true, channel: true, error: true, createdAt: true, sentAt: true },
      });

      return reply.send({ session, notifications });
    },
  );

  // ── POST đóng phiên (sale đánh dấu đã xử lý) ───────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/v1/automation/care-sessions/:id/close',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const scope = await getOwnerScope({ userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'care_session' });

      // Verify phiên thuộc org + scope (sale đóng phiên mình, leader đóng dept).
      const session = await prisma.careSession.findFirst({
        where: {
          id: request.params.id,
          orgId: user.orgId,
          ...(scope.canViewAll ? {} : { ownerUserId: { in: scope.visibleUserIds } }),
        },
        select: { id: true },
      });
      if (!session) return reply.status(404).send({ error: 'care_session_not_found' });

      const closed = await closeCareSessionById(request.params.id, 'sale_resolved');
      logger.info(`[care-session] sale ${user.id} closed session ${request.params.id} (resolved)`);
      return reply.send({ ok: true, closed });
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // THEO DÕI THỦ CÔNG (anh chốt 2026-06-08): "ghim" 1 KH đang chat tay vào phiên
  // CHỈ LẮNG NGHE — KHÔNG gửi tin tự động. Khách reply (dù chậm) → báo sale.
  //
  //   POST   /api/v1/automation/care-sessions/listen   { contactId, nickId } → tạo/tái dùng
  //   DELETE /api/v1/automation/care-sessions/listen   { contactId, nickId } → bỏ theo dõi
  //   GET    /api/v1/automation/care-sessions/listen-status?contactId&nickId  → đang theo dõi?
  //
  // Phiên loại này: sourceType='sequence_manual', sourceTriggerId=null, sourceSequenceId=null.
  //   → KHÔNG enqueue sequence (không gửi tin), listener vẫn bắt reply (triggerState=null
  //     không bị lazy-close), tự đóng khi KH im lặng N ngày như mọi phiên (janitor).
  // ════════════════════════════════════════════════════════════════════════

  /** Resolve ownerUserId = chủ nick (đồng nhất manual-enroll) + verify contact+nick thuộc org. */
  async function resolveListenTargets(args: { orgId: string; contactId: string; nickId: string }) {
    const [contact, nick] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: args.contactId, orgId: args.orgId },
        select: { id: true, fullName: true, crmName: true },
      }),
      prisma.zaloAccount.findFirst({
        where: { id: args.nickId, orgId: args.orgId },
        select: { id: true, displayName: true, ownerUserId: true },
      }),
    ]);
    return { contact, nick };
  }

  /**
   * Per-nick UID khách (externalThreadId) cho phiên theo dõi tay (2026-06-08).
   * Ưu tiên threadId FE truyền (đang ở conversation cụ thể); fallback resolve từ
   * Conversation(nick, contact, thread 'user'). null nếu chưa có (no-Zalo) → fallback "OR null".
   */
  async function resolveListenThreadId(
    orgId: string,
    contactId: string,
    nickId: string,
    bodyThreadId?: string | null,
  ): Promise<string | null> {
    const fromBody = bodyThreadId?.trim();
    if (fromBody) return fromBody;
    const conv = await prisma.conversation.findFirst({
      where: { orgId, contactId, zaloAccountId: nickId, threadType: 'user' },
      select: { externalThreadId: true },
    });
    return conv?.externalThreadId ?? null;
  }

  // ── POST tạo/tái dùng phiên CHỈ-LẮNG-NGHE (theo dõi tay) ──────────────────
  app.post<{ Body: { contactId?: string; nickId?: string; threadId?: string } }>(
    '/api/v1/automation/care-sessions/listen',
    async (request: FastifyRequest<{ Body: { contactId?: string; nickId?: string; threadId?: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const contactId = request.body?.contactId?.trim();
      const nickId = request.body?.nickId?.trim();
      if (!contactId || !nickId) {
        return reply.status(400).send({ error: 'missing_params', message: 'Thiếu contactId hoặc nickId' });
      }

      const { contact, nick } = await resolveListenTargets({ orgId: user.orgId, contactId, nickId });
      if (!contact) return reply.status(404).send({ error: 'contact_not_found', message: 'Không tìm thấy khách hàng' });
      if (!nick) return reply.status(404).send({ error: 'nick_not_found', message: 'Không tìm thấy nick Zalo' });

      // ownerUserId = chủ nick (đồng nhất manual-enroll). Nick chưa gán chủ → fallback người bấm.
      const ownerUserId = nick.ownerUserId ?? user.id;

      // Per-nick UID khách (góc nhìn nick→khách) để neo phiên đúng hội thoại.
      const externalThreadId = await resolveListenThreadId(user.orgId, contactId, nickId, request.body?.threadId);

      // Snapshot silenceDays từ org.careCloseConditions (đồng nhất phiên tự động).
      const orgCfg = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { careCloseConditions: true },
      });
      const closeConditions = orgCfg?.careCloseConditions ?? null;
      const silenceDays = ((): number => {
        if (closeConditions && typeof closeConditions === 'object' && 'silenceDays' in closeConditions) {
          const v = (closeConditions as { silenceDays?: unknown }).silenceDays;
          if (typeof v === 'number' && v > 0) return v;
        }
        return 7;
      })();

      const sessionId = await createCareSession({
        orgId: user.orgId,
        contactId,
        nickId,
        externalThreadId,
        ownerUserId,
        sourceType: 'sequence_manual',
        sourceTriggerId: null,
        sourceSequenceId: null, // KHÔNG sequence = chỉ lắng nghe, không gửi tin
        enrolledByUserId: user.id, // ai bấm theo dõi
        silenceDays,
        closeConditions,
      });

      logger.info(
        `[care-session] LISTEN-ONLY user=${user.id} theo dõi tay contact=${contactId} nick=${nickId} → session=${sessionId}`,
      );
      const contactName = contact.crmName?.trim() || contact.fullName?.trim() || '(KH)';
      return reply.send({ ok: true, sessionId, contactName });
    },
  );

  // ── DELETE bỏ theo dõi (đóng phiên gắn-tay đang mở của contact+nick+thread) ───
  app.delete<{ Body: { contactId?: string; nickId?: string; threadId?: string } }>(
    '/api/v1/automation/care-sessions/listen',
    async (request: FastifyRequest<{ Body: { contactId?: string; nickId?: string; threadId?: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const contactId = request.body?.contactId?.trim();
      const nickId = request.body?.nickId?.trim();
      if (!contactId || !nickId) {
        return reply.status(400).send({ error: 'missing_params', message: 'Thiếu contactId hoặc nickId' });
      }

      // Per-nick thread: bỏ đúng phiên của hội thoại đang xem (fallback OR null cho phiên legacy).
      const externalThreadId = await resolveListenThreadId(user.orgId, contactId, nickId, request.body?.threadId);

      // Chỉ đóng phiên GẮN TAY (sequence_manual, không trigger) — KHÔNG đụng phiên Mục tiêu tự động.
      const result = await prisma.careSession.updateMany({
        where: {
          orgId: user.orgId,
          contactId,
          nickId,
          state: 'active',
          sourceType: 'sequence_manual',
          sourceTriggerId: null,
          ...(externalThreadId
            ? { OR: [{ externalThreadId }, { externalThreadId: null }] }
            : {}),
        },
        data: { state: 'closed', closedReason: 'sale_resolved', closedAt: new Date() },
      });
      logger.info(
        `[care-session] UNLISTEN user=${user.id} bỏ theo dõi tay contact=${contactId} nick=${nickId} thread=${externalThreadId ?? '∅'} (đóng ${result.count} phiên)`,
      );
      return reply.send({ ok: true, closed: result.count });
    },
  );

  // ── GET trạng thái theo dõi tay (cho nút biết hiển thị đang/chưa theo dõi) ──
  app.get<{ Querystring: { contactId?: string; nickId?: string; threadId?: string } }>(
    '/api/v1/automation/care-sessions/listen-status',
    async (request: FastifyRequest<{ Querystring: { contactId?: string; nickId?: string; threadId?: string } }>, reply: FastifyReply) => {
      const user = request.user!;
      const contactId = request.query?.contactId?.trim();
      const nickId = request.query?.nickId?.trim();
      if (!contactId || !nickId) {
        return reply.status(400).send({ error: 'missing_params', message: 'Thiếu contactId hoặc nickId' });
      }
      const externalThreadId = await resolveListenThreadId(user.orgId, contactId, nickId, request.query?.threadId);
      const session = await prisma.careSession.findFirst({
        where: {
          orgId: user.orgId,
          contactId,
          nickId,
          state: 'active',
          sourceType: 'sequence_manual',
          sourceTriggerId: null,
          ...(externalThreadId
            ? { OR: [{ externalThreadId }, { externalThreadId: null }] }
            : {}),
        },
        select: { id: true, openedAt: true, lastReplyAt: true },
      });
      return reply.send({
        listening: session != null,
        sessionId: session?.id ?? null,
        openedAt: session?.openedAt ?? null,
        lastReplyAt: session?.lastReplyAt ?? null,
      });
    },
  );

  // ── GET cấu hình "Lắng nghe & Nhắc chăm sóc" CHUNG cấp org ────────────────
  app.get(
    '/api/v1/automation/care-listen-config',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: {
          careNotifyChannels: true,
          careCloseConditions: true,
          internalNotifyGroupThreadId: true,
        },
      });
      return reply.send({
        notifyChannels: org?.careNotifyChannels ?? null,
        closeConditions: org?.careCloseConditions ?? null,
        groupThreadId: org?.internalNotifyGroupThreadId ?? null,
      });
    },
  );

  // ── GET danh sách NHÓM của nick hệ thống (cho admin chọn, thay nhập UID) ───
  // Nguồn: Conversation threadType='group' của nick systemNotifyZaloAccountId (đã
  // sync groupName + externalThreadId=UID khi nhận tin nhóm). Nhanh, có sẵn tên.
  app.get(
    '/api/v1/automation/care-listen-config/sender-groups',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { systemNotifyZaloAccountId: true },
      });
      if (!org?.systemNotifyZaloAccountId) {
        return reply.send({ groups: [], warning: 'Tổ chức chưa chọn nick gửi thông báo hệ thống' });
      }
      const convs = await prisma.conversation.findMany({
        where: {
          orgId: user.orgId,
          zaloAccountId: org.systemNotifyZaloAccountId,
          threadType: 'group',
        },
        select: {
          externalThreadId: true,
          groupName: true,
          groupAvatarUrl: true,
          groupMembersCount: true,
          lastMessageAt: true,
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
      });
      const groups = convs
        .filter((c) => c.externalThreadId)
        .map((c) => ({
          threadId: c.externalThreadId,
          name: c.groupName ?? '(Nhóm chưa có tên)',
          avatar: c.groupAvatarUrl ?? null,
          members: c.groupMembersCount ?? null,
        }));
      return reply.send({ groups });
    },
  );

  // ── PUT cập nhật cấu hình (chỉ admin/owner) ───────────────────────────────
  app.put<{
    Body: {
      notifyChannels?: Record<string, { owner?: boolean; manager?: boolean; zaloGroup?: boolean }>;
      closeConditions?: { onStatusIds?: string[]; onFriendTagIds?: string[]; onCrmTagIds?: string[]; silenceDays?: number };
      groupThreadId?: string | null;
    };
  }>(
    '/api/v1/automation/care-listen-config',
    async (request: FastifyRequest<{ Body: { notifyChannels?: object; closeConditions?: object; groupThreadId?: string | null } }>, reply: FastifyReply) => {
      const user = request.user!;
      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.status(403).send({ error: 'forbidden', message: 'Chỉ admin được sửa cấu hình lắng nghe chung' });
      }
      const b = request.body ?? {};
      const data: Record<string, unknown> = {};
      if (b.notifyChannels !== undefined) data.careNotifyChannels = b.notifyChannels;
      if (b.closeConditions !== undefined) data.careCloseConditions = b.closeConditions;
      if (b.groupThreadId !== undefined) data.internalNotifyGroupThreadId = b.groupThreadId;
      await prisma.organization.update({ where: { id: user.orgId }, data });
      logger.info(`[care-session] admin ${user.id} updated care-listen-config (org=${user.orgId})`);
      return reply.send({ ok: true });
    },
  );
}
