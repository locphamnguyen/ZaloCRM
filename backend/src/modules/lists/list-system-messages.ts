// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * automation/lists/list-system-messages.ts — Append-only event stack trên
 * CustomerListEntry.system_messages JSON column.
 *
 * Mô hình 2-axis status (chốt 2026-05-20):
 *   - Lifecycle (5 ô): Mới / Đang chờ Quét / Có Zalo / Không có Zalo / Lỗi
 *     → đọc từ `status` + `hasZalo` columns
 *   - System Messages: stack append-only các sự kiện đặc thù
 *     → đọc từ `systemMessages` JSON column (newest top)
 *
 * Append qua raw SQL `jsonb_array_append` để tránh read-modify-write race
 * condition khi 2 event xảy ra concurrent (vd worker enrich + sale skip).
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { Prisma } from '@prisma/client';

export type SystemMessageType =
  // Dedup events
  | 'DUP_IN_LIST'
  | 'DUP_CROSS_LIST'
  | 'DUP_WITH_CRM'
  // Invalid format events
  | 'INVALID_FORMAT'
  | 'INVALID_PREFIX'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'EMPTY'
  // Sale / workflow events
  | 'SKIPPED_BY_SALE'
  | 'PHONE_EDITED'
  | 'ENRICHED_NO_MATCH' // worker check Friend xong, không match
  // Lead-notify Nhịp 1 (EE ghi qua appendSystemMessage; type ở core để FE đọc cột trạng thái)
  | 'ASSIGNED_TO_SALE' // đã giao + báo (payload.userId)
  | 'ASSIGN_FAILED'; // chưa giao được (payload.reason = 'empty_pool')

export interface SystemMessage {
  type: SystemMessageType;
  text: string;
  ts: string; // ISO timestamp
  payload?: Record<string, unknown>;
}

/**
 * Append 1 message vào stack. Race-safe via raw SQL.
 * Idempotent (cùng type+payload trong cùng giây sẽ skip để tránh dup khi worker retry).
 */
export async function appendSystemMessage(
  entryId: string,
  msg: Omit<SystemMessage, 'ts'>,
): Promise<void> {
  const fullMsg: SystemMessage = {
    ...msg,
    ts: new Date().toISOString(),
  };

  // jsonb_path operations: append với uniqueness check on (type, payload hash) trong 5 giây.
  // Đơn giản: kiểm tra last message có cùng type không, nếu có thì skip.
  await prisma.$executeRaw`
    UPDATE customer_list_entries
    SET system_messages = COALESCE(system_messages, '[]'::jsonb) || ${JSON.stringify([fullMsg])}::jsonb
    WHERE id = ${entryId}
      AND NOT (
        jsonb_array_length(system_messages) > 0
        AND (system_messages -> (jsonb_array_length(system_messages) - 1) ->> 'type') = ${msg.type}
        AND (system_messages -> (jsonb_array_length(system_messages) - 1) ->> 'ts') > (NOW() - INTERVAL '5 seconds')::text
      )
  `;
}

/**
 * Replace toàn bộ stack — dùng khi sale edit phoneRaw, cần clear messages cũ
 * (dup_*, invalid) và emit message mới phản ánh state mới.
 */
export async function replaceSystemMessages(
  entryId: string,
  messages: Omit<SystemMessage, 'ts'>[],
): Promise<void> {
  const now = new Date().toISOString();
  const full: SystemMessage[] = messages.map((m) => ({ ...m, ts: now }));
  await prisma.customerListEntry.update({
    where: { id: entryId },
    data: { systemMessages: full as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Build messages từ trạng thái parse + dedup ở insert time / edit time.
 * Caller (list-routes, list-entry-routes PATCH) gọi function này để chuyển
 * dedup detection → messages, KHÔNG tự build inline.
 */
export interface BuildMessagesInput {
  invalidReason: string | null;
  dupInListWithEntryId: string | null;
  dupWithListId: string | null;
  dupWithListEntryId: string | null;
  dupWithListName: string | null;
  dupWithContactId: string | null;
}

export function buildMessagesFromState(input: BuildMessagesInput): Omit<SystemMessage, 'ts'>[] {
  const out: Omit<SystemMessage, 'ts'>[] = [];

  // Invalid reason
  if (input.invalidReason) {
    out.push(invalidReasonToMessage(input.invalidReason));
  }
  // Dup in list
  if (input.dupInListWithEntryId) {
    out.push({
      type: 'DUP_IN_LIST',
      text: 'Trùng dòng khác trong tệp này',
      payload: { entryId: input.dupInListWithEntryId },
    });
  }
  // Dup cross list
  if (input.dupWithListId) {
    out.push({
      type: 'DUP_CROSS_LIST',
      text: input.dupWithListName
        ? `Đã có ở tệp "${input.dupWithListName}"`
        : 'Trùng tệp khác',
      payload: {
        listId: input.dupWithListId,
        entryId: input.dupWithListEntryId,
        listName: input.dupWithListName,
      },
    });
  }
  // Dup with CRM
  if (input.dupWithContactId) {
    out.push({
      type: 'DUP_WITH_CRM',
      text: 'Đã là khách CRM',
      payload: { contactId: input.dupWithContactId },
    });
  }
  return out;
}

function invalidReasonToMessage(reason: string): Omit<SystemMessage, 'ts'> {
  const lo = reason.toLowerCase();
  if (lo === 'too_short') {
    return { type: 'TOO_SHORT', text: 'Số ngắn quá (< 9 chữ số)', payload: { reason } };
  }
  if (lo === 'too_long') {
    return { type: 'TOO_LONG', text: 'Số dài quá (> 11 chữ số)', payload: { reason } };
  }
  if (lo === 'invalid_prefix') {
    return {
      type: 'INVALID_PREFIX',
      text: 'Sai prefix (không phải mobile VN 03/05/07/08/09)',
      payload: { reason },
    };
  }
  if (lo === 'empty') {
    return { type: 'EMPTY', text: 'Trống', payload: { reason } };
  }
  return { type: 'INVALID_FORMAT', text: 'Số không hợp lệ', payload: { reason } };
}
