// Phase Wave 3 Wizard Bước 3 — Preview ETA service cho Mục tiêu Mời KB.
//
// Tham chiếu memory M51.2 (MEMORY-REVIEW-20260529.md):
//   - delayAvgMin = 30 phút (default, từ M51.3 D3)
//   - workingHours = 16h/ngày (6h-22h, từ M51.4 quy ước)
//   - perNickPerDay = (60 / 30) × 16 = 32 KB/ngày — delay là bottleneck, không phải cap 300
//   - systemPerDay = N × 32
//   - validateDays = hasZalo / systemPerDay
//   - finishKBDays = hasZalo / systemPerDay
//   - finishWelcomeDays = finishKB + 2h/24h (giả định 50% accept, delay accept 2h)
//   - finishSequenceDays = finishWelcome + Σ(step.delayMinutes) / (60×24)
//
// Endpoints (đăng ký trong friend-invite-routes.ts):
//   POST /api/v1/automation/triggers/preview
//   POST /api/v1/automation/muc-tieu/preview  (alias consistency với vocab UI)
//
// Cache: simple in-process Map TTL 60s. TODO: chuyển Redis khi có nhu cầu cross-instance.

import { createHash } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { normalizePhone } from '../../../shared/utils/phone.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants (M51.2 + M51.3 + M51.4)
// ─────────────────────────────────────────────────────────────────────────────
const WORKING_HOUR_START = 6;
const WORKING_HOUR_END = 22;
const WORKING_HOURS_PER_DAY = WORKING_HOUR_END - WORKING_HOUR_START; // 16
const DELAY_MIN_MIN = 20;
const DELAY_MAX_MIN = 40;
const DELAY_AVG_MIN = (DELAY_MIN_MIN + DELAY_MAX_MIN) / 2; // 30
const DAILY_FRIEND_CAP_DEFAULT = 300;
const DAILY_MESSAGE_CAP_DEFAULT = 300;
const ASSUMED_ACCEPT_RATE = 0.5;
const ASSUMED_ACCEPT_DELAY_HOURS = 2;
const DEFAULT_HAS_ZALO_RATE = 0.75; // fallback khi list mới chưa enrich

const CACHE_TTL_MS = 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface PreviewInput {
  orgId: string;
  customerListId: string;
  nickIds: string[];
  skipRules: {
    skipExistingChat?: boolean;
    skipAlreadyFriend?: boolean;
    skipNoZalo?: boolean;
    skipRecentActivityDays?: number;
  };
  sequenceId?: string | null;
  greetingTemplate?: string | null;
  welcomeMessageTemplate?: string | null;
  // Optional override để FE có thể slider delay (chưa dùng Wave 3, defer)
  delayAvgMinOverride?: number | null;
  // Optional sale name override khi FE muốn preview cho user khác (admin view-as)
  saleNameOverride?: string | null;
}

export interface EtaLine {
  days: number;
  label: string;
}

export interface NickDistributionEntry {
  nickId: string;
  displayName: string | null;
  assignedCount: number;
  dailyCap: number;
  isActive: boolean;
}

export interface SampleContactRendered {
  contactId: string | null;
  name: string;
  gender: string | null;
  rowIndex: number;
  nickAssigned: string | null;
  renderedMessages: {
    friendRequest: string;
    welcome: string | null;
    step1: string | null;
  };
}

