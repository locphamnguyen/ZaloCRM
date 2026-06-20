// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * onboarding-service.ts — Phase Onboarding v1 2026-05-24.
 *
 * Track 4-step setup cho sale mới: change_password / connect_nick / internal_contact / pin.
 * Mỗi step auto-detect từ DB state, không cần sale tự bấm "đã xong".
 *
 * Spec đầy đủ: docs/DESIGN-ONBOARDING-V1.md
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

// 2026-06-09 (Anh chốt): gỡ 'internal_contact' khỏi onboarding. User giờ tạo bằng SĐT
// đã verify có Zalo 100% (wizard create-with-zalo điền sẵn recipient) → không cần bắt sale
// tự thiết lập kênh nhận thông báo nữa. Còn 3 bước: đổi mk / kết nối nick / PIN.
export type OnboardingStep = 'change_password' | 'connect_nick' | 'pin';

interface StepStatus {
  step: OnboardingStep;
  completed: boolean;
  completedAt: string | null;
  skipped: boolean;
  detail?: string;
}

interface OnboardingState {
  steps: StepStatus[];
  completedCount: number;
  totalCount: number;
  percent: number;
  dismissed: boolean;
  dismissedAt: string | null;
  canDismiss: boolean; // true nếu đã xong ≥ 3 step
}

const PASSWORD_STRENGTH_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export class OnboardingError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
  }
}

/**
 * Detect 4 step completion từ DB state. Single query optimized.
 */
export async function getOnboardingState(userId: string, orgId: string): Promise<OnboardingState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordChangedAt: true,
      onboardingStepsCompleted: true,
      onboardingDismissedAt: true,
      privacyPinHash: true,
    },
  });
  if (!user) {
    throw new OnboardingError(404, 'user_not_found', 'User không tồn tại');
  }

  const stepsJson = (user.onboardingStepsCompleted as Record<string, string> | null) ?? {};

  // Step 1: change_password
  const changePasswordDone = user.passwordChangedAt !== null;

  // Step 2: connect_nick — ≥ 1 nick OWN với status='connected'
  const connectedNickCount = await prisma.zaloAccount.count({
    where: { ownerUserId: userId, orgId, status: 'connected' },
  });
  const connectNickDone = connectedNickCount >= 1;

  // 2026-06-09: bước internal_contact đã gỡ — bỏ luôn query org + recipient (không còn dùng).

  // Step 3: pin — đã đặt PIN hoặc sale chủ động skip
  const pinSkipped = stepsJson.pin === 'skipped';
  const pinDone = user.privacyPinHash !== null || pinSkipped;

  const steps: StepStatus[] = [
    {
      step: 'change_password',
      completed: changePasswordDone,
      completedAt: user.passwordChangedAt?.toISOString() ?? null,
      skipped: false,
      detail: changePasswordDone ? 'Mật khẩu đã được đổi an toàn' : 'Bắt buộc đổi password admin giao',
    },
    {
      step: 'connect_nick',
      completed: connectNickDone,
      completedAt: stepsJson.connect_nick ?? null,
      skipped: false,
      detail: connectNickDone ? `${connectedNickCount} nick đã kết nối` : 'Quét QR đăng nhập nick Zalo vào CRM',
    },
    {
      step: 'pin',
      completed: pinDone,
      completedAt: pinSkipped ? null : (user.privacyPinHash ? (stepsJson.pin ?? null) : null),
      skipped: pinSkipped,
      detail: pinSkipped
        ? 'Bạn đã bỏ qua bước này'
        : (user.privacyPinHash ? 'Đã đặt PIN bảo mật' : 'Tuỳ chọn — bảo mật nick cá nhân'),
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const percent = Math.round((completedCount / steps.length) * 100);

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    percent,
    dismissed: user.onboardingDismissedAt !== null,
    dismissedAt: user.onboardingDismissedAt?.toISOString() ?? null,
    // Còn 3 bước (PIN optional) → cho dismiss khi xong ≥ 2 bước bắt buộc (đổi mk + kết nối nick).
    canDismiss: completedCount >= 2,
  };
}

/**
 * Force change password (lần đầu hoặc admin reset).
 * - Validate strength: 8+ ký tự, có chữ hoa + thường + số
 * - Reject nếu newPassword === currentPassword
 * - Bump jwtTokenVersion → revoke JWT cũ → force relogin
 */
