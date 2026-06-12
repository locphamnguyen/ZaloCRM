// ════════════════════════════════════════════════════════════════════════
// Broadcasts Đợt 1 v2 (2026-06-05) — Worker 2-PHASE HYBRID
// ════════════════════════════════════════════════════════════════════════
//
// Anh chốt 2026-06-05:
//   - Phase 1: KH đã kết bạn với ≥1 nick trong selectedNickIds → ưu tiên nick
//     có lastInteractionAt mới nhất + còn quota. KHÔNG sticky (mỗi tick pick lại).
//   - Phase 2 (opt-in): KH chưa có Friend → findUser(phone) lookup UID + gửi
//     stranger message. Cap defensive 30/nick/day, 5/nick/hour, cooldown 20s.
//     Skip cross-broadcast nếu phone đã log no_zalo trong N days.
//   - selectedNickIds: subset nicks user chọn ở wizard step 3.
//   - automationTaskId pattern `bc-{broadcastId}-{contactId}` để link Message
//     → Broadcast → đếm deliveredCount + seenCount qua zca-js listeners đã set
//     sẵn `Message.deliveredAt` + `Message.seenAt` (file zalo-listener-factory.ts).
//
// Reuse: renderTemplate async từ send-message.ts:294 (auto fetch Contact + Sale).
//
// State transitions: draft → scheduled → running → completed
//                                  ↘ paused (resume) ↘ cancelled

