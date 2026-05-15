/**
 * scoring/types.ts — Phase 6 Lead Scoring Engine type definitions.
 *
 * Hệ thống chấm điểm 2 cấp:
 *   - Friend (per-pair)  → primary, compute từ events
 *   - Contact (KH lớn)   → aggregated MAX(Friend.scores)
 *
 * Sale view dùng Friend score, Manager view dùng Contact score.
 */

// ─── Dimension types ──────────────────────────────────────────────────────

/** 4 chiều chấm điểm — weight sum phải = 100 */
export type ScoreDimension = 'engagement' | 'intent' | 'fit' | 'velocity';

export const SCORE_DIMENSIONS: ScoreDimension[] = ['engagement', 'intent', 'fit', 'velocity'];

/**
 * Score breakdown lưu vào Friend.scoreBreakdown (JSON).
 * Mỗi sub-score 0-100. finalScore = weighted sum theo ScoringConfig.weight*.
 */
export interface ScoreBreakdown {
  engagement: number; // 0-100 (cap)
  intent: number; // 0-100 (cap)
  fit: number; // 0-100 (cap)
  velocity: number; // 0-100 (cap)
  finalScore: number; // 0-100, weighted sum
  computedAt: string; // ISO timestamp
  // Trail of signals applied trong lần compute này (cho explainability UI).
  // Mỗi signal: { key, dimension, delta, label, appliedAt }
  signals?: SignalApplied[];
}

export interface SignalApplied {
  key: string; // e.g. "ask_price"
  dimension: ScoreDimension;
  delta: number; // can be negative
  label: string; // Vietnamese label
  appliedAt: string; // ISO timestamp
}

// ─── Signal rule types ────────────────────────────────────────────────────

/**
 * Rule type — cách engine detect signal.
 *
 *   keyword  — match keywords trong chat content (Vietnamese, case-insensitive)
 *   action   — trigger từ event (appointment_create, appointment_complete...)
 *   silent   — silent decay (theo decayDay* trong config)
 *   profile  — set 1 lần khi profile match (budget/location/type)
 *   velocity — compute weekly (3 ngày liên tiếp, trend up...)
 */
export type SignalRuleType = 'keyword' | 'action' | 'silent' | 'profile' | 'velocity';

/** Default seed cấu hình 1 signal rule. */
export interface SignalRuleSeed {
  signalKey: string;
  dimension: ScoreDimension;
  ruleType: SignalRuleType;
  delta: number;
  capPerDay?: number | null;
  capTotal?: number | null;
  keywords?: string[];
  label: string;
  applicableStages?: string[]; // empty = all stages
}

// ─── Stage transition types ───────────────────────────────────────────────

/** Stage names — match với Status seed (8 stages BĐS pipeline) */
export type StageName =
  | 'Mới'
  | 'Tiếp cận'
  | 'Hẹn gặp'
  | 'Nóng'
  | 'Tiềm năng'
  | 'Chốt'
  | 'Mất'
  | 'Thất Bại';

export const STAGE_ORDER: StageName[] = [
  'Mới',
  'Tiếp cận',
  'Hẹn gặp',
  'Nóng',
  'Tiềm năng',
  'Chốt',
  'Mất',
  'Thất Bại',
];

export const STAGE_TERMINAL: StageName[] = ['Chốt', 'Mất', 'Thất Bại'];
export const STAGE_BOTTLENECK: StageName[] = ['Mới', 'Tiếp cận', 'Hẹn gặp'];

/**
 * Criteria để auto-promote Friend từ stage A → B.
 * Stored trong StageTransitionRule.criteria (JSON).
 */
export interface StageCriteria {
  minEngagement?: number;
  minIntent?: number;
  minFit?: number;
  minVelocity?: number;
  minFinalScore?: number;
  minInboundCount?: number;
  /** Action(s) required — engine kiểm tra ActivityLog đã có chưa */
  requiresAction?: string[];
  minDaysInStage?: number;
}

export interface StageTransitionSeed {
  fromStage: StageName;
  toStage: StageName;
  criteria: StageCriteria;
  requiresManualConfirm: boolean;
}

// ─── Stuck detection types ────────────────────────────────────────────────

export interface StuckThresholdSeed {
  stage: StageName;
  thresholdDays: number;
  extraDecayPerDay: number;
  nbaTemplateKey: string | null;
  alertLabel: string;
}

// ─── NBA template types ───────────────────────────────────────────────────

export type NbaCategory = 'stuck' | 'cold_reengage' | 'hot_close' | 'general';

export interface NbaTemplateSeed {
  key: string;
  label: string;
  contentTemplate: string;
  category: NbaCategory;
}

// ─── Auto-tag types ───────────────────────────────────────────────────────

/**
 * 7 tags metadata layer — phân biệt với 8 pipeline stages.
 * Tag áp dụng đồng thời (1 friend có thể có nhiều tag), update realtime.
 */
export type AutoTagKey =
  | 'active' // có tương tác trong 24h
  | 'cooling' // 7-14 ngày silent
  | 'cold' // 15-30 ngày silent
  | 'frozen' // 60+ ngày silent
  | 'rewarmed' // đã cold → tương tác lại trong 48h
  | 'stuck' // quá threshold ở stage 1/2/3
  | 'ready' // score ≥ 80
  | 'atrisk'; // score giảm > 20 trong 7 ngày

export const AUTO_TAG_LABELS: Record<AutoTagKey, string> = {
  active: 'Hoạt động',
  cooling: 'Đang nguội',
  cold: 'Nguội',
  frozen: 'Đóng băng',
  rewarmed: 'Ấm trở lại',
  stuck: 'Đình trệ',
  ready: 'Sẵn sàng chốt',
  atrisk: 'Có nguy cơ',
};

export const AUTO_TAG_ICONS: Record<AutoTagKey, string> = {
  active: '🔥',
  cooling: '❄️',
  cold: '🧊',
  frozen: '🥶',
  rewarmed: '🔄',
  stuck: '⏰',
  ready: '💯',
  atrisk: '🚧',
};

// ─── Aggregate result types ───────────────────────────────────────────────

/**
 * Result của aggregateContactScore() — dùng để update Contact row.
 */
export interface ContactAggregateResult {
  leadScore: number; // MAX(Friend.leadScore)
  statusId: string | null; // status có order cao nhất giữa Friend.statusRef
  ownerFriendId: string | null; // Friend có score cao nhất + active 14d
  aggregateBreakdown: ScoreBreakdown | Record<string, never>; // breakdown của ownerFriend
  autoTags: AutoTagKey[]; // UNION từ Friend.autoTags
  stuckSinceAggregate: Date | null; // MIN(Friend.stuckSince) khi all Friend stuck
  lastActivity: Date | null; // MAX(Friend.lastInboundAt | lastOutboundAt | lastInteractionAt)
}

// ─── Scoring config snapshot ──────────────────────────────────────────────

/**
 * Snapshot config dùng trong runtime để tránh DB query mỗi lần compute.
 * Loader cache theo orgId, invalidate khi config update.
 */
export interface ScoringConfigSnapshot {
  orgId: string;
  weights: {
    engagement: number;
    intent: number;
    fit: number;
    velocity: number;
  };
  decay: {
    day3to7: number;
    day7to14: number;
    day14to30: number;
    day30to60: number;
  };
  autoPromote: boolean;
  stuckDetectionEnabled: boolean;
  explainabilityEnabled: boolean;
}
