/**
 * lead-pool-service.ts — Phase Lead Pool 2026-05-24.
 *
 * Sale rảnh → /lead-pool/request → backend tự pick top priority lead bị bỏ rơi
 * → lock Contact.assignedUserId trong transaction → trả full payload.
 * Force note để xin lead tiếp. Cron auto-return quá hạn.
 *
 * Spec đầy đủ: docs/DESIGN-LEAD-POOL.md
 *
 * Sources:
 *   - 'forgotten'      : Contact.lastActivity > forgottenThresholdDays
 *   - 'customer_list'  : CustomerListEntry trong list.shareableToPool=true
 *   - 'external_sync'  : future (Getfly sync)
 */
import { randomUUID } from 'node:crypto';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';
import { updateContactAggregate } from '../scoring/aggregate-contact.js';

export type LeadSource = 'forgotten' | 'customer_list' | 'external_sync';
export type ReleaseReason = 'completed' | 'auto_return' | 'manual_return';

export class LeadPoolError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
  }
}

interface PoolConfig {
  enabled: boolean;
  maxRequestsPerDay: number;
  cooldownMinutes: number;
  forgottenThresholdDays: number;
  excludedStatuses: string[];
  // Phase v2: granular minutes (30 → 10080 = 7 ngày). Deprecated `autoReturnAfterDays` removed from interface.
  autoReturnAfterMinutes: number;
  // Phase v2: filter lead chỉ-có-UID-không-có-phone (sale mới không liên lạc được vì UID per-viewer).
  requirePhoneInPool: boolean;
  forceNoteBeforeNext: boolean;
  enabledSources: LeadSource[];
  noteMinLength: number;
  // 2026-05-29 — Sau khi sale note xong, KH bị khoá pool N ngày. Chống spam chia lại
  // cùng 1 lead. Sale gốc vẫn chăm KH bình thường. Bấm "Trả lại pool" → bypass.
  cooldownAfterNoteDays: number;
  // 2026-05-29 v2.I — Sale trả lead → sale đó KHÔNG được xin lại trong N ngày.
  // Sale khác vẫn xin được ngay. Chống spam loop xin-trả-xin lại cùng KH.
  selfReclaimLockDays: number;
  // 2026-05-28 — array template câu chào. Empty → service fallback DEFAULT_GREETING_TEMPLATES.
  // 2026-06-19 (C): mỗi câu = {text, styles} (Zalo-native, như Khối) → preview + gửi-thẳng có
  // màu/đậm. Tương thích ngược: câu cũ lưu string → coi như {text, styles:[]} (text trơn).
  greetingTemplates: GreetingTemplate[];
  // 2026-06-19 (D) — pool chỉ lấy lead từ các tệp KH này (customer_list ids). Rỗng = lấy
  // MỌI tệp có shareable_to_pool=true (hành vi cũ). Chỉ áp khi nguồn 'customer_list' đang bật.
  sourceListIds: string[];
}

// 2026-06-19 (C) — câu chào có định dạng (đồng bộ Khối: {st,start,len}).
export interface GreetingStyle { st: string; start: number; len: number }
export interface GreetingTemplate { text: string; styles: GreetingStyle[] }

/** Chuẩn hoá 1 template: chấp nhận string cũ HOẶC {text,styles} mới → {text,styles}. */
function normalizeGreeting(raw: unknown): GreetingTemplate | null {
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t ? { text: t.slice(0, 500), styles: [] } : null;
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { text?: unknown; styles?: unknown };
    const text = typeof o.text === 'string' ? o.text.trim().slice(0, 500) : '';
    if (!text) return null;
    const styles = Array.isArray(o.styles)
      ? (o.styles as unknown[]).filter((s): s is GreetingStyle =>
          !!s && typeof (s as any).st === 'string' && typeof (s as any).start === 'number' && typeof (s as any).len === 'number')
      : [];
    return { text, styles };
  }
  return null;
}
function normalizeGreetingList(raw: unknown): GreetingTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeGreeting).filter((g): g is GreetingTemplate => !!g).slice(0, 10);
}

// Bounds cho auto-return: 30 phút (rotate nhanh) → 7 ngày (10080 phút)
const AUTO_RETURN_MIN = 30;
const AUTO_RETURN_MAX = 10080;

const DEFAULT_CONFIG: PoolConfig = {
  enabled: true,
  maxRequestsPerDay: 10,
  cooldownMinutes: 15,
  forgottenThresholdDays: 30,
  excludedStatuses: [], // 2026-06-19: statusId thật của org (admin chọn); rỗng = không loại trạng thái nào
  autoReturnAfterMinutes: 1440, // 1 ngày
  requirePhoneInPool: true,
  forceNoteBeforeNext: true,
  enabledSources: ['forgotten', 'customer_list'],
  noteMinLength: 20,
  cooldownAfterNoteDays: 30,
  selfReclaimLockDays: 7,
  greetingTemplates: [], // empty → service dùng DEFAULT_GREETING_TEMPLATES
  sourceListIds: [], // rỗng = mọi tệp shareable
};

// Codex MEDIUM-2 fix: validate JSON config — Array.isArray + filter known enum.
const VALID_SOURCES: LeadSource[] = ['forgotten', 'customer_list', 'external_sync'];

function safeStringArray(raw: unknown, fallback: string[], allowed?: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const filtered = raw.filter((s): s is string => typeof s === 'string');
  if (allowed) return filtered.filter((s) => allowed.includes(s));
  return filtered;
}

export async function getOrCreateConfig(orgId: string): Promise<PoolConfig> {
  const existing = await prisma.leadPoolConfig.findUnique({ where: { orgId } });
  if (existing) {
    return {
      enabled: Boolean(existing.enabled),
      maxRequestsPerDay: Math.max(1, Math.min(100, existing.maxRequestsPerDay)),
      cooldownMinutes: Math.max(0, Math.min(180, existing.cooldownMinutes)),
      forgottenThresholdDays: Math.max(1, Math.min(365, existing.forgottenThresholdDays)),
      excludedStatuses: safeStringArray(existing.excludedStatuses, DEFAULT_CONFIG.excludedStatuses),
      autoReturnAfterMinutes: Math.max(AUTO_RETURN_MIN, Math.min(AUTO_RETURN_MAX, existing.autoReturnAfterMinutes)),
      requirePhoneInPool: Boolean(existing.requirePhoneInPool),
      forceNoteBeforeNext: Boolean(existing.forceNoteBeforeNext),
      enabledSources: safeStringArray(existing.enabledSources, DEFAULT_CONFIG.enabledSources, VALID_SOURCES) as LeadSource[],
      noteMinLength: Math.max(5, Math.min(500, existing.noteMinLength)),
      cooldownAfterNoteDays: Math.max(0, Math.min(365, existing.cooldownAfterNoteDays)),
      selfReclaimLockDays: Math.max(0, Math.min(365, (existing as any).selfReclaimLockDays ?? 7)),
      greetingTemplates: normalizeGreetingList(existing.greetingTemplates),
      sourceListIds: safeStringArray((existing as any).sourceListIds, []),
    };
  }
  await prisma.leadPoolConfig.create({
    data: {
      id: randomUUID(),
      orgId,
      enabled: DEFAULT_CONFIG.enabled,
      maxRequestsPerDay: DEFAULT_CONFIG.maxRequestsPerDay,
      cooldownMinutes: DEFAULT_CONFIG.cooldownMinutes,
      forgottenThresholdDays: DEFAULT_CONFIG.forgottenThresholdDays,
      excludedStatuses: DEFAULT_CONFIG.excludedStatuses,
      autoReturnAfterMinutes: DEFAULT_CONFIG.autoReturnAfterMinutes,
      requirePhoneInPool: DEFAULT_CONFIG.requirePhoneInPool,
      forceNoteBeforeNext: DEFAULT_CONFIG.forceNoteBeforeNext,
      enabledSources: DEFAULT_CONFIG.enabledSources,
      noteMinLength: DEFAULT_CONFIG.noteMinLength,
      cooldownAfterNoteDays: DEFAULT_CONFIG.cooldownAfterNoteDays,
      selfReclaimLockDays: DEFAULT_CONFIG.selfReclaimLockDays,
      sourceListIds: DEFAULT_CONFIG.sourceListIds,
    },
  });
  return { ...DEFAULT_CONFIG };
}

// Codex MEDIUM-1 fix: whitelist allowed PATCH fields + per-field validation.
// Reject extraneous keys (vd orgId, id, timestamps) để admin không bypass schema.
export async function updateConfig(orgId: string, patch: Partial<PoolConfig>): Promise<PoolConfig> {
  await getOrCreateConfig(orgId); // ensure exists

  const data: Record<string, unknown> = {};
  if (typeof patch.enabled === 'boolean') data.enabled = patch.enabled;
  if (typeof patch.maxRequestsPerDay === 'number' && Number.isInteger(patch.maxRequestsPerDay)) {
    data.maxRequestsPerDay = Math.max(1, Math.min(100, patch.maxRequestsPerDay));
  }
  if (typeof patch.cooldownMinutes === 'number' && Number.isInteger(patch.cooldownMinutes)) {
    data.cooldownMinutes = Math.max(0, Math.min(180, patch.cooldownMinutes));
  }
  if (typeof patch.forgottenThresholdDays === 'number' && Number.isInteger(patch.forgottenThresholdDays)) {
    data.forgottenThresholdDays = Math.max(1, Math.min(365, patch.forgottenThresholdDays));
  }
  if (typeof patch.autoReturnAfterMinutes === 'number' && Number.isInteger(patch.autoReturnAfterMinutes)) {
    data.autoReturnAfterMinutes = Math.max(AUTO_RETURN_MIN, Math.min(AUTO_RETURN_MAX, patch.autoReturnAfterMinutes));
  }
  if (typeof patch.requirePhoneInPool === 'boolean') data.requirePhoneInPool = patch.requirePhoneInPool;
  if (typeof patch.forceNoteBeforeNext === 'boolean') data.forceNoteBeforeNext = patch.forceNoteBeforeNext;
  if (typeof patch.noteMinLength === 'number' && Number.isInteger(patch.noteMinLength)) {
    data.noteMinLength = Math.max(5, Math.min(500, patch.noteMinLength));
  }
  if (typeof patch.cooldownAfterNoteDays === 'number' && Number.isInteger(patch.cooldownAfterNoteDays)) {
    data.cooldownAfterNoteDays = Math.max(0, Math.min(365, patch.cooldownAfterNoteDays));
  }
  if (typeof patch.selfReclaimLockDays === 'number' && Number.isInteger(patch.selfReclaimLockDays)) {
    data.selfReclaimLockDays = Math.max(0, Math.min(365, patch.selfReclaimLockDays));
  }
  if (Array.isArray(patch.excludedStatuses)) {
    // 2026-06-19: statusId thật của org (uuid) — không whitelist enum cứng nữa.
    data.excludedStatuses = safeStringArray(patch.excludedStatuses, []).slice(0, 50);
  }
  if (Array.isArray(patch.enabledSources)) {
    data.enabledSources = safeStringArray(patch.enabledSources, [], VALID_SOURCES);
  }
  if (Array.isArray(patch.sourceListIds)) {
    // 2026-06-19 (D): customer_list ids pool được phép lấy. Chỉ giữ id thuộc org này.
    const ids = safeStringArray(patch.sourceListIds, []).slice(0, 200);
    if (ids.length > 0) {
      const owned = await prisma.customerList.findMany({
        where: { id: { in: ids }, orgId }, select: { id: true },
      });
      data.sourceListIds = owned.map((l) => l.id);
    } else {
      data.sourceListIds = [];
    }
  }
  if (Array.isArray(patch.greetingTemplates)) {
    // 2026-06-19 (C): chấp nhận string cũ HOẶC {text,styles} mới → chuẩn hoá {text,styles}.
    data.greetingTemplates = normalizeGreetingList(patch.greetingTemplates);
  }

  await prisma.leadPoolConfig.update({ where: { orgId }, data });
  return getOrCreateConfig(orgId);
}

interface EligibilityResult {
  canRequest: boolean;
  reason?: 'cooldown' | 'daily_cap' | 'unsubmitted_note' | 'disabled' | 'no_leads';
  remainingToday: number;
  pendingNoteLead?: { leadRequestId: string; contactId: string; contactName: string | null; contactPhone?: string | null; requestedAt: Date; expiresAt?: Date | string | null };
  nextAvailableAt?: Date;
  config: PoolConfig;
}

/**
 * Calendar day VN (Asia/Ho_Chi_Minh UTC+7). 00:00 VN → reset quota.
 * Memory rule feedback_timezone_vietnam: tất cả counter phải reset theo giờ VN.
 */
function startOfTodayVN(): Date {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  vnNow.setUTCHours(0, 0, 0, 0);
  return new Date(vnNow.getTime() - 7 * 60 * 60 * 1000);
}

function todayDateKeyVN(): string {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${vnNow.getUTCFullYear()}-${String(vnNow.getUTCMonth() + 1).padStart(2, '0')}-${String(vnNow.getUTCDate()).padStart(2, '0')}`;
}

async function getBonusQuotaTodayVN(userId: string): Promise<number> {
  const agg = await prisma.leadPoolBonusQuota.aggregate({
    where: { userId, dateKey: todayDateKeyVN() },
    _sum: { bonusCount: true },
  });
  return agg._sum.bonusCount ?? 0;
}

/** VN convention: tên riêng = từ cuối, proper case. "Phạm Chí Thành" → "Thành". */
function vietnameseFirstName(fullName: string | null): string {
  if (!fullName) return '';
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const parts = trimmed.split(' ');
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
}

export async function checkEligibility(orgId: string, userId: string): Promise<EligibilityResult> {
  const config = await getOrCreateConfig(orgId);

  if (!config.enabled) {
    return { canRequest: false, reason: 'disabled', remainingToday: 0, config };
  }

  // Quota + last request load song song
  const startToday = startOfTodayVN();
  const [todayCount, bonusToday, lastRequest] = await Promise.all([
    prisma.leadRequest.count({
      where: { requestedByUserId: userId, requestedAt: { gte: startToday } },
    }),
    getBonusQuotaTodayVN(userId),
    prisma.leadRequest.findFirst({
      where: { requestedByUserId: userId },
      orderBy: { requestedAt: 'desc' },
      select: { requestedAt: true, id: true, contactId: true, noteSubmittedAt: true, releaseReason: true, contact: { select: { fullName: true, crmName: true } } },
    }),
  ]);
  const effectiveCap = config.maxRequestsPerDay + bonusToday;
  const remainingToday = Math.max(0, effectiveCap - todayCount);

  // 1. Unsubmitted note ưu tiên HƠN daily_cap — fix 2026-05-28:
  //    Lead cuối (đụng quota) chưa note thì FAB phải hiện pending mode để sale reopen lại.
  //    Trước fix: daily_cap return trước → FAB không biết pending → mất lead.
  if (lastRequest) {
    const cooldownMs = config.cooldownMinutes * 60 * 1000;
    const elapsed = Date.now() - lastRequest.requestedAt.getTime();

    if (
      config.forceNoteBeforeNext &&
      lastRequest.noteSubmittedAt === null &&
      lastRequest.releaseReason === null
    ) {
      // Lấy thêm expiresAt + phone từ DB cho FE countdown thu hồi + render text
      const fullLead = await prisma.leadRequest.findUnique({
        where: { id: lastRequest.id },
        select: { expiresAt: true, previousAssigneeId: true, requestedByUserId: true, contact: { select: { phone: true, phoneNormalized: true } } },
      });

      // Lazy reaper 2026-05-28: lead quá expiresAt → auto release ngay,
      // không khoá sale ở pending. Cron daily 2am là backup; on-demand ở đây để FE
      // responsive khi countdown vừa hết — không cần đợi 2am.
      if (fullLead?.expiresAt && fullLead.expiresAt.getTime() <= Date.now()) {
        await prisma.leadRequest.update({
          where: { id: lastRequest.id },
          data: {
            releaseReason: 'auto_return',
            autoReturnedAt: new Date(),
            noteContent: 'Sale không note quá hạn — auto trả về pool (lazy reaper)',
          },
        });
        // Chỉ rollback Contact.assignedUserId nếu CURRENT owner = requester (HIGH-3 pattern)
        // Phase Lead Pool FIFO — set lastPooledAt=now() để lead trả nằm CUỐI nhóm cùng vòng.
        await prisma.contact.updateMany({
          where: { id: lastRequest.contactId, assignedUserId: fullLead.requestedByUserId },
          data: { assignedUserId: fullLead.previousAssigneeId, lastPooledAt: new Date() },
        }).catch(() => { /* silent — contact có thể đã re-assigned */ });
        // Phase v2.D 2026-05-29 — Timeline log "Auto-return lead vì sale không note quá hạn"
        logActivity({
          orgId,
          systemSource: 'lead_pool_reaper',
          action: 'lead_pool_auto_return',
          entityType: 'contact',
          entityId: lastRequest.contactId,
          details: {
            summary: `Lead tự trả về pool vì sale không ghi note quá thời hạn ${fullLead.expiresAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
            leadRequestId: lastRequest.id,
            saleUserId: fullLead.requestedByUserId,
            previousAssigneeId: fullLead.previousAssigneeId,
            expiredAt: fullLead.expiresAt.toISOString(),
            trigger: 'lazy_reaper',
            reason: 'Sale không note quá hạn',
          },
        });
        // Fall through → eligibility OK (không return pending nữa)
      } else {
        return {
          canRequest: false,
          reason: 'unsubmitted_note',
          remainingToday,
          pendingNoteLead: {
            leadRequestId: lastRequest.id,
            contactId: lastRequest.contactId,
            contactName: lastRequest.contact?.crmName ?? lastRequest.contact?.fullName ?? null,
            contactPhone: fullLead?.contact?.phone ?? null,
            requestedAt: lastRequest.requestedAt,
            expiresAt: fullLead?.expiresAt ?? null,
          },
          config,
        };
      }
    }

    if (elapsed < cooldownMs) {
      return {
        canRequest: false,
        reason: 'cooldown',
        remainingToday,
        nextAvailableAt: new Date(lastRequest.requestedAt.getTime() + cooldownMs),
        config,
      };
    }
  }

  // 2. Daily cap — chỉ check sau khi pending check đã pass (lead cuối đã noted/returned)
  if (remainingToday === 0) {
    return { canRequest: false, reason: 'daily_cap', remainingToday: 0, config };
  }

  return { canRequest: true, remainingToday, config };
}

interface PriorityCandidate {
  contactId: string;
  source: LeadSource;
  priorityScore: number;
}

