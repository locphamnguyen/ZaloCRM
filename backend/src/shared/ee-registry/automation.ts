// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Open-core seam — automation function hooks.
 *
 * Core subsystems (chat, contacts, zalo, scoring) call automation behaviour
 * through this registry. Defaults are safe no-ops/identities so the Community
 * edition runs without the automation engine. The Extension bundle installs
 * the real implementations via `registerAutomationHooks()` at boot
 * (see _ee/automation). This file lives in core and is identical across editions.
 *
 * Fire-and-forget reactions that need rich logic (e.g. the customer-reply care
 * session) are NOT modelled here — core emits a domain event on the shared
 * event bus instead (see ./event-bus.ts) and the engine reacts.
 */

// ── Types (copied minimal/structural; identical to the real automation types) ──

export type AutomationTriggerType =
  | 'message_received'
  | 'contact_created'
  | 'status_changed'
  | 'contact_status_changed';

export interface AutomationContext {
  trigger: AutomationTriggerType;
  orgId: string;
  initiatedByAutomation?: boolean;
  _depth?: number;
  contact?: {
    id: string;
    fullName: string | null;
    crmName?: string | null;
    phone: string | null;
    status: string | null;
    source?: string | null;
    assignedUserId?: string | null;
  } | null;
  conversation?: {
    id: string;
    unreadCount?: number;
    threadId?: string | null;
    threadType?: string;
    zaloAccountId?: string;
  } | null;
  message?: { id: string; content: string | null; contentType: string; senderType?: string } | null;
  org?: { id: string; name: string | null } | null;
}

