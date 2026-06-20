// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * org-scoped-models.ts — Phase 1a (Bảo mật xác thực 2026-06-07)
 *
 * Danh sách 62 model có cột `orgId` (sinh từ prisma/schema.prisma). Tenant-guard
 * (prisma-client.ts) dùng Set này để biết query model nào CẦN tenant context.
 * Model KHÔNG có orgId (Organization, RefreshToken global, enum...) bỏ qua.
 *
 * Cập nhật khi thêm model org-scoped mới:
 *   node -e '...' quét schema (xem plans/.../plan.md Phase 1a).
 *
 * Tên ở dạng PascalCase khớp tham số `model` của Prisma $allOperations.
 */
export const ORG_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'Team', 'User', 'ZaloAccount', 'SdkLimit', 'ZaloAccountStatusLog', 'Contact',
  'Status', 'Conversation', 'PhoneSearchEvent', 'SystemNotifyRecipient',
  'SystemNotification', 'Appointment', 'Note', 'CrmTag', 'CrmTagGroup', 'Tag',
  'TagGroup', 'ZaloLabel', 'ActivityLog', 'DailyMessageStat', 'Integration',
  'AppSetting', 'DuplicateGroup', 'ParentCandidate', 'SavedReport',
  'AutomationRule', 'MessageTemplate', 'AiConfig', 'AiSuggestionApplied',
  'AiSuggestion', 'PinnedConversation', 'GroupPoll', 'FriendshipAttempt',
  'Friend', 'ContactAccess', 'ScoringConfig', 'ScoreSignalRule',
  'StageTransitionRule', 'StuckThreshold', 'NbaTemplate', 'AccountFolder',
  'SavedFilterPreset', 'BlockFolder', 'Block', 'AutomationSequence',
  'AutomationTrigger', 'AutomationBroadcast', 'AutomationCampaign',
  'AutomationEventLog', 'ContactEngagementDaily', 'CustomerList',
  'TriggerQueueEntry', 'Department', 'PermissionGroup', 'LeadRequest',
  'LeadPoolConfig', 'LeadPoolBonusQuota', 'FacebookPageAccount',
  'FacebookLeadgenForm', 'WebhookLog', 'MetaCampaignCache', 'NotifyDedupState',
]);