import { Worker, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { withTenant } from '../../../shared/tenant/tenant-context.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
// Media GĐ3b 2026-06-11 — broadcast gửi media (Đường B: download URL → temp → sendFile).
import { downloadMediaToTemp } from '../../chat/chat-media-helpers.js';
import { applyContactAggregateFromMessage } from '../../contacts/contact-aggregate.js';
import { getBullMQRedis } from './redis-connection.js';
import {
  QUEUE_NAMES,
  buildBroadcastTickJobId,
  getBroadcastFireQueue,
} from './queue-registry.js';
import { classifyError } from './error-classify.js';

// ── Config defaults ─────────────────────────────────────────────────────
const CONTACTS_PER_TICK = 50;
const TICK_CHAIN_DELAY_MS = 10_000;
const DEFAULT_DELAY_MIN_MS = 3_000;
const DEFAULT_DELAY_MAX_MS = 10_000;
const DEFAULT_HOUR_START = 6;
const DEFAULT_HOUR_END = 22;
const DEFAULT_NICK_DAY_CAP = 300;
const DEFAULT_STRANGER_CAP_PER_NICK = 30;
const DEFAULT_STRANGER_CAP_PER_HOUR = 5;
const DEFAULT_STRANGER_COOLDOWN_MS = 20_000;
const DEFAULT_STRANGER_SKIP_DAYS = 30;
const DEFAULT_STRANGER_MAX_PER_BROADCAST_RATIO = 0.3;
const DEFAULT_STRANGER_MAX_PER_BROADCAST_CAP = 100;
const STUB_MODE = process.env.AUTOMATION_STUB_MODE === 'true';

export interface BroadcastFireJobData {
  broadcastId: string;
  orgId: string;
  tickIdx: number;
}

export interface BroadcastFireResult {
  status: 'tick_done' | 'completed' | 'paused' | 'cancelled' | 'deferred';
  sent: number;
  failed: number;
  skipped: number;
  phase1Sent?: number;
  phase2Sent?: number;
  phase2NoZalo?: number;
  reason?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function vnHour(d: Date = new Date()): number {
  const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.getUTCHours();
}

function next6amVN(now: Date = new Date()): Date {
  const vnOffsetMs = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffsetMs);
  const y = vnNow.getUTCFullYear();
  const m = vnNow.getUTCMonth();
  const d = vnNow.getUTCDate();
  const h = vnNow.getUTCHours();
  const dayOffset = h < 6 ? 0 : 1;
  return new Date(Date.UTC(y, m, d + dayOffset, 6, 0, 0) - vnOffsetMs);
}

function randomDelay(min: number, max: number): number {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

interface BroadcastConfig {
  delayMinMs: number;
  delayMaxMs: number;
  hourStart: number;
  hourEnd: number;
  nickDayCap: number;
  excludeBlocked: boolean;
  selectedNickIds: string[];
  allowStrangerSend: boolean;
  strangerCapPerNick: number;
  strangerCapPerHour: number;
  strangerCooldownMs: number;
  strangerSkipDays: number;
  strangerMaxPerBroadcast: number;
}

function readBroadcastConfig(pacing: unknown, totalRecipients = 0): BroadcastConfig {
  const p = (pacing ?? {}) as Record<string, any>;
  const delay = p.randomDelayBetweenSends ?? { min: DEFAULT_DELAY_MIN_MS, max: DEFAULT_DELAY_MAX_MS };
  const computedStrangerMax = Math.min(
    Math.floor(totalRecipients * DEFAULT_STRANGER_MAX_PER_BROADCAST_RATIO),
    DEFAULT_STRANGER_MAX_PER_BROADCAST_CAP,
  );
  return {
    delayMinMs: typeof delay.min === 'number' ? delay.min : DEFAULT_DELAY_MIN_MS,
    delayMaxMs: typeof delay.max === 'number' ? delay.max : DEFAULT_DELAY_MAX_MS,
    hourStart: typeof p.hourStart === 'number' ? p.hourStart : DEFAULT_HOUR_START,
    hourEnd: typeof p.hourEnd === 'number' ? p.hourEnd : DEFAULT_HOUR_END,
    nickDayCap: typeof p.nickDayCap === 'number' ? p.nickDayCap : DEFAULT_NICK_DAY_CAP,
    excludeBlocked: p.excludeBlocked !== false,
    selectedNickIds: Array.isArray(p.selectedNickIds) ? p.selectedNickIds : [],
    allowStrangerSend: p.allowStrangerSend === true,
    strangerCapPerNick: typeof p.strangerFindUserCapPerNick === 'number' ? p.strangerFindUserCapPerNick : DEFAULT_STRANGER_CAP_PER_NICK,
    strangerCapPerHour: typeof p.strangerFindUserCapPerHour === 'number' ? p.strangerFindUserCapPerHour : DEFAULT_STRANGER_CAP_PER_HOUR,
    strangerCooldownMs: typeof p.strangerCooldownMs === 'number' ? p.strangerCooldownMs : DEFAULT_STRANGER_COOLDOWN_MS,
    strangerSkipDays: typeof p.strangerSkipIfNoZaloDays === 'number' ? p.strangerSkipIfNoZaloDays : DEFAULT_STRANGER_SKIP_DAYS,
    strangerMaxPerBroadcast: typeof p.strangerMaxPerBroadcast === 'number' ? p.strangerMaxPerBroadcast : computedStrangerMax,
  };
}

function lastWordOfName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

function genderFromZaloProfile(g: string | null | undefined): string {
  if (g === 'male' || g === 'm' || g === '1') return 'Anh';
  if (g === 'female' || g === 'f' || g === '2') return 'Chị';
  return 'Anh Chị';
}

function renderTemplatePure(template: string, vars: { gender?: string; name?: string; sale?: string }): string {
  return template
    .replace(/\{gender\}/g, vars.gender ?? 'Anh Chị')
    .replace(/\{name\}/g, vars.name ?? '')
    .replace(/\{sale\}/g, vars.sale ?? '');
}

// ── Nick rotation: list selected nicks online, count today msg ──────────
async function pickAvailableNicks(orgId: string, selectedNickIds: string[]): Promise<Array<{ id: string; sentToday: number }>> {
  if (selectedNickIds.length === 0) return [];
  const nicks = await prisma.zaloAccount.findMany({
    where: { orgId, status: 'connected', id: { in: selectedNickIds } },
    select: { id: true },
  });
  if (nicks.length === 0) return [];
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const results = await Promise.all(
    nicks.map(async (n: { id: string }) => {
      const sentToday = await prisma.message.count({
        where: {
          conversation: { zaloAccountId: n.id },
          senderType: 'self',
          sentAt: { gte: dayAgo },
          sentVia: 'automation',
        },
      });
      return { id: n.id, sentToday };
    }),
  );
  return results.sort((a, b) => a.sentToday - b.sentToday);
}

// ── Phase 1: Build Friend Index ───────────────────────────────────────
// 1 query gộp đầu mỗi tick — return Map<contactId, Array<{nickId, uid, lastInteractionAt}>> sorted desc
interface FriendCandidate {
  nickId: string;
  uidInNick: string;
  lastInteractionAt: Date | null;
  becameFriendAt: Date | null;
  contactName: string;
  gender: string;
}

async function buildFriendIndex(
  orgId: string,
  contactIds: string[],
  selectedNickIds: string[],
): Promise<Map<string, FriendCandidate[]>> {
  if (contactIds.length === 0 || selectedNickIds.length === 0) return new Map();
  const rows: Array<{
    contactId: string | null;
    zaloAccountId: string;
    zaloUidInNick: string | null;
    lastInteractionAt: Date | null;
    becameFriendAt: Date | null;
    contact: { fullName: string | null; gender: string | null } | null;
  }> = await prisma.friend.findMany({
    where: {
      orgId,
      contactId: { in: contactIds },
      zaloAccountId: { in: selectedNickIds },
      friendshipStatus: 'accepted',
    },
    select: {
      contactId: true,
      zaloAccountId: true,
      zaloUidInNick: true,
      lastInteractionAt: true,
      becameFriendAt: true,
      contact: { select: { fullName: true, gender: true } },
    },
    orderBy: [{ lastInteractionAt: 'desc' }, { becameFriendAt: 'desc' }],
  });

  const map = new Map<string, FriendCandidate[]>();
  for (const f of rows) {
    if (!f.contactId || !f.zaloUidInNick) continue;
    const arr = map.get(f.contactId) ?? [];
    arr.push({
      nickId: f.zaloAccountId,
      uidInNick: f.zaloUidInNick,
      lastInteractionAt: f.lastInteractionAt,
      becameFriendAt: f.becameFriendAt,
      contactName: f.contact?.fullName ?? '',
      gender: genderFromZaloProfile(f.contact?.gender),
    });
    map.set(f.contactId, arr);
  }
  return map;
}

// ── Get-or-create Conversation ─────────────────────────────────────────
async function ensureConversation(
  orgId: string,
  zaloAccountId: string,
  externalThreadId: string,
  contactId: string,
): Promise<string> {
  let conv = await prisma.conversation.findFirst({
    where: { zaloAccountId, externalThreadId, threadType: 'user' },
    select: { id: true },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        orgId,
        zaloAccountId,
        externalThreadId,
        threadType: 'user',
        contactId,
      },
      select: { id: true },
    });
  }
  return conv.id;
}