export interface LogEventInput {
  orgId: string;
  triggerId: string;
  taskId?: string | null;
  contactId?: string | null;
  nickId?: string | null;
  eventType: string;
  eventPriority?: string;
  summary: string;
  category?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type ResolvedMessage =
  | { messageType: 'text'; payload: { text: string; styles: Array<{ st: string; start: number; len: number }> | null } }
  | { messageType: 'image'; payload: { url: string; caption?: string; mediaAssetId?: string } }
  | { messageType: 'album'; payload: { items: Array<{ url: string; caption?: string; mediaAssetId?: string }> } }
  | { messageType: 'file'; payload: { url: string; filename?: string; sizeBytes?: number; mimeType?: string; caption?: string; mediaAssetId?: string } }
  | { messageType: 'video'; payload: { url: string; thumbnailUrl?: string; durationSec?: number; caption?: string; mediaAssetId?: string } }
  | { messageType: 'friend_request'; payload: { greeting: string } }
  | { messageType: 'update_status'; payload: Record<string, unknown> };

export interface ResolveResult {
  ok: boolean;
  error?: string;
  detail?: string;
  resolved: ResolvedMessage[];
}

export interface TemplateVarValues {
  gender: string; name: string; name_full: string; name_first: string;
  crm_full: string; crm_first: string; crm_last: string;
  phone: string; email: string; facebook: string; tiktok: string;
  age: string; occupation: string; province: string; district: string; ward: string; address: string; income: string;
  status: string; nick_status: string; source: string; next_appt: string; score: string;
  first_active: string; last_active: string; last_message: string;
  last_inbound: string; last_outbound: string; last_interaction: string; msg_count: string;
  uid: string; nick_name: string; kb_status: string; became_friend: string;
  zalo_name: string;
  sale: string; sale_full: string;
  date: string;
}

export type Style = { st: string; start: number; len: number };

export interface OnTagAddedArgs {
  orgId: string;
  contactId: string;
  tagKind: 'friendTag' | 'crmTag';
  tagId: string;
}

export interface FriendAcceptedArgs {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  acceptedAt?: Date;
}

export interface StrangerFollowUpArgs {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  uid: string;
  template: string;
  eventType: string;
}

export interface CustomerBlockArgs {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
}

export interface NotifyCustomerBlockArgs {
  orgId: string;
  targetUserId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  nickId: string;
  nickName: string;
  triggerId: string;
  triggerName: string;
}

// ── Hook table ────────────────────────────────────────────────────────────────

export interface AutomationHooks {
  runAutomationRules: (ctx: AutomationContext) => Promise<void>;
  logEvent: (input: LogEventInput) => Promise<void>;
  isListeningState: (state: string | null | undefined) => boolean;
  onTagAdded: (args: OnTagAddedArgs) => Promise<void>;
  resolveBlockContent: (actionType: string, content: Record<string, unknown>) => ResolveResult;
  renderTemplate: (raw: string, contactId: string, assignedNickId: string) => Promise<string>;
  renderTemplateDetailed: (
    raw: string,
    contactId: string,
    assignedNickId: string,
  ) => Promise<{ rendered: string; values: TemplateVarValues }>;
  shiftStylesForRender: (rawText: string, styles: Style[], values: TemplateVarValues) => Style[] | null;
  blockVisibilityWhere: (ownerScope: { canViewAll: boolean }, userId: string) => Record<string, unknown>;
  emitLeadScoreThresholdIfCrossed: (
    orgId: string,
    contactId: string,
    oldScore: number,
    newScore: number,
  ) => Promise<void>;
  onFriendAccepted: (input: FriendAcceptedArgs) => Promise<void>;
  sendStrangerFollowUp: (input: StrangerFollowUpArgs) => Promise<void>;
  onCustomerBlock: (input: CustomerBlockArgs) => Promise<void>;
  shouldNotifyOwner: (triggerId: string, eventKey: string) => Promise<boolean>;
  notifyCustomerBlock: (input: NotifyCustomerBlockArgs) => Promise<void>;
  onCustomerReaction: (input: {
    orgId: string;
    triggerId: string;
    contactId: string;
    nickId: string;
    emoji: string;
    messageId?: string;
  }) => Promise<void>;
  respawnNickWorkerIfActive: (nickId: string, orgId: string) => Promise<void>;
}

const hooks: AutomationHooks = {
  runAutomationRules: async () => {},
  logEvent: async () => {},
  isListeningState: () => false,
  onTagAdded: async () => {},
  resolveBlockContent: () => ({ ok: false, error: 'AUTOMATION_DISABLED', resolved: [] }),
  renderTemplate: async (raw) => raw,
  renderTemplateDetailed: async (raw) => ({ rendered: raw, values: {} as TemplateVarValues }),
  shiftStylesForRender: (_text, styles) => styles,
  blockVisibilityWhere: () => ({}),
  emitLeadScoreThresholdIfCrossed: async () => {},
  onFriendAccepted: async () => {},
  sendStrangerFollowUp: async () => {},
  onCustomerBlock: async () => {},
  shouldNotifyOwner: async () => false,
  notifyCustomerBlock: async () => {},
  onCustomerReaction: async () => {},
  respawnNickWorkerIfActive: async () => {},
};

/** Extension bundle installs the real implementations at boot. */
export function registerAutomationHooks(impls: Partial<AutomationHooks>): void {
  Object.assign(hooks, impls);
}

// ── Exported wrappers (what core imports) ──────────────────────────────────────

export const runAutomationRules: AutomationHooks['runAutomationRules'] = (ctx) => hooks.runAutomationRules(ctx);
export const logEvent: AutomationHooks['logEvent'] = (input) => hooks.logEvent(input);
export const isListeningState: AutomationHooks['isListeningState'] = (state) => hooks.isListeningState(state);
export const onTagAdded: AutomationHooks['onTagAdded'] = (args) => hooks.onTagAdded(args);
export const resolveBlockContent: AutomationHooks['resolveBlockContent'] = (actionType, content) =>
  hooks.resolveBlockContent(actionType, content);
export const renderTemplate: AutomationHooks['renderTemplate'] = (raw, contactId, nickId) =>
  hooks.renderTemplate(raw, contactId, nickId);
export const renderTemplateDetailed: AutomationHooks['renderTemplateDetailed'] = (raw, contactId, nickId) =>
  hooks.renderTemplateDetailed(raw, contactId, nickId);
export const shiftStylesForRender: AutomationHooks['shiftStylesForRender'] = (text, styles, values) =>
  hooks.shiftStylesForRender(text, styles, values);
export const blockVisibilityWhere: AutomationHooks['blockVisibilityWhere'] = (ownerScope, userId) =>
  hooks.blockVisibilityWhere(ownerScope, userId);
export const emitLeadScoreThresholdIfCrossed: AutomationHooks['emitLeadScoreThresholdIfCrossed'] = (
  orgId,
  contactId,
  oldScore,
  newScore,
) => hooks.emitLeadScoreThresholdIfCrossed(orgId, contactId, oldScore, newScore);
export const onFriendAccepted: AutomationHooks['onFriendAccepted'] = (input) => hooks.onFriendAccepted(input);
export const sendStrangerFollowUp: AutomationHooks['sendStrangerFollowUp'] = (input) =>
  hooks.sendStrangerFollowUp(input);
export const onCustomerBlock: AutomationHooks['onCustomerBlock'] = (input) => hooks.onCustomerBlock(input);
export const shouldNotifyOwner: AutomationHooks['shouldNotifyOwner'] = (triggerId, eventKey) =>
  hooks.shouldNotifyOwner(triggerId, eventKey);
export const notifyCustomerBlock: AutomationHooks['notifyCustomerBlock'] = (input) =>
  hooks.notifyCustomerBlock(input);
export const onCustomerReaction: AutomationHooks['onCustomerReaction'] = (input) =>
  hooks.onCustomerReaction(input);
export const respawnNickWorkerIfActive: AutomationHooks['respawnNickWorkerIfActive'] = (nickId, orgId) =>
  hooks.respawnNickWorkerIfActive(nickId, orgId);
