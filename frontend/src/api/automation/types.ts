// Phase 7 — Frontend types mirroring backend (no shared package yet, manually
// kept in sync with backend/src/modules/automation/{blocks,sequences,triggers}/types.ts).

export type BlockChannel = 'zalo_user';

export type BlockActionType =
  | 'request_friend'
  | 'send_message'
  | 'update_status'
  // reserved
  | 'send_image' | 'send_file' | 'send_template'
  | 'add_tag' | 'remove_tag' | 'assign_user' | 'update_lead_score';

export const SUPPORTED_ACTION_TYPES: BlockActionType[] = ['request_friend', 'send_message', 'update_status'];

export const ACTION_TYPE_LABELS: Record<BlockActionType, string> = {
  request_friend: 'Gửi kết bạn',
  send_message: 'Gửi tin nhắn',
  update_status: 'Đổi trạng thái',
  send_image: 'Gửi ảnh',
  send_file: 'Gửi file',
  send_template: 'Gửi template',
  add_tag: 'Gán tag',
  remove_tag: 'Bỏ tag',
  assign_user: 'Gán sale',
  update_lead_score: 'Đổi lead score',
};

export const ACTION_TYPE_ICONS: Record<BlockActionType, string> = {
  request_friend: 'mdi-account-plus',
  send_message: 'mdi-message-text',
  update_status: 'mdi-tag-arrow-right',
  send_image: 'mdi-image',
  send_file: 'mdi-paperclip',
  send_template: 'mdi-file-document',
  add_tag: 'mdi-tag-plus',
  remove_tag: 'mdi-tag-minus',
  assign_user: 'mdi-account-arrow-right',
  update_lead_score: 'mdi-trophy',
};

export interface BlockFolder {
  id: string;
  orgId: string;
  name: string;
  visibility: 'public' | 'private'; // 2026-06-04 — Anh chốt
  parentId: string | null;
  ownerNickId: string | null;
  ownerUserId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  _count?: { blocks: number };
}

export interface Block {
  id: string;
  orgId: string;
  folderId: string | null;
  name: string;
  channel: BlockChannel;
  actionType: BlockActionType;
  content: Record<string, unknown>;
  ownerNickId: string | null;
  isShared: boolean;
  tagIds: string[]; // 2026-06-04 — Anh chốt: dự án/mục đích, multi
  usageCount: number;
  lastUsedAt: string | null;
  manualSendCount?: number; // 2026-06-07 — riêng số lần sale gửi tay từ chat (ko tính automation)
  lastManualSentAt?: string | null;
  archivedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  folder?: { id: string; name: string; visibility?: 'public' | 'private' } | null;
  ownerNick?: { id: string; displayName: string | null } | null;
}

export interface SequenceStep {
  stepId: string;
  blockId: string;
  delayMinutes: number;
  exitCondition?: string;
}

export interface SequenceRuntimeRules {
  allowedHourRange?: [number, number];
  // 2026-06-07 — khung giờ tới PHÚT ("HH:mm"). Engine cũ vẫn đọc allowedHourRange
  // (giờ tròn, làm tròn xuống từ allowedTimeRange). Trigger BullMQ mới của anh đọc
  // allowedTimeRange để chạy chuẩn tới phút.
  allowedTimeRange?: [string, string];
  randomDelayPerSend?: { min: number; max: number };
  perNickThrottle?: boolean;
  crossNickRecencyDays?: number;
  stopOnAccept?: boolean;
  // ── Dừng bám đuổi (giao diện sẵn — anh code logic BullMQ sau) ──────────────
  pauseHoursOnReply?: number;     // KH reply/react → tạm dừng N giờ (0 = tắt)
  maxAttemptsPerContact?: number; // mỗi KH nhận tối đa N tin của luồng (0 = không giới hạn)
  stopOnStatusIds?: string[];     // KH đạt 1 trong các trạng thái này → dừng hẳn
  // ── 4 LUẬT MỚI (recode 2026-06-14) — engine recode đọc các field này ──────
  // luật 2: giãn cách RANDOM [min,max] cùng đơn vị (default 15-30 phút). value=legacy cố định.
  sendGap?: { min?: number; max?: number; value?: number; unit: 'second' | 'minute' | 'hour' | 'day' };
  reEnrollCooldownDays?: number;  // luật 3: không gắn lại cùng luồng trong N ngày (default 30)
  coordinateCareSession?: boolean; // luật 4: reply→dừng→hết phiên chạy tiếp (default true)
}

export interface AutomationSequence {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  channel: string;
  steps: SequenceStep[];
  runtimeRules: SequenceRuntimeRules;
  enrolledCount: number;
  completedCount: number;
  failedCount: number;
  // Roll-up counters cached (đồng bộ từ các Mục tiêu/trigger dùng luồng — cron
  // stats-reconcile). UI thẻ luồng ưu tiên đọc cached, fallback live nếu chưa sync.
  enrolledCountCached?: number;
  completedCountCached?: number;
  replyCountCached?: number;
  blockCountCached?: number;
  countersLastSyncedAt?: string | null;
  enabled: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; fullName: string };
  _count?: { campaigns: number };
  blocks?: Array<{
    id: string; name: string; actionType: BlockActionType; archivedAt: string | null;
    ownerNick: { id: string; displayName: string | null } | null;
  }>;
}

export type TriggerEventType =
  | 'friend_invite_to_list'
  | 'friendship_accepted' | 'friendship_received' | 'first_message_received'
  | 'message_received' | 'keyword_match'
  | 'contact_created' | 'contact_status_changed' | 'contact_imported'
  | 'birthday' | 'scheduled_cron' | 'time_elapsed'
  | 'seen_no_reply' | 'silent_x_days' | 'lead_score_threshold'
  | 'manual_run' | 'order_success';

export type TriggerCategory = 'general' | 'keyword' | 'bot_api' | 'livechat' | 'genai';
export type TriggerBindingKind = 'sequence' | 'block' | 'broadcast';

export interface TriggerCatalogEntry {
  eventType: TriggerEventType;
  category: TriggerCategory;
  title: string;
  description: string;
  recommendedBinding: TriggerBindingKind;
  suggestedActionTypes?: BlockActionType[];
}

export interface AutomationTrigger {
  id: string;
  orgId: string;
  name: string;
  category: TriggerCategory;
  eventType: TriggerEventType;
  eventFilter: Record<string, unknown> | null;
  bindingKind: TriggerBindingKind;
  sequenceId: string | null;
  blockId: string | null;
  broadcastId: string | null;
  segmentSpec: Record<string, unknown> | null;
  ruleOverrides: Record<string, unknown> | null;
  enabled: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  sequence?: { id: string; name: string } | null;
  broadcast?: { id: string; name: string } | null;
  createdBy?: { id: string; fullName: string };
  _count?: { campaigns: number };
}