// ── Phase 2: Lookup phone via PhoneSearchEvent cache + findUser ──────
async function resolvePhase2(
  orgId: string,
  contact: { id: string; fullName: string | null; gender: string | null; phoneNormalized: string | null },
  selectedNickIds: string[],
  nickQuotas: Map<string, { sent: number; findUser24h: number; findUserHour: number }>,
  cfg: BroadcastConfig,
): Promise<
  | { kind: 'send'; nickId: string; uidInNick: string; conversationId: string; contactName: string; gender: string }
  | { kind: 'no_phone' }
  | { kind: 'all_caps_hit' }
  | { kind: 'no_zalo' }
  | { kind: 'cached_no_zalo' }
> {
  if (!contact.phoneNormalized) return { kind: 'no_phone' };
  const phone = contact.phoneNormalized;

  // Check cross-broadcast no_zalo cache via PhoneSearchEvent
  const phoneHash = await sha256(phone);
  const skipBefore = new Date(Date.now() - cfg.strangerSkipDays * 24 * 60 * 60 * 1000);
  const recentNoZalo = await prisma.phoneSearchEvent.findFirst({
    where: {
      phoneHash,
      result: 'no_zalo',
      occurredAt: { gte: skipBefore },
    },
    select: { id: true },
  });
  if (recentNoZalo) return { kind: 'cached_no_zalo' };

  // Try positive cache hit first
  const foundCached = await prisma.phoneSearchEvent.findFirst({
    where: {
      phoneHash,
      result: 'found_zalo',
      foundUid: { not: null },
      occurredAt: { gte: skipBefore },
      accountId: { in: selectedNickIds },
    },
    select: { accountId: true, foundUid: true },
    orderBy: { occurredAt: 'desc' },
  });

  if (foundCached?.foundUid) {
    const nickId = foundCached.accountId;
    const q = nickQuotas.get(nickId);
    if (q && q.sent < cfg.nickDayCap) {
      const convId = await ensureConversation(orgId, nickId, foundCached.foundUid, contact.id);
      return {
        kind: 'send',
        nickId,
        uidInNick: foundCached.foundUid,
        conversationId: convId,
        contactName: contact.fullName ?? '',
        gender: genderFromZaloProfile(contact.gender),
      };
    }
  }

  // Cache miss → pick nick còn quota findUser → call SDK
  const eligibleNicks = selectedNickIds.filter((nid) => {
    const q = nickQuotas.get(nid);
    if (!q) return false;
    return q.findUser24h < cfg.strangerCapPerNick
      && q.findUserHour < cfg.strangerCapPerHour
      && q.sent < cfg.nickDayCap;
  });
  if (eligibleNicks.length === 0) return { kind: 'all_caps_hit' };

  // Pick random eligible nick
  const pickedNickId = eligibleNicks[Math.floor(Math.random() * eligibleNicks.length)];

  if (STUB_MODE) {
    logger.info(`[broadcast STUB-findUser] would lookup phone ${phone.slice(-4)} via nick ${pickedNickId}`);
    return { kind: 'no_zalo' };
  }

  // Cooldown for findUser
  await new Promise((r) => setTimeout(r, cfg.strangerCooldownMs));

  let uid: string | null = null;
  try {
    const resp: any = await zaloOps.findUser(pickedNickId, phone);
    uid = String(resp?.uid ?? resp?.userId ?? '') || null;
  } catch (err: any) {
    logger.warn(`[broadcast-fire] findUser failed for ${phone.slice(-4)} via ${pickedNickId}: ${err.message}`);
  }

  // Log PhoneSearchEvent (cache for future broadcasts)
  await prisma.phoneSearchEvent.create({
    data: {
      orgId,
      phoneHash,
      accountId: pickedNickId,
      result: uid ? 'found_zalo' : 'no_zalo',
      foundUid: uid,
      occurredAt: new Date(),
    },
  }).catch((err: any) => logger.warn(`[broadcast-fire] log PhoneSearchEvent failed: ${err.message}`));

  // Update quota counters in-memory
  const q = nickQuotas.get(pickedNickId)!;
  q.findUser24h++;
  q.findUserHour++;

  if (!uid) return { kind: 'no_zalo' };

  const convId = await ensureConversation(orgId, pickedNickId, uid, contact.id);
  return {
    kind: 'send',
    nickId: pickedNickId,
    uidInNick: uid,
    conversationId: convId,
    contactName: contact.fullName ?? '',
    gender: genderFromZaloProfile(contact.gender),
  };
}

