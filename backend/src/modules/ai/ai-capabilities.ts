// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * ai-capabilities.ts — Phase 6 (Bảo mật xác thực 2026-06-08)
 *
 * Giới hạn quyền của AI agent (Premise 4, design doc). AI tự hành động được
 * (fire-and-forget) nên KHÔNG cho quyền như admin. Mô hình deny-by-default:
 *   - AI_CAPABILITIES: allowlist hành động AI được phép.
 *   - assertAiCapability(): throw nếu hành động KHÔNG trong allowlist.
 *   - DANGEROUS_ACTIONS: liệt kê tường minh hành động nguy hiểm (tài liệu hoá +
 *     chống nhầm; vốn đã bị chặn vì không nằm trong allowlist).
 *   - auditAiAction(): ghi ActivityLog actorType='bot' cho mọi hành động AI.
 *
 * Hành động nguy hiểm (xóa KH, export hàng loạt, đổi quyền, gửi tin hàng loạt)
 * KHÔNG nằm trong allowlist -> AI không bao giờ làm được. Khi cần, thêm vào
 * allowlist KÈM cờ requireApproval (human-in-the-loop).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';

/** Hành động AI được phép (allowlist — deny-by-default). */
export const AI_CAPABILITIES = {
  read_conversation: { requireApproval: false },
  generate_reply: { requireApproval: false },
  extract_entities: { requireApproval: false },
  save_ai_message: { requireApproval: false },
  update_conversation_meta: { requireApproval: false },
  create_suggestion: { requireApproval: false },
  notify_internal: { requireApproval: false },
} as const;

export type AiCapability = keyof typeof AI_CAPABILITIES;

/**
 * Hành động NGUY HIỂM — không bao giờ cấp cho AI (tài liệu hoá; vốn đã bị chặn
 * vì không có trong AI_CAPABILITIES). assertAiCapability từ chối tất cả.
 */
export const DANGEROUS_ACTIONS = [
  'delete_contact',
  'export_data_bulk',
  'change_permission',
  'mass_message',
  'delete_conversation',
] as const;

export class AiCapabilityError extends Error {
  code = 'ai_capability_denied' as const;
  constructor(action: string) {
    super(`AI không có quyền thực hiện hành động "${action}".`);
  }
}

/** Throw nếu action ngoài allowlist. Trả về true nếu cần human approval. */
export function assertAiCapability(action: string): { requireApproval: boolean } {
  if (!(action in AI_CAPABILITIES)) {
    logger.warn(`[ai-capability] CHẶN hành động AI ngoài allowlist: "${action}"`);
    throw new AiCapabilityError(action);
  }
  return AI_CAPABILITIES[action as AiCapability];
}

/** Ghi audit hành động AI (actorType='bot'). Fire-and-forget, không chặn. */
export function auditAiAction(
  orgId: string,
  action: string,
  details: Record<string, unknown> = {},
): void {
  void runSystemQuery(() =>
    prisma.activityLog.create({
      data: {
        orgId,
        actorType: 'bot',
        botName: 'AI Assistant',
        category: 'automation',
        action: `ai_${action}`,
        details: details as object,
      },
    }),
  ).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[ai-capability] audit "${action}" failed: ${msg}`);
  });
}
