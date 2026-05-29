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
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';

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
  // 2026-05-28 — array template câu chào. Empty → service fallback DEFAULT_GREETING_TEMPLATES.
  // Placeholders: {anh_chi} {ac} {ten_kh} {ten_em}. Max 10 câu, mỗi câu ≤500 ký tự.
  greetingTemplates: string[];
}

// Bounds cho auto-return: 30 phút (rotate nhanh) → 7 ngày (10080 phút)
const AUTO_RETURN_MIN = 30;
const AUTO_RETURN_MAX = 10080;

const DEFAULT_CONFIG: PoolConfig = {
  enabled: true,
  maxRequestsPerDay: 10,
  cooldownMinutes: 15,
  forgottenThresholdDays: 30,
  excludedStatuses: ['hot', 'potential', 'won'],
  autoReturnAfterMinutes: 1440, // 1 ngày
  requirePhoneInPool: true,
  forceNoteBeforeNext: true,
  enabledSources: ['forgotten', 'customer_list'],
  noteMinLength: 20,
  cooldownAfterNoteDays: 30,
  greetingTemplates: [], // empty → service dùng DEFAULT_GREETING_TEMPLATES
};

// Codex MEDIUM-2 fix: validate JSON config — Array.isArray + filter known enum.
const VALID_SOURCES: LeadSource[] = ['forgotten', 'customer_list', 'external_sync'];
const VALID_STATUS_KEYS = ['hot', 'potential', 'won', 'interested', 'contacted', 'cold', 'lost', 'dormant', 'silent_30d', 'new'];

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
      excludedStatuses: safeStringArray(existing.excludedStatuses, DEFAULT_CONFIG.excludedStatuses, VALID_STATUS_KEYS),
      autoReturnAfterMinutes: Math.max(AUTO_RETURN_MIN, Math.min(AUTO_RETURN_MAX, existing.autoReturnAfterMinutes)),
      requirePhoneInPool: Boolean(existing.requirePhoneInPool),
      forceNoteBeforeNext: Boolean(existing.forceNoteBeforeNext),
      enabledSources: safeStringArray(existing.enabledSources, DEFAULT_CONFIG.enabledSources, VALID_SOURCES) as LeadSource[],
      noteMinLength: Math.max(5, Math.min(500, existing.noteMinLength)),
      cooldownAfterNoteDays: Math.max(0, Math.min(365, existing.cooldownAfterNoteDays)),
      greetingTemplates: safeStringArray(existing.greetingTemplates, []).slice(0, 10).map((s) => s.slice(0, 500)),
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
  if (Array.isArray(patch.excludedStatuses)) {
    data.excludedStatuses = safeStringArray(patch.excludedStatuses, [], VALID_STATUS_KEYS);
  }
  if (Array.isArray(patch.enabledSources)) {
    data.enabledSources = safeStringArray(patch.enabledSources, [], VALID_SOURCES);
  }
  if (Array.isArray(patch.greetingTemplates)) {
    // Validate: ≤10 templates, mỗi câu ≤500 ký tự, trim + bỏ rỗng.
    const cleaned = patch.greetingTemplates
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 10)
      .map((s) => s.slice(0, 500));
    data.greetingTemplates = cleaned;
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
        await prisma.contact.updateMany({
          where: { id: lastRequest.contactId, assignedUserId: fullLead.requestedByUserId },
          data: { assignedUserId: fullLead.previousAssigneeId },
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
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; priority_score: number }>>(
    `
    SELECT c.id,
      (
        EXTRACT(EPOCH FROM (NOW() - COALESCE(c.last_inbound_at, c.created_at))) / 86400 * 2
        + CASE WHEN c.phone_normalized IS NOT NULL THEN 5 ELSE 0 END
        + CASE WHEN c.has_zalo = true THEN 10 ELSE 0 END
        - c.zalo_lookup_attempts * 3
      )::INTEGER AS priority_score
    FROM contacts c
    WHERE c.org_id = $1
      AND COALESCE(c.last_inbound_at, c.created_at) < $2
      AND c.consent_status != 'revoked'
      AND (c.status IS NULL OR c.status != ALL($3::text[]))
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
    ORDER BY priority_score DESC
    LIMIT $5
    `,
    orgId,
    thresholdDate,
    excludedStatuses,
    userId,
    limit,
    String(config.cooldownAfterNoteDays),
  );

  return rows.map((r) => ({ contactId: r.id, source: 'forgotten' as const, priorityScore: r.priority_score }));
}

