// ════════════════════════════════════════════════════════════════════════
// CareSession (Phiên chăm sóc) — Service trung tâm — 2026-06-07
// ════════════════════════════════════════════════════════════════════════
//
// Tách lớp LẮNG NGHE sự kiện khách + NHẮC sale khỏi trigger/sequence engine.
// Spec: ~/.gstack/projects/locphamnguyen-ZaloCRM/
//        EVO-THANH-private-hs-design-engagement-session-20260607-023703.md
//
// ┌─ D2 (eng-review lock): TẠO PHIÊN ATOMIC ──────────────────────────────┐
// │ enqueueSequenceStart tạo BullMQ job (Redis), KHÔNG phải Postgres write │
// │ → KHÔNG có transaction chung. Pattern đúng:                            │
// │   1. INSERT CareSession (Postgres = CHÂN LÝ) — commit                  │
// │   2. enqueue BullMQ sequence SAU + set sequenceStartEnqueuedAt         │
// │   3. fail bước 2 → cron reconcile quét phiên active chưa enqueue       │
// │ Listener đọc phiên DB nên KHÔNG lệ thuộc BullMQ — phiên là chân lý.    │
// └───────────────────────────────────────────────────────────────────────┘
//
// Allowlist NGHE (D12): trigger state ∈ [active, paused] → VẪN nghe + báo.
//   paused = tạm dừng GỬI tin, nhưng khách reply vẫn phải báo sale.
//   Đóng/ngừng nghe chỉ khi state ∈ [completed, cancelling, cancelled].

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { enqueueSequenceStart } from '../queues/sequence-step-worker.js';

/**
 * Allowlist trạng thái trigger mà CareSession VẪN lắng nghe (D12).
 * paused KHÔNG đóng phiên — chiến dịch tạm dừng gửi tin nhưng khách reply
 * vẫn cần báo sale. Chỉ đóng khi nguồn thực sự kết thúc.
 */
export const LISTENING_TRIGGER_STATES = ['active', 'paused'] as const;

/** Trạng thái trigger coi là "nguồn đã chết" → lazy-close / cascade close. */
export const DEAD_TRIGGER_STATES = ['cancelling', 'cancelled', 'completed'] as const;

export function isListeningState(state: string | null | undefined): boolean {
  return state != null && (LISTENING_TRIGGER_STATES as readonly string[]).includes(state);
}

export type CareSessionSourceType = 'trigger' | 'sequence_manual';

export interface CreateCareSessionInput {
  orgId: string;
  contactId: string;
  nickId: string;
  ownerUserId: string; // sale phụ trách (chủ nick hiệu lực)
  sourceType: CareSessionSourceType;
  sourceTriggerId?: string | null;
  sourceSequenceId?: string | null;
  enrolledByUserId?: string | null; // gắn tay: người bấm (manager); auto: null
  /** Cửa sổ im lặng (ngày) — default 7, lấy từ trigger.closeConditions.silenceDays. */
  silenceDays?: number;
  /** Snapshot điều kiện đóng từ trigger.closeConditions (mỗi phiên luật riêng). */
  closeConditions?: unknown;
  /** Codex #10: snapshot runtimeRules (giờ/sendGap/cooldown) lúc enroll → đổi config
   *  KHÔNG ảnh hưởng KH đang chạy. null = worker fallback đọc rules live của sequence. */
  rulesSnapshot?: unknown;
  /** 2026-06-15: số lần gắn (epoch) — lưu để resume/cancel dùng đúng jobId epoch. */
  enrollEpoch?: number;
  /**
   * Per-nick UID khách (góc nhìn nick sale → nick khách) = Conversation.externalThreadId.
   * Anh chốt 2026-06-08: neo phiên theo (nick, thread). Nếu caller không truyền, hàm tự
   * resolve từ Friend(zaloAccountId=nickId, contactId).zaloUidInNick. null = chưa có (phiên
   * no-Zalo / người lạ chưa accept) → listener fallback "OR null".
   */
  externalThreadId?: string | null;
}

const DEFAULT_SILENCE_DAYS = 7;
const DEFAULT_REENROLL_COOLDOWN_DAYS = 30;

