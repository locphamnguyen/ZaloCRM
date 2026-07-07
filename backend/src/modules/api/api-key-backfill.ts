// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Huỳnh Ngọc Thuận — Community extension
/**
 * api-key-backfill.ts — P2 (H1): chuyển public_api_key cũ (lưu plaintext) sang hash.
 *
 * Chạy 1 lần lúc startup, idempotent: với mỗi row public_api_key còn thiếu valueHash,
 * hash value_plain → ghi valueHash, rồi redact value_plain thành hint đã mask (xoá key
 * thật khỏi DB at-rest). Cross-org → runSystemQuery. Row đã có valueHash → bỏ qua.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';
import { hashApiKey, maskApiKeyHint } from '../../shared/crypto/api-key-hash.js';
import { logger } from '../../shared/utils/logger.js';

export async function backfillApiKeyHashes(): Promise<void> {
  const rows = await runSystemQuery(() =>
    prisma.appSetting.findMany({
      where: { settingKey: 'public_api_key', valueHash: null, valuePlain: { not: null } },
      select: { id: true, valuePlain: true },
    }),
  );
  if (rows.length === 0) return;
  for (const r of rows) {
    const key = r.valuePlain!;
    await runSystemQuery(() =>
      prisma.appSetting.update({
        where: { id: r.id },
        data: { valueHash: hashApiKey(key), valuePlain: maskApiKeyHint(key) },
      }),
    );
  }
  logger.info(`[api-key-backfill] hashed + redacted ${rows.length} public API key(s)`);
}
