// Phase 7 — AutomationTrigger types & catalog.
//
// Trigger = event-based entry point. When `eventType` fires + eventFilter
// matches + contact passes segmentSpec → engine materializes a Campaign and
// enrolls tasks. Catalog is closed-set: adding new eventType = 1-line enum
// extension + listener registration in Phase E.

import type { BlockActionType } from '../blocks/types.js';

// ── Event types catalog ────────────────────────────────────────────────────
//
// Each event has a known payload shape (defined in Phase E event bus).
// Triggers can filter via `eventFilter` JSON, which engine evaluates against
// the event payload at dispatch time.

export type TriggerEventType =
  // Zalo lifecycle (already emitted by friend-event-handler + message-handler)
  | 'friendship_accepted'   // Friend.friendshipStatus → 'accepted'
  | 'friendship_received'   // Friend.friendshipStatus → 'pending_received'
  | 'first_message_received' // First inbound msg from contact (existing Friend or new)
  | 'message_received'       // Any inbound msg (high volume — use eventFilter to narrow)
  | 'keyword_match'          // message_received + keyword pattern matched
  // Contact lifecycle
  | 'contact_created'        // new Contact row inserted
  | 'contact_status_changed' // Contact.statusId changed
  | 'contact_imported'       // Contact created via /contacts/import (future phase)
  // Time-based
  | 'birthday'               // cron: contact's birthday today
  | 'scheduled_cron'         // arbitrary cron expression in triggerConfig
  | 'time_elapsed'           // N days after some anchor event
  // Manual
  | 'manual_run'             // sale clicks "Run now" on segment
  // External
  | 'order_success';         // webhook from external order system (future integration)

export const SUPPORTED_EVENT_TYPES: readonly TriggerEventType[] = [
  'friendship_accepted',
  'friendship_received',
  'first_message_received',
  'message_received',
  'keyword_match',
  'contact_created',
  'contact_status_changed',
  'contact_imported',
  'birthday',
  'scheduled_cron',
  'time_elapsed',
  'manual_run',
  'order_success',
];

export type TriggerCategory = 'general' | 'keyword' | 'bot_api' | 'livechat' | 'genai';
export const SUPPORTED_CATEGORIES: readonly TriggerCategory[] = [
  'general', 'keyword', 'bot_api', 'livechat', 'genai',
];

export type TriggerBindingKind = 'sequence' | 'block' | 'broadcast';
export const SUPPORTED_BINDING_KINDS: readonly TriggerBindingKind[] = ['sequence', 'block', 'broadcast'];

// ── Validators ─────────────────────────────────────────────────────────────

export function isSupportedEventType(value: unknown): value is TriggerEventType {
  return typeof value === 'string' && SUPPORTED_EVENT_TYPES.includes(value as TriggerEventType);
}

export function isSupportedCategory(value: unknown): value is TriggerCategory {
  return typeof value === 'string' && SUPPORTED_CATEGORIES.includes(value as TriggerCategory);
}

export function isSupportedBindingKind(value: unknown): value is TriggerBindingKind {
  return typeof value === 'string' && SUPPORTED_BINDING_KINDS.includes(value as TriggerBindingKind);
}

// Validate binding: must set EXACTLY one of (sequenceId, blockId, broadcastId)
// according to `bindingKind`. Mismatch = caller bug; engine would crash later.
export function validateBinding(
  bindingKind: TriggerBindingKind,
  ids: { sequenceId?: string | null; blockId?: string | null; broadcastId?: string | null },
): { ok: true } | { ok: false; error: string } {
  const expected: Record<TriggerBindingKind, keyof typeof ids> = {
    sequence: 'sequenceId',
    block: 'blockId',
    broadcast: 'broadcastId',
  };
  const expectedField = expected[bindingKind];
  const expectedValue = ids[expectedField];

  if (typeof expectedValue !== 'string' || !expectedValue) {
    return { ok: false, error: `bindingKind '${bindingKind}' yêu cầu ${expectedField} không rỗng` };
  }

  // Reject when other FK fields are also set (ambiguous)
  for (const [k, v] of Object.entries(ids)) {
    if (k !== expectedField && typeof v === 'string' && v.length > 0) {
      return { ok: false, error: `bindingKind '${bindingKind}' không được set ${k}, chỉ set ${expectedField}` };
    }
  }

  return { ok: true };
}