function computeWindowUntil(silenceDays: number): Date {
  const days = Number.isFinite(silenceDays) && silenceDays > 0 ? silenceDays : DEFAULT_SILENCE_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Luật 3 (chống spam, anh chốt D2+D3 + race guard Codex #6): KH đã được gắn CÙNG luồng
 * này trong X ngày qua → CHẶN enroll lại. Mốc = CareSession.openedAt (lần gắn gần nhất).
 *
 * @returns blocked + chi tiết để báo sale rõ: ngày gắn (lastOpenedAt), ngày đóng phiên
 *          (lastClosedAt — null nếu đang chạy), ngày được gắn lại (unlockAt), còn N ngày.
 */
export async function checkReEnrollCooldown(args: {
  orgId: string;
  contactId: string;
  sequenceId: string;
  cooldownDays: number;
}): Promise<{
  blocked: boolean;
  lastOpenedAt?: Date;
  lastClosedAt?: Date | null;
  unlockAt?: Date;
  daysLeft?: number;
  cooldownDays?: number;
}> {
  // FIX (anh test 2026-06-15): cooldownDays === 0 nghĩa là TẮT chống spam (cố ý), KHÔNG
  // fallback default 30. Trước đây `> 0 ? : DEFAULT` khiến 0 bị hiểu thành "chưa set" → vẫn
  // chặn 30 ngày. Chỉ undefined/null/NaN/âm mới dùng default.
  if (args.cooldownDays === 0) return { blocked: false }; // tắt → cho gắn lại ngay
  const days =
    typeof args.cooldownDays === 'number' && args.cooldownDays > 0
      ? args.cooldownDays
      : DEFAULT_REENROLL_COOLDOWN_DAYS;
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - days * dayMs);
  const recent = await prisma.careSession.findFirst({
    where: {
      orgId: args.orgId,
      contactId: args.contactId,
      sourceSequenceId: args.sequenceId,
      openedAt: { gte: cutoff },
    },
    orderBy: { openedAt: 'desc' },
    select: { openedAt: true, closedAt: true },
  });
  if (!recent) return { blocked: false };
  // Được gắn lại = openedAt + cooldown. Còn lại = unlockAt - now (làm tròn LÊN ngày).
  const unlockAt = new Date(recent.openedAt.getTime() + days * dayMs);
  const daysLeft = Math.max(0, Math.ceil((unlockAt.getTime() - Date.now()) / dayMs));
  return {
    blocked: true,
    lastOpenedAt: recent.openedAt,
    lastClosedAt: recent.closedAt,
    unlockAt,
    daysLeft,
    cooldownDays: days,
  };
}

/**
 * Resolve per-nick UID khách (externalThreadId) từ Friend(nickId, contactId).zaloUidInNick.
 * Đây là UID khách nhìn từ nick sale — khớp Conversation.externalThreadId cho thread 'user'.
 * Trả null nếu chưa có Friend row (người lạ chưa accept / no-Zalo) → caller để null, fallback lo.
 */
async function resolveThreadId(nickId: string, contactId: string): Promise<string | null> {
  try {
    const friend = await prisma.friend.findFirst({
      where: { zaloAccountId: nickId, contactId },
      select: { zaloUidInNick: true },
    });
    return friend?.zaloUidInNick ?? null;
  } catch {
    return null;
  }
}

/**
 * Tạo (hoặc tái dùng) 1 CareSession cho 1 khách trong 1 nguồn.
 *
 * D2: Postgres-first. INSERT phiên TRƯỚC → trả về ngay (listener bắt được liền,
 * không phải đợi BullMQ job chạy sau 60 phút). Việc enqueue sequence do caller
 * (event-hook) làm sau qua enqueueSequenceStart như cũ — tách bạch.
 *
 * Dup-guard: 1 khách × 1 trigger đang active = 1 phiên. Nếu đã có phiên mở cho
 * (contactId, nickId, sourceTriggerId) thì TÁI DÙNG, không tạo trùng.
 *
 * @returns sessionId
 */
export async function createCareSession(input: CreateCareSessionInput): Promise<string> {
  const {
    orgId,
    contactId,
    nickId,
    ownerUserId,
    sourceType,
    sourceTriggerId = null,
    sourceSequenceId = null,
    enrolledByUserId = null,
    silenceDays = DEFAULT_SILENCE_DAYS,
    closeConditions = null,
    rulesSnapshot = null,
    enrollEpoch,
  } = input;

  // Per-nick UID (góc nhìn nick→khách). Caller truyền sẵn (route /listen, message-handler);
  // nếu thiếu → tự resolve từ Friend(nickId, contactId).zaloUidInNick. null = chưa có.
  const externalThreadId = input.externalThreadId ?? (await resolveThreadId(nickId, contactId));

  // Dup-guard: phiên mở cùng (contact, nick, nguồn-trigger, SEQUENCE) → tái dùng.
  // sourceTriggerId null (gắn tay thuần) → dedup theo (contact, nick, sequence).
  // 2026-06-08: thêm thread. Tái dùng nếu phiên active có CÙNG thread HOẶC thread NULL
  // (phiên legacy/no-Zalo chưa gắn thread → tái dùng + backfill thread). Thread khác hẳn →
  // tạo phiên mới (2 hội thoại khác nhau của cùng contact+nick = 2 phiên riêng).
  // LỖI B (2026-06-15): nhánh sourceTriggerId PHẢI gồm sourceSequenceId. Manual-enroll dùng
  // CHUNG 1 systemTrigger cho mọi luồng → nếu chỉ match (contact,nick,trigger) thì gắn luồng B
  // sẽ reuse phiên luồng A → luồng B chết. Anh chốt 1 KH chạy nhiều luồng song song được.
  const existing = await prisma.careSession.findFirst({
    where: {
      orgId,
      contactId,
      nickId,
      state: 'active',
      ...(sourceTriggerId
        ? { sourceTriggerId, sourceSequenceId } // gồm cả sequence → 2 luồng khác nhau KHÔNG đụng nhau
        : { sourceSequenceId, sourceType: 'sequence_manual' }),
      ...(externalThreadId
        ? { OR: [{ externalThreadId }, { externalThreadId: null }] }
        : {}),
    },
    select: { id: true, externalThreadId: true },
  });

  if (existing) {
    // Backfill thread cho phiên legacy null nếu giờ đã resolve được.
    if (externalThreadId && !existing.externalThreadId) {
      await prisma.careSession
        .update({ where: { id: existing.id }, data: { externalThreadId } })
        .catch(() => null);
    }
    logger.info(
      `[care-session] reuse existing session=${existing.id} contact=${contactId} ` +
        `nick=${nickId} source=${sourceTriggerId ?? sourceSequenceId} thread=${externalThreadId ?? '∅'}`,
    );
    return existing.id;
  }

  let session: { id: string };
  try {
    session = await prisma.careSession.create({
      data: {
        orgId,
        contactId,
        nickId,
        externalThreadId,
        ownerUserId,
        enrolledByUserId,
        sourceType,
        sourceTriggerId,
        sourceSequenceId,
        state: 'active',
        closeConditions: closeConditions === null ? undefined : (closeConditions as object),
        rulesSnapshot: rulesSnapshot === null ? undefined : (rulesSnapshot as object),
        enrollEpoch: enrollEpoch ?? undefined,
        interestWindowUntil: computeWindowUntil(silenceDays),
      },
      select: { id: true },
    });
  } catch (err) {
    // RACE: 2 path (enroll I31 + self-heal I32) chạy đồng thời cùng giây → cả 2 vượt
    // dup-guard findFirst trước khi commit. Partial unique index (contact,nick,trigger,
    // SEQUENCE,state=active) chặn ở DB → P2002. Tái dùng phiên path kia vừa tạo.
    // LỖI B (2026-06-15): winner lookup PHẢI gồm sourceSequenceId — khớp index mới, không
    // reuse nhầm phiên luồng khác của cùng (contact,nick,trigger).
    if (sourceTriggerId && (err as { code?: string }).code === 'P2002') {
      const winner = await prisma.careSession.findFirst({
        where: { orgId, contactId, nickId, sourceTriggerId, sourceSequenceId, state: 'active' },
        select: { id: true },
      });
      if (winner) {
        logger.info(`[care-session] race dedup (P2002) → reuse session=${winner.id} contact=${contactId}`);
        return winner.id;
      }
    }
    throw err;
  }

  logger.info(
    `[care-session] OPEN session=${session.id} contact=${contactId} nick=${nickId} ` +
      `owner=${ownerUserId} source=${sourceType}:${sourceTriggerId ?? sourceSequenceId} ` +
      `silence=${silenceDays}d`,
  );

  return session.id;
}

// ════════════════════════════════════════════════════════════════════════
// LUẬT 4 (pause/resume) — Sequence recode Đợt 1 (2026-06-13)
// ════════════════════════════════════════════════════════════════════════
//
// Anh chốt: khách reply → TẠM DỪNG bám đuổi (ARCH#1=B: dừng CẢ luồng của khách); hết
// phiên (im lặng → janitor đóng / sale xử lý) → CHẠY TIẾP từ bước dở. KHÔNG remove job
// (review bắt: cơ chế cũ job.remove() xóa tiến độ → không resume được).
//
// Thiết kế:
//   PAUSE  : reply → ghi pausedAtStepIdx (bước dở) + pauseEpoch++ vào MỌI phiên active
//            của khách. Job delayed GIỮ NGUYÊN; worker GUARD check pause flag trước send.
//   GUARD  : worker check Redis pause flag ngay TRƯỚC Zalo send (Codex #3 active-send race).
//            Pause → moveToDelayed lại (không gửi). Tiến độ đã ghi ở pausedAtStepIdx.
//   RESUME : cron quét phiên CLOSED còn pausedAtStepIdx (pauseEpoch khớp — Codex #2) →
//            re-enqueue đúng (trigger,sequence,contact,step) → clear marker.

/**
 * PAUSE (luật 4): khách reply → ghi bước dở + tăng epoch cho mọi phiên active của khách.
 * stepIdxBySequence: map sourceSequenceId → stepIdx hiện tại (caller scan BullMQ 1 lần).
 *
 * @returns số phiên đã pause-mark
 */
export async function pauseSessionsOnReply(args: {
  orgId: string;
  contactId: string;
  stepIdxBySequence: Map<string, number>;
}): Promise<{ paused: number }> {
  const sessions = await prisma.careSession.findMany({
    where: { orgId: args.orgId, contactId: args.contactId, state: 'active', sourceSequenceId: { not: null } },
    select: { id: true, sourceSequenceId: true, pauseEpoch: true },
  });
  let paused = 0;
  for (const s of sessions) {
    const stepIdx = s.sourceSequenceId ? args.stepIdxBySequence.get(s.sourceSequenceId) : undefined;
    // stepIdx undefined = không có job pending (đã gửi xong / chưa bắt đầu) → vẫn tăng
    // epoch để chống resume cũ, nhưng pausedAtStepIdx null (resume không re-enqueue).
    await prisma.careSession
      .update({
        where: { id: s.id },
        data: {
          pausedAtStepIdx: stepIdx ?? null,
          pauseEpoch: (s.pauseEpoch ?? 0) + 1,
        },
      })
      .catch((e) => logger.warn(`[care-session] pauseSessionsOnReply update failed session=${s.id}: ${(e as Error).message}`));
    paused++;
  }
  if (paused > 0) {
    logger.info(`[care-session] LUẬT 4 pause-mark ${paused} phiên contact=${args.contactId} (reply)`);
  }
  return { paused };
}

/**
 * Đánh dấu phiên đã enqueue BullMQ start (D2 reconcile marker).
 * Gọi NGAY SAU enqueueSequenceStart thành công → reconcile biết không cần enqueue lại.
 */
export async function markSequenceStartEnqueued(sessionId: string): Promise<void> {
  await prisma.careSession.update({
    where: { id: sessionId },
    data: { sequenceStartEnqueuedAt: new Date() },
  });
}

/**
 * Tạo phiên từ TRIGGER tự động + enqueue sequence (D2 thứ tự an toàn).
 *
 * Thay thế lời gọi enqueueSequenceStart trần trong onFriendAccepted:
 *   1. createCareSession (Postgres commit) — listener bắt được ngay
 *   2. enqueueSequenceStart (BullMQ) — nếu fail, phiên vẫn tồn tại, reconcile lo
 *   3. markSequenceStartEnqueued (đánh dấu đã enqueue)
 *
 * @returns sessionId (null nếu thiếu dữ liệu để tạo)
 */

/**
 * resolveNextEnrollEpoch — số lần gắn KẾ TIẾP cho (contact, sequence).
 *
 * Dùng CHUNG cho cả gắn tay (manual-enroll) lẫn tự động (materializer event-driven).
 * = MAX(enrollEpoch các phiên cũ) + 1. KHÔNG dùng count+1 vì count không monotonic
 * (1 lần tạo phiên fail → count thiếu → epoch tái dùng → jobId đụng job cũ còn sống → dedup
 * nuốt = đúng bug gốc). Phiên cũ enrollEpoch NULL (data trước cột) = ngầm hiểu 1.
 *
 * LẦN ĐẦU (chưa phiên nào) → trả 1 → jobId `...-e1-0` (giữ idempotency probe friend-invite
 * vốn dựa trên epoch=1). Chỉ re-enroll (đã có phiên cũ) mới > 1 → jobId mới không đụng job cũ.
 */
export async function resolveNextEnrollEpoch(
  orgId: string,
  contactId: string,
  sequenceId: string,
): Promise<number> {
  const agg = await prisma.careSession.aggregate({
    where: { orgId, contactId, sourceSequenceId: sequenceId },
    _max: { enrollEpoch: true },
    _count: { _all: true },
  });
  const maxEpoch = agg._max.enrollEpoch ?? (agg._count._all > 0 ? 1 : 0);
  return maxEpoch + 1;
}

export async function enrollFromTrigger(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  ownerUserId: string;
  sequenceId: string | null;
  sequenceStartDelayMinutes?: number;
  // Path materializer (NGƯỜI LẠ) ĐÃ tự enqueue STEP 0 trước khi gọi enroll →
  // skipEnqueue=true để CHỈ tạo phiên lắng nghe, không enqueue lại (tránh double-path).
  skipEnqueue?: boolean;
  // Bám đuổi THỦ CÔNG: sale tự gắn KH vào → ghi ai gắn (manual). null = tự động.
  enrolledByUserId?: string | null;
  // 2026-06-15: số lần gắn (epoch) — gắn lại tăng → lưu vào phiên để resume/cancel đúng epoch.
  enrollEpoch?: number;
}): Promise<string | null> {
  // CareSession 2026-06-07 (anh chốt): điều kiện đóng là CHUNG cấp ORG, KHÔNG
  // per-trigger. Đọc org.careCloseConditions, snapshot vào phiên.
  const orgCfg = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { careCloseConditions: true },
  });
  const closeConditions = orgCfg?.careCloseConditions ?? null;
  const silenceDays = extractSilenceDays(closeConditions);

  // Luật 3 + Codex #10 (snapshot): đọc runtimeRules của sequence → cooldown + snapshot.
  let rulesSnapshot: Record<string, unknown> | null = null;
  let cooldownDays = DEFAULT_REENROLL_COOLDOWN_DAYS;
  if (input.sequenceId) {
    const seq = await prisma.automationSequence.findUnique({
      where: { id: input.sequenceId },
      select: { runtimeRules: true },
    });
    rulesSnapshot = (seq?.runtimeRules as Record<string, unknown>) ?? null;
    const cd = rulesSnapshot?.reEnrollCooldownDays;
    // FIX (anh test 2026-06-15): cd === 0 = TẮT cooldown (cố ý) → truyền 0 xuống (hàm
    // check hiểu 0 = không chặn). Trước đây `cd > 0` bỏ qua 0 → giữ default 30.
    if (typeof cd === 'number' && cd >= 0) cooldownDays = cd;

    // Luật 3 — chặn enroll lại cùng luồng trong cooldown (anh chốt D2: mốc openedAt).
    const cool = await checkReEnrollCooldown({
      orgId: input.orgId,
      contactId: input.contactId,
      sequenceId: input.sequenceId,
      cooldownDays,
    });
    if (cool.blocked) {
      logger.info(
        `[care-session] CHẶN enroll lại — luật 3 cooldown ${cooldownDays}d contact=${input.contactId} ` +
          `sequence=${input.sequenceId} (lần trước ${cool.lastOpenedAt?.toISOString()})`,
      );
      return null; // caller (manual-enroll) báo sale "khách vừa trong luồng này N ngày trước".
    }
  }

  const sessionId = await createCareSession({
    orgId: input.orgId,
    contactId: input.contactId,
    nickId: input.nickId,
    ownerUserId: input.ownerUserId,
    sourceType: 'trigger',
    sourceTriggerId: input.triggerId,
    sourceSequenceId: input.sequenceId,
    enrolledByUserId: input.enrolledByUserId ?? null,
    silenceDays,
    closeConditions,
    rulesSnapshot, // Codex #10: snapshot rules lúc enroll
    enrollEpoch: input.enrollEpoch, // 2026-06-15: số lần gắn
  });

  // D2 bước 2: enqueue SAU khi phiên đã commit. Fail không làm hỏng phiên.
  if (input.sequenceId && !input.skipEnqueue) {
    try {
      await enqueueSequenceStart({
        triggerId: input.triggerId,
        contactId: input.contactId,
        sequenceId: input.sequenceId,
        nickId: input.nickId,
        orgId: input.orgId,
        startDelayMinutes: input.sequenceStartDelayMinutes,
        enrollEpoch: input.enrollEpoch, // LỖI 5: job step 0 phải cùng epoch với phiên, không thì gắn lại trigger đụng jobId cũ
      });
      await markSequenceStartEnqueued(sessionId);
    } catch (err) {
      // Phiên vẫn tồn tại — reconcile cron sẽ enqueue lại (jobId dedup an toàn).
      logger.warn(
        `[care-session] enqueue sequence FAILED session=${sessionId} ` +
          `(phiên vẫn active, reconcile sẽ retry): ${(err as Error).message}`,
      );
    }
  } else if (input.sequenceId && input.skipEnqueue) {
    // Path materializer: STEP 0 đã enqueue NGOÀI hàm này. Đánh dấu để reconcile cron
    // KHÔNG enqueue lại (nếu không sequenceStartEnqueuedAt=null → reconcile tưởng chưa gửi).
    await markSequenceStartEnqueued(sessionId).catch(() => null);
  }

  return sessionId;
}

