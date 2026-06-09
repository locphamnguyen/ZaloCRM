// Phase Friend Invite Wave 2 — Welcome Probe Worker 2026-05-29.
// Semantic refactor 2026-06-02 — per-(contact, trigger) dedup (anh chốt logic B).
//
// Poll FriendRequestOutbox WHERE kind='WELCOME_PROBE' AND welcome_outcome IS NULL
// AND created_at <= NOW() - INTERVAL '<welcomeDelayAfterFriendReqSec> seconds'.
// FOR UPDATE SKIP LOCKED. Limit 5 per tick.
//
// Per row:
//  1. Load org config (template + maxRetries + strangerInboxEnabled)
//  2. Load contact + friend record (per-nick UID) + prior outbox SENT_* sibling for (contact, trigger)
//  3. If sibling SENT_STRANGER|SENT_FRIEND exists for this (contactId, triggerId) → outcome=DUPLICATE_SKIP
//     (Contact.welcomeSentAt is LEGACY and NEVER read here.)
//  4. Detect warm = friend.friendshipStatus='accepted' AND contact.lastInboundAt < 30d
//     → channel=FRIEND, else STRANGER (only if org.welcomeStrangerInboxEnabled)
//  5. Render template via {gender}/{name}/{sale}
//  6. zaloOps.sendMessage(nickId, threadId, 0, { msg, allowStrangerMessage: !isWarm })
//  7. Classify error: BLOCKED_STRANGER (stranger guard hits) → no retry
//     transient (timeout/5xx) + retry_count < maxRetries → increment, leave null
//     else → HARD_FAIL
//  8. Success → tx: outbox welcomeOutcome=SENT_STRANGER|SENT_FRIEND + welcomeSentAt,
//     contact welcomeChannel + welcomeSentAt (LEGACY hint, write-only)
//     If two concurrent workers race the same (contact, trigger), the partial unique index
//     uniq_outbox_welcome_sent_per_contact_trigger fires P2002 on the loser → DUPLICATE_SKIP.
//  9. Honor hour 6-22 VN window

import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { logEvent } from './event-log-service.js';
import { withTenant, runSystemQuery } from '../../../shared/tenant/tenant-context.js';

let probeInterval: NodeJS.Timeout | null = null;
let busy = false;
let tickCounter = 0;

interface ProbeRow {
  id: string;
  org_id: string;
  nick_id: string;
  contact_id: string;
  trigger_id: string | null;
  welcome_retry_count: number;
  // Sprint v3 (2026-06-03) — sticky 24h hold: mốc nick offline lần đầu với
  // outbox này. NULL = chưa từng offline. Set khi gate check / catch
  // AWAITING_NICK lần đầu. Sweeper sticky-hold đọc để compute 23h timeout.
  nick_first_offline_at: Date | null;
}

/**
 * Working hours check — đọc UNION allowedHourRange từ Sequence của trigger active.
 * Fix 2026-05-30 22:46 (M57 extension) — hardcode 6-22 trước đây gây bug khi anh
 * chỉnh giờ qua UI Sequence không có hiệu lực với welcome-probe-worker.
 */
async function isWithinWorkingHours(): Promise<boolean> {
  const vnHour = (new Date().getUTCHours() + 7) % 24;
  try {
    // Fix 2026-05-30 22:55 — lookup từ Sequence nào liên kết với outbox WELCOME_PROBE
    // đang pending (kể cả trigger completed). Trước đây query trigger.state='active'
    // bỏ sót outbox của trigger đã completed → tin chào không bao giờ gửi.
    // Phase 1a 2026-06-08 — working-hours lookup quét sequence cross-org → system query.
    const seqs = await runSystemQuery(() =>
      prisma.automationSequence.findMany({
        where: {
          triggers: { some: { eventType: 'friend_invite_to_list' } },
        },
        select: { runtimeRules: true },
      }),
    );
    let s = 24, e = 0;
    for (const seq of seqs) {
      const rules = seq.runtimeRules as { allowedHourRange?: [number, number] } | null;
      const range = rules?.allowedHourRange;
      if (Array.isArray(range) && range.length === 2) {
        if (range[0] < s) s = range[0];
        if (range[1] > e) e = range[1];
      }
    }
    // Fix 2026-05-30 23:08 — đổi `vnHour < e` thành `vnHour <= e` để 23h trong UI
    // có nghĩa "tới hết 23h59" thay vì "tới 22h59". Anh chỉnh 23h kỳ vọng gửi
    // được 23:00-23:59, không phải block ngay khi đồng hồ sang 23:00.
    if (seqs.length > 0 && s < e) return vnHour >= s && vnHour <= e;
  } catch { /* fallthrough default */ }
  return vnHour >= 6 && vnHour <= 22;
}