export interface PreviewResponse {
  poolStats: {
    total: number;
    skipped: number;
    willRun: number;
    hasZalo: number;
    noZalo: number;
  };
  nickDistribution: NickDistributionEntry[];
  eta: {
    validateHasZalo: EtaLine;
    finishFriendInvite: EtaLine;
    finishWelcomeMessage: EtaLine;
    finishFullSequence: EtaLine;
  };
  constants: {
    workingHours: [number, number];
    delayMinMin: number;
    delayMaxMin: number;
    dailyFriendCap: number;
    dailyMessageCap: number;
    assumedAcceptRate: number;
    assumedAcceptDelayHours: number;
    systemThroughputPerDay: number;
  };
  sampleContacts: SampleContactRendered[];
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process cache (60s)
// ─────────────────────────────────────────────────────────────────────────────
interface CacheEntry {
  value: PreviewResponse;
  expiresAt: number;
}
const CACHE = new Map<string, CacheEntry>();

function makeCacheKey(input: PreviewInput): string {
  const stable = {
    orgId: input.orgId,
    customerListId: input.customerListId,
    nickIds: [...input.nickIds].sort(),
    skipRules: input.skipRules,
    sequenceId: input.sequenceId ?? null,
    greetingTemplate: input.greetingTemplate ?? null,
    welcomeMessageTemplate: input.welcomeMessageTemplate ?? null,
    delayAvgMinOverride: input.delayAvgMinOverride ?? null,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function readCache(key: string): PreviewResponse | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: PreviewResponse): void {
  CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Lazy prune (cap tránh leak nếu nhiều unique input)
  if (CACHE.size > 256) {
    const now = Date.now();
    for (const [k, v] of CACHE) if (v.expiresAt < now) CACHE.delete(k);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format ETA label theo M51.2 UI rules:
 *   < 1 ngày  → "~ X giờ" (round 1 decimal nếu < 10, else integer)
 *   ≥ 1 ngày  → "~ X.Y ngày" (1 decimal)
 *   ≥ 100 ngày → "~ X ngày" (integer cho gọn)
 */
export function formatEtaLabel(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '~ 0 giờ';
  if (days <= 0) return '~ 0 giờ';
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `~ ${minutes} phút`;
    }
    if (hours < 10) return `~ ${hours.toFixed(1)} giờ`;
    return `~ ${Math.round(hours)} giờ`;
  }
  if (days >= 100) return `~ ${Math.round(days)} ngày`;
  return `~ ${days.toFixed(1)} ngày`;
}

/**
 * Tách "last word" của full name → sale name (Phạm Chí Thành → Thành).
 * Per memory reference_greeting_template_vars.
 */
function extractSaleName(fullName: string | null | undefined): string {
  const t = (fullName ?? '').trim();
  if (!t) return 'em';
  const parts = t.split(/\s+/);
  return parts[parts.length - 1] || 'em';
}

/**
 * Render greeting template với 3 biến {gender} {name} {sale}.
 * Per memory reference_greeting_template_vars + nick-worker.ts inline render.
 */
function renderTemplate(
  template: string,
  vars: { gender: string; name: string; sale: string },
): string {
  return template
    .replaceAll('{gender}', vars.gender)
    .replaceAll('{name}', vars.name)
    .replaceAll('{sale}', vars.sale);
}

function genderToVi(gender: string | null | undefined): string {
  if (gender === 'female') return 'Chị';
  if (gender === 'male') return 'Anh';
  return 'Anh Chị';
}

/**
 * Đếm hasZalo trong list (cap 500 entry để không nặng query với list 100k+).
 * Trả về rate [0..1]. Nếu sample 0 hoặc tất cả null → fallback default.
 *
 * TODO defer: query toàn bộ via aggregate hoặc đọc từ customerList.hasZaloEntries
 * counter (đã cache, nhanh hơn — em đã thêm đường nhanh).
 */
async function estimateHasZaloRate(
  customerListId: string,
  totalEntries: number,
): Promise<{ rate: number; hasZaloEstimate: number; noZaloEstimate: number; source: string }> {
  // Đường nhanh: dùng counter sẵn có trên CustomerList model.
  const list = await prisma.customerList.findUnique({
    where: { id: customerListId },
    select: { hasZaloEntries: true, noZaloEntries: true, totalEntries: true },
  });
  if (list) {
    const resolved = list.hasZaloEntries + list.noZaloEntries;
    if (resolved > 0) {
      const rate = list.hasZaloEntries / resolved;
      const hasZaloEstimate = Math.round(totalEntries * rate);
      const noZaloEstimate = totalEntries - hasZaloEstimate;
      return { rate, hasZaloEstimate, noZaloEstimate, source: 'list_counter' };
    }
  }
  // Fallback: default 75% theo M51.2
  const rate = DEFAULT_HAS_ZALO_RATE;
  const hasZaloEstimate = Math.round(totalEntries * rate);
  const noZaloEstimate = totalEntries - hasZaloEstimate;
  return { rate, hasZaloEstimate, noZaloEstimate, source: 'default_assumption' };
}

/**
 * Cộng tổng delayMinutes của tất cả step trong Sequence.
 * steps shape (per sequences/types.ts): [{ stepId, blockId, delayMinutes, ... }]
 */
function sumSequenceDelayDays(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  let totalMinutes = 0;
  for (const step of steps) {
    if (step && typeof step === 'object' && 'delayMinutes' in step) {
      const dm = (step as { delayMinutes: unknown }).delayMinutes;
      if (typeof dm === 'number' && Number.isFinite(dm) && dm >= 0) {
        totalMinutes += dm;
      }
    }
  }
  return totalMinutes / (60 * 24);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export async function calculateMucTieuPreview(
  input: PreviewInput,
  options: { skipCache?: boolean; userId?: string | null } = {},
): Promise<PreviewResponse> {
  // 1. Cache check
  const cacheKey = makeCacheKey(input);
  if (!options.skipCache) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  } else {
    logger.warn('[preview-eta] cache disabled (computing fresh)');
  }

  // 2. Validate inputs
  if (!input.orgId) throw new Error('orgId_required');
  if (!input.customerListId) throw new Error('customerListId_required');
  if (!Array.isArray(input.nickIds) || input.nickIds.length === 0) {
    throw new Error('nickIds_required');
  }

  // 3. Load list + nicks + sequence in parallel
  const [list, nicks, sequence] = await Promise.all([
    prisma.customerList.findFirst({
      where: { id: input.customerListId, orgId: input.orgId },
      select: { id: true, totalEntries: true },
    }),
    prisma.zaloAccount.findMany({
      where: { id: { in: input.nickIds }, orgId: input.orgId },
      select: {
        id: true,
        displayName: true,
        status: true,
        dailyFriendAddCap: true,
        dailyStrangerMessageCap: true,
      },
    }),
    input.sequenceId
      ? prisma.automationSequence.findFirst({
          where: { id: input.sequenceId, orgId: input.orgId },
          select: { id: true, steps: true },
        })
      : Promise.resolve(null),
  ]);

  if (!list) throw new Error('customer_list_not_found');
  if (nicks.length === 0) throw new Error('no_valid_nicks');

  // 4. Pool stats
  const total = list.totalEntries;
  // Skipped chỉ tính theo skipNoZalo (skipExistingChat + skipAlreadyFriend cần query
  // sâu hơn, defer Ngày 5 polish — open issue đã ghi). Recency cũng defer.
  const { rate: hasZaloRate, hasZaloEstimate, noZaloEstimate, source } =
    await estimateHasZaloRate(input.customerListId, total);

  let skipped = 0;
  if (input.skipRules.skipNoZalo) skipped += noZaloEstimate;
  // Cap không vượt total
  if (skipped > total) skipped = total;
  const willRun = Math.max(0, total - skipped);

  // 5. ETA — công thức M51.2
  const N = nicks.length;
  const delayAvg = input.delayAvgMinOverride && input.delayAvgMinOverride > 0
    ? input.delayAvgMinOverride
    : DELAY_AVG_MIN;
  const perNickPerDay = (60 / delayAvg) * WORKING_HOURS_PER_DAY; // = 32 với default
  const systemPerDay = N * perNickPerDay;

  // Em fallback systemPerDay > 0 (đã check N > 0)
  const hasZaloCount = Math.min(hasZaloEstimate, willRun);
  const validateDays = systemPerDay > 0 ? hasZaloCount / systemPerDay : 0;
  const finishKBDays = validateDays;
  // Welcome = sau finishKB + 2h accept delay (chỉ accept rate × hasZalo có welcome thật,
  // nhưng ETA "hoàn thành" cứ cộng full 2h trễ accept cuối cùng — M51.2 viết "+ 2h / 24h")
  const finishWelcomeDays = finishKBDays + ASSUMED_ACCEPT_DELAY_HOURS / 24;
  const sequenceDelayDays = sequence ? sumSequenceDelayDays(sequence.steps) : 0;
  const finishSequenceDays = finishWelcomeDays + sequenceDelayDays;

  // 6. Nick distribution — round-robin chia đều willRun cho các nick active
  const activeNicks = nicks.filter((n) => n.status === 'connected');
  const distributionTargets = activeNicks.length > 0 ? activeNicks : nicks;
  const baseShare = Math.floor(willRun / distributionTargets.length);
  const remainder = willRun % distributionTargets.length;
  const nickDistribution: NickDistributionEntry[] = nicks.map((nick) => {
    const isTarget = distributionTargets.some((n) => n.id === nick.id);
    if (!isTarget) {
      return {
        nickId: nick.id,
        displayName: nick.displayName,
        assignedCount: 0,
        dailyCap: nick.dailyFriendAddCap ?? DAILY_FRIEND_CAP_DEFAULT,
        isActive: nick.status === 'connected',
      };
    }
    const idx = distributionTargets.findIndex((n) => n.id === nick.id);
    const assigned = baseShare + (idx < remainder ? 1 : 0);
    return {
      nickId: nick.id,
      displayName: nick.displayName,
      assignedCount: assigned,
      dailyCap: nick.dailyFriendAddCap ?? DAILY_FRIEND_CAP_DEFAULT,
      isActive: nick.status === 'connected',
    };
  });

  // 7. Sample contacts (3 KH random từ list, render greeting + welcome + step1)
  let saleName = 'em';
  if (input.saleNameOverride) {
    saleName = extractSaleName(input.saleNameOverride);
  } else if (options.userId) {
    const user = await prisma.user.findUnique({
      where: { id: options.userId },
      select: { fullName: true },
    });
    saleName = extractSaleName(user?.fullName);
  }

  const sampleEntries = await prisma.customerListEntry.findMany({
    where: { customerListId: input.customerListId, phoneValid: true },
    orderBy: { rowIndex: 'asc' },
    take: 3,
    select: {
      id: true,
      rowIndex: true,
      phoneE164: true,
      phoneLocal: true,
      phoneRaw: true,
      nameRaw: true,
      zaloName: true,
      contactId: true,
    },
  });

  // Lookup contacts để lấy gender — match qua phoneNormalized (84xxx) trong cùng org.
  const phoneCandidates = sampleEntries
    .map((e) => normalizePhone(e.phoneE164 ?? e.phoneLocal ?? e.phoneRaw))
    .filter((p): p is string => !!p);
  const contacts =
    phoneCandidates.length > 0
      ? await prisma.contact.findMany({
          where: {
            orgId: input.orgId,
            phoneNormalized: { in: phoneCandidates },
          },
          select: { id: true, phoneNormalized: true, fullName: true, gender: true },
        })
      : [];
  const contactByPhone = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    if (c.phoneNormalized) contactByPhone.set(c.phoneNormalized, c);
  }

  const greetingTpl =
    input.greetingTemplate?.trim() || 'Chào {gender} {name}, em là {sale}.';
  const welcomeTpl = input.welcomeMessageTemplate?.trim() || null;

  // Step1 = first sequence step block.bodyText if available (defer: chỉ render placeholder
  // nếu không lookup được content). Wave 3 mockup chỉ cần raw template — Bước 2 đã preview.
  const step1Tpl: string | null = null;

  const sampleContacts: SampleContactRendered[] = sampleEntries.map((entry, idx) => {
    const normalized = normalizePhone(entry.phoneE164 ?? entry.phoneLocal ?? entry.phoneRaw);
    const contact = normalized ? contactByPhone.get(normalized) ?? null : null;
    const displayName =
      entry.zaloName ?? contact?.fullName ?? entry.nameRaw ?? 'Khách hàng';
    const genderRaw = contact?.gender ?? null;
    const genderVi = genderToVi(genderRaw);
    const assignedNick = nickDistribution.find((n) => n.assignedCount > 0);
    return {
      contactId: contact?.id ?? entry.contactId ?? null,
      name: displayName,
      gender: genderRaw,
      rowIndex: entry.rowIndex,
      nickAssigned: assignedNick?.displayName ?? assignedNick?.nickId ?? null,
      renderedMessages: {
        friendRequest: renderTemplate(greetingTpl, {
          gender: genderVi,
          name: displayName,
          sale: saleName,
        }),
        welcome: welcomeTpl
          ? renderTemplate(welcomeTpl, {
              gender: genderVi,
              name: displayName,
              sale: saleName,
            })
          : null,
        step1: step1Tpl,
      },
    };
  });

  logger.info(
    `[preview-eta] list=${input.customerListId} N=${N} willRun=${willRun} hasZaloRate=${hasZaloRate.toFixed(2)}(${source}) etaFull=${finishSequenceDays.toFixed(1)}d`,
  );

  const response: PreviewResponse = {
    poolStats: {
      total,
      skipped,
      willRun,
      hasZalo: hasZaloEstimate,
      noZalo: noZaloEstimate,
    },
    nickDistribution,
    eta: {
      validateHasZalo: { days: validateDays, label: formatEtaLabel(validateDays) },
      finishFriendInvite: { days: finishKBDays, label: formatEtaLabel(finishKBDays) },
      finishWelcomeMessage: {
        days: finishWelcomeDays,
        label: formatEtaLabel(finishWelcomeDays),
      },
      finishFullSequence: {
        days: finishSequenceDays,
        label: formatEtaLabel(finishSequenceDays),
      },
    },
    constants: {
      workingHours: [WORKING_HOUR_START, WORKING_HOUR_END],
      delayMinMin: DELAY_MIN_MIN,
      delayMaxMin: DELAY_MAX_MIN,
      dailyFriendCap: DAILY_FRIEND_CAP_DEFAULT,
      dailyMessageCap: DAILY_MESSAGE_CAP_DEFAULT,
      assumedAcceptRate: ASSUMED_ACCEPT_RATE,
      assumedAcceptDelayHours: ASSUMED_ACCEPT_DELAY_HOURS,
      systemThroughputPerDay: systemPerDay,
    },
    sampleContacts,
  };

  writeCache(cacheKey, response);
  return response;
}