/**
 * SELF-HEAL (anh chốt 2026-06-07): mỗi STEP bám đuổi tự đảm bảo phiên tồn tại.
 *
 * Vấn đề: phiên chỉ tạo 1 lần ở STEP 0 (materializer/onFriendAccepted). Nếu phiên
 * mất/đóng giữa chừng mà luồng còn chạy → luồng "mồ côi", khách reply không ai báo.
 *
 * Quy tắc AN TOÀN — phân biệt "đóng có chủ ý" vs "mất bất thường":
 *   - Đã có phiên ACTIVE      → tái dùng (no-op).
 *   - Đã có phiên ĐÃ ĐÓNG     → TÔN TRỌNG, KHÔNG hồi sinh. Phiên đóng vì lý do thật
 *                               (khách chặn / sale đóng / đạt điều kiện / im lặng) →
 *                               luồng cũng nên dừng, không tự đẻ phiên mới đè lên.
 *   - KHÔNG có phiên nào      → luồng MỒ CÔI (phiên bị xóa/chưa kịp tạo) → tạo lại.
 *
 * @returns sessionId nếu vừa tạo mới (heal), null nếu đã có phiên (active/closed) → bỏ qua.
 */
export async function ensureCareSessionForStep(input: {
  orgId: string;
  triggerId: string;
  contactId: string;
  nickId: string;
  ownerUserId: string;
  sequenceId: string | null;
  enrollEpoch?: number; // FIX3 2026-06-17: epoch của job đang chạy → phiên heal cùng epoch.
}): Promise<string | null> {
  // Có BẤT KỲ phiên nào (active HOẶC closed) cho (contact, nick, trigger) → không heal.
  const any = await prisma.careSession.findFirst({
    where: {
      orgId: input.orgId,
      contactId: input.contactId,
      nickId: input.nickId,
      sourceTriggerId: input.triggerId,
    },
    select: { id: true, state: true },
  });
  if (any) return null; // active → đang chạy đúng; closed → tôn trọng, không hồi sinh.

  // Luồng mồ côi: không có phiên nào → tạo lại (KHÔNG enqueue, luồng đã chạy sẵn).
  const orgCfg = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { careCloseConditions: true },
  });
  const closeConditions = orgCfg?.careCloseConditions ?? null;
  const sessionId = await createCareSession({
    orgId: input.orgId,
    contactId: input.contactId,
    nickId: input.nickId,
    ownerUserId: input.ownerUserId,
    sourceType: 'trigger',
    sourceTriggerId: input.triggerId,
    sourceSequenceId: input.sequenceId,
    silenceDays: extractSilenceDays(closeConditions),
    closeConditions,
    enrollEpoch: input.enrollEpoch, // FIX3: heal đúng epoch của job (không để NULL→1 lệch).
  });
  await markSequenceStartEnqueued(sessionId).catch(() => null);
  logger.info(
    `[care-session] SELF-HEAL phiên mồ côi → tạo lại session=${sessionId} ` +
      `contact=${input.contactId} trigger=${input.triggerId}`,
  );
  return sessionId;
}

