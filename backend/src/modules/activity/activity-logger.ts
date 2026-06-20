// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * activity-logger.ts — Helper `logActivity()` fire-and-forget.
 *
 * - KHÔNG await: log async background, không block response chính.
 * - Auto-derive category từ action via ACTION_CATEGORY map.
 * - Catch error silently (log.warn) — log fail không được crash main flow.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { categoryOf, type ActorType, type ActivityCategory } from './action-types.js';

export interface LogActivityInput {
  orgId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
  // Actor — chỉ truyền 1 trong 3:
  userId?: string | null;
  botName?: string | null;
  systemSource?: string | null;
  // Optional override category nếu action chưa có trong map
  category?: ActivityCategory | null;
}

/**
 * Fire-and-forget log. Caller KHÔNG cần await. Errors logged but never throw.
 *
 * Usage:
 *   logActivity({ orgId, userId: user.id, action: 'status_change',
 *     entityType: 'contact', entityId: contact.id,
 *     details: { old: 'new', new: 'interested' } });
 */
export function logActivity(input: LogActivityInput): void {
  const actorType: ActorType = input.botName ? 'bot' : input.systemSource ? 'system' : 'user';
  const category = input.category ?? categoryOf(input.action);

  // Fire-and-forget — không await, không block
  void prisma.activityLog.create({
    data: {
      orgId: input.orgId,
      userId: actorType === 'user' ? input.userId ?? null : null,
      actorType,
      botName: actorType === 'bot' ? input.botName ?? null : null,
      systemSource: actorType === 'system' ? input.systemSource ?? null : null,
      category,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      details: (input.details ?? {}) as object,
    },
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[activity-log] Failed to log "${input.action}": ${msg}`);
  });
}

/**
 * Helper compute diff cho update operations.
 * Trả object chỉ chứa fields đổi với { old, new } pairs.
 * Skip nếu old === new.
 */
export function computeDiff<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: (keyof T)[],
): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    const o = before[f];
    const n = after[f];
    // Deep equal cho array/object đơn giản
    if (Array.isArray(o) && Array.isArray(n)) {
      if (o.length !== n.length || o.some((v, i) => v !== n[i])) {
        diff[String(f)] = { old: o, new: n };
      }
      continue;
    }
    if (o !== n) diff[String(f)] = { old: o, new: n };
  }
  return diff;
}