/**
 * Pool A — forgotten: Contact bị bỏ rơi (lastActivity > threshold)
 * Filter:
 *   - cùng org
 *   - status NOT IN excludedStatuses
 *   - consent_status != 'revoked'
 *   - chưa có active LeadRequest
 *   - assignedUserId KHÁC current user (sale không tự xin lại lead của mình)
 *
 * Priority: daysIdle×2 + phone×5 + zalo×10 + noShow×15 + wasHot×30 − attempts×3
 */
async function queryForgottenCandidates(orgId: string, userId: string, config: PoolConfig, limit = 50): Promise<PriorityCandidate[]> {
  const thresholdDate = new Date(Date.now() - config.forgottenThresholdDays * 24 * 60 * 60 * 1000);
  const excludedStatuses = config.excludedStatuses;
  // Phase v2 — filter UID-only lead nếu config requirePhoneInPool=true (default).
  // Lý do: UID là per-viewer của sale cũ, sale mới không dùng được. Cần phone để
  // sale mới gọi findUser qua nick mình tìm UID per-viewer của họ.
  const phoneFilter = config.requirePhoneInPool ? `AND c.phone_normalized IS NOT NULL` : '';

  // Phase Lead Pool v2.A 2026-05-29 — đổi "lãng quên" sang `last_inbound_at` thay vì
  // `last_activity`. Lý do: lastActivity = MAX(inbound, outbound) → sale spam outbound
  // giữ lead vĩnh viễn. Anh chốt: "lãng quên = KH không reply >= threshold ngày".
  // Fallback: KH chưa từng inbound (lastInboundAt IS NULL) → dùng created_at làm anchor
  // (đúng cho KH import từ Excel/Facebook lead chưa từng chat).
  // Phase Lead Pool FIFO 2026-06-15 — BỎ priority_score. Collector chỉ LỌC + sắp đầu vòng tua
  // (pooled_count, last_pooled_at NULLS FIRST, created_at) để giới hạn ứng viên gửi sang
  // queryPoolRobin (nơi gộp 2 nguồn + dedup phone + sắp vòng tua cuối cùng).
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT c.id
    FROM contacts c
    WHERE c.org_id = $1
      AND COALESCE(c.last_inbound_at, c.created_at) < $2::timestamp
      AND c.consent_status != 'revoked'
      -- 2026-06-19: lọc theo status_id (bảng Status thật của org) thay cột status LEGACY.
      AND (c.status_id IS NULL OR c.status_id != ALL($3::text[]))
      AND (c.assigned_user_id IS NULL OR c.assigned_user_id != $4)
      AND c.merged_into IS NULL
      ${phoneFilter}
      AND NOT EXISTS (
        SELECT 1 FROM lead_requests lr
        WHERE lr.contact_id = c.id
          AND lr.note_submitted_at IS NULL
          AND lr.release_reason IS NULL
          AND lr.auto_returned_at IS NULL
      )
      -- Phase v2.B 2026-05-29 — Cooldown sau note. Sale note 1 lead → KH này KHOÁ
      -- pool $6 ngày. Sale gốc vẫn chăm KH bình thường (assignedUserId không reset).
      -- Sale bấm "Trả lại pool" → release_reason set → bypass rule → vào pool ngay.
      AND NOT EXISTS (
        SELECT 1 FROM lead_requests lr2
        WHERE lr2.contact_id = c.id
          AND lr2.note_submitted_at IS NOT NULL
          AND lr2.note_submitted_at > NOW() - ($6 || ' days')::INTERVAL
          AND lr2.release_reason IS NULL
      )
      -- Phase v2.I 2026-05-29 — Self-reclaim lock. Sale gốc đã trả lead này
      -- (manual_return / auto_return) trong $7 ngày qua → KHÔNG được tự xin lại.
      -- Sale KHÁC vẫn xin được ngay (workflow chia lead bình thường).
      AND NOT EXISTS (
        SELECT 1 FROM lead_requests lr3
        WHERE lr3.contact_id = c.id
          AND lr3.requested_by_user_id = $4
          AND lr3.release_reason IN ('manual_return', 'auto_return')
          AND COALESCE(lr3.auto_returned_at, lr3.note_submitted_at) > NOW() - ($7 || ' days')::INTERVAL
      )
    ORDER BY c.pooled_count ASC, c.last_pooled_at ASC NULLS FIRST, c.created_at ASC
    LIMIT $5
    `,
    orgId,
    thresholdDate,
    excludedStatuses,
    userId,
    limit,
    String(config.cooldownAfterNoteDays),
    String(config.selfReclaimLockDays),
  );

  return rows.map((r) => ({ contactId: r.id, source: 'forgotten' as const, priorityScore: 0 }));
}

/**
 * Pool B — customer_list: CustomerListEntry trong list.shareableToPool=true.
 * Convert sang Contact: nếu entry.contactId đã link → dùng Contact đó; nếu chưa →
 * tạo Contact stub (no Zalo, phone từ entry).
 *
 * Priority đơn giản: daysInList + (matchedContact ? 10 : 0).
 */
async function queryCustomerListCandidates(orgId: string, userId: string, limit = 50, cooldownDays = 30, selfReclaimLockDays = 7): Promise<PriorityCandidate[]> {
  // CustomerListEntry uses customer_list_id (not list_id) + phone_e164/phone_local (not phone).
  // status='validated' or 'enriched' OK cho pool.
  // Phase v2.B 2026-05-29 — cooldown sau note: lead đã note < $4 ngày + chưa release → khoá pool.
  // Phase v2.I 2026-05-29 — self-reclaim lock: sale gốc đã trả lead < $5 ngày → KHÔNG xin lại.
  const entries = await prisma.$queryRawUnsafe<Array<{ contact_id: string | null; phone_e164: string | null; phone_local: string | null; name_raw: string | null; days_in_list: number; entry_id: string }>>(
    `
    SELECT cle.id AS entry_id, cle.contact_id, cle.phone_e164, cle.phone_local, cle.name_raw,
      EXTRACT(EPOCH FROM (NOW() - cle.created_at)) / 86400 AS days_in_list
    FROM customer_list_entries cle
    JOIN customer_lists cl ON cl.id = cle.customer_list_id
    WHERE cl.org_id = $1
      AND cl.shareable_to_pool = true
      AND cl.archived_at IS NULL
      AND cle.status IN ('validated', 'enriched')
      AND cle.phone_valid = true
      AND (
        cle.contact_id IS NULL
        OR EXISTS (
          SELECT 1 FROM contacts cc
          WHERE cc.id = cle.contact_id
            AND (cc.assigned_user_id IS NULL OR cc.assigned_user_id != $2)
            AND NOT EXISTS (
              SELECT 1 FROM lead_requests lr
              WHERE lr.contact_id = cc.id
                AND lr.note_submitted_at IS NULL
                AND lr.release_reason IS NULL
                AND lr.auto_returned_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM lead_requests lr2
              WHERE lr2.contact_id = cc.id
                AND lr2.note_submitted_at IS NOT NULL
                AND lr2.note_submitted_at > NOW() - ($4 || ' days')::INTERVAL
                AND lr2.release_reason IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM lead_requests lr3
              WHERE lr3.contact_id = cc.id
                AND lr3.requested_by_user_id = $2
                AND lr3.release_reason IN ('manual_return', 'auto_return')
                AND COALESCE(lr3.auto_returned_at, lr3.note_submitted_at) > NOW() - ($5 || ' days')::INTERVAL
            )
        )
      )
    ORDER BY days_in_list DESC
    LIMIT $3
    `,
    orgId,
    userId,
    limit,
    String(cooldownDays),
    String(selfReclaimLockDays),
  );

  const result: PriorityCandidate[] = [];
  for (const row of entries) {
    let contactId = row.contact_id;
    if (!contactId) {
      // Stub Contact: dùng phone_e164 (84xxx) làm canonical, name_raw nếu có
      const canonicalPhone = (row.phone_e164 ?? row.phone_local ?? '').replace(/[^\d]/g, '');
      if (!canonicalPhone) continue;
      const stub = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          phone: row.phone_local ?? row.phone_e164 ?? canonicalPhone,
          phoneNormalized: canonicalPhone.startsWith('84') ? canonicalPhone : `84${canonicalPhone.replace(/^0/, '')}`,
          fullName: row.name_raw,
          crmName: row.name_raw,
          source: 'customer_list',
          hasZalo: false,
          status: 'new',
          lastActivity: new Date(),
        },
        select: { id: true },
      });
      contactId = stub.id;
      await prisma.customerListEntry.update({
        where: { id: row.entry_id },
        data: { contactId: stub.id },
      });
    }
    result.push({
      contactId,
      source: 'customer_list',
      priorityScore: Math.round(Number(row.days_in_list) + 10),
    });
  }
  return result;
}

/**
 * Phase Lead Pool FIFO 2026-06-15 — sắp ứng viên theo VÒNG TUA, thay pickTopRandom.
 *
 * Input: danh sách candidate đã qua mọi filter (forgotten + customer_list, đã tạo stub
 * Contact cho entry chưa link). Hàm này CHỈ lo SẮP XẾP + DEDUP, không filter lại.
 *
 * Thứ tự: pooled_count ASC, last_pooled_at ASC NULLS FIRST, created_at ASC, id ASC.
 *   → lead chưa chia (pooled_count=0, last_pooled_at=NULL) lên đầu TUYỆT ĐỐI;
 *     tie-break created_at+id chống thứ tự bất định giữa các lead cùng pooled_count
 *     (Review H2: thiếu tie-break → lead import hôm nay chen trước lead 3 tháng trước).
 *
 * Dedup SĐT (Review M4): DISTINCT ON COALESCE(phone_normalized, 'cid:'||id) — cùng phone
 * giữ 1 (con vòng tua nhỏ nhất); lead không phone dedup theo id (mỗi contact 1 lần).
 *
 * Trả về theo đúng thứ tự vòng tua để caller iterate + SELECT FOR UPDATE SKIP LOCKED.
 */
async function queryPoolRobin(
  tx: Tx,
  contactIds: string[],
  limit = 50,
): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const rows = (await tx.$queryRawUnsafe(
    `
    WITH cand AS (
      SELECT c.id AS contact_id, c.phone_normalized, c.pooled_count, c.last_pooled_at, c.created_at
      FROM contacts c
      WHERE c.id = ANY($1::text[])
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(phone_normalized, 'cid:' || contact_id))
        contact_id, pooled_count, last_pooled_at, created_at
      FROM cand
      ORDER BY COALESCE(phone_normalized, 'cid:' || contact_id),
               pooled_count ASC, last_pooled_at ASC NULLS FIRST, created_at ASC, contact_id ASC
    )
    SELECT contact_id FROM deduped
    ORDER BY pooled_count ASC, last_pooled_at ASC NULLS FIRST, created_at ASC, contact_id ASC
    LIMIT $2
    `,
    contactIds, limit,
  )) as Array<{ contact_id: string }>;
  return rows.map((r) => r.contact_id);
}

/**
 * Bản READ-ONLY của queryPoolRobin cho previewPool (admin xem hàng đợi). Dùng prisma
 * thường (không tx/lock) vì chỉ đọc. Cùng thứ tự vòng tua + dedup phone để admin thấy
 * ĐÚNG thứ tự lead sẽ được chia.
 */
async function previewRobinOrder(contactIds: string[], limit = 200): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const rows = await prisma.$queryRawUnsafe<Array<{ contact_id: string }>>(
    `
    WITH cand AS (
      SELECT c.id AS contact_id, c.phone_normalized, c.pooled_count, c.last_pooled_at, c.created_at
      FROM contacts c WHERE c.id = ANY($1::text[])
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(phone_normalized, 'cid:' || contact_id))
        contact_id, pooled_count, last_pooled_at, created_at
      FROM cand
      ORDER BY COALESCE(phone_normalized, 'cid:' || contact_id),
               pooled_count ASC, last_pooled_at ASC NULLS FIRST, created_at ASC, contact_id ASC
    )
    SELECT contact_id FROM deduped
    ORDER BY pooled_count ASC, last_pooled_at ASC NULLS FIRST, created_at ASC, contact_id ASC
    LIMIT $2
    `,
    contactIds, limit,
  );
  return rows.map((r) => r.contact_id);
}

/**
 * Build full payload sale thấy khi nhận lead — hoành tráng theo design.
 */
function formatSourceLabel(source: string): string {
  return ({
    forgotten: 'Khách lãng quên',
    customer_list: 'Tệp khách hàng',
    external_sync: 'Đồng bộ CRM khác',
  } as Record<string, string>)[source] ?? source;
}

interface AutoLookupResult {
  found: boolean;
  uid?: string | null;
  nickUsed?: string | null;
  nickId?: string | null;
  zaloProfile?: {
    uid: string; zaloName: string | null; username: string | null;
    avatar: string | null; gender: number | null; dob: string | number | null;
    bio: string | null; bizPkg: any; accountStatus: number | null; isFriend: boolean | null;
  } | null;
}

// Gender mapping giữa Zalo SDK (number) và Contact.gender (string).
function contactGenderToNumber(g: string | null | undefined): number | null {
  if (g === 'male') return 0;
  if (g === 'female') return 1;
  return null;
}
function numberGenderToContactString(g: number | null | undefined): string | null {
  if (g === 0) return 'male';
  if (g === 1) return 'female';
  return null;
}

async function buildLeadPayload(
  contactId: string,
  saleFullName: string | null = null,
  saleUserId: string | null = null,
  autoLookup: AutoLookupResult | null = null,
  greetingTemplates: GreetingTemplate[] = [],
) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      assignedUser: { select: { id: true, fullName: true, email: true, isActive: true } },
      statusRef: { select: { id: true, name: true, color: true, isTerminal: true } },
      friends: {
        select: {
          id: true,
          zaloAccountId: true,
          zaloUidInNick: true,
          zaloDisplayName: true,
          zaloAvatarUrl: true,
          friendshipStatus: true,
          relationshipKind: true,
          becameFriendAt: true,
          zaloAccount: { select: { id: true, displayName: true, avatarUrl: true, ownerUserId: true } },
        },
      },
      contactNotes: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, body: true, createdAt: true, author: { select: { fullName: true } } },
      },
      appointments: {
        take: 5,
        orderBy: { appointmentDate: 'desc' },
        select: { id: true, appointmentDate: true, status: true, title: true },
      },
    },
  });
  if (!contact) return null;

  // Insights derive — Phase v2.A: "lãng quên" giờ tính theo lastInboundAt (KH reply cuối)
  // thay vì lastActivity (bao gồm cả outbound). Fallback createdAt nếu KH chưa từng inbound.
  const idleAnchor = contact.lastInboundAt ?? contact.createdAt;
  const daysIdle = idleAnchor ? Math.floor((Date.now() - idleAnchor.getTime()) / 86400000) : null;
  const noShowCount = contact.appointments.filter((a) => a.status === 'no_show').length;
  const acceptedFriendCount = contact.friends.filter((f) => f.friendshipStatus === 'accepted').length;

  // 2026-05-28: Per-nick UID semantic — KH "có Zalo từ nick sale current" khi sale đã có
  // Friend row với bất kỳ nick OWN của mình. KHÔNG dùng Contact.hasZalo global (sai khi
  // sale cũ lookup từ nick khác → UID per-viewer không xài được với nick mới).
  const friendsByCurrentSale = saleUserId
    ? contact.friends.filter((f) => f.zaloAccount?.ownerUserId === saleUserId)
    : [];
  const hasZaloFromMyNick = friendsByCurrentSale.length > 0;
  // Gender từ auto-lookup (Zalo SDK trả từ góc nhìn nick sale current → đúng 100%)
  const lookupGender = autoLookup?.zaloProfile?.gender ?? null;

  return {
    contact: {
      id: contact.id,
      fullName: contact.fullName,
      crmName: contact.crmName,
      phone: contact.phone,
      phoneNormalized: contact.phoneNormalized,
      email: contact.email,
      avatarUrl: contact.avatarUrl,
      source: contact.source,
      sourceDate: contact.sourceDate,
      firstContactDate: contact.firstContactDate,
      status: contact.statusRef ?? { name: contact.status, color: null, isTerminal: false },
      tags: contact.tags,
      hasZalo: contact.hasZalo,
      leadScore: contact.leadScore,
      lastActivity: contact.lastActivity,
      lastInboundAt: contact.lastInboundAt,
      lastOutboundAt: contact.lastOutboundAt,
      daysIdle,
      province: contact.province,
      district: contact.district,
      ward: contact.ward,
      addressLine: contact.addressLine,
      notes: contact.notes,
      acceptedNicksCount: contact.acceptedNicksCount,
      totalInbound: contact.totalInbound,
      totalOutbound: contact.totalOutbound,
      totalAppointments: contact.totalAppointments,
    },
    previousAssignee: contact.assignedUser ?? null,
    friends: contact.friends,
    friendsByCurrentSale,
    hasZaloFromMyNick,
    autoLookup, // null nếu sale không có nick connected hoặc lookup fail
    recentNotes: contact.contactNotes,
    recentAppointments: contact.appointments,
    insights: {
      daysIdle,
      noShowCount,
      acceptedFriendCount,
      totalMessages: contact.totalInbound + contact.totalOutbound,
      hadHotMoment: false,
    },
    suggestedOpenings: await buildSuggestedOpenings(
      contactId,
      // Nick đang chăm: ưu tiên nick autoLookup vừa tìm, fallback nick có Friend của sale.
      autoLookup?.nickId ?? friendsByCurrentSale[0]?.zaloAccountId ?? null,
      greetingTemplates,
    ),
  };
}

// Phase Lead Pool FIFO 2026-06-15 — Anh chốt: Lead Pool dùng CHUNG 8 biến với MessageTemplates
// (render-template.ts). Biến: {gender}{name}{name_full}{crm_full}{crm_first}{crm_last}{sale}{sale_full}.
// crm_* = Friend.aliasInNick per-nick (2-way sync Zalo). Render qua renderTemplate(raw, contactId, nickId).
// Default templates dùng khi config.greetingTemplates rỗng. Anh tự thêm qua PATCH /lead-pool/config.
export const DEFAULT_GREETING_TEMPLATES: string[] = [
  'Chào {gender} {crm_first}, em {sale} bên CSKH dự án đây ạ. Em vừa nhận tiếp tài khoản của {gender}, em xem lại thấy {gender} từng quan tâm bên em. Hiện {gender} còn đang tìm hiểu không ạ?',
  'Chào {gender} {crm_first}, em {sale} đây ạ. Lâu rồi bên em chưa cập nhật thông tin mới cho {gender} — bên em vừa có update mới, em gửi {gender} tham khảo nhé?',
  'Chào {gender} {crm_first}, em {sale} bên dự án đây ạ. Dạo này {gender} ổn không? Em có ít ưu đãi mới bên em vừa ra, lúc nào {gender} tiện em chia sẻ ngắn ạ.',
];

// Render câu chào qua engine 8-biến chung (render-template.ts). Cần contactId + nickId
// (nick sale đang chăm) để resolve crm_* per-nick. Nếu thiếu nick → fallback giữ nguyên text.
async function buildSuggestedOpenings(
  contactId: string,
  assignedNickId: string | null,
  templates: GreetingTemplate[] = [],
): Promise<Array<{ text: string; styles: GreetingStyle[] }>> {
  const list: GreetingTemplate[] = templates.length > 0
    ? templates
    : DEFAULT_GREETING_TEMPLATES.map((t) => ({ text: t, styles: [] as GreetingStyle[] }));
  if (!assignedNickId) {
    // Không có nick → chưa thay biến được, trả text thô (giữ styles cho preview).
    return list.map((g) => ({ text: g.text, styles: g.styles }));
  }
  // 2026-06-19 (C): thay biến + DỊCH offset styles theo độ dài giá trị thật (tái dùng máy của Khối).
  const { renderTemplateDetailed, shiftStylesForRender } = await import('../automation/blocks/render-template.js');
  return Promise.all(
    list.map(async (g) => {
      try {
        const { rendered, values } = await renderTemplateDetailed(g.text, contactId, assignedNickId);
        const shifted = g.styles.length ? (shiftStylesForRender(g.text, g.styles, values) ?? []) : [];
        return { text: rendered, styles: shifted as GreetingStyle[] };
      } catch {
        return { text: g.text, styles: g.styles };
      }
    }),
  );
}

/**
 * Auto-lookup Zalo của KH từ nick OWN của sale current. 2026-05-28.
 * Lý do: per-account UID semantic — UID Contact.zaloUid là từ góc nhìn sale CŨ, sale mới
 * không xài được → câu chào không có gender + chat không load. Auto lookup khi nhận lead
 * để mỗi sale có UID per-viewer của mình + gender từ Zalo SDK.
 *
 * Cost: 1 SDK call per nhận lead. Memory: sale 20-30 lead/day → quota OK.
 *
 * Returns null nếu sale không có nick connected hoặc KH không có phone.
 */
async function autoLookupZaloForLead(args: {
  contactId: string; orgId: string; saleUserId: string;
}): Promise<AutoLookupResult | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: args.contactId },
    select: {
      id: true, phone: true, phoneNormalized: true, hasZalo: true, gender: true,
      friends: {
        where: { zaloAccount: { ownerUserId: args.saleUserId } },
        select: { id: true, zaloAccountId: true, zaloUidInNick: true, zaloDisplayName: true, zaloAvatarUrl: true, zaloGlobalId: true },
      },
    },
  });
  if (!contact) return null;
  const phone = contact.phoneNormalized || contact.phone;
  if (!phone) return null;

  // Cache hit: Friend đã có với nick OWN của sale + Contact đã có gender → skip SDK.
  // Nếu thiếu gender → fallthrough SDK lookup (1 lần backfill, sau đó cache permanent).
  if (contact.friends.length > 0 && contact.gender) {
    const existing = contact.friends[0];
    const nick = await prisma.zaloAccount.findUnique({
      where: { id: existing.zaloAccountId },
      select: { displayName: true },
    });
    const cachedGender = contactGenderToNumber(contact.gender);
    return {
      found: true,
      uid: existing.zaloUidInNick,
      nickUsed: nick?.displayName ?? null,
      nickId: existing.zaloAccountId,
      zaloProfile: {
        uid: existing.zaloUidInNick,
        zaloName: existing.zaloDisplayName,
        username: null,
        avatar: existing.zaloAvatarUrl,
        gender: cachedGender,
        dob: null, bio: null, bizPkg: null, accountStatus: null, isFriend: null,
      },
    };
  }

  // Pick first OWN connected nick of sale (2026-06-10: bỏ nick đã xóa mềm)
  const myNick = await prisma.zaloAccount.findFirst({
    where: { ownerUserId: args.saleUserId, orgId: args.orgId, status: 'connected', archivedAt: null },
    orderBy: { lastConnectedAt: 'desc' },
    select: { id: true, displayName: true },
  });
  if (!myNick) return null; // Sale chưa connect nick → fallback hasZalo global

  const { zaloOps } = await import('../../shared/zalo-operations.js');
  let foundUid: string | null = null;
  let extra: any = {};
  try {
    const res = await zaloOps.findUser(myNick.id, phone) as any;
    const u = res || {};
    foundUid = String(u.uid || u.userId || '') || null;
    extra = {
      zaloName: u.zaloName || u.zalo_name || u.displayName || u.display_name || null,
      avatar: u.avatar || null,
      globalId: u.globalId || null,
      username: u.username || null,
      gender: typeof u.gender === 'number' ? u.gender : null,
      dob: u.dob ?? u.birthday ?? null,
      bio: u.status || u.aboutMe || u.bio || null,
      bizPkg: u.bizPkg || u.business || null,
      accountStatus: typeof u.accountStatus === 'number' ? u.accountStatus : (typeof u.status === 'number' ? u.status : null),
      isFriend: typeof u.isFr === 'boolean' ? u.isFr : (typeof u.is_fr === 'boolean' ? u.is_fr : null),
    };
  } catch (err: any) {
    logger.warn(`[auto-lookup] findUser fail nick=${myNick.id}: ${err?.message || err}`);
    return { found: false, uid: null, nickUsed: myNick.displayName, nickId: myNick.id };
  }

  if (!foundUid) {
    // Update Contact: KH không có Zalo (per-viewer của sale này — có thể KH có Zalo nhưng
    // hide phone search; chấp nhận false vì sale current không search ra)
    await prisma.contact.update({
      where: { id: args.contactId },
      data: { zaloLookupAt: new Date(), zaloLookupAttempts: { increment: 1 }, hasZalo: false },
    }).catch(() => {});
    return { found: false, uid: null, nickUsed: myNick.displayName, nickId: myNick.id };
  }

  // Upsert Friend per-nick + update Contact (only avatar nếu chưa có)
  await prisma.friend.upsert({
    where: { zaloAccountId_zaloUidInNick: { zaloAccountId: myNick.id, zaloUidInNick: foundUid } },
    create: {
      orgId: args.orgId, zaloAccountId: myNick.id, contactId: args.contactId,
      zaloUidInNick: foundUid, zaloDisplayName: extra.zaloName,
      zaloAvatarUrl: extra.avatar, friendshipStatus: 'none',
      zaloGlobalId: extra.globalId,
    },
    update: {
      contactId: args.contactId,
      zaloDisplayName: extra.zaloName || undefined,
      zaloAvatarUrl: extra.avatar || undefined,
      zaloGlobalId: extra.globalId || undefined,
    },
  });

  // Persist gender vào Contact (string) để cache hit lần sau vẫn có gender cho câu chào.
  // SDK trả number: 0=Nam → "male", 1=Nữ → "female". Chỉ ghi nếu Contact chưa có gender.
  const genderString = numberGenderToContactString(extra.gender);
  await prisma.contact.update({
    where: { id: args.contactId },
    data: {
      zaloLookupAt: new Date(),
      zaloLookupAttempts: { increment: 1 },
      hasZalo: true,
      avatarUrl: contact.hasZalo ? undefined : (extra.avatar ?? undefined),
      zaloUid: foundUid, // legacy field — keep for backward compat
      gender: !contact.gender && genderString ? genderString : undefined,
    },
  }).catch(() => {});

  return {
    found: true,
    uid: foundUid,
    nickUsed: myNick.displayName,
    nickId: myNick.id,
    zaloProfile: {
      uid: foundUid,
      zaloName: extra.zaloName,
      username: extra.username,
      avatar: extra.avatar,
      gender: extra.gender,
      dob: extra.dob,
      bio: extra.bio,
      bizPkg: extra.bizPkg,
      accountStatus: extra.accountStatus,
      isFriend: extra.isFriend,
    },
  };
}

/**
 * Hash userId → int32 cho pg_advisory_xact_lock (Codex HIGH-1 fix).
 * Postgres advisory lock dùng để serialize requestLead per user.
 */
function userLockKey(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  // Postgres advisory_lock_key thường dùng 2 int32 — em dùng [123, hash] để tránh va chạm
  // với module khác. 123 là namespace 'lead-pool'.
  return hash;
}

/**
 * Main: yêu cầu nhận lead. Race-safe full transaction.
 * Codex review fixes:
 *   - CRITICAL: SELECT FOR UPDATE SKIP LOCKED + partial unique index
 *   - HIGH-1: pg_advisory_xact_lock per user (serialize same-user concurrent POSTs)
 *   - HIGH-3: re-check eligibility inside TX
 *   - LOW: buildLeadPayload null path throws thay vì partial
 */
export async function requestLead(args: { orgId: string; userId: string }) {
  // Pre-check ngoài TX để fail nhanh + trả full meta cho FE (cooldown/daily_cap/etc)
  const preCheck = await checkEligibility(args.orgId, args.userId);
  if (!preCheck.canRequest) {
    const err = new LeadPoolError(429, preCheck.reason ?? 'blocked', eligibilityMessage(preCheck));
    (err as any).meta = preCheck;
    throw err;
  }

  const config = preCheck.config;
  const expiresAt = new Date(Date.now() + config.autoReturnAfterMinutes * 60 * 1000);

  // Full transaction: advisory lock user → re-validate → query candidates → lock contact → create LeadRequest
  const result = await tenantTransaction(async (tx) => {
    // 1. Advisory lock per user — chỉ 1 requestLead/user tại 1 thời điểm
    const lockKey = userLockKey(args.userId);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(123::int, ${lockKey}::int)`);

    // 2. Re-validate eligibility INSIDE TX — calendar day VN + bonus quota
    const startToday = startOfTodayVN();
    const [todayCount, bonusToday] = await Promise.all([
      tx.leadRequest.count({
        where: { requestedByUserId: args.userId, requestedAt: { gte: startToday } },
      }),
      prisma.leadPoolBonusQuota.aggregate({
        where: { userId: args.userId, dateKey: todayDateKeyVN() },
        _sum: { bonusCount: true },
      }).then((r) => r._sum.bonusCount ?? 0),
    ]);
    const effectiveCap = config.maxRequestsPerDay + bonusToday;
    if (todayCount >= effectiveCap) {
      throw new LeadPoolError(429, 'daily_cap', `Hết quota ${effectiveCap} lead hôm nay (đã nhận ${todayCount})`);
    }
    const lastRequest = await tx.leadRequest.findFirst({
      where: { requestedByUserId: args.userId },
      orderBy: { requestedAt: 'desc' },
      select: { requestedAt: true, noteSubmittedAt: true, releaseReason: true },
    });
    if (lastRequest) {
      const cooldownMs = config.cooldownMinutes * 60 * 1000;
      if (Date.now() - lastRequest.requestedAt.getTime() < cooldownMs) {
        throw new LeadPoolError(429, 'cooldown', 'Đang trong cooldown');
      }
      if (
        config.forceNoteBeforeNext &&
        lastRequest.noteSubmittedAt === null &&
        lastRequest.releaseReason === null
      ) {
        throw new LeadPoolError(429, 'unsubmitted_note', 'Cần note lead trước rồi mới xin tiếp');
      }
    }

    // 3. Gather candidates (queryForgotten/CustomerList chạy ngoài tx vì stub Contact tự tạo cần own commit)
    // — em pass `tx` cho query và move stub create vào TX scope
    const [forgottenList, customerListList] = await Promise.all([
      config.enabledSources.includes('forgotten')
        ? queryForgottenCandidates(args.orgId, args.userId, config, 50)
        : Promise.resolve([] as PriorityCandidate[]),
      config.enabledSources.includes('customer_list')
        ? queryCustomerListCandidatesTx(tx, args.orgId, args.userId, config.cooldownAfterNoteDays, config.selfReclaimLockDays, 50, config.sourceListIds)
        : Promise.resolve([] as PriorityCandidate[]),
    ]);

    const all = [...forgottenList, ...customerListList];
    if (all.length === 0) {
      throw new LeadPoolError(404, 'no_leads', 'Hiện không có lead phù hợp trong pool. Quay lại sau ít phút.');
    }

    // Map contactId → source (lead có ở cả 2 nguồn thì ưu tiên 'forgotten' — đến trước).
    const sourceByContact = new Map<string, LeadSource>();
    for (const c of all) {
      if (!sourceByContact.has(c.contactId)) sourceByContact.set(c.contactId, c.source);
    }

    // Phase Lead Pool FIFO 2026-06-15 — SẮP theo vòng tua + dedup phone (queryPoolRobin),
    // KHÔNG còn điểm số + random. Lấy buffer 50 (Review H1: chống SKIP LOCKED bỏ sót khi
    // con đầu hàng đang bị sale khác lock).
    const orderedIds = await queryPoolRobin(tx, [...sourceByContact.keys()], 50);

    // 4. Iterate ĐÚNG THỨ TỰ vòng tua với SELECT FOR UPDATE SKIP LOCKED — pick first row
    // lock được. 2 sale click đồng thời: SKIP LOCKED đẩy người sau sang con kế.
    let lockedContact: { id: string; assignedUserId: string | null; pickedSource: LeadSource } | null = null;

    for (const contactId of orderedIds) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; assigned_user_id: string | null }>>(
        `SELECT id, assigned_user_id FROM contacts WHERE id = $1 FOR UPDATE SKIP LOCKED`,
        contactId,
      );
      if (rows.length === 0) continue; // contact đang bị sale khác lock → thử contact tiếp
      // Đảm bảo contact không có active lead_request khác (race với cron / cùng user mở 2 tab)
      const activeReq = await tx.leadRequest.findFirst({
        where: { contactId, noteSubmittedAt: null, releaseReason: null, autoReturnedAt: null },
        select: { id: true },
      });
      if (activeReq) continue;

      lockedContact = {
        id: rows[0].id,
        assignedUserId: rows[0].assigned_user_id,
        pickedSource: sourceByContact.get(contactId) ?? 'forgotten',
      };
      break;
    }

    if (!lockedContact) {
      throw new LeadPoolError(409, 'all_locked', 'Lead đầu hàng đang được sale khác xem. Thử lại sau vài giây.');
    }

    // 5. Reassign + tăng vòng tua (đẩy lead xuống cuối + đếm số lần) + tạo LeadRequest.
    // increment atomic nhờ row đã FOR UPDATE giữ tới hết TX (Review H4). Partial unique
    // index (contact_id WHERE active) chống mọi race INSERT còn lại.
    const updatedContact = await tx.contact.update({
      where: { id: lockedContact.id },
      data: {
        assignedUserId: args.userId,
        lastPooledAt: new Date(),
        pooledCount: { increment: 1 },
      },
      select: { pooledCount: true, phoneNormalized: true },
    });

    const lr = await tx.leadRequest.create({
      data: {
        id: randomUUID(),
        orgId: args.orgId,
        requestedByUserId: args.userId,
        contactId: lockedContact.id,
        source: lockedContact.pickedSource,
        // priorityScore KHÔNG còn dùng để chọn (FIFO) — lưu số lần chia cho tương thích cột cũ.
        priorityScore: updatedContact.pooledCount,
        expiresAt,
        previousAssigneeId: lockedContact.assignedUserId,
      },
    });

    // Ghi sổ phát lead (view Nhật ký chia + đếm số lần đọc từ đây).
    await tx.leadPoolDistribution.create({
      data: {
        id: randomUUID(),
        orgId: args.orgId,
        contactId: lockedContact.id,
        phoneNormalized: updatedContact.phoneNormalized,
        assignedToUserId: args.userId,
        source: lockedContact.pickedSource,
        round: updatedContact.pooledCount, // SAU increment → lần thứ mấy
        leadRequestId: lr.id,
      },
    });

    return {
      leadRequestId: lr.id,
      contactId: lockedContact.id,
      source: lockedContact.pickedSource,
      priorityScore: updatedContact.pooledCount,
      round: updatedContact.pooledCount,
    };
  }, { timeout: 15000 });

  // Personalize câu gợi ý theo tên sale (memory: vietnameseFirstName)
  const saleUser = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { fullName: true },
  });

  // Auto-trigger Zalo lookup từ nick OWN của sale (2026-05-28)
  // Mỗi sale chỉ 20-30 lead/ngày → quota Zalo SDK OK. Lookup ngay khi nhận lead để
  // có UID per-viewer + gender → câu chào personalize Anh/Chị + chat đúng nick sale.
  const autoLookup = await autoLookupZaloForLead({
    contactId: result.contactId,
    orgId: args.orgId,
    saleUserId: args.userId,
  }).catch((err) => {
    logger.warn(`[auto-lookup] failed for contact=${result.contactId}: ${err?.message || err}`);
    return null;
  });

  const greetingTemplates = Array.isArray(config.greetingTemplates) ? config.greetingTemplates : [];
  const payload = await buildLeadPayload(result.contactId, saleUser?.fullName ?? null, args.userId, autoLookup, greetingTemplates);
  if (!payload) {
    // Contact bị xoá trong khoảnh khắc giữa TX và buildPayload — Codex LOW fix.
    // Rollback assignment để không leak contact bị orphan.
    await prisma.contact.update({
      where: { id: result.contactId },
      data: { assignedUserId: null },
    }).catch(() => { /* contact may not exist */ });
    throw new LeadPoolError(500, 'payload_build_failed', 'Lead vừa lấy bị xoá. Vui lòng thử lại.');
  }

  logger.info(`[lead-pool] user=${args.userId} got lead contact=${result.contactId} source=${result.source} score=${result.priorityScore}`);

  // Phase v2.D 2026-05-29 — Log timeline KH "Sale {tên} đã nhận lead từ pool".
  const sourceLabel = formatSourceLabel(result.source);
  const minutesUntilExpire = Math.round((expiresAt.getTime() - Date.now()) / 60000);
  const expireHint = minutesUntilExpire >= 1440
    ? `${Math.floor(minutesUntilExpire / 1440)} ngày`
    : minutesUntilExpire >= 60
      ? `${Math.floor(minutesUntilExpire / 60)} giờ`
      : `${minutesUntilExpire} phút`;
  logActivity({
    orgId: args.orgId,
    userId: args.userId,
    action: 'lead_pool_assign',
    entityType: 'contact',
    entityId: result.contactId,
    details: {
      summary: `${saleUser?.fullName ?? 'Sale'} đã nhận lead từ Pool · Nguồn: ${sourceLabel} · Lần chia thứ ${result.round} · Hạn note: ${expireHint}`,
      leadRequestId: result.leadRequestId,
      source: result.source,
      sourceLabel,
      round: result.round,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    leadRequestId: result.leadRequestId,
    source: result.source,
    round: result.round,
    expiresAt,
    ...payload,
  };
}

/**
 * Variant của queryCustomerListCandidates dùng tx của caller.
 * Codex HIGH-2 fix: contact stub upsert by (orgId, phoneNormalized) — chống race
 * 2 sale cùng pick entry chưa link → tạo 2 Contact stub trùng phone.
 */
// TS note: Prisma's tx callback type has internal generics that don't match Prisma.TransactionClient
// when prisma-client-js is configured with adapter. Em dùng any an toàn vì callsite chỉ trong TX
// của requestLead.
type Tx = any;
async function queryCustomerListCandidatesTx(
  tx: Tx,
  orgId: string,
  userId: string,
  cooldownDays = 30,
  selfReclaimLockDays = 7,
  limit = 50,
  sourceListIds: string[] = [],
): Promise<PriorityCandidate[]> {
  const entries = (await tx.$queryRawUnsafe(
    `
    SELECT cle.id AS entry_id, cle.contact_id, cle.phone_e164, cle.phone_local, cle.name_raw,
      EXTRACT(EPOCH FROM (NOW() - cle.created_at)) / 86400 AS days_in_list
    FROM customer_list_entries cle
    JOIN customer_lists cl ON cl.id = cle.customer_list_id
    WHERE cl.org_id = $1
      AND cl.shareable_to_pool = true
      AND cl.archived_at IS NULL
      -- 2026-06-19 (D): nếu admin chọn tệp cụ thể ($6 non-empty) → chỉ lấy các tệp đó.
      AND ($6::text[] = '{}'::text[] OR cl.id = ANY($6::text[]))
      AND cle.status IN ('validated', 'enriched')
      AND cle.phone_valid = true
      AND (
        cle.contact_id IS NULL
        OR EXISTS (
          SELECT 1 FROM contacts cc
          WHERE cc.id = cle.contact_id
            AND (cc.assigned_user_id IS NULL OR cc.assigned_user_id != $2)
            AND NOT EXISTS (
              SELECT 1 FROM lead_requests lr
              WHERE lr.contact_id = cc.id
                AND lr.note_submitted_at IS NULL
                AND lr.release_reason IS NULL
                AND lr.auto_returned_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM lead_requests lr2
              WHERE lr2.contact_id = cc.id
                AND lr2.note_submitted_at IS NOT NULL
                AND lr2.note_submitted_at > NOW() - ($4 || ' days')::INTERVAL
                AND lr2.release_reason IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM lead_requests lr3
              WHERE lr3.contact_id = cc.id
                AND lr3.requested_by_user_id = $2
                AND lr3.release_reason IN ('manual_return', 'auto_return')
                AND COALESCE(lr3.auto_returned_at, lr3.note_submitted_at) > NOW() - ($5 || ' days')::INTERVAL
            )
        )
      )
    ORDER BY days_in_list DESC
    LIMIT $3
    `,
    orgId, userId, limit, String(cooldownDays), String(selfReclaimLockDays), sourceListIds,
  )) as Array<{ contact_id: string | null; phone_e164: string | null; phone_local: string | null; name_raw: string | null; days_in_list: number; entry_id: string }>;

  const result: PriorityCandidate[] = [];
  for (const row of entries) {
    let contactId = row.contact_id;
    if (!contactId) {
      const canonicalPhone = (row.phone_e164 ?? row.phone_local ?? '').replace(/[^\d]/g, '');
      if (!canonicalPhone) continue;
      const phoneNormalized = canonicalPhone.startsWith('84')
        ? canonicalPhone
        : `84${canonicalPhone.replace(/^0/, '')}`;

      // Upsert by (orgId, phoneNormalized) — nếu Contact đã tồn tại trùng SĐT → reuse
      const existing = await tx.contact.findFirst({
        where: { orgId, phoneNormalized },
        select: { id: true },
      });
      if (existing) {
        contactId = existing.id;
      } else {
        const stub = await tx.contact.create({
          data: {
            id: randomUUID(),
            orgId,
            phone: row.phone_local ?? row.phone_e164 ?? canonicalPhone,
            phoneNormalized,
            fullName: row.name_raw,
            crmName: row.name_raw,
            source: 'customer_list',
            hasZalo: false,
            status: 'new',
            lastActivity: new Date(),
          },
          select: { id: true },
        });
        contactId = stub.id;
      }
      await tx.customerListEntry.update({
        where: { id: row.entry_id },
        data: { contactId },
      });
    }
    if (!contactId) continue;
    // Phase Lead Pool FIFO — priorityScore KHÔNG dùng nữa (queryPoolRobin sắp vòng tua).
    result.push({ contactId, source: 'customer_list', priorityScore: 0 });
  }
  return result;
}

function eligibilityMessage(e: EligibilityResult): string {
  if (e.reason === 'disabled') return 'Tính năng Nhận Lead đang tắt';
  if (e.reason === 'daily_cap') return `Bạn đã xin đủ ${e.config.maxRequestsPerDay} lead hôm nay. Quay lại ngày mai.`;
  if (e.reason === 'cooldown') {
    const sec = e.nextAvailableAt ? Math.ceil((e.nextAvailableAt.getTime() - Date.now()) / 1000) : 0;
    const min = Math.ceil(sec / 60);
    return `Vui lòng đợi ${min} phút nữa để xin lead tiếp.`;
  }
  if (e.reason === 'unsubmitted_note') {
    return `Bạn cần ghi note cho lead "${e.pendingNoteLead?.contactName || 'trước đó'}" rồi mới xin được lead mới.`;
  }
  return 'Không thể xin lead';
}

/**
 * Submit note cho LeadRequest → unlock xin tiếp.
 * Phase Lead Pool FIFO 2026-06-15 — kèm statusId (tùy chọn): sau Lưu Note sale chọn
 * trạng thái KH (load từ /crm/statuses model Status).
 *
 * Trạng thái ghi PER-NICK (Anh chốt 2026-06-16, ĐẢO quyết định "cấp khách" cũ): mỗi cặp
 * (nick Zalo × KH) có trạng thái RIÊNG ở Friend row — sale dùng nick A chat KH X thì status
 * theo Friend(A×X); nick B vẫn có thể status khác ở Friend(B×X). updateContactAggregate
 * đẩy lên Contact.statusId = status order cao nhất của các Friend (để admin lọc tệp pool).
 * KH không tìm ra Zalo (không có Friend row) → fallback ghi thẳng Contact.statusId.
 *
 *   nickId  = nick sale đang chat KH (FE truyền autoLookup.nickId). null → fallback Contact.
 */
export async function submitNote(args: { userId: string; leadRequestId: string; noteContent: string; statusId?: string | null; nickId?: string | null }) {
  const lr = await prisma.leadRequest.findUnique({
    where: { id: args.leadRequestId },
    include: {
      contact: { select: { id: true, orgId: true } },
    },
  });
  if (!lr) throw new LeadPoolError(404, 'lead_not_found', 'Lead request không tồn tại');
  if (lr.requestedByUserId !== args.userId) {
    throw new LeadPoolError(403, 'not_owner', 'Bạn không phải người nhận lead này');
  }
  if (lr.releaseReason !== null) {
    throw new LeadPoolError(400, 'already_released', 'Lead này đã được trả về pool');
  }

  // FIFO 2026-06-16 — IDEMPOTENT: lead ĐÃ noted bởi chính sale này thì KHÔNG ném already_noted
  // nữa (response lần đầu rớt / double-fire / retry → tránh kẹt màn chọn trạng thái). Vẫn cho
  // áp trạng thái lần này, chỉ BỎ tạo lại Note để khỏi trùng audit-trail.
  const alreadyNoted = lr.noteSubmittedAt !== null;

  const config = await getOrCreateConfig(lr.contact.orgId);
  const trimmed = args.noteContent.trim();
  // Validate độ dài CHỈ khi thực sự ghi note (lần đầu). Idempotent retry bỏ qua check này.
  if (!alreadyNoted && trimmed.length < config.noteMinLength) {
    throw new LeadPoolError(400, 'note_too_short', `Note phải dài ít nhất ${config.noteMinLength} ký tự (hiện ${trimmed.length}).`);
  }

  // Validate statusId thuộc đúng org (chống gán status org khác). Cho phép null = không đổi.
  let validStatusId: string | null = null;
  if (args.statusId) {
    const st = await prisma.status.findFirst({
      where: { id: args.statusId, orgId: lr.contact.orgId },
      select: { id: true },
    });
    if (!st) throw new LeadPoolError(400, 'invalid_status', 'Trạng thái không hợp lệ');
    validStatusId = st.id;
  }

  // Tìm Friend row đúng cặp (nick sale chat × KH) để ghi status per-nick. Không có nick / chưa
  // có Friend (KH không Zalo) → targetFriendId=null → fallback ghi Contact.statusId bên dưới.
  let targetFriendId: string | null = null;
  if (validStatusId && args.nickId) {
    const fr = await prisma.friend.findFirst({
      where: { contactId: lr.contactId, zaloAccountId: args.nickId },
      select: { id: true },
    });
    targetFriendId = fr?.id ?? null;
  }

  const now = new Date();
  await tenantTransaction(async (tx) => {
    if (!alreadyNoted) {
      // Codex MEDIUM-3: conditional update chống double-submit race.
      // count=0 = request khác vừa note xong → coi như đã noted (idempotent), KHÔNG tạo Note trùng.
      const updated = await tx.leadRequest.updateMany({
        where: { id: lr.id, noteSubmittedAt: null, releaseReason: null },
        data: { noteContent: trimmed, noteSubmittedAt: now },
      });
      if (updated.count > 0) {
        await tx.note.create({
          data: {
            id: randomUUID(),
            orgId: lr.contact.orgId,
            contactId: lr.contactId,
            authorUserId: args.userId,
            body: `[Lead Pool] ${trimmed}`,
          },
        });
      }
    }

    // Ghi trạng thái: ưu tiên Friend row của nick (per-nick); fallback Contact.statusId.
    if (validStatusId && targetFriendId) {
      await tx.friend.update({ where: { id: targetFriendId }, data: { statusId: validStatusId } });
      await tx.contact.update({ where: { id: lr.contactId }, data: { lastActivity: now } });
    } else {
      await tx.contact.update({
        where: { id: lr.contactId },
        data: {
          lastActivity: now,
          ...(validStatusId ? { statusId: validStatusId } : {}),
        },
      });
    }
  });

  // SAU commit (đọc dữ liệu đã commit, không phải trong tx): đẩy status Friend → Contact Cha
  // (Contact.statusId = order cao nhất các Friend). Chỉ cần khi ghi vào Friend.
  if (validStatusId && targetFriendId) {
    await updateContactAggregate(lr.contactId);
  }

  return { ok: true, statusId: validStatusId, target: targetFriendId ? 'friend' : 'contact' };
}

/**
 * Sale trả lại lead về pool. Codex HIGH-3 fix: chỉ rollback Contact.assignedUserId
 * nếu CURRENT owner = requestedByUserId (sale chưa được reassign sau khi nhận).
 * Nếu đã reassign khác → không ghi đè (admin/sale khác có thể đã sửa).
 */
export async function returnLead(args: { userId: string; leadRequestId: string; reason?: string }) {
  const lr = await prisma.leadRequest.findUnique({
    where: { id: args.leadRequestId },
    include: { contact: { select: { orgId: true } } },
  });
  if (!lr) throw new LeadPoolError(404, 'lead_not_found', 'Lead không tồn tại');
  if (lr.requestedByUserId !== args.userId) throw new LeadPoolError(403, 'not_owner', 'Không phải lead của bạn');
  if (lr.releaseReason !== null) throw new LeadPoolError(400, 'already_released', 'Đã trả lại rồi');

  // Phase v2.D 2026-05-29 — Bắt buộc nhập lý do tối thiểu 10 ký tự (anh chốt A).
  // Chống sale spam-return mà không phân tích KH. Lý do được audit cho retro hằng tuần.
  const reasonText = (args.reason ?? '').trim();
  const MIN_REASON_LEN = 10;
  if (reasonText.length < MIN_REASON_LEN) {
    throw new LeadPoolError(400, 'reason_too_short',
      `Lý do trả lại pool phải tối thiểu ${MIN_REASON_LEN} ký tự (hiện ${reasonText.length}). Vd: "KH không phải BĐS, sai SĐT", "Đã có sale khác chăm".`);
  }

  await tenantTransaction(async (tx) => {
    // Conditional update — chỉ rollback nếu sale vẫn là current owner
    // Phase Lead Pool FIFO — set lastPooledAt=now() để lead trả nằm CUỐI nhóm cùng vòng.
    await tx.contact.updateMany({
      where: { id: lr.contactId, assignedUserId: args.userId },
      data: { assignedUserId: lr.previousAssigneeId, lastPooledAt: new Date() },
    });
    await tx.leadRequest.update({
      where: { id: lr.id },
      data: {
        releaseReason: 'manual_return',
        noteSubmittedAt: lr.noteSubmittedAt ?? new Date(),
        noteContent: lr.noteContent ?? reasonText,
      },
    });
    // Note "Sale trả lại pool: <lý do>" vào panel Ghi chú KH.
    // Nếu lr.noteContent đã có (sale note xong rồi mới trả) → KHÔNG ghi đè, append note mới
    // riêng để timeline hiển thị 2 dòng (note chăm + lý do trả).
    await tx.note.create({
      data: {
        id: randomUUID(),
        orgId: lr.contact.orgId,
        contactId: lr.contactId,
        authorUserId: args.userId,
        body: `[Lead Pool] Trả lại pool: ${reasonText}`,
      },
    });
  });

  // Phase v2.D 2026-05-29 — Timeline log "Sale {tên} đã trả lại lead về pool".
  const sale = await prisma.user.findUnique({ where: { id: args.userId }, select: { fullName: true } });
  logActivity({
    orgId: lr.contact.orgId,
    userId: args.userId,
    action: 'lead_pool_manual_return',
    entityType: 'contact',
    entityId: lr.contactId,
    details: {
      summary: `${sale?.fullName ?? 'Sale'} đã trả lại lead về pool: ${reasonText}`,
      leadRequestId: lr.id,
      reason: reasonText,
      previousAssigneeId: lr.previousAssigneeId,
    },
  });

  return { ok: true };
}

/**
 * Lịch sử lead của user.
 */
export async function getMyHistory(args: { userId: string; limit?: number }) {
  const limit = Math.min(args.limit ?? 30, 100);
  return prisma.leadRequest.findMany({
    where: { requestedByUserId: args.userId },
    orderBy: { requestedAt: 'desc' },
    take: limit,
    include: {
      contact: {
        select: { id: true, fullName: true, crmName: true, phone: true, status: true },
      },
    },
  });
}

/**
 * Phase Lead Pool FIFO 2026-06-15 — Nhật ký chia (admin). Mỗi dòng = 1 lần phát lead.
 * Nhóm theo ngày VN. Join sale + KH + trạng thái KH (Contact.statusRef) + ghi chú gần nhất
 * (LeadRequest.noteContent). round = lead này đã chia lần thứ mấy.
 */
const VN_DAY_LABELS = (dateKey: string): string => {
  const todayKey = todayDateKeyVN();
  const d = new Date(todayKey + 'T00:00:00+07:00');
  const yKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(d.getTime() - 86400000).getUTCDate()).padStart(2, '0')}`;
  if (dateKey === todayKey) return 'Hôm nay';
  const yesterday = new Date(new Date(todayKey + 'T00:00:00+07:00').getTime() - 86400000);
  const yesterdayKey = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
  if (dateKey === yesterdayKey) return 'Hôm qua';
  void yKey;
  // dd/mm/yyyy
  const [yy, mm, dd] = dateKey.split('-');
  return `${dd}/${mm}/${yy}`;
};

export async function getDistributionLog(args: {
  orgId: string; date?: string; userId?: string; limit?: number;
}) {
  const limit = Math.min(args.limit ?? 300, 1000);
  const where: any = { orgId: args.orgId };
  if (args.userId) where.assignedToUserId = args.userId;
  if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    // Range VN-day → UTC (00:00 VN = 17:00 UTC hôm trước). Sargable trên distributed_at.
    const start = new Date(args.date + 'T00:00:00+07:00');
    const end = new Date(start.getTime() + 86400000);
    where.distributedAt = { gte: start, lt: end };
  }

  const rows = await prisma.leadPoolDistribution.findMany({
    where,
    orderBy: { distributedAt: 'desc' },
    take: limit,
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      contact: {
        select: {
          id: true, fullName: true, crmName: true, phone: true, avatarUrl: true,
          statusRef: { select: { id: true, name: true, color: true } },
        },
      },
    },
  });

  // Lấy ghi chú gần nhất theo leadRequestId (note sale viết lúc Lưu Note).
  const lrIds = rows.map((r) => r.leadRequestId).filter((x): x is string => !!x);
  const lrNotes = lrIds.length
    ? await prisma.leadRequest.findMany({
        where: { id: { in: lrIds } },
        select: { id: true, noteContent: true },
      })
    : [];
  const noteByLr = new Map(lrNotes.map((n) => [n.id, n.noteContent]));

  // Nhóm theo ngày VN.
  const groupsMap = new Map<string, any[]>();
  for (const r of rows) {
    const vn = new Date(r.distributedAt.getTime() + 7 * 60 * 60 * 1000);
    const dateKey = `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
    if (!groupsMap.has(dateKey)) groupsMap.set(dateKey, []);
    groupsMap.get(dateKey)!.push({
      id: r.id,
      distributedAt: r.distributedAt,
      round: r.round,
      source: r.source,
      sourceLabel: formatSourceLabel(r.source),
      phone: r.contact?.phone ?? r.phoneNormalized ?? null,
      contactName: r.contact?.crmName ?? r.contact?.fullName ?? null,
      contactAvatar: r.contact?.avatarUrl ?? null,
      saleName: r.assignedTo?.fullName ?? null,
      saleAvatar: r.assignedTo?.avatarUrl ?? null,
      status: r.contact?.statusRef
        ? { name: r.contact.statusRef.name, color: r.contact.statusRef.color }
        : null,
      note: r.leadRequestId ? (noteByLr.get(r.leadRequestId) ?? null) : null,
    });
  }

  const groups = [...groupsMap.entries()].map(([dateKey, items]) => ({
    dateKey,
    dateLabel: VN_DAY_LABELS(dateKey),
    count: items.length,
    items,
  }));

  return { groups, totalToday: groupsMap.get(todayDateKeyVN())?.length ?? 0 };
}

