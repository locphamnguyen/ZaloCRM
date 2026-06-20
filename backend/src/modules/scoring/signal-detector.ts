// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * scoring/signal-detector.ts — Detect signals từ chat content + actions.
 *
 * Input types:
 *   - Chat message text → match keywords trong DB rules
 *   - Action event (appointment_create, appointment_complete, ...) → direct map
 *   - Time-based (silent decay) → handled trong decay-cron.ts riêng
 *
 * Output: list signals detected, mỗi signal có { ruleKey, delta, dimension, label }
 * Engine apply từng signal qua applySignal() (cap check, log, update score).
 */

import { getRulesByType, type CachedSignalRule } from './config-cache.js';

export interface DetectedSignal {
  signalKey: string;
  dimension: 'engagement' | 'intent' | 'fit' | 'velocity';
  delta: number;
  label: string;
  rule: CachedSignalRule;
}

// ─── Keyword detection ────────────────────────────────────────────────────

/**
 * Detect signals từ chat content tiếng Việt.
 *
 * Algorithm: lowercase content + diacritics-normalize → loop qua keyword rules
 * → return matched. Multiple keywords trong 1 message có thể trigger nhiều signals.
 *
 * Note: Vietnamese diacritics matter for "giá" vs "gia" → KEEP diacritics, just lowercase.
 *
 * @param orgId - tenant scope
 * @param content - chat message text
 * @param currentStage - optional, filter rules by applicableStages
 */
export async function detectSignalsFromMessage(
  orgId: string,
  content: string,
  currentStage?: string | null
): Promise<DetectedSignal[]> {
  if (!content || content.trim().length === 0) return [];

  const normalized = content.toLowerCase().trim();
  const rules = await getRulesByType(orgId, 'keyword');

  const detected: DetectedSignal[] = [];
  const seenKeys = new Set<string>(); // dedupe — 1 message chỉ trigger 1 rule lần

  for (const rule of rules) {
    // Stage filter
    if (
      rule.applicableStages.length > 0 &&
      currentStage &&
      !rule.applicableStages.includes(currentStage)
    ) {
      continue;
    }

    for (const kw of rule.keywords) {
      if (kw && normalized.includes(kw.toLowerCase())) {
        if (!seenKeys.has(rule.signalKey)) {
          detected.push({
            signalKey: rule.signalKey,
            dimension: rule.dimension,
            delta: rule.delta,
            label: rule.label,
            rule,
          });
          seenKeys.add(rule.signalKey);
        }
        break; // next rule, this rule already matched
      }
    }
  }

  // Engagement: long-message signal
  if (content.length > 50) {
    const longMsgRule = rules.find((r) => r.signalKey === 'long_message');
    if (longMsgRule && !seenKeys.has('long_message')) {
      // long_message might be action type, but if exists in keyword rules too, add
    }
  }

  return detected;
}

/**
 * Detect engagement-level signals from message metadata (length, response time).
 * Separate from keyword detection — runs on every inbound message.
 */
export async function detectEngagementSignals(
  orgId: string,
  ctx: {
    isInbound: boolean;
    contentLength: number;
    responseSecondsFromLastOutbound?: number | null;
    isVoiceOrCall?: boolean;
    isFirstAfterSilent?: boolean; // last activity > 7d ago
    isShortReply?: boolean; // content trimmed ≤ 3 chars
  }
): Promise<DetectedSignal[]> {
  const rules = await getRulesByType(orgId, 'action');
  const ruleMap = new Map(rules.map((r) => [r.signalKey, r]));
  const detected: DetectedSignal[] = [];

  if (ctx.isInbound) {
    const inboundRule = ruleMap.get('inbound_message');
    if (inboundRule) {
      detected.push(toDetected(inboundRule));
    }

    if (ctx.contentLength > 50) {
      const longRule = ruleMap.get('long_message');
      if (longRule) detected.push(toDetected(longRule));
    }

    if (ctx.responseSecondsFromLastOutbound != null && ctx.responseSecondsFromLastOutbound < 300) {
      const fastRule = ruleMap.get('fast_response');
      if (fastRule) detected.push(toDetected(fastRule));
    }

    if (ctx.isVoiceOrCall) {
      const voiceRule = ruleMap.get('voice_or_call');
      if (voiceRule) detected.push(toDetected(voiceRule));
    }

    if (ctx.isFirstAfterSilent) {
      const reengRule = ruleMap.get('kh_initiates_after_silent');
      if (reengRule) detected.push(toDetected(reengRule));
    }

    if (ctx.isShortReply) {
      const shortRule = ruleMap.get('short_reply');
      if (shortRule) detected.push(toDetected(shortRule));
    }
  }

  // Outbound side: only flag slow_response_self
  if (
    !ctx.isInbound &&
    ctx.responseSecondsFromLastOutbound != null &&
    ctx.responseSecondsFromLastOutbound > 24 * 3600
  ) {
    const slowRule = ruleMap.get('slow_response_self');
    if (slowRule) detected.push(toDetected(slowRule));
  }

  return detected;
}

// ─── Action detection ─────────────────────────────────────────────────────

/**
 * Map action event → signal.
 * Called by hooks in chat/appointment/contact modules.
 */
export async function detectActionSignal(
  orgId: string,
  action: ActionEventKey
): Promise<DetectedSignal | null> {
  const rules = await getRulesByType(orgId, 'action');
  const rule = rules.find((r) => r.signalKey === action);
  if (!rule) return null;
  return toDetected(rule);
}

export type ActionEventKey =
  | 'appointment_book'
  | 'appointment_complete'
  | 'document_sent'
  | 'deposit'
  | 'sign_contract'
  | 'refuse_meeting'
  | 'seen_zoned';

// ─── Profile detection ────────────────────────────────────────────────────

/**
 * Detect profile-level fit signals từ Contact/Friend metadata.
 * Runs khi profile update (vd Contact.budgetHint, Contact.locationPref) — PR3.
 */
export async function detectProfileSignals(
  orgId: string,
  ctx: {
    budgetMatch?: boolean;
    locationMatch?: boolean;
    typeMatch?: boolean;
    hasReferralLink?: boolean;
  }
): Promise<DetectedSignal[]> {
  const rules = await getRulesByType(orgId, 'profile');
  const ruleMap = new Map(rules.map((r) => [r.signalKey, r]));
  const detected: DetectedSignal[] = [];

  if (ctx.budgetMatch) {
    const r = ruleMap.get('budget_match');
    if (r) detected.push(toDetected(r));
  }
  if (ctx.locationMatch) {
    const r = ruleMap.get('location_match');
    if (r) detected.push(toDetected(r));
  }
  if (ctx.typeMatch) {
    const r = ruleMap.get('type_match');
    if (r) detected.push(toDetected(r));
  }
  if (ctx.hasReferralLink) {
    const r = ruleMap.get('referral_link');
    if (r) detected.push(toDetected(r));
  }

  return detected;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toDetected(rule: CachedSignalRule): DetectedSignal {
  return {
    signalKey: rule.signalKey,
    dimension: rule.dimension,
    delta: rule.delta,
    label: rule.label,
    rule,
  };
}
