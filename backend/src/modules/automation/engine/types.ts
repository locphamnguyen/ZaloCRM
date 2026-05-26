// Phase 7 Engine — shared types (pure, no DB import).

import type { BlockActionType } from '../blocks/types.js';
import type { SequenceRuntimeRules } from '../sequences/types.js';
import type { TriggerEventType } from '../triggers/types.js';

// ── Event bus payload shapes ──────────────────────────────────────────────
//
// Engine listeners react to these typed events. Phase E2 wires them into
// existing handlers (message-handler, friend-event-handler). For now, only
// manual_run is emitted (by API endpoint).

export interface AutomationEvent<T = unknown> {
  type: TriggerEventType;
  orgId: string;
  occurredAt: Date;
  // Either an explicit contact (for KH-scoped events) or a segment hint
  // (for cron / scheduled events where engine queries contacts itself).
  contactId?: string;
  segmentHint?: { kind: 'all' | 'import-batch' | 'filter'; [key: string]: unknown };
  // Event-specific payload — filterable via Trigger.eventFilter
  payload?: T;
}

// ── Gate evaluation result ────────────────────────────────────────────────

export type GateName =
  | 'cap_friend_add'
  | 'cap_message'
  | 'hour_range'
  | 'per_nick_throttle'
  | 'cross_nick_recency'
  | 'stop_on_accept'
  | 'block_archived'
  | 'rule_disabled'
  // Wave 1 anti-pattern guards (chốt 2026-05-23)
  | 'frequency_cap_per_contact'  // 3.1: max N tin/window cho 1 KH từ 1 Khối
  | 'sequence_mutex';            // 3.2: KH đang trong Luồng khác → skip enroll

export interface GateResult {
  passed: boolean;
  failedGate?: GateName;
  detail?: string;
  retryAfter?: Date; // for gates that say "try later", e.g. hour_range
}

// ── Action handler interface ──────────────────────────────────────────────
//
// Each BlockActionType has a corresponding handler registered in
// action-dispatcher.ts. Engine calls handler with frozen blockSnapshot —
// handler does NOT re-read Block from DB (preserves snapshot semantics).

export interface ActionContext {
  orgId: string;
  taskId: string;
  contactId: string;
  assignedNickId: string | null;
  blockSnapshot: Record<string, unknown>; // content frozen at enroll time
  actionType: BlockActionType;
  attemptCount: number;
}

export interface ActionResult {
  outcome: 'success' | 'failure' | 'no_zalo' | 'already_friend';
  // For success: any per-action data (e.g. zalo message id)
  data?: Record<string, unknown>;
  // For failure: classification + optional retry hint
  errorCode?: string;
  errorMessage?: string;
  // If true → engine will requeue with exponential backoff
  retryable?: boolean;
}

export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

// ── Runtime rule shape (re-export for convenience) ────────────────────────
export type { SequenceRuntimeRules };

// ── Task lifecycle constants ──────────────────────────────────────────────

export const TASK_STATES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export type TaskState = (typeof TASK_STATES)[keyof typeof TASK_STATES];

export const MAX_ATTEMPT_COUNT = 5;
// Exponential backoff: 1min, 5min, 15min, 1h, 4h
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];