async function sha256(s: string): Promise<string> {
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ── Send 1 broadcast message ───────────────────────────────────────────
async function sendBroadcastMessage(
  broadcastId: string,
  contactId: string,
  conversationId: string,
  nickId: string,
  threadId: string,
  template: string,
  vars: { gender: string; name: string; sale: string },
  mediaItems: Array<{ kind: 'image' | 'file'; url: string; filename?: string }> = [],
): Promise<{ ok: boolean; messageId?: string; error?: string; permanent?: boolean }> {
  const rendered = renderTemplatePure(template, vars);
  const automationTaskId = `bc-${broadcastId}-${contactId}`;

  if (STUB_MODE) {
    logger.info(`[broadcast STUB] would send "${rendered.slice(0, 60)}..." via nick ${nickId} to ${contactId}`);
    return { ok: true, messageId: `stub-${randomUUID()}` };
  }

  try {
    const resp: any = await zaloOps.sendMessage(nickId, threadId, 0, { msg: rendered });
    const messageId = String(resp?.message?.msgId ?? resp?.msgId ?? `bc-${randomUUID()}`);

    await prisma.message.create({
      data: {
        conversationId,
        zaloMsgId: messageId,
        senderType: 'self',
        senderName: 'Broadcast',
        content: rendered,
        contentType: 'text',
        sentAt: new Date(),
        sentVia: 'automation',
        automationTaskId, // ← link Message → Broadcast cho query deliveredCount/seenCount
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), isReplied: false },
    });

    // Fire-and-forget aggregate
    applyContactAggregateFromMessage({
      conversationId,
      message: {
        id: messageId,
        content: rendered,
        contentType: 'text',
        sentAt: new Date(),
        senderType: 'self',
      },
    }).catch((err: any) => logger.warn(`[broadcast] aggregate failed: ${err.message}`));

    // GĐ3b: gửi MEDIA sau text (Đường B — download URL → temp → sendFile).
    // Lỗi media KHÔNG làm fail cả broadcast (text đã gửi) — chỉ log.
    for (const mi of mediaItems) {
      let tmp: { path: string; cleanup: () => Promise<void> } | null = null;
      try {
        // image: KHÔNG truyền filename (mất đuôi → file lạ); gửi sendImage (inline).
        // file: giữ filename + sendFile.
        if (mi.kind === 'image') {
          tmp = await downloadMediaToTemp({ url: mi.url }, 'image');
          await zaloOps.sendImage(nickId, threadId, 0, [tmp.path], null, '');
        } else {
          tmp = await downloadMediaToTemp({ url: mi.url, filename: mi.filename }, 'file');
          await zaloOps.sendFile(nickId, threadId, 0, [tmp.path], null, '');
        }
        await prisma.message.create({
          data: {
            conversationId,
            senderType: 'self',
            senderName: 'Broadcast',
            content: JSON.stringify({ href: mi.url, name: mi.filename, kind: mi.kind }),
            contentType: mi.kind,
            sentAt: new Date(),
            sentVia: 'automation',
            automationTaskId,
          },
        }).catch(() => {});
      } catch (mErr: any) {
        logger.warn(`[broadcast] media gửi lỗi (text đã gửi) nick ${nickId}: ${mErr?.message ?? mErr}`);
      } finally {
        await tmp?.cleanup().catch(() => {});
      }
    }

    return { ok: true, messageId };
  } catch (err: any) {
    const classified = classifyError(err);
    return {
      ok: false,
      error: classified.message ?? err.message ?? 'unknown',
      permanent: classified.classification === 'permanent',
    };
  }
}

