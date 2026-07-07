// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * target-routes.ts — Mục tiêu (auto kết bạn): CRUD job + log.
 *
 * Endpoints:
 *   GET    /api/v1/target-jobs                         — danh sách job (org scope)
 *   POST   /api/v1/target-jobs                         — tạo job (chạy ngay, liên tục tới khi xong)
 *   GET    /api/v1/target-jobs/:id                     — chi tiết
 *   PATCH  /api/v1/target-jobs/:id                     — sửa / pause / resume
 *   DELETE /api/v1/target-jobs/:id                     — xoá (cascade log)
 *   GET    /api/v1/target-jobs/:id/items                — log từng đối tượng
 *   GET    /api/v1/target-jobs/group-scans/:accountId   — scan khả dụng làm nguồn target
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { DEFAULT_REQUEST_MESSAGE } from '../campaign/campaign-service.js';

interface JobBody {
  name?: string;
  sourceType?: 'customer_list' | 'group_scan';
  customerListId?: string;
  groupScanId?: string;
  zaloAccountId?: string;
  requestMsg?: string;
  maxTotal?: number;
  delaySecMin?: number;
  delaySecMax?: number;
  status?: 'active' | 'paused';
  // Tin chào khi khách chấp nhận kết bạn (vòng 6). welcomeBlockIds ưu tiên
  // hơn welcomeMsg (xoay vòng chống spam). Bật mà cả 2 rỗng → 400.
  welcomeEnabled?: boolean;
  welcomeMsg?: string;
  welcomeBlockIds?: string[];
}

/** Validate cấu hình tin chào. Trả error string hoặc null. Mutate b.welcomeBlockIds đã lọc. */
async function validateWelcome(b: JobBody, orgId: string): Promise<string | null> {
  // LUÔN validate ownership welcomeBlockIds khi field có mặt trong body — KHÔNG return
  // sớm chỉ vì welcomeEnabled=false. Chặn khai thác 2 bước: (a) PATCH welcomeEnabled=false
  // kèm id khối của org khác → ghi id bẩn vào DB; (b) PATCH welcomeEnabled=true không kèm
  // welcomeBlockIds → id bẩn cũ vẫn active. Kiểm ở đây khoá cả bước (a).
  if (b.welcomeBlockIds !== undefined) {
    const blockIds = b.welcomeBlockIds.filter(Boolean);
    b.welcomeBlockIds = blockIds;
    if (blockIds.length > 0) {
      const count = await prisma.contentBlock.count({ where: { id: { in: blockIds }, orgId } });
      if (count !== blockIds.length) return 'welcomeBlock_not_found';
    }
  }
  if (!b.welcomeEnabled) return null;
  const blockIds = b.welcomeBlockIds ?? [];
  if (blockIds.length === 0 && !b.welcomeMsg?.trim()) return 'welcome_content_required';
  return null;
}

// Chỉ owner/admin được tạo/sửa/xoá Mục tiêu — gửi lời mời hàng loạt cũng là hành
// động rủi ro (spam/report) tương tự Broadcast, không nên mở cho mọi user.
function requireTargetAdmin(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): boolean {
  const user = request.user!;
  if (user.role !== 'admin' && user.role !== 'owner') {
    reply.status(403).send({ error: 'forbidden', code: 'target_admin_only' });
    return false;
  }
  return true;
}