function classifyError(msg: string): 'BLOCKED_STRANGER' | 'TRANSIENT' | 'AWAITING_NICK' | 'HARD_FAIL' {
  const m = msg.toLowerCase();
  if (m.includes('cannot_message_stranger') || m.includes('user_blocked') ||
      m.includes('spam') || msg.includes('Tham số không hợp lệ')) {
    return 'BLOCKED_STRANGER';
  }
  // ── Sprint v3 (2026-06-03) — Sửa 4.4 ──
  // Nick gốc chết / disconnect → KHÔNG mark HARD_FAIL. Giữ welcome_outcome=NULL
  // để worker tick lại khi nick hồi. Sweeper sticky-hold sẽ reset KH sau 23h
  // nếu nick chưa hồi. AWAITING_NICK chỉ là chỉ báo classify, KHÔNG mark vào
  // welcome_outcome — outcome NULL để re-poll.
  if (m.includes('not_connected') || m.includes('account not connected') ||
      m.includes('disconnected') || m.includes('qr_pending')) {
    return 'AWAITING_NICK';
  }
  if (m.includes('timeout') || m.includes('etimedout') || /\b5\d\d\b/.test(msg) ||
      m.includes('econnreset') || m.includes('socket')) {
    return 'TRANSIENT';
  }
  return 'HARD_FAIL';
}

async function renderGreeting(raw: string, contactId: string, nickId: string): Promise<string> {
  if (!raw.includes('{')) return raw;
  const [contact, ownerUser] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { fullName: true, gender: true } }),
    prisma.user.findFirst({ where: { zaloAccounts: { some: { id: nickId } } }, select: { fullName: true } }),
  ]);
  const genderStr =
    contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị';
  const name = (contact?.fullName ?? '').trim().split(/\s+/).pop() ?? 'Anh Chị';
  const sale = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';
  return raw.replaceAll('{gender}', genderStr).replaceAll('{name}', name).replaceAll('{sale}', sale);
}