/** Lấy silenceDays từ closeConditions JSON (default 7). */
function extractSilenceDays(closeConditions: unknown): number {
  if (closeConditions && typeof closeConditions === 'object' && 'silenceDays' in closeConditions) {
    const v = (closeConditions as { silenceDays?: unknown }).silenceDays;
    if (typeof v === 'number' && v > 0) return v;
  }
  return DEFAULT_SILENCE_DAYS;
}

/**
 * RESUME (luật 4, cron): phiên đã CLOSED (khách im đủ lâu → janitor đóng / sale xử lý)
 * mà còn pausedAtStepIdx → re-enqueue ĐÚNG bước dở của ĐÚNG luồng → chạy tiếp.
 *
 * Codex #2 (chống "close cũ hồi sinh send sau reply mới"): chỉ resume nếu KHÔNG có
 * customer activity SAU khi pause. Phiên closedReason='janitor_silence' nghĩa là khách
 * đã im suốt cửa sổ → an toàn chạy tiếp. closedReason khác (sale_resolved, deal_won,
 * stranger_blocked, customer_blocked) = KHÔNG resume (sale chủ ý đóng / KH chặn).
 *
 * jobId mới có sequenceId → re-enqueue đúng luồng. clear pausedAtStepIdx sau khi enqueue.
 *
 * @returns số luồng đã resume
 */
