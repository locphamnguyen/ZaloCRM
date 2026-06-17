// Phase Friend Invite Queue 2026-05-28 — Routes cho Mục tiêu friend_invite_to_list.
//
// Endpoints:
//   POST   /api/v1/automation/triggers/friend-invite       create Mục tiêu (draft state)
//   POST   /api/v1/automation/triggers/:id/activate        precompute + spawn workers
//   POST   /api/v1/automation/triggers/:id/pause           stop workers (state=paused)
//   POST   /api/v1/automation/triggers/:id/resume          re-spawn workers
//   POST   /api/v1/automation/triggers/:id/cancel          drain + cancel
//   GET    /api/v1/automation/triggers/:id/dashboard       counters + nick load + recent entries

import type { FastifyInstance } from 'fastify';
import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { closeCareSessionsForTrigger } from '../care-session/care-session-service.js';
import { precomputeAndSeedPool, isFriendInviteSegmentSpec } from './skip-precompute.js';
import { startNickWorker, stopNickWorker, getNickWorkerState } from './nick-worker.js';
import {
  calculateMucTieuPreview,
  type PreviewInput,
} from './preview-eta-service.js';
import { listMucTieuForOrg } from './muc-tieu-list-service.js';
import { getSequenceStepQueue } from '../queues/queue-registry.js';
import { getContactPauseRemaining } from '../queues/event-hooks.js';

const BASE = '/api/v1/automation/triggers';

// ════════════════════════════════════════════════════════════════════════
// Per-trigger task-progress cache (P1 2026-06-02)
// ════════════════════════════════════════════════════════════════════════
// Rebuild "Bước hiện tại / Lần gửi gần nhất / Lần gửi tiếp theo" cho dashboard
// đọc 2 nguồn: BullMQ sequence-step queue (delayed/waiting/active) + bảng
// AutomationEventLog (eventType='sequence_step_sent'). Mỗi lần dashboard load
// gọi getJobs(['delayed','waiting','active'], 0, 5000) → scan O(N_jobs). Nếu 10
// sale F5 cùng lúc → 10× scan. Cache 60s in-memory per triggerId để tránh
// stampede. Cache reset mỗi 60s (TTL absolute, không sliding) — đủ tươi cho UI
// timeline đồng thời giảm tải Redis.
interface TaskProgress {
  currentStepIdx: number | null;
  state: string | null;
  lastSentAt: Date | null;
  nextRunAt: Date | null;
}
interface TaskProgressCacheEntry {
  expiresAt: number;
  byContact: Map<string, TaskProgress>;
}
const TASK_PROGRESS_TTL_MS = 60_000;
const taskProgressCache = new Map<string, TaskProgressCacheEntry>();

async function getTaskProgressForTrigger(
  triggerId: string,
): Promise<Map<string, TaskProgress>> {
  const now = Date.now();
  const cached = taskProgressCache.get(triggerId);
  if (cached && cached.expiresAt > now) {
    return cached.byContact;
  }

  const byContact = new Map<string, TaskProgress>();

  // ── 1) BullMQ jobs (delayed/waiting/active) cho trigger này ──
  // jobId pattern (queue-registry.ts:buildSequenceStepJobId) = `${triggerId}-${contactId}-${stepIdx}`.
  // Filter strict bằng prefix `${triggerId}-` để loại jobs của trigger khác
  // (BullMQ getJobs return MANY across triggers).
  try {
    const queue = getSequenceStepQueue();
    const jobs = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 5000);
    for (const job of jobs) {
      // FIX4 2026-06-17: đọc THẲNG job.data (triggerId/contactId/stepIdx) thay vì parse chuỗi
      // jobId. jobId đã đổi format nhiều lần (thêm sequenceId+epoch 2026-06-13) → parse chuỗi
      // mong manh + phải đoán contactId 36 ký tự. job.data có sẵn các field → robust, không phụ
      // thuộc format jobId. (Thay parser chuỗi cũ 3c8eecc; gỡ trùng với cách 67794e5 agent kia.)
      const d = job.data as { triggerId?: string; contactId?: string; stepIdx?: number } | undefined;
      if (!d || d.triggerId !== triggerId) continue; // chỉ job của trigger này
      const contactId = d.contactId;
      const stepIdx = d.stepIdx;
      if (!contactId || typeof stepIdx !== 'number' || !Number.isFinite(stepIdx)) continue;

      // job.timestamp = ms epoch khi enqueue; job.opts.delay = ms delay.
      // nextRunAt = timestamp + delay (cho delayed jobs). active/waiting → now-ish.
      const delayMs = job.opts?.delay ?? 0;
      const ts = job.timestamp ?? now;
      const nextRunAt = new Date(ts + delayMs);
      // Synthesize task state cho deriveKHFinalState: active→running, else queued.
      // BullMQ không expose `getState` synchronously trên job object trả từ
      // getJobs (cần await job.getState()). Để tránh N×Redis-roundtrip, em treat
      // bất kỳ pending job nào (delayed/waiting/active) là 'queued' — derive
      // dashboard chỉ phân biệt queued/running vs done/failed, cả 2 nhánh ra
      // 'in_sequence' nên không ảnh hưởng UI.
      const synthState = 'queued';

      const existing = byContact.get(contactId);
      if (!existing) {
        byContact.set(contactId, {
          currentStepIdx: stepIdx,
          state: synthState,
          lastSentAt: null,
          nextRunAt,
        });
      } else {
        // Cùng contact có nhiều jobs (edge: race sweeper) → pick EARLIEST
        // nextRunAt (giống pattern cũ orderBy scheduledAt asc).
        if (!existing.nextRunAt || nextRunAt < existing.nextRunAt) {
          existing.nextRunAt = nextRunAt;
          existing.currentStepIdx = stepIdx;
        }
      }
    }
  } catch (err) {
    logger.warn(
      `[friend-invite] getTaskProgressForTrigger BullMQ scan failed trigger=${triggerId}: ${(err as Error).message}`,
    );
  }

  // ── 2) AutomationEventLog → "Lần gửi gần nhất" + BƯỚC ĐÃ GỬI (fallback currentStepIdx) ──
  // sequence-step-worker ghi 'sequence_step_sent' detail "step N/M" (N 0-based) sau mỗi
  // lần gửi. 2026-06-17 FIX: KH không còn job BullMQ pending (xong chuỗi / bị dừng / KH
  // reply → job huỷ / chuỗi khựng) thì section 1 KHÔNG set currentStepIdx → trước đây
  // FE hiện "0/16" dù KH đã tới bước N. Suy currentStepIdx từ bước gửi gần nhất trong
  // event log (DISTINCT ON contact_id: 1 dòng mới nhất/contact → hiệu quả, không kéo cả bảng).
  try {
    const sentRows = await prisma.$queryRaw<Array<{ contact_id: string; detail: string | null; created_at: Date }>>`
      SELECT DISTINCT ON (contact_id) contact_id, detail, created_at
      FROM automation_event_log
      WHERE trigger_id = ${triggerId}
        AND event_type = 'sequence_step_sent'
        AND contact_id IS NOT NULL
      ORDER BY contact_id, created_at DESC
    `;
    for (const row of sentRows) {
      if (!row.contact_id) continue;
      const m = row.detail?.match(/step (\d+)\//);
      const stepIdx = m ? parseInt(m[1], 10) : null;
      const lastSentAt = row.created_at ?? null;
      const existing = byContact.get(row.contact_id);
      if (existing) {
        existing.lastSentAt = lastSentAt;
        // Job live (section 1) ưu tiên cho bước SẮP gửi; chỉ fallback từ log khi null.
        if (existing.currentStepIdx === null && stepIdx !== null) {
          existing.currentStepIdx = stepIdx;
        }
      } else {
        // Không còn job pending → dùng bước gửi gần nhất làm "Bước hiện tại"
        // (thay vì null → "0/16"). state=null để derive logic giữ nguyên hành vi cũ.
        byContact.set(row.contact_id, {
          currentStepIdx: stepIdx,
          state: null,
          lastSentAt,
          nextRunAt: null,
        });
      }
    }
  } catch (err) {
    logger.warn(
      `[friend-invite] getTaskProgressForTrigger event_log scan failed trigger=${triggerId}: ${(err as Error).message}`,
    );
  }

  taskProgressCache.set(triggerId, {
    expiresAt: now + TASK_PROGRESS_TTL_MS,
    byContact,
  });
  return byContact;
}

/**
 * Test/admin hook — invalidate cache cho trigger cụ thể (hoặc tất cả nếu null).
 * Export để outbox sweeper hoặc unit test có thể bust cache khi cần.
 */
export function invalidateTaskProgressCache(triggerId?: string | null): void {
  if (triggerId) {
    taskProgressCache.delete(triggerId);
  } else {
    taskProgressCache.clear();
  }
}

/**
 * Xóa HẲN (vĩnh viễn) Mục tiêu friend_invite_to_list — logic nghiệp vụ riêng (Anh chốt
 * 2026-06-05): chỉ xóa khi state ∈ cancelled/draft/completed, stop nick-workers trước,
 * unlink entries (giữ KH trong tệp gốc), xóa campaigns/outbox/eventlog rồi trigger.
 *
 * Tách khỏi route DELETE để route chung /triggers/:id (trigger-routes) phân luồng
 * theo eventType — tránh 2 file cùng khai báo DELETE /triggers/:id (FST_ERR_DUPLICATED_ROUTE).
 * Trả discriminated result để caller map đúng HTTP status.
 */
export type DeleteFriendInviteResult =
  | { ok: true }
  | { ok: false; status: number; error: string; current?: string; hint?: string };

export async function deleteFriendInviteTrigger(opts: {
  triggerId: string;
  orgId: string;
}): Promise<DeleteFriendInviteResult> {
  const { triggerId: id, orgId } = opts;
  const trigger = await prisma.automationTrigger.findFirst({
    where: { id, orgId, eventType: 'friend_invite_to_list' },
    select: { id: true, state: true, segmentSpec: true, isSystemTrigger: true },
  });
  if (!trigger) return { ok: false, status: 404, error: 'trigger_not_found' };
  // M9 — system trigger KHÔNG cho xóa.
  if (trigger.isSystemTrigger)
    return { ok: false, status: 403, error: 'system_trigger_protected' };
  if (!['cancelled', 'draft', 'completed'].includes(trigger.state))
    return {
      ok: false,
      status: 409,
      error: 'must_cancel_first',
      current: trigger.state,
      hint: 'Hãy Xóa (đưa vào thùng rác) trước khi xoá hẳn',
    };

  // Stop workers trước.
  const spec = trigger.segmentSpec;
  if (isFriendInviteSegmentSpec(spec)) {
    for (const nickId of spec.nickIds) void stopNickWorker(nickId);
  }

  // FK order: campaigns → queue rows (hàng đợi per-trigger) → outbox → eventlog → trigger.
  // #2 2026-06-06 — xóa hàng đợi = DELETE row bảng nối (giữ KH trong tệp gốc, chỉ bỏ
  // quan hệ với Mục tiêu này). KHÔNG còn null cột trên entry.
  // (FK trigger_queue_entries.trigger_id ON DELETE CASCADE đằng nào cũng dọn khi delete
  //  trigger; nhưng deleteMany tường minh để chạy trong cùng tx + log rõ ràng.)
  await tenantTransaction(async (tx) => {
    await tx.automationCampaign.deleteMany({ where: { orgId, triggerId: id } });
    await tx.triggerQueueEntry.deleteMany({ where: { triggerId: id } });
    await tx.friendRequestOutbox.deleteMany({ where: { triggerId: id } });
    await tx.automationEventLog.deleteMany({ where: { triggerId: id } });
    await tx.automationTrigger.delete({ where: { id } });
  });

  // #2 2026-06-06 (vá lỗ hổng phát hiện 06-06h) — dọn BullMQ sequence-step jobs còn treo.
  // Trước đây delete trigger không gỡ jobs → job cũ chạy ngầm gửi nhầm. Best-effort.
  try {
    const { getSequenceStepQueue } = await import('../queues/queue-registry.js');
    const queue = getSequenceStepQueue();
    const jobs = await queue.getJobs(['delayed', 'waiting', 'active', 'paused'], 0, 5000);
    const prefix = `${id}-`;
    let removed = 0;
    for (const job of jobs) {
      if (typeof job.id === 'string' && job.id.startsWith(prefix)) {
        await job.remove().catch(() => {});
        removed++;
      }
    }
    if (removed > 0) logger.info(`[friend-invite] deleteTrigger ${id}: gỡ ${removed} BullMQ sequence-step jobs treo`);
  } catch (err) {
    logger.warn(`[friend-invite] deleteTrigger ${id}: dọn BullMQ jobs thất bại (non-fatal):`, err);
  }

  invalidateTaskProgressCache(id);
  return { ok: true };
}

// ── Helper: parse quiet/working hour "HH:MM" → int hour 0-23 (Wave 4 #C) ───
// Wizard B3 gửi `quietHoursStart`/`quietHoursEnd` dạng "HH:MM" (label UI:
// "⏰ Giờ hoạt động" — nghĩa là working window, không phải quiet window).
// BE cần int hour cho schema columns sendHourStart/sendHourEnd. Nếu undefined
// hoặc parse fail → trả `fallback` (default từ schema). Out-of-range 0-23 cũng
// rơi về fallback để FE không thể seed giờ bậy.
export function parseQuietHour(s: string | undefined, fallback: number): number {
  if (!s || typeof s !== 'string') return fallback;
  const head = s.split(':')[0];
  const n = parseInt(head, 10);
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return n;
}

// ── Helper: derive KH final state (Phase Friend Invite UI 2026-05-30) ──────
// Trả về trạng thái KH ở góc nhìn "đường đời 1 KH trong Mục tiêu":
//   - 'pending_friend'  : chưa gửi friend-request (entry vẫn queued/processing,
//                          chưa có Friend.accepted row cho contact này)
//   - 'phase1_done'     : friend-request đã accepted (Friend row accepted),
//                          NHƯNG chưa enroll Sequence (task null)
//   - 'in_sequence'     : đang chạy Sequence (task.state ∈ queued/running)
//   - 'sequence_done'   : Sequence đã chạy xong (task.state ∈ done/skipped)
//   - 'stopped'         : entry bị dừng giữa chừng (queueStatus ∈ failed_*,
//                          cancelled, skipped_*) HOẶC task.state='failed'
//
// Inputs:
//   entry: row CustomerListEntry tối thiểu cần queueStatus + hasZalo + contactId
//   latestTask: AutomationTask mới nhất cho contactId+sequenceId (state +
//     currentStepIdx + executedAt + scheduledAt). null nếu chưa enroll.
//   friendAccepted: boolean — Friend.friendshipStatus='accepted' tồn tại cho
//     contactId này (cho bất kỳ nick nào trong org).
export type KHFinalState =
  | 'pending_friend'
  | 'phase1_done'
  | 'in_sequence'
  | 'sequence_done'
  | 'stopped';