async function processRow(row: ProbeRow): Promise<void> {
  // Wave 2 refactor 2026-05-29 — template + delay now PER-TRIGGER, not per-org.
  // Org still owns retry/stranger-inbox knobs (cross-trigger policy).
  const [org, trigger] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: row.org_id },
      select: {
        welcomeMaxRetries: true,
        welcomeStrangerInboxEnabled: true,
      },
    }),
    row.trigger_id
      ? prisma.automationTrigger.findUnique({
          where: { id: row.trigger_id },
          // I10 2026-06-04 — enableWelcome: công tắc Tin 1. Tắt = không gửi tin chào.
          // #3 2026-06-06 — warmWindowDays: cửa sổ coi KH là "ấm" (Anh nhập trên UI),
          // thay 30 ngày hardcode.
          select: { welcomeMessageTemplate: true, enableWelcome: true, warmWindowDays: true },
        })
      : Promise.resolve(null),
  ]);

  if (!org) {
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'HARD_FAIL', welcomeLastError: 'org missing', welcomeSentAt: new Date() },
    });
    return;
  }

  // Fallback: trigger has no welcome template → mark SKIPPED so the drainer
  // can still enroll the contact into the successor Sequence. The welcome gate
  // is intentionally a no-op for triggers configured without a greeting.
  // 2026-06-02: under the new per-(contact, trigger) semantic, SKIPPED MUST NOT
  // write Contact.welcomeSentAt — that would lock the contact across all future
  // triggers via legacy column reads (now removed). Only the outbox row records SKIPPED.
  // I10 2026-06-04 — Tin 1 tắt (enableWelcome=false) HOẶC không có template → SKIPPED.
  // Vẫn enroll sequence bám đuổi (drainer xử lý SKIPPED bình thường), chỉ bỏ tin chào.
  if (trigger?.enableWelcome === false || !trigger?.welcomeMessageTemplate) {
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'SKIPPED', welcomeSentAt: new Date() },
    });
    return;
  }

  // 2026-06-02 — per-(contact, trigger) dedup: load lastInbound for warm-detection,
  // friend record for per-nick UID + accepted check, and any sibling outbox row that
  // already won the (contact, trigger) lane (only SENT_* outcomes contend — BLOCKED /
  // HARD_FAIL / SKIPPED do NOT block a future trigger from re-engaging).
  const [contact, friend, priorSent] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: row.contact_id },
      select: { lastInboundAt: true },
    }),
    prisma.friend.findFirst({
      where: { zaloAccountId: row.nick_id, contactId: row.contact_id },
      select: { zaloUidInNick: true, friendshipStatus: true },
    }),
    row.trigger_id
      ? prisma.friendRequestOutbox.findFirst({
          where: {
            contactId: row.contact_id,
            triggerId: row.trigger_id,
            kind: 'WELCOME_PROBE',
            welcomeOutcome: { in: ['SENT_STRANGER', 'SENT_FRIEND'] },
            id: { not: row.id },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!friend) {
    // 2026-06-02: no Contact.welcomeSentAt write — HARD_FAIL is per-row on the outbox only.
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'HARD_FAIL', welcomeLastError: 'friend record missing', welcomeSentAt: new Date() },
    });
    return;
  }

  if (priorSent) {
    // A sibling outbox row for the same (contact, trigger) already sent — dup-skip this attempt.
    // Different trigger → priorSent is null → flow continues (re-engage allowed).
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'DUPLICATE_SKIP', welcomeSentAt: new Date() },
    });
    return;
  }

  // #3 2026-06-06 — cửa sổ "ấm" đọc từ cấu hình Mục tiêu (warmWindowDays), thay 30 ngày cứng.
  const warmDays = trigger?.warmWindowDays ?? 30;
  const warmCutoff = new Date(Date.now() - warmDays * 24 * 60 * 60 * 1000);
  const isWarm = friend.friendshipStatus === 'accepted' &&
    !!contact?.lastInboundAt && contact.lastInboundAt > warmCutoff;

  if (!isWarm && !org.welcomeStrangerInboxEnabled) {
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'BLOCKED_STRANGER', welcomeLastError: 'stranger inbox disabled' },
    });
    // Wave 3 Event Log — welcome_blocked (org tắt stranger inbox)
    if (row.trigger_id) {
      void logBlockedStranger({
        orgId: row.org_id,
        triggerId: row.trigger_id,
        contactId: row.contact_id,
        nickId: row.nick_id,
        reason: 'stranger inbox disabled',
      });
    }
    return;
  }

  const channel = isWarm ? 'SENT_FRIEND' : 'SENT_STRANGER';
  const channelLabel = isWarm ? 'friend_msg' : 'stranger_inbox';
  const msg = await renderGreeting(trigger.welcomeMessageTemplate, row.contact_id, row.nick_id);

  // ── Sprint v3 (2026-06-03) — Sửa 4.4: gate nick.status TRƯỚC sendMessage ──
  // Nếu nick gốc offline → KHÔNG gọi sendMessage. Set nickFirstOfflineAt
  // (nếu NULL) + set entry.nickHoldSince (nếu NULL) + giữ welcome_outcome=NULL.
  // Khi nick hồi, worker tick lại sẽ thấy connected → gửi xong.
  // Sweeper sticky-hold sẽ reset KH sau 23h nếu nick chưa hồi.
  const nickStatusCheck = await prisma.zaloAccount.findUnique({
    where: { id: row.nick_id },
    select: { status: true },
  });
  if (!nickStatusCheck || nickStatusCheck.status !== 'connected') {
    const now = new Date();
    await tenantTransaction(async (tx) => {
      await tx.friendRequestOutbox.update({
        where: { id: row.id },
        data: {
          // Giữ welcome_outcome=NULL để re-poll khi nick hồi
          nickFirstOfflineAt: row.nick_first_offline_at ?? now,
          welcomeLastError: `nick_offline status=${nickStatusCheck?.status ?? 'missing'}`,
        },
      });
      // #2 2026-06-06 — nickHoldSince ở bảng nối per-trigger (filter theo contactId denormalized).
      await tx.triggerQueueEntry.updateMany({
        where: {
          contactId: row.contact_id,
          triggerId: row.trigger_id ?? undefined,
          claimedByNickId: row.nick_id,
          nickHoldSince: null,
        },
        data: { nickHoldSince: now },
      });
    });
    logger.warn(
      `[welcome-probe] outbox=${row.id} nick=${row.nick_id} offline status=${nickStatusCheck?.status ?? 'missing'} — hold welcome, chờ nick hồi (Sprint v3)`,
    );
    return;
  }

  // 2026-06-02 — Race-safety: in-flight exclusivity comes from the per-row claim-token
  // pattern (welcome_last_error LIKE 'claim:%') at runProbeTick L321-336. Cross-row
  // dedup on (contact, trigger) is enforced by the partial unique index
  // uniq_outbox_welcome_sent_per_contact_trigger which fires P2002 when a second
  // worker tries to write SENT_* for an already-won (contact, trigger) pair.

  try {
    await zaloOps.sendMessage(row.nick_id, friend.zaloUidInNick, 0, {
      msg,
      allowStrangerMessage: !isWarm,
    });
    await tenantTransaction(async (tx) => {
      await tx.friendRequestOutbox.update({
        where: { id: row.id },
        // PARTIAL UNIQUE FIRES HERE on race-loss → caught below, mapped to DUPLICATE_SKIP.
        data: { welcomeOutcome: channel, welcomeSentAt: new Date() },
      });
      await tx.contact.update({
        where: { id: row.contact_id },
        // Legacy hint, write-only — NOT used for gating under the new semantic.
        data: { welcomeChannel: channelLabel, welcomeSentAt: new Date() },
      });
    });
    logger.info(`[welcome-probe] sent outbox=${row.id} channel=${channelLabel}`);

    // Wave 3 Event Log — welcome_sent vào Mục tiêu timeline
    if (row.trigger_id) {
      void (async () => {
        try {
          const [contactRow, nickRow] = await Promise.all([
            prisma.contact.findUnique({
              where: { id: row.contact_id },
              select: { fullName: true, crmName: true, phone: true },
            }),
            prisma.zaloAccount.findUnique({
              where: { id: row.nick_id },
              select: { displayName: true },
            }),
          ]);
          const contactDisplay =
            contactRow?.crmName?.trim() ||
            contactRow?.fullName?.trim() ||
            contactRow?.phone ||
            'KH';
          const nickDisplay = nickRow?.displayName?.trim() || row.nick_id.slice(0, 8);
          void logEvent({
            orgId: row.org_id,
            triggerId: row.trigger_id!,
            contactId: row.contact_id,
            nickId: row.nick_id,
            eventType: 'welcome_sent',
            eventPriority: 'info',
            summary: `Nick ${nickDisplay} gửi tin chào mừng cho ${contactDisplay}`,
            metadata: { outboxId: row.id, channel: channelLabel },
          });
        } catch (err) {
          logger.warn(`[welcome-probe] event-log enrichment failed outbox=${row.id}:`, err);
        }
      })();
    }
  } catch (err: any) {
    const errMsg = (err?.message ?? String(err)).slice(0, 500);

    // 2026-06-02 — P2002 on the partial unique uniq_outbox_welcome_sent_per_contact_trigger
    // means another worker won the (contact, trigger) lane between our pre-flight read
    // and our success-tx write. Map to DUPLICATE_SKIP, do NOT log as failure.
    if (err?.code === 'P2002' &&
        String(err?.meta?.target ?? '').includes('welcome_sent_per_contact_trigger')) {
      await prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: {
          welcomeOutcome: 'DUPLICATE_SKIP',
          welcomeSentAt: new Date(),
          welcomeLastError: 'race_lost',
        },
      });
      return;
    }

    const kind = classifyError(errMsg);
    if (kind === 'AWAITING_NICK') {
      // ── Sprint v3 (2026-06-03) — Sửa 4.4 ──
      // Race: nick disconnect ngay giữa gate check ↔ sendMessage. Cùng hành xử
      // như gate trên: giữ welcome_outcome=NULL, set nickFirstOfflineAt, đẩy
      // entry.nickHoldSince. Sweeper sticky-hold reset sau 23h nếu nick chưa hồi.
      const now = new Date();
      await tenantTransaction(async (tx) => {
        await tx.friendRequestOutbox.update({
          where: { id: row.id },
          data: {
            nickFirstOfflineAt: row.nick_first_offline_at ?? now,
            welcomeLastError: `awaiting_nick ${errMsg}`.slice(0, 500),
          },
        });
        // #2 2026-06-06 — nickHoldSince ở bảng nối per-trigger.
        await tx.triggerQueueEntry.updateMany({
          where: {
            contactId: row.contact_id,
            triggerId: row.trigger_id ?? undefined,
            claimedByNickId: row.nick_id,
            nickHoldSince: null,
          },
          data: { nickHoldSince: now },
        });
      });
      logger.warn(
        `[welcome-probe] outbox=${row.id} nick=${row.nick_id} AWAITING_NICK (race) — hold welcome: ${errMsg}`,
      );
    } else if (kind === 'BLOCKED_STRANGER') {
      await prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: 'BLOCKED_STRANGER', welcomeLastError: errMsg, welcomeSentAt: new Date() },
      });
      // Wave 3 Event Log — welcome_blocked (Zalo trả lỗi chặn tin chào)
      if (row.trigger_id) {
        void logBlockedStranger({
          orgId: row.org_id,
          triggerId: row.trigger_id,
          contactId: row.contact_id,
          nickId: row.nick_id,
          reason: errMsg,
        });
      }
    } else if (kind === 'TRANSIENT' && row.welcome_retry_count < org.welcomeMaxRetries) {
      // Transient retry: per-row claim-token at runProbeTick handles re-pickup.
      // 2026-06-02 — under the new semantic the legacy Contact.welcomeSentAt no longer
      // gates anything, so we don't null it on retry. The previous release was tightly
      // coupled to the now-removed lockClaim at L207-217.
      await prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeRetryCount: { increment: 1 }, welcomeLastError: errMsg },
      });
    } else {
      // HARD_FAIL (including max retries exhausted) — terminal, outbox row only.
      await prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: 'HARD_FAIL', welcomeLastError: errMsg, welcomeSentAt: new Date() },
      });
    }
  }
}

