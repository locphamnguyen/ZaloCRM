// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-profile-capture.ts — NGUỒN CHÂN LÝ lưu hồ sơ Zalo (SDK → Friend + Contact). Đợt 1 của
 * plans/zalo-sdk-data-capture-audit-20260622.md (anh chốt + eng-review 2026-06-22).
 *
 * Gốc bug: ~13 điểm gọi SDK, mỗi điểm tự lấy vài trường → data Zalo cho-sẵn (tên/giới tính/
 * ngày sinh/avatar/globalId/username/SĐT công khai) rớt lúc-có-lúc-không. Mọi đường nay chuẩn-hoá
 * profile rồi gọi captureZaloProfile → 1 chỗ lưu đủ, nhất quán.
 *
 * AN TOÀN (theo review):
 *  - Hàm chung nhận profile ĐÃ chuẩn-hoá (3 adapter unwrap shape SDK riêng — getUserInfo lồng /
 *    getAllFriends phẳng / findUser phẳng-không-dob).
 *  - fill-KHÔNG-đè: chỉ điền field trống; KHÔNG đè giá trị sale sửa tay (full_name đã có,
 *    gender khi gender_locked). diff: chỉ ghi khi thực đổi.
 *  - globalId vào Contact qua guard NOT-EXISTS (chống P2002 trên @@unique(org, zalo_global_id)
 *    → chống tái-sinh bug DROP tin). Tái dùng đúng guard của friend-sync-service.
 *  - Không throw (best-effort) — lỗi capture không được làm hỏng luồng chính.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { mapGender, parseBirthDate } from './contact-profile-sync-cron.js';

export interface NormalizedZaloProfile {
  uid: string;
  zaloName?: string | null;
  avatar?: string | null;
  globalId?: string | null;
  username?: string | null;
  gender?: unknown;          // raw 0/1 từ SDK
  sdob?: unknown;            // 'DD/MM/YYYY' | 'YYYY-MM-DD'
  dob?: unknown;             // timestamp giây/ms
  phoneNumber?: string | null; // SĐT công khai (chỉ có khi KH bật công khai)
}

const pick = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

// ── 3 ADAPTER: unwrap shape SDK → NormalizedZaloProfile ─────────────────────

/** getUserInfo → result.changed_profiles[uid] | [uid+'_0'] (shape lồng). */
export function fromGetUserInfo(result: unknown, uid: string): NormalizedZaloProfile | null {
  const profiles = (result as { changed_profiles?: Record<string, unknown> })?.changed_profiles || {};
  const p = (profiles[uid] || profiles[`${uid}_0`]) as Record<string, unknown> | undefined;
  if (!p) return null;
  return {
    uid,
    zaloName: pick(p.zaloName ?? p.zalo_name ?? p.displayName ?? p.display_name),
    avatar: pick(p.avatar),
    globalId: pick(p.globalId),
    username: pick(p.username),
    gender: p.gender ?? null,
    sdob: p.sdob ?? null, dob: p.dob ?? null,
    phoneNumber: pick(p.phoneNumber),
  };
}

/** getAllFriends → object phẳng (mảng). */
export function fromGetAllFriends(raw: Record<string, unknown>): NormalizedZaloProfile | null {
  const uid = String((raw.userId ?? raw.uid ?? '') as string).trim();
  if (!uid) return null;
  return {
    uid,
    zaloName: pick(raw.zaloName ?? raw.displayName ?? raw.display_name),
    avatar: pick(raw.avatar),
    globalId: pick(raw.globalId),
    username: pick(raw.username),
    gender: raw.gender ?? null,
    sdob: raw.sdob ?? null, dob: raw.dob ?? null,
    phoneNumber: pick(raw.phoneNumber),
  };
}

/** findUser → phẳng. Tên ở snake_case lúc runtime (display_name/zalo_name). Thường KHÔNG có dob. */
export function fromFindUser(raw: unknown): NormalizedZaloProfile | null {
  const p = (raw as Record<string, unknown>) || {};
  const uid = String((p.uid ?? p.userId ?? '') as string).trim();
  if (!uid) return null;
  return {
    uid,
    zaloName: pick(p.display_name ?? p.zalo_name ?? p.displayName ?? p.zaloName),
    avatar: pick(p.avatar),
    globalId: pick(p.globalId),
    username: pick(p.username),
    gender: p.gender ?? null,
    sdob: p.sdob ?? null, dob: p.dob ?? null,    // findUser thường ko có dob → null
    phoneNumber: pick(p.phoneNumber),
  };
}

// ── CAPTURE ─────────────────────────────────────────────────────────────────

/**
 * Lưu profile vào Friend (per-nick) + Contact (cấp người). Best-effort, không throw.
 * contactId null → tự suy từ Friend row (nick, uid); vẫn null → bỏ phần Contact.
 */
