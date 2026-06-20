// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * normalized-lead.schema.ts — Shared shape adapter trả về sau parseLead().
 *
 * Eng review Issue 10: validate runtime trước insert để catch bug adapter sớm.
 * Dùng manual validator (không thêm Zod dependency cho Phase 1).
 *
 * Mỗi platform adapter (fb/tiktok/google/zalo) parse webhook payload → trả NormalizedLead.
 * lead-routing.service.ts nhận và dispatch.
 */

export type LeadSource = 'fb-leadads' | 'tiktok-leadgen' | 'google-leadform' | 'zalo-ads';

export interface NormalizedLead {
  /** Platform nguồn — phải là 1 trong 4 enum values */
  source: LeadSource;
  /** Tên campaign quảng cáo (chứa "#KEY" để routing). Bắt buộc — empty string nếu adapter không lookup được */
  campaignName: string;
  /** Họ tên KH từ form (built-in field) */
  name: string;
  /** SĐT KH từ form (built-in field). Adapter KHÔNG normalize — lead-routing.service làm */
  phone: string;
  /** Custom fields schemaless. Key = câu hỏi form nguyên văn, value = string/number/array */
  customFields: Record<string, unknown>;
  /** Trace nguồn để audit/replay. Bắt buộc có externalLeadId để idempotency */
  sourceMeta: SourceMeta;
}

export interface SourceMeta {
  /** ID unique từ platform — dùng làm idempotency key trong WebhookLog */
  externalLeadId: string;
  /** Campaign ID (stable per campaign trong vòng đời của nó). Cache key. */
  campaignId?: string;
  /** Tên campaign last seen — cache invalidation khi anh edit name */
  campaignName?: string;
  /** Ad set ID nếu có */
  adSetId?: string;
  adId?: string;
  /** Form ID — cho Google Ads từ URL param */
  formId?: string;
  formName?: string;
  /** Page ID (chỉ FB) — multi-org isolation */
  pageId?: string;
  /** Payload gốc để replay khi cần debug */
  rawFieldData?: unknown;
  /** Timestamp KH submit form (epoch ms) — không nhất thiết = thời điểm CRM nhận */
  submittedAt?: number;
}

/**
 * Validate NormalizedLead shape. Throw nếu thiếu/sai field bắt buộc.
 * Adapter gọi sau parse, trước khi return cho lead-routing.
 */
export function assertValidLead(lead: unknown): asserts lead is NormalizedLead {
  if (!lead || typeof lead !== 'object') throw new Error('NormalizedLead: not an object');
  const l = lead as Record<string, unknown>;

  if (!['fb-leadads', 'tiktok-leadgen', 'google-leadform', 'zalo-ads'].includes(l.source as string)) {
    throw new Error(`NormalizedLead.source invalid: ${l.source}`);
  }
  if (typeof l.campaignName !== 'string') throw new Error('NormalizedLead.campaignName must be string');
  if (typeof l.name !== 'string') throw new Error('NormalizedLead.name must be string');
  if (typeof l.phone !== 'string' || !l.phone.trim()) throw new Error('NormalizedLead.phone empty');
  if (!l.customFields || typeof l.customFields !== 'object' || Array.isArray(l.customFields)) {
    throw new Error('NormalizedLead.customFields must be plain object');
  }
  if (!l.sourceMeta || typeof l.sourceMeta !== 'object') throw new Error('NormalizedLead.sourceMeta missing');
  const sm = l.sourceMeta as Record<string, unknown>;
  if (typeof sm.externalLeadId !== 'string' || !sm.externalLeadId.trim()) {
    throw new Error('NormalizedLead.sourceMeta.externalLeadId required (idempotency key)');
  }
}