/**
 * Cron auto-return: LeadRequest quá expiresAt mà chưa note + chưa release.
 * Chạy 2am daily.
 */
export async function autoReturnExpiredLeads() {
  const now = new Date();
  const expired = await prisma.leadRequest.findMany({
    where: {
      noteSubmittedAt: null,
      releaseReason: null,
      autoReturnedAt: null,
      expiresAt: { lt: now },
    },
    select: {
      id: true, contactId: true, previousAssigneeId: true, requestedByUserId: true,
      expiresAt: true, contact: { select: { orgId: true } },
    },
  });

  // Codex HIGH-3 fix: chỉ rollback Contact.assignedUserId nếu CURRENT owner =
  // requestedByUserId. Nếu sale đã được reassign manually (admin/sale khác) trong 7
  // ngày chờ → không ghi đè.
  for (const lr of expired) {
    await tenantTransaction(async (tx) => {
      // Phase Lead Pool FIFO — set lastPooledAt=now() để lead auto-return nằm CUỐI nhóm cùng vòng.
      await tx.contact.updateMany({
        where: { id: lr.contactId, assignedUserId: lr.requestedByUserId },
        data: { assignedUserId: lr.previousAssigneeId, lastPooledAt: new Date() },
      });
      await tx.leadRequest.update({
        where: { id: lr.id },
        data: {
          releaseReason: 'auto_return',
          autoReturnedAt: now,
          noteContent: 'Sale không note quá hạn — auto trả về pool',
        },
      });
    });
    // Phase v2.D 2026-05-29 — Timeline log per contact
    logActivity({
      orgId: lr.contact.orgId,
      systemSource: 'lead_pool_cron',
      action: 'lead_pool_auto_return',
      entityType: 'contact',
      entityId: lr.contactId,
      details: {
        summary: `Lead tự trả về pool (cron 2h sáng) vì sale không ghi note quá thời hạn ${lr.expiresAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
        leadRequestId: lr.id,
        saleUserId: lr.requestedByUserId,
        previousAssigneeId: lr.previousAssigneeId,
        expiredAt: lr.expiresAt.toISOString(),
        trigger: 'cron_daily_2am',
        reason: 'Sale không note quá hạn',
      },
    });
  }

  if (expired.length > 0) {
    logger.info(`[lead-pool-cron] auto-returned ${expired.length} expired leads`);
  }
  return expired.length;
}

/**
 * Sale dùng nick OWN gọi findUser(phone) tìm Zalo của lead chưa rõ.
 * Nếu thấy UID → update Contact.zaloUid + hasZalo=true → sale tiếp tục gửi friend request.
 * Nếu không → cập nhật hasZalo=false để skip cho lần sau.
 */
export async function findZaloForLead(args: { userId: string; orgId: string; leadRequestId: string; zaloAccountId?: string }) {
  const lr = await prisma.leadRequest.findUnique({
    where: { id: args.leadRequestId },
    include: { contact: { select: { id: true, orgId: true, phone: true, phoneNormalized: true, hasZalo: true, zaloLookupAttempts: true } } },
  });
  if (!lr) throw new LeadPoolError(404, 'lead_not_found', 'Lead không tồn tại');
  if (lr.requestedByUserId !== args.userId) {
    throw new LeadPoolError(403, 'not_owner', 'Không phải lead của bạn');
  }
  const phone = lr.contact.phoneNormalized || lr.contact.phone;
  if (!phone) {
    throw new LeadPoolError(400, 'no_phone', 'Lead này không có SĐT — không tìm được Zalo. Gọi điện trước hoặc bổ sung SĐT.');
  }
  // 2026-05-28: KHÔNG throw khi hasZalo=true vì UID per-viewer của sale khác không xài
  // được. Cho phép sale current re-lookup từ nick mình → tạo Friend per-nick mới.
  // Check Friend với (nick được chọn, contact) — nếu rồi thì return existing (no SDK call).

  // Nick để lookup: nếu sale chọn (zaloAccountId) → dùng nick đó. Else fallback first-own.
  let myNick: { id: string; displayName: string | null } | null = null;
  if (args.zaloAccountId) {
    myNick = await prisma.zaloAccount.findFirst({
      where: { id: args.zaloAccountId, orgId: args.orgId, status: 'connected' },
      select: { id: true, displayName: true },
    });
    if (!myNick) throw new LeadPoolError(400, 'nick_not_available', 'Nick Zalo đã chọn không tồn tại hoặc offline.');
  } else {
    myNick = await prisma.zaloAccount.findFirst({
      where: { ownerUserId: args.userId, orgId: args.orgId, status: 'connected' },
      orderBy: { lastConnectedAt: 'desc' },
      select: { id: true, displayName: true },
    });
  }
  if (!myNick) {
    throw new LeadPoolError(400, 'no_own_nick', 'Bạn cần kết nối ít nhất 1 nick Zalo trong "Quản lý nick" để tìm Zalo của KH.');
  }

  const { zaloOps } = await import('../../shared/zalo-operations.js');
  let foundUid: string | null = null;
  let extra: {
    zaloName?: string | null; avatar?: string | null; globalId?: string | null;
    username?: string | null; gender?: number | null; dob?: string | number | null;
    bio?: string | null; bizPkg?: any; cover?: string | null;
    accountStatus?: number | null; isFriend?: boolean | null;
  } = {};
  try {
    const res = await zaloOps.findUser(myNick.id, phone) as any;
    const u = res || {};
    foundUid = String(u.uid || u.userId || '') || null;
    extra = {
      zaloName: u.zaloName || u.zalo_name || u.displayName || u.display_name || null,
      avatar: u.avatar || null,
      globalId: u.globalId || null,
      username: u.username || null,
      gender: typeof u.gender === 'number' ? u.gender : null,
      dob: u.dob ?? u.birthday ?? null,
      bio: u.status || u.aboutMe || u.bio || null,
      bizPkg: u.bizPkg || u.business || null,
      cover: u.cover || u.coverUrl || null,
      accountStatus: typeof u.accountStatus === 'number' ? u.accountStatus : (typeof u.status === 'number' ? u.status : null),
      isFriend: typeof u.isFr === 'boolean' ? u.isFr : (typeof u.is_fr === 'boolean' ? u.is_fr : null),
    };
  } catch (err: any) {
    logger.warn(`[lead-pool find-zalo] findUser fail: ${err?.message || err}`);
  }

  // Bump zaloLookupAttempts để tránh thử lại liên tục.
  // BUG FIX 2026-05-27: zalo_global_id UNIQUE per org → nếu Zalo trả globalId đã tồn tại
  // ở Contact KHÁC trong CRM → Prisma reject. Check trước khi update.
  let duplicateContact: { id: string; fullName: string | null; assignedUser: { fullName: string | null } | null } | null = null;
  if (extra.globalId) {
    const existing = await prisma.contact.findFirst({
      where: {
        orgId: args.orgId,
        zaloGlobalId: extra.globalId,
        id: { not: lr.contact.id },
      },
      select: { id: true, fullName: true, assignedUser: { select: { fullName: true } } },
    });
    if (existing) duplicateContact = existing;
  }

  // Update Contact: nếu có duplicate globalId → KHÔNG update field đó (giữ nguyên).
  // Chỉ update zaloUid (per-viewer của nick sale này — không UNIQUE) + hasZalo + avatar.
  await prisma.contact.update({
    where: { id: lr.contact.id },
    data: {
      zaloLookupAt: new Date(),
      zaloLookupAttempts: lr.contact.zaloLookupAttempts + 1,
      hasZalo: foundUid ? true : false,
      zaloUid: foundUid ?? undefined,
      // Chỉ set globalId nếu KHÔNG trùng — tránh unique constraint crash
      zaloGlobalId: duplicateContact ? undefined : (extra.globalId ?? undefined),
      avatarUrl: extra.avatar ?? undefined,
    },
  });

  // Phase Lead Pool FIFO 2026-06-15 — TẠO Friend row per-nick [nick sale × KH] ngay khi tìm
  // thấy Zalo qua nút "Tìm bằng nick" (Anh chốt: sale khỏi mở hội thoại trống mới có liên kết).
  // Trùng logic autoLookupZaloForLead ca 1; ca 2 (tìm thủ công) trước đây THIẾU bước này.
  if (foundUid) {
    await prisma.friend.upsert({
      where: { zaloAccountId_zaloUidInNick: { zaloAccountId: myNick.id, zaloUidInNick: foundUid } },
      create: {
        orgId: args.orgId, zaloAccountId: myNick.id, contactId: lr.contact.id,
        zaloUidInNick: foundUid, zaloDisplayName: extra.zaloName,
        zaloAvatarUrl: extra.avatar, friendshipStatus: 'none',
        zaloGlobalId: duplicateContact ? undefined : (extra.globalId ?? undefined),
      },
      update: {
        contactId: lr.contact.id,
        zaloDisplayName: extra.zaloName || undefined,
        zaloAvatarUrl: extra.avatar || undefined,
        zaloGlobalId: duplicateContact ? undefined : (extra.globalId || undefined),
      },
    }).catch((err) => {
      logger.warn(`[lead-pool find-zalo] upsert Friend fail nick=${myNick.id} uid=${foundUid}: ${err?.message || err}`);
    });
  }

  // Phase v2.D 2026-05-29 — Log Zalo lookup vào timeline KH (manual via Tìm Zalo button)
  const lookupSummary = foundUid
    ? `Tìm thấy Zalo của KH qua nick "${myNick.displayName}"${duplicateContact ? ` (cảnh báo: trùng với KH "${duplicateContact.fullName}")` : ''}`
    : `Không tìm thấy Zalo của KH qua nick "${myNick.displayName}"`;
  logActivity({
    orgId: args.orgId,
    userId: args.userId,
    action: 'lead_pool_zalo_lookup',
    entityType: 'contact',
    entityId: lr.contactId,
    details: {
      summary: lookupSummary,
      trigger: 'manual_find_zalo',
      nickId: myNick.id,
      nickName: myNick.displayName,
      found: Boolean(foundUid),
      hasGlobalId: Boolean(extra.globalId),
      duplicateContactId: duplicateContact?.id ?? null,
    },
  });

  return {
    found: Boolean(foundUid),
    uid: foundUid,
    zaloName: extra.zaloName,
    avatar: extra.avatar,
    nickUsed: myNick.displayName,
    suggestSendRequest: Boolean(foundUid),
    // Pass full Zalo profile để FE render card chi tiết (giống popup info group member)
    zaloProfile: foundUid ? {
      uid: foundUid,
      zaloName: extra.zaloName,
      username: extra.username,
      globalId: extra.globalId,
      avatar: extra.avatar,
      cover: extra.cover,
      gender: extra.gender,
      dob: extra.dob,
      bio: extra.bio,
      bizPkg: extra.bizPkg,
      accountStatus: extra.accountStatus,
      isFriend: extra.isFriend,
    } : null,
    duplicateWarning: duplicateContact
      ? `Cảnh báo: SĐT này khớp Zalo với KH "${duplicateContact.fullName || 'không tên'}" đã có trong CRM (sale chăm: ${duplicateContact.assignedUser?.fullName || 'chưa gán'}). Có thể là cùng 1 người dưới 2 row riêng — cân nhắc trả lead về pool.`
      : null,
  };
}

/**
 * 4 KPI thống kê hôm nay — admin Queue Lead page.
 * Phase v2.C 2026-05-29.
 */
export async function getQueueTodayStats(args: { orgId: string }) {
  const config = await getOrCreateConfig(args.orgId);
  const startToday = startOfTodayVN();
  const cooldownCutoff = new Date(Date.now() - config.cooldownAfterNoteDays * 24 * 60 * 60 * 1000);

  const [
    poolSize,        // available leads (after cooldown filter)
    assignedToday,   // pending lead requested today
    assignedActive,  // tổng pending lead (any day, đang chờ note)
    cooldownCount,   // lead khoá pool
    returnedAutoToday,
    returnedManualToday,
    requestedToday,
    notedToday,
  ] = await Promise.all([
    // Phase v2.H 2026-05-29 — count = forgotten contacts + customer_list entries
    // (cả unlinked). Trước đây chỉ count Contact → bỏ qua 521 CustomerListEntry chưa
    // link → pool size lệch với realiy (anh báo 4537 contact giữ vs 700+ CustomerList).
    countTotalPoolAvailable(args.orgId, null, config),

    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, noteSubmittedAt: null, releaseReason: null, autoReturnedAt: null, requestedAt: { gte: startToday } },
    }),
    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, noteSubmittedAt: null, releaseReason: null, autoReturnedAt: null },
    }),
    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, noteSubmittedAt: { not: null, gt: cooldownCutoff }, releaseReason: null },
    }),
    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, releaseReason: 'auto_return', autoReturnedAt: { gte: startToday } },
    }),
    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, releaseReason: 'manual_return', noteSubmittedAt: { gte: startToday } },
    }),
    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, requestedAt: { gte: startToday } },
    }),
    prisma.leadRequest.count({
      where: { contact: { orgId: args.orgId }, noteSubmittedAt: { gte: startToday }, releaseReason: null },
    }),
  ]);

  const notedPct = requestedToday > 0 ? Math.round((notedToday / requestedToday) * 100) : 0;
  return {
    poolSize,
    assigned: { today: assignedToday, totalActive: assignedActive },
    cooldown: cooldownCount,
    returnedToday: { auto: returnedAutoToday, manual: returnedManualToday, total: returnedAutoToday + returnedManualToday },
    today: { requested: requestedToday, noted: notedToday, pct: notedPct },
    config: { cooldownAfterNoteDays: config.cooldownAfterNoteDays, forgottenThresholdDays: config.forgottenThresholdDays },
  };
}

/**
 * Stats theo role cho tooltip:
 *   - sale (member): quota còn lại + lịch sử lead hôm nay của chính sale + size pool
 *   - leader (deptRole='leader'/'deputy'): + summary leads team mình quản lý
 *   - admin/owner: + nick rảnh trong org + sale nào nhận nhiều nhất
 */
export async function getLeadPoolStats(args: { orgId: string; userId: string; role: string }) {
  // Calendar day VN (Asia/Ho_Chi_Minh 00:00 reset). Trước 2026-05-28 dùng rolling 24h.
  const since24h = startOfTodayVN();
  const config = await getOrCreateConfig(args.orgId);

  // ── My stats (mọi role đều có) ──
  const myToday = await prisma.leadRequest.findMany({
    where: { requestedByUserId: args.userId, requestedAt: { gte: since24h } },
    orderBy: { requestedAt: 'desc' },
    select: {
      id: true,
      requestedAt: true,
      noteSubmittedAt: true,
      releaseReason: true,
      priorityScore: true,
      source: true,
      contact: { select: { fullName: true, crmName: true, phone: true } },
    },
  });
  // Phase v2.J 2026-05-29 — bug: tooltip cũ tính remainingToday = maxPerDay - todayCount
  // → KHÔNG include bonus admin grant. Sale nhận 13/10 (admin +3) hiển thị "0/10" sai.
  const bonusToday = await getBonusQuotaTodayVN(args.userId);
  const effectiveCap = config.maxRequestsPerDay + bonusToday;
  const myStats = {
    requestedToday: myToday.length,
    remainingToday: Math.max(0, effectiveCap - myToday.length),
    bonusToday,
    effectiveCap,
    noted: myToday.filter((r) => r.noteSubmittedAt !== null).length,
    pending: myToday.filter((r) => r.noteSubmittedAt === null && r.releaseReason === null).length,
    returned: myToday.filter((r) => r.releaseReason !== null).length,
    // Phase v2.F 2026-05-29 — anh chốt phân biệt 4 trạng thái cho FAB tooltip:
    //   'caring'        : sale note xong + chưa trả → đang chăm tích cực (cooldown active)
    //   'manual_return' : sale chủ động trả pool sau khi note
    //   'auto_return'   : auto-return quá hạn (cron 2am hoặc lazy reaper)
    //   'pending'       : chưa note + chưa trả → đang chờ sale ghi note
    history: myToday.slice(0, 10).map((r) => {
      let status: 'caring' | 'manual_return' | 'auto_return' | 'pending';
      if (r.releaseReason === 'manual_return') status = 'manual_return';
      else if (r.releaseReason === 'auto_return') status = 'auto_return';
      else if (r.noteSubmittedAt !== null) status = 'caring';
      else status = 'pending';
      return {
        id: r.id,
        contactName: r.contact?.crmName || r.contact?.fullName || r.contact?.phone || 'KH',
        requestedAt: r.requestedAt,
        noted: r.noteSubmittedAt !== null,
        returned: r.releaseReason !== null,
        status,
        source: r.source,
      };
    }),
  };

  // Phase v2.H 2026-05-29 — count = forgotten + customer_list (cả unlinked).
  // Truyền args.userId để loại lead anh đang giữ (FAB view sale-specific).
  const poolAvailable = await countTotalPoolAvailable(args.orgId, args.userId, config);

  const baseResult: any = {
    role: args.role,
    config: { maxPerDay: config.maxRequestsPerDay, cooldownMinutes: config.cooldownMinutes },
    my: myStats,
    poolAvailable,
  };

  // ── LEADER ── (deptRole='leader'|'deputy') — summary team
  const membership = await prisma.departmentMember.findFirst({
    where: { userId: args.userId, deptRole: { in: ['leader', 'deputy'] } },
    select: { departmentId: true, department: { select: { id: true, name: true, path: true } } },
  });

  if (membership) {
    // Cascade: lấy mọi user trong dept tree dưới mình
    const subDepts = await prisma.department.findMany({
      where: { orgId: args.orgId, path: { startsWith: membership.department.path } },
      select: { id: true },
    });
    const subDeptIds = subDepts.map((d) => d.id);
    const teamMembers = await prisma.departmentMember.findMany({
      where: { departmentId: { in: subDeptIds }, userId: { not: args.userId } },
      select: { userId: true, user: { select: { id: true, fullName: true, email: true } } },
    });

    const teamUserIds = teamMembers.map((m) => m.userId);
    if (teamUserIds.length > 0) {
      const teamLeads = await prisma.leadRequest.groupBy({
        by: ['requestedByUserId'],
        where: { requestedByUserId: { in: teamUserIds }, requestedAt: { gte: since24h } },
        _count: true,
      });
      const notedCounts = await prisma.leadRequest.groupBy({
        by: ['requestedByUserId'],
        where: {
          requestedByUserId: { in: teamUserIds },
          requestedAt: { gte: since24h },
          noteSubmittedAt: { not: null },
        },
        _count: true,
      });
      const notedMap = Object.fromEntries(notedCounts.map((g) => [g.requestedByUserId, g._count]));

      baseResult.team = {
        departmentName: membership.department.name,
        memberCount: teamMembers.length,
        totalLeadsToday: teamLeads.reduce((sum, g) => sum + g._count, 0),
        members: teamMembers.map((m) => {
          const requested = teamLeads.find((g) => g.requestedByUserId === m.userId)?._count ?? 0;
          const noted = notedMap[m.userId] ?? 0;
          return {
            userId: m.userId,
            fullName: m.user.fullName,
            email: m.user.email,
            requestedToday: requested,
            notedToday: noted,
            pendingNote: requested - noted,
          };
        }).sort((a, b) => b.requestedToday - a.requestedToday),
      };
    }
  }

  // ── ADMIN/OWNER — org-wide ──
  if (args.role === 'admin' || args.role === 'owner') {
    // Org-wide: tất cả sale hôm nay
    const allLeadsToday = await prisma.leadRequest.groupBy({
      by: ['requestedByUserId'],
      where: { orgId: args.orgId, requestedAt: { gte: since24h } },
      _count: true,
      orderBy: { _count: { requestedByUserId: 'desc' } },
      take: 5,
    });
    const topUserIds = allLeadsToday.map((g) => g.requestedByUserId);
    const topUsers = topUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: topUserIds } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const userMap = Object.fromEntries(topUsers.map((u) => [u.id, u]));

    // Nick rảnh = nick OWN connected, không gửi tin trong 1h gần đây
    const idleNicks = await prisma.zaloAccount.findMany({
      where: {
        orgId: args.orgId,
        status: 'connected',
        OR: [
          { lastMessageSentAt: null },
          { lastMessageSentAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
        ],
      },
      select: { id: true, displayName: true, ownerUserId: true, owner: { select: { fullName: true } } },
      take: 20,
    });

    const totalToday = await prisma.leadRequest.count({
      where: { orgId: args.orgId, requestedAt: { gte: since24h } },
    });

    baseResult.org = {
      totalLeadsToday: totalToday,
      idleNickCount: idleNicks.length,
      idleNicks: idleNicks.slice(0, 8).map((n) => ({
        id: n.id,
        displayName: n.displayName,
        ownerName: n.owner?.fullName,
      })),
      topSales: allLeadsToday.map((g) => ({
        userId: g.requestedByUserId,
        fullName: userMap[g.requestedByUserId]?.fullName || 'Unknown',
        email: userMap[g.requestedByUserId]?.email,
        requestedToday: g._count,
      })),
    };
  }

  return baseResult;
}

/**
 * Preview top N candidate đang trong pool — admin/owner xem queue robin.
 * KHÔNG lock, KHÔNG mutate. Pure read.
 * Phase v2.C 2026-05-29 — filter tabs: 'available' | 'assigned' | 'cooldown' | 'returned_today'
 */
export type PreviewFilter = 'available' | 'assigned' | 'cooldown' | 'returned_today';

export async function previewPool(args: {
  orgId: string;
  userId: string;
  limit?: number;
  filter?: PreviewFilter;
}) {
  const config = await getOrCreateConfig(args.orgId);
  const limit = Math.min(args.limit ?? 200, 500);
  const filter: PreviewFilter = args.filter ?? 'available';

  // 4 tab — chạy 4 query khác nhau
  if (filter === 'assigned') return await previewAssignedToday(args.orgId, config, limit);
  if (filter === 'cooldown') return await previewCooldown(args.orgId, config, limit);
  if (filter === 'returned_today') return await previewReturnedToday(args.orgId, config, limit);

  // Default: available — top N candidate sẵn sàng chia
  const [forgottenList, customerListList] = await Promise.all([
    config.enabledSources.includes('forgotten')
      ? queryForgottenCandidates(args.orgId, args.userId, config, limit)
      : Promise.resolve([] as PriorityCandidate[]),
    config.enabledSources.includes('customer_list')
      ? queryCustomerListPreview(args.orgId, args.userId, limit, config.cooldownAfterNoteDays, config.selfReclaimLockDays)
      : Promise.resolve([] as PriorityCandidate[]),
  ]);

  // Phase Lead Pool FIFO 2026-06-15 — sắp preview theo VÒNG TUA (giống requestLead) + dedup phone.
  const sourceByContact = new Map<string, LeadSource>();
  for (const c of [...forgottenList, ...customerListList]) {
    if (!sourceByContact.has(c.contactId)) sourceByContact.set(c.contactId, c.source);
  }
  const orderedIds = await previewRobinOrder([...sourceByContact.keys()], limit);
  const merged: PriorityCandidate[] = orderedIds.map((id) => ({
    contactId: id, source: sourceByContact.get(id) ?? 'forgotten', priorityScore: 0,
  }));
  const items = await enrichItems(merged, 'available');

  return {
    items, total: items.length, filter: 'available' as const,
    config: {
      forgottenThresholdDays: config.forgottenThresholdDays,
      autoReturnAfterMinutes: config.autoReturnAfterMinutes,
      requirePhoneInPool: config.requirePhoneInPool,
      cooldownAfterNoteDays: config.cooldownAfterNoteDays,
    },
  };
}

/**
 * Tab "Đang chia" — lead pending (chưa note, chưa release) — bất kỳ sale nào trong org.
 */
async function previewAssignedToday(orgId: string, config: PoolConfig, limit: number) {
  const rows = await prisma.leadRequest.findMany({
    where: {
      contact: { orgId },
      noteSubmittedAt: null,
      releaseReason: null,
      autoReturnedAt: null,
    },
    orderBy: { requestedAt: 'desc' },
    take: limit,
    select: { contactId: true, priorityScore: true, source: true },
  });
  const candidates: PriorityCandidate[] = rows.map((r) => ({
    contactId: r.contactId, source: r.source as LeadSource, priorityScore: r.priorityScore,
  }));
  const items = await enrichItems(candidates, 'assigned');
  return {
    items, total: items.length, filter: 'assigned' as const,
    config: {
      forgottenThresholdDays: config.forgottenThresholdDays,
      autoReturnAfterMinutes: config.autoReturnAfterMinutes,
      requirePhoneInPool: config.requirePhoneInPool,
      cooldownAfterNoteDays: config.cooldownAfterNoteDays,
    },
  };
}

/**
 * Tab "Khoá cooldown" — lead đã note < cooldownAfterNoteDays + chưa release.
 */
async function previewCooldown(orgId: string, config: PoolConfig, limit: number) {
  const cutoff = new Date(Date.now() - config.cooldownAfterNoteDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.leadRequest.findMany({
    where: {
      contact: { orgId },
      noteSubmittedAt: { not: null, gt: cutoff },
      releaseReason: null,
    },
    orderBy: { noteSubmittedAt: 'desc' },
    take: limit,
    select: { contactId: true, priorityScore: true, source: true },
  });
  const candidates: PriorityCandidate[] = rows.map((r) => ({
    contactId: r.contactId, source: r.source as LeadSource, priorityScore: r.priorityScore,
  }));
  const items = await enrichItems(candidates, 'cooldown');
  return {
    items, total: items.length, filter: 'cooldown' as const,
    config: {
      forgottenThresholdDays: config.forgottenThresholdDays,
      autoReturnAfterMinutes: config.autoReturnAfterMinutes,
      requirePhoneInPool: config.requirePhoneInPool,
      cooldownAfterNoteDays: config.cooldownAfterNoteDays,
    },
  };
}

/**
 * Tab "Trả về hôm nay" — lead có releaseReason set trong ngày VN.
 */
async function previewReturnedToday(orgId: string, config: PoolConfig, limit: number) {
  const startToday = startOfTodayVN();
  const rows = await prisma.leadRequest.findMany({
    where: {
      contact: { orgId },
      releaseReason: { not: null },
      OR: [
        { autoReturnedAt: { gte: startToday } },
        { AND: [{ autoReturnedAt: null }, { noteSubmittedAt: { gte: startToday } }] },
      ],
    },
    orderBy: [{ autoReturnedAt: 'desc' }, { noteSubmittedAt: 'desc' }],
    take: limit,
    select: { contactId: true, priorityScore: true, source: true },
  });
  const candidates: PriorityCandidate[] = rows.map((r) => ({
    contactId: r.contactId, source: r.source as LeadSource, priorityScore: r.priorityScore,
  }));
  const items = await enrichItems(candidates, 'returned');
  return {
    items, total: items.length, filter: 'returned_today' as const,
    config: {
      forgottenThresholdDays: config.forgottenThresholdDays,
      autoReturnAfterMinutes: config.autoReturnAfterMinutes,
      requirePhoneInPool: config.requirePhoneInPool,
      cooldownAfterNoteDays: config.cooldownAfterNoteDays,
    },
  };
}

/**
 * Shared enrich — load Contact + latest LeadRequest + latest Note + tên CustomerList.
 */
async function enrichItems(
  candidates: PriorityCandidate[],
  rowKind: 'available' | 'assigned' | 'cooldown' | 'returned',
) {
  if (candidates.length === 0) return [];
  const contactIds = candidates.map((c) => c.contactId);

  const [contacts, latestLeadRequests, latestNotes, customerListEntries] = await Promise.all([
    prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: {
        id: true, fullName: true, crmName: true, phone: true, phoneNormalized: true,
        hasZalo: true, status: true, lastActivity: true, lastInboundAt: true,
        province: true, district: true, ward: true, avatarUrl: true,
        pooledCount: true, // Phase FIFO — số lần đã chia.
        assignedUser: { select: { id: true, fullName: true } },
        statusRef: { select: { name: true, color: true } },
      },
    }),
    // Latest LeadRequest cho mỗi contact — currentSale + status info
    prisma.leadRequest.findMany({
      where: { contactId: { in: contactIds } },
      orderBy: { requestedAt: 'desc' },
      select: {
        id: true, contactId: true, requestedAt: true, noteSubmittedAt: true,
        releaseReason: true, autoReturnedAt: true, noteContent: true, expiresAt: true,
        user: { select: { id: true, fullName: true } },
      },
    }),
    // Latest Note cho mỗi contact
    prisma.note.findMany({
      where: { contactId: { in: contactIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, contactId: true, body: true, createdAt: true,
        author: { select: { fullName: true } },
      },
    }),
    // CustomerList name nếu source=customer_list
    prisma.customerListEntry.findMany({
      where: { contactId: { in: contactIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        contactId: true,
        customerList: { select: { name: true } },
      },
    }),
  ]);

  // Map first LeadRequest + first Note + first CustomerList per contact (ordered desc → first = latest)
  const cMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const lrMap = new Map<string, typeof latestLeadRequests[number]>();
  for (const lr of latestLeadRequests) if (!lrMap.has(lr.contactId)) lrMap.set(lr.contactId, lr);
  const noteMap = new Map<string, typeof latestNotes[number]>();
  for (const n of latestNotes) if (!noteMap.has(n.contactId)) noteMap.set(n.contactId, n);
  const listMap = new Map<string, string>();
  for (const e of customerListEntries) {
    if (!e.contactId) continue;
    if (!listMap.has(e.contactId)) listMap.set(e.contactId, e.customerList?.name ?? '');
  }

  return candidates.map((cand) => {
    const c = cMap[cand.contactId];
    if (!c) return null;
    const lr = lrMap.get(cand.contactId);
    const note = noteMap.get(cand.contactId);
    const listName = listMap.get(cand.contactId);

    // Derive trạng thái:
    let status: 'new' | 'assigned' | 'cooldown' | 'returned_manual' | 'returned_auto' = 'new';
    let statusTime: string | null = null;
    if (lr) {
      if (lr.releaseReason === 'auto_return' || lr.autoReturnedAt) {
        status = 'returned_auto';
        statusTime = (lr.autoReturnedAt ?? lr.noteSubmittedAt)?.toISOString() ?? null;
      } else if (lr.releaseReason === 'manual_return') {
        status = 'returned_manual';
        statusTime = lr.noteSubmittedAt?.toISOString() ?? null;
      } else if (lr.noteSubmittedAt) {
        status = 'cooldown';
        statusTime = lr.noteSubmittedAt.toISOString();
      } else {
        status = 'assigned';
        statusTime = lr.expiresAt?.toISOString() ?? null;
      }
    }

    // Note type derive
    let noteType: 'note' | 'return' | 'auto' | 'contact' | null = null;
    let noteText: string | null = null;
    let noteAuthor: string | null = null;
    let noteTime: string | null = null;
    if (lr && (lr.releaseReason === 'manual_return' || lr.releaseReason === 'auto_return')) {
      noteType = lr.releaseReason === 'auto_return' ? 'auto' : 'return';
      noteText = lr.noteContent ?? '';
      noteAuthor = lr.user?.fullName ?? null;
      noteTime = (lr.autoReturnedAt ?? lr.noteSubmittedAt)?.toISOString() ?? null;
    } else if (note) {
      noteType = 'note';
      noteText = note.body.replace(/^\[Lead Pool\] /, '');
      noteAuthor = note.author?.fullName ?? null;
      noteTime = note.createdAt.toISOString();
    }

    const idleAnchor = c.lastInboundAt ?? c.lastActivity;
    const daysIdle = idleAnchor ? Math.floor((Date.now() - idleAnchor.getTime()) / 86400000) : null;

    return {
      contactId: c.id,
      priorityScore: cand.priorityScore,
      pooledCount: c.pooledCount ?? 0, // Phase FIFO — số lần đã chia (cột "Đã chia").
      source: cand.source,
      customerListName: listName ?? null,
      name: c.crmName || c.fullName || c.phone || 'KH chưa đặt tên',
      avatarUrl: c.avatarUrl,
      phone: c.phone,
      hasPhone: !!c.phoneNormalized,
      hasZalo: c.hasZalo,
      addressLine: [c.ward, c.district, c.province].filter(Boolean).join(', '),
      contactStatus: c.statusRef?.name ?? c.status,
      contactStatusColor: c.statusRef?.color,
      status,                 // new | assigned | cooldown | returned_manual | returned_auto
      statusTime,             // expiresAt / noteSubmittedAt / autoReturnedAt
      currentSale: lr?.user
        ? { id: lr.user.id, fullName: lr.user.fullName }
        : null,
      latestNote: noteType ? { type: noteType, text: noteText, author: noteAuthor, time: noteTime } : null,
      daysIdle,
      lastInboundAt: c.lastInboundAt,
      previousAssignee: c.assignedUser ? { id: c.assignedUser.id, fullName: c.assignedUser.fullName } : null,
      rowKind,
    };
  }).filter(Boolean);
}

/**
 * Phase v2.H 2026-05-29 — Count pool availability đúng nghĩa.
 *
 * Trước đây tách 2 cách count:
 *   - getLeadPoolStats.poolAvailable: chỉ count contacts (forgotten pool)
 *   - getQueueTodayStats.poolSize: chỉ count contacts (forgotten pool)
 *   → BỎ QUA 521 CustomerListEntry chưa link contact (yet) — đây là kho lead có
 *     thể xin ngay (BE sẽ tạo Contact stub khi sale claim).
 *
 * Function này count tổng = forgotten contacts + customer_list unlinked entries.
 * Args.userId: nếu truyền → loại lead anh đang giữ (FAB view). Nếu null → tổng org (queue admin).
 */
async function countTotalPoolAvailable(
  orgId: string,
  userId: string | null,
  config: PoolConfig,
): Promise<number> {
  // Inline mọi value vào SQL (tránh PG type inference issue với mixed types).
  // Safe vì: orgId/userId UUID validated, dates ISO format, statuses từ config server-controlled.
  const thresholdIso = new Date(Date.now() - config.forgottenThresholdDays * 24 * 60 * 60 * 1000).toISOString();
  const cooldownIso = new Date(Date.now() - config.cooldownAfterNoteDays * 24 * 60 * 60 * 1000).toISOString();
  const selfReclaimIso = new Date(Date.now() - config.selfReclaimLockDays * 24 * 60 * 60 * 1000).toISOString();
  const safeOrgId = `'${orgId.replace(/'/g, "''")}'`;
  const safeUserId = userId ? `'${userId.replace(/'/g, "''")}'` : null;
  const phoneFilter = config.requirePhoneInPool ? 'AND c.phone_normalized IS NOT NULL' : '';
  const statusFilter = config.excludedStatuses.length > 0
    ? `AND (c.status IS NULL OR c.status NOT IN (${config.excludedStatuses.map(s => `'${String(s).replace(/'/g, "''")}'`).join(',')}))`
    : '';
  const userFilter = safeUserId ? `AND (c.assigned_user_id IS NULL OR c.assigned_user_id != ${safeUserId})` : '';
  // Phase v2.I — Self-reclaim lock: chỉ apply khi count cho 1 sale cụ thể (FAB view).
  const selfReclaimFilter = safeUserId ? `
      AND NOT EXISTS (
        SELECT 1 FROM lead_requests lr3
        WHERE lr3.contact_id = c.id
          AND lr3.requested_by_user_id = ${safeUserId}
          AND lr3.release_reason IN ('manual_return', 'auto_return')
          AND COALESCE(lr3.auto_returned_at, lr3.note_submitted_at) > '${selfReclaimIso}'::timestamp
      )` : '';
  const userFilterCle = safeUserId
    ? `OR EXISTS (
        SELECT 1 FROM contacts cc
        WHERE cc.id = cle.contact_id
          AND (cc.assigned_user_id IS NULL OR cc.assigned_user_id != ${safeUserId})
          AND NOT EXISTS (
            SELECT 1 FROM lead_requests lr2
            WHERE lr2.contact_id = cc.id
              AND lr2.note_submitted_at IS NOT NULL
              AND lr2.note_submitted_at > '${cooldownIso}'::timestamp
              AND lr2.release_reason IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM lead_requests lr3
            WHERE lr3.contact_id = cc.id
              AND lr3.requested_by_user_id = ${safeUserId}
              AND lr3.release_reason IN ('manual_return', 'auto_return')
              AND COALESCE(lr3.auto_returned_at, lr3.note_submitted_at) > '${selfReclaimIso}'::timestamp
          )
      )`
    : `OR cle.contact_id IS NOT NULL`;

  const forgottenSql = `
    SELECT COUNT(*)::INTEGER AS cnt FROM contacts c
    WHERE c.org_id = ${safeOrgId}
      AND COALESCE(c.last_inbound_at, c.created_at) < '${thresholdIso}'::timestamp
      AND c.consent_status != 'revoked'
      ${statusFilter}
      AND c.merged_into IS NULL
      ${phoneFilter}
      ${userFilter}
      AND NOT EXISTS (
        SELECT 1 FROM lead_requests lr
        WHERE lr.contact_id = c.id
          AND lr.note_submitted_at IS NULL AND lr.release_reason IS NULL AND lr.auto_returned_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM lead_requests lr2
        WHERE lr2.contact_id = c.id
          AND lr2.note_submitted_at IS NOT NULL
          AND lr2.note_submitted_at > '${cooldownIso}'::timestamp
          AND lr2.release_reason IS NULL
      )
      ${selfReclaimFilter}
  `;

  const customerListSql = `
    SELECT COUNT(*)::INTEGER AS cnt
    FROM customer_list_entries cle
    JOIN customer_lists cl ON cl.id = cle.customer_list_id
    WHERE cl.org_id = ${safeOrgId}
      AND cl.shareable_to_pool = true
      AND cl.archived_at IS NULL
      AND cle.status IN ('validated', 'enriched')
      AND cle.phone_valid = true
      AND (
        cle.contact_id IS NULL
        ${userFilterCle}
      )
  `;

  const [forgottenRows, customerListRows] = await Promise.all([
    config.enabledSources.includes('forgotten')
      ? prisma.$queryRawUnsafe<Array<{ cnt: number }>>(forgottenSql)
      : Promise.resolve([{ cnt: 0 }]),
    config.enabledSources.includes('customer_list')
      ? prisma.$queryRawUnsafe<Array<{ cnt: number }>>(customerListSql)
      : Promise.resolve([{ cnt: 0 }]),
  ]);

  return Number(forgottenRows[0]?.cnt ?? 0) + Number(customerListRows[0]?.cnt ?? 0);
}