export async function resumePausedSequences(): Promise<{ resumed: number }> {
  const { getSequenceStepQueue, buildSequenceStepJobId } = await import('../queues/queue-registry.js');
  const { clearContactPauseFlag } = await import('../queues/event-hooks.js');
  const tickStart = new Date();
  const sel = {
    id: true, orgId: true, contactId: true, nickId: true,
    sourceTriggerId: true, sourceSequenceId: true, pausedAtStepIdx: true,
    lastCustomerActivityAt: true, closedAt: true, pausedUntil: true, enrollEpoch: true,
  };

  // Nhánh 1 (cũ): phiên đã CLOSED janitor_silence còn pausedAtStepIdx → chạy tiếp.
  const closedStuck = await prisma.careSession.findMany({
    where: {
      state: 'closed',
      closedReason: 'janitor_silence', // chỉ im-lặng-tự-đóng mới chạy tiếp
      pausedAtStepIdx: { not: null },
      sourceSequenceId: { not: null },
      sourceTriggerId: { not: null },
    },
    select: sel,
    take: 200,
  });
  // Nhánh 2 (FIX1 2026-06-17 — anh chốt): phiên ACTIVE đã HẾT HOLD (pausedUntil<=now) còn
  // pausedAtStepIdx → TỰ chạy tiếp dù phiên chưa đóng. Trước đây đứng tới khi đóng (~7 ngày) = BUG.
  // Reply handler đã tự bơm pausedUntil mỗi reply → pausedUntil<=now nghĩa là KH im đủ hold.
  const activeExpired = await prisma.careSession.findMany({
    where: {
      state: 'active',
      pausedAtStepIdx: { not: null },
      pausedUntil: { lte: tickStart },
      sourceSequenceId: { not: null },
      sourceTriggerId: { not: null },
    },
    select: sel,
    take: 200,
  });

  const rows = [
    ...closedStuck.map((s) => ({ ...s, kind: 'closed' as const })),
    ...activeExpired.map((s) => ({ ...s, kind: 'active' as const })),
  ];
  if (rows.length === 0) return { resumed: 0 };
  const queue = getSequenceStepQueue();
  let resumed = 0;

  for (const s of rows) {
    if (!s.sourceTriggerId || !s.sourceSequenceId || s.pausedAtStepIdx == null) continue;
    // Guard "khách đang chat" → KHÔNG gửi đè. closed: activity SAU khi đóng (Codex #2).
    // active: activity SAU khi bắt đầu hold (lastCustomerActivityAt > pausedUntil) → reply
    // handler đã bơm pausedUntil nên thường đã loại; đây là chốt chặn race lúc cron đọc.
    const guardRef = s.kind === 'closed' ? s.closedAt : s.pausedUntil;
    if (s.lastCustomerActivityAt && guardRef && s.lastCustomerActivityAt > guardRef) {
      if (s.kind === 'closed') {
        await prisma.careSession.update({ where: { id: s.id }, data: { pausedAtStepIdx: null } }).catch(() => null);
      }
      logger.info(`[care-session] resume SKIP session=${s.id} kind=${s.kind} — khách có activity mới (đừng gửi đè)`);
      continue;
    }
    try {
      const seq = await prisma.automationSequence.findUnique({
        where: { id: s.sourceSequenceId },
        select: { steps: true, runtimeRules: true },
      });
      const steps = Array.isArray(seq?.steps) ? (seq!.steps as unknown[]) : [];
      if (s.pausedAtStepIdx >= steps.length) {
        // Bước dở vượt quá số step (data lệch) → chỉ clear marker.
        await prisma.careSession.update({ where: { id: s.id }, data: { pausedAtStepIdx: null } }).catch(() => null);
        continue;
      }
      const epoch = s.enrollEpoch ?? 1;
      const jobId = buildSequenceStepJobId(s.sourceTriggerId, s.sourceSequenceId, s.contactId, s.pausedAtStepIdx, epoch);
      // jobId dedup: nếu job còn trong queue (chưa bị remove) thì không double.
      const existing = await queue.getJob(jobId);
      if (!existing) {
        await queue.add(
          'sequence-step',
          {
            triggerId: s.sourceTriggerId,
            contactId: s.contactId,
            sequenceId: s.sourceSequenceId,
            nickId: s.nickId,
            orgId: s.orgId,
            stepIdx: s.pausedAtStepIdx,
            totalSteps: steps.length,
            // re-review MED #2: chuyền runtimeRules → bước sau khi resume vẫn đúng luật 1+2.
            runtimeRules: (seq?.runtimeRules as Record<string, unknown>) ?? undefined,
            enrollEpoch: epoch,
          },
          { jobId, delay: 0 }, // hết hold → gửi tiếp ngay (giờ hoạt động + throttle do worker guard lo)
        );
      }
      // FIX1 FOLD-1 + FIX5 (chỉ nhánh active — closed giữ nguyên hành vi cũ):
      //   - clear cờ Redis: worker check cờ Redis TRƯỚC marker DB (sequence-step-worker:347),
      //     không clear thì job re-defer ở gate Redis = resume vô tác dụng.
      //   - đổi queueStatus customer_reply → processing: sale không thấy "KH Reply/đã dừng" oan
      //     khi luồng đã chạy lại.
      if (s.kind === 'active') {
        await clearContactPauseFlag(s.sourceTriggerId, s.contactId).catch(() => null);
        await prisma.triggerQueueEntry.updateMany({
          where: { triggerId: s.sourceTriggerId, contactId: s.contactId, queueStatus: 'customer_reply' },
          data: { queueStatus: 'processing' },
        }).catch(() => null);
      }
      await prisma.careSession.update({ where: { id: s.id }, data: { pausedAtStepIdx: null } });
      resumed++;
      logger.info(`[care-session] LUẬT 4 resume session=${s.id} kind=${s.kind} step=${s.pausedAtStepIdx} contact=${s.contactId}`);
    } catch (err) {
      logger.warn(`[care-session] resume failed session=${s.id}: ${(err as Error).message}`);
    }
  }

  if (resumed > 0) {
    logger.info(`[care-session] LUẬT 4 resumed ${resumed} luồng (closed-silence + active-hết-hold)`);
  }
  return { resumed };
}

/**
 * Reconcile (cron, D2 bước 3): tìm phiên active đã quá hạn enqueue mà chưa có
 * sequenceStartEnqueuedAt → enqueue lại. jobId dedup nên enqueue trùng an toàn.
 *
 * "Đã có customer activity trước khi enqueue" (Codex): nếu phiên đã có
 * lastCustomerActivityAt (khách reply rồi) thì KHÔNG enqueue start nữa — không
 * khởi chạy sequence sau khi khách đã phản hồi.
 *
 * @returns số phiên đã reconcile
 */
export async function reconcileMissingSequenceStart(): Promise<{ recovered: number }> {
  // Phiên active, có nguồn sequence, chưa enqueue, mở > 2 phút (đủ lâu để loại race).
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  const stuck = await prisma.careSession.findMany({
    where: {
      state: 'active',
      sequenceStartEnqueuedAt: null,
      sourceSequenceId: { not: null },
      openedAt: { lte: cutoff },
      // Codex: khách đã reply → KHÔNG khởi chạy sequence.
      lastCustomerActivityAt: null,
    },
    select: {
      id: true,
      orgId: true,
      contactId: true,
      nickId: true,
      sourceTriggerId: true,
      sourceSequenceId: true,
      enrollEpoch: true, // FIX review-epoch #1 (LỖI 1): reconcile phải dùng đúng epoch của phiên
    },
    take: 200, // batch nhỏ, cron chạy lại lượt sau nếu còn
  });

  let recovered = 0;
  for (const s of stuck) {
    if (!s.sourceSequenceId || !s.sourceTriggerId) continue;
    try {
      await enqueueSequenceStart({
        triggerId: s.sourceTriggerId,
        contactId: s.contactId,
        sequenceId: s.sourceSequenceId,
        nickId: s.nickId,
        orgId: s.orgId,
        startDelayMinutes: 0, // đã trễ rồi, gửi sớm
        enrollEpoch: s.enrollEpoch ?? 1, // FIX#1: jobId đúng epoch (không tạo job e1 cho phiên e2)
      });
      await markSequenceStartEnqueued(s.id);
      recovered++;
    } catch (err) {
      logger.warn(
        `[care-session] reconcile enqueue failed session=${s.id}: ${(err as Error).message}`,
      );
    }
  }

  if (recovered > 0) {
    logger.info(`[care-session] reconcile recovered ${recovered} missing sequence starts`);
  }
  return { recovered };
}

