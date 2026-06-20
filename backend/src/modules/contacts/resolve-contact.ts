// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// Wave 1.5-B — Canonical resolveOrCreateContact helper.
//
// Anh chốt 2026-05-29: "UID không khớp được. Chỉ khớp duy nhất 2 tham số global_id và phone."
//
// Resolution order (per design doc Section 5 P4):
//   1. If known entry.contactId → return (no-op, caller's responsibility)
//   2. Friend reverse-lookup by (zaloAccountId, zaloUidInNick) — composite key,
//      safe because we trust friend-sync's prior canonical resolution
//   3. Contact lookup by zaloGlobalId (cross-nick canonical identity from Zalo SDK)
//   4. Contact lookup by zaloUsername (legacy/parallel identity)
//   5. Contact lookup by phoneNormalized (alive only — mergedInto IS NULL)
//   6. INSERT ON CONFLICT (orgId, phoneNormalized) WHERE merged_into IS NULL DO NOTHING
//      — race-safe stub creation. Stub gets NO zaloUid (per anh rule + Q5 anti-pattern)
//
// Spec: ~/.gstack/projects/zalocrm/EVO-THANH-private-hs-design-friend-invite-flow-review-20260529.md
//
// NOT used:
//   - Contact.zaloUid global lookup (anti-pattern per memory reference_zalo_per_account_uid.md —
//     per-account UID can differ for same person across nicks). Removed from this helper.
//     Existing call sites (friend-sync-service:306, friend-event-handler:99) keep their
//     own fallback for backward-compat; new code MUST use this helper.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { zaloOps } from '../../shared/zalo-operations.js';

const ENRICH_CACHE_TTL_MS = 5 * 60 * 1000;
const enrichCache = new Map<string, { profile: any; expiresAt: number }>();

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`getUserInfo timeout ${ms}ms`)), ms));
}

export interface ResolveContactInput {
  orgId: string;
  /** Optional: hint from Friend table. If provided, used for reverse-lookup before identity match. */
  zaloAccountId?: string | null;
  zaloUidInNick?: string | null;
  /** Optional: identity fields. If provided, used for cross-nick canonical match. */
  zaloGlobalId?: string | null;
  zaloUsername?: string | null;
  /** Optional: phone. Will be normalized via shared/utils/phone.normalizePhone. */
  phone?: string | null;
  phoneNormalized?: string | null;
  /** Stub creation fallback values (used only when no canonical match found). */
  fallbackFullName?: string | null;
  fallbackAvatarUrl?: string | null;
  /** Gender from Zalo profile (female/male) — persist to Contact.gender khi stub create. */
  gender?: 'female' | 'male' | null;
  /**
   * If true AND we have (zaloAccountId, zaloUidInNick) AND lookup-by-friend miss,
   * call zaloOps.getUserInfo(uid) to pull canonical profile (globalId/username/phone/avatar)
   * BEFORE creating stub. Mirrors logic of friend-event-handler.resolveContact.
   * Default FALSE (Wave 1.5-D safety: prevent enrichment storm)
   */
  enrichViaGetUserInfo?: boolean;
}

export interface ResolveContactResult {
  id: string;
  orgId: string;
  /** True if this call created a new stub Contact (caller should flag for reconciliation). */
  created: boolean;
  /** Source of the match — useful for logging + metrics. */
  matchedVia: 'existing' | 'friend' | 'globalId' | 'username' | 'phone' | 'stub' | 'race';
}

/**
 * Canonical Contact resolver. Use this from any code path that needs to bind a
 * phone/uid/displayName to a Contact row. Avoids creating duplicates by going
 * through the rule-correct lookup order.
 */
