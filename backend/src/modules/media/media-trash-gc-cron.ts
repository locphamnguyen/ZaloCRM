// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * media-trash-gc-cron.ts — GĐ13a (2026-06-13): tự dọn thùng rác Media sau 30 ngày.
 *
 * File sale "Xóa khỏi kho" → set archivedAt (vào thùng rác). Cron này mỗi đêm XÓA CỨNG
 * hàng DB (media_asset, cascade → media_blob + album_item + usage_event) của asset đã ở
 * thùng rác quá 30 ngày.
 *
 * ⚠️ INVARIANT (anh chốt D1): KHÔNG đụng byte MinIO. 33/36 blob kho dùng chung object với
 *    lịch sử chat (media/{hash}) → xóa byte = vỡ ảnh chat cũ. Cron CHỈ dọn danh mục DB.
 *
 * An toàn (D3 — mức kỹ nhất):
 *  - WHERE 2 điều kiện: archivedAt IS NOT NULL AND archivedAt < cutoff (chống đụng asset active).
 *  - Cap 500/đêm (lỡ sai cũng không xóa ạt; phần dư đêm sau dọn tiếp).
 *  - DRY-RUN mặc định BẬT (env MEDIA_TRASH_GC_DRYRUN != '0') → chỉ log, KHÔNG xóa. Đặt env='0'
 *    để bật xóa thật sau khi anh xem nhật ký vài đêm thấy đúng.
 *  - ORDER BY archivedAt asc, id asc → xác định, không starve hàng cũ.
 *  - withTenant per-org cho lệnh xóa (RLS/tenant context).
 *
 *   archivedAt set ──30 ngày──► cron 03:30 VN ──► DELETE media_asset row (DB)
 *                                                  cascade: blob + album_item + usage_event
 *                                                  ⚠️ byte MinIO GIỮ NGUYÊN
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { logger } from '../../shared/utils/logger.js';
import { TRASH_RETENTION_DAYS } from './media-routes.js';

const GC_BATCH_CAP = 500; // tối đa asset xóa mỗi lần chạy

function isDryRun(): boolean {
  // Mặc định DRY-RUN (an toàn). Chỉ tắt khi env đặt rõ '0'.
  return process.env.MEDIA_TRASH_GC_DRYRUN !== '0';
}

export function startMediaTrashGcCron(): void {
  // 20:30 UTC = 03:30 Vietnam time (UTC+7) — sau contact-profile-sync (03:00 VN), giờ thấp điểm.
  cron.schedule('30 20 * * *', async () => {
    logger.info(`[media-trash-gc] Bắt đầu dọn thùng rác Media (dryRun=${isDryRun()})...`);
    try {
      await runMediaTrashGc();
    } catch (err) {
      logger.error('[media-trash-gc] lỗi:', err);
    }
  });
  logger.info(`[media-trash-gc] Đã lên lịch dọn thùng rác hằng ngày (20:30 UTC / 03:30 VN, retention=${TRASH_RETENTION_DAYS}d, dryRun mặc định=BẬT)`);
}

/**
 * Quét asset đã ở thùng rác > retention, xóa cứng hàng DB (KHÔNG byte MinIO).
 * Trả số đã xóa (hoặc số "lẽ ra xóa" nếu dry-run) để test + log.
 */
export async function runMediaTrashGc(opts?: { dryRunOverride?: boolean; cap?: number }): Promise<{
  scanned: number; deleted: number; dryRun: boolean; byOrg: Record<string, number>;
}> {
  const dryRun = opts?.dryRunOverride ?? isDryRun();
  const cap = opts?.cap ?? GC_BATCH_CAP;
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Quét toàn hệ (global) — chỉ asset ĐANG trong thùng rác QUÁ hạn. archivedAt IS NOT NULL
  // là chốt chống đụng asset active (archivedAt null KHÔNG khớp { lt: cutoff }).
  const victims = await prisma.mediaAsset.findMany({
    where: { archivedAt: { not: null, lt: cutoff } },
    select: { id: true, orgId: true, name: true, archivedAt: true },
    orderBy: [{ archivedAt: 'asc' }, { id: 'asc' }],
    take: cap,
  });

  if (victims.length === 0) {
    logger.info('[media-trash-gc] Không có asset nào quá hạn — bỏ qua.');
    return { scanned: 0, deleted: 0, dryRun, byOrg: {} };
  }

  // Gom theo org để xóa trong tenant context (RLS).
  const byOrgIds: Record<string, string[]> = {};
  for (const v of victims) (byOrgIds[v.orgId] ??= []).push(v.id);

  if (dryRun) {
    const ids = victims.map((v) => v.id).join(', ');
    logger.warn(`[media-trash-gc][DRY-RUN] LẼ RA xóa ${victims.length} asset (KHÔNG xóa thật vì dry-run). orgs=${Object.keys(byOrgIds).length}. ids=[${ids}]`);
    const byOrg: Record<string, number> = {};
    for (const [oid, list] of Object.entries(byOrgIds)) byOrg[oid] = list.length;
    return { scanned: victims.length, deleted: 0, dryRun: true, byOrg };
  }

  let deleted = 0;
  const byOrg: Record<string, number> = {};
  for (const [orgId, ids] of Object.entries(byOrgIds)) {
    const n = await withTenant(orgId, async () => {
      // Cascade Prisma: xóa media_asset → media_blob + media_album_item + media_usage_event tự xóa.
      // KHÔNG gọi MinIO removeObject — byte giữ nguyên cho lịch sử chat.
      const res = await prisma.mediaAsset.deleteMany({ where: { id: { in: ids } } });
      return res.count;
    });
    byOrg[orgId] = n;
    deleted += n;
  }
  logger.info(`[media-trash-gc] Đã xóa ${deleted} asset khỏi DB (byte MinIO GIỮ). orgs=${Object.keys(byOrg).length}.`);
  return { scanned: victims.length, deleted, dryRun: false, byOrg };
}