// ── Pull pending contactIds ────────────────────────────────────────────
async function pullPendingContactIds(
  broadcastId: string,
  limit: number,
  resumeCursor: string | null,
): Promise<string[]> {
  const campaign = await prisma.automationCampaign.findFirst({
    where: { broadcastId, state: 'active' },
    select: { id: true, segmentSnapshot: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!campaign) return [];
  const snapshot = campaign.segmentSnapshot as { contactIds?: string[] } | null;
  const allIds = Array.isArray(snapshot?.contactIds) ? snapshot!.contactIds! : [];
  if (allIds.length === 0) return [];
  let pending = allIds;
  if (resumeCursor) {
    const idx = allIds.indexOf(resumeCursor);
    if (idx >= 0) pending = allIds.slice(idx + 1);
  }
  return pending.slice(0, limit);
}

// ── Main worker job processor ──────────────────────────────────────────
async function processBroadcastTick(
  job: Job<BroadcastFireJobData, BroadcastFireResult>,
): Promise<BroadcastFireResult> {
  const { broadcastId, orgId, tickIdx } = job.data;
  const startedAt = Date.now();
  logger.info(`[broadcast-fire] tick ${tickIdx} start broadcast=${broadcastId}`);

  const bc = await prisma.automationBroadcast.findUnique({
    where: { id: broadcastId },
    select: {
      id: true, orgId: true, state: true, blockId: true, pacing: true,
      resumeCursor: true, sentCount: true, failedCount: true,
      totalRecipients: true, createdById: true, workerStats: true,
    },
  });
  if (!bc) return { status: 'cancelled', sent: 0, failed: 0, skipped: 0, reason: 'not_found' };
  if (bc.state === 'paused') return { status: 'paused', sent: 0, failed: 0, skipped: 0, reason: 'state_paused' };
  if (bc.state === 'cancelled' || bc.state === 'completed') {
    return { status: bc.state as any, sent: 0, failed: 0, skipped: 0, reason: `state_${bc.state}` };
  }

  const cfg = readBroadcastConfig(bc.pacing, bc.totalRecipients);
  if (cfg.selectedNickIds.length === 0) {
    logger.error(`[broadcast-fire] no selectedNickIds in pacing for broadcast ${broadcastId} — pausing`);
    await prisma.automationBroadcast.update({ where: { id: broadcastId }, data: { state: 'paused' } });
    return { status: 'paused', sent: 0, failed: 0, skipped: 0, reason: 'no_selected_nicks' };
  }

  // Window check
  const hour = vnHour();
  if (hour < cfg.hourStart || hour >= cfg.hourEnd) {
    const next6 = next6amVN();
    logger.info(`[broadcast-fire] out-of-window (vnHour=${hour}), defer to ${next6.toISOString()}`);
    await getBroadcastFireQueue().add(
      'tick',
      { broadcastId, orgId, tickIdx: tickIdx + 1 } satisfies BroadcastFireJobData,
      { delay: next6.getTime() - Date.now(), jobId: buildBroadcastTickJobId(broadcastId, tickIdx + 1) },
    );
    return { status: 'deferred', sent: 0, failed: 0, skipped: 0, reason: 'out_of_window' };
  }

  // Load template
  const block = await prisma.block.findUnique({ where: { id: bc.blockId }, select: { content: true } });
  const content = block?.content as { textVariants?: string[]; components?: any[] } | null;
  const templates = Array.isArray(content?.textVariants) ? content!.textVariants! : [];
  // GĐ3b: media components (image/album/file) trong block → gửi kèm broadcast.
  const blockMediaItems: Array<{ kind: 'image' | 'file'; url: string; filename?: string }> = [];
  for (const c of (Array.isArray(content?.components) ? content!.components! : [])) {
    if (c?.kind === 'image' && typeof c.url === 'string' && c.url) blockMediaItems.push({ kind: 'image', url: c.url });
    else if (c?.kind === 'file' && typeof c.url === 'string' && c.url) blockMediaItems.push({ kind: 'file', url: c.url, filename: c.filename });
    else if (c?.kind === 'album' && Array.isArray(c.items)) {
      for (const it of c.items) if (it?.url) blockMediaItems.push({ kind: 'image', url: it.url });
    }
  }
  if (templates.length === 0) {
    await prisma.automationBroadcast.update({
      where: { id: broadcastId },
      data: { state: 'cancelled', completedAt: new Date() },
    });
    return { status: 'cancelled', sent: 0, failed: 0, skipped: 0, reason: 'empty_template' };
  }
  const template = templates[0];

  // Load creator
  const creator = await prisma.user.findUnique({ where: { id: bc.createdById }, select: { fullName: true } });
  const saleName = creator?.fullName ? lastWordOfName(creator.fullName) : 'CRM';

  // Pull pending
  const pendingIds = await pullPendingContactIds(broadcastId, CONTACTS_PER_TICK, bc.resumeCursor);
  if (pendingIds.length === 0) {
    await prisma.automationBroadcast.update({
      where: { id: broadcastId },
      data: { state: 'completed', completedAt: new Date() },
    });
    logger.info(`[broadcast-fire] broadcast ${broadcastId} COMPLETED (sent=${bc.sentCount}, failed=${bc.failedCount})`);
    void notifyBroadcastCompleted(broadcastId).catch((err) =>
      logger.warn(`[broadcast-fire] notify failed: ${err.message}`),
    );
    return { status: 'completed', sent: 0, failed: 0, skipped: 0 };
  }

  // Pick nicks + init quota tracker
  const nicks = await pickAvailableNicks(orgId, cfg.selectedNickIds);
  if (nicks.length === 0) {
    logger.warn(`[broadcast-fire] no connected nick available — pausing`);
    await prisma.automationBroadcast.update({ where: { id: broadcastId }, data: { state: 'paused' } });
    return { status: 'paused', sent: 0, failed: 0, skipped: 0, reason: 'no_connected_nick' };
  }

  // Pre-fetch findUser quotas (PhoneSearchEvent count per nick in last 24h + 1h)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const nickQuotas = new Map<string, { sent: number; findUser24h: number; findUserHour: number }>();
  for (const n of nicks) {
    const [findUser24h, findUserHour] = await Promise.all([
      prisma.phoneSearchEvent.count({ where: { accountId: n.id, occurredAt: { gte: dayAgo } } }),
      prisma.phoneSearchEvent.count({ where: { accountId: n.id, occurredAt: { gte: hourAgo } } }),
    ]);
    nickQuotas.set(n.id, { sent: n.sentToday, findUser24h, findUserHour });
  }

  // Build friend index for THIS tick batch
  const friendIndex = await buildFriendIndex(orgId, pendingIds, cfg.selectedNickIds);

  // Load contact details for Phase 2 lookup
  const contactsData: Array<{ id: string; fullName: string | null; gender: string | null; phoneNormalized: string | null }> = await prisma.contact.findMany({
    where: { id: { in: pendingIds }, orgId },
    select: { id: true, fullName: true, gender: true, phoneNormalized: true },
  });
  const contactsById = new Map(contactsData.map((c) => [c.id, c]));

  // Existing workerStats accumulator
  const stats = (bc.workerStats as any) ?? {};
  let phase1Sent = 0;
  let phase2Sent = 0;
  let phase2NoZalo = 0;
  let phase2NoPhone = 0;
  let phase2CachedNoZalo = 0;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let lastSentContactId: string | null = bc.resumeCursor;

  for (let i = 0; i < pendingIds.length; i++) {
    const contactId = pendingIds[i];

    // Re-check state mid-tick
    const fresh = await prisma.automationBroadcast.findUnique({
      where: { id: broadcastId },
      select: { state: true },
    });
    if (!fresh || fresh.state === 'paused' || fresh.state === 'cancelled') {
      logger.info(`[broadcast-fire] state changed to ${fresh?.state}, stopping mid-tick`);
      break;
    }

    let sendResult:
      | { ok: boolean; messageId?: string; error?: string; permanent?: boolean }
      | null = null;
    let phaseUsed: 'phase1' | 'phase2' | null = null;
    let skipReason: string | null = null;

    // ── PHASE 1: tìm trong friendIndex (sorted by lastInteractionAt desc) ──
    const candidates = friendIndex.get(contactId) ?? [];
    let p1Chosen: { candidate: FriendCandidate; nickId: string } | null = null;
    for (const c of candidates) {
      const q = nickQuotas.get(c.nickId);
      if (q && q.sent < cfg.nickDayCap) {
        p1Chosen = { candidate: c, nickId: c.nickId };
        break;
      }
    }

    if (p1Chosen) {
      const { candidate, nickId } = p1Chosen;
      const convId = await ensureConversation(orgId, nickId, candidate.uidInNick, contactId);
      sendResult = await sendBroadcastMessage(
        broadcastId, contactId, convId, nickId, candidate.uidInNick,
        template, { gender: candidate.gender, name: candidate.contactName, sale: saleName },
        blockMediaItems,
      );
      phaseUsed = 'phase1';
    } else if (cfg.allowStrangerSend) {
      // ── PHASE 2: lookup phone + stranger send ──
      const totalPhase2SoFar = (stats.phase2Sent ?? 0) + phase2Sent + phase2NoZalo + phase2CachedNoZalo;
      if (totalPhase2SoFar >= cfg.strangerMaxPerBroadcast) {
        skipReason = 'phase2_max_per_broadcast_hit';
      } else {
        const contact = contactsById.get(contactId);
        if (!contact) {
          skipReason = 'contact_not_found';
        } else {
          const p2 = await resolvePhase2(orgId, contact, cfg.selectedNickIds, nickQuotas, cfg);
          if (p2.kind === 'send') {
            sendResult = await sendBroadcastMessage(
              broadcastId, contactId, p2.conversationId, p2.nickId, p2.uidInNick,
              template, { gender: p2.gender, name: p2.contactName, sale: saleName },
              blockMediaItems,
            );
            phaseUsed = 'phase2';
          } else if (p2.kind === 'no_zalo') {
            phase2NoZalo++;
            skipReason = 'phase2_no_zalo';
          } else if (p2.kind === 'cached_no_zalo') {
            phase2CachedNoZalo++;
            skipReason = 'phase2_cached_no_zalo';
          } else if (p2.kind === 'no_phone') {
            phase2NoPhone++;
            skipReason = 'phase2_no_phone';
          } else {
            skipReason = 'phase2_caps_hit';
          }
        }
      }
    } else {
      skipReason = 'no_friend_with_selected_nicks';
    }

    // Tally result
    if (sendResult) {
      if (sendResult.ok) {
        sent++;
        if (phaseUsed === 'phase1') phase1Sent++;
        else if (phaseUsed === 'phase2') phase2Sent++;
        const usedNickId = phaseUsed === 'phase1' ? p1Chosen!.nickId : null;
        if (usedNickId) {
          const q = nickQuotas.get(usedNickId);
          if (q) q.sent++;
        }
      } else {
        failed++;
        logger.warn(`[broadcast-fire] send failed contact=${contactId} phase=${phaseUsed} err=${sendResult.error}`);
      }
    } else {
      skipped++;
      if (skipReason) {
        logger.info(`[broadcast-fire] skip contact=${contactId} reason=${skipReason}`);
      }
    }
    lastSentContactId = contactId;

    // Flush counters mỗi 5 KH
    if ((sent + failed + skipped) % 5 === 0) {
      await prisma.automationBroadcast.update({
        where: { id: broadcastId },
        data: {
          resumeCursor: lastSentContactId,
          sentCount: { increment: sent },
          failedCount: { increment: failed },
        },
      });
      sent = 0;
      failed = 0;
    }

    // Delay between sends
    if (i < pendingIds.length - 1) {
      const delayMs = randomDelay(cfg.delayMinMs, cfg.delayMaxMs);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Flush final counters + workerStats
  await prisma.automationBroadcast.update({
    where: { id: broadcastId },
    data: {
      resumeCursor: lastSentContactId,
      sentCount: { increment: sent },
      failedCount: { increment: failed },
      workerStats: {
        ...stats,
        phase1Sent: (stats.phase1Sent ?? 0) + phase1Sent,
        phase2Sent: (stats.phase2Sent ?? 0) + phase2Sent,
        phase2NoZalo: (stats.phase2NoZalo ?? 0) + phase2NoZalo,
        phase2NoPhone: (stats.phase2NoPhone ?? 0) + phase2NoPhone,
        phase2CachedNoZalo: (stats.phase2CachedNoZalo ?? 0) + phase2CachedNoZalo,
        lastTickAt: new Date().toISOString(),
      } as any,
    },
  });

  // Schedule next tick
  const after = await prisma.automationBroadcast.findUnique({
    where: { id: broadcastId },
    select: { state: true },
  });
  if (after && after.state === 'running') {
    await getBroadcastFireQueue().add(
      'tick',
      { broadcastId, orgId, tickIdx: tickIdx + 1 } satisfies BroadcastFireJobData,
      { delay: TICK_CHAIN_DELAY_MS, jobId: buildBroadcastTickJobId(broadcastId, tickIdx + 1) },
    );
  }

  const elapsedMs = Date.now() - startedAt;
  logger.info(`[broadcast-fire] tick ${tickIdx} done broadcast=${broadcastId} sent=${sent} failed=${failed} skipped=${skipped} p1=${phase1Sent} p2=${phase2Sent} p2_noZalo=${phase2NoZalo} elapsed=${elapsedMs}ms`);
  return {
    status: 'tick_done',
    sent, failed, skipped,
    phase1Sent, phase2Sent, phase2NoZalo,
  };
}

// ── Notify creator on completion ───────────────────────────────────────
async function notifyBroadcastCompleted(broadcastId: string): Promise<void> {
  const bc = await prisma.automationBroadcast.findUnique({
    where: { id: broadcastId },
    select: {
      id: true, name: true, orgId: true, createdById: true,
      totalRecipients: true, sentCount: true, failedCount: true,
      startedAt: true, completedAt: true, workerStats: true,
    },
  });
  if (!bc) return;
  try {
    const { sendSystemNotificationToUser } = await import('../../system-notifications/system-notify-service.js');
    const stats = (bc.workerStats as any) ?? {};
    const elapsedMs = bc.startedAt && bc.completedAt
      ? bc.completedAt.getTime() - bc.startedAt.getTime()
      : 0;
    const elapsedMin = Math.round(elapsedMs / 60000);
    const successPct = bc.sentCount > 0 ? Math.round((bc.sentCount - bc.failedCount) / bc.sentCount * 100) : 0;
    const phase1 = stats.phase1Sent ?? 0;
    const phase2 = stats.phase2Sent ?? 0;
    const noZaloP2 = (stats.phase2NoZalo ?? 0) + (stats.phase2CachedNoZalo ?? 0);
    const noPhoneP2 = stats.phase2NoPhone ?? 0;

    const lines = [
      `Broadcast "${bc.name}" hoàn thành`,
      `📊 ${bc.sentCount}/${bc.totalRecipients} gửi · ${successPct}% thành công · ${elapsedMin}m`,
    ];
    if (phase1 > 0) lines.push(`✅ Đã kết bạn: ${phase1}`);
    if (phase2 > 0) lines.push(`👤 Tin Người lạ: ${phase2}`);
    if (noZaloP2 > 0) lines.push(`📵 Không có Zalo: ${noZaloP2}`);
    if (noPhoneP2 > 0) lines.push(`☎ Thiếu SĐT: ${noPhoneP2}`);
    if (bc.failedCount > 0) lines.push(`❌ Lỗi: ${bc.failedCount}`);
    lines.push(`Xem chi tiết: /marketing/broadcasts/${bc.id}`);

    await sendSystemNotificationToUser({
      orgId: bc.orgId,
      targetUserId: bc.createdById,
      type: 'broadcast_completed',
      title: `📢 ${bc.name}`,
      content: lines.join('\n'),
      urgency: 0,
      priority: 'normal',
    });
  } catch (err: any) {
    logger.warn(`[broadcast-fire] notify creator failed: ${err.message}`);
  }
}

// ── Worker lifecycle ────────────────────────────────────────────────────
let workerInstance: Worker<BroadcastFireJobData, BroadcastFireResult> | null = null;

export function startBroadcastFireWorker(): void {
  if (workerInstance) {
    logger.warn('[broadcast-fire] worker already started');
    return;
  }
  workerInstance = new Worker<BroadcastFireJobData, BroadcastFireResult>(
    QUEUE_NAMES.BROADCAST_FIRE,
    // Phase 1a 2026-06-08 — tenant context cho mọi query của job.
    (job: Job<BroadcastFireJobData, BroadcastFireResult>) => withTenant(job.data.orgId, () => processBroadcastTick(job)),
    {
      connection: getBullMQRedis(),
      concurrency: 2,
    },
  );
  workerInstance.on('completed', (job) => {
    logger.debug(`[broadcast-fire] job ${job.id} completed`);
  });
  workerInstance.on('failed', (job, err) => {
    logger.error(`[broadcast-fire] job ${job?.id} failed: ${err.message}`);
  });
  workerInstance.on('error', (err) => {
    logger.error(`[broadcast-fire] worker error: ${err.message}`);
  });
  logger.info('[broadcast-fire] worker started');
}

export async function stopBroadcastFireWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    logger.info('[broadcast-fire] worker stopped');
  }
}

export const __test = { processBroadcastTick, renderTemplatePure, vnHour, next6amVN, buildFriendIndex };