// Validate eventFilter JSON shape (loose — actual filter semantics enforced by engine).
// Just guards against obvious garbage like primitive non-object.
export function validateEventFilter(
  filter: unknown,
): { ok: true } | { ok: false; error: string } {
  if (filter === null || filter === undefined) return { ok: true };
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    return { ok: false, error: 'eventFilter phải là object hoặc null' };
  }
  return { ok: true };
}

// ── Catalog UI metadata ────────────────────────────────────────────────────
//
// Powers the "Triggers" page (smax.ai-style cards). Frontend reads this to
// render: card title, description, recommended binding, default category.

export interface TriggerCatalogEntry {
  eventType: TriggerEventType;
  category: TriggerCategory;
  title: string;
  description: string;
  recommendedBinding: TriggerBindingKind;
  // Suggest action types that pair well with this event (UI hint)
  suggestedActionTypes?: BlockActionType[];
}

export const TRIGGER_CATALOG: TriggerCatalogEntry[] = [
  {
    eventType: 'friendship_accepted',
    category: 'general',
    title: 'KH đồng ý kết bạn Zalo',
    description: 'Khi khách hàng accept lời mời kết bạn → khởi động sequence chăm sóc',
    recommendedBinding: 'sequence',
    suggestedActionTypes: ['send_message'],
  },
  {
    eventType: 'friendship_received',
    category: 'general',
    title: 'KH gửi lời mời kết bạn',
    description: 'Khi khách hàng chủ động gửi lời mời kết bạn đến nick',
    recommendedBinding: 'block',
    suggestedActionTypes: ['send_message'],
  },
  {
    eventType: 'first_message_received',
    category: 'general',
    title: 'KH nhắn tin lần đầu',
    description: 'Inbound msg đầu tiên từ contact → khởi động sequence welcome',
    recommendedBinding: 'sequence',
    suggestedActionTypes: ['send_message', 'update_status'],
  },
  {
    eventType: 'keyword_match',
    category: 'keyword',
    title: 'Tin nhắn chứa từ khoá',
    description: 'Khi KH nhắn tin chứa keyword cấu hình → reply auto',
    recommendedBinding: 'block',
    suggestedActionTypes: ['send_message'],
  },
  {
    eventType: 'contact_created',
    category: 'general',
    title: 'KH mới được thêm vào hệ thống',
    description: 'Trigger ngay khi Contact mới được tạo (từ chat, import, hay manual)',
    recommendedBinding: 'sequence',
  },
  {
    eventType: 'contact_status_changed',
    category: 'general',
    title: 'KH chuyển trạng thái pipeline',
    description: 'eventFilter có thể chỉ định from/to status — chăm sóc theo stage',
    recommendedBinding: 'sequence',
  },
  {
    eventType: 'contact_imported',
    category: 'general',
    title: 'KH được import vào hệ thống',
    description: 'Sau khi import batch xong → auto start friend-add automation',
    recommendedBinding: 'sequence',
    suggestedActionTypes: ['request_friend'],
  },
  {
    eventType: 'birthday',
    category: 'general',
    title: 'Sinh nhật khách hàng',
    description: 'Cron 8am mỗi ngày, fire cho mọi contact có sinh nhật hôm nay',
    recommendedBinding: 'block',
    suggestedActionTypes: ['send_message'],
  },
  {
    eventType: 'scheduled_cron',
    category: 'general',
    title: 'Theo lịch định kỳ',
    description: 'Cron expression tuỳ ý — broadcast hằng tuần, follow-up hằng tháng...',
    recommendedBinding: 'broadcast',
  },
  {
    eventType: 'manual_run',
    category: 'general',
    title: 'Chạy thủ công theo segment',
    description: 'Sale chọn tệp KH + bấm Run → engine enroll ngay',
    recommendedBinding: 'sequence',
  },
  {
    eventType: 'order_success',
    category: 'bot_api',
    title: 'Đơn hàng thành công',
    description: 'Webhook từ hệ thống đơn → gửi lời cảm ơn + add friend (nếu chưa)',
    recommendedBinding: 'sequence',
    suggestedActionTypes: ['request_friend', 'send_message'],
  },
];
