// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M2b — Worker guards (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// 5 constraints check trước khi dispatch Zalo SDK (T4A retry policy section 28):
//   1. Hour window check (trigger.sendHourStart / sendHourEnd, Asia/Ho_Chi_Minh)
//   2. Per-nick gap throttle (Redis nick:lastSent:{nickId}:friend)
//   3. Daily quota Lua atomic (zaloAccount.dailyFriendAddCap)
//   4. Cross-nick recency (trigger.recencySkipDays, FriendshipAttempt query)
//   5. Multi-nick threshold (trigger.multiNickThreshold + Privacy v2 JOIN
//      permission_groups per T3A)
//
// Pipeline order (Issue #4 4A — INCR quota SAU send):
//   pause → hour → gap → peek quota → recency → multi-nick → send → INCR quota
//
// Memory:
//   - reference_zalocrm_rate_limits: 300 msg/day, 30-50 friend-add/day per nick
//   - feedback_zalocrm_per_nick_throttle_gate: lastFriendReqSentAt per nick
//   - project_zalocrm_cross_nick_friendship_recency: skip KH tương tác nick khác <X
//   - project_zalocrm_rbac_decisions: T3A JOIN permission_groups scope dept

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from './redis-connection.js';
import { incrQuotaAtomic, peekQuota } from './quota-lua.js';

export interface TriggerGuardConfig {
  triggerId: string;
  sendHourStart: number;
  sendHourEnd: number;
  recencySkipDays: number;
  multiNickThreshold: number;
  minFriendReqGapMs: number;
  triggerOwnerUserId: string;
  orgId: string;
}

export interface GuardResult {
  passed: boolean;
  reason?: string;
  deferUntilMs?: number; // milliseconds delay nếu cần moveToDelayed
}

// ════════════════════════════════════════════════════════════════════════
// GUARD 1: Hour window check (Asia/Ho_Chi_Minh)
// ════════════════════════════════════════════════════════════════════════
export function getVNHour(now = new Date()): number {
  return (now.getUTCHours() + 7) % 24;
}

export function checkHourWindow(
  cfg: Pick<TriggerGuardConfig, 'sendHourStart' | 'sendHourEnd'>,
): GuardResult {
  const vnHour = getVNHour();
  // FIX 2026-06-08 (Anh chốt): `<` → `<=` (inclusive end). Trước đây 22:0x (vnHour=22)
  // với sendHourEnd=22 bị `22 < 22`=false → coi NGOÀI GIỜ → hoãn cả chuỗi tới 6h sáng mai
  // → KH vào chuỗi lúc 22:0x đứng yên 8 tiếng. Các gate khác (gate-evaluator:31,
  // nick-worker:177, welcome-probe:74) ĐÃ dùng <= từ 2026-05-30; chỉ chỗ này còn lệch.
  // Giờ gửi hết cả giờ 22 (tới 22:59) khớp ý "send_hour_end=22 = gửi tới hết 22h".
  if (vnHour >= cfg.sendHourStart && vnHour <= cfg.sendHourEnd) {
    return { passed: true };
  }

  // Defer đến sendHourStart ngày hôm nay (nếu chưa qua) hoặc ngày mai.
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 3600_000);
  let resumeUtc = new Date(now);
  if (vnHour < cfg.sendHourStart) {
    // Cùng ngày, set giờ về sendHourStart
    const vnResume = new Date(vnNow);
    vnResume.setUTCHours(cfg.sendHourStart, 0, 0, 0);
    resumeUtc = new Date(vnResume.getTime() - 7 * 3600_000);
  } else {
    // Quá sendHourEnd → mai 00:00 + sendHourStart
    const vnResume = new Date(vnNow);
    vnResume.setUTCDate(vnResume.getUTCDate() + 1);
    vnResume.setUTCHours(cfg.sendHourStart, 0, 0, 0);
    resumeUtc = new Date(vnResume.getTime() - 7 * 3600_000);
  }
  return {
    passed: false,
    reason: `outside_hour_window (VN ${vnHour}h, allowed ${cfg.sendHourStart}-${cfg.sendHourEnd})`,
    deferUntilMs: resumeUtc.getTime(),
  };
}