// Variant non-tx của queryCustomerListCandidates cho preview (không tạo stub).
async function queryCustomerListPreview(orgId: string, userId: string, limit = 50, cooldownDays = 30, selfReclaimLockDays = 7): Promise<PriorityCandidate[]> {
  // Phase v2.B + v2.I 2026-05-29 — cooldown + self-reclaim rule.
  const rows = await prisma.$queryRawUnsafe<Array<{ contact_id: string; days_in_list: number }>>(
    `
    SELECT cle.contact_id, EXTRACT(EPOCH FROM (NOW() - cle.created_at)) / 86400 AS days_in_list
    FROM customer_list_entries cle
    JOIN customer_lists cl ON cl.id = cle.customer_list_id
    WHERE cl.org_id = $1
      AND cl.shareable_to_pool = true
      AND cl.archived_at IS NULL
      AND cle.status IN ('validated', 'enriched')
      AND cle.phone_valid = true
      AND cle.contact_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM contacts cc
        WHERE cc.id = cle.contact_id
          AND (cc.assigned_user_id IS NULL OR cc.assigned_user_id != $2)
          AND NOT EXISTS (
            SELECT 1 FROM lead_requests lr2
            WHERE lr2.contact_id = cc.id
              AND lr2.note_submitted_at IS NOT NULL
              AND lr2.note_submitted_at > NOW() - ($4 || ' days')::INTERVAL
              AND lr2.release_reason IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM lead_requests lr3
            WHERE lr3.contact_id = cc.id
              AND lr3.requested_by_user_id = $2
              AND lr3.release_reason IN ('manual_return', 'auto_return')
              AND COALESCE(lr3.auto_returned_at, lr3.note_submitted_at) > NOW() - ($5 || ' days')::INTERVAL
          )
      )
    ORDER BY days_in_list DESC
    LIMIT $3
    `,
    orgId, userId, limit, String(cooldownDays), String(selfReclaimLockDays),
  );
  return rows.map((r) => ({
    contactId: r.contact_id,
    source: 'customer_list' as const,
    priorityScore: Math.round(Number(r.days_in_list) + 10),
  }));
}

