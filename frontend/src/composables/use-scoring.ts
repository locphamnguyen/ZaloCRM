// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-scoring.ts — Composable for Phase 6 Lead Scoring data.
 *
 * Provides:
 *   - getStuckLeads()        → Stuck Detection Dashboard data
 *   - getScoreBreakdown(id)  → Friend score breakdown for explainability modal
 *   - getScoringConfig()     → org-level config (weights, decay)
 *   - updateScoringConfig()  → admin update
 *   - getSignalRules()       → list rules
 *   - updateSignalRule(id)   → admin update
 *   - getStageTransitions()  → list rules
 *   - getStuckThresholds()
 *   - getNbaTemplates()
 *   - promoteStage()         → sale manual promote
 *   - seedDefaults()         → admin idempotent seed
 *   - scanStuckNow()         → admin trigger stuck scan
 *   - recomputeAll()         → admin after weights change
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface ScoreBreakdown {
  engagement: number;
  intent: number;
  fit: number;
  velocity: number;
  finalScore: number;
  computedAt: string;
  signals?: Array<{
    key: string;
    dimension: 'engagement' | 'intent' | 'fit' | 'velocity';
    delta: number;
    label: string;
    appliedAt: string;
  }>;
}

export interface StuckFriend {
  friendId: string;
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  phone: string | null;
  score: number;
  daysInStage: number;
  daysSinceLastInbound: number | null;
  stuckSince: string;
  autoTags: string[];
}

export interface StuckStageGroup {
  stage: string;
  color: string | null;
  thresholdDays: number;
  alertLabel: string;
  nbaTemplateKey: string | null;
  nbaTemplate: {
    id: string;
    key: string;
    label: string;
    contentTemplate: string;
  } | null;
  friends: StuckFriend[];
}

export interface StuckLeadsResponse {
  totalStuck: number;
  byStage: StuckStageGroup[];
}

export interface ScoringConfig {
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

export interface SignalRule {
  id: string;
  signalKey: string;
  dimension: 'engagement' | 'intent' | 'fit' | 'velocity';
  ruleType: 'keyword' | 'action' | 'silent' | 'profile' | 'velocity';
  delta: number;
  capPerDay: number | null;
  capTotal: number | null;
  keywords: string[];
  label: string;
  applicableStages: string[];
  enabled: boolean;
}

export function useScoring() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function getStuckLeads(): Promise<StuckLeadsResponse> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get('/leads/stuck');
      return res.data;
    } catch (err: any) {
      error.value = err?.response?.data?.error || err?.message || 'failed';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function getScoreBreakdown(friendId: string) {
    const res = await api.get(`/friends/${friendId}/score-breakdown`);
    return res.data;
  }

  async function getScoringConfig(): Promise<ScoringConfig> {
    const res = await api.get('/scoring/config');
    return res.data;
  }

  async function updateScoringConfig(body: Partial<{
    weightEngagement: number;
    weightIntent: number;
    weightFit: number;
    weightVelocity: number;
    decayDay3to7: number;
    decayDay7to14: number;
    decayDay14to30: number;
    decayDay30to60: number;
    autoPromote: boolean;
    stuckDetectionEnabled: boolean;
    explainabilityEnabled: boolean;
  }>): Promise<void> {
    await api.put('/scoring/config', body);
  }

  async function getSignalRules(): Promise<SignalRule[]> {
    const res = await api.get('/scoring/rules');
    return res.data;
  }

  async function updateSignalRule(id: string, body: Partial<SignalRule>): Promise<void> {
    await api.put(`/scoring/rules/${id}`, body);
  }

  async function getStageTransitions() {
    const res = await api.get('/scoring/stage-transitions');
    return res.data;
  }

  async function getStuckThresholds() {
    const res = await api.get('/scoring/stuck-thresholds');
    return res.data;
  }

  async function getNbaTemplates() {
    const res = await api.get('/scoring/nba-templates');
    return res.data;
  }

  async function promoteStage(friendId: string, statusId: string, reason?: string) {
    const res = await api.post(`/friends/${friendId}/promote`, { statusId, reason });
    return res.data;
  }

  async function seedDefaults() {
    const res = await api.post('/scoring/seed-defaults');
    return res.data;
  }

  async function scanStuckNow() {
    const res = await api.post('/leads/stuck/scan');
    return res.data;
  }

  async function recomputeAll() {
    const res = await api.post('/scoring/recompute-all');
    return res.data;
  }

  return {
    loading,
    error,
    getStuckLeads,
    getScoreBreakdown,
    getScoringConfig,
    updateScoringConfig,
    getSignalRules,
    updateSignalRule,
    getStageTransitions,
    getStuckThresholds,
    getNbaTemplates,
    promoteStage,
    seedDefaults,
    scanStuckNow,
    recomputeAll,
  };
}
