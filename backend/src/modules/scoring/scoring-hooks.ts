// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/scoring-hooks.ts — Fire-and-forget hooks cho callers ở chat / appointment / contact modules.
 *
 * Pattern: caller gọi onXxx(...) không await, errors logged silently inside.
 *
 * Hooks:
 *   onInboundMessage(orgId, friendId, content, ctx)
 *     - Detect keyword signals từ content
 *     - Detect engagement signals (length, response time, voice, first-after-silent)
 *     - Apply signals → recompute score → log activity → trigger Contact aggregate
 *
 *   onOutboundMessage(orgId, friendId, ctx)
 *     - Detect slow_response_self nếu response time > 24h
 *
 *   onAppointmentCreate(orgId, friendId)
 *   onAppointmentComplete(orgId, friendId)
 *   onDocumentSent(orgId, friendId)
 *   onDeposit(orgId, friendId)
 *   onSignContract(orgId, friendId)
 *   onRefuseMeeting(orgId, friendId)
 *
 *   recomputeFriend(orgId, friendId, trigger?) — manual recompute (admin tools)
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import {
  detectSignalsFromMessage,
  detectEngagementSignals,
  detectActionSignal,
  type ActionEventKey,
  type DetectedSignal,
} from './signal-detector.js';
import { applySignalsToFriend } from './score-engine.js';

const SILENT_THRESHOLD_DAYS = 7;

export interface InboundCtx {
  contentLength: number;
  isVoiceOrCall?: boolean;
  /** Seconds between this inbound and previous outbound (null if no previous) */
  responseSecondsFromLastOutbound?: number | null;
}

/**
 * Hook: KH gửi tin nhắn inbound. Caller (message-handler) gọi không await.
 * Engine detect keyword + engagement signals, apply, recompute score.
 *
 * Note: friendId resolve trước khi gọi hook. Nếu chưa có Friend row (lần đầu chat),
 * caller có thể skip (applyFriendAggregate sẽ create row, hook sẽ chạy ở message sau).
 */
export function onInboundMessage(
  orgId: string,
  friendId: string,
  content: string,
  ctx: InboundCtx
): void {
  void (async () => {
    try {
      // Get friend stage để stage-filter keyword rules
      const friend = await prisma.friend.findUnique({
        where: { id: friendId },
        select: {
          statusRef: { select: { name: true } },
          lastInboundAt: true,
        },
      });
      const currentStage = friend?.statusRef?.name ?? null;

      // Detect first-after-silent (last inbound > 7 days ago)
      const isFirstAfterSilent =
        friend?.lastInboundAt != null &&
        Date.now() - friend.lastInboundAt.getTime() > SILENT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

      const isShortReply = content.trim().length <= 3;

      // 1) Keyword signals
      const keywordSignals = await detectSignalsFromMessage(orgId, content, currentStage);

      // 2) Engagement signals
      const engagementSignals = await detectEngagementSignals(orgId, {
        isInbound: true,
        contentLength: ctx.contentLength,
        responseSecondsFromLastOutbound: ctx.responseSecondsFromLastOutbound ?? null,
        isVoiceOrCall: ctx.isVoiceOrCall,
        isFirstAfterSilent,
        isShortReply,
      });

      const all: DetectedSignal[] = [...keywordSignals, ...engagementSignals];
      if (all.length === 0) return;

      await applySignalsToFriend(friendId, orgId, all, 'inbound_message');
    } catch (err) {
      logger.error({ orgId, friendId, err }, 'onInboundMessage scoring hook failed');
    }
  })();
}

/**
 * Hook: sale gửi tin outbound. Apply slow_response_self nếu chậm > 24h.
 */
export function onOutboundMessage(
  orgId: string,
  friendId: string,
  ctx: { responseSecondsFromLastInbound?: number | null }
): void {
  if (ctx.responseSecondsFromLastInbound == null || ctx.responseSecondsFromLastInbound <= 86400) {
    return;
  }
  void (async () => {
    try {
      const signals = await detectEngagementSignals(orgId, {
        isInbound: false,
        contentLength: 0,
        responseSecondsFromLastOutbound: ctx.responseSecondsFromLastInbound,
      });
      if (signals.length === 0) return;
      await applySignalsToFriend(friendId, orgId, signals, 'slow_response_self');
    } catch (err) {
      logger.error({ orgId, friendId, err }, 'onOutboundMessage scoring hook failed');
    }
  })();
}

// ── Action hooks (1 line wrappers cho event triggers) ──────────────────────

export function onAppointmentCreate(orgId: string, friendId: string): void {
  fireActionHook(orgId, friendId, 'appointment_book');
}

export function onAppointmentComplete(orgId: string, friendId: string): void {
  fireActionHook(orgId, friendId, 'appointment_complete');
}

export function onDocumentSent(orgId: string, friendId: string): void {
  fireActionHook(orgId, friendId, 'document_sent');
}

export function onDeposit(orgId: string, friendId: string): void {
  fireActionHook(orgId, friendId, 'deposit');
}

export function onSignContract(orgId: string, friendId: string): void {
  fireActionHook(orgId, friendId, 'sign_contract');
}

export function onRefuseMeeting(orgId: string, friendId: string): void {
  fireActionHook(orgId, friendId, 'refuse_meeting');
}

// ── Phase 6 polish P2 quick wins — Tag + Note signals ─────────────────────

/**
 * CRM Tag → intent signal.
 * Khi sale gắn tag chứa keyword "VIP" / "vip" / "tiềm năng cao" / "ưu tiên" cho Contact,
 * apply +intent signal cho TẤT CẢ Friend của Contact đó. Score push lên ngay → KH
 * có tag VIP nhảy lên đầu danh sách Hot.
 *
 * Tags không trigger: tag Zalo-managed (🔵 prefix), tag system auto (active/cold/...).
 */
