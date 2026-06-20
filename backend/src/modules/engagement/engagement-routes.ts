// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * engagement-routes.ts — Phase 8 API endpoints
 *
 *   GET  /api/v1/contacts/:id/engagement-timeline?days=28
 *        Return daily rows (0-filled cho missing dates) + pattern info.
 *
 *   POST /api/v1/admin/engagement/recompute
 *        Trigger full re-classify cho all contacts (admin only). Returns count.
 *
 *   POST /api/v1/admin/engagement/backfill
 *        One-time backfill from existing Message + Reaction data (admin only).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { recomputeContactEngagement } from './engagement-service.js';
import { runBackfill } from './engagement-backfill.js';
import { assertContactVisible } from '../contacts/contact-scope.js';

export async function registerEngagementRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/contacts/:id/engagement-timeline
  app.get('/api/v1/contacts/:id/engagement-timeline', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });

    const { id } = request.params as { id: string };
    const days = Math.min(84, Math.max(7, Number((request.query as any).days) || 28));

    // Phase Marketing+Analytics Scope 2026-05-27
    const visible = await assertContactVisible({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, contactId: id,
    });
    if (!visible) return reply.status(404).send({ error: 'contact not found' });

    const contact = await prisma.contact.findFirst({
      where: { id, orgId: user.orgId },
      select: {
        id: true,
        leadScore: true,
        engagementPattern: true,
        engagementTrend: true,
        engagementScore: true,
        engagementUpdatedAt: true,
        priorityScore: true,
        priorityUpdatedAt: true,
      },
    });
    if (!contact) return reply.status(404).send({ error: 'contact not found' });

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const rows = await prisma.contactEngagementDaily.findMany({
      where: { contactId: id, date: { gte: since } },
      select: {
        date: true,
        inboundMsgCount: true,
        outboundMsgCount: true,
        reactionCount: true,
        mediaShareCount: true,
        voiceMsgCount: true,
        callCount: true,
        missedCallCount: true,
        quoteReplyCount: true,
        customerInitiated: true,
        dailyIntensity: true,
      },
      orderBy: { date: 'asc' },
    });

    // Fill missing dates with zero rows so frontend can render heatmap grid
    // without gaps. Dates iterated UTC day-by-day.
    const rowsByDate = new Map<string, typeof rows[number]>();
    for (const r of rows) rowsByDate.set(r.date.toISOString().slice(0, 10), r);

    const timeline: Array<{
      date: string;
      inboundMsgCount: number;
      outboundMsgCount: number;
      reactionCount: number;
      mediaShareCount: number;
      voiceMsgCount: number;
      callCount: number;
      missedCallCount: number;
      quoteReplyCount: number;
      customerInitiated: boolean;
      dailyIntensity: number;
    }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const r = rowsByDate.get(key);
      timeline.push({
        date: key,
        inboundMsgCount: r?.inboundMsgCount ?? 0,
        outboundMsgCount: r?.outboundMsgCount ?? 0,
        reactionCount: r?.reactionCount ?? 0,
        mediaShareCount: r?.mediaShareCount ?? 0,
        voiceMsgCount: r?.voiceMsgCount ?? 0,
        callCount: r?.callCount ?? 0,
        missedCallCount: r?.missedCallCount ?? 0,
        quoteReplyCount: r?.quoteReplyCount ?? 0,
        customerInitiated: r?.customerInitiated ?? false,
        dailyIntensity: r?.dailyIntensity ?? 0,
      });
    }

    // Aggregate totals for breakdown box (6 signal groups anh chốt 2026-05-21)
    let totalReactions = 0;
    let totalInbound = 0;
    let totalOutbound = 0;
    let totalMedia = 0;
    let totalVoice = 0;
    let totalCalls = 0;
    let totalMissedCalls = 0;
    let totalQuoteReplies = 0;
    let daysInitiated = 0;
    for (const r of rows) {
      totalReactions += r.reactionCount;
      totalInbound += r.inboundMsgCount;
      totalOutbound += r.outboundMsgCount;
      totalMedia += r.mediaShareCount;
      totalVoice += r.voiceMsgCount;
      totalCalls += r.callCount;
      totalMissedCalls += r.missedCallCount;
      totalQuoteReplies += r.quoteReplyCount;
      if (r.customerInitiated) daysInitiated++;
    }
    const replyRate = totalOutbound > 0 ? Math.round((totalInbound / totalOutbound) * 100) : 0;
    const reactionRate = totalOutbound > 0 ? Math.round((totalReactions / totalOutbound) * 100) : 0;

    return reply.send({
      contactId: id,
      days,
      pattern: contact.engagementPattern,
      trend: contact.engagementTrend,
      score: contact.engagementScore,
      updatedAt: contact.engagementUpdatedAt,
      // Phase 8.C — return all 3 scores so frontend ScoreBanner renders cleanly
      scores: {
        lead: contact.leadScore,
        engagement: contact.engagementScore,
        priority: contact.priorityScore,
        engagementTrend: contact.engagementTrend,
        engagementPattern: contact.engagementPattern,
      },
      timeline,
      breakdown: {
        totalInbound,
        totalOutbound,
        totalReactions,
        totalMedia,
        totalVoice,
        totalCalls,
        totalMissedCalls,
        totalQuoteReplies,
        daysInitiated,
        replyRate,
        reactionRate,
      },
    });
  });

  // POST /api/v1/admin/engagement/recompute — full re-classify
  app.post('/api/v1/admin/engagement/recompute', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user || !['admin', 'owner'].includes(user.role)) {
      return reply.status(403).send({ error: 'forbidden' });
    }

    const contacts = await prisma.contact.findMany({
      where: { orgId: user.orgId },
      select: { id: true },
    });

    let updated = 0;
    for (const c of contacts) {
      try {
        await recomputeContactEngagement(c.id);
        updated++;
      } catch (err) {
        logger.warn('[engagement/recompute] failed for contact', c.id, err);
      }
    }

    // /office-hours 2026-06-06 — sync Auto Engagement tag sau khi re-classify (tuần tự).
    // Phase 1a: scope theo org của admin (trước đây syncEngagementTagsAll quét MỌI org).
    const { syncEngagementTagForOrg } = await import('./engagement-tag-service.js');
    const tagSync = await syncEngagementTagForOrg(user.orgId);

    return reply.send({ ok: true, updated, total: contacts.length, engagementTagsSynced: tagSync.synced });
  });

  // POST /api/v1/admin/engagement/backfill — one-time backfill from Message history
  app.post('/api/v1/admin/engagement/backfill', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user || !['admin', 'owner'].includes(user.role)) {
      return reply.status(403).send({ error: 'forbidden' });
    }

    const body = (request.body ?? {}) as { days?: number };
    const days = Math.min(84, Math.max(7, body.days ?? 28));

    // Run synchronously (admin tool) — return totals
    const result = await runBackfill({ orgId: user.orgId, days });
    return reply.send({ ok: true, ...result });
  });
}