async function runProbeTick(): Promise<void> {
  if (busy) return;
  if (!(await isWithinWorkingHours())) return;
  busy = true;
  try {
    // Atomic UPDATE ... RETURNING claim pattern (replaces SELECT FOR UPDATE SKIP LOCKED).
    // We mark welcome_last_error with a per-process claim token so any concurrent worker
    // sees this row is taken (welcome_last_error NOT LIKE 'claim:%' in the inner SELECT).
    // 60s `created_at` floor doubles as a stale-claim recovery: if a prior process crashed
    // mid-tick, the row becomes re-claimable on the next eligible tick.
    const claimToken = 'claim:' + (++tickCounter) + ':' + process.pid;
    // Phase 1a 2026-06-08 — claim quét outbox cross-org (mỗi row tự mang org_id)
    // → chạy ở chế độ system; xử lý từng row trong withTenant(row.org_id) bên dưới.
    // Wave 2 refactor 2026-05-29 — delay floor now comes from the trigger
    // (welcome_delay_seconds), not from the organization.
    // FIX 2026-06-08 (Anh chốt): BỎ HẲN sàn welcome_min_floor_seconds. Trước đây
    // độ trễ = GREATEST(sàn 60s, welcome_delay) → dù Anh set delay=0/1 vẫn bị ép chờ
    // 60s, làm throughput chậm. Giờ độ trễ welcome = ĐÚNG welcome_delay_seconds Anh
    // nhập (default 1s). Anh toàn quyền, KHÔNG còn sàn cứng chặn. Cột
    // welcome_min_floor_seconds giữ trong schema (không drop để tránh migration) nhưng
    // KHÔNG dùng nữa. Default welcome_delay_seconds đổi 60→1 ở chỗ tạo trigger.
    // Phase 1a: probe claim quét cross-org → bọc runSystemQuery (bypass RLS); xử lý từng
    // row trong withTenant(org) bên dưới.
    const rows = await runSystemQuery(() => prisma.$queryRaw<ProbeRow[]>`
      UPDATE friend_request_outbox
      SET welcome_last_error = ${claimToken}
      WHERE id IN (
        SELECT o.id
        FROM friend_request_outbox o
        JOIN automation_triggers t ON t.id = o.trigger_id
        WHERE o.kind = 'WELCOME_PROBE'
          AND o.welcome_outcome IS NULL
          AND (o.welcome_last_error IS NULL OR o.welcome_last_error NOT LIKE 'claim:%')
          AND o.created_at <= NOW() - make_interval(secs => COALESCE(t.welcome_delay_seconds, 1))
        ORDER BY o.created_at ASC
        LIMIT 5
      )
      RETURNING
        id,
        nick_id,
        contact_id,
        trigger_id,
        welcome_retry_count,
        nick_first_offline_at,
        (SELECT org_id FROM automation_triggers WHERE id = friend_request_outbox.trigger_id) AS org_id
    `);
    for (const row of rows) {
      // Phase 1a 2026-06-08 — mỗi outbox row xử lý trong tenant scope của org nó.
      await withTenant(row.org_id, () => processRow(row)).catch(async (err) => {
        const errMsg = (err?.message ?? String(err)).slice(0, 500);
        logger.error(
          `[welcome-probe] processRow ${row.id} failed: ${errMsg}`,
          err,
        );
        // Clear the claim token so the row is re-pickable on the next tick.
        // Without this, a processRow throw leaves welcome_last_error = 'claim:...'
        // and the row is permanently filtered out by the claim WHERE.
        try {
          await withTenant(row.org_id, () =>
            prisma.friendRequestOutbox.update({
              where: { id: row.id },
              data: { welcomeLastError: errMsg },
            }),
          );
        } catch (recoverErr) {
          logger.error(
            `[welcome-probe] failed to release claim on ${row.id}:`,
            recoverErr,
          );
        }
      });
    }
  } catch (err) {
    logger.error('[welcome-probe] tick error:', err);
  } finally {
    busy = false;
  }
}