export function deriveKHFinalState(
  entry: { queueStatus: string | null; hasZalo: boolean | null; contactId: string | null },
  latestTask: { state: string | null } | null,
  friendAccepted: boolean,
  // FIX 2026-06-04: KH đã gửi BƯỚC CUỐI của chuỗi (event sequence_step_sent stepIdx cuối).
  // Vì BullMQ jobs hết sau khi xong → task progress trả null → trước đây derive nhầm
  // thành phase1_done dù đã gửi đủ 3/3 (nhất là khi KH reply che mất). sequenceCompleted
  // ưu tiên CAO: KH đi hết chuỗi = sequence_done, kể cả có reply/pause sau đó.
  sequenceCompleted = false,
): KHFinalState {
  // Entry đã dừng (failed permanent/stuck, cancelled, skipped_*) → stopped.
  // skipped_no_zalo: KH không có Zalo, không gửi được friend-request — coi là dừng.
  const stoppedStatuses = new Set([
    'failed_permanent',
    'failed_stuck',
    'cancelled',
    'skipped_friend_cap',
    'skipped_recency',
    'skipped_status',
    'skipped_no_zalo',
  ]);
  if (entry.queueStatus && stoppedStatuses.has(entry.queueStatus)) {
    return 'stopped';
  }

  // Đã gửi bước cuối → hoàn tất chuỗi (ưu tiên trước task progress vì jobs đã hết).
  if (sequenceCompleted) return 'sequence_done';

  // Task tồn tại → ưu tiên state task (Sequence là phase 2, sau friend-accept).
  if (latestTask?.state) {
    if (latestTask.state === 'done' || latestTask.state === 'skipped') return 'sequence_done';
    if (latestTask.state === 'failed') return 'stopped';
    if (latestTask.state === 'queued' || latestTask.state === 'running') return 'in_sequence';
  }

  // Chưa có task → check friend-accept.
  if (friendAccepted) return 'phase1_done';

  return 'pending_friend';
}