// ════════════════════════════════════════════════════════════════════════
// T3 — LISTENER: đọc phiên mở + lazy-close + ghi event idempotent
// ════════════════════════════════════════════════════════════════════════

export type CareEventType =
  | 'reply'
  | 'reaction_pos'
  | 'reaction_neg'
  | 'friend_accept'
  | 'friend_reject'
  | 'blocked';

/** Map CareEventType → eventKey trong trigger.notifyChannels (D-notify). */
export const CARE_EVENT_TO_NOTIFY_KEY: Record<CareEventType, string> = {
  reply: 'reply',
  reaction_pos: 'reactionPositive',
  reaction_neg: 'reactionNegative',
  friend_accept: 'friendAccept',
  friend_reject: 'friendReject',
  blocked: 'block',
};

export interface ListeningSession {
  id: string;
  orgId: string;
  ownerUserId: string;
  enrolledByUserId: string | null;
  sourceType: string;
  sourceTriggerId: string | null;
  sourceSequenceId: string | null;
  triggerState: string | null; // state của trigger nguồn (null nếu gắn tay/đã xoá)
  triggerName: string | null;
}

/**
 * eventId chuẩn hóa (D-notify + audit S2): phân tán, KHÔNG sequential per-session
 * → tránh hot unique-index khi KH spam reaction. Ưu tiên id provider ổn định;
 * friend-event không có id → fallback timestamp-bucket 60s.
 */
export function buildCareEventId(args: {
  nickId: string;
  contactId: string;
  eventType: CareEventType;
  providerId?: string | null;
  timestampMs?: number;
}): string {
  const stable = args.providerId?.trim();
  if (stable) {
    return `${args.nickId}:${args.contactId}:${args.eventType}:${stable}`;
  }
  // Fallback: bucket 60s (friend_accept/reject/blocked không có providerId ổn định).
  const ms = args.timestampMs ?? 0;
  const bucket = Math.floor(ms / 60_000);
  return `${args.nickId}:${args.contactId}:${args.eventType}:t${bucket}`;
}

/**
 * Đọc các phiên ĐANG MỞ cho (orgId, contactId, nickId) — hot-path listener (D10).
 *
 * 1 query JOIN AutomationTrigger để re-validate trigger.state ngay trong kết quả
 * (lazy-close, D12): nguồn ∈ [completed,cancelling,cancelled] → ĐÓNG phiên + loại
 * khỏi kết quả (sót cascade KHÔNG gây mis-fire). Nguồn ∈ [active,paused] → VẪN nghe.
 * Phiên gắn tay (sourceTriggerId=null) không có trigger → luôn nghe tới khi đóng tay.
 *
 * Per-nick thread (2026-06-08): nếu truyền externalThreadId, CHỈ lấy phiên khớp đúng
 * hội thoại đó HOẶC phiên legacy chưa gắn thread (externalThreadId=null) → không vỡ phiên
 * cũ. KHÔNG truyền externalThreadId → giữ hành vi cũ (mọi phiên của contact+nick).
 *
 * @returns danh sách phiên CÒN HỢP LỆ để pause + notify.
 */
export async function findListeningSessionsForEvent(args: {
  orgId: string;
  contactId: string;
  nickId: string;
  externalThreadId?: string | null;
}): Promise<ListeningSession[]> {
  const rows = await prisma.careSession.findMany({
    where: {
      orgId: args.orgId,
      contactId: args.contactId,
      nickId: args.nickId,
      state: 'active',
      // Per-nick thread filter (fallback OR null cho phiên legacy/no-Zalo).
      ...(args.externalThreadId
        ? { OR: [{ externalThreadId: args.externalThreadId }, { externalThreadId: null }] }
        : {}),
    },
    select: {
      id: true,
      orgId: true,
      ownerUserId: true,
      enrolledByUserId: true,
      sourceType: true,
      sourceTriggerId: true,
      sourceSequenceId: true,
      trigger: { select: { state: true, name: true } },
    },
  });

  const valid: ListeningSession[] = [];
  const toClose: string[] = [];

  for (const r of rows) {
    const triggerState = r.trigger?.state ?? null;
    // Nguồn trigger đã chết → lazy-close (phiên gắn tay triggerState=null → bỏ qua check này).
    if (triggerState != null && !isListeningState(triggerState)) {
      toClose.push(r.id);
      continue;
    }
    valid.push({
      id: r.id,
      orgId: r.orgId,
      ownerUserId: r.ownerUserId,
      enrolledByUserId: r.enrolledByUserId,
      sourceType: r.sourceType,
      sourceTriggerId: r.sourceTriggerId,
      sourceSequenceId: r.sourceSequenceId,
      triggerState,
      triggerName: r.trigger?.name ?? null,
    });
  }

  if (toClose.length > 0) {
    await prisma.careSession.updateMany({
      where: { id: { in: toClose }, state: 'active' },
      data: { state: 'closed', closedReason: 'source_done', closedAt: new Date() },
    });
    logger.info(`[care-session] lazy-closed ${toClose.length} session(s) — nguồn trigger đã chết`);
  }

  return valid;
}

/**
 * Ghi 1 customer event lên 1 phiên — TXN NGẮN 3 GHI (D4), idempotent.
 *
 * Bọc trong $transaction:
 *   1. INSERT CareSessionEvent (unique sessionId+eventId) — chống double-process
 *   2. reset interestWindowUntil (cửa sổ im lặng nạp lại, D13)
 *   3. cập nhật lastCustomerActivityAt
 *
 * Đọc/re-validate đã làm NGOÀI txn (findListeningSessionsForEvent). Notify enqueue
 * cũng NGOÀI txn (caller). Giữ connection tối thiểu (hot-path, D4).
 *
 * @returns true nếu event MỚI (cần pause+notify), false nếu đã xử lý (dup → bỏ qua).
 */