// ════════════════════════════════════════════════════════════════════════
// GUARD 2: Per-nick gap throttle
// ════════════════════════════════════════════════════════════════════════
export async function checkNickGap(
  nickId: string,
  minGapMs: number,
): Promise<GuardResult> {
  if (minGapMs <= 0) return { passed: true };

  const redis = getBullMQRedis();
  const key = `nick:lastFriendReqAt:${nickId}`;
  const lastSentRaw = await redis.get(key);
  if (!lastSentRaw) return { passed: true };

  const lastSent = parseInt(lastSentRaw, 10);
  const elapsed = Date.now() - lastSent;
  if (elapsed >= minGapMs) return { passed: true };

  const remaining = minGapMs - elapsed;
  return {
    passed: false,
    reason: `nick_gap (${remaining}ms remaining)`,
    deferUntilMs: Date.now() + remaining,
  };
}

export async function recordNickSend(nickId: string): Promise<void> {
  const redis = getBullMQRedis();
  const key = `nick:lastFriendReqAt:${nickId}`;
  await redis.set(key, Date.now().toString(), 'EX', 86400);
}

// ════════════════════════════════════════════════════════════════════════
// GUARD 3: Daily quota peek (pre-check, INCR sau send)
// ════════════════════════════════════════════════════════════════════════
export async function checkDailyQuotaPeek(
  nickId: string,
  cap: number,
): Promise<GuardResult> {
  if (cap <= 0) return { passed: true };
  const { capped, remaining } = await peekQuota(nickId, 'friend', cap);
  if (capped) {
    // Defer đến 00:00 VN mai
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 3600_000);
    const vnMidnight = new Date(vnNow);
    vnMidnight.setUTCDate(vnMidnight.getUTCDate() + 1);
    vnMidnight.setUTCHours(0, 0, 0, 0);
    const utcResume = new Date(vnMidnight.getTime() - 7 * 3600_000);
    return {
      passed: false,
      reason: `quota_capped (${cap}/day reached)`,
      deferUntilMs: utcResume.getTime(),
    };
  }
  return { passed: true, reason: `quota_ok (${remaining} remaining)` };
}

// INCR sau send Zalo OK
export async function consumeQuotaAfterSend(
  nickId: string,
  cap: number,
): Promise<boolean> {
  return incrQuotaAtomic(nickId, 'friend', cap);
}