/**
 * Pool B — customer_list: CustomerListEntry trong list.shareableToPool=true.
 * Convert sang Contact: nếu entry.contactId đã link → dùng Contact đó; nếu chưa →
 * tạo Contact stub (no Zalo, phone từ entry).
 *
 * Priority đơn giản: daysInList + (matchedContact ? 10 : 0).
 */
async function queryCustomerListCandidates(orgId: string, userId: string, limit = 50, cooldownDays = 30): Promise<PriorityCandidate[]> {
  // CustomerListEntry uses customer_list_id (not list_id) + phone_e164/phone_local (not phone).
  // status='validated' or 'enriched' OK cho pool.
  // Phase v2.B 2026-05-29 — cooldown sau note: lead đã note < $4 ngày + chưa release → khoá pool.
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
        )
      )
    ORDER BY days_in_list DESC
    LIMIT $3
    `,
    orgId,
    userId,
    limit,
    String(cooldownDays),
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
 * Pick 1 candidate trong top 10 priority (random nhẹ để 2 sale không nhận giống nhau).
 */
function pickTopRandom(candidates: PriorityCandidate[]): PriorityCandidate | null {
  if (candidates.length === 0) return null;
  const top = candidates.slice(0, 10);
  return top[Math.floor(Math.random() * top.length)];
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
  greetingTemplates: string[] = [],
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
    suggestedOpenings: buildSuggestedOpenings(contact, saleFullName, lookupGender, greetingTemplates),
  };
}

// Default templates dùng khi config.greetingTemplates rỗng. Anh tự thêm câu mới qua
// PATCH /lead-pool/config { greetingTemplates: [...] }.
// Placeholder: {anh_chi} {ac} {ten_kh} {ten_em}.
export const DEFAULT_GREETING_TEMPLATES: string[] = [
  'Chào {anh_chi} {ten_kh}, em {ten_em} bên CSKH dự án đây ạ. Em vừa nhận tiếp tài khoản của {ac}, em xem lại thấy {ac} từng quan tâm bên em. Hiện {ac} còn đang tìm hiểu không ạ?',
  'Chào {anh_chi} {ten_kh}, em {ten_em} đây ạ. Lâu rồi bên em chưa cập nhật thông tin mới cho {ac} — bên em vừa có update mới, em gửi {ac} tham khảo nhé?',
  'Chào {anh_chi} {ten_kh}, em {ten_em} bên dự án đây ạ. Dạo này {ac} ổn không? Em có ít ưu đãi mới bên em vừa ra, lúc nào {ac} tiện em chia sẻ ngắn ạ.',
];

// Render 1 template với placeholder values. Bỏ tên KH placeholder nếu thiếu tên.
function renderGreetingTemplate(
  tpl: string,
  vars: { anh_chi: string; ac: string; ten_kh: string; ten_em: string },
): string {
  let out = tpl;
  out = out.replace(/\{anh_chi\}/g, vars.anh_chi);
  out = out.replace(/\{ac\}/g, vars.ac);
  out = out.replace(/\{ten_kh\}/g, vars.ten_kh);
  out = out.replace(/\{ten_em\}/g, vars.ten_em);
  // Cleanup: nếu ten_kh rỗng → "Anh " → "Anh" (xoá space thừa trước dấu phẩy)
  out = out.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
  return out;
}

function buildSuggestedOpenings(
  contact: { crmName: string | null; fullName: string | null },
  saleFullName: string | null,
  gender: number | null = null,
  templates: string[] = [],
): string[] {
  const contactName = vietnameseFirstName(contact.crmName ?? contact.fullName);
  const sale = vietnameseFirstName(saleFullName);
  // Personalize gender: 0=Nam → "Anh", 1=Nữ → "Chị", null → "Anh/Chị" + "anh/chị".
  let anh_chi: string;
  let ac: string;
  if (gender === 0) { anh_chi = 'Anh'; ac = 'anh'; }
  else if (gender === 1) { anh_chi = 'Chị'; ac = 'chị'; }
  else { anh_chi = 'Anh/Chị'; ac = 'anh/chị'; }

  // Empty templates → fallback default
  const list = templates.length > 0 ? templates : DEFAULT_GREETING_TEMPLATES;
  return list.map((tpl) => renderGreetingTemplate(tpl, {
    anh_chi, ac, ten_kh: contactName, ten_em: sale,
  }));
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

  // Pick first OWN connected nick of sale
  const myNick = await prisma.zaloAccount.findFirst({
    where: { ownerUserId: args.saleUserId, orgId: args.orgId, status: 'connected' },
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
  const result = await prisma.$transaction(async (tx) => {
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
        ? queryCustomerListCandidatesTx(tx, args.orgId, args.userId, config.cooldownAfterNoteDays)
        : Promise.resolve([] as PriorityCandidate[]),
    ]);

    const all = [...forgottenList, ...customerListList].sort((a, b) => b.priorityScore - a.priorityScore);
    if (all.length === 0) {
      throw new LeadPoolError(404, 'no_leads', 'Hiện không có lead phù hợp trong pool. Quay lại sau ít phút.');
    }

    // 4. Iterate top-N với SELECT FOR UPDATE SKIP LOCKED — pick first row em lock được
    // Đảm bảo 2 sale clicking đồng thời không nhận cùng contact.
    const topN = all.slice(0, 10);
    let lockedContact: { id: string; assignedUserId: string | null; pickedScore: number; pickedSource: LeadSource } | null = null;

    // Shuffle top N để random trong các sale concurrent
    for (let i = topN.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topN[i], topN[j]] = [topN[j], topN[i]];
    }

    for (const candidate of topN) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; assigned_user_id: string | null }>>(
        `SELECT id, assigned_user_id FROM contacts WHERE id = $1 FOR UPDATE SKIP LOCKED`,
        candidate.contactId,
      );
      if (rows.length === 0) continue; // contact đang bị sale khác lock → thử contact tiếp
      // Đảm bảo contact không có active lead_request khác (race với cron / cùng user mở 2 tab)
      const activeReq = await tx.leadRequest.findFirst({
        where: {
          contactId: candidate.contactId,
          noteSubmittedAt: null,
          releaseReason: null,
          autoReturnedAt: null,
        },
        select: { id: true },
      });
      if (activeReq) continue;

      lockedContact = {
        id: rows[0].id,
        assignedUserId: rows[0].assigned_user_id,
        pickedScore: candidate.priorityScore,
        pickedSource: candidate.source,
      };
      break;
    }

    if (!lockedContact) {
      throw new LeadPoolError(409, 'all_locked', 'Tất cả lead top đang được sale khác xem. Thử lại sau vài giây.');
    }

    // 5. Reassign contact + create LeadRequest. Partial unique index trên (contact_id WHERE active)
    // chống mọi race còn lại (Postgres reject INSERT thứ 2).
    await tx.contact.update({
      where: { id: lockedContact.id },
      data: { assignedUserId: args.userId },
    });

    const lr = await tx.leadRequest.create({
      data: {
        id: randomUUID(),
        orgId: args.orgId,
        requestedByUserId: args.userId,
        contactId: lockedContact.id,
        source: lockedContact.pickedSource,
        priorityScore: lockedContact.pickedScore,
        expiresAt,
        previousAssigneeId: lockedContact.assignedUserId,
      },
    });

    return {
      leadRequestId: lr.id,
      contactId: lockedContact.id,
      source: lockedContact.pickedSource,
      priorityScore: lockedContact.pickedScore,
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

  const greetingTemplates = Array.isArray(config.greetingTemplates) ? (config.greetingTemplates as string[]) : [];
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
      summary: `${saleUser?.fullName ?? 'Sale'} đã nhận lead từ Pool · Nguồn: ${sourceLabel} · Điểm ưu tiên: ${result.priorityScore} · Hạn note: ${expireHint}`,
      leadRequestId: result.leadRequestId,
      source: result.source,
      sourceLabel,
      priorityScore: result.priorityScore,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    leadRequestId: result.leadRequestId,
    source: result.source,
    priorityScore: result.priorityScore,
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
  limit = 50,
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
        )
      )
    ORDER BY days_in_list DESC
    LIMIT $3
    `,
    orgId, userId, limit, String(cooldownDays),
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
    result.push({
      contactId,
      source: 'customer_list',
      priorityScore: Math.round(Number(row.days_in_list) + 10),
    });
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
 */
