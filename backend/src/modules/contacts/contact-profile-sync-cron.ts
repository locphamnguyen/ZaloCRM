// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * contact-profile-sync-cron.ts — Kéo giới tính + ngày sinh KH từ Zalo SDK (getUserInfo).
 *
 * Anh chốt 2026-06-06: cột 4 (ChatContactPanel) hiện trống gender/birthday vì KHÔNG có
 * đường bơm từ SDK cho KH ĐÃ TỒN TẠI (resolve-contact chỉ map gender lúc tạo stub mới,
 * bỏ qua ngày sinh hoàn toàn). getUserInfo verify CÓ trả gender (0/1) + sdob (DD/MM/YYYY)
 * + dob (timestamp giây).
 *
 * Cơ chế (Anh chốt): cron 24h/lần — KHÔNG 15 phút (50 nick × N KH getUserInfo mỗi 15'
 * = rate-limit, khoá nick). Mỗi ngày quét KH đang trống gender HOẶC birthDate, kéo từ
 * nick đang chăm, throttle giữa các KH.
 *
 * An toàn rate-limit:
 *  - Giới hạn MAX_PER_CYCLE KH/ngày (mặc định 200) → không bao giờ burst.
 *  - Throttle THROTTLE_MS giữa mỗi getUserInfo.
 *  - Chỉ KH đang TRỐNG (đã có gender+birthDate thì skip — không gọi lại).
 *  - Mutex chống overlap.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';

// 03:00 mỗi ngày (giờ VN) — khung thấp điểm. 2026-06-18: friend-sync nay backfill gender/dob
// HÀNG LOẠT từ getAllFriends mỗi lần nick connect (0 call SDK thêm) → cron chỉ còn VÉT ĐUÔI
// (KH không nằm trong friend list live). Nên trả về daily×200 cho nhẹ tải, bỏ bump 4h×400 cũ.
const CRON_SCHEDULE = '0 3 * * *';
const MAX_PER_CYCLE = 200;   // trần KH/ngày — throttle 1.5s/call chặn burst rate-limit Zalo
const THROTTLE_MS = 1500;    // nghỉ giữa mỗi getUserInfo

let cronRunning = false;
let cronTask: ReturnType<typeof cron.schedule> | null = null;

export function startContactProfileSyncCron(): void {
  if (cronTask) {
    logger.info('[contact-profile-sync] Already started, skipping');
    return;
  }
  cronTask = cron.schedule(CRON_SCHEDULE, async () => {
    if (cronRunning) {
      logger.warn('[contact-profile-sync] Previous cycle still running, skip tick');
      return;
    }
    cronRunning = true;
    const startedAt = Date.now();
    try {
      await runCycle();
    } catch (err) {
      logger.error('[contact-profile-sync] Cycle error:', err);
    } finally {
      cronRunning = false;
      logger.info(`[contact-profile-sync] Cycle done in ${Date.now() - startedAt}ms`);
    }
  }, { timezone: 'Asia/Ho_Chi_Minh' });
  logger.info(`[contact-profile-sync] Started, schedule="${CRON_SCHEDULE}" (Asia/Ho_Chi_Minh)`);
}

export function stopContactProfileSyncCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('[contact-profile-sync] Stopped');
  }
}

/** Parse ngày sinh từ SDK profile. sdob='DD/MM/YYYY' ưu tiên, fallback dob (timestamp giây/ms). */
export function parseBirthDate(sdob: unknown, dob: unknown): Date | null {
  // sdob: 'DD/MM/YYYY' (verify thực tế 2026-06-06: '02/07/2008')
  const s = String(sdob ?? '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Một số SDK trả sdob 'YYYY-MM-DD'
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // dob: timestamp — giây (10 chữ số) hoặc ms (13). Loại 0/giá trị rác.
  const ts = Number(dob ?? 0);
  if (ts && Number.isFinite(ts)) {
    const ms = ts > 10_000_000_000 ? ts : ts * 1000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    if (y >= 1900 && y <= 2100) return d;
  }
  return null;
}

/** Map gender SDK → Contact.gender. FIX 2026-06-08 (Anh báo + verify SDK live):
 *  Zalo trả 0=NAM(male), 1=NỮ(female). Memo cũ "0=female" SAI → cron sync đảo ngược
 *  gender. Đồng bộ với 4 file đúng (lead-pool/zinstant/profile-operations/chat-routes). */
// Export để friend-sync tái dùng (getAllFriends trả gender cùng shape getUserInfo).
export function mapGender(g: unknown): 'male' | 'female' | null {
  if (g === 0 || g === '0') return 'male';
  if (g === 1 || g === '1') return 'female';
  return null;
}

async function runCycle(): Promise<void> {
  // KH đang TRỐNG gender HOẶC birthDate, có nick đang chăm (friend với account connected).
  // zaloUidInNick là NOT NULL trong schema nên không cần filter null.
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [{ gender: null }, { birthDate: null }],
      friends: { some: { zaloAccount: { status: 'connected' } } },
    },
    select: {
      id: true, orgId: true, gender: true, genderLocked: true, birthDate: true,
      friends: {
        where: { zaloAccount: { status: 'connected' } },
        select: { zaloAccountId: true, zaloUidInNick: true },
        take: 1,
      },
    },
    take: MAX_PER_CYCLE,
  });

  if (!contacts.length) {
    logger.info('[contact-profile-sync] No contacts need profile enrichment');
    return;
  }
  logger.info(`[contact-profile-sync] ${contacts.length} contact(s) to enrich (cap ${MAX_PER_CYCLE})`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  for (const c of contacts) {
    const f = c.friends[0];
    if (!f?.zaloAccountId || !f.zaloUidInNick) { skipped++; continue; }
    try {
      const result = await zaloOps.getUserInfo(f.zaloAccountId, f.zaloUidInNick);
      const profiles = (result as { changed_profiles?: Record<string, unknown> })?.changed_profiles || {};
      const profile = (profiles[f.zaloUidInNick] || profiles[`${f.zaloUidInNick}_0`]) as Record<string, unknown> | undefined;
      if (!profile) { skipped++; continue; }

      const data: { gender?: string; birthDate?: Date } = {};
      // #2 2026-06-18: tôn trọng khoá — KH đã chỉnh tay (genderLocked) thì không điền/đè.
      if (c.gender == null && !c.genderLocked) {
        const g = mapGender(profile.gender);
        if (g) data.gender = g;
      }
      if (c.birthDate == null) {
        const bd = parseBirthDate(profile.sdob, profile.dob);
        if (bd) data.birthDate = bd;
      }
      if (Object.keys(data).length) {
        await prisma.contact.update({ where: { id: c.id }, data });
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors++;
      logger.debug(`[contact-profile-sync] getUserInfo failed for contact ${c.id}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  logger.info(`[contact-profile-sync] Cycle stats: updated=${updated} skipped=${skipped} errors=${errors}`);
}

/** Export cho test/manual trigger — chạy 1 cycle ngay, không chờ cron. */
export async function runContactProfileSyncNow(): Promise<void> {
  return runCycle();
}
