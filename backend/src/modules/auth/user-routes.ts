// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * User management routes — CRUD for users within an org.
 * All routes require authentication via authMiddleware.
 * Role-based access: owner > admin > member.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware, requireActiveUser } from './auth-middleware.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { sendSystemNotificationToUser } from '../system-notifications/system-notify-service.js';

// 2026-06-09 (anh chốt audit) — ghi nhật ký hành động admin vào ActivityLog có sẵn
// (category='admin'), KHÔNG tạo model mới. Fire-and-forget: lỗi log KHÔNG chặn nghiệp vụ.
async function writeAudit(
  actor: { id: string; orgId: string; email?: string },
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown>,
) {
  try {
    await prisma.activityLog.create({
      data: {
        orgId: actor.orgId,
        userId: actor.id,
        actorType: 'user',
        category: 'admin',
        action,
        entityType: 'user',
        entityId: targetUserId,
        details: details as any,
      },
    });
  } catch (e) {
    logger.warn(`[audit] write fail action=${action}: ${(e as Error)?.message}`);
  }
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  // C1 2026-06-08 — re-check isActive DB (đóng cửa sổ 15' cho quản lý user nhạy cảm).
  app.addHook('preHandler', requireActiveUser);

  // GET /api/v1/users — list all users in org
  // Phase Marketing+Analytics Scope 2026-05-27: sale member chỉ thấy fullName + role
  // (ẩn email + phone của sale khác — PII không cần lộ trong org chart cấp sale).
  // Leader/Admin/Owner thấy đầy đủ.
  app.get('/api/v1/users', async (request: FastifyRequest) => {
    const user = request.user!;
    const isPrivileged = user.role === 'owner' || user.role === 'admin';
    const users = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
        createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (isPrivileged) return { users };
    // Member: ẩn email + phone của user khác (chỉ thấy của chính mình)
    const masked = users.map((u) => ({
      ...u,
      email: u.id === user.id ? u.email : null,
      phone: u.id === user.id ? u.phone : null,
    }));
    return { users: masked };
  });

  // POST /api/v1/users — create user (owner/admin only)
  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { email, phone: rawPhone, fullName, password, role = 'member', teamId } = request.body as any;
    if (!fullName || !password) {
      return reply.status(400).send({ error: 'Họ tên và mật khẩu là bắt buộc' });
    }
    // Phase Onboarding v1 2026-05-24 — sale VN chỉ cần SĐT, email optional.
    // Bắt buộc ít nhất 1 trong 2 (email hoặc phone) để có identifier login.
    const trimmedEmail = email ? String(email).toLowerCase().trim() : null;
    const normalizedPhone = rawPhone ? normalizePhone(String(rawPhone)) : null;
    if (!trimmedEmail && !normalizedPhone) {
      return reply.status(400).send({ error: 'Cần ít nhất 1 trong: Email hoặc Số điện thoại' });
    }
    if (rawPhone && !normalizedPhone) {
      return reply.status(400).send({ error: 'Số điện thoại không hợp lệ' });
    }

    if (trimmedEmail) {
      const existingEmail = await prisma.user.findUnique({ where: { email: trimmedEmail } });
      if (existingEmail) return reply.status(400).send({ error: 'Email đã tồn tại' });
    }
    if (normalizedPhone) {
      const existingPhone = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
      if (existingPhone) return reply.status(400).send({ error: 'Số điện thoại đã tồn tại' });
    }

    if (role === 'owner') return reply.status(400).send({ error: 'Không thể tạo thêm owner' });
    if (role === 'admin' && currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có thể tạo admin' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        orgId: currentUser.orgId,
        email: trimmedEmail,
        phone: normalizedPhone,
        fullName,
        passwordHash,
        role,
        teamId: teamId || null,
        // Phase Onboarding v1 2026-05-24 — user mới luôn null → force đổi password lần đầu.
        passwordChangedAt: null,
        onboardingStepsCompleted: undefined as any,
        onboardingDismissedAt: null,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info(`User created: ${user.email || user.phone} by ${currentUser.email} (onboarding pending)`);
    return user;
  });

  // PUT /api/v1/users/:id — update user info
  app.put('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };

    if (!['owner', 'admin'].includes(currentUser.role) && currentUser.id !== id) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { fullName, email, phone: rawPhone, role, teamId, isActive } = request.body as any;

    if (id === currentUser.id && role && role !== currentUser.role) {
      return reply.status(400).send({ error: 'Không thể thay đổi role của chính mình' });
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined && currentUser.role === 'owner') updateData.role = role;
    if (teamId !== undefined) updateData.teamId = teamId || null;
    if (isActive !== undefined && currentUser.role === 'owner') updateData.isActive = isActive;

    // 2026-06-09 (anh báo "không sửa được SĐT nick cũ để giải phóng số"): cho phép
    // owner/admin sửa SĐT user. Normalize 84xxx + check trùng với user KHÁC (loại
    // trừ chính user đang sửa) để tránh Prisma P2002 thô. phone='' / null = xoá số.
    if (rawPhone !== undefined && ['owner', 'admin'].includes(currentUser.role)) {
      if (rawPhone === null || String(rawPhone).trim() === '') {
        updateData.phone = null; // xoá SĐT → giải phóng số cho user khác
      } else {
        const normalizedPhone = normalizePhone(String(rawPhone));
        if (!normalizedPhone) {
          return reply.status(400).send({ error: 'Số điện thoại không hợp lệ' });
        }
        const dupPhone = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
        if (dupPhone && dupPhone.id !== id) {
          return reply.status(409).send({
            error: `Số điện thoại đã được dùng bởi nhân viên "${dupPhone.fullName}"${dupPhone.isActive ? '' : ' (đang vô hiệu)'}. Hãy xoá/đổi số của nhân viên đó trước, hoặc dùng số khác.`,
            code: 'PHONE_TAKEN',
          });
        }
        updateData.phone = normalizedPhone;
      }
    }

    const user = await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: updateData,
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
      },
    });

    return user;
  });

  // PUT /api/v1/users/:id/password — reset password (owner/admin only).
  // Phase Onboarding v1 2026-05-24 — set passwordChangedAt=null + bump jwtTokenVersion
  // để sale bị reset password phải:
  //   1. Login lại với pw mới (JWT cũ bị revoke)
  //   2. Force đổi password sang pw riêng (admin biết pw vừa reset = security risk)
  app.put('/api/v1/users/:id/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { id } = request.params as { id: string };
    const { password, sendZalo } = request.body as { password: string; sendZalo?: boolean };
    if (!password || password.length < 6) {
      return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const target = await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: {
        passwordHash,
        passwordChangedAt: null,            // force user phải đổi lại sau khi login
        jwtTokenVersion: { increment: 1 },  // revoke mọi JWT cũ
      },
      select: { id: true, fullName: true },
    });

    logger.info(`User ${id} password reset by ${currentUser.email} (JWT revoked, onboarding force re-flow)`);
    await writeAudit(currentUser, 'user.reset_password', id, { sentZalo: !!sendZalo });

    // 2026-06-09 (anh chốt): gửi mật khẩu mới qua Zalo từ nick hệ thống → user.
    // sendSystemNotificationToUser LUÔN tạo bản ghi SystemNotification → tự có log
    // ở trang Thông báo hệ thống (channel='zalo' nếu gửi được, 'crm_panel' nếu chưa setup nick).
    let zaloSent = false;
    let zaloError: string | null = null;
    if (sendZalo) {
      try {
        const loginUrl = process.env.CRM_LOGIN_URL || process.env.APP_URL || 'https://zalo.hsholding.vn';
        const title = '🔑 Mật khẩu đã được đặt lại';
        const content =
          `Quản trị viên vừa đặt lại mật khẩu tài khoản của bạn.\n` +
          `Mật khẩu mới: ${password}\n` +
          `Đăng nhập: ${loginUrl}\n` +
          `Vui lòng đổi lại mật khẩu sau khi đăng nhập.`;
        const result = await sendSystemNotificationToUser({
          orgId: currentUser.orgId,
          targetUserId: id,
          type: 'password_reset',
          title,
          content,
          priority: 'high',
        });
        zaloSent = (result as any)?.status === 'sent' || (result as any)?.channel === 'zalo';
        zaloError = (result as any)?.error ?? null;
      } catch (e) {
        zaloError = (e as Error)?.message ?? 'Gửi Zalo lỗi';
        logger.warn(`[reset-pw] gửi Zalo lỗi cho user ${id}: ${zaloError}`);
      }
    }
    return { success: true, zaloSent, zaloError };
  });

  // DELETE /api/v1/users/:id — deactivate user (owner only)
  app.delete('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có quyền xóa nhân viên' });
    }

    const { id } = request.params as { id: string };
    if (id === currentUser.id) {
      return reply.status(400).send({ error: 'Không thể xóa chính mình' });
    }

    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: { isActive: false },
    });

    await writeAudit(currentUser, 'user.deactivate', id, {});
    return { success: true };
  });

  // POST /api/v1/users/:id/handoff — BÀN GIAO khi sale nghỉ/chuyển việc (owner/admin).
  // 2026-06-09 (anh chốt): chuyển KH + nick Zalo + lịch hẹn của 1 sale sang sale khác
  // trong 1 transaction → không mất khách khi vô hiệu sale. Có log audit (FN3).
  // Body: { toUserId, transfer?: { contacts?, nicks?, appointments? } } (mặc định chuyển hết).
  app.post('/api/v1/users/:id/handoff', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Chỉ owner/admin được bàn giao' });
    }
    const { id: fromUserId } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      toUserId?: string;
      transfer?: { contacts?: boolean; nicks?: boolean; appointments?: boolean };
    };
    const toUserId = body.toUserId;
    const t = body.transfer ?? { contacts: true, nicks: true, appointments: true };

    if (!toUserId) return reply.status(400).send({ error: 'Thiếu người nhận bàn giao' });
    if (toUserId === fromUserId) return reply.status(400).send({ error: 'Không thể bàn giao cho chính người đó' });

    // Cả 2 user phải cùng org + người nhận đang hoạt động.
    const [fromU, toU] = await Promise.all([
      prisma.user.findFirst({ where: { id: fromUserId, orgId: currentUser.orgId }, select: { id: true, fullName: true } }),
      prisma.user.findFirst({ where: { id: toUserId, orgId: currentUser.orgId }, select: { id: true, fullName: true, isActive: true } }),
    ]);
    if (!fromU) return reply.status(404).send({ error: 'Không tìm thấy nhân viên bàn giao' });
    if (!toU) return reply.status(404).send({ error: 'Không tìm thấy người nhận' });
    if (!toU.isActive) return reply.status(400).send({ error: 'Người nhận đang bị vô hiệu, chọn người khác' });

    const result = await prisma.$transaction(async (tx) => {
      let contacts = 0, nicks = 0, appointments = 0, accesses = 0;
      if (t.contacts) {
        contacts = (await tx.contact.updateMany({
          where: { orgId: currentUser.orgId, assignedUserId: fromUserId },
          data: { assignedUserId: toUserId },
        })).count;
        // ContactAccess: chuyển quyền xem KH (bỏ qua nếu người nhận đã có để tránh đụng unique).
        const existing = await tx.contactAccess.findMany({
          where: { orgId: currentUser.orgId, userId: toUserId },
          select: { contactId: true },
        });
        const have = new Set(existing.map((e) => e.contactId));
        const fromAccess = await tx.contactAccess.findMany({
          where: { orgId: currentUser.orgId, userId: fromUserId },
          select: { id: true, contactId: true },
        });
        const movable = fromAccess.filter((a) => !have.has(a.contactId)).map((a) => a.id);
        if (movable.length > 0) {
          accesses = (await tx.contactAccess.updateMany({
            where: { id: { in: movable } },
            data: { userId: toUserId },
          })).count;
        }
      }
      if (t.nicks) {
        nicks = (await tx.zaloAccount.updateMany({
          where: { orgId: currentUser.orgId, ownerUserId: fromUserId },
          data: { ownerUserId: toUserId },
        })).count;
      }
      if (t.appointments) {
        appointments = (await tx.appointment.updateMany({
          where: { orgId: currentUser.orgId, assignedUserId: fromUserId },
          data: { assignedUserId: toUserId },
        })).count;
      }
      return { contacts, nicks, appointments, accesses };
    });

    logger.info(
      `[handoff] ${currentUser.email} bàn giao ${fromU.fullName}→${toU.fullName}: ` +
      `${result.contacts} KH, ${result.nicks} nick, ${result.appointments} lịch hẹn, ${result.accesses} quyền xem`,
    );
    await writeAudit(currentUser, 'user.handoff', fromUserId, {
      fromName: fromU.fullName, toUserId, toName: toU.fullName, ...result,
    });
    return { success: true, from: fromU.fullName, to: toU.fullName, ...result };
  });

  // POST /api/v1/users/bulk-assign — gán phòng ban / nhóm quyền HÀNG LOẠT (owner/admin).
  // 2026-06-09 (anh chốt FN4): chọn nhiều nhân viên → gán 1 lần, đỡ công onboarding 20-25 sale.
  // Body: { userIds: string[], departmentId?: string|null, permissionGroupId?: string|null }
  app.post('/api/v1/users/bulk-assign', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Chỉ owner/admin thao tác hàng loạt' });
    }
    const body = (request.body ?? {}) as { userIds?: string[]; departmentId?: string | null; permissionGroupId?: string | null };
    const userIds = (body.userIds || []).filter(Boolean);
    if (userIds.length === 0) return reply.status(400).send({ error: 'Chưa chọn nhân viên nào' });
    if (body.departmentId === undefined && body.permissionGroupId === undefined) {
      return reply.status(400).send({ error: 'Chưa chọn phòng ban hoặc nhóm quyền để gán' });
    }

    // Chỉ thao tác user cùng org.
    const valid = await prisma.user.findMany({
      where: { id: { in: userIds }, orgId: currentUser.orgId },
      select: { id: true },
    });
    const validIds = valid.map((v) => v.id);
    if (validIds.length === 0) return reply.status(404).send({ error: 'Không tìm thấy nhân viên hợp lệ' });

    let depCount = 0, grpCount = 0;
    await prisma.$transaction(async (tx) => {
      // Phòng ban: DepartmentMember (1 user ∈ 1 dept — userId @unique). deptRole mặc định 'member'.
      if (body.departmentId !== undefined) {
        for (const uid of validIds) {
          await tx.departmentMember.deleteMany({ where: { userId: uid } });
          if (body.departmentId) {
            await tx.departmentMember.create({
              data: { id: randomUUID(), userId: uid, departmentId: body.departmentId, deptRole: 'member' },
            });
          }
        }
        depCount = validIds.length;
      }
      // Nhóm quyền: field trực tiếp User.permissionGroupId (null = gỡ nhóm).
      if (body.permissionGroupId !== undefined) {
        grpCount = (await tx.user.updateMany({
          where: { id: { in: validIds }, orgId: currentUser.orgId },
          data: { permissionGroupId: body.permissionGroupId },
        })).count;
      }
    });

    await writeAudit(currentUser, 'user.bulk_assign', null, {
      count: validIds.length, departmentId: body.departmentId, permissionGroupId: body.permissionGroupId,
    });
    return { success: true, affected: validIds.length, depCount, grpCount };
  });

  // GET /api/v1/audit-logs — nhật ký hành động admin (owner/admin). 2026-06-09.
  // Đọc từ ActivityLog category='admin'. Hỗ trợ filter ?action= &actorId= &limit= &offset=.
  app.get('/api/v1/audit-logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Chỉ owner/admin xem được nhật ký' });
    }
    const q = request.query as { action?: string; actorId?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const where: any = { orgId: currentUser.orgId, category: 'admin' };
    if (q.action) where.action = q.action;
    if (q.actorId) where.userId = q.actorId;

    const [rows, total] = await Promise.all([
      prisma.activityLog.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
        select: {
          id: true, action: true, entityId: true, details: true, createdAt: true,
          user: { select: { id: true, fullName: true } },
        },
      }),
      prisma.activityLog.count({ where }),
    ]);
    // Gắn tên người bị tác động (entityId = targetUserId) để FE hiển thị dễ hiểu.
    const targetIds = [...new Set(rows.map((r) => r.entityId).filter(Boolean) as string[])];
    const targets = targetIds.length
      ? await prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, fullName: true } })
      : [];
    const targetMap = new Map(targets.map((t) => [t.id, t.fullName]));
    return {
      logs: rows.map((r) => ({
        id: r.id, action: r.action, createdAt: r.createdAt,
        actor: r.user ? { id: r.user.id, name: r.user.fullName } : null,
        target: r.entityId ? { id: r.entityId, name: targetMap.get(r.entityId) ?? '(đã xóa)' } : null,
        details: r.details,
      })),
      total, limit, offset,
    };
  });

  // Phase Privacy v2 2026-05-23 — admin sửa maxPrivacyNicks per user.
  // PATCH /api/v1/users/:id/max-privacy-nicks { maxPrivacyNicks: 1-10 }
  // Permission: org admin/owner only.
  app.patch('/api/v1/users/:id/max-privacy-nicks', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner' && currentUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Chỉ admin/owner sửa được maxPrivacyNicks' });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { maxPrivacyNicks?: number };
    const max = body.maxPrivacyNicks;
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 10) {
      return reply.status(400).send({ error: 'maxPrivacyNicks phải là số nguyên 1-10' });
    }

    const target = await prisma.user.findFirst({
      where: { id, orgId: currentUser.orgId },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'User không tồn tại trong org' });

    await prisma.user.update({
      where: { id },
      data: { maxPrivacyNicks: max },
    });

    return { ok: true, userId: id, maxPrivacyNicks: max };
  });

  // Phase Internal Contact 2-method 2026-05-23 — refactor /me/internal-contact thành multi-method.
  // 2 cách thiết lập: 'crm_nick' (sale chọn nick OWN) | 'personal_phone' (sale nhập SĐT cá nhân).
  // Sau khi setup: handshake friend request 2 chiều + verify code 4 số. Spec đầy đủ:
  // docs/DESIGN-INTERNAL-CONTACT-2METHOD.md
  //
  // GET    /me/internal-contact                      → load current state
  // PATCH  /me/internal-contact                      → initiate handshake (body { method, zaloAccountId? | phone? })
  // POST   /me/internal-contact/check-handshake      → polling check accepted (cách 2)
  // POST   /me/internal-contact/confirm              → sale gõ verify code
  // POST   /me/internal-contact/resend-friend-request
  // POST   /me/internal-contact/resend-verify-code
  // DELETE /me/internal-contact                      → reset setup

  app.get('/api/v1/me/internal-contact', async (request: FastifyRequest) => {
    const currentUser = request.user!;
    const me = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        internalContactMethod: true,
        internalContactZaloAccountId: true,
        internalContactPhone: true,
        internalContactSetupAt: true,
        internalContactConfirmedAt: true,
        maxPrivacyNicks: true,
        internalContactNick: {
          select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, phone: true, status: true },
        },
      },
    });

    // List nick OWN cho sale chọn ở Cách 1
    const ownedNicks = await prisma.zaloAccount.findMany({
      where: { ownerUserId: currentUser.id, orgId: currentUser.orgId },
      select: {
        id: true, displayName: true, avatarUrl: true, zaloUid: true, phone: true, status: true,
        _count: { select: { friends: true } },
      },
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
    });

    // Load recipient (nếu có) để FE biết status handshake
    const org = await prisma.organization.findUnique({
      where: { id: currentUser.orgId },
      select: { systemNotifyZaloAccountId: true, systemNotifyNick: { select: { id: true, displayName: true, status: true, phone: true } } },
    });
    let recipient = null;
    if (org?.systemNotifyZaloAccountId) {
      recipient = await prisma.systemNotifyRecipient.findUnique({
        where: {
          targetUserId_senderZaloAccountId: {
            targetUserId: currentUser.id,
            senderZaloAccountId: org.systemNotifyZaloAccountId,
          },
        },
        select: {
          id: true, status: true, error: true, threadIdInSenderView: true,
          verifyCodeExpiresAt: true, verifyAttempts: true, friendRequestSentAt: true, lastVerifiedAt: true,
        },
      });
    }

    return {
      method: me?.internalContactMethod ?? null,
      internalContactZaloAccountId: me?.internalContactZaloAccountId ?? null,
      internalContactPhone: me?.internalContactPhone ?? null,
      internalContactNick: me?.internalContactNick ?? null,
      setupAt: me?.internalContactSetupAt ?? null,
      confirmedAt: me?.internalContactConfirmedAt ?? null,
      maxPrivacyNicks: me?.maxPrivacyNicks ?? 2,
      ownedNicks: ownedNicks.map((n) => ({
        id: n.id, displayName: n.displayName, avatarUrl: n.avatarUrl, zaloUid: n.zaloUid,
        phone: n.phone, status: n.status, friendCount: n._count.friends,
      })),
      systemSender: org?.systemNotifyNick ?? null,
      recipient,
    };
  });

  // ════════════════════════════════════════════════════════════════════════
  // XÓA 2026-06-10 (CEO-review): cơ chế setup nick nội bộ THỦ CÔNG (PATCH/confirm/
  // resend/DELETE + check-handshake) đã gây bug gửi nhầm UID ("Song Hào"/"Văn Vỹ").
  // User KHÔNG tự setup nick nhận nữa. Nick nhận chỉ đến từ luồng TẠO USER bằng SĐT
  // (UID đúng góc nhìn nick gửi) + Check Live / recheck-all ở trang Thông báo hệ thống.
  // GET /me/internal-contact ở trên GIỮ LẠI (read-only, cho badge onboarding).
  // ════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════
  // Phase Onboarding v1 2026-05-24 — 4-step first-run setup endpoints
  // GET    /me/onboarding             → 4 step status + percent
  // POST   /me/change-password        → force change pw + revoke JWT
  // POST   /me/onboarding/skip-step   → skip PIN step
  // POST   /me/onboarding/dismiss     → ẩn checklist (collapse mini)
  // POST   /me/onboarding/reopen      → mở lại checklist
  // ════════════════════════════════════════════════════════════════════════

  app.get('/api/v1/me/onboarding', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { getOnboardingState, OnboardingError } = await import('./onboarding-service.js');
    try {
      return await getOnboardingState(currentUser.id, currentUser.orgId);
    } catch (err: any) {
      if (err instanceof OnboardingError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.post('/api/v1/me/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) {
      return reply.status(400).send({ error: 'currentPassword + newPassword là bắt buộc' });
    }
    const { changePassword, OnboardingError } = await import('./onboarding-service.js');
    try {
      return await changePassword({
        userId: currentUser.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      });
    } catch (err: any) {
      if (err instanceof OnboardingError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // Module Cá nhân gom "Tài khoản của tôi" 2026-06-13 (CEO review duyệt).
  //   PATCH /me/profile  → sale tự sửa fullName (+ xoá avatar: avatarUrl=null)
  //   POST  /me/avatar   → upload ảnh đại diện (gộp registerAsset + update 1 nhịp)
  // An toàn: cả 2 lấy request.user.id (KHÔNG nhận userId body) → không leo thang quyền.
  //   KHÔNG cho đổi email/phone/role/isActive qua self-service (admin quản qua PUT /users/:id).
  //   avatarUrl qua PATCH chỉ nhận null (xoá) — đặt URL ảnh chỉ qua /me/avatar (server tự
  //   sinh URL) → client không nhét được URL bậy.
  // ════════════════════════════════════════════════════════════════════════
  app.patch('/api/v1/me/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { fullName?: unknown; avatarUrl?: unknown };
    const data: { fullName?: string; avatarUrl?: null } = {};

    if (Object.prototype.hasOwnProperty.call(body, 'fullName')) {
      const name = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      if (name.length < 2 || name.length > 80) {
        return reply.status(400).send({ error: 'Họ tên phải từ 2 đến 80 ký tự' });
      }
      data.fullName = name;
    }
    // avatarUrl: CHỈ chấp nhận null (nút "Xoá ảnh" → về chữ cái). Mọi URL khác bị bỏ qua —
    // đặt ảnh phải đi qua POST /me/avatar (server tự sinh URL).
    if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl') && body.avatarUrl === null) {
      data.avatarUrl = null;
    }

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: 'Không có thay đổi hợp lệ (fullName hoặc avatarUrl:null)' });
    }

    try {
      const updated = await prisma.user.update({
        where: { id: currentUser.id },
        data,
        select: { id: true, fullName: true, avatarUrl: true },
      });
      return updated;
    } catch (err: any) {
      logger.error(`[me/profile] update fail user=${currentUser.id}: ${err?.message}`);
      return reply.status(500).send({ error: 'Không thể cập nhật hồ sơ' });
    }
  });

  app.post('/api/v1/me/avatar', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const MAX = 15 * 1024 * 1024; // khớp IMAGE_MAX của media module
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'avatar') {
          if (!ALLOWED.includes(part.mimetype)) {
            return reply.status(415).send({ error: `Chỉ nhận ảnh jpeg/png/webp/gif (nhận: ${part.mimetype})` });
          }
          const buf = await part.toBuffer();
          if (buf.length > MAX) {
            return reply.status(413).send({ error: 'Ảnh tối đa 15MB' });
          }
          // Gộp: registerAsset (nén webp + dedup + lưu MinIO) → lấy blob.publicUrl → update user.
          // visibility='private' + folder riêng để KHÔNG hiện tab Kho ảnh chung của org.
          const { registerAsset } = await import('../media/media-service.js');
          const res = await registerAsset({
            orgId: currentUser.orgId,
            buffer: buf,
            mimeType: part.mimetype,
            kind: 'image',
            name: `Avatar ${currentUser.email ?? currentUser.id}`,
            originalFilename: part.filename ?? undefined,
            ownerUserId: currentUser.id,
            createdById: currentUser.id,
            visibility: 'private',
            source: 'upload',
          });
          const avatarUrl = res.blob.publicUrl;
          await prisma.user.update({ where: { id: currentUser.id }, data: { avatarUrl } });
          return { avatarUrl };
        }
      }
      return reply.status(400).send({ error: 'Thiếu file ảnh (field "avatar")' });
    } catch (err: any) {
      logger.error(`[me/avatar] upload fail user=${currentUser.id}: ${err?.message}`);
      return reply.status(500).send({ error: 'Không thể tải ảnh lên' });
    }
  });

  app.post('/api/v1/me/onboarding/skip-step', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { step?: string };
    if (!body.step) return reply.status(400).send({ error: 'step là bắt buộc' });
    const { skipStep, OnboardingError } = await import('./onboarding-service.js');
    try {
      return await skipStep({ userId: currentUser.id, step: body.step as any });
    } catch (err: any) {
      if (err instanceof OnboardingError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.post('/api/v1/me/onboarding/dismiss', async (request: FastifyRequest) => {
    const currentUser = request.user!;
    const { dismissOnboarding } = await import('./onboarding-service.js');
    return dismissOnboarding(currentUser.id);
  });

  app.post('/api/v1/me/onboarding/reopen', async (request: FastifyRequest) => {
    const currentUser = request.user!;
    const { reopenOnboarding } = await import('./onboarding-service.js');
    return reopenOnboarding(currentUser.id);
  });
}