/**
 * Tìm conversation phù hợp để sale mở chat với KH.
 * Workflow:
 *   1. Nếu Contact có Friend accepted với nick của sale → tìm Conversation tương ứng
 *   2. Nếu chưa có conv nhưng có Friend → trả về thông tin để FE mở chat tạo mới
 *   3. Nếu chưa có Friend (chưa rõ Zalo) → trả về { canChat: false, reason: 'no_zalo' }
 *      → FE sẽ hiện toast "KH chưa bật tìm kiếm Zalo, hãy gọi điện ngay"
 */
export async function openChatForLead(args: { userId: string; orgId: string; leadRequestId: string; zaloAccountId?: string }) {
  const lr = await prisma.leadRequest.findUnique({
    where: { id: args.leadRequestId },
    include: {
      contact: {
        select: {
          id: true, phone: true, phoneNormalized: true, hasZalo: true,
          friends: {
            where: { friendshipStatus: 'accepted' },
            select: {
              id: true, zaloAccountId: true, zaloUidInNick: true,
              zaloAccount: { select: { id: true, ownerUserId: true, displayName: true } },
            },
          },
        },
      },
    },
  });
  if (!lr) throw new LeadPoolError(404, 'lead_not_found', 'Lead không tồn tại');
  if (lr.requestedByUserId !== args.userId) {
    throw new LeadPoolError(403, 'not_owner', 'Không phải lead của bạn');
  }

  // ── Path A: Sale chỉ định nick → lookup bằng nick đó + upsert Friend + upsert Conversation ──
  if (args.zaloAccountId) {
    const nick = await prisma.zaloAccount.findFirst({
      where: { id: args.zaloAccountId, orgId: args.orgId, status: 'connected' },
      select: { id: true, displayName: true },
    });
    if (!nick) {
      return { canChat: false, reason: 'nick_offline', message: 'Nick Zalo đã chọn không còn online. Hãy chọn nick khác.' };
    }
    const phone = lr.contact.phoneNormalized || lr.contact.phone;
    if (!phone) {
      return { canChat: false, reason: 'no_phone', message: 'KH chưa có SĐT — không tìm được Zalo. Bổ sung SĐT trước.' };
    }

    // Đã có friend với nick này → skip lookup, upsert conv + return
    const existingFriend = lr.contact.friends.find((f) => f.zaloAccountId === nick.id);
    if (existingFriend) {
      const convRow = await prisma.conversation.upsert({
        where: { zaloAccountId_externalThreadId: { zaloAccountId: nick.id, externalThreadId: existingFriend.zaloUidInNick } },
        create: {
          orgId: args.orgId, zaloAccountId: nick.id, contactId: lr.contact.id,
          threadType: 'user', externalThreadId: existingFriend.zaloUidInNick, tab: 'main',
        },
        update: { contactId: lr.contact.id },
        select: { id: true },
      });
      return {
        canChat: true, conversationId: convRow.id,
        zaloAccountId: nick.id, nickDisplayName: nick.displayName,
        threadId: existingFriend.zaloUidInNick, contactId: lr.contact.id,
        source: 'existing_friend',
      };
    }

    // Lookup UID qua nick đó
    const { zaloOps } = await import('../../shared/zalo-operations.js');
    let foundUid: string | null = null;
    let extra: { zaloName?: string | null; avatar?: string | null; globalId?: string | null } = {};
    try {
      const res = await zaloOps.findUser(nick.id, phone) as any;
      const u = res || {};
      foundUid = String(u.uid || u.userId || '') || null;
      extra = {
        zaloName: u.zaloName || u.zalo_name || u.displayName || u.display_name || null,
        avatar: u.avatar || null,
        globalId: u.globalId || null,
      };
    } catch (err: any) {
      logger.warn(`[lead-pool open-chat] findUser fail: ${err?.message || err}`);
    }

    // Bump attempts + update Contact
    await prisma.contact.update({
      where: { id: lr.contact.id },
      data: {
        zaloLookupAt: new Date(),
        ...(foundUid ? { hasZalo: true, zaloUid: foundUid, avatarUrl: extra.avatar ?? undefined } : { hasZalo: false }),
      },
    }).catch(() => { /* silent */ });

    if (!foundUid) {
      return {
        canChat: false, reason: 'no_zalo',
        message: 'KH không bật tìm kiếm/kết bạn Zalo qua SĐT. Hãy thử bằng Sale Phone nhé!',
        phone: lr.contact.phone,
      };
    }

    // Upsert Friend (status='none', track per-nick UID)
    await prisma.friend.upsert({
      where: { zaloAccountId_zaloUidInNick: { zaloAccountId: nick.id, zaloUidInNick: foundUid } },
      create: {
        orgId: args.orgId, zaloAccountId: nick.id, contactId: lr.contact.id,
        zaloUidInNick: foundUid, zaloDisplayName: extra.zaloName || null,
        zaloAvatarUrl: extra.avatar || null, friendshipStatus: 'none',
        zaloGlobalId: extra.globalId || null,
      },
      update: {
        contactId: lr.contact.id,
        zaloDisplayName: extra.zaloName || undefined,
        zaloAvatarUrl: extra.avatar || undefined,
        zaloGlobalId: extra.globalId || undefined,
      },
    });

    // Upsert Conversation stub → FE navigate /chat/:convId được liền
    const convRow = await prisma.conversation.upsert({
      where: { zaloAccountId_externalThreadId: { zaloAccountId: nick.id, externalThreadId: foundUid } },
      create: {
        orgId: args.orgId, zaloAccountId: nick.id, contactId: lr.contact.id,
        threadType: 'user', externalThreadId: foundUid, tab: 'main',
      },
      update: { contactId: lr.contact.id },
      select: { id: true },
    });

    return {
      canChat: true, conversationId: convRow.id,
      zaloAccountId: nick.id, nickDisplayName: nick.displayName,
      threadId: foundUid, contactId: lr.contact.id,
      source: 'lookup_success', zaloName: extra.zaloName, avatar: extra.avatar,
    };
  }

  // ── Path B: Sale không chọn nick → fallback Friend có sẵn ──
  const myFriend = lr.contact.friends.find((f) => f.zaloAccount.ownerUserId === args.userId);
  const anyFriend = myFriend ?? lr.contact.friends[0];

  if (!anyFriend) {
    if (lr.contact.hasZalo === false) {
      return { canChat: false, reason: 'no_zalo', message: 'KH chưa bật tìm kiếm Zalo. Hãy gọi cho khách bằng điện thoại ngay bạn nhé!', phone: lr.contact.phone };
    }
    return { canChat: false, reason: 'not_friended', message: 'KH chưa kết bạn với nick nào của org. Chọn nick để tìm trước nhé.', phone: lr.contact.phone };
  }

  const conv = await prisma.conversation.findFirst({
    where: {
      orgId: args.orgId,
      zaloAccountId: anyFriend.zaloAccountId,
      externalThreadId: anyFriend.zaloUidInNick,
      threadType: 'user',
    },
    select: { id: true, lastMessageAt: true },
  });

  return {
    canChat: true,
    conversationId: conv?.id ?? null,
    zaloAccountId: anyFriend.zaloAccountId,
    nickDisplayName: anyFriend.zaloAccount.displayName,
    threadId: anyFriend.zaloUidInNick,
    contactId: lr.contact.id,
    source: 'existing_friend',
  };
}

