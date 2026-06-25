// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * list-counter-refresh.ts — #2 (2026-06-20)
 *
 * Worker friend-invite lật `CustomerListEntry.hasZalo` (có/không Zalo) LIVE từng dòng,
 * NHƯNG không tự cập nhật ô đếm TỔNG của tệp (`CustomerList.hasZaloEntries/noZaloEntries`).
 * Trước đây tổng chỉ recompute lúc import/CRUD entry/sự-kiện-resolve → sau khi Mục tiêu chạy
 * ô tổng bị TRỄ.
 *
 * Module này cho worker gọi `scheduleListCounterRefresh(listId)` THROTTLE (fire-and-forget,
 * NGOÀI luồng gửi — không chặn, không làm fail send). Trong một đợt chạy dồn, các lần gọi gộp
 * lại còn 1 recompute mỗi REFRESH_DELAY_MS cho mỗi tệp. Đặt trễ > timeout HTTP Zalo (30s) để
 * recompute đọc sau khi hasZalo đã ghi xong.
 */
import { recomputeListCounters } from './list-entry-routes.js';
import { logger } from '../../shared/utils/logger.js';

const REFRESH_DELAY_MS = 35_000;
// Trailing throttle: listId đang chờ recompute → bỏ qua lần gọi trùng tới khi timer chạy.
const pending = new Set<string>();

export function scheduleListCounterRefresh(listId: string | null | undefined): void {
  if (!listId || pending.has(listId)) return;
  pending.add(listId);
  const t = setTimeout(() => {
    pending.delete(listId);
    recomputeListCounters(listId).catch((err) =>
      logger.warn({ err, listId }, '[list-refresh] recompute ô đếm tệp thất bại (bỏ qua)'),
    );
  }, REFRESH_DELAY_MS);
  // Không giữ process sống khi shutdown.
  (t as { unref?: () => void }).unref?.();
}
