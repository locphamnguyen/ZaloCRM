/**
 * User management routes — CRUD for users within an org.
 * All routes require authentication via authMiddleware.
 * Role-based access: owner > admin > member.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

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

    const { fullName, email, role, teamId, isActive } = request.body as any;

    if (id === currentUser.id && role && role !== currentUser.role) {
      return reply.status(400).send({ error: 'Không thể thay đổi role của chính mình' });
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined && currentUser.role === 'owner') updateData.role = role;
    if (teamId !== undefined) updateData.teamId = teamId || null;
    if (isActive !== undefined && currentUser.role === 'owner') updateData.isActive = isActive;

    const user = await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: updateData,
      select: {
        id: true,
        email: true,
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
    const { password } = request.body as { password: string };
    if (!password || password.length < 6) {
      return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: {
        passwordHash,
        passwordChangedAt: null,            // force user phải đổi lại sau khi login
        jwtTokenVersion: { increment: 1 },  // revoke mọi JWT cũ
      },
    });

    logger.info(`User ${id} password reset by ${currentUser.email} (JWT revoked, onboarding force re-flow)`);
    return { success: true };
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

    return { success: true };
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

  // Phase user-create-with-zalo 2026-05-27 — admin-only mutation: sale không tự sửa nick
  // nhận thông báo nữa (admin sửa thay khi cần). GET vẫn allow để badge + counter chạy.
  const requireAdminForInternalContact = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!['owner', 'admin'].includes(request.user!.role)) {
      reply.status(403).send({
        error: 'Chỉ admin/owner có quyền sửa nick nhận thông báo. Liên hệ admin để cập nhật.',
        code: 'ADMIN_ONLY_INTERNAL_CONTACT',
      });
      return false;
    }
    return true;
  };

  app.patch('/api/v1/me/internal-contact', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdminForInternalContact(request, reply)) return;
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { method?: string; zaloAccountId?: string | null; phone?: string };
    const { initiateCrmNickHandshake, initiatePersonalPhoneHandshake, InternalContactError } =
      await import('../system-notifications/internal-contact-service.js');

    try {
      const fullName = (await prisma.user.findUnique({ where: { id: currentUser.id }, select: { fullName: true } }))?.fullName ?? null;
      if (body.method === 'crm_nick') {
        if (!body.zaloAccountId) return reply.status(400).send({ error: 'zaloAccountId là bắt buộc cho Cách 1' });
        const result = await initiateCrmNickHandshake({
          orgId: currentUser.orgId, userId: currentUser.id, userFullName: fullName, zaloAccountId: body.zaloAccountId,
        });
        return { ok: true, ...result };
      }
      if (body.method === 'personal_phone') {
        if (!body.phone) return reply.status(400).send({ error: 'phone là bắt buộc cho Cách 2' });
        const result = await initiatePersonalPhoneHandshake({
          orgId: currentUser.orgId, userId: currentUser.id, userFullName: fullName, rawPhone: body.phone,
        });
        return { ok: true, ...result };
      }
      return reply.status(400).send({ error: 'method phải là "crm_nick" hoặc "personal_phone"' });
    } catch (err: any) {
      if (err instanceof InternalContactError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      logger.error('[me/internal-contact PATCH] failed:', err);
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.post('/api/v1/me/internal-contact/check-handshake', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdminForInternalContact(request, reply)) return;
    const currentUser = request.user!;
    const { checkHandshakeStatus, InternalContactError } = await import('../system-notifications/internal-contact-service.js');
    try {
      const result = await checkHandshakeStatus({ orgId: currentUser.orgId, userId: currentUser.id });
      return { ok: true, ...result };
    } catch (err: any) {
      if (err instanceof InternalContactError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.post('/api/v1/me/internal-contact/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdminForInternalContact(request, reply)) return;
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { code?: string };
    const { confirmVerifyCode, InternalContactError } = await import('../system-notifications/internal-contact-service.js');
    try {
      const result = await confirmVerifyCode({ orgId: currentUser.orgId, userId: currentUser.id, code: body.code ?? '' });
      return { ok: true, ...result };
    } catch (err: any) {
      if (err instanceof InternalContactError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.post('/api/v1/me/internal-contact/resend-friend-request', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdminForInternalContact(request, reply)) return;
    const currentUser = request.user!;
    const { resendFriendRequest, InternalContactError } = await import('../system-notifications/internal-contact-service.js');
    try {
      const result = await resendFriendRequest({ orgId: currentUser.orgId, userId: currentUser.id });
      return { ok: true, ...result };
    } catch (err: any) {
      if (err instanceof InternalContactError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.post('/api/v1/me/internal-contact/resend-verify-code', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdminForInternalContact(request, reply)) return;
    const currentUser = request.user!;
    const { resendVerifyCode, InternalContactError } = await import('../system-notifications/internal-contact-service.js');
    try {
      const result = await resendVerifyCode({ orgId: currentUser.orgId, userId: currentUser.id });
      return { ok: true, ...result };
    } catch (err: any) {
      if (err instanceof InternalContactError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

  app.delete('/api/v1/me/internal-contact', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdminForInternalContact(request, reply)) return;
    const currentUser = request.user!;
    const { resetInternalContact, InternalContactError } = await import('../system-notifications/internal-contact-service.js');
    try {
      await resetInternalContact({ orgId: currentUser.orgId, userId: currentUser.id });
      return { ok: true };
    } catch (err: any) {
      if (err instanceof InternalContactError) {
        return reply.status(err.statusCode).send({ error: err.message, code: err.errorCode });
      }
      return reply.status(500).send({ error: err?.message || 'Internal error' });
    }
  });

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
