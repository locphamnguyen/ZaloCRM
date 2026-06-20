// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * status-log-service.ts — Phase ZaloAccounts redesign 2026-05-22
 *
 * Hybrid uptime tracking: ghi MỖI lần status đổi (event-driven) + cron 5p checkpoint
 * reconcile orphan open records sau crash.
 *
 * Invariant: ĐÚNG 1 record có endedAt=NULL per account ở mọi thời điểm.
 * Enforced bởi partial unique index `zalo_account_status_log_one_open_per_account_idx`.
 *
 * Xem design doc: ~/.gstack/projects/zalocrm/EVO-THANH-private-hs-design-20260522-184345.md
 */
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export type ZaloStatus = 'connected' | 'disconnected' | 'auth_failed' | 'qr_pending' | 'expired';
export type StatusReason =
  | 'login' | 'qr_scan' | 'reconnect_ok' | 'reconnect_failed'
  | 'disconnect' | 'auth_fail' | 'session_expired'
  | 'crash_recovery' | 'checkpoint' | 'manual';

/**
 * Ghi transition status mới cho 1 nick.
 *
 * Logic:
 *   1. Find current open record (endedAt IS NULL).
 *   2. Nếu status MỚI === status CŨ → no-op (idempotent, tránh log spam).
 *   3. Nếu khác → transaction: UPDATE old.endedAt=NOW + INSERT new (endedAt=NULL).
 *   4. Nếu KHÔNG có open record (nick mới hoặc backfill chưa chạy) → chỉ INSERT.
 *
 * Race protection: partial unique index `(account_id) WHERE ended_at IS NULL` đảm bảo
 * 2 writes concurrent không thể tạo 2 open records — 1 sẽ fail transaction.
 */
export async function writeTransition(input: {
  accountId: string;
  orgId: string;
  status: ZaloStatus;
  reason: StatusReason;
  at?: Date; // override timestamp (vd cho backfill historical events)
}): Promise<void> {
  const now = input.at ?? new Date();

  try {
    await tenantTransaction(async (tx) => {
      const open = await tx.zaloAccountStatusLog.findFirst({
        where: { accountId: input.accountId, endedAt: null },
        select: { id: true, status: true, startedAt: true },
      });

      // Idempotent: cùng status → bỏ qua (tránh log spam khi event fire trùng lặp).
      if (open && open.status === input.status) return;

      if (open) {
        // Close old record. Defensive: endedAt phải >= startedAt (clamp nếu clock drift).
        const endedAt = now < open.startedAt ? open.startedAt : now;
        await tx.zaloAccountStatusLog.update({
          where: { id: open.id },
          data: { endedAt },
        });
      }

      await tx.zaloAccountStatusLog.create({
        data: {
          orgId: input.orgId,
          accountId: input.accountId,
          status: input.status,
          startedAt: now,
          endedAt: null,
          reason: input.reason,
        },
      });
    });
  } catch (err) {
    // Partial unique violation = race condition. Log warn nhưng không throw —
    // caller (zaloPool emit) không nên fail vì status log lỗi.
    logger.warn(
      `[status-log] writeTransition failed accountId=${input.accountId} status=${input.status}: ${String(err)}`,
    );
  }
}

/**
 * Tính uptime % trong window N ngày qua cho 1 nick.
 *
 * Algorithm:
 *   - Query mọi records có overlap window: endedAt > since OR endedAt IS NULL.
 *   - Với mỗi record status='connected', clamp [startedAt, endedAt ?? now] vào [since, now].
 *   - SUM(connected duration) / window total × 100.
 *
 * Edge cases:
 *   - Nick mới (chưa có log): trả 0%.
 *   - Window vượt quá log range (vd query 7d nhưng nick mới add 2d): tính trên (now - createdAt)
 *     thay vì 7d full → tránh artificially low %.
 */
export async function uptimeWindow(
  accountId: string,
  sinceDays: number,
): Promise<{ uptimePct: number; effectiveWindowMs: number }> {
  const now = Date.now();
  const since = new Date(now - sinceDays * 86400_000);

  const logs = await prisma.zaloAccountStatusLog.findMany({
    where: {
      accountId,
      OR: [
        { endedAt: null },
        { endedAt: { gt: since } },
      ],
    },
    select: { status: true, startedAt: true, endedAt: true },
    orderBy: { startedAt: 'asc' },
  });

  if (logs.length === 0) {
    return { uptimePct: 0, effectiveWindowMs: 0 };
  }

  // Effective window = từ max(since, earliest log start) đến now.
  // Tránh nick mới add 2 ngày bị tính out of 7d → 28% sai lạc.
  const earliestStart = logs[0].startedAt.getTime();
  const effectiveStart = Math.max(since.getTime(), earliestStart);
  const effectiveWindowMs = Math.max(0, now - effectiveStart);

  if (effectiveWindowMs === 0) return { uptimePct: 0, effectiveWindowMs: 0 };

  let connectedMs = 0;
  for (const r of logs) {
    if (r.status !== 'connected') continue;
    const start = Math.max(r.startedAt.getTime(), effectiveStart);
    const end = (r.endedAt ?? new Date()).getTime();
    if (end <= start) continue;
    connectedMs += Math.min(end, now) - start;
  }

  const uptimePct = (connectedMs / effectiveWindowMs) * 100;
  return { uptimePct: Number(uptimePct.toFixed(1)), effectiveWindowMs };
}

/**
 * Batch uptime cho nhiều nicks — dùng cho team KPI stats endpoint.
 * Tránh N+1: query 1 lần, group in-memory.
 */
export async function uptimeWindowBatch(
  accountIds: string[],
  sinceDays: number,
): Promise<Map<string, { uptimePct: number; effectiveWindowMs: number }>> {
  const result = new Map<string, { uptimePct: number; effectiveWindowMs: number }>();
  if (accountIds.length === 0) return result;

  const now = Date.now();
  const since = new Date(now - sinceDays * 86400_000);

  const logs = await prisma.zaloAccountStatusLog.findMany({
    where: {
      accountId: { in: accountIds },
      OR: [{ endedAt: null }, { endedAt: { gt: since } }],
    },
    select: { accountId: true, status: true, startedAt: true, endedAt: true },
    orderBy: { startedAt: 'asc' },
  });

  // Group logs by accountId
  const byAccount = new Map<string, typeof logs>();
  for (const r of logs) {
    const arr = byAccount.get(r.accountId) ?? [];
    arr.push(r);
    byAccount.set(r.accountId, arr);
  }

  for (const accountId of accountIds) {
    const accountLogs = byAccount.get(accountId) ?? [];
    if (accountLogs.length === 0) {
      result.set(accountId, { uptimePct: 0, effectiveWindowMs: 0 });
      continue;
    }
    const earliestStart = accountLogs[0].startedAt.getTime();
    const effectiveStart = Math.max(since.getTime(), earliestStart);
    const effectiveWindowMs = Math.max(0, now - effectiveStart);
    if (effectiveWindowMs === 0) {
      result.set(accountId, { uptimePct: 0, effectiveWindowMs: 0 });
      continue;
    }
    let connectedMs = 0;
    for (const r of accountLogs) {
      if (r.status !== 'connected') continue;
      const start = Math.max(r.startedAt.getTime(), effectiveStart);
      const end = (r.endedAt ?? new Date()).getTime();
      if (end <= start) continue;
      connectedMs += Math.min(end, now) - start;
    }
    const uptimePct = (connectedMs / effectiveWindowMs) * 100;
    result.set(accountId, {
      uptimePct: Number(uptimePct.toFixed(1)),
      effectiveWindowMs,
    });
  }

  return result;
}