const VIP_TAG_KEYWORDS = ['vip', 'tiềm năng cao', 'ưu tiên', 'hot lead', 'priority'];
function isVipTag(tag: string): boolean {
  if (tag.startsWith('🔵')) return false; // skip Zalo-managed
  const norm = tag.toLowerCase().trim();
  return VIP_TAG_KEYWORDS.some(kw => norm.includes(kw));
}

export function onCrmTagsAdded(orgId: string, contactId: string, addedTags: string[]): void {
  const vipTags = addedTags.filter(isVipTag);
  if (vipTags.length === 0) return;
  void (async () => {
    try {
      const friends = await prisma.friend.findMany({
        where: { orgId, contactId },
        select: { id: true },
      });
      const signal: DetectedSignal = {
        signalKey: 'crm_tag_vip',
        dimension: 'intent',
        delta: 8,
        label: `Gắn tag VIP: ${vipTags.join(', ')}`,
        rule: {
          signalKey: 'crm_tag_vip',
          dimension: 'intent',
          delta: 8,
          label: 'CRM tag VIP',
          ruleType: 'action',
          capPerDay: 1, // 1 lần/ngày/friend đủ — tránh apply lặp khi tag flip
          capTotal: null,
          keywords: [],
          applicableStages: [],
        } as any,
      };
      for (const f of friends) {
        await applySignalsToFriend(f.id, orgId, [signal], 'crm_tag_vip');
      }
      logger.info({ orgId, contactId, vipTags, friends: friends.length }, '[hook] VIP tag → +intent');
    } catch (err) {
      logger.error({ orgId, contactId, err }, 'onCrmTagsAdded scoring hook failed');
    }
  })();
}

/**
 * Note dài → engagement signal.
 * Khi sale viết note dài >100 chars cho Contact (suy luận sale đã thực sự nghiên cứu KH,
 * không phải note 1 dòng cho có), apply +engagement signal cho mọi Friend.
 * Threshold 100 chars để loại note trivial ("ok", "đã call", "xem sau").
 */
export function onNoteAdded(orgId: string, contactId: string, noteContent: string): void {
  if (!noteContent || noteContent.trim().length < 100) return;
  void (async () => {
    try {
      const friends = await prisma.friend.findMany({
        where: { orgId, contactId },
        select: { id: true },
      });
      const signal: DetectedSignal = {
        signalKey: 'sale_note_long',
        dimension: 'engagement',
        delta: 5,
        label: `Sale viết note dài (${noteContent.trim().length} ký tự)`,
        rule: {
          signalKey: 'sale_note_long',
          dimension: 'engagement',
          delta: 5,
          label: 'Sale note dài',
          ruleType: 'action',
          capPerDay: 2, // max 2 long-note/day để tránh inflate
          capTotal: null,
          keywords: [],
          applicableStages: [],
        } as any,
      };
      for (const f of friends) {
        await applySignalsToFriend(f.id, orgId, [signal], 'sale_note_long');
      }
      logger.info({ orgId, contactId, noteLen: noteContent.length, friends: friends.length }, '[hook] long note → +engagement');
    } catch (err) {
      logger.error({ orgId, contactId, err }, 'onNoteAdded scoring hook failed');
    }
  })();
}

function fireActionHook(orgId: string, friendId: string, action: ActionEventKey): void {
  void (async () => {
    try {
      const sig = await detectActionSignal(orgId, action);
      if (!sig) return;
      await applySignalsToFriend(friendId, orgId, [sig], action);
    } catch (err) {
      logger.error({ orgId, friendId, action, err }, 'action hook scoring failed');
    }
  })();
}

// ── Manual recompute (admin tools / migration backfill) ────────────────────

/**
 * Recompute score from current state — không apply signals mới, chỉ tính lại
 * finalScore từ existing sub-scores với current weights.
 *
 * Use case: sau khi admin đổi weights trong Settings → recompute all.
 */
export async function recomputeFriendFinalScore(
  orgId: string,
  friendId: string
): Promise<{ oldScore: number; newScore: number; delta: number } | null> {
  try {
    const friend = await prisma.friend.findUnique({
      where: { id: friendId },
      select: { id: true, leadScore: true, scoreBreakdown: true, contactId: true },
    });
    if (!friend) return null;
    if (!friend.scoreBreakdown || typeof friend.scoreBreakdown !== 'object') return null;

    const { computeFinalScore } = await import('./score-engine.js');
    const { getScoringConfig } = await import('./config-cache.js');
    const config = await getScoringConfig(orgId);
    const b = friend.scoreBreakdown as any;
    const newScore = computeFinalScore(
      {
        engagement: b.engagement ?? 0,
        intent: b.intent ?? 0,
        fit: b.fit ?? 0,
        velocity: b.velocity ?? 0,
      },
      config
    );

    const delta = newScore - friend.leadScore;
    if (delta === 0) return { oldScore: friend.leadScore, newScore, delta: 0 };

    await prisma.friend.update({
      where: { id: friendId },
      data: {
        leadScore: newScore,
        scoreBreakdown: {
          ...b,
          finalScore: newScore,
          computedAt: new Date().toISOString(),
        },
        scoreUpdatedAt: new Date(),
      },
    });

    if (friend.contactId) {
      const { updateContactAggregateAsync } = await import('./aggregate-contact.js');
      updateContactAggregateAsync(friend.contactId);
    }

    return { oldScore: friend.leadScore, newScore, delta };
  } catch (err) {
    logger.error({ orgId, friendId, err }, 'recomputeFriendFinalScore failed');
    return null;
  }
}