// ════════════════════════════════════════════════════════════════════════
// GUARD 4: Cross-nick recency
// ════════════════════════════════════════════════════════════════════════
export async function checkCrossNickRecency(
  contactId: string,
  recencyDays: number,
): Promise<GuardResult> {
  if (recencyDays <= 0) return { passed: true };

  const since = new Date(Date.now() - recencyDays * 24 * 3600_000);
  // FriendshipAttempt.sentAt = thời điểm gửi friend-request (null nếu chưa gửi).
  // Recency = "đã gửi tin nhắn hay friend request trong N ngày" → check sentAt.
  const recentAttempt = await prisma.friendshipAttempt.findFirst({
    where: {
      contactId,
      sentAt: { gte: since },
    },
    select: { id: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
  });

  if (recentAttempt && recentAttempt.sentAt) {
    return {
      passed: false,
      reason: `cross_nick_recency (last attempt ${recentAttempt.sentAt.toISOString()})`,
    };
  }
  return { passed: true };
}

// ════════════════════════════════════════════════════════════════════════
// GUARD 5: Multi-nick threshold (T3A Privacy v2 JOIN permission_groups)
// ════════════════════════════════════════════════════════════════════════
export async function checkMultiNickThreshold(
  contactId: string,
  cfg: Pick<TriggerGuardConfig, 'multiNickThreshold' | 'triggerOwnerUserId' | 'orgId'>,
): Promise<GuardResult> {
  if (cfg.multiNickThreshold <= 0) return { passed: true };

  // T3A code mẫu (section 27 design doc) — schema thật ZaloCRM:
  // User KHÔNG có `department` direct relation. Qua `DepartmentMember`:
  //   User → DepartmentMember.userId → Department.id
  // ZaloAccount.ownerUserId direct FK.
  const owner = await prisma.user.findUnique({
    where: { id: cfg.triggerOwnerUserId },
    select: {
      role: true,
      departmentMember: {
        select: {
          departmentId: true,
          department: {
            select: {
              id: true,
              // Recursive children dept (cascade). Schema có self-relation Department.children.
              children: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  let allowedNickIds: string[] | null = null;
  const isLowRole = owner?.role === 'member' || owner?.role === 'sale' || owner?.role === 'manager';

  if (owner && isLowRole) {
    const deptIds: string[] = [];
    const dept = owner.departmentMember?.department;
    if (dept) {
      deptIds.push(dept.id);
      for (const child of dept.children ?? []) {
        deptIds.push(child.id);
      }
    }

    if (deptIds.length === 0) {
      // Sale chưa thuộc dept → đếm chỉ nick mình sở hữu
      const ownedNicks = await prisma.zaloAccount.findMany({
        where: { orgId: cfg.orgId, ownerUserId: cfg.triggerOwnerUserId },
        select: { id: true },
      });
      allowedNickIds = ownedNicks.map((n) => n.id);
    } else {
      // Lấy nick của tất cả user trong dept tree
      const usersInDept = await prisma.departmentMember.findMany({
        where: { departmentId: { in: deptIds } },
        select: { userId: true },
      });
      const userIds = usersInDept.map((m) => m.userId);
      if (userIds.length > 0) {
        const scopedNicks = await prisma.zaloAccount.findMany({
          where: { orgId: cfg.orgId, ownerUserId: { in: userIds } },
          select: { id: true },
        });
        allowedNickIds = scopedNicks.map((n) => n.id);
      } else {
        allowedNickIds = [];
      }
    }
  }
  // Owner/Admin: allowedNickIds = null → count toàn org

  const friendCount = await prisma.friend.count({
    where: {
      contactId,
      friendshipStatus: 'accepted',
      orgId: cfg.orgId,
      ...(allowedNickIds !== null && { zaloAccountId: { in: allowedNickIds } }),
    },
  });

  if (friendCount >= cfg.multiNickThreshold) {
    return {
      passed: false,
      reason: `multi_nick (${friendCount} >= threshold ${cfg.multiNickThreshold})`,
    };
  }
  return { passed: true };
}

// ════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR: run all guards in pipeline order
// ════════════════════════════════════════════════════════════════════════
export async function runAllGuards(input: {
  contactId: string;
  nickId: string;
  triggerCfg: TriggerGuardConfig;
  nickCap: number; // dailyFriendAddCap từ ZaloAccount
}): Promise<GuardResult> {
  const { contactId, nickId, triggerCfg, nickCap } = input;
  const guards: Array<{ name: string; run: () => Promise<GuardResult> | GuardResult }> = [
    { name: 'hour_window', run: () => checkHourWindow(triggerCfg) },
    { name: 'nick_gap', run: () => checkNickGap(nickId, triggerCfg.minFriendReqGapMs) },
    { name: 'quota_peek', run: () => checkDailyQuotaPeek(nickId, nickCap) },
    { name: 'recency', run: () => checkCrossNickRecency(contactId, triggerCfg.recencySkipDays) },
    {
      name: 'multi_nick',
      run: () => checkMultiNickThreshold(contactId, triggerCfg),
    },
  ];

  for (const g of guards) {
    const result = await g.run();
    if (!result.passed) {
      logger.info(
        `[guard:${g.name}] DENY contact=${contactId} nick=${nickId} reason=${result.reason}`,
      );
      return result;
    }
  }
  return { passed: true };
}