export async function recordCustomerEventOnSession(args: {
  sessionId: string;
  eventId: string;
  eventType: CareEventType;
  silenceDays?: number;
  payload?: unknown;
}): Promise<boolean> {
  const windowUntil = computeWindowUntil(args.silenceDays ?? DEFAULT_SILENCE_DAYS);
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Idempotency gate — INSERT trùng → P2002 → đã xử lý.
      await tx.careSessionEvent.create({
        data: {
          sessionId: args.sessionId,
          eventId: args.eventId,
          eventType: args.eventType,
          payload: args.payload === undefined ? undefined : (args.payload as object),
        },
      });
      // 2 + 3. Reset cửa sổ im lặng + mốc hoạt động.
      await tx.careSession.update({
        where: { id: args.sessionId },
        data: {
          interestWindowUntil: windowUntil,
          lastCustomerActivityAt: new Date(),
        },
      });
    });
    return true; // event mới
  } catch (err) {
    // P2002 unique violation = event đã xử lý (khách reply 2 lần / Zalo gửi trùng).
    if ((err as { code?: string }).code === 'P2002') {
      logger.info(`[care-session] dup event ${args.eventId} session=${args.sessionId} — bỏ qua`);
      return false;
    }
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════
// T6 — JANITOR: đóng phiên im-lặng quá hạn (cron, set-based, D5)
// ════════════════════════════════════════════════════════════════════════

// In-process lock chống overlap (D5 + audit: pausedUntilSweeper hiện THIẾU guard này).
let janitorRunning = false;

/**
 * Đóng phiên im-lặng đến hạn — 1 set-based UPDATE (D5: tải thật ~1-2k phiên, KHÔNG
 * cần batch-LIMIT/jitter). isRunning guard chống sweep chồng sweep.
 *
 * WHERE state='active' AND interestWindowUntil<=NOW() AND lastCustomerActivityAt<tickStart
 *   → điều kiện lastCustomerActivityAt<tickStart CHẶN RACE (audit S1): khách nhắn
 *     sát giờ janitor tick (listener đang reset window) → KHÔNG đóng nhầm phiên vừa
 *     active lại. tickStart chốt 1 lần đầu sweep.
 *
 * @returns số phiên đã đóng
 */
export async function sweepSilentCareSessions(): Promise<{ closed: number }> {
  if (janitorRunning) {
    logger.info('[care-session] janitor đang chạy, skip tick này (overlap guard)');
    return { closed: 0 };
  }
  janitorRunning = true;
  const tickStart = new Date();
  try {
    // Set-based UPDATE — đóng cả lô 1 câu (rẻ ở 1-2k phiên).
    const result = await prisma.careSession.updateMany({
      where: {
        state: 'active',
        interestWindowUntil: { lte: tickStart },
        // S1 race guard: chỉ đóng phiên KHÔNG có hoạt động sau khi tick bắt đầu.
        OR: [
          { lastCustomerActivityAt: null },
          { lastCustomerActivityAt: { lt: tickStart } },
        ],
      },
      data: {
        state: 'closed',
        closedReason: 'janitor_silence',
        closedAt: tickStart,
      },
    });
    if (result.count > 0) {
      logger.info(`[care-session] janitor đóng ${result.count} phiên im-lặng quá hạn`);
    }
    return { closed: result.count };
  } catch (err) {
    logger.warn(`[care-session] janitor sweep failed: ${(err as Error).message}`);
    return { closed: 0 };
  } finally {
    janitorRunning = false;
  }
}

// ════════════════════════════════════════════════════════════════════════
// T7 — EVENT-DRIVEN CLOSE (block / status / tag) + MASS-CLOSE (hủy trigger)
// ════════════════════════════════════════════════════════════════════════

export type CareCloseReason =
  | 'customer_blocked'
  | 'sale_resolved'
  | 'deal_won'
  | 'status_matched'
  | 'tag_matched'
  | 'source_done';

/**
 * Đóng các phiên mở của 1 khách trên 1 nick (event-driven, đóng NGAY).
 * Dùng khi: khách chặn (customer_blocked), sale bấm "đã xử lý" (sale_resolved).
 * @returns số phiên đóng
 */
export async function closeCareSessionsForContact(args: {
  orgId: string;
  contactId: string;
  nickId?: string;
  reason: CareCloseReason;
}): Promise<{ closed: number }> {
  const result = await prisma.careSession.updateMany({
    where: {
      orgId: args.orgId,
      contactId: args.contactId,
      state: 'active',
      ...(args.nickId ? { nickId: args.nickId } : {}),
    },
    data: { state: 'closed', closedReason: args.reason, closedAt: new Date() },
  });
  if (result.count > 0) {
    logger.info(
      `[care-session] closed ${result.count} session(s) contact=${args.contactId} reason=${args.reason}`,
    );
  }
  return { closed: result.count };
}

/**
 * Đóng 1 phiên cụ thể (sale bấm "đã xử lý" trên side panel).
 */
export async function closeCareSessionById(
  sessionId: string,
  reason: CareCloseReason,
): Promise<boolean> {
  const result = await prisma.careSession.updateMany({
    where: { id: sessionId, state: 'active' },
    data: { state: 'closed', closedReason: reason, closedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Đóng phiên khi khách ĐẠT TRẠNG THÁI / GẮN TAG trong closeConditions (event-driven).
 *
 * Gọi từ điểm sale đổi status (update-status action) hoặc gắn tag (FriendTag/ContactTag
 * insert). Mỗi phiên snapshot closeConditions riêng → check từng phiên.
 *
 * @param matchKind 'status' | 'friendTag' | 'crmTag'
 * @param matchedId statusId / tagId vừa gắn
 * @returns số phiên đóng
 */
export async function closeCareSessionsOnConditionMatch(args: {
  orgId: string;
  contactId: string;
  matchKind: 'status' | 'friendTag' | 'crmTag';
  matchedId: string;
}): Promise<{ closed: number }> {
  const sessions = await prisma.careSession.findMany({
    where: { orgId: args.orgId, contactId: args.contactId, state: 'active' },
    select: { id: true, closeConditions: true },
  });

  const fieldByKind = {
    status: 'onStatusIds',
    friendTag: 'onFriendTagIds',
    crmTag: 'onCrmTagIds',
  } as const;
  const field = fieldByKind[args.matchKind];

  const toClose: string[] = [];
  for (const s of sessions) {
    const cc = s.closeConditions as Record<string, unknown> | null;
    if (!cc) continue;
    const ids = cc[field];
    if (Array.isArray(ids) && ids.includes(args.matchedId)) {
      toClose.push(s.id);
    }
  }

  if (toClose.length === 0) return { closed: 0 };

  const reason: CareCloseReason = args.matchKind === 'status' ? 'status_matched' : 'tag_matched';
  const result = await prisma.careSession.updateMany({
    where: { id: { in: toClose }, state: 'active' },
    data: { state: 'closed', closedReason: reason, closedAt: new Date() },
  });
  logger.info(
    `[care-session] closed ${result.count} session(s) on ${args.matchKind} match=${args.matchedId} contact=${args.contactId}`,
  );
  return { closed: result.count };
}

/**
 * HELPER onTagAdded (anh chốt 2026-06-07): gọi SAU khi gắn Friend/CRM tag thành công
 * để đóng phiên nếu tag ∈ closeConditions.onFriendTagIds / onCrmTagIds.
 *
 * Fire-and-forget, non-fatal (tag đã gắn thành công, chỉ phần đóng phiên best-effort).
 * Gom 1 chỗ để 6 điểm gắn tag (manual route + auto-detect + auto-engagement + crm route
 * + contact PUT + AI suggest) wire đồng nhất. matchedId = Tag.id (definition).
 */
export async function onTagAdded(args: {
  orgId: string;
  contactId: string;
  tagKind: 'friendTag' | 'crmTag';
  tagId: string;
}): Promise<void> {
  try {
    await closeCareSessionsOnConditionMatch({
      orgId: args.orgId,
      contactId: args.contactId,
      matchKind: args.tagKind,
      matchedId: args.tagId,
    });
  } catch (err) {
    logger.warn(
      `[care-session] onTagAdded close failed ${args.tagKind}=${args.tagId} contact=${args.contactId}: ${(err as Error).message}`,
    );
  }
}

/**
 * MASS-CLOSE: đóng mọi phiên của 1 trigger (khi hủy/hoàn thành Mục tiêu).
 *
 * ⚠️ audit (eng-review): KHÔNG đóng đồng bộ trong request hủy trigger — có thể
 * nhiều nghìn phiên. Hàm này set-based UPDATE 1 câu (rẻ ở tải thật), nhưng GỌI
 * TỪ JOB NỀN (cron/queue) chứ không từ HTTP request hủy trigger trực tiếp.
 * cascade close cũng được backstop bởi lazy-close ở listener (sót vẫn vô hại).
 *
 * @returns số phiên đóng
 */
export async function closeCareSessionsForTrigger(
  triggerId: string,
  reason: CareCloseReason = 'source_done',
): Promise<{ closed: number }> {
  const result = await prisma.careSession.updateMany({
    where: { sourceTriggerId: triggerId, state: 'active' },
    data: { state: 'closed', closedReason: reason, closedAt: new Date() },
  });
  if (result.count > 0) {
    logger.info(`[care-session] mass-closed ${result.count} session(s) for trigger=${triggerId} reason=${reason}`);
  }
  return { closed: result.count };
}

// ════════════════════════════════════════════════════════════════════════
// T10c — DISPATCH NOTIFY 3 ĐÍCH (owner / manager / group) + Privacy (D8)
// ════════════════════════════════════════════════════════════════════════

/** Đọc trigger.notifyChannels[eventKey] → đích nào bật. Default owner=true. */
function resolveEnabledTargets(
  notifyChannels: unknown,
  eventKey: string,
): { owner: boolean; manager: boolean; group: boolean } {
  const nc = notifyChannels as Record<string, { owner?: boolean; manager?: boolean; zaloGroup?: boolean }> | null;
  const cfg = nc?.[eventKey];
  // Chưa cấu hình → giữ hành vi cũ: chỉ owner.
  if (!cfg) return { owner: true, manager: false, group: false };
  return {
    owner: cfg.owner !== false,
    manager: cfg.manager === true,
    group: cfg.zaloGroup === true,
  };
}

/**
 * Bắn thông báo CareSession tới 3 đích theo cấu hình + privacy (D8/D7/D12).
 *
 * - owner   = sale phụ trách (ownerUserId), nội dung ĐẦY ĐỦ, urgency cao.
 * - manager = quản lý trực tiếp (getManagerOfUser), nội dung ẩn SĐT+tin, tin "để biết".
 * - group   = UID nhóm org (internalNotifyGroupThreadId), tên viết tắt.
 *
 * Mỗi đích render riêng (renderNotifyForTarget) + dedup theo (eventId, recipient)
 * để đa phiên cùng sale → 1 tin. Notify enqueue ASYNC (ngoài txn pause).
 */
export async function dispatchCareNotify(args: {
  orgId: string;
  eventType: import('./notify-privacy.js').CareNotifyEvent;
  eventKey: string; // key trong careNotifyChannels (reply|reactionPositive|...)
  eventId: string; // để dedup
  ownerUserId: string;
  contactId: string;
  contactName: string;
  contactPhone?: string | null;
  contentPreview?: string | null;
  saleName?: string | null;
  triggerId?: string | null;
  triggerName?: string | null;
  // 2026-06-15 (anh báo): thông báo Zalo nội bộ phải hiện TÊN LUỒNG thật + bước, không
  // fallback về tên trigger ("Bám đuổi khách hàng thủ công").
  sequenceName?: string | null;
  stepInfo?: { idx: number; total: number } | null;
}): Promise<void> {
  const { renderNotifyForTarget } = await import('./notify-privacy.js');
  const { enqueueNotify } = await import('../queues/internal-notify-worker.js');
  // CareSession 2026-06-07 (anh chốt): cấu hình lắng nghe là CHUNG cấp ORG, KHÔNG
  // per-trigger. Đọc org.careNotifyChannels (1 bộ quy tắc cho mọi Mục tiêu).
  const orgCfg = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: { careNotifyChannels: true },
  });
  const targets = resolveEnabledTargets(orgCfg?.careNotifyChannels, args.eventKey);

  const renderInput = {
    eventType: args.eventType,
    contactName: args.contactName,
    contactPhone: args.contactPhone,
    contentPreview: args.contentPreview,
    saleName: args.saleName,
    triggerName: args.triggerName,
  };

  const kind = 'customer-reply' as const; // reuse hook kind (template chung)
  const baseJob = {
    kind,
    orgId: args.orgId,
    contactId: args.contactId,
    contactName: args.contactName,
    nickName: '',
    triggerId: args.triggerId ?? undefined,
    triggerName: args.triggerName ?? undefined,
    // truyền tên LUỒNG + bước → worker hiện "📍 Luồng: {sequence} › Bước N/M" đúng.
    sequenceName: args.sequenceName ?? undefined,
    stepInfo: args.stepInfo ?? undefined,
  };

  // ── Owner (đầy đủ) ──
  if (targets.owner && args.ownerUserId) {
    await enqueueNotify({
      ...baseJob,
      targetUserId: args.ownerUserId,
      contactPhone: args.contactPhone ?? undefined,
      replyPreview: renderNotifyForTarget({ ...renderInput, target: 'owner' }),
      dedupeKey: `${args.eventId}-${args.ownerUserId}`,
    });
  }

  // ── Manager (ẩn SĐT/nội dung, tin "để biết") ──
  if (targets.manager) {
    const { getManagerOfUser } = await import('../../rbac/department-service.js');
    const managerId = await getManagerOfUser(args.ownerUserId);
    if (managerId) {
      await enqueueNotify({
        ...baseJob,
        targetUserId: managerId,
        replyPreview: renderNotifyForTarget({ ...renderInput, target: 'manager' }),
        dedupeKey: `${args.eventId}-mgr-${managerId}`,
      });
    }
  }

  // ── Group (viết tắt, gửi tới UID nhóm) ──
  if (targets.group) {
    const org = await prisma.organization.findUnique({
      where: { id: args.orgId },
      select: { internalNotifyGroupThreadId: true },
    });
    if (org?.internalNotifyGroupThreadId) {
      // Group gửi thẳng qua system-notify với recipientType='group' (không qua targetUser).
      const { sendGroupNotification } = await import('./group-notify.js');
      await sendGroupNotification({
        orgId: args.orgId,
        groupThreadId: org.internalNotifyGroupThreadId,
        content: renderNotifyForTarget({ ...renderInput, target: 'group' }),
        dedupeKey: `${args.eventId}-grp`,
      }).catch((err) => {
        logger.warn(`[care-session] group notify failed: ${(err as Error).message}`);
      });
    }
  }
}