export async function changePassword(args: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  if (!PASSWORD_STRENGTH_REGEX.test(args.newPassword)) {
    throw new OnboardingError(400, 'weak_password', 'Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số');
  }
  if (args.currentPassword === args.newPassword) {
    throw new OnboardingError(400, 'same_password', 'Mật khẩu mới phải khác mật khẩu cũ');
  }

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, passwordHash: true, jwtTokenVersion: true, onboardingStepsCompleted: true },
  });
  if (!user) {
    throw new OnboardingError(404, 'user_not_found', 'User không tồn tại');
  }

  const valid = await bcrypt.compare(args.currentPassword, user.passwordHash);
  if (!valid) {
    throw new OnboardingError(401, 'wrong_current_password', 'Mật khẩu hiện tại không đúng');
  }

  const newHash = await bcrypt.hash(args.newPassword, 12);
  const now = new Date();

  // Update steps JSON với change_password = now
  const stepsJson = (user.onboardingStepsCompleted as Record<string, string> | null) ?? {};
  stepsJson.change_password = now.toISOString();

  await prisma.user.update({
    where: { id: args.userId },
    data: {
      passwordHash: newHash,
      passwordChangedAt: now,
      jwtTokenVersion: { increment: 1 },
      onboardingStepsCompleted: stepsJson as object,
    },
  });

  logger.info(`[onboarding] user=${args.userId} changed password, jwt revoked`);
  return { ok: true, requireRelogin: true };
}

/**
 * Sale chủ động skip 1 step (chỉ PIN được skip).
 */
export async function skipStep(args: { userId: string; step: OnboardingStep }) {
  if (args.step !== 'pin') {
    throw new OnboardingError(400, 'cannot_skip', `Bước "${args.step}" không cho phép bỏ qua`);
  }
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { onboardingStepsCompleted: true },
  });
  if (!user) throw new OnboardingError(404, 'user_not_found', 'User không tồn tại');

  const stepsJson = (user.onboardingStepsCompleted as Record<string, string> | null) ?? {};
  stepsJson[args.step] = 'skipped';

  await prisma.user.update({
    where: { id: args.userId },
    data: { onboardingStepsCompleted: stepsJson as object },
  });
  return { ok: true };
}

/**
 * Sale ẩn checklist (collapse thành mini indicator).
 */
export async function dismissOnboarding(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingDismissedAt: new Date() },
  });
  return { ok: true };
}

/**
 * Re-expand checklist (sale bấm mini indicator).
 */
export async function reopenOnboarding(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingDismissedAt: null },
  });
  return { ok: true };
}

export interface OnboardingSummary {
  userId: string;
  completedCount: number;
  totalCount: number;
  percent: number;
  pendingSteps: OnboardingStep[];   // các step CHƯA done (loại pin nếu skipped)
  changePassword: boolean;
  connectNick: boolean;
  pin: boolean;                     // true nếu đặt PIN hoặc đã skip
  pinSkipped: boolean;
  dismissed: boolean;
}

/**
 * Bulk summary cho RBAC users list — 4 query thay vì N×4.
 * Dùng cho admin xem cột "Onboarding %" của toàn org.
 */
export async function getOnboardingSummariesForOrg(orgId: string): Promise<Record<string, OnboardingSummary>> {
  const users = await prisma.user.findMany({
    where: { orgId },
    select: {
      id: true,
      passwordChangedAt: true,
      onboardingStepsCompleted: true,
      onboardingDismissedAt: true,
      privacyPinHash: true,
    },
  });
  if (users.length === 0) return {};

  const userIds = users.map((u) => u.id);

  // Step 2: connect_nick — group COUNT nick connected per owner
  const nickCounts = await prisma.zaloAccount.groupBy({
    by: ['ownerUserId'],
    where: { orgId, status: 'connected', ownerUserId: { in: userIds } },
    _count: { _all: true },
  });
  const nickCountByUser = new Map<string, number>();
  for (const row of nickCounts) {
    if (row.ownerUserId) nickCountByUser.set(row.ownerUserId, row._count._all);
  }

  // 2026-06-09: bước internal_contact đã gỡ — không còn query recipient ở đây nữa.

  const result: Record<string, OnboardingSummary> = {};
  for (const u of users) {
    const stepsJson = (u.onboardingStepsCompleted as Record<string, string> | null) ?? {};
    const changePassword = u.passwordChangedAt !== null;
    const connectNick = (nickCountByUser.get(u.id) ?? 0) >= 1;
    const pinSkipped = stepsJson.pin === 'skipped';
    const pin = u.privacyPinHash !== null || pinSkipped;

    const flags = [changePassword, connectNick, pin];
    const completedCount = flags.filter(Boolean).length;
    const totalCount = 3;

    const pendingSteps: OnboardingStep[] = [];
    if (!changePassword) pendingSteps.push('change_password');
    if (!connectNick) pendingSteps.push('connect_nick');
    if (!pin) pendingSteps.push('pin');

    result[u.id] = {
      userId: u.id,
      completedCount,
      totalCount,
      percent: Math.round((completedCount / totalCount) * 100),
      pendingSteps,
      changePassword,
      connectNick,
      pin,
      pinSkipped,
      dismissed: u.onboardingDismissedAt !== null,
    };
  }
  return result;
}
