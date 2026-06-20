// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * contact-intelligence.ts — Cron wrapper for daily contact intelligence.
 * Runs lead scoring at 02:30 UTC (09:30 Vietnam time).
 *
 * Anh chốt 2026-06-16: TÁCH detectDuplicates khỏi pipeline TỰ ĐỘNG. Trước đây cron
 * gọi detectDuplicates() mỗi đêm → tự gộp loạn contact (qua khối tên/username đã bỏ).
 * Giờ cron CHỈ chạy chấm điểm lead. Việc dò-gộp trùng chỉ chạy KHI gọi thủ công
 * (runContactIntelligence / endpoint admin) — và bản thân detectDuplicates đã được
 * siết chỉ gộp globalId+phone. Xem docs/DESIGN-DEDUPE-BANNER-TRONG-CHAT-20260616.md.
 */
import cron from 'node-cron';
import { logger } from '../../shared/utils/logger.js';
import { detectDuplicates } from './duplicate-detector.js';
import { computeAllLeadScores } from './lead-scoring.js';

// Cron tự động: CHỈ chấm điểm lead, KHÔNG dò-gộp trùng.
async function runScheduledPipeline(): Promise<void> {
  await computeAllLeadScores();
}

// Chạy thủ công (endpoint admin / backfill): vẫn cho dò-gộp trùng (đã siết
// chỉ globalId+phone) + chấm điểm lead.
async function runFullPipeline(): Promise<void> {
  await detectDuplicates();
  await computeAllLeadScores();
}

export function startContactIntelligence(): void {
  // 02:30 UTC = 09:30 Vietnam time (UTC+7)
  cron.schedule('30 2 * * *', async () => {
    logger.info('[intelligence] Starting scheduled lead-scoring cron (no auto-dedupe)...');
    try {
      await runScheduledPipeline();
      logger.info('[intelligence] Scheduled cron completed');
    } catch (err) {
      logger.error('[intelligence] Cron error:', err);
    }
  });
  logger.info('[intelligence] Contact intelligence cron started (daily 02:30 UTC — lead scoring only)');
}

export async function runContactIntelligence(): Promise<void> {
  logger.info('[intelligence] Manual run started (full: dedupe + lead scoring)...');
  await runFullPipeline();
  logger.info('[intelligence] Manual run completed');
}