export function startWelcomeProbeWorker(): void {
  if (probeInterval) {
    logger.warn('[welcome-probe] already running, skip start');
    return;
  }
  probeInterval = setInterval(() => void runProbeTick(), 10_000);
  logger.info('[welcome-probe] worker started (10s tick, limit 5/tick, 6-22 VN)');
  void runProbeTick();
}

export function stopWelcomeProbeWorker(): void {
  if (probeInterval) {
    clearInterval(probeInterval);
    probeInterval = null;
    logger.info('[welcome-probe] worker stopped');
  }
}

// Wave 3 Event Log — helper: log welcome_blocked với enrichment contact + nick.
// Tách hàm để 2 BLOCKED_STRANGER path (org disabled / Zalo lỗi) share logic.
async function logBlockedStranger(args: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  reason: string;
}): Promise<void> {
  try {
    const [contactRow, nickRow] = await Promise.all([
      prisma.contact.findUnique({
        where: { id: args.contactId },
        select: { fullName: true, crmName: true, phone: true },
      }),
      prisma.zaloAccount.findUnique({
        where: { id: args.nickId },
        select: { displayName: true },
      }),
    ]);
    const contactDisplay =
      contactRow?.crmName?.trim() ||
      contactRow?.fullName?.trim() ||
      contactRow?.phone ||
      'KH';
    const nickDisplay = nickRow?.displayName?.trim() || args.nickId.slice(0, 8);
    void logEvent({
      orgId: args.orgId,
      triggerId: args.triggerId,
      contactId: args.contactId,
      nickId: args.nickId,
      eventType: 'welcome_blocked',
      eventPriority: 'warning',
      summary: `${contactDisplay} chặn tin chào từ nick ${nickDisplay} — Mục tiêu dừng cho nick này`,
      metadata: { reason: args.reason },
    });
  } catch (err) {
    logger.warn(`[welcome-probe] logBlockedStranger enrichment failed contact=${args.contactId}:`, err);
  }
}