/**
 * listAvailableNicks — list nick Zalo connected để sale chọn khi "Mở chat Zalo" / "Tìm Zalo qua SĐT".
 * - Sale thường: trả về nick OWN của user (1 row).
 * - Leader/Deputy: OWN + nick của member trong dept tree dưới quyền (2 rows).
 * - Admin/Owner: OWN + tất cả nick còn lại trong org (2 rows).
 * Chỉ trả nick status='connected'.
 */
export async function listAvailableNicks(args: { orgId: string; userId: string; role: string }) {
  const ownNicks = await prisma.zaloAccount.findMany({
    where: { orgId: args.orgId, ownerUserId: args.userId, status: 'connected' },
    orderBy: { lastConnectedAt: 'desc' },
    select: { id: true, displayName: true, avatarUrl: true, lastConnectedAt: true },
    take: 10,
  });

  let teamNicks: Array<{ id: string; displayName: string | null; avatarUrl: string | null; ownerName: string | null; lastConnectedAt: Date | null }> = [];
  let scope: 'sale' | 'leader' | 'admin' = 'sale';

  if (args.role === 'owner' || args.role === 'admin') {
    scope = 'admin';
    const rows = await prisma.zaloAccount.findMany({
      where: { orgId: args.orgId, status: 'connected', ownerUserId: { not: args.userId } },
      orderBy: { lastConnectedAt: 'desc' },
      select: { id: true, displayName: true, avatarUrl: true, lastConnectedAt: true, owner: { select: { fullName: true } } },
      take: 20,
    });
    teamNicks = rows.map((r) => ({
      id: r.id, displayName: r.displayName, avatarUrl: r.avatarUrl,
      ownerName: r.owner?.fullName ?? null,
      lastConnectedAt: r.lastConnectedAt,
    }));
  } else {
    const membership = await prisma.departmentMember.findFirst({
      where: { userId: args.userId, deptRole: { in: ['leader', 'deputy'] } },
      select: { department: { select: { path: true } } },
    });
    if (membership) {
      scope = 'leader';
      const subDepts = await prisma.department.findMany({
        where: { orgId: args.orgId, path: { startsWith: membership.department.path } },
        select: { id: true },
      });
      const subDeptIds = subDepts.map((d) => d.id);
      const teamMembers = await prisma.departmentMember.findMany({
        where: { departmentId: { in: subDeptIds }, userId: { not: args.userId } },
        select: { userId: true },
      });
      const teamUserIds = teamMembers.map((m) => m.userId);
      if (teamUserIds.length) {
        const rows = await prisma.zaloAccount.findMany({
          where: { orgId: args.orgId, status: 'connected', ownerUserId: { in: teamUserIds } },
          orderBy: { lastConnectedAt: 'desc' },
          select: { id: true, displayName: true, avatarUrl: true, lastConnectedAt: true, owner: { select: { fullName: true } } },
          take: 20,
        });
        teamNicks = rows.map((r) => ({
          id: r.id, displayName: r.displayName, avatarUrl: r.avatarUrl,
          ownerName: r.owner?.fullName ?? null,
          lastConnectedAt: r.lastConnectedAt,
        }));
      }
    }
  }

  return {
    scope,
    ownNicks: ownNicks.map((n) => ({ id: n.id, displayName: n.displayName, avatarUrl: n.avatarUrl, lastConnectedAt: n.lastConnectedAt })),
    teamNicks,
  };
}

