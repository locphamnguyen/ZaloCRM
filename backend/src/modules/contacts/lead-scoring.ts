// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * lead-scoring.ts — Computes lead scores for contacts.
 * Score factors: recent messages, scheduled appointments, status, last activity.
 *
 * Auto-tagging đã chuyển sang Phase 6+ tại `scoring/auto-tag.ts` (Friend-level).
 * Legacy `applyAutoTags` (Phase 5) đã deprecated — script này CHỈ compute score.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { emitLeadScoreThresholdIfCrossed } from '../../shared/ee-registry/automation.js';
import { withTenant, runSystemQuery } from '../../shared/tenant/tenant-context.js';

export async function computeLeadScore(contactId: string): Promise<number> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Count messages in last 7 days via conversations linked to contact
  const conversations = await prisma.conversation.findMany({
    where: { contactId },
    select: { id: true },
  });
  const convIds = conversations.map((c) => c.id);

  const recentMessages = convIds.length
    ? await prisma.message.count({
        where: { conversationId: { in: convIds }, sentAt: { gte: sevenDaysAgo } },
      })
    : 0;

  // Check for upcoming scheduled appointment
  const futureAppointment = await prisma.appointment.findFirst({
    where: { contactId, status: 'scheduled', appointmentDate: { gte: now } },
    select: { appointmentDate: true },
  });

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { status: true, updatedAt: true },
  });

  // Latest message sentAt
  const latestMsg = convIds.length
    ? await prisma.message.findFirst({
        where: { conversationId: { in: convIds } },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      })
    : null;

  // Compute lastActivity = max of: latest message, latest appointment, updatedAt
  const candidates: Date[] = [contact?.updatedAt ?? now];
  if (latestMsg) candidates.push(latestMsg.sentAt);
  if (futureAppointment) candidates.push(futureAppointment.appointmentDate);
  const lastActivity = new Date(Math.max(...candidates.map((d) => d.getTime())));

  let score = 0;

  // +10 per message in 7d, cap at +40
  score += Math.min(recentMessages * 10, 40);

  // +20 if future scheduled appointment
  if (futureAppointment) score += 20;

  // +30 if status = 'interested'
  if (contact?.status === 'interested') score += 30;

  // Recency penalty
  const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceActivity > 30) score -= 20;
  else if (daysSinceActivity > 14) score -= 10;

  // Clamp 0..100
  return Math.max(0, Math.min(100, score));
}

export async function computeAllLeadScores(): Promise<void> {
  // Cross-org scan (mọi org) → bypass RLS để liệt kê; xử lý từng contact trong tenant của nó.
  const contacts = await runSystemQuery(() =>
    prisma.contact.findMany({
      where: { mergedInto: null },
      select: { id: true, orgId: true, updatedAt: true, leadScore: true },
    }),
  );

  let updated = 0;
  const now = new Date();

  // Phase 1a RLS (Giai đoạn 0.2): mỗi contact chạy trong tenant context của org nó.
  for (const contact of contacts) await withTenant(contact.orgId, async () => {
    const score = await computeLeadScore(contact.id);
    const oldScore = contact.leadScore ?? 0;

    // Determine lastActivity (max of message/appointment/updatedAt) cho cột sort
    const conversations = await prisma.conversation.findMany({
      where: { contactId: contact.id },
      select: { id: true },
    });
    const convIds = conversations.map((c) => c.id);
    const latestMsg = convIds.length
      ? await prisma.message.findFirst({
          where: { conversationId: { in: convIds } },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        })
      : null;
    const latestApt = await prisma.appointment.findFirst({
      where: { contactId: contact.id, appointmentDate: { gte: now } },
      orderBy: { appointmentDate: 'desc' },
      select: { appointmentDate: true },
    });
    const candidates: Date[] = [contact.updatedAt];
    if (latestMsg) candidates.push(latestMsg.sentAt);
    if (latestApt) candidates.push(latestApt.appointmentDate);
    const lastActivity = new Date(Math.max(...candidates.map((d) => d.getTime())));

    // CHỈ update leadScore + lastActivity — KHÔNG ghi tags (Phase 5 deprecated).
    // Phase 6+ scoring/auto-tag.ts updateFriendAutoTags() là source duy nhất.
    await prisma.contact.update({
      where: { id: contact.id },
      data: { leadScore: score, lastActivity },
    });

    // Phase 7 Wave 1 #14 — fire lead_score_threshold nếu vừa cross ngưỡng cấu hình
    await emitLeadScoreThresholdIfCrossed(contact.orgId, contact.id, oldScore, score);

    updated++;
  });

  logger.info(`[lead-scoring] Updated scores for ${updated} contact(s)`);
}