export async function submitNote(args: { userId: string; leadRequestId: string; noteContent: string }) {
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
  if (lr.noteSubmittedAt !== null) {
    throw new LeadPoolError(400, 'already_noted', 'Lead này đã có note rồi');
  }
  if (lr.releaseReason !== null) {
    throw new LeadPoolError(400, 'already_released', 'Lead này đã được trả về pool');
  }

  const config = await getOrCreateConfig(lr.contact.orgId);
  const trimmed = args.noteContent.trim();
  if (trimmed.length < config.noteMinLength) {
    throw new LeadPoolError(400, 'note_too_short', `Note phải dài ít nhất ${config.noteMinLength} ký tự (hiện ${trimmed.length}).`);
  }

  const now = new Date();
  // Codex MEDIUM-3 fix: conditional update để chống double-submit race.
  // updateMany với where note_submitted_at IS NULL — chỉ row đầu tiên success;
  // count=0 = race lose, abort tạo Note để tránh duplicate.
  await prisma.$transaction(async (tx) => {
    const updated = await tx.leadRequest.updateMany({
      where: { id: lr.id, noteSubmittedAt: null, releaseReason: null },
      data: { noteContent: trimmed, noteSubmittedAt: now },
    });
    if (updated.count === 0) {
      throw new LeadPoolError(409, 'race_lost', 'Lead đã được note hoặc trả ở request khác');
    }
    await tx.note.create({
      data: {
        id: randomUUID(),
        orgId: lr.contact.orgId,
        contactId: lr.contactId,
        authorUserId: args.userId,
        body: `[Lead Pool] ${trimmed}`,
      },
    });
    await tx.contact.update({
      where: { id: lr.contactId },
      data: { lastActivity: now },
    });
  });

  return { ok: true };
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

  await prisma.$transaction(async (tx) => {
    // Conditional update — chỉ rollback nếu sale vẫn là current owner
    await tx.contact.updateMany({
      where: { id: lr.contactId, assignedUserId: args.userId },
      data: { assignedUserId: lr.previousAssigneeId },
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
    await prisma.$transaction(async (tx) => {
      await tx.contact.updateMany({
        where: { id: lr.contactId, assignedUserId: lr.requestedByUserId },
        data: { assignedUserId: lr.previousAssigneeId },
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
    // pool size: candidate count (approximate) via forgotten query
    prisma.$queryRawUnsafe<Array<{ cnt: number }>>(`
      SELECT COUNT(*)::INTEGER AS cnt FROM contacts c
      WHERE c.org_id = $1
        AND COALESCE(c.last_inbound_at, c.created_at) < NOW() - ($2 || ' days')::INTERVAL
        AND c.consent_status != 'revoked'
        AND c.merged_into IS NULL
        AND c.assigned_user_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM lead_requests lr
          WHERE lr.contact_id = c.id
            AND lr.note_submitted_at IS NULL AND lr.release_reason IS NULL AND lr.auto_returned_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM lead_requests lr2
          WHERE lr2.contact_id = c.id
            AND lr2.note_submitted_at IS NOT NULL
            AND lr2.note_submitted_at > NOW() - ($3 || ' days')::INTERVAL
            AND lr2.release_reason IS NULL
        )
    `, args.orgId, String(config.forgottenThresholdDays), String(config.cooldownAfterNoteDays)).then((r) => Number(r[0]?.cnt ?? 0)),

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
  const myStats = {
    requestedToday: myToday.length,
    remainingToday: Math.max(0, config.maxRequestsPerDay - myToday.length),
    noted: myToday.filter((r) => r.noteSubmittedAt !== null).length,
    pending: myToday.filter((r) => r.noteSubmittedAt === null && r.releaseReason === null).length,
    returned: myToday.filter((r) => r.releaseReason !== null).length,
    history: myToday.slice(0, 10).map((r) => ({
      id: r.id,
      contactName: r.contact?.crmName || r.contact?.fullName || r.contact?.phone || 'KH',
      requestedAt: r.requestedAt,
      noted: r.noteSubmittedAt !== null,
      returned: r.releaseReason !== null,
      source: r.source,
    })),
  };

  // ── Pool size (ai cũng xem được — giúp sale biết còn lead không) ──
  const thresholdDate = new Date(Date.now() - config.forgottenThresholdDays * 24 * 60 * 60 * 1000);
  const poolAvailable = await prisma.contact.count({
    where: {
      orgId: args.orgId,
      lastActivity: { lt: thresholdDate },
      status: { notIn: config.excludedStatuses },
      consentStatus: { not: 'revoked' },
      mergedInto: null,
      OR: [{ assignedUserId: null }, { assignedUserId: { not: args.userId } }],
    },
  });

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
      ? queryCustomerListPreview(args.orgId, args.userId, limit, config.cooldownAfterNoteDays)
      : Promise.resolve([] as PriorityCandidate[]),
  ]);

  const merged = [...forgottenList, ...customerListList].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, limit);
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

// Variant non-tx của queryCustomerListCandidates cho preview (không tạo stub).
async function queryCustomerListPreview(orgId: string, userId: string, limit = 50, cooldownDays = 30): Promise<PriorityCandidate[]> {
  // Phase v2.B 2026-05-29 — cùng cooldown rule như queryCustomerListCandidates.
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
      )
    ORDER BY days_in_list DESC
    LIMIT $3
    `,
    orgId, userId, limit, String(cooldownDays),
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

  const greetingTemplates = Array.isArray(config.greetingTemplates) ? (config.greetingTemplates as string[]) : [];
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