export async function friendInviteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── POST /friend-invite — Create draft trigger ────────────────────────────
  app.post<{
    Body: {
      name: string;
      listId: string;
      nickIds: string[];
      successorSequenceId: string;
      greetingTemplate: string;
      skipRules: { recencyDays: number; friendCap: number; entryStatuses: string[] };
      ruleOverrides?: Record<string, unknown>;
      // Wave 2 2026-05-29 — per-trigger welcome message (replaces org-wide config)
      welcomeMessageTemplate?: string | null;
      welcomeDelaySeconds?: number;
      // I10 2026-06-04 — cấu trúc 5 tin: Tin 2 Cảm ơn + 4 cờ enable + notifyChannels.
      thankYouTemplate?: string | null;
      thankYouDelaySeconds?: number;
      remindTemplate?: string | null;
      remindDelayDays?: number;
      rejectedTemplate?: string | null;
      enableWelcome?: boolean;
      enableThankYou?: boolean;
      enableRemind?: boolean;
      enableRejectedFollowUp?: boolean;
      // #1 2026-06-06 — 2 công tắc bám đuổi theo trạng thái kết bạn.
      followUpStrangerEnabled?: boolean;
      followUpFriendEnabled?: boolean;
      notifyChannels?: Record<string, { owner?: boolean; manager?: boolean; zaloGroup?: boolean }>;
      // CareSession 2026-06-07 — điều kiện đóng phiên per-Mục-tiêu.
      closeConditions?: { onStatusIds?: string[]; onFriendTagIds?: string[]; onCrmTagIds?: string[]; silenceDays?: number };
      // BE T4 2026-05-30 — Lên lịch hẹn giờ activate.
      // startMode='now'      → kích hoạt ngay khi gọi /activate (default).
      // startMode='scheduled'→ giữ state='draft' + lưu scheduledAt, cron sẽ flip.
      // scheduledAt: ISO string, BẮT BUỘC future + hour VN ∈ [6, 22].
      startMode?: 'now' | 'scheduled';
      scheduledAt?: string | null;
      // Wave 4 #C 2026-06-02 — Wizard B3 safetyRules persist into 8 trigger schema columns.
      // Mapping:
      //   quietHoursStart   "HH:MM" → sendHourStart            (int hour)
      //   quietHoursEnd     "HH:MM" → sendHourEnd              (int hour)
      //   sendIntervalSeconds       → minFriendReqGapMs        (×1000 ms)
      //   recencyDays               → recencySkipDays
      //   multinickThreshold        → multiNickThreshold
      //   delayAfterFriendRequestMin→ sequenceStartDelayMinutes
      //   pauseHoursOnReply         → pauseOnActivityHours
      // concurrencyPerNickPerMinute giữ default schema (1) — wizard không có field này.
      safetyRules?: {
        quietHoursStart?: string;
        quietHoursEnd?: string;
        sendIntervalSeconds?: number;
        recencyDays?: number;
        multinickThreshold?: number;
        delayAfterFriendRequestMin?: number;
        // 2026-06-16 — bản GIÂY của delay trên (Wizard B3 cho nhập giây, mặc định 10s).
        // Ưu tiên field này khi có; giữ delayAfterFriendRequestMin cho tương thích cũ.
        delayAfterFriendRequestSeconds?: number;
        pauseHoursOnReply?: number;
        // #3 2026-06-06 — nhịp gửi lời mời (phút) + sàn welcome + cửa sổ warm (Anh nhập trên UI)
        friendReqIntervalMinMinutes?: number;
        friendReqIntervalMaxMinutes?: number;
        welcomeMinFloorSeconds?: number;
        warmWindowDays?: number;
      };
    };
  }>(`${BASE}/friend-invite`, { preHandler: requireGrant('trigger', 'create') }, async (request, reply) => {
    const user = request.user!;
    const body = request.body;

    // Validate
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name_required' });
    if (!body.listId) return reply.status(400).send({ error: 'listId_required' });
    if (!Array.isArray(body.nickIds) || body.nickIds.length === 0)
      return reply.status(400).send({ error: 'nickIds_required' });
    if (!body.successorSequenceId)
      return reply.status(400).send({ error: 'successorSequenceId_required' });
    if (!body.greetingTemplate?.trim())
      return reply.status(400).send({ error: 'greetingTemplate_required' });
    if (body.greetingTemplate.length > 200)
      return reply.status(400).send({ error: 'greetingTemplate_too_long' });
    if (!body.greetingTemplate.includes('{name}'))
      return reply
        .status(400)
        .send({ error: 'greetingTemplate_missing_name', hint: 'Phải chứa biến {name}' });

    // Wave 2 2026-05-29 — per-trigger welcome message validation.
    // Null/empty = welcome gate is SKIPPED (drainer enrolls Sequence directly).
    let welcomeTemplate: string | null = null;
    if (body.welcomeMessageTemplate !== undefined && body.welcomeMessageTemplate !== null) {
      const trimmed = String(body.welcomeMessageTemplate).trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 4000)
          return reply
            .status(400)
            .send({ error: 'welcomeMessageTemplate_too_long', hint: 'Tối đa 4000 ký tự' });
        if (!trimmed.includes('{name}') && !trimmed.includes('{gender}'))
          return reply.status(400).send({
            error: 'welcomeMessageTemplate_missing_var',
            hint: 'Phải chứa {name} hoặc {gender}',
          });
        welcomeTemplate = trimmed;
      }
    }

    // FIX 2026-06-08 (Anh chốt): default 60→1. Sàn welcome_min_floor đã bỏ → độ trễ
    // welcome = đúng giá trị này. Anh để trống = 1s (gửi tin chào gần như ngay).
    let welcomeDelaySeconds = 1;
    if (body.welcomeDelaySeconds !== undefined) {
      const v = Number(body.welcomeDelaySeconds);
      if (!Number.isFinite(v) || v < 0 || v > 3600)
        return reply
          .status(400)
          .send({ error: 'welcomeDelaySeconds_invalid', hint: 'Phải từ 0 đến 3600 giây' });
      welcomeDelaySeconds = Math.round(v);
    }

    // BE T4 2026-05-30 — Validate startMode + scheduledAt.
    // Rule: nếu startMode='scheduled' → scheduledAt phải là ISO future + giờ VN
    // ∈ [6, 22] (tuân thủ project_zalocrm_automation_delay_rules: avoid late-night
    // friend-add spam → nick mới risk). startMode='now' (hoặc undefined) → bỏ qua
    // scheduledAt (FE có thể gửi nhưng BE phớt lờ để tránh "lẫn lộn" giữa hai mode).
    const startMode: 'now' | 'scheduled' = body.startMode === 'scheduled' ? 'scheduled' : 'now';
    let scheduledAtUtc: Date | null = null;
    if (startMode === 'scheduled') {
      if (!body.scheduledAt) {
        return reply.status(400).send({ error: 'scheduledAt_required', hint: 'startMode=scheduled cần scheduledAt ISO' });
      }
      const d = new Date(body.scheduledAt);
      if (Number.isNaN(d.getTime())) {
        return reply.status(400).send({ error: 'scheduledAt_invalid', hint: 'ISO 8601 string' });
      }
      const now = Date.now();
      if (d.getTime() <= now) {
        return reply.status(400).send({ error: 'scheduledAt_not_future', hint: 'Phải là thời điểm trong tương lai' });
      }
      // Giờ VN của thời điểm scheduled (UTC + 7h).
      const vnHour = new Date(d.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
      if (vnHour < 6 || vnHour > 22) {
        return reply.status(400).send({
          error: 'scheduledAt_out_of_hours',
          hint: 'Giờ VN phải trong khoảng 6h–22h',
          vnHour,
        });
      }
      scheduledAtUtc = d;
    }

    // Verify list belongs to org
    const list = await prisma.customerList.findFirst({
      where: { id: body.listId, orgId: user.orgId },
      select: { id: true, totalEntries: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    // Verify all nicks belong to org
    const nicks = await prisma.zaloAccount.findMany({
      where: { id: { in: body.nickIds }, orgId: user.orgId },
      select: { id: true },
    });
    if (nicks.length !== body.nickIds.length)
      return reply.status(400).send({ error: 'some_nicks_not_found' });

    // Verify sequence belongs to org
    const sequence = await prisma.automationSequence.findFirst({
      where: { id: body.successorSequenceId, orgId: user.orgId },
      select: { id: true, enabled: true },
    });
    if (!sequence) return reply.status(404).send({ error: 'sequence_not_found' });

    // ── Wave 4 #C 2026-06-02 — Map safetyRules (wizard B3) → 8 schema columns.
    // Mọi field optional. Nếu missing/invalid → dùng default schema (đọc 2046-2061).
    // Validate ranges (reject 400 nếu out-of-range):
    //   hour 0-23, gap 1-3600s, recency 0-365 ngày, pause 1-720h,
    //   sequenceStartDelay 0-10080 phút (1 tuần), multinickThreshold 0-100.
    const sr = body.safetyRules ?? {};
    const sendHourStart = parseQuietHour(sr.quietHoursStart, 6);
    const sendHourEnd = parseQuietHour(sr.quietHoursEnd, 22);

    let minFriendReqGapMs = 60000;
    if (sr.sendIntervalSeconds !== undefined) {
      const v = Number(sr.sendIntervalSeconds);
      if (!Number.isFinite(v) || v < 1 || v > 3600) {
        return reply
          .status(400)
          .send({ error: 'sendIntervalSeconds_invalid', hint: 'Phải từ 1 đến 3600 giây' });
      }
      minFriendReqGapMs = Math.round(v * 1000);
    }

    let recencySkipDays = 30;
    if (sr.recencyDays !== undefined) {
      const v = Number(sr.recencyDays);
      if (!Number.isFinite(v) || v < 0 || v > 365) {
        return reply
          .status(400)
          .send({ error: 'recencyDays_invalid', hint: 'Phải từ 0 đến 365 ngày' });
      }
      recencySkipDays = Math.round(v);
    }

    let multiNickThreshold = 0;
    if (sr.multinickThreshold !== undefined) {
      const v = Number(sr.multinickThreshold);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return reply
          .status(400)
          .send({ error: 'multinickThreshold_invalid', hint: 'Phải từ 0 đến 100' });
      }
      multiNickThreshold = Math.round(v);
    }

    // 2026-06-16 — delay sau lời mời → bước 1 bám đuổi. Ưu tiên GIÂY (Wizard B3),
    // set cả 2 cột: seconds = chính xác, minutes = làm tròn (cho reader cũ). NULL không
    // xảy ra ở create (luôn có default 60 phút / 3600 giây).
    let sequenceStartDelayMinutes = 60;
    let sequenceStartDelaySeconds: number = 3600;
    if (sr.delayAfterFriendRequestSeconds !== undefined) {
      const v = Number(sr.delayAfterFriendRequestSeconds);
      if (!Number.isFinite(v) || v < 0 || v > 604800)
        return reply.status(400).send({
          error: 'delayAfterFriendRequestSeconds_invalid',
          hint: 'Phải từ 0 đến 604800 giây (7 ngày)',
        });
      sequenceStartDelaySeconds = Math.round(v);
      sequenceStartDelayMinutes = Math.round(v / 60);
    } else if (sr.delayAfterFriendRequestMin !== undefined) {
      const v = Number(sr.delayAfterFriendRequestMin);
      if (!Number.isFinite(v) || v < 0 || v > 10080) {
        return reply.status(400).send({
          error: 'delayAfterFriendRequestMin_invalid',
          hint: 'Phải từ 0 đến 10080 phút (1 tuần)',
        });
      }
      sequenceStartDelayMinutes = Math.round(v);
      sequenceStartDelaySeconds = sequenceStartDelayMinutes * 60;
    }

    let pauseOnActivityHours = 24;
    if (sr.pauseHoursOnReply !== undefined) {
      const v = Number(sr.pauseHoursOnReply);
      if (!Number.isFinite(v) || v < 1 || v > 720) {
        return reply
          .status(400)
          .send({ error: 'pauseHoursOnReply_invalid', hint: 'Phải từ 1 đến 720 giờ (30 ngày)' });
      }
      pauseOnActivityHours = Math.round(v);
    }

    // #3 2026-06-06 — nhịp gửi lời mời (phút). Min ≤ Max, range 0..1440 (24h).
    let friendReqIntervalMinMinutes = 20;
    let friendReqIntervalMaxMinutes = 40;
    if (sr.friendReqIntervalMinMinutes !== undefined) {
      const v = Number(sr.friendReqIntervalMinMinutes);
      if (!Number.isFinite(v) || v < 0 || v > 1440)
        return reply.status(400).send({ error: 'friendReqIntervalMin_invalid', hint: 'Phải từ 0 đến 1440 phút' });
      friendReqIntervalMinMinutes = Math.round(v);
    }
    if (sr.friendReqIntervalMaxMinutes !== undefined) {
      const v = Number(sr.friendReqIntervalMaxMinutes);
      if (!Number.isFinite(v) || v < 0 || v > 1440)
        return reply.status(400).send({ error: 'friendReqIntervalMax_invalid', hint: 'Phải từ 0 đến 1440 phút' });
      friendReqIntervalMaxMinutes = Math.round(v);
    }
    if (friendReqIntervalMaxMinutes < friendReqIntervalMinMinutes)
      return reply.status(400).send({ error: 'friendReqInterval_range', hint: 'Nhịp tối đa phải ≥ nhịp tối thiểu' });

    let welcomeMinFloorSeconds = 60;
    if (sr.welcomeMinFloorSeconds !== undefined) {
      const v = Number(sr.welcomeMinFloorSeconds);
      if (!Number.isFinite(v) || v < 0 || v > 3600)
        return reply.status(400).send({ error: 'welcomeMinFloorSeconds_invalid', hint: 'Phải từ 0 đến 3600 giây' });
      welcomeMinFloorSeconds = Math.round(v);
    }

    let warmWindowDays = 30;
    if (sr.warmWindowDays !== undefined) {
      const v = Number(sr.warmWindowDays);
      if (!Number.isFinite(v) || v < 0 || v > 365)
        return reply.status(400).send({ error: 'warmWindowDays_invalid', hint: 'Phải từ 0 đến 365 ngày' });
      warmWindowDays = Math.round(v);
    }

    // Cross-field validation: working window phải hợp lệ (start < end).
    if (sendHourStart >= sendHourEnd) {
      return reply.status(400).send({
        error: 'workingHours_invalid_range',
        hint: 'Giờ bắt đầu phải nhỏ hơn giờ kết thúc',
        sendHourStart,
        sendHourEnd,
      });
    }

    // Create trigger in 'draft' state. Activation happens via separate endpoint.
    const trigger = await prisma.automationTrigger.create({
      data: {
        orgId: user.orgId,
        name: body.name.trim(),
        category: 'general',
        eventType: 'friend_invite_to_list',
        bindingKind: 'sequence', // bound to successor sequence for UI consistency
        sequenceId: body.successorSequenceId, // also point sequenceId for UI
        successorSequenceId: body.successorSequenceId,
        greetingTemplate: body.greetingTemplate.trim(),
        segmentSpec: {
          kind: 'customer_list_pool',
          listId: body.listId,
          nickIds: body.nickIds,
          skipRules: body.skipRules,
        },
        ruleOverrides: {
          ...body.ruleOverrides,
          allowStrangerMessage: true, // Friend Invite sequences allow stranger messaging
        } as object,
        // Wave 2 2026-05-29 — per-trigger welcome probe config
        welcomeMessageTemplate: welcomeTemplate,
        welcomeDelaySeconds,
        // I10 2026-06-04 — cấu trúc 5 tin: Tin 2 Cảm ơn + 4 cờ enable + notifyChannels.
        thankYouTemplate: body.thankYouTemplate?.trim() || null,
        thankYouDelaySeconds: Math.max(0, Math.min(3600, Number(body.thankYouDelaySeconds ?? 60) || 60)),
        // I12 2026-06-04 — Tin 3 (nhắc) + Tin 4 (từ chối) template + delay.
        remindTemplate: body.remindTemplate?.trim() || null,
        remindDelayDays: Math.max(1, Math.min(30, Number(body.remindDelayDays ?? 3) || 3)),
        rejectedTemplate: body.rejectedTemplate?.trim() || null,
        enableWelcome: body.enableWelcome ?? true,
        enableThankYou: body.enableThankYou ?? true,
        enableRemind: body.enableRemind ?? true,
        enableRejectedFollowUp: body.enableRejectedFollowUp ?? false,
        // #1 2026-06-06 — 2 công tắc bám đuổi (default bật = hành vi cũ).
        followUpStrangerEnabled: body.followUpStrangerEnabled ?? true,
        followUpFriendEnabled: body.followUpFriendEnabled ?? true,
        notifyChannels: (body.notifyChannels && typeof body.notifyChannels === 'object'
          ? body.notifyChannels
          : undefined) as object | undefined,
        // CareSession 2026-06-07 — điều kiện đóng phiên.
        closeConditions: (body.closeConditions && typeof body.closeConditions === 'object'
          ? body.closeConditions
          : undefined) as object | undefined,
        // BE T4 2026-05-30 — lưu scheduledAt ngay từ lúc create (UI cho phép lập
        // Mục tiêu trước rồi bấm "Lên lịch" sau, BE đã có sẵn để cron sweep nhìn thấy).
        scheduledAt: scheduledAtUtc,
        // Wave 4 #C 2026-06-02 — 7 cột map từ wizard B3 safetyRules.
        // concurrencyPerNickPerMinute KHÔNG set → schema default (1).
        sendHourStart,
        sendHourEnd,
        minFriendReqGapMs,
        recencySkipDays,
        multiNickThreshold,
        sequenceStartDelayMinutes,
        sequenceStartDelaySeconds,
        pauseOnActivityHours,
        // #3 2026-06-06 — nhịp gửi + sàn welcome + cửa sổ warm (đọc từ UI, hết hardcode)
        friendReqIntervalMinMinutes,
        friendReqIntervalMaxMinutes,
        welcomeMinFloorSeconds,
        warmWindowDays,
        state: 'draft',
        enabled: false, // explicit activation required
        createdById: user.id,
      },
    });

    logger.info(
      `[friend-invite] trigger created id=${trigger.id} name="${trigger.name}" list=${body.listId} nicks=${body.nickIds.length} startMode=${startMode}${scheduledAtUtc ? ` scheduledAt=${scheduledAtUtc.toISOString()}` : ''} safety={hours=${sendHourStart}-${sendHourEnd},gap=${minFriendReqGapMs}ms,recency=${recencySkipDays}d,multinick=${multiNickThreshold},seqDelay=${sequenceStartDelayMinutes}m,pause=${pauseOnActivityHours}h}`,
    );

    return reply.status(201).send({
      trigger: {
        id: trigger.id,
        name: trigger.name,
        state: trigger.state,
        scheduledAt: trigger.scheduledAt ? trigger.scheduledAt.toISOString() : null,
        startMode,
      },
    });
  });

  // ── POST /:id/activate — Precompute + spawn workers ───────────────────────
  // BE T4 2026-05-30 — body có thể chứa { startMode?, scheduledAt? }:
  //   - startMode='now'       (default) → flip state='active' + spawn workers ngay.
  //   - startMode='scheduled' → cập nhật scheduledAt, GIỮ state='draft' để cron sweep.
  // Nếu trigger ĐÃ có scheduledAt (set lúc create) + chưa truyền startMode override
  // mà thời điểm vẫn ở tương lai → mặc định coi như 'scheduled' (không activate
  // sớm hơn lịch). Caller muốn activate sớm phải gửi explicit startMode='now'.
  app.post<{
    Params: { id: string };
    Body?: { startMode?: 'now' | 'scheduled'; scheduledAt?: string | null };
  }>(`${BASE}/:id/activate`, { preHandler: requireGrant('trigger', 'edit') }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    const body = request.body ?? {};

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true, scheduledAt: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state !== 'draft' && trigger.state !== 'paused')
      return reply.status(400).send({ error: 'invalid_state', current: trigger.state });

    const spec = trigger.segmentSpec;
    if (!isFriendInviteSegmentSpec(spec))
      return reply.status(500).send({ error: 'invalid_segment_spec' });

    // ── Resolve scheduledAt + startMode (body override > trigger persisted) ──
    let scheduledAtUtc: Date | null = trigger.scheduledAt ?? null;
    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt === null) {
        scheduledAtUtc = null;
      } else {
        const d = new Date(body.scheduledAt);
        if (Number.isNaN(d.getTime())) {
          return reply.status(400).send({ error: 'scheduledAt_invalid', hint: 'ISO 8601 string' });
        }
        if (d.getTime() <= Date.now()) {
          return reply.status(400).send({ error: 'scheduledAt_not_future' });
        }
        const vnHour = new Date(d.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
        if (vnHour < 6 || vnHour > 22) {
          return reply
            .status(400)
            .send({ error: 'scheduledAt_out_of_hours', hint: 'Giờ VN 6h–22h', vnHour });
        }
        scheduledAtUtc = d;
      }
    }
    // Mặc định: nếu trigger có scheduledAt future và body không ép startMode → scheduled.
    const implicitScheduled =
      !body.startMode && scheduledAtUtc !== null && scheduledAtUtc.getTime() > Date.now();
    const startMode: 'now' | 'scheduled' =
      body.startMode === 'scheduled' || implicitScheduled ? 'scheduled' : 'now';

    // ── Scheduled mode: precompute pool nhưng KHÔNG flip active / spawn worker ──
    // Lý do precompute ngay: KH có thể đổi list sau khi lập Mục tiêu, lấy snapshot
    // sớm để confirm preview/ETA hiển thị đúng. Cron sweep sau này flip 'active'
    // + spawn worker khi tới giờ (chưa implement trong file này — sẽ bổ sung
    // ở task riêng cron scheduler).
    if (startMode === 'scheduled') {
      if (!scheduledAtUtc) {
        return reply.status(400).send({ error: 'scheduledAt_required', hint: 'startMode=scheduled cần scheduledAt' });
      }
      // Precompute pool (idempotent — entries reused nếu đã seed)
      const precomputeResult = await precomputeAndSeedPool({
        triggerId: trigger.id,
        orgId: user.orgId,
        spec,
      });
      await prisma.automationTrigger.update({
        where: { id: trigger.id },
        data: { scheduledAt: scheduledAtUtc, state: 'draft', enabled: false },
      });
      logger.info(
        `[friend-invite] trigger ${trigger.id} scheduled at ${scheduledAtUtc.toISOString()}`,
      );
      return reply.send({
        ok: true,
        scheduled: true,
        scheduledAt: scheduledAtUtc.toISOString(),
        precompute: precomputeResult,
        workersSpawning: 0,
      });
    }

    // ── Activate now ──────────────────────────────────────────────────────────
    // 1. Precompute skip rules + seed pool
    const precomputeResult = await precomputeAndSeedPool({
      triggerId: trigger.id,
      orgId: user.orgId,
      spec,
    });

    // 2. Flip trigger state → active. Clear scheduledAt vì đã activate manually
    // (tránh cron sweep gặp orphan scheduledAt trên trigger active).
    await prisma.automationTrigger.update({
      where: { id: trigger.id },
      data: { state: 'active', enabled: true, scheduledAt: null },
    });

    // 3. Spawn nick workers (idempotent — won't double-spawn)
    for (const nickId of spec.nickIds) {
      void startNickWorker(nickId, user.orgId).catch((err) =>
        logger.error(`[friend-invite] startNickWorker failed nick=${nickId}:`, err),
      );
    }

    return reply.send({
      ok: true,
      scheduled: false,
      precompute: precomputeResult,
      workersSpawning: spec.nickIds.length,
    });
  });

  // ── POST /:id/pause ───────────────────────────────────────────────────────
  // Body { ttlHours?: number } — nếu truyền → set pausedUntil = NOW() + ttlHours*3600s,
  // cron sweeper mỗi 1 phút sẽ auto flip 'paused'→'active' khi tới hạn.
  // Không truyền (hoặc null/0) → pause vô hạn (legacy "Dừng vĩnh viễn", user phải bấm Tiếp tục).
  // ttlHours range: 1..720 (30 ngày) — match pause_on_activity_hours bound.
  app.post<{ Params: { id: string }; Body: { ttlHours?: number | null } }>(
    `${BASE}/:id/pause`,
    { preHandler: requireGrant('trigger', 'edit') },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      const body = (request.body ?? {}) as { ttlHours?: number | null };

      let pausedUntil: Date | null = null;
      if (body.ttlHours !== undefined && body.ttlHours !== null) {
        const ttl = Number(body.ttlHours);
        if (!Number.isFinite(ttl) || ttl < 1 || ttl > 720) {
          return reply
            .status(400)
            .send({ error: 'ttl_hours_invalid', hint: 'Phải từ 1 đến 720 giờ (30 ngày)' });
        }
        pausedUntil = new Date(Date.now() + Math.round(ttl) * 3600 * 1000);
      }

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
        select: { id: true, state: true, segmentSpec: true },
      });
      if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
      if (trigger.state !== 'active')
        return reply.status(400).send({ error: 'not_active', current: trigger.state });

      await prisma.automationTrigger.update({
        where: { id: trigger.id },
        data: { state: 'paused', pausedUntil },
      });

      // Stop workers for this trigger's nicks IF no other active trigger uses them
      const spec = trigger.segmentSpec;
      if (isFriendInviteSegmentSpec(spec)) {
        for (const nickId of spec.nickIds) {
          // Check if any other active trigger still uses this nick
          const otherActive = await prisma.automationTrigger.count({
            where: {
              orgId: user.orgId,
              id: { not: trigger.id },
              state: 'active',
              eventType: 'friend_invite_to_list',
              segmentSpec: {
                path: ['nickIds'],
                array_contains: nickId,
              } as object,
            },
          });
          if (otherActive === 0) {
            void stopNickWorker(nickId);
          }
        }
      }

      return reply.send({
        ok: true,
        state: 'paused',
        pausedUntil: pausedUntil?.toISOString() ?? null,
      });
    },
  );

  // ── POST /:id/resume ──────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`${BASE}/:id/resume`, { preHandler: requireGrant('trigger', 'edit') }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state !== 'paused')
      return reply.status(400).send({ error: 'not_paused', current: trigger.state });

    await prisma.automationTrigger.update({
      where: { id: trigger.id },
      // P2 Wave 4 — manual resume cũng clear pausedUntil để sweeper bỏ qua.
      data: { state: 'active', pausedUntil: null },
    });

    const spec = trigger.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) {
      for (const nickId of spec.nickIds) {
        void startNickWorker(nickId, user.orgId);
      }
    }

    return reply.send({ ok: true, state: 'active' });
  });

  // ── POST /:id/cancel ──────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`${BASE}/:id/cancel`, { preHandler: requireGrant('trigger', 'edit') }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state === 'cancelled' || trigger.state === 'completed')
      return reply.status(400).send({ error: 'already_terminal', current: trigger.state });

    // Cancel pool entries — in-flight processing will be released by stuck sweeper
    await tenantTransaction(async (tx) => {
      await tx.automationTrigger.update({
        where: { id: trigger.id },
        // P2 Wave 4 — clear pausedUntil để sweeper không re-pickup trigger đã terminal.
        data: { state: 'cancelled', pausedUntil: null },
      });
      // #2 2026-06-06 — hàng đợi ở bảng nối per-trigger.
      await tx.triggerQueueEntry.updateMany({
        where: { triggerId: trigger.id, queueStatus: 'queued_for_pickup' },
        data: { queueStatus: 'cancelled' },
      });
    });

    // Stop workers (if no other active trigger uses them)
    const spec = trigger.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) {
      for (const nickId of spec.nickIds) {
        void stopNickWorker(nickId);
      }
    }

    // CareSession 2026-06-07 (T7): cascade close phiên của trigger bị hủy.
    // Fire-and-forget SAU response (audit: KHÔNG đóng đồng bộ trong request — set-based
    // 1 câu nên rẻ, nhưng vẫn để ngoài critical path). lazy-close ở listener là backstop.
    void closeCareSessionsForTrigger(trigger.id, 'source_done').catch((err) => {
      logger.warn(`[friend-invite] cascade close care sessions failed trigger=${trigger.id}: ${err?.message ?? err}`);
    });

    return reply.send({ ok: true, state: 'cancelled' });
  });

  // ── POST /:id/restore — Khôi phục từ thùng rác (cancelled → paused) ────────
  // 2026-06-05 (Anh chốt): Mục tiêu đã Xóa (state='cancelled') nằm trong thùng rác,
  // bấm "Khôi phục" đưa về 'paused' (an toàn — KHÔNG tự chạy lại). Sale phải bấm
  // "Bắt đầu" (/activate) để re-precompute pool. KHÔNG spawn worker ở đây.
  app.post<{ Params: { id: string } }>(`${BASE}/:id/restore`, { preHandler: requireGrant('trigger', 'edit') }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state !== 'cancelled')
      return reply.status(400).send({ error: 'not_cancelled', current: trigger.state });

    await prisma.automationTrigger.update({
      where: { id: trigger.id },
      data: { state: 'paused', pausedUntil: null },
    });

    invalidateTaskProgressCache(id);
    return reply.send({ ok: true, state: 'paused' });
  });

  // ── DELETE /:id — đã GỘP vào route chung trigger-routes.ts ────────────────
  // 2026-06-06: route DELETE /api/v1/automation/triggers/:id trước đây khai báo
  // CẢ ở đây lẫn trigger-routes.ts → Fastify FST_ERR_DUPLICATED_ROUTE → app crash
  // không lên được. Anh chốt gộp 1 route phân luồng theo eventType. Logic xóa hẳn
  // Mục tiêu friend-invite giờ ở deleteFriendInviteTrigger() (export trên đầu file),
  // được trigger-routes.ts gọi khi eventType='friend_invite_to_list'.

  // ── GET /:id/dashboard ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(`${BASE}/:id/dashboard`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      include: {
        sequence: { select: { id: true, name: true, steps: true } },
      },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });

    // Sequence steps count for badge + step bar (mockup 2-MucTieu-Detail)
    let sequenceStepsCount = 0;
    if (trigger.sequence?.steps && Array.isArray(trigger.sequence.steps)) {
      sequenceStepsCount = (trigger.sequence.steps as unknown[]).length;
    }

    // Counters via single GROUP BY query — #2 2026-06-06: bảng nối per-trigger.
    const counts = await prisma.triggerQueueEntry.groupBy({
      by: ['queueStatus'],
      where: { triggerId: trigger.id },
      _count: { id: true },
    });
    const counters: Record<string, number> = {
      total: 0,
      queued_for_pickup: 0,
      processing: 0,
      processed: 0,
      skipped_friend_cap: 0,
      skipped_recency: 0,
      skipped_status: 0,
      skipped_no_zalo: 0,
      failed_permanent: 0,
      failed_stuck: 0,
      cancelled: 0,
      // Wave 3 2026-05-30 — phase 2 terminal status (lifecycle KH trong Mục tiêu).
      // Worker (message-handler / friend-event-handler) ghi vào queueStatus.
      customer_reply: 0,
      customer_block: 0,
      converted_lead: 0,
    };
    for (const c of counts) {
      counters.total += c._count.id;
      if (c.queueStatus) counters[c.queueStatus] = c._count.id;
    }

    // Outbox stats (sent)
    // FIX 2026-06-04: "Đã gửi kết bạn" CHỈ đếm outbox kind='FRIEND_REQUEST'. Trước đây
    // đếm mọi outbox (gồm WELCOME_PROBE sibling) → mỗi KH có 2 row → 2 KH ra 4 (gấp đôi).
    // "Đã gửi kết bạn" = số KH (distinct contactId) chiến dịch ĐÃ gửi lời mời.
    // 2026-06-04: đếm distinct contactId (không phải số lượt outbox) để đẳng thức luôn
    // đúng: Đã gửi = Đồng ý + Từ chối + Đang chờ — kể cả khi 1 KH gửi qua nhiều nick.
    const sentRows = await prisma.friendRequestOutbox.groupBy({
      by: ['contactId'],
      where: { triggerId: trigger.id, sendStatus: { in: ['success', 'tentative'] }, kind: 'FRIEND_REQUEST' },
    });
    const sent = sentRows.length;

    // Wave 3 Day 5 — Tập hợp contactId thuộc Mục tiêu này (qua CustomerListEntry.triggerId).
    // Dùng cho 4 counter mới (accepted/waitingCrm/customer_*/converted_lead) +
    // NickStat.acceptedTotal. Quét 1 lần, share giữa các query bên dưới.
    // #2 2026-06-06 — contactId thuộc Mục tiêu lấy từ bảng nối (contactId denormalized).
    const triggerContactRows = await prisma.triggerQueueEntry.findMany({
      where: { triggerId: trigger.id, contactId: { not: null } },
      select: { contactId: true },
    });
    const triggerContactIds = Array.from(
      new Set(triggerContactRows.map((r) => r.contactId).filter((x): x is string => !!x)),
    );

    // accepted: TỶ LỆ THÀNH BẠN TỪ LỜI MỜI CHIẾN DỊCH GỬI (Anh chốt 2026-06-04).
    // Định nghĩa: chỉ tính KH mà CHÍNH chiến dịch này gửi friend-request (outbox
    // kind=FRIEND_REQUEST, nick X) VÀ đồng ý qua ĐÚNG nick X đó. KH đã là bạn sẵn
    // từ trước (qua nick khác, không do chiến dịch mời) → KHÔNG tính.
    // Sai cũ: friend.count() per-nick đếm cả friendship có sẵn / accept qua nick khác
    // → thổi phồng. Phải JOIN outbox.nick_id = friend.zalo_account_id (cùng nick gửi).
    const acceptedRows = await prisma.$queryRaw<Array<{ contact_id: string }>>`
      SELECT DISTINCT o.contact_id
      FROM friend_request_outbox o
      JOIN friends f
        ON f.contact_id = o.contact_id
       AND f.zalo_account_id = o.nick_id
       AND f.friendship_status = 'accepted'
      WHERE o.trigger_id = ${trigger.id}
        AND o.kind = 'FRIEND_REQUEST'
    `;
    const accepted = acceptedRows.length;

    // rejected: ĐỐI XỨNG accepted — KH mà nick chiến dịch mời → KH TỪ CHỐI qua đúng
    // nick đó (Anh chốt 2026-06-04: đảm bảo Đã gửi = Đồng ý + Từ chối + Đang chờ).
    // Trước đây BE KHÔNG tính rejected → FE đọc c.rejected=0 → "Từ chối" luôn 0 và
    // "Đang chờ" bị thổi phồng (gồm cả KH đã từ chối).
    const rejectedRows = await prisma.$queryRaw<Array<{ contact_id: string }>>`
      SELECT DISTINCT o.contact_id
      FROM friend_request_outbox o
      JOIN friends f
        ON f.contact_id = o.contact_id
       AND f.zalo_account_id = o.nick_id
       AND f.friendship_status = 'rejected'
      WHERE o.trigger_id = ${trigger.id}
        AND o.kind = 'FRIEND_REQUEST'
        AND o.contact_id NOT IN (
          -- KH đã đồng ý qua nick khác cùng chiến dịch → ưu tiên tính Đồng ý, không tính Từ chối.
          SELECT DISTINCT o2.contact_id
          FROM friend_request_outbox o2
          JOIN friends f2 ON f2.contact_id = o2.contact_id
            AND f2.zalo_account_id = o2.nick_id AND f2.friendship_status = 'accepted'
          WHERE o2.trigger_id = ${trigger.id} AND o2.kind = 'FRIEND_REQUEST'
        )
    `;
    const rejected = rejectedRows.length;

    // waitingCrm: accepted + Contact.assignedUserId IS NULL (chưa sale nào nhận).
    // (Codebase dùng `assignedUserId` làm "owner user"; không có cột `ownerUserId`
    // trên Contact — semantic identical: KH chưa có sale claim.)
    const waitingCrm = triggerContactIds.length
      ? await prisma.contact.count({
          where: {
            orgId: user.orgId,
            id: { in: triggerContactIds },
            assignedUserId: null,
            friends: {
              some: { friendshipStatus: 'accepted' },
            },
          },
        })
      : 0;

    // customer_reply / customer_block — đếm distinct contact đã phát event đó cho
    // trigger này. groupBy contactId rồi count length (Prisma distinct trên count
    // không filter null sạch — dùng groupBy cho an toàn).
    const replyGroups = await prisma.automationEventLog.groupBy({
      by: ['contactId'],
      where: {
        triggerId: trigger.id,
        eventType: 'customer_reply',
        contactId: { not: null },
      },
    });
    const blockGroups = await prisma.automationEventLog.groupBy({
      by: ['contactId'],
      where: {
        triggerId: trigger.id,
        eventType: 'customer_block',
        contactId: { not: null },
      },
    });
    const customerReply = replyGroups.length;
    const customerBlock = blockGroups.length;
    // FIX A 2026-06-08 — Set contactId đã reply/block, dùng để loại khỏi "đang bám đuổi"
    // (KH reply = tạm dừng chuỗi, KH block = dừng hẳn → KHÔNG còn đang xử lý).
    const replyContactIds = new Set<string>();
    for (const g of replyGroups) if (g.contactId) replyContactIds.add(g.contactId);
    const blockContactIds = new Set<string>();
    for (const g of blockGroups) if (g.contactId) blockContactIds.add(g.contactId);

    // converted_lead: Contact.status='converted' AND thuộc trigger này.
    // Semantic = KH đã chốt deal (xem status-migration.ts: 'converted' → 'Chốt').
    const convertedLead = triggerContactIds.length
      ? await prisma.contact.count({
          where: {
            orgId: user.orgId,
            id: { in: triggerContactIds },
            status: 'converted',
          },
        })
      : 0;

    // FIX 2026-06-04: "Hoàn tất" = số KH (distinct contactId) đã gửi BƯỚC CUỐI của chuỗi,
    // KHÔNG phải campaign state='completed'. Campaign là per-trigger (1 row chung mọi KH)
    // + thường kẹt 'active' chưa flip → ra 0 dù KH đã gửi đủ 3/3. Đổi sang đếm distinct
    // contactId có event sequence_step_sent với metadata.stepIdx = totalSteps-1 (giống fix
    // completedKHCount ở list-service). Mỗi KH đi hết chuỗi tính 1.
    let completedSequence = 0;
    // Set contactId đã gửi bước cuối — dùng cho cả counter "Hoàn tất" lẫn deriveKHFinalState
    // per-entry (để bảng KH hiện "3/3 ✅ Hoàn tất" thay vì "0/3" khi KH đã xong).
    const completedContactIds = new Set<string>();
    if (sequenceStepsCount > 0) {
      const lastIdx = sequenceStepsCount - 1;
      const doneGroups = await prisma.automationEventLog.groupBy({
        by: ['contactId'],
        where: {
          orgId: user.orgId,
          triggerId: trigger.id,
          eventType: 'sequence_step_sent',
          contactId: { not: null },
          metadata: { path: ['stepIdx'], equals: lastIdx },
        },
      });
      for (const g of doneGroups) if (g.contactId) completedContactIds.add(g.contactId);
      completedSequence = doneGroups.length;
    }

    // FIX A 2026-06-08 — "đang bám đuổi" (enrollingSequence) phải đếm SỐ KH THẬT đang
    // dở chuỗi, KHÔNG phải số ROW campaign state='active'.
    //
    // Bug cũ: `campaignByState.get('active')`. AutomationCampaign là 1 row/trigger×sequence
    // (xem campaign-materializer.ts:245 "1 campaign per trigger × sequence") → đếm row ra 0
    // hoặc 1, hiểu nhầm thành "0/1 KH". Khi mọi KH đã gửi bước cuối nhưng campaign chưa flip
    // 'completed' (race tryCompleteCampaign — xem FIX B) → ra "1 KH bám đuổi" ẢO dù thực tế 0.
    //
    // Cách đúng: KH đang bám đuổi = đã vào chuỗi (sequence_enrolled) NHƯNG chưa gửi bước cuối,
    // chưa reply (tạm dừng), chưa block (dừng hẳn). Tính bằng phép trừ tập hợp → luôn ≥ 0.
    const enrollGroups = await prisma.automationEventLog.groupBy({
      by: ['contactId'],
      where: {
        orgId: user.orgId,
        triggerId: trigger.id,
        eventType: 'sequence_enrolled',
        contactId: { not: null },
      },
    });
    let enrollingSequence = 0;
    for (const g of enrollGroups) {
      const cid = g.contactId;
      if (!cid) continue;
      if (completedContactIds.has(cid)) continue; // đã xong chuỗi
      if (replyContactIds.has(cid)) continue; // tạm dừng (KH trả lời)
      if (blockContactIds.has(cid)) continue; // dừng hẳn (KH chặn)
      enrollingSequence += 1;
    }

    // Wave 4 2026-06-03 — P1 fix counter "Còn X KH" semantic-aware.
    // Semantic mới: "Còn X KH" = KH ĐANG XỬ LÝ thực sự, bao gồm cả 2 phase:
    //   (a) Phase 1: entry chờ gửi friend-request (queueStatus='queued_for_pickup')
    //                hoặc đang được nick pickup (queueStatus='processing')
    //   (b) Phase 2: KH đã accept friend-request, đang trong sequence bám đuổi
    //                (AutomationCampaign.state='active')
    // Trước đây UI dùng (total - processed) → KHÔNG đếm KH phase 2 → khi tất cả
    // entry đều processed nhưng campaign vẫn active → hiển thị "Còn 0 KH" sai.
    // Phase 1 lấy từ counters đã groupBy ở trên (không thêm query mới).
    const stillRunningPhase1 =
      (counters.queued_for_pickup ?? 0) + (counters.processing ?? 0);
    const stillRunning = stillRunningPhase1 + enrollingSequence;

    // Nick load — per nick stats
    const spec = trigger.segmentSpec as { nickIds?: string[] } | null;
    const nickIds = spec?.nickIds ?? [];
    const nicks = await prisma.zaloAccount.findMany({
      where: { id: { in: nickIds }, orgId: user.orgId },
      select: {
        id: true,
        displayName: true,
        status: true,
        dailyFriendAddCap: true,
        // Task B Nick offline 2026-05-30 — lastConnectedAt = thời điểm nick còn online gần nhất.
        // Dashboard FE dùng để hiển thị "Offline X phút trước" trong nick table.
        lastConnectedAt: true,
      },
    });

    const nickStats = await Promise.all(
      nicks.map(async (nick) => {
        // FIX 2026-06-04: thêm kind='FRIEND_REQUEST' — trước đây đếm mọi outbox (gồm
        // WELCOME_PROBE sibling) → "đã gửi" per-nick gấp đôi, lệch với counter tổng.
        const sentToday = await prisma.friendRequestOutbox.count({
          where: {
            triggerId: trigger.id,
            nickId: nick.id,
            sendStatus: { in: ['success', 'tentative'] },
            kind: 'FRIEND_REQUEST',
            createdAt: { gte: startOfDayVN() },
          },
        });
        const sentTotal = await prisma.friendRequestOutbox.count({
          where: { triggerId: trigger.id, nickId: nick.id, sendStatus: { in: ['success', 'tentative'] }, kind: 'FRIEND_REQUEST' },
        });
        // acceptedTotal per nick: tỷ lệ thành bạn từ lời mời CHÍNH NICK NÀY gửi
        // (Anh chốt 2026-06-04). JOIN outbox(nick=nick.id) với friend accepted cùng nick.
        // KHÔNG đếm friendship có sẵn / accept qua nick khác → đồng bộ counter "Đồng ý" tổng.
        const acceptedNickRows = await prisma.$queryRaw<Array<{ contact_id: string }>>`
          SELECT DISTINCT o.contact_id
          FROM friend_request_outbox o
          JOIN friends f
            ON f.contact_id = o.contact_id
           AND f.zalo_account_id = o.nick_id
           AND f.friendship_status = 'accepted'
          WHERE o.trigger_id = ${trigger.id}
            AND o.kind = 'FRIEND_REQUEST'
            AND o.nick_id = ${nick.id}
        `;
        const acceptedTotal = acceptedNickRows.length;
        const workerState = getNickWorkerState(nick.id);
        return {
          nickId: nick.id,
          displayName: nick.displayName,
          status: nick.status,
          dailyFriendAddCap: nick.dailyFriendAddCap,
          sentToday,
          sentTotal,
          acceptedTotal,
          workerRunning: workerState?.isRunning ?? false,
          workerBusy: workerState?.isBusy ?? false,
          // Task B Nick offline 2026-05-30 — ISO string (null nếu nick chưa connect lần nào).
          lastSeenAt: nick.lastConnectedAt ? nick.lastConnectedAt.toISOString() : null,
        };
      }),
    );

    // Task B Nick offline 2026-05-30 — compute health rollup từ nickStats.
    // FE Dashboard dùng để render banner cảnh báo (đỏ nếu allOffline, vàng nếu >50%).
    // Coi 'connected' là online; mọi state khác (disconnected/qr_pending/connecting) = offline.
    const onlineCount = nickStats.filter((n) => n.status === 'connected').length;
    const offlineCount = nickStats.length - onlineCount;
    const nickHealth = {
      totalNicks: nickStats.length,
      onlineCount,
      offlineCount,
      allOffline: nickStats.length > 0 && onlineCount === 0,
    };

    // Recent entries for the table (paginated) — mockup row shape.
    // Default limit 50, support ?limit=&offset=&status=
    // Wave 3 2026-05-30 — `?status=` server-side filter cho chip (customer_reply,
    // customer_block, converted_lead, processing, queued_for_pickup, skipped_*...).
    // FE MucTieuDetailView truyền giá trị queueStatus thẳng; nếu không match thì
    // bỏ qua filter (vẫn trả full list để tránh "0 KH" silent).
    const rawLimit = Number((request.query as { limit?: string } | undefined)?.limit ?? 50);
    const rawOffset = Number((request.query as { offset?: string } | undefined)?.offset ?? 0);
    const rawStatus = (request.query as { status?: string } | undefined)?.status;
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    const allowedStatuses = new Set([
      'queued_for_pickup',
      'processing',
      'processed',
      'skipped_friend_cap',
      'skipped_recency',
      'skipped_status',
      'skipped_no_zalo',
      'failed_permanent',
      'failed_stuck',
      'cancelled',
      'customer_reply',
      'customer_block',
      'converted_lead',
    ]);
    const statusFilter =
      rawStatus && allowedStatuses.has(rawStatus) ? rawStatus : null;

    // #2 2026-06-06 — query từ BẢNG NỐI (scope per-trigger), JOIN entry lấy data khách.
    // queueStatus/claimedByNickId từ bảng nối; phone/zalo*/hasZalo/contactId từ entry.
    const queueWhere = statusFilter
      ? { triggerId: trigger.id, queueStatus: statusFilter }
      : { triggerId: trigger.id };

    const totalEntries = await prisma.triggerQueueEntry.count({
      where: queueWhere,
    });

    const queueRowsRaw = await prisma.triggerQueueEntry.findMany({
      where: queueWhere,
      orderBy: { entry: { rowIndex: 'asc' } },
      skip: offset,
      take: limit,
      select: {
        queueStatus: true,
        claimedByNickId: true,
        updatedAt: true,
        entry: {
          select: {
            id: true,
            rowIndex: true,
            phoneRaw: true,
            nameRaw: true,
            phoneE164: true,
            zaloName: true,
            zaloUid: true,
            resolvedByNickId: true,
            hasZalo: true,
            contactId: true,
            dupWithContactId: true,
          },
        },
      },
    });
    // Map về shape phẳng (giống select cũ) để phần dưới dùng e.queueStatus/e.id... như trước.
    const entriesRaw = queueRowsRaw.map((q) => ({
      id: q.entry.id,
      rowIndex: q.entry.rowIndex,
      phoneRaw: q.entry.phoneRaw,
      nameRaw: q.entry.nameRaw,
      phoneE164: q.entry.phoneE164,
      zaloName: q.entry.zaloName,
      zaloUid: q.entry.zaloUid,
      resolvedByNickId: q.entry.resolvedByNickId,
      claimedByNickId: q.claimedByNickId,
      queueStatus: q.queueStatus,
      hasZalo: q.entry.hasZalo,
      contactId: q.entry.contactId,
      dupWithContactId: q.entry.dupWithContactId,
      updatedAt: q.updatedAt,
    }));

    // P1 2026-06-02 — Reconstruct task progress (currentStepIdx + lastSentAt + nextRunAt)
    // từ BullMQ sequence-step queue + AutomationEventLog. Trước đây đọc bảng
    // automation_tasks qua stub no-op (luôn trả []) → 3 cột "Bước hiện tại / Lần
    // gửi gần nhất / Lần gửi tiếp theo" trên FE detail rỗng. Model AutomationTask
    // đã drop trong migration 20260601182155 → phải dựng lại từ 2 nguồn truth:
    //   (a) BullMQ jobs (delayed/waiting/active) → "Bước hiện tại" + "Lần gửi tiếp theo"
    //   (b) AutomationEventLog WHERE eventType='sequence_step_sent' → "Lần gửi gần nhất"
    // Cache 60s in-memory per triggerId để tránh stampede khi nhiều sale F5 cùng lúc.
    // Logic chi tiết: getTaskProgressForTrigger (top of file).
    const contactIds = entriesRaw.map((e) => e.contactId).filter((x): x is string => !!x);

    const triggerProgressMap = await getTaskProgressForTrigger(trigger.id);
    const taskByContact = new Map<
      string,
      {
        currentStepIdx: number | null;
        state: string | null;
        lastSentAt: Date | null;
        nextRunAt: Date | null;
      }
    >();
    // Project xuống chỉ những contact thuộc page hiện tại (entriesRaw đã paginate).
    for (const cid of contactIds) {
      const p = triggerProgressMap.get(cid);
      if (p) taskByContact.set(cid, p);
    }

    // P0-3 2026-05-30 — lastInviteNickId per entry: nick GẦN NHẤT đã gửi friend-invite
    // cho entry này (FriendRequestOutbox theo entryId). Fallback chain:
    //   1. outbox.nickId mới nhất
    //   2. entry.resolvedByNickId
    //   3. entry.claimedByNickId
    //   4. trigger.segmentSpec.nickIds[0]
    // FE dùng để pre-select nick context khi mở /chat từ row click.
    const entryIds = entriesRaw.map((e) => e.id);
    const outboxRows =
      entryIds.length > 0
        ? await prisma.friendRequestOutbox.findMany({
            where: {
              triggerId: trigger.id,
              customerListEntryId: { in: entryIds },
            },
            orderBy: { createdAt: 'desc' },
            select: { customerListEntryId: true, nickId: true },
          })
        : [];
    const lastInviteNickByEntry = new Map<string, string>();
    for (const r of outboxRows) {
      if (!lastInviteNickByEntry.has(r.customerListEntryId)) {
        lastInviteNickByEntry.set(r.customerListEntryId, r.nickId);
      }
    }
    const fallbackTriggerNickId = nickIds[0] ?? null;

    // Phase Friend Invite UI 2026-05-30 — bulk-load Contact rows (avatarUrl + fullName)
    // cho mọi contactId xuất hiện trong page entries hiện tại. Single findMany → in-memory Map.
    const contactsForEntries =
      contactIds.length > 0
        ? await prisma.contact.findMany({
            where: { orgId: user.orgId, id: { in: contactIds } },
            select: { id: true, avatarUrl: true, fullName: true },
          })
        : [];
    const contactById = new Map(contactsForEntries.map((c) => [c.id, c]));

    // Friend.accepted set per contactId — dùng cho deriveKHFinalState (phase1 vs pending).
    const friendAcceptedSet = new Set<string>();
    if (contactIds.length > 0) {
      const acceptedRows = await prisma.friend.findMany({
        where: {
          orgId: user.orgId,
          contactId: { in: contactIds },
          friendshipStatus: 'accepted',
        },
        select: { contactId: true },
      });
      for (const r of acceptedRows) if (r.contactId) friendAcceptedSet.add(r.contactId);
    }

    // Map nick display names so the table can render the pin chip.
    const nickNameById = new Map<string, string | null>();
    for (const n of nicks) nickNameById.set(n.id, n.displayName);

    // ── I5 2026-06-03 — Đọc cờ pause per-contact (Redis) cho cột Trạng thái ──
    // Pause flag nằm Redis (contact:paused:{triggerId}:{contactId}), KHÔNG nằm
    // queueStatus → entry có thể processed/processing trong khi đang pause (KH reply,
    // reaction xấu, manual pause, nick-hold). FE cần pauseRemainingMs để render
    // "🔶 Tạm dừng (còn Xh Ym)" + đếm ngược; pauseReason để phân biệt KH Reply vs
    // Tạm dừng. Reason suy từ event log gần nhất của contact (customer_reply /
    // customer_reaction_negative / manual_pause). Best-effort: lỗi Redis → bỏ qua.
    const pauseByContact = new Map<
      string,
      { remainingMs: number; reason: string; stopReason: string | null; stopByName: string | null }
    >();
    if (contactIds.length > 0) {
      // Lấy event log gần nhất liên quan pause cho từng contact (1 query gộp).
      // 2026-06-17 — thêm 'manual_stop': KH bị Dừng tay set pause "vĩnh viễn"
      // (24×365h) nhưng trước đây KHÔNG nằm trong set này → dashboard rớt về nhãn cũ
      // (KH Reply) + in thẳng đồng hồ ~8760h. Nay manual_stop → reason 'stopped'
      // (đồng bộ semantics manual-control-routes). KHÔNG thêm customer_block: đã
      // short-circuit "KH Block" ở FE trước nhánh pause → map reason cho block là data chết.
      const pauseEvents = await prisma.automationEventLog.findMany({
        where: {
          triggerId: trigger.id,
          contactId: { in: contactIds },
          eventType: {
            in: ['customer_reply', 'customer_reaction_negative', 'manual_pause', 'nick_hold_reset', 'manual_stop'],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { contactId: true, eventType: true, detail: true },
      });
      // first-wins-newest: manual_stop (mới) thắng customer_reply (cũ) cho cùng contact.
      const reasonByContact = new Map<string, { reason: string; detail: string | null }>();
      for (const ev of pauseEvents) {
        if (ev.contactId && !reasonByContact.has(ev.contactId)) {
          const reason = ev.eventType === 'manual_stop' ? 'stopped' : ev.eventType;
          reasonByContact.set(ev.contactId, { reason, detail: ev.detail ?? null });
        }
      }
      const rawByContact = new Map<string, { remainingMs: number; reason: string; detail: string | null }>();
      await Promise.all(
        contactIds.map(async (cid) => {
          try {
            const remainingMs = await getContactPauseRemaining(trigger.id, cid);
            if (remainingMs > 0) {
              const r = reasonByContact.get(cid);
              rawByContact.set(cid, {
                remainingMs,
                reason: r?.reason ?? 'manual_pause',
                detail: r?.detail ?? null,
              });
            }
          } catch {
            // best-effort — Redis lỗi thì bỏ qua, không chặn dashboard
          }
        }),
      );
      // E1 2026-06-17 — với reason 'stopped', parse detail "by <uid>, reason: <text>"
      // (event-hooks onManualStop) → lý do + người bấm; resolve uid→user.fullName (1 query gộp).
      const stopByUserId = new Map<string, string>(); // cid → byUserId
      const stopReasonByContact = new Map<string, string | null>();
      for (const [cid, v] of rawByContact) {
        if (v.reason !== 'stopped' || !v.detail) continue;
        const m = v.detail.match(/^by\s+([^,]+),\s*reason:\s*([\s\S]*)$/);
        if (m) {
          const uid = m[1].trim();
          if (uid) stopByUserId.set(cid, uid);
          stopReasonByContact.set(cid, m[2].trim() || null);
        }
      }
      const userNameById = new Map<string, string>();
      const uniqueUserIds = [...new Set(stopByUserId.values())];
      if (uniqueUserIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: uniqueUserIds } },
          select: { id: true, fullName: true },
        });
        for (const u of users) userNameById.set(u.id, u.fullName);
      }
      for (const [cid, v] of rawByContact) {
        const uid = stopByUserId.get(cid);
        pauseByContact.set(cid, {
          remainingMs: v.remainingMs,
          reason: v.reason,
          stopReason: stopReasonByContact.get(cid) ?? null,
          stopByName: uid ? userNameById.get(uid) ?? uid : null,
        });
      }
    }

    const entries = entriesRaw.map((e) => {
      const pinNickId = e.claimedByNickId ?? e.resolvedByNickId ?? null;
      const task = e.contactId ? taskByContact.get(e.contactId) ?? null : null;
      const contactRow = e.contactId ? contactById.get(e.contactId) ?? null : null;
      const friendAccepted = e.contactId ? friendAcceptedSet.has(e.contactId) : false;
      const sequenceCompleted = e.contactId ? completedContactIds.has(e.contactId) : false;
      const derivedStatus = deriveKHFinalState(
        { queueStatus: e.queueStatus, hasZalo: e.hasZalo, contactId: e.contactId },
        task ? { state: task.state } : null,
        friendAccepted,
        sequenceCompleted,
      );
      // P0-3 — progressLabel deterministic: dùng currentStepIdx của ACTIVE task.
      const curIdx = task?.currentStepIdx ?? null;
      const progressLabel =
        curIdx !== null && sequenceStepsCount > 0
          ? `Step ${curIdx + 1}/${sequenceStepsCount}`
          : null;
      // P0-3 — lastInviteNickId cho row-click → /chat?nickId=…
      const lastInviteNickId =
        lastInviteNickByEntry.get(e.id) ??
        e.resolvedByNickId ??
        e.claimedByNickId ??
        fallbackTriggerNickId ??
        null;
      return {
        id: e.id,
        rowIndex: e.rowIndex,
        contactId: e.contactId,
        displayName: e.zaloName ?? contactRow?.fullName ?? e.nameRaw ?? null,
        phone: e.phoneE164 ?? e.phoneRaw,
        nickId: pinNickId,
        nickName: pinNickId ? nickNameById.get(pinNickId) ?? null : null,
        queueStatus: e.queueStatus,
        hasZalo: e.hasZalo,
        dedup: e.dupWithContactId ? 'merged' : 'new',
        currentStepIdx: curIdx,
        // Phase Friend Invite UI 2026-05-30 — total steps in sequence (snapshot ở top trigger).
        sequenceTotalSteps: sequenceStepsCount,
        // P0-3 2026-05-30 — deterministic "Bước hiện tại" label cho FE.
        progressLabel,
        taskStatus: task?.state ?? null,
        // ISO timestamps mới: lần gửi cuối + lần chạy kế tiếp.
        lastSentAt: task?.lastSentAt ? task.lastSentAt.toISOString() : null,
        nextRunAt: task?.nextRunAt ? task.nextRunAt.toISOString() : null,
        // P0-3 — nick gần nhất đã invite entry này (cho FE pre-select khi mở /chat).
        lastInviteNickId,
        // Avatar Zalo — Contact.avatarUrl (đồng bộ từ Zalo SDK profile, nullable).
        avatarUrl: contactRow?.avatarUrl ?? null,
        // Trạng thái tổng hợp KH theo deriveKHFinalState (5 enum).
        derivedStatus,
        // I5 2026-06-03 — cờ pause per-contact (Redis) cho cột Trạng thái + đếm ngược.
        // pauseRemainingMs > 0 = đang tạm dừng (sẽ chạy lại). pauseReason phân biệt:
        //   customer_reply → 🛑 KH Reply; customer_reaction_negative/manual_pause/
        //   nick_hold_reset → 🔶 Tạm dừng. null = không pause.
        pauseRemainingMs: e.contactId ? pauseByContact.get(e.contactId)?.remainingMs ?? null : null,
        pauseReason: e.contactId ? pauseByContact.get(e.contactId)?.reason ?? null : null,
        // E1 2026-06-17 — lý do dừng + tên người bấm (chỉ có khi reason='stopped').
        pauseStopReason: e.contactId ? pauseByContact.get(e.contactId)?.stopReason ?? null : null,
        pauseStopByName: e.contactId ? pauseByContact.get(e.contactId)?.stopByName ?? null : null,
        // Wave 3 Day 5 — ISO string cho FE timeline sort + "cập nhật lần cuối" column.
        updatedAt: e.updatedAt.toISOString(),
      };
    });

    return reply.send({
      trigger: {
        id: trigger.id,
        name: trigger.name,
        state: trigger.state,
        // 2026-06-03 — pausedUntil ISO khi pause TTL set (vd /pause body {ttlHours:24}).
        // FE render countdown "Đang dừng (Xh Ym)" + hover "Tiếp tục". null khi pause vô hạn.
        pausedUntil: trigger.pausedUntil ? trigger.pausedUntil.toISOString() : null,
        greetingTemplate: trigger.greetingTemplate,
        welcomeMessageTemplate: trigger.welcomeMessageTemplate,
        successorSequence: trigger.sequence
          ? { id: trigger.sequence.id, name: trigger.sequence.name, stepsCount: sequenceStepsCount }
          : null,
        createdAt: trigger.createdAt,
        // M13 2026-06-02 — Expose 8 safety-rule columns cho card "Quy tắc gửi an toàn"
        // (read-only). Wizard B3 đặt giá trị; detail view chỉ hiển thị, nút "Sửa" defer Wave 4.
        // Mapping wizard ↔ schema: quietHoursStart/End → sendHourStart/End,
        // sendIntervalSeconds → minFriendReqGapMs/1000, recencyDays → recencySkipDays,
        // multinickThreshold → multiNickThreshold, delayAfterFriendRequestMin → sequenceStartDelayMinutes,
        // pauseHoursOnReply → pauseOnActivityHours. concurrencyPerNickPerMinute không có trong wizard.
        safetyRules: {
          sendHourStart: trigger.sendHourStart,
          sendHourEnd: trigger.sendHourEnd,
          sequenceStartDelayMinutes: trigger.sequenceStartDelayMinutes,
          pauseOnActivityHours: trigger.pauseOnActivityHours,
          multiNickThreshold: trigger.multiNickThreshold,
          concurrencyPerNickPerMinute: trigger.concurrencyPerNickPerMinute,
          recencySkipDays: trigger.recencySkipDays,
          minFriendReqGapMs: trigger.minFriendReqGapMs,
        },
      },
      counters: {
        ...counters,
        sent,
        accepted,
        // 2026-06-04 — Từ chối (đối xứng accepted) đảm bảo Đã gửi = Đồng ý + Từ chối + Đang chờ.
        rejected,
        // Wave 3 Day 5 — 4 counter mới (waitingCrm/customer_*/converted_lead).
        // Wave 3 2026-05-30 — `counters.customer_reply/customer_block` đến từ 2
        // nguồn: (a) AutomationEventLog.distinct(contactId) (`customerReply`/
        // `customerBlock` vars) — event lịch sử; (b) CustomerListEntry.queueStatus
        // groupBy (`counters.customer_reply` từ spread bên trên). Lấy MAX để chip
        // FE không nhảy lùi giữa 2 lần load (eventually consistent).
        waitingCrm,
        customer_reply: Math.max(counters.customer_reply, customerReply),
        customer_block: Math.max(counters.customer_block, customerBlock),
        converted_lead: Math.max(counters.converted_lead, convertedLead),
        // Wave 4 2026-06-03 — P2 campaign-level counters (sequence bám đuổi).
        // Additive, backward-compat: FE cũ vẫn đọc các key cũ qua `...counters` spread.
        enrollingSequence,
        completedSequence,
        // Wave 4 2026-06-03 — P1 sequence-aware "Còn X KH" semantic.
        // FE etaInfo dùng key này thay (total - processed) để đếm cả KH phase 2.
        stillRunning,
        stillRunningPhase1,
      },
      nicks: nickStats,
      // Task B Nick offline 2026-05-30 — health rollup cho banner FE.
      nickHealth,
      entries,
      entriesTotal: totalEntries,
      entriesOffset: offset,
      entriesLimit: limit,
    });
  });

  // ── GET /:id/edit — Wizard prefill payload (P2 Wave 4 #Edit 2026-06-02) ───
  // Trả về shape gọn cho MucTieuWizard hydrate edit-mode (4 bước).
  // Lý do tách khỏi /dashboard: dashboard payload nặng (entries + counters +
  // monitor), không cần khi user chỉ mở wizard "Sửa". Endpoint này chỉ scan 1
  // row AutomationTrigger + un-pack segmentSpec.
  //
  // Shape khớp với form.value của MucTieuWizard:
  //   name, listId, nickIds, successorSequenceId, greetingTemplate,
  //   welcomeMessageTemplate, welcomeDelaySeconds, safetyRules (8 cột schema),
  //   skipRules (từ segmentSpec), state (để FE disable field readonly nếu cần).
  // FE KHÔNG sửa listId hay state qua wizard — readonly UI side.
  app.get<{ Params: { id: string } }>(`${BASE}/:id/edit`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: {
        id: true,
        name: true,
        state: true,
        segmentSpec: true,
        successorSequenceId: true,
        greetingTemplate: true,
        welcomeMessageTemplate: true,
        welcomeDelaySeconds: true,
        // I13 2026-06-04 — cấu hình 5 tin cho edit prefill.
        thankYouTemplate: true,
        thankYouDelaySeconds: true,
        remindTemplate: true,
        remindDelayDays: true,
        rejectedTemplate: true,
        enableWelcome: true,
        enableThankYou: true,
        enableRemind: true,
        enableRejectedFollowUp: true,
        // #1 2026-06-06 — 2 công tắc bám đuổi cho edit prefill.
        followUpStrangerEnabled: true,
        followUpFriendEnabled: true,
        notifyChannels: true,
        sendHourStart: true,
        sendHourEnd: true,
        minFriendReqGapMs: true,
        recencySkipDays: true,
        multiNickThreshold: true,
        sequenceStartDelayMinutes: true,
        sequenceStartDelaySeconds: true,
        pauseOnActivityHours: true,
        // #3 2026-06-06 — nhịp gửi + sàn welcome + cửa sổ warm cho edit prefill.
        friendReqIntervalMinMinutes: true,
        friendReqIntervalMaxMinutes: true,
        welcomeMinFloorSeconds: true,
        warmWindowDays: true,
        scheduledAt: true,
      },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });

    const spec = (trigger.segmentSpec ?? {}) as {
      listId?: string;
      nickIds?: string[];
      skipRules?: Record<string, unknown>;
    };

    // Convert "HH" int hour → "HH:00" string khớp <input type="time"> của wizard B3.
    const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
    const quietHoursStart = `${pad2(trigger.sendHourStart)}:00`;
    const quietHoursEnd = `${pad2(trigger.sendHourEnd)}:00`;

    return reply.send({
      id: trigger.id,
      name: trigger.name,
      state: trigger.state,
      listId: spec.listId ?? null,
      nickIds: Array.isArray(spec.nickIds) ? spec.nickIds : [],
      successorSequenceId: trigger.successorSequenceId,
      greetingTemplate: trigger.greetingTemplate,
      welcomeMessageTemplate: trigger.welcomeMessageTemplate,
      welcomeDelaySeconds: trigger.welcomeDelaySeconds,
      // I13 2026-06-04 — cấu hình 5 tin.
      thankYouTemplate: trigger.thankYouTemplate,
      thankYouDelaySeconds: trigger.thankYouDelaySeconds,
      remindTemplate: trigger.remindTemplate,
      remindDelayDays: trigger.remindDelayDays,
      rejectedTemplate: trigger.rejectedTemplate,
      enableWelcome: trigger.enableWelcome,
      enableThankYou: trigger.enableThankYou,
      enableRemind: trigger.enableRemind,
      enableRejectedFollowUp: trigger.enableRejectedFollowUp,
      // #1 2026-06-06 — 2 công tắc bám đuổi để UI hiển thị lại.
      followUpStrangerEnabled: trigger.followUpStrangerEnabled,
      followUpFriendEnabled: trigger.followUpFriendEnabled,
      notifyChannels: trigger.notifyChannels ?? null,
      scheduledAt: trigger.scheduledAt ? trigger.scheduledAt.toISOString() : null,
      safetyRules: {
        quietHoursStart,
        quietHoursEnd,
        sendIntervalSeconds: Math.round(trigger.minFriendReqGapMs / 1000),
        recencyDays: trigger.recencySkipDays,
        multinickThreshold: trigger.multiNickThreshold,
        delayAfterFriendRequestMin: trigger.sequenceStartDelayMinutes,
        // 2026-06-16 — bản giây để UI prefill ô "Delay sau lời mời" (fallback phút×60 cho Mục tiêu cũ).
        delayAfterFriendRequestSeconds: trigger.sequenceStartDelaySeconds ?? trigger.sequenceStartDelayMinutes * 60,
        pauseHoursOnReply: trigger.pauseOnActivityHours,
        // #3 2026-06-06 — nhịp gửi + sàn welcome + cửa sổ warm để UI hiển thị lại
        friendReqIntervalMinMinutes: trigger.friendReqIntervalMinMinutes,
        friendReqIntervalMaxMinutes: trigger.friendReqIntervalMaxMinutes,
        welcomeMinFloorSeconds: trigger.welcomeMinFloorSeconds,
        warmWindowDays: trigger.warmWindowDays,
      },
      skipRules: spec.skipRules ?? {},
    });
  });

  // ── PATCH /:id — Partial update Mục tiêu (P2 Wave 4 #Edit 2026-06-02) ─────
  // Cho phép sale chỉnh: name, greetingTemplate, welcomeMessageTemplate,
  // welcomeDelaySeconds, safetyRules (8 cột), segmentSpec.skipRules.
  // KHÔNG cho đổi listId / nickIds / successorSequenceId / state qua endpoint
  // này — state đổi qua /pause /resume /cancel /activate; đổi list/nicks tạo
  // Mục tiêu mới (vì làm lại precompute pool + worker assignment phức tạp).
  //
  // Side-effect: KHÔNG re-build BullMQ pending jobs khi sửa delay (P2 todo
  // "Edit Trigger rebuild" defer riêng) — config mới chỉ apply cho enrollment
  // sau PATCH. Worker đọc trigger row mỗi vòng nên giờ làm việc / interval mới
  // tự động kicks-in.
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      greetingTemplate?: string;
      welcomeMessageTemplate?: string | null;
      welcomeDelaySeconds?: number;
      // I13 2026-06-04 — sửa cấu hình 5 tin khi edit Mục tiêu.
      thankYouTemplate?: string | null;
      thankYouDelaySeconds?: number;
      remindTemplate?: string | null;
      remindDelayDays?: number;
      rejectedTemplate?: string | null;
      enableWelcome?: boolean;
      enableThankYou?: boolean;
      enableRemind?: boolean;
      enableRejectedFollowUp?: boolean;
      // #1 2026-06-06 — 2 công tắc bám đuổi (edit).
      followUpStrangerEnabled?: boolean;
      followUpFriendEnabled?: boolean;
      notifyChannels?: Record<string, { owner?: boolean; manager?: boolean; zaloGroup?: boolean }>;
      closeConditions?: { onStatusIds?: string[]; onFriendTagIds?: string[]; onCrmTagIds?: string[]; silenceDays?: number };
      safetyRules?: {
        quietHoursStart?: string;
        quietHoursEnd?: string;
        sendIntervalSeconds?: number;
        recencyDays?: number;
        multinickThreshold?: number;
        delayAfterFriendRequestMin?: number;
        delayAfterFriendRequestSeconds?: number; // 2026-06-16 — bản giây (ưu tiên).
        pauseHoursOnReply?: number;
        // #3 2026-06-06 — nhịp gửi + sàn welcome + cửa sổ warm (edit).
        friendReqIntervalMinMinutes?: number;
        friendReqIntervalMaxMinutes?: number;
        welcomeMinFloorSeconds?: number;
        warmWindowDays?: number;
      };
      segmentSpec?: {
        skipRules?: Record<string, unknown>;
      };
    };
  }>(`${BASE}/:id`, { preHandler: requireGrant('trigger', 'edit') }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;
    const body = request.body ?? {};

    const existing = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: {
        id: true,
        state: true,
        segmentSpec: true,
        sendHourStart: true,
        sendHourEnd: true,
        minFriendReqGapMs: true,
        recencySkipDays: true,
        multiNickThreshold: true,
        sequenceStartDelayMinutes: true,
        pauseOnActivityHours: true,
        // #3 2026-06-06 — cần để check min ≤ max khi PATCH 1 trong 2 đầu nhịp.
        friendReqIntervalMinMinutes: true,
        friendReqIntervalMaxMinutes: true,
      },
    });
    if (!existing) return reply.status(404).send({ error: 'trigger_not_found' });
    // Terminal states không sửa được — fail-fast để FE biết không show wizard
    // sau khi user click "Sửa" trên Mục tiêu đã huỷ/hoàn tất.
    if (existing.state === 'cancelled' || existing.state === 'completed' || existing.state === 'cancelling') {
      return reply.status(400).send({ error: 'trigger_terminal_state', current: existing.state });
    }

    const data: Record<string, unknown> = {};

    // ── name ────────────────────────────────────────────────────────────────
    if (body.name !== undefined) {
      const trimmed = String(body.name).trim();
      if (!trimmed) return reply.status(400).send({ error: 'name_required' });
      data.name = trimmed;
    }

    // ── greetingTemplate (tin 1 — Phải có {name}, max 200) ──────────────────
    if (body.greetingTemplate !== undefined) {
      const trimmed = String(body.greetingTemplate).trim();
      if (!trimmed) return reply.status(400).send({ error: 'greetingTemplate_required' });
      if (trimmed.length > 200)
        return reply.status(400).send({ error: 'greetingTemplate_too_long' });
      if (!trimmed.includes('{name}'))
        return reply.status(400).send({
          error: 'greetingTemplate_missing_name',
          hint: 'Phải chứa biến {name}',
        });
      data.greetingTemplate = trimmed;
    }

    // ── welcomeMessageTemplate (tin 3 — null/empty = bỏ qua welcome gate) ──
    if (body.welcomeMessageTemplate !== undefined) {
      if (body.welcomeMessageTemplate === null) {
        data.welcomeMessageTemplate = null;
      } else {
        const trimmed = String(body.welcomeMessageTemplate).trim();
        if (trimmed.length === 0) {
          data.welcomeMessageTemplate = null;
        } else {
          if (trimmed.length > 4000)
            return reply
              .status(400)
              .send({ error: 'welcomeMessageTemplate_too_long', hint: 'Tối đa 4000 ký tự' });
          if (!trimmed.includes('{name}') && !trimmed.includes('{gender}'))
            return reply.status(400).send({
              error: 'welcomeMessageTemplate_missing_var',
              hint: 'Phải chứa {name} hoặc {gender}',
            });
          data.welcomeMessageTemplate = trimmed;
        }
      }
    }

    // ── I13 2026-06-04 — cấu hình 5 tin (sửa khi edit) ──
    if (body.welcomeDelaySeconds !== undefined)
      data.welcomeDelaySeconds = Math.max(0, Math.min(3600, Number(body.welcomeDelaySeconds) || 60));
    if (body.thankYouTemplate !== undefined)
      data.thankYouTemplate = body.thankYouTemplate?.trim() || null;
    if (body.thankYouDelaySeconds !== undefined)
      data.thankYouDelaySeconds = Math.max(0, Math.min(3600, Number(body.thankYouDelaySeconds) || 60));
    if (body.remindTemplate !== undefined)
      data.remindTemplate = body.remindTemplate?.trim() || null;
    if (body.remindDelayDays !== undefined)
      data.remindDelayDays = Math.max(1, Math.min(30, Number(body.remindDelayDays) || 3));
    if (body.rejectedTemplate !== undefined)
      data.rejectedTemplate = body.rejectedTemplate?.trim() || null;
    if (body.enableWelcome !== undefined) data.enableWelcome = !!body.enableWelcome;
    if (body.enableThankYou !== undefined) data.enableThankYou = !!body.enableThankYou;
    if (body.enableRemind !== undefined) data.enableRemind = !!body.enableRemind;
    if (body.enableRejectedFollowUp !== undefined) data.enableRejectedFollowUp = !!body.enableRejectedFollowUp;
    // #1 2026-06-06 — 2 công tắc bám đuổi.
    if (body.followUpStrangerEnabled !== undefined) data.followUpStrangerEnabled = !!body.followUpStrangerEnabled;
    if (body.followUpFriendEnabled !== undefined) data.followUpFriendEnabled = !!body.followUpFriendEnabled;
    if (body.notifyChannels !== undefined && body.notifyChannels && typeof body.notifyChannels === 'object')
      data.notifyChannels = body.notifyChannels;
    // CareSession 2026-06-07 — điều kiện đóng phiên (edit).
    if (body.closeConditions !== undefined && body.closeConditions && typeof body.closeConditions === 'object')
      data.closeConditions = body.closeConditions;

    // ── welcomeDelaySeconds ─────────────────────────────────────────────────
    if (body.welcomeDelaySeconds !== undefined) {
      const v = Number(body.welcomeDelaySeconds);
      if (!Number.isFinite(v) || v < 0 || v > 3600)
        return reply
          .status(400)
          .send({ error: 'welcomeDelaySeconds_invalid', hint: 'Phải từ 0 đến 3600 giây' });
      data.welcomeDelaySeconds = Math.round(v);
    }

    // ── safetyRules → 7 schema cols (concurrencyPerNickPerMinute không expose) ─
    if (body.safetyRules !== undefined) {
      const sr = body.safetyRules;
      let sendHourStart = existing.sendHourStart;
      let sendHourEnd = existing.sendHourEnd;
      if (sr.quietHoursStart !== undefined) {
        sendHourStart = parseQuietHour(sr.quietHoursStart, existing.sendHourStart);
      }
      if (sr.quietHoursEnd !== undefined) {
        sendHourEnd = parseQuietHour(sr.quietHoursEnd, existing.sendHourEnd);
      }
      if (sendHourStart >= sendHourEnd) {
        return reply.status(400).send({
          error: 'workingHours_invalid_range',
          hint: 'Giờ bắt đầu phải nhỏ hơn giờ kết thúc',
          sendHourStart,
          sendHourEnd,
        });
      }
      if (sr.quietHoursStart !== undefined) data.sendHourStart = sendHourStart;
      if (sr.quietHoursEnd !== undefined) data.sendHourEnd = sendHourEnd;

      if (sr.sendIntervalSeconds !== undefined) {
        const v = Number(sr.sendIntervalSeconds);
        if (!Number.isFinite(v) || v < 1 || v > 3600)
          return reply
            .status(400)
            .send({ error: 'sendIntervalSeconds_invalid', hint: 'Phải từ 1 đến 3600 giây' });
        data.minFriendReqGapMs = Math.round(v * 1000);
      }
      if (sr.recencyDays !== undefined) {
        const v = Number(sr.recencyDays);
        if (!Number.isFinite(v) || v < 0 || v > 365)
          return reply
            .status(400)
            .send({ error: 'recencyDays_invalid', hint: 'Phải từ 0 đến 365 ngày' });
        data.recencySkipDays = Math.round(v);
      }
      if (sr.multinickThreshold !== undefined) {
        const v = Number(sr.multinickThreshold);
        if (!Number.isFinite(v) || v < 0 || v > 100)
          return reply
            .status(400)
            .send({ error: 'multinickThreshold_invalid', hint: 'Phải từ 0 đến 100' });
        data.multiNickThreshold = Math.round(v);
      }
      // 2026-06-16 — ưu tiên GIÂY khi PATCH (set cả 2 cột); fallback phút cho contract cũ.
      if (sr.delayAfterFriendRequestSeconds !== undefined) {
        const v = Number(sr.delayAfterFriendRequestSeconds);
        if (!Number.isFinite(v) || v < 0 || v > 604800)
          return reply.status(400).send({
            error: 'delayAfterFriendRequestSeconds_invalid',
            hint: 'Phải từ 0 đến 604800 giây (7 ngày)',
          });
        data.sequenceStartDelaySeconds = Math.round(v);
        data.sequenceStartDelayMinutes = Math.round(v / 60);
      } else if (sr.delayAfterFriendRequestMin !== undefined) {
        const v = Number(sr.delayAfterFriendRequestMin);
        if (!Number.isFinite(v) || v < 0 || v > 10080)
          return reply.status(400).send({
            error: 'delayAfterFriendRequestMin_invalid',
            hint: 'Phải từ 0 đến 10080 phút (1 tuần)',
          });
        const mins = Math.round(v);
        data.sequenceStartDelayMinutes = mins;
        data.sequenceStartDelaySeconds = mins * 60;
      }
      if (sr.pauseHoursOnReply !== undefined) {
        const v = Number(sr.pauseHoursOnReply);
        if (!Number.isFinite(v) || v < 1 || v > 720)
          return reply
            .status(400)
            .send({ error: 'pauseHoursOnReply_invalid', hint: 'Phải từ 1 đến 720 giờ (30 ngày)' });
        data.pauseOnActivityHours = Math.round(v);
      }
      // #3 2026-06-06 — nhịp gửi lời mời (min/max phút) + sàn welcome + cửa sổ warm.
      // Lấy effective min/max (body override > giá trị hiện tại) để check min ≤ max.
      let effMin = existing.friendReqIntervalMinMinutes;
      let effMax = existing.friendReqIntervalMaxMinutes;
      if (sr.friendReqIntervalMinMinutes !== undefined) {
        const v = Number(sr.friendReqIntervalMinMinutes);
        if (!Number.isFinite(v) || v < 0 || v > 1440)
          return reply.status(400).send({ error: 'friendReqIntervalMin_invalid', hint: 'Phải từ 0 đến 1440 phút' });
        effMin = Math.round(v);
      }
      if (sr.friendReqIntervalMaxMinutes !== undefined) {
        const v = Number(sr.friendReqIntervalMaxMinutes);
        if (!Number.isFinite(v) || v < 0 || v > 1440)
          return reply.status(400).send({ error: 'friendReqIntervalMax_invalid', hint: 'Phải từ 0 đến 1440 phút' });
        effMax = Math.round(v);
      }
      if (effMax < effMin)
        return reply.status(400).send({ error: 'friendReqInterval_range', hint: 'Nhịp tối đa phải ≥ nhịp tối thiểu' });
      if (sr.friendReqIntervalMinMinutes !== undefined) data.friendReqIntervalMinMinutes = effMin;
      if (sr.friendReqIntervalMaxMinutes !== undefined) data.friendReqIntervalMaxMinutes = effMax;
      if (sr.welcomeMinFloorSeconds !== undefined) {
        const v = Number(sr.welcomeMinFloorSeconds);
        if (!Number.isFinite(v) || v < 0 || v > 3600)
          return reply.status(400).send({ error: 'welcomeMinFloorSeconds_invalid', hint: 'Phải từ 0 đến 3600 giây' });
        data.welcomeMinFloorSeconds = Math.round(v);
      }
      if (sr.warmWindowDays !== undefined) {
        const v = Number(sr.warmWindowDays);
        if (!Number.isFinite(v) || v < 0 || v > 365)
          return reply.status(400).send({ error: 'warmWindowDays_invalid', hint: 'Phải từ 0 đến 365 ngày' });
        data.warmWindowDays = Math.round(v);
      }
    }

    // ── segmentSpec.skipRules (merge — KHÔNG cho đổi listId/nickIds) ────────
    if (body.segmentSpec?.skipRules !== undefined) {
      const oldSpec = (existing.segmentSpec ?? {}) as Record<string, unknown>;
      data.segmentSpec = {
        ...oldSpec,
        skipRules: body.segmentSpec.skipRules,
      } as object;
    }

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: 'no_fields_to_update' });
    }

    const updated = await prisma.automationTrigger.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        name: true,
        state: true,
        greetingTemplate: true,
        welcomeMessageTemplate: true,
        welcomeDelaySeconds: true,
        sendHourStart: true,
        sendHourEnd: true,
        minFriendReqGapMs: true,
        recencySkipDays: true,
        multiNickThreshold: true,
        sequenceStartDelayMinutes: true,
        pauseOnActivityHours: true,
      },
    });

    logger.info(
      `[friend-invite] trigger ${updated.id} patched fields=[${Object.keys(data).join(',')}]`,
    );

    return reply.send({ ok: true, trigger: updated });
  });

  // ── GET /list-muc-tieu (+ alias /muc-tieu/list) ───────────────────────────
  // Wave 3 2026-05-30 — list Mục tiêu với counters cho UI overview page.
  // Query: search? status? limit=50 offset=0
  type MucTieuListQuery = {
    search?: string;
    status?: string;
    limit?: string;
    offset?: string;
  };
  const listMucTieuHandler = async (
    request: import('fastify').FastifyRequest<{ Querystring: MucTieuListQuery }>,
    reply: import('fastify').FastifyReply,
  ) => {
    const user = request.user!;
    const q = request.query ?? {};
    const limit = q.limit !== undefined ? Number(q.limit) : undefined;
    const offset = q.offset !== undefined ? Number(q.offset) : undefined;
    try {
      const result = await listMucTieuForOrg(user.orgId, {
        search: q.search,
        status: q.status,
        limit: Number.isFinite(limit) ? (limit as number) : undefined,
        offset: Number.isFinite(offset) ? (offset as number) : undefined,
      });
      return reply.send(result);
    } catch (err) {
      logger.error('[friend-invite] list-muc-tieu failed:', err);
      return reply.status(500).send({ error: 'list_failed' });
    }
  };
  app.get<{ Querystring: MucTieuListQuery }>(`${BASE}/list-muc-tieu`, { preHandler: requireGrant('trigger', 'access') }, listMucTieuHandler);
  app.get<{ Querystring: MucTieuListQuery }>(
    '/api/v1/automation/muc-tieu/list',
    { preHandler: requireGrant('trigger', 'access') },
    listMucTieuHandler,
  );

  // ── POST /preview (+ alias /muc-tieu/preview) ─────────────────────────────
  // Wave 3 Wizard Bước 3 — preview ETA + nick distribution + 3 KH mẫu.
  // Tham chiếu memory M51.2 (công thức N × 32 KB/ngày).
  type PreviewBody = Omit<PreviewInput, 'orgId'> & { listId?: string };
  const previewHandler = async (
    request: import('fastify').FastifyRequest<{ Body: PreviewBody }>,
    reply: import('fastify').FastifyReply,
  ) => {
    const user = request.user!;
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: 'body_required' });
    }
    // Wave 3 Wizard alias — FE gửi `listId` (UI ngắn gọn), BE service đòi `customerListId`.
    const customerListId = body.customerListId ?? body.listId;
    if (!customerListId) {
      return reply.status(400).send({ error: 'customerListId_required' });
    }
    if (!Array.isArray(body.nickIds) || body.nickIds.length === 0) {
      return reply.status(400).send({ error: 'nickIds_required' });
    }
    try {
      const result = await calculateMucTieuPreview(
        {
          orgId: user.orgId,
          customerListId,
          nickIds: body.nickIds,
          skipRules: body.skipRules ?? {},
          sequenceId: body.sequenceId ?? null,
          greetingTemplate: body.greetingTemplate ?? null,
          welcomeMessageTemplate: body.welcomeMessageTemplate ?? null,
          delayAvgMinOverride: body.delayAvgMinOverride ?? null,
          saleNameOverride: body.saleNameOverride ?? null,
        },
        { userId: user.id },
      );
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg === 'customer_list_not_found' ||
        msg === 'no_valid_nicks' ||
        msg.endsWith('_required')
      ) {
        return reply.status(400).send({ error: msg });
      }
      logger.error('[friend-invite] preview failed:', err);
      return reply.status(500).send({ error: 'preview_failed' });
    }
  };

  app.post<{ Body: PreviewBody }>(`${BASE}/preview`, previewHandler);
  app.post<{ Body: PreviewBody }>('/api/v1/automation/muc-tieu/preview', previewHandler);

  // ── GET /:id/events — Timeline events (Wave 3) ────────────────────────────
  // Pagination + filter cho Mục tiêu Detail timeline.
  // Alias /muc-tieu/:id/events giữ tương thích với UI dùng từ "Mục tiêu".
  type EventsQuery = {
    limit?: string;
    offset?: string;
    eventType?: string;
    // FE alias: <FilterChip> gửi `type` (xem MucTieuDetailView loadLog), BE cũ chỉ
    // đọc `eventType` → filter chip bị bỏ qua. Giữ cả 2 để khỏi break caller cũ.
    type?: string;
    from?: string;
    to?: string;
    search?: string;
    // FE alias: search box gửi `q`, BE cũ chỉ đọc `search` → text filter bị bỏ qua.
    q?: string;
  };
  const eventsHandler = async (
    request: import('fastify').FastifyRequest<{ Params: { id: string }; Querystring: EventsQuery }>,
    reply: import('fastify').FastifyReply,
  ) => {
    const user = request.user!;
    const { id } = request.params;
    const q = request.query ?? {};

    // Verify trigger belongs to user.orgId (security boundary — không tin
    // FE truyền triggerId của org khác).
    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });

    const rawLimit = Number(q.limit ?? 50);
    const rawOffset = Number(q.offset ?? 0);
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

    // P0-2 BE shape /events — default window = 7 ngày gần nhất theo VN timezone
    // nếu FE không truyền `from`/`to` (UI overview hay query "tuần này").
    // startOfDayVN(now - 7d) → endOfDayVN(now).
    //
    // QUAN TRỌNG: <input type="date"> ở FE luôn trả date-only string 'YYYY-MM-DD'.
    // `new Date('2026-05-30')` parse-as-UTC midnight (Date spec) — KHÔNG phải VN
    // midnight. Nếu mình dùng raw Date thì from === to === 00:00:00Z UTC, range
    // `gte ∧ lte` trở thành 1 điểm duy nhất → 0 row. Phải normalize sang VN-day
    // boundary (xem memory feedback_timezone_vietnam.md). Detect date-only bằng
    // regex YYYY-MM-DD; nếu FE truyền ISO đầy đủ (vd /events/live `since`) thì
    // dùng nguyên.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const now = new Date();
    let createdAtGte: Date | null = null;
    let createdAtLte: Date | null = null;
    if (q.from) {
      const d = new Date(q.from);
      if (!Number.isNaN(d.getTime())) {
        createdAtGte = DATE_ONLY_RE.test(q.from) ? startOfDayVN(d) : d;
      }
    }
    if (q.to) {
      const d = new Date(q.to);
      if (!Number.isNaN(d.getTime())) {
        createdAtLte = DATE_ONLY_RE.test(q.to) ? endOfDayVN(d) : d;
      }
    }
    if (!createdAtGte) createdAtGte = startOfDayVN(new Date(now.getTime() - 7 * DAY_MS));
    if (!createdAtLte) createdAtLte = endOfDayVN(now);

    // Alias FE↔BE: FE gửi `type`/`q`, legacy callers gửi `eventType`/`search`.
    // Bỏ qua 'all' / chuỗi rỗng để khỏi filter sai.
    const typeFilter = q.eventType ?? q.type;
    const searchFilter = q.search ?? q.q;

    const where: {
      triggerId: string;
      eventType?: string;
      createdAt?: { gte?: Date; lte?: Date };
      summary?: { contains: string; mode: 'insensitive' };
    } = {
      triggerId: trigger.id,
      createdAt: { gte: createdAtGte, lte: createdAtLte },
    };
    if (typeFilter && typeof typeFilter === 'string' && typeFilter !== 'all' && typeFilter.trim()) {
      where.eventType = typeFilter.trim();
    }
    if (typeof searchFilter === 'string' && searchFilter.trim()) {
      where.summary = { contains: searchFilter.trim(), mode: 'insensitive' };
    }

    try {
      const [rows, total] = await Promise.all([
        prisma.automationEventLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.automationEventLog.count({ where }),
      ]);
      const events = await enrichEventRows(rows, trigger.id);
      return reply.send({
        events,
        total,
        limit,
        offset,
        from: createdAtGte.toISOString(),
        to: createdAtLte.toISOString(),
      });
    } catch (err) {
      logger.error('[friend-invite] events list failed:', err);
      return reply.status(500).send({ error: 'events_query_failed' });
    }
  };
  app.get<{ Params: { id: string }; Querystring: EventsQuery }>(
    `${BASE}/:id/events`,
    eventsHandler,
  );
  app.get<{ Params: { id: string }; Querystring: EventsQuery }>(
    '/api/v1/automation/muc-tieu/:id/events',
    eventsHandler,
  );

  // ── GET /:id/events/live — Monitor live tail (Wave 3) ─────────────────────
  // Top 20 row mới nhất kể từ `since` (ISO). FE poll 5s 1 lần.
  // Defer Wave 4 chuyển sang WebSocket nếu nhiều Mục tiêu active đồng thời (xem openIssues).
  type LiveQuery = { since?: string };
  const eventsLiveHandler = async (
    request: import('fastify').FastifyRequest<{ Params: { id: string }; Querystring: LiveQuery }>,
    reply: import('fastify').FastifyReply,
  ) => {
    const user = request.user!;
    const { id } = request.params;
    const q = request.query ?? {};

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });

    const where: {
      triggerId: string;
      createdAt?: { gt: Date };
    } = { triggerId: trigger.id };
    if (q.since) {
      const d = new Date(q.since);
      if (!Number.isNaN(d.getTime())) where.createdAt = { gt: d };
    }

    try {
      const rows = await prisma.automationEventLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const events = await enrichEventRows(rows, trigger.id);
      // P0-2 BE shape /events/live — total = số event đã enrich trả lần này
      // (không phải total trigger life-time). FE chỉ append vào head timeline.
      return reply.send({
        events,
        total: events.length,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[friend-invite] events live failed:', err);
      return reply.status(500).send({ error: 'events_live_failed' });
    }
  };
  app.get<{ Params: { id: string }; Querystring: LiveQuery }>(
    `${BASE}/:id/events/live`,
    eventsLiveHandler,
  );
  app.get<{ Params: { id: string }; Querystring: LiveQuery }>(
    '/api/v1/automation/muc-tieu/:id/events/live',
    eventsLiveHandler,
  );
}