export async function captureZaloProfile(
  p: NormalizedZaloProfile | null,
  ctx: { orgId: string; contactId: string | null; nickId: string },
): Promise<void> {
  if (!p || !p.uid) return;
  const { orgId, nickId } = ctx;
  try {
    // 1. FRIEND (per-nick) — fill-không-đè + diff. Khoá (nick, uid).
    const friend = await prisma.friend.findFirst({
      where: { zaloAccountId: nickId, zaloUidInNick: p.uid },
      select: { id: true, contactId: true, zaloDisplayName: true, zaloAvatarUrl: true, zaloGlobalId: true, zaloUsername: true },
    });
    const cid = ctx.contactId ?? friend?.contactId ?? null;
    if (friend) {
      const patch: Record<string, string> = {};
      if (p.zaloName && !friend.zaloDisplayName) patch.zaloDisplayName = p.zaloName;
      if (p.avatar && !friend.zaloAvatarUrl) patch.zaloAvatarUrl = p.avatar;
      if (p.globalId && !friend.zaloGlobalId) patch.zaloGlobalId = p.globalId;
      if (p.username && !friend.zaloUsername) patch.zaloUsername = p.username;
      if (Object.keys(patch).length) await prisma.friend.update({ where: { id: friend.id }, data: patch });
    }
    if (!cid) return;

    // 2. CONTACT name/globalId(guard P2002)/username/avatar — backfill từ Friend rows của contact.
    //    Tái dùng guard NOT-EXISTS của friend-sync-service, scoped 1 contact.
    await prisma.$executeRaw`
      UPDATE contacts SET
        full_name = COALESCE(NULLIF(NULLIF(contacts.full_name, ''), 'Unknown'), sub.f_name, contacts.full_name),
        zalo_global_id = CASE
          WHEN (contacts.zalo_global_id IS NULL OR contacts.zalo_global_id = '') AND sub.f_global_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM contacts c2
              WHERE c2.org_id = contacts.org_id AND c2.id <> contacts.id AND c2.zalo_global_id = sub.f_global_id
            )
          THEN sub.f_global_id ELSE contacts.zalo_global_id END,
        zalo_username = COALESCE(contacts.zalo_username, sub.f_username),
        avatar_url = COALESCE(contacts.avatar_url, sub.f_avatar),
        has_zalo = TRUE
      FROM (
        SELECT DISTINCT ON (f.contact_id)
          f.contact_id, f.zalo_display_name AS f_name, f.zalo_global_id AS f_global_id,
          f.zalo_username AS f_username, f.zalo_avatar_url AS f_avatar
        FROM friends f
        WHERE f.contact_id = ${cid}
          AND (f.zalo_display_name IS NOT NULL AND f.zalo_display_name <> '' AND f.zalo_display_name <> 'Unknown'
            OR f.zalo_global_id IS NOT NULL AND f.zalo_global_id <> ''
            OR f.zalo_username IS NOT NULL AND f.zalo_username <> ''
            OR f.zalo_avatar_url IS NOT NULL AND f.zalo_avatar_url <> '')
        ORDER BY f.contact_id, f.updated_at DESC
      ) sub
      WHERE contacts.id = sub.contact_id AND contacts.org_id = ${orgId}`;

    // 3. CONTACT demographic (gender !locked null-only, birthDate null-only) + SĐT công khai.
    const c = await prisma.contact.findUnique({
      where: { id: cid },
      select: {
        gender: true, genderLocked: true, birthDate: true,
        phone: true, phone2: true, phone3: true, phonesExtra: true, metadata: true,
      },
    });
    if (!c) return;
    const data: Record<string, unknown> = {};
    if (c.gender == null && !c.genderLocked) { const g = mapGender(p.gender); if (g) data.gender = g; }
    if (c.birthDate == null) {
      const bd = parseBirthDate(p.sdob, p.dob);
      if (bd) { data.birthDate = bd; data.birthYear = bd.getUTCFullYear(); }
    }

    // 3b. SĐT công khai → phone (nếu KH chưa có số nào) → phone2 → phone3 → phonesExtra.
    //     Chống trùng (normalize so), KHÔNG đè phone chính, ghi PROVENANCE vào metadata
    //     (số Zalo CHƯA verify — sale tự xác minh). Anh chốt + review điểm 5.
    const zNorm = normalizePhone(p.phoneNumber ?? '');
    if (zNorm) {
      const extra = Array.isArray(c.phonesExtra) ? (c.phonesExtra as Array<{ phone?: string }>) : [];
      const have = new Set(
        [c.phone, c.phone2, c.phone3, ...extra.map((x) => x?.phone)]
          .map((x) => normalizePhone(x ?? '')).filter(Boolean) as string[],
      );
      if (!have.has(zNorm)) {
        const rawPhone = (p.phoneNumber ?? '').trim() || zNorm;
        if (!c.phone) { data.phone = rawPhone; data.phoneNormalized = zNorm; }
        else if (!c.phone2) data.phone2 = rawPhone;
        else if (!c.phone3) data.phone3 = rawPhone;
        else data.phonesExtra = [...extra, { phone: rawPhone, label: 'zalo_public' }];
        // Provenance: đánh dấu số này nguồn Zalo công khai (chưa verify), bất kể vào ô nào.
        const meta = (c.metadata && typeof c.metadata === 'object' ? c.metadata : {}) as Record<string, unknown>;
        const zpub = Array.isArray(meta.zaloPublicPhones) ? (meta.zaloPublicPhones as string[]) : [];
        if (!zpub.includes(zNorm)) data.metadata = { ...meta, zaloPublicPhones: [...zpub, zNorm] };
      }
    }

    if (Object.keys(data).length) await prisma.contact.update({ where: { id: cid }, data });
  } catch (err) {
    logger.warn(`[zalo-capture] best-effort failed nick=${nickId} contact=${ctx.contactId} uid=${p.uid}: ${(err as Error)?.message}`);
  }
}