export async function targetRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /target-jobs ────────────────────────────────────────────────────
  app.get('/api/v1/target-jobs', async (request) => {
    const user = request.user!;
    const jobs = await prisma.targetJob.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    });
    const [lists, nicks, scans] = await Promise.all([
      prisma.customerList.findMany({
        where: { id: { in: [...new Set(jobs.map((j) => j.customerListId).filter((x): x is string => !!x))] } },
        select: { id: true, name: true, hasZaloEntries: true },
      }),
      prisma.zaloAccount.findMany({
        where: { id: { in: [...new Set(jobs.map((j) => j.zaloAccountId))] } },
        select: { id: true, displayName: true, phone: true, status: true },
      }),
      prisma.groupScan.findMany({
        where: { id: { in: [...new Set(jobs.map((j) => j.groupScanId).filter((x): x is string => !!x))] } },
        select: { id: true, scannedGroups: true, memberCount: true, friendCount: true, createdAt: true },
      }),
    ]);
    const listMap = new Map(lists.map((l) => [l.id, l]));
    const nickMap = new Map(nicks.map((n) => [n.id, n]));
    const scanMap = new Map(scans.map((s) => [s.id, s]));
    return {
      jobs: jobs.map((j) => ({
        ...j,
        list: j.customerListId ? listMap.get(j.customerListId) ?? null : null,
        groupScan: j.groupScanId ? scanMap.get(j.groupScanId) ?? null : null,
        nick: nickMap.get(j.zaloAccountId) ?? null,
      })),
    };
  });

  // ── GET /target-jobs/group-scans/:accountId — scan khả dụng cho nick này ──
  app.get<{ Params: { accountId: string } }>('/api/v1/target-jobs/group-scans/:accountId', async (request, reply) => {
    const user = request.user!;
    const nick = await prisma.zaloAccount.findFirst({ where: { id: request.params.accountId, orgId: user.orgId }, select: { id: true } });
    if (!nick) return reply.status(400).send({ error: 'zaloAccount_not_found' });

    const scans = await prisma.groupScan.findMany({
      where: { zaloAccountId: nick.id, orgId: user.orgId, state: { in: ['completed', 'partial'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, scannedGroups: true, memberCount: true, friendCount: true, createdAt: true, groupIds: true },
    });

    // Gắn tên nhóm (tối đa 3 nhóm đầu, đủ để hiển thị gợi nhớ) qua Conversation.groupName.
    const allGroupIds = [...new Set(scans.flatMap((s) => (Array.isArray(s.groupIds) ? (s.groupIds as unknown[]).map(String) : []).slice(0, 3)))];
    const convos = allGroupIds.length
      ? await prisma.conversation.findMany({
          where: { zaloAccountId: nick.id, externalThreadId: { in: allGroupIds }, threadType: 'group' },
          select: { externalThreadId: true, groupName: true },
        })
      : [];
    const nameMap = new Map(convos.map((c) => [c.externalThreadId, c.groupName]));

    return {
      scans: scans.map((s) => {
        const ids = Array.isArray(s.groupIds) ? (s.groupIds as unknown[]).map(String) : [];
        const names = ids.slice(0, 3).map((gid) => nameMap.get(gid) || null).filter(Boolean);
        return {
          id: s.id, scannedGroups: s.scannedGroups, memberCount: s.memberCount,
          friendCount: s.friendCount, notFriendCount: Math.max(0, s.memberCount - s.friendCount),
          createdAt: s.createdAt, groupNames: names,
        };
      }),
    };
  });

  // ── POST /target-jobs ───────────────────────────────────────────────────
  app.post<{ Body: JobBody }>('/api/v1/target-jobs', async (request, reply) => {
    if (!requireTargetAdmin(request, reply)) return;
    const user = request.user!;
    const b = request.body ?? {};
    const sourceType = b.sourceType === 'group_scan' ? 'group_scan' : 'customer_list';

    if (!b.name?.trim()) return reply.status(400).send({ error: 'name_required' });

    const nick = await prisma.zaloAccount.findFirst({ where: { id: b.zaloAccountId ?? '', orgId: user.orgId }, select: { id: true } });
    if (!nick) return reply.status(400).send({ error: 'zaloAccount_not_found' });

    let customerListId: string | null = null;
    let groupScanId: string | null = null;

    if (sourceType === 'customer_list') {
      const list = await prisma.customerList.findFirst({ where: { id: b.customerListId ?? '', orgId: user.orgId }, select: { id: true } });
      if (!list) return reply.status(400).send({ error: 'customerList_not_found' });
      customerListId = list.id;
    } else {
      const scan = await prisma.groupScan.findFirst({
        where: { id: b.groupScanId ?? '', orgId: user.orgId },
        select: { id: true, zaloAccountId: true, state: true },
      });
      if (!scan) return reply.status(400).send({ error: 'groupScan_not_found' });
      if (scan.zaloAccountId !== nick.id) return reply.status(400).send({ error: 'groupScan_nick_mismatch', hint: 'Nick gửi phải trùng nick đã quét nhóm' });
      if (scan.state !== 'completed' && scan.state !== 'partial') return reply.status(400).send({ error: 'groupScan_not_ready' });
      groupScanId = scan.id;
    }

    const welcomeErr = await validateWelcome(b, user.orgId);
    if (welcomeErr) return reply.status(400).send({ error: welcomeErr });

    const job = await prisma.targetJob.create({
      data: {
        orgId: user.orgId,
        createdById: user.id,
        name: b.name.trim(),
        sourceType,
        customerListId,
        groupScanId,
        zaloAccountId: nick.id,
        requestMsg: b.requestMsg?.trim() || DEFAULT_REQUEST_MESSAGE,
        maxTotal: Math.min(2000, Math.max(1, b.maxTotal ?? 200)),
        delaySecMin: Math.max(10, b.delaySecMin ?? 60),
        delaySecMax: Math.max(10, b.delaySecMax ?? 180),
        welcomeEnabled: b.welcomeEnabled === true,
        welcomeMsg: b.welcomeMsg?.trim() ?? '',
        welcomeBlockIds: b.welcomeBlockIds ?? [],
      },
    });
    logger.info(`[target] job created id=${job.id} by=${user.id} source=${sourceType}`);
    return reply.status(201).send({ job });
  });

  // ── GET /target-jobs/:id ────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/v1/target-jobs/:id', async (request, reply) => {
    const user = request.user!;
    const job = await prisma.targetJob.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
    if (!job) return reply.status(404).send({ error: 'not_found' });
    return { job };
  });

  // ── PATCH /target-jobs/:id — sửa / pause / resume ───────────────────────
  app.patch<{ Params: { id: string }; Body: JobBody }>('/api/v1/target-jobs/:id', async (request, reply) => {
    if (!requireTargetAdmin(request, reply)) return;
    const user = request.user!;
    const existing = await prisma.targetJob.findFirst({ where: { id: request.params.id, orgId: user.orgId } });
    if (!existing) return reply.status(404).send({ error: 'not_found' });

    const b = request.body ?? {};
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name.trim();
    if (b.requestMsg !== undefined) data.requestMsg = b.requestMsg?.trim() || DEFAULT_REQUEST_MESSAGE;
    if (b.maxTotal !== undefined) data.maxTotal = Math.min(2000, Math.max(1, b.maxTotal));
    if (b.delaySecMin !== undefined) data.delaySecMin = Math.max(10, b.delaySecMin);
    if (b.delaySecMax !== undefined) data.delaySecMax = Math.max(10, b.delaySecMax);
    if (b.status === 'paused' || b.status === 'active') data.status = b.status;

    // Tin chào: cho bật/tắt/sửa nội dung cả sau khi job chạy (pass chào độc lập)
    if (b.welcomeEnabled !== undefined) {
      const welcomeErr = await validateWelcome(b, user.orgId);
      if (welcomeErr) return reply.status(400).send({ error: welcomeErr });
      data.welcomeEnabled = b.welcomeEnabled === true;
      if (b.welcomeMsg !== undefined) data.welcomeMsg = b.welcomeMsg?.trim() ?? '';
      if (b.welcomeBlockIds !== undefined) data.welcomeBlockIds = b.welcomeBlockIds;
      // Bật chào cho job đã chạy → xếp hàng cả các lời mời ĐÃ gửi trước đó chưa chào.
      // Item cũ (trước vòng 6) thiếu contactId → backfill từ FriendshipAttempt
      // (khớp nick + zaloUidFound) rồi mới đánh 'waiting'.
      if (b.welcomeEnabled === true && !existing.welcomeEnabled) {
        await prisma.$executeRaw`
          UPDATE target_run_items tri
             SET contact_id = fa.contact_id
            FROM friendship_attempts fa
           WHERE tri.job_id = ${existing.id}
             AND tri.contact_id IS NULL
             AND tri.status = 'sent'
             AND tri.zalo_uid IS NOT NULL
             AND fa.zalo_account_id = ${existing.zaloAccountId}
             AND fa.zalo_uid_found = tri.zalo_uid
        `;
        await prisma.targetRunItem.updateMany({
          where: { jobId: existing.id, status: 'sent', welcomeStatus: null, contactId: { not: null } },
          data: { welcomeStatus: 'waiting' },
        });
      }
    }

    const job = await prisma.targetJob.update({ where: { id: existing.id }, data });
    return { job };
  });

  // ── DELETE /target-jobs/:id ─────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/v1/target-jobs/:id', async (request, reply) => {
    if (!requireTargetAdmin(request, reply)) return;
    const user = request.user!;
    const existing = await prisma.targetJob.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'not_found' });
    await prisma.targetJob.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  // ── GET /target-jobs/:id/items ───────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/api/v1/target-jobs/:id/items',
    async (request, reply) => {
      const user = request.user!;
      const job = await prisma.targetJob.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true } });
      if (!job) return reply.status(404).send({ error: 'not_found' });
      const { status } = request.query;
      const items = await prisma.targetRunItem.findMany({
        where: { jobId: job.id, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      return { items };
    },
  );
}