// VN timezone helpers — Asia/Ho_Chi_Minh fixed offset +07:00.
// Cả 2 hàm accept optional Date (default = now). Trả về Date ở UTC tương ứng
// với 00:00:00.000 / 23:59:59.999 giờ VN của ngày input.
function startOfDayVN(input?: Date): Date {
  const base = input ?? new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(base.getTime() + vnOffset);
  vnNow.setUTCHours(0, 0, 0, 0);
  return new Date(vnNow.getTime() - vnOffset);
}

function endOfDayVN(input?: Date): Date {
  const base = input ?? new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(base.getTime() + vnOffset);
  vnNow.setUTCHours(23, 59, 59, 999);
  return new Date(vnNow.getTime() - vnOffset);
}

// ── Event enrichment helpers (P0-2 BE shape /events) ───────────────────────
// Map eventType → icon / text-template / tone. Tone drives chip màu trong FE
// (success/info/warn/danger/neutral). icon dùng emoji ngắn cho timeline header.
// Phần `text` chỉ là fallback nếu không có summary; FE thường ưu tiên summary.
type EventCosmetic = { icon: string; text: string; tone: string };
function cosmeticForEventType(eventType: string): EventCosmetic {
  switch (eventType) {
    case 'friend_request_sent':
      return { icon: '📤', text: 'Đã gửi lời mời kết bạn', tone: 'info' };
    case 'friend_request_accepted':
    case 'friend_accepted':
      return { icon: '🤝', text: 'KH đã chấp nhận kết bạn', tone: 'success' };
    case 'friend_already':
      return { icon: '✅', text: 'KH đã là bạn (skip kết bạn, vào luôn bám đuổi)', tone: 'success' };
    case 'friend_request_failed':
    case 'friend_request_rejected':
      return { icon: '⚠️', text: 'Gửi lời mời thất bại', tone: 'warn' };
    case 'welcome_sent':
    case 'welcome_message_sent':
      return { icon: '👋', text: 'Đã gửi tin chào mừng', tone: 'info' };
    case 'sequence_enrolled':
      return { icon: '🎯', text: 'KH vào luồng chăm sóc', tone: 'success' };
    case 'sequence_step_sent':
      return { icon: '✉️', text: 'Đã gửi bước chăm sóc', tone: 'info' };
    case 'sequence_done':
      return { icon: '✅', text: 'Luồng chăm sóc hoàn tất', tone: 'success' };
    case 'customer_reply':
      return { icon: '💬', text: 'KH trả lời', tone: 'success' };
    case 'customer_block':
      return { icon: '🚫', text: 'KH chặn nick', tone: 'danger' };
    case 'skipped_friend_cap':
    case 'skipped_recency':
    case 'skipped_status':
    case 'skipped_no_zalo':
      return { icon: '⏭️', text: 'Bỏ qua KH', tone: 'neutral' };
    case 'failed_permanent':
    case 'failed_stuck':
      return { icon: '❌', text: 'Lỗi vĩnh viễn', tone: 'danger' };
    case 'cancelled':
      return { icon: '🛑', text: 'Đã huỷ', tone: 'neutral' };
    default:
      return { icon: '•', text: eventType, tone: 'info' };
  }
}