export async function resolveOrCreateContact(input: ResolveContactInput): Promise<ResolveContactResult> {
  const { orgId } = input;

  // Normalize phone once
  let phoneNormalized = input.phoneNormalized || (input.phone ? normalizePhone(input.phone) : null);

  // Mutable enrichment vars — start with caller-provided values, may be filled by getUserInfo
  let enrichedGlobalId = input.zaloGlobalId ?? null;
  let enrichedUsername = input.zaloUsername ?? null;
  let enrichedAvatarUrl = input.fallbackAvatarUrl ?? null;
  let enrichedFullName = input.fallbackFullName ?? null;
  let enrichedGender = input.gender ?? null;
  let enrichedPhone = input.phone ?? null;

  // Step 1 (skipped — caller passes entry.contactId already; not part of this helper)

  // Step 2: Friend reverse-lookup (composite key, safe)
  if (input.zaloAccountId && input.zaloUidInNick) {
    const friend = await prisma.friend.findFirst({
      where: { zaloAccountId: input.zaloAccountId, zaloUidInNick: input.zaloUidInNick },
      select: { contactId: true, contact: { select: { id: true, orgId: true, mergedInto: true } } },
    });
    if (friend?.contact) {
      const canonical = await followMergedInto(friend.contact.id);
      return { id: canonical.id, orgId: canonical.orgId, created: false, matchedVia: 'friend' };
    }
  }

  // Step 2.5: Enrich via getUserInfo BEFORE checking globalId/username/phone lookups.
  // Mirrors friend-event-handler.resolveContact pattern — pulls canonical identity
  // from Zalo SDK so we can match existing Contact instead of creating duplicate stub.
  const shouldEnrich = (input.enrichViaGetUserInfo ?? false)
    && input.zaloAccountId
    && input.zaloUidInNick
    && (!enrichedGlobalId || !enrichedUsername || !enrichedAvatarUrl);

  if (shouldEnrich) {
    try {
      const cacheKey = `${input.zaloAccountId}:${input.zaloUidInNick}`;
      const now = Date.now();
      let profile: any = null;
      const cached = enrichCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        profile = cached.profile;
      } else {
        const raw: any = await Promise.race([
          zaloOps.getUserInfo(input.zaloAccountId!, input.zaloUidInNick!),
          timeoutPromise(8000),
        ]);
        const profiles = raw?.changed_profiles || {};
        profile = profiles[input.zaloUidInNick!] || profiles[`${input.zaloUidInNick}_0`];
        if (profile) {
          enrichCache.set(cacheKey, { profile, expiresAt: now + ENRICH_CACHE_TTL_MS });
        }
      }
      if (profile) {
        enrichedGlobalId = enrichedGlobalId || (String(profile.globalId || '').trim() || null);
        enrichedUsername = enrichedUsername || (String(profile.username || '').trim() || null);
        enrichedAvatarUrl = enrichedAvatarUrl || ((profile.avatar as string | undefined)?.trim() || null);
        enrichedFullName = enrichedFullName || ((profile.zaloName || profile.displayName || '') as string).trim() || null;
        enrichedPhone = enrichedPhone || (String(profile.phoneNumber || '').trim() || null);
        // FIX 2026-06-08 (Anh báo + verify SDK live): Zalo SDK trả 0=NAM(male), 1=NỮ(female).
        // Code cũ map NGƯỢC (0=female,1=male) → Phú Hoàng (SDK gender=0, verify NAM) bị ghi
        // 'female'. Verify: GET /zalo-user-info/325149116391297339 → gender=0, là Phú=Nam.
        // 4 file khác (lead-pool/zinstant/profile-operations/chat-routes) đã đúng 0=male.
        if (enrichedGender == null) {
          const g = profile.gender;
          if (g === 0 || g === '0' || g === 'male') enrichedGender = 'male';
          else if (g === 1 || g === '1' || g === 'female') enrichedGender = 'female';
        }
        // Refresh phoneNormalized if we now have phone từ Zalo
        if (!phoneNormalized && enrichedPhone) {
          phoneNormalized = normalizePhone(enrichedPhone);
        }
      }
    } catch (err) {
      logger.debug(`[resolve-contact] getUserInfo(${input.zaloUidInNick}) failed:`, err);
    }
  }

  // Step 3: Contact by zaloGlobalId (cross-nick canonical) — use enrichedGlobalId
  if (enrichedGlobalId) {
    const byGlobalId = await prisma.contact.findFirst({
      where: { orgId, zaloGlobalId: enrichedGlobalId },
      select: { id: true, orgId: true, mergedInto: true },
    });
    if (byGlobalId) {
      const canonical = await followMergedInto(byGlobalId.id);
      return { id: canonical.id, orgId: canonical.orgId, created: false, matchedVia: 'globalId' };
    }
  }

  // Step 4: ĐÃ BỎ match theo zaloUsername (anh chốt 2026-06-16).
  // Zalo trả username placeholder KHÔNG duy nhất (vd 't_ggzbdcmi80' bị 55 contact dùng
  // chung) → match theo username nối Friend mới vào Contact Cha SAI ngay tại điểm tạo,
  // ngoài cả duplicate-detector. Username vẫn được LƯU vào contact (để tham khảo/hiển
  // thị) nhưng KHÔNG còn là khóa tra cứu gộp. Chỉ match theo globalId (Step 3) + phone
  // (Step 5). Xem docs/DESIGN-DEDUPE-BANNER-TRONG-CHAT-20260616.md.

  // Step 5: Contact by phoneNormalized (alive only)
  if (phoneNormalized) {
    const byPhone = await prisma.contact.findFirst({
      where: { orgId, phoneNormalized, mergedInto: null },
      select: { id: true, orgId: true },
    });
    if (byPhone) {
      return { id: byPhone.id, orgId: byPhone.orgId, created: false, matchedVia: 'phone' };
    }
  }

  // Step 6: Race-safe stub creation via INSERT ON CONFLICT
  // - Per anh rule: stub KHÔNG lưu zalo_uid (per-account UID re-introduces anti-pattern).
  // - Stub lưu globalId/username/gender/avatar enriched từ getUserInfo Step 2.5
  //   (mirrors friend-event-handler.resolveContact behavior).
  // - Partial unique index on (orgId, phoneNormalized) WHERE merged_into IS NULL guards race.
  const stubId = randomUUID();
  const fullName = enrichedFullName?.trim() || 'KH chưa rõ';
  const avatarUrl = enrichedAvatarUrl?.trim() || null;
  const stubPhone = enrichedPhone || phoneNormalized;
  const stubGender = enrichedGender || null;

  if (phoneNormalized) {
    // Use ON CONFLICT — if another worker raced ahead, returns existing row
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO contacts (id, org_id, full_name, phone, phone_normalized, zalo_global_id, zalo_username, avatar_url, gender, has_zalo, status, updated_at, created_at)
      VALUES (
        ${stubId}::text,
        ${orgId}::text,
        ${fullName}::text,
        ${stubPhone}::text,
        ${phoneNormalized}::text,
        ${enrichedGlobalId || null}::text,
        ${enrichedUsername || null}::text,
        ${avatarUrl}::text,
        ${stubGender}::text,
        ${input.zaloUidInNick ? true : null}::boolean,
        'new',
        NOW(),
        NOW()
      )
      -- FIX 2026-06-08: WHERE phải KHỚP CHÍNH XÁC partial unique index
      -- contacts_org_phone_normalized_alive_unique = (org_id, phone_normalized)
      -- WHERE (merged_into IS NULL AND phone_normalized IS NOT NULL). Trước đây thiếu
      -- "AND phone_normalized IS NOT NULL" → Postgres báo 42P10 "no unique constraint
      -- matching ON CONFLICT" → INSERT throw MỌI LẦN cho KH chưa có contact → entry kẹt
      -- processing → sweeper cứu 10 lần → failed_stuck. Đây là gốc throughput thấp +
      -- "khách độc làm worker xoay vòng".
      ON CONFLICT (org_id, phone_normalized) WHERE merged_into IS NULL AND phone_normalized IS NOT NULL
      DO NOTHING
      RETURNING id
    `;
    if (rows.length > 0) {
      logger.info(`[resolve-contact] stub created id=${rows[0].id} phone=${phoneNormalized} fullName="${fullName}" matchedVia=stub`);
      return { id: rows[0].id, orgId, created: true, matchedVia: 'stub' };
    }
    // Race lost — another worker just inserted. Re-fetch.
    const winner = await prisma.contact.findFirst({
      where: { orgId, phoneNormalized, mergedInto: null },
      select: { id: true, orgId: true },
    });
    if (winner) {
      logger.info(`[resolve-contact] race lost — using existing id=${winner.id} phone=${phoneNormalized} matchedVia=race`);
      return { id: winner.id, orgId: winner.orgId, created: false, matchedVia: 'race' };
    }
    // Should not reach here. Falls through to create-without-phone path.
    logger.warn(`[resolve-contact] ON CONFLICT returned 0 rows AND re-fetch found nothing for phone=${phoneNormalized} — falling back to no-phone stub`);
  }

  // No phone → plain insert (race acceptable, no unique constraint)
  const created = await prisma.contact.create({
    data: {
      id: stubId,
      orgId,
      fullName,
      phone: enrichedPhone || null,
      phoneNormalized: null,
      zaloGlobalId: enrichedGlobalId || null,
      zaloUsername: enrichedUsername || null,
      avatarUrl,
      gender: stubGender,
      hasZalo: input.zaloUidInNick ? true : null,
      status: 'new',
    },
    select: { id: true, orgId: true },
  });
  logger.info(`[resolve-contact] stub created (no phone) id=${created.id} fullName="${fullName}" matchedVia=stub`);
  return { id: created.id, orgId: created.orgId, created: true, matchedVia: 'stub' };
}

/**
 * Walk mergedInto chain to find the alive root Contact. Bounded depth=5 to
 * avoid infinite loops on cyclic data.
 */
export async function followMergedInto(contactId: string): Promise<{ id: string; orgId: string }> {
  let currentId = contactId;
  for (let depth = 0; depth < 5; depth++) {
    const row = await prisma.contact.findUnique({
      where: { id: currentId },
      select: { id: true, orgId: true, mergedInto: true },
    });
    if (!row) {
      logger.warn(`[resolve-contact] followMergedInto: contact ${currentId} not found mid-chain (depth=${depth})`);
      return { id: contactId, orgId: '' };
    }
    if (!row.mergedInto) return { id: row.id, orgId: row.orgId };
    currentId = row.mergedInto;
  }
  logger.warn(`[resolve-contact] followMergedInto: chain depth >5 starting from ${contactId} — possible cycle, returning current`);
  return { id: currentId, orgId: '' };
}