/**
 * Phase 2026-05-28 — Admin/Manager reset quota workflow.
 * Yêu cầu reviewer phải xem hết noted leads hôm nay → grant bonus 1..maxPerDay.
 */
async function canResetQuotaFor(requester: { id: string; role: string; orgId: string }, targetUserId: string): Promise<boolean> {
  if (requester.role === 'owner' || requester.role === 'admin') return true;
  const membership = await prisma.departmentMember.findFirst({
    where: { userId: requester.id, deptRole: { in: ['leader', 'deputy'] } },
    select: { department: { select: { path: true } } },
  });
  if (!membership) return false;
  const subDepts = await prisma.department.findMany({
    where: { orgId: requester.orgId, path: { startsWith: membership.department.path } },
    select: { id: true },
  });
  const subDeptIds = subDepts.map((d) => d.id);
  const targetInTeam = await prisma.departmentMember.findFirst({
    where: { userId: targetUserId, departmentId: { in: subDeptIds } },
    select: { userId: true },
  });
  return !!targetInTeam;
}

export async function listSaleNotedLeadsToday(args: {
  requester: { id: string; role: string; orgId: string };
  targetUserId: string;
}) {
  const allowed = await canResetQuotaFor(args.requester, args.targetUserId);
  if (!allowed) throw new LeadPoolError(403, 'forbidden', 'Bạn không có quyền reset quota cho user này');

  const startToday = startOfTodayVN();
  const notedLeads = await prisma.leadRequest.findMany({
    where: {
      requestedByUserId: args.targetUserId,
      requestedAt: { gte: startToday },
      noteSubmittedAt: { not: null },
    },
    orderBy: { requestedAt: 'asc' },
    select: {
      id: true, contactId: true, requestedAt: true, noteSubmittedAt: true,
      noteContent: true, priorityScore: true, source: true,
      contact: {
        select: {
          id: true, fullName: true, crmName: true, phone: true, hasZalo: true,
          avatarUrl: true, province: true, district: true, ward: true,
        },
      },
    },
  });

  const previousGrants = await prisma.leadPoolBonusQuota.findMany({
    where: { userId: args.targetUserId, dateKey: todayDateKeyVN() },
    select: { reviewedLeadIds: true, bonusCount: true, grantedBy: { select: { fullName: true } }, createdAt: true },
  });
  const alreadyReviewedIds = new Set<string>();
  for (const g of previousGrants) {
    if (Array.isArray(g.reviewedLeadIds)) {
      for (const id of g.reviewedLeadIds as string[]) alreadyReviewedIds.add(id);
    }
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true, fullName: true, email: true },
  });
  const config = await getOrCreateConfig(args.requester.orgId);

  return {
    targetUser,
    config: { maxPerDay: config.maxRequestsPerDay },
    leads: notedLeads.map((l) => ({
      id: l.id,
      contactId: l.contactId,
      contactName: l.contact?.crmName ?? l.contact?.fullName ?? l.contact?.phone ?? 'KH',
      contactPhone: l.contact?.phone ?? null,
      contactAvatar: l.contact?.avatarUrl ?? null,
      contactLocation: [l.contact?.ward, l.contact?.district, l.contact?.province].filter(Boolean).join(', '),
      hasZalo: l.contact?.hasZalo,
      requestedAt: l.requestedAt,
      noteSubmittedAt: l.noteSubmittedAt,
      noteContent: l.noteContent,
      priorityScore: l.priorityScore,
      source: l.source,
      alreadyReviewed: alreadyReviewedIds.has(l.id),
    })),
    previousGrantsToday: previousGrants.map((g) => ({
      bonusCount: g.bonusCount,
      grantedByName: g.grantedBy?.fullName ?? null,
      createdAt: g.createdAt,
    })),
  };
}

