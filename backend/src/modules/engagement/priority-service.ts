// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * priority-service.ts — Phase 8.C "Priority Score" combined metric.
 *
 * Triết lý: sale BĐS không cần đọc 2 score riêng biệt (Lead + Engagement). Họ
 * cần 1 con số "ưu tiên gọi ai hôm nay". Priority = weighted combo của:
 *   - Lead Score 55%  (ý định mua — keyword + behavior signals từ Phase 6)
 *   - Engagement Score 30% (hành vi 28 ngày qua — Phase 8.1)
 *   - Engagement Trend boost (đang nóng lên → +10; nguội nhanh → -5)
 *
 * Vì sao weight Lead > Engagement: KH có ý mua (Lead 80) đáng ưu tiên hơn KH
 * chat nhiều nhưng không định mua (Lead 20, Engagement 80 = bạn personal).
 *
 * Recompute trigger:
 *   - Real-time: hook trong score-engine khi leadScore update + trong
 *     engagement-service khi engagementScore update
 *   - Daily cron: sau engagement classification cron (02:35 VN), tránh
 *     race với engagement compute
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface PriorityInputs {
  leadScore: number;
  engagementScore: number | null;
  engagementTrend: number | null;
}

/**
 * Pure compute — no DB, no side effects. Returns 0-100 clamped integer.
 *
 * Formula breakdown (visible to user via UI tooltip):
 *   base       = leadScore × 0.55 + engagementScore × 0.30
 *   trendBoost = trend ≥ +20 ? +10 : (trend ≤ -20 ? -5 : 0)
 *   final      = round(clamp(base + trendBoost, 0, 100))
 *
 * Edge cases:
 *   - engagementScore null → treat as 0 (KH mới, chưa đủ data)
 *   - engagementTrend null → trendBoost = 0
 */
export function computePriorityScore(inputs: PriorityInputs): number {
  const lead = Number.isFinite(inputs.leadScore) ? inputs.leadScore : 0;
  const eng = Number.isFinite(inputs.engagementScore as number) ? (inputs.engagementScore as number) : 0;
  const trend = Number.isFinite(inputs.engagementTrend as number) ? (inputs.engagementTrend as number) : 0;

  const base = lead * 0.55 + eng * 0.30;
  let trendBoost = 0;
  if (trend >= 20) trendBoost = 10;
  else if (trend <= -20) trendBoost = -5;

  const final = Math.round(Math.max(0, Math.min(100, base + trendBoost)));
  return final;
}

/**
 * Recompute priority for 1 Contact + persist. Called from hooks + cron.
 *
 * Reads current leadScore + engagementScore from Contact row. Returns the
 * computed priority for callers that want to log delta or emit socket.
 */
export async function recomputeContactPriority(contactId: string): Promise<number | null> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        leadScore: true,
        engagementScore: true,
        engagementTrend: true,
        priorityScore: true,
      },
    });
    if (!contact) return null;

    const priority = computePriorityScore({
      leadScore: contact.leadScore,
      engagementScore: contact.engagementScore,
      engagementTrend: contact.engagementTrend,
    });

    // Skip write if unchanged (saves index churn on large orgs)
    if (priority === contact.priorityScore) return priority;

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        priorityScore: priority,
        priorityUpdatedAt: new Date(),
      },
    });
    return priority;
  } catch (err) {
    logger.warn('[priority-service] recompute failed', {
      contactId,
      err: (err as Error).message,
    });
    return null;
  }
}

/**
 * Bulk recompute for all contacts in org (cron + admin endpoint).
 */
export async function recomputeAllPriorities(orgId: string): Promise<{ updated: number; total: number }> {
  const contacts = await prisma.contact.findMany({
    where: { orgId },
    select: { id: true },
  });
  let updated = 0;
  for (const c of contacts) {
    const result = await recomputeContactPriority(c.id);
    if (result !== null) updated++;
  }
  return { updated, total: contacts.length };
}