// Enrich một batch event log rows: bulk-load ZaloAccount.displayName + Contact.displayName
// + CustomerListEntry.rowIndex (theo triggerId+contactId) rồi map về shape mới.
// Reply shape: { id, at, type, icon, text, tone, nickName, customerName, rowIndex, status, detail }.
async function enrichEventRows(
  rows: Array<{
    id: string;
    // Luồng Mục Tiêu M3 (2026-06-02): triggerId optional in unified model
    triggerId: string | null;
    eventType: string;
    eventPriority: string;
    // Wave 3 dùng summary; Luồng Mục Tiêu dùng detail. Cả hai cùng tồn tại.
    summary: string | null;
    detail: string | null;
    metadata: unknown;
    contactId: string | null;
    nickId: string | null;
    createdAt: Date;
  }>,
  triggerId: string,
): Promise<
  Array<{
    id: string;
    at: string;
    type: string;
    icon: string;
    text: string;
    tone: string;
    nickName: string | null;
    customerName: string | null;
    rowIndex: number | null;
    status: string;
    detail: unknown;
    metadata: unknown;
  }>
> {
  if (rows.length === 0) return [];

  const distinctNickIds = Array.from(
    new Set(rows.map((r) => r.nickId).filter((x): x is string => !!x)),
  );
  const distinctContactIds = Array.from(
    new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x)),
  );

  const [nicks, contacts, entries] = await Promise.all([
    distinctNickIds.length > 0
      ? prisma.zaloAccount.findMany({
          where: { id: { in: distinctNickIds } },
          select: { id: true, displayName: true },
        })
      : Promise.resolve([]),
    distinctContactIds.length > 0
      ? prisma.contact.findMany({
          where: { id: { in: distinctContactIds } },
          // Contact không có cột displayName — UI chuẩn dùng fullName, fallback crmName / zaloUsername.
          select: { id: true, fullName: true, crmName: true, zaloUsername: true },
        })
      : Promise.resolve([]),
    // #2 2026-06-06 — rowIndex theo (trigger, contact) lấy qua bảng nối → entry.
    distinctContactIds.length > 0
      ? prisma.triggerQueueEntry.findMany({
          where: { triggerId, contactId: { in: distinctContactIds } },
          select: { contactId: true, entry: { select: { rowIndex: true } } },
        }).then((qs) => qs.map((q) => ({ contactId: q.contactId, rowIndex: q.entry?.rowIndex ?? null })))
      : Promise.resolve([]),
  ]);

  const nickNameById = new Map(nicks.map((n) => [n.id, n.displayName]));
  const customerNameById = new Map(
    contacts.map((c) => [c.id, c.fullName ?? c.crmName ?? c.zaloUsername ?? null]),
  );
  const rowIndexByContact = new Map<string, number>();
  for (const e of entries) {
    if (e.contactId && typeof e.rowIndex === 'number') {
      rowIndexByContact.set(e.contactId, e.rowIndex);
    }
  }

  return rows.map((r) => {
    const cosmetic = cosmeticForEventType(r.eventType);
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      type: r.eventType,
      icon: cosmetic.icon,
      text: cosmetic.text,
      tone: cosmetic.tone,
      nickName: r.nickId ? nickNameById.get(r.nickId) ?? null : null,
      customerName: r.contactId ? customerNameById.get(r.contactId) ?? null : null,
      rowIndex: r.contactId ? rowIndexByContact.get(r.contactId) ?? null : null,
      status: r.eventPriority,
      // FIX 2026-06-03 (code-review CONFIRMED): event-hooks Luồng Mục Tiêu (reaction/
      // reply/block/manual) ghi vào cột `detail` (emoji, replyText), KHÔNG ghi summary.
      // Bản trước chỉ đọc r.summary → detailText FE mất emoji/text. Đọc detail TRƯỚC,
      // fallback summary (Wave 3 dùng summary cho welcome/friend events).
      detail: r.detail || r.summary || null,
      // I6 2026-06-03 — trả metadata riêng để FE detailText() dựng "Gửi bước 2/4"
      // từ metadata.stepIdx/totalSteps, welcome channel, v.v. (trước đây gộp vào detail).
      metadata: r.metadata ?? null,
    };
  });
}