export async function adminResetQuota(args: {
  requester: { id: string; role: string; orgId: string };
  targetUserId: string;
  reviewedLeadIds: string[];
  bonusCount: number;
  reason?: string;
}) {
  const allowed = await canResetQuotaFor(args.requester, args.targetUserId);
  if (!allowed) throw new LeadPoolError(403, 'forbidden', 'Bạn không có quyền reset quota cho user này');

  if (!Number.isInteger(args.bonusCount) || args.bonusCount < 1) {
    throw new LeadPoolError(400, 'bad_bonus', 'bonusCount phải là số nguyên >= 1');
  }
  const config = await getOrCreateConfig(args.requester.orgId);
  if (args.bonusCount > config.maxRequestsPerDay) {
    throw new LeadPoolError(400, 'bad_bonus', `bonusCount tối đa = ${config.maxRequestsPerDay} (max/day trong settings)`);
  }

  const startToday = startOfTodayVN();
  const notedToday = await prisma.leadRequest.findMany({
    where: {
      requestedByUserId: args.targetUserId,
      requestedAt: { gte: startToday },
      noteSubmittedAt: { not: null },
    },
    select: { id: true },
  });
  const previousReviewedIds = new Set<string>();
  const previousGrants = await prisma.leadPoolBonusQuota.findMany({
    where: { userId: args.targetUserId, dateKey: todayDateKeyVN() },
    select: { reviewedLeadIds: true },
  });
  for (const g of previousGrants) {
    if (Array.isArray(g.reviewedLeadIds)) {
      for (const id of g.reviewedLeadIds as string[]) previousReviewedIds.add(id);
    }
  }
  const newReviewIds = args.reviewedLeadIds.filter((id) => !previousReviewedIds.has(id));
  const stillUnreviewed = notedToday
    .map((l) => l.id)
    .filter((id) => !previousReviewedIds.has(id) && !newReviewIds.includes(id));
  if (stillUnreviewed.length > 0) {
    throw new LeadPoolError(400, 'review_incomplete',
      `Còn ${stillUnreviewed.length} lead chưa review. Phải xem hết noted leads trước khi cấp thêm quota.`);
  }

  const reviewer = await prisma.user.findUnique({
    where: { id: args.requester.id },
    select: { fullName: true },
  });
  const reviewerName = reviewer?.fullName ?? 'Quản lý';

  // Append review note vào mỗi lead vừa review (chỉ lead mới)
  const now = new Date();
  for (const leadId of newReviewIds) {
    const lr = await prisma.leadRequest.findUnique({ where: { id: leadId }, select: { noteContent: true } });
    if (!lr) continue;
    const reviewLine = `\n\n— ✅ ${reviewerName} đã review lúc ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
    await prisma.leadRequest.update({
      where: { id: leadId },
      data: { noteContent: (lr.noteContent ?? '') + reviewLine },
    });
  }

  const bonus = await prisma.leadPoolBonusQuota.create({
    data: {
      orgId: args.requester.orgId,
      userId: args.targetUserId,
      dateKey: todayDateKeyVN(),
      bonusCount: args.bonusCount,
      grantedByUserId: args.requester.id,
      reviewedLeadIds: newReviewIds,
      reason: args.reason ?? null,
    },
    select: { id: true, bonusCount: true, dateKey: true, createdAt: true },
  });

  // Phase v2.D 2026-05-29 — Timeline log cho USER (sale nhận bonus) để dashboard
  // hiển thị "lúc nào được cấp bonus, ai cấp, vì sao".
  const reasonSuffix = args.reason ? ` · Lý do: ${args.reason}` : '';
  logActivity({
    orgId: args.requester.orgId,
    userId: args.requester.id,
    action: 'lead_pool_bonus_grant',
    entityType: 'user',
    entityId: args.targetUserId,
    details: {
      summary: `${reviewerName} đã cấp thêm ${args.bonusCount} lead bonus sau khi review ${newReviewIds.length} lead đã note${reasonSuffix}`,
      bonusId: bonus.id,
      bonusCount: args.bonusCount,
      reviewerName,
      reviewedLeadIds: newReviewIds,
      reviewedCount: newReviewIds.length,
      reason: args.reason ?? null,
      dateKey: todayDateKeyVN(),
    },
  });

  return { success: true, bonus, reviewedCount: newReviewIds.length, reviewerName };
}

/**
 * 2026-05-28: rebuild full lead payload cho sale's pending lead (reopen modal).
 * Khác với requestLead, KHÔNG pick contact mới — load existing LeadRequest +
 * trigger autoLookup + buildLeadPayload đầy đủ (per-nick + gender).
 * Dùng khi FAB "Nhận Lead" ở pending mode → click → reopen lead cũ với full data.
 */
export async function getLeadPayload(args: { userId: string; orgId: string; leadRequestId: string }) {
  const lr = await prisma.leadRequest.findUnique({
    where: { id: args.leadRequestId },
    select: {
      id: true, contactId: true, requestedByUserId: true, source: true,
      priorityScore: true, expiresAt: true, requestedAt: true,
    },
  });
  if (!lr) throw new LeadPoolError(404, 'lead_not_found', 'Lead không tồn tại');
  if (lr.requestedByUserId !== args.userId) {
    throw new LeadPoolError(403, 'not_owner', 'Không phải lead của bạn');
  }

  const [saleUser, config] = await Promise.all([
    prisma.user.findUnique({ where: { id: args.userId }, select: { fullName: true } }),
    getOrCreateConfig(args.orgId),
  ]);

  // Auto-trigger Zalo lookup (cache hit nếu Friend per-nick đã có → no SDK call)
  const autoLookup = await autoLookupZaloForLead({
    contactId: lr.contactId,
    orgId: args.orgId,
    saleUserId: args.userId,
  }).catch((err) => {
    logger.warn(`[get-lead-payload] auto-lookup failed: ${err?.message || err}`);
    return null;
  });

  const greetingTemplates = Array.isArray(config.greetingTemplates) ? config.greetingTemplates : [];
  const payload = await buildLeadPayload(lr.contactId, saleUser?.fullName ?? null, args.userId, autoLookup, greetingTemplates);
  if (!payload) throw new LeadPoolError(404, 'contact_not_found', 'Contact không tồn tại');

  return {
    leadRequestId: lr.id,
    source: lr.source,
    priorityScore: lr.priorityScore,
    expiresAt: lr.expiresAt,
    ...payload,
  };
}

/**
 * Phase Lead Pool FIFO 2026-06-15 — Tổng hợp số liệu cho 4 màn PRO admin:
 * Dashboard buồng lái, Điều phối sale, Nguồn lead, Chất lượng lead.
 * 1 endpoint gọn thay 4 (giảm round-trip). Chỉ đọc, không mutate.
 */
export async function getAdminDashboard(args: { orgId: string; period?: 'today' | '7d' | '30d' }) {
  const { orgId } = args;
  const period = args.period ?? '7d';
  const startToday = startOfTodayVN();
  const start7d = new Date(Date.now() - 7 * 86400000);
  const start14d = new Date(Date.now() - 14 * 86400000);
  // Phase Dashboard v2 2026-06-15 — mốc kỳ cho xếp hạng sale + chất lượng (Anh chốt 7d default).
  const periodStart = period === 'today' ? startToday
    : period === '30d' ? new Date(Date.now() - 30 * 86400000)
    : start7d;

  // ── Vòng tua: tổng pool đủ điều kiện vào pool (đơn giản: contact chưa bị loại) ──
  // Tổng pool ≈ count contact có pooled_count đã đếm. "Chưa ai bóc vòng này" = pooled_count
  // nhỏ nhất (lead mới + lead đã xong 1 vòng đầy). Dùng MIN(pooled_count) làm mốc vòng.
  const [poolAgg, avgRow] = await Promise.all([
    prisma.contact.aggregate({ where: { orgId, mergedInto: null }, _count: { _all: true } }),
    prisma.$queryRawUnsafe<Array<{ avg: number | null; max: number | null }>>(
      `SELECT AVG(pooled_count)::float AS avg, MAX(pooled_count)::int AS max FROM contacts WHERE org_id = $1 AND merged_into IS NULL`,
      orgId,
    ),
  ]);
  const poolTotal = poolAgg._count._all;
  const avgPooled = avgRow[0]?.avg ?? 0;
  const minRound = await prisma.$queryRawUnsafe<Array<{ min: number | null }>>(
    `SELECT MIN(pooled_count)::int AS min FROM contacts WHERE org_id = $1 AND merged_into IS NULL`, orgId,
  );
  const currentRound = (minRound[0]?.min ?? 0) + 1;
  // "Đã đi" trong vòng hiện tại = số contact đã có pooled_count > minRound.
  const distributedThisRound = await prisma.contact.count({
    where: { orgId, mergedInto: null, pooledCount: { gt: minRound[0]?.min ?? 0 } },
  });

  // ── KPI hôm nay ──
  const [requestedToday, notedToday, returnedAuto, returnedManual, pendingActive] = await Promise.all([
    prisma.leadPoolDistribution.count({ where: { orgId, distributedAt: { gte: startToday } } }),
    prisma.leadRequest.count({ where: { contact: { orgId }, noteSubmittedAt: { gte: startToday } } }),
    prisma.leadRequest.count({ where: { contact: { orgId }, releaseReason: 'auto_return', autoReturnedAt: { gte: startToday } } }),
    prisma.leadRequest.count({ where: { contact: { orgId }, releaseReason: 'manual_return', noteSubmittedAt: { gte: startToday } } }),
    prisma.leadRequest.count({ where: { contact: { orgId }, noteSubmittedAt: null, releaseReason: null, autoReturnedAt: null } }),
  ]);

  // ── Lead kẹt đáy: pooled_count > avg*3 (Review M3 / C2) ──
  const stuckThreshold = Math.max(3, Math.ceil(avgPooled * 3));
  const stuckLeads = await prisma.contact.findMany({
    where: { orgId, mergedInto: null, pooledCount: { gte: stuckThreshold } },
    orderBy: { pooledCount: 'desc' },
    take: 20,
    select: { id: true, fullName: true, crmName: true, phone: true, pooledCount: true, avatarUrl: true },
  });

  // ── Phase Dashboard v2 — XẾP HẠNG SALE theo kỳ (Anh chốt 3 tiêu chí: tỉ lệ note,
  //    đẩy status tốt, tốc độ note). Điểm = notePct×0.35 + qualityPct×0.40 + speed×0.25.
  //    "Status tốt" = Status.order ≥ order của status tên chứa "tiềm"/"nóng"/"chốt"/"đàm phán"
  //    (org tự định nghĩa). Fallback: status khác "mới"/"mất" coi là tiến triển.
  const statuses = await prisma.status.findMany({
    where: { orgId }, select: { id: true, name: true, order: true, color: true, isTerminal: true },
    orderBy: { order: 'asc' },
  });
  // Ngưỡng "status tốt": order nhỏ nhất trong các status tên gợi ý đã tiến triển.
  const GOOD_RE = /(tiềm|nóng|chốt|đàm phán|quan tâm|hot|won|deal)/i;
  const goodStatusIds = new Set(statuses.filter((s) => GOOD_RE.test(s.name)).map((s) => s.id));

  const distInPeriod = await prisma.leadPoolDistribution.groupBy({
    by: ['assignedToUserId'],
    where: { orgId, distributedAt: { gte: periodStart } },
    _count: { _all: true },
  });
  const saleIds = distInPeriod.map((d) => d.assignedToUserId);
  // Lấy chi tiết request trong kỳ để tính tốc độ + status đẩy lên (mỗi sale).
  const reqInPeriod = saleIds.length ? await prisma.leadRequest.findMany({
    where: { requestedByUserId: { in: saleIds }, requestedAt: { gte: periodStart } },
    select: {
      requestedByUserId: true, requestedAt: true, noteSubmittedAt: true, releaseReason: true,
      contactId: true, contact: { select: { statusId: true } },
    },
  }) : [];
  const saleUsers = saleIds.length ? await prisma.user.findMany({
    where: { id: { in: saleIds } }, select: { id: true, fullName: true, email: true, avatarUrl: true },
  }) : [];
  const userMap = new Map(saleUsers.map((u) => [u.id, u]));

  // Gom theo sale.
  type Acc = { received: number; noted: number; returned: number; good: number; noteMs: number[]; };
  const accBySale = new Map<string, Acc>();
  for (const d of distInPeriod) accBySale.set(d.assignedToUserId, { received: d._count._all, noted: 0, returned: 0, good: 0, noteMs: [] });
  for (const r of reqInPeriod) {
    const a = accBySale.get(r.requestedByUserId); if (!a) continue;
    if (r.releaseReason === 'manual_return' || r.releaseReason === 'auto_return') a.returned++;
    if (r.noteSubmittedAt) {
      a.noted++;
      a.noteMs.push(r.noteSubmittedAt.getTime() - r.requestedAt.getTime());
      if (r.contact?.statusId && goodStatusIds.has(r.contact.statusId)) a.good++;
    }
  }
  const salePerformance = [...accBySale.entries()].map(([uid, a]) => {
    const notePct = a.received > 0 ? Math.round((a.noted / a.received) * 100) : 0;
    const qualityPct = a.noted > 0 ? Math.round((a.good / a.noted) * 100) : 0;
    const avgNoteMinutes = a.noteMs.length ? Math.round((a.noteMs.reduce((x, y) => x + y, 0) / a.noteMs.length) / 60000) : null;
    // speedScore: <30' = 100, tuyến tính giảm tới >8h(480') = 0.
    const speedScore = avgNoteMinutes === null ? 0
      : avgNoteMinutes <= 30 ? 100
      : avgNoteMinutes >= 480 ? 0
      : Math.round(100 - ((avgNoteMinutes - 30) / 450) * 100);
    const score = Math.round(notePct * 0.35 + qualityPct * 0.40 + speedScore * 0.25);
    const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
    return {
      userId: uid,
      fullName: userMap.get(uid)?.fullName ?? null,
      avatarUrl: userMap.get(uid)?.avatarUrl ?? null,
      received: a.received, noted: a.noted, pending: Math.max(0, a.received - a.noted),
      returned: a.returned, good: a.good,
      notePct, qualityPct, avgNoteMinutes, speedScore, score, grade,
      lowSample: a.received < 5, // ít mẫu → điểm dễ lệch.
    };
  }).sort((x, y) => y.score - x.score);

  // ── statusBreakdown: KH được giao trong kỳ đang ở status nào (theo Status org) ──
  const statusCounts = saleIds.length ? await prisma.$queryRawUnsafe<Array<{ status_id: string | null; cnt: number }>>(
    `SELECT c.status_id, COUNT(DISTINCT c.id)::int AS cnt
     FROM lead_pool_distributions lpd JOIN contacts c ON c.id = lpd.contact_id
     WHERE lpd.org_id = $1 AND lpd.distributed_at >= $2
     GROUP BY c.status_id`,
    orgId, periodStart,
  ) : [];
  const statusCntMap = new Map(statusCounts.map((s) => [s.status_id, s.cnt]));
  const totalStatusCount = statusCounts.reduce((x, s) => x + s.cnt, 0);
  const statusBreakdown = statuses.map((s) => ({
    id: s.id, name: s.name, color: s.color, order: s.order,
    count: statusCntMap.get(s.id) ?? 0,
    pct: totalStatusCount > 0 ? Math.round(((statusCntMap.get(s.id) ?? 0) / totalStatusCount) * 100) : 0,
  })).filter((s) => s.count > 0).sort((a, b) => b.count - a.count);

  // ── Nguồn lead: phân bổ theo source (7 ngày) + tệp customer_list shareable ──
  const sourceBreakdown = await prisma.leadPoolDistribution.groupBy({
    by: ['source'],
    where: { orgId, distributedAt: { gte: start7d } },
    _count: { _all: true },
  });
  const lists = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; remaining: number; distributed: number }>>(
    `SELECT cl.id, cl.name,
       COUNT(*) FILTER (WHERE cle.status IN ('validated','enriched') AND cle.phone_valid = true)::int AS remaining,
       0::int AS distributed
     FROM customer_lists cl
     LEFT JOIN customer_list_entries cle ON cle.customer_list_id = cl.id
     WHERE cl.org_id = $1 AND cl.shareable_to_pool = true AND cl.archived_at IS NULL
     GROUP BY cl.id, cl.name ORDER BY remaining DESC LIMIT 20`,
    orgId,
  );

  // ── Chất lượng lead: lý do trả lại (14 ngày) — đọc note của return ──
  const returns14d = await prisma.leadRequest.findMany({
    where: { contact: { orgId }, releaseReason: { in: ['manual_return', 'auto_return'] }, OR: [{ autoReturnedAt: { gte: start14d } }, { noteSubmittedAt: { gte: start14d } }] },
    select: { releaseReason: true, source: true },
  });
  const distributed14d = await prisma.leadPoolDistribution.count({ where: { orgId, distributedAt: { gte: start14d } } });
  const returnedCount = returns14d.length;

  // ── Chất lượng theo TỪNG nguồn (returnRate) để tìm "nguồn rác nhất" ──
  const [distBySource, returnBySource] = await Promise.all([
    prisma.leadPoolDistribution.groupBy({ by: ['source'], where: { orgId, distributedAt: { gte: start14d } }, _count: { _all: true } }),
    Promise.resolve(returns14d),
  ]);
  const retCntBySource = new Map<string, number>();
  for (const r of returnBySource) retCntBySource.set(r.source, (retCntBySource.get(r.source) ?? 0) + 1);
  const sourceQuality = distBySource.map((s) => {
    const dist = s._count._all;
    const ret = retCntBySource.get(s.source) ?? 0;
    return { source: s.source, label: formatSourceLabel(s.source), distributed: dist, returned: ret,
      returnRate: dist > 0 ? Math.round((ret / dist) * 100) : 0 };
  }).sort((a, b) => b.returnRate - a.returnRate);

  // ── 3 THẺ INSIGHT (Anh chốt bố cục A+C) — tính sẵn ở BE ──
  const ranked = salePerformance.filter((s) => !s.lowSample);
  const insight = {
    topSale: ranked[0] ?? salePerformance[0] ?? null,                    // sale giỏi nhất
    worstSale: ranked.length > 1 ? ranked[ranked.length - 1] : null,     // sale cần nhắc (đủ mẫu)
    worstSource: sourceQuality.find((s) => s.distributed >= 5) ?? sourceQuality[0] ?? null, // nguồn rác nhất
  };

  return {
    period,
    statusBreakdown,
    sourceQuality,
    insight,
    round: {
      poolTotal,
      currentRound,
      distributedThisRound,
      remaining: Math.max(0, poolTotal - distributedThisRound),
    },
    today: {
      requested: requestedToday,
      noted: notedToday,
      notePct: requestedToday > 0 ? Math.round((notedToday / requestedToday) * 100) : 0,
      returnedAuto, returnedManual,
      returnedTotal: returnedAuto + returnedManual,
      pendingActive,
    },
    stuckLeads: stuckLeads.map((s) => ({
      id: s.id, name: s.crmName ?? s.fullName, phone: s.phone, pooledCount: s.pooledCount, avatarUrl: s.avatarUrl,
    })),
    stuckThreshold,
    salePerformance,
    sources: {
      breakdown: sourceBreakdown.map((s) => ({ source: s.source, label: formatSourceLabel(s.source), count: s._count._all })),
      lists: lists.map((l) => ({ id: l.id, name: l.name, remaining: l.remaining })),
    },
    quality: {
      distributed14d,
      returnedCount,
      returnRate: distributed14d > 0 ? Math.round((returnedCount / distributed14d) * 100) : 0,
      auto: returns14d.filter((r) => r.releaseReason === 'auto_return').length,
      manual: returns14d.filter((r) => r.releaseReason === 'manual_return').length,
    },
  };
}

export function startLeadPoolCron() {
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0); // 2am local
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        await autoReturnExpiredLeads();
      } catch (err) {
        logger.error('[lead-pool-cron] failed:', err);
      } finally {
        scheduleNext();
      }
    }, delayMs);
  }
  scheduleNext();
  logger.info('[lead-pool-cron] scheduled (daily 2am)');
}
