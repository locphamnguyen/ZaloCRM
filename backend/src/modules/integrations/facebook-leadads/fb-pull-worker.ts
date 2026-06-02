/**
 * fb-pull-worker.ts — Cron kéo lead Facebook định kỳ (anh chốt 3 phút 2026-05-30).
 *
 * Pattern setInterval + busy-lock (giống outbox-worker.ts). Chỉ chạy khi có Org bật
 * fbPullEnabled. Lần đầu mỗi form kéo toàn bộ lead lịch sử, sau đó incremental.
 */
import { logger } from '../../../shared/utils/logger.js';
import { runFbPullTick } from './fb-pull-service.js';

const PULL_INTERVAL_MS = 3 * 60 * 1000; // 3 phút (anh chốt 2-3 phút)

let timer: ReturnType<typeof setInterval> | null = null;
let isPulling = false;

export function startFbPullWorker(): void {
  if (timer) {
    logger.warn('[fb-pull] worker đã chạy');
    return;
  }
  timer = setInterval(() => { void tick(); }, PULL_INTERVAL_MS);
  void tick(); // chạy ngay khi boot
  logger.info('[fb-pull] worker started (mỗi 3 phút)');
}

export function stopFbPullWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('[fb-pull] worker stopped');
  }
}

async function tick(): Promise<void> {
  if (isPulling) return; // chống tick chồng (form 411 lead có thể kéo lâu)
  isPulling = true;
  try {
    await runFbPullTick();
  } catch (err) {
    logger.error('[fb-pull] tick error:', err);
  } finally {
    isPulling = false;
  }
}
