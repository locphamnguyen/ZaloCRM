/**
 * contact-autotags-dirty.ts — Redis dirty set + cron batch SQL.
 *
 * Issue 6A /plan-eng-review M57. Tránh N+1 query khi cron scoring touch
 * 4500 KH × 7 friend → 31,500 calls. Mỗi addFriendTag(auto_*) chỉ markDirty.
 * Cron 5 phút batch 1 SQL UPDATE Contact.autoTags = union DISTINCT.
 *
 * Wave 5 Slim Big-Bang sẽ DROP Contact.autoTags → bỏ luôn cron này.
 */

import { prisma } from '../../shared/database/prisma-client.js';
import { getRedis } from '../../shared/redis-client.js';
import { logger } from '../../shared/utils/logger.js';

const REDIS_KEY = 'tag-autotags-dirty';
const IN_MEMORY_FALLBACK = new Set<string>();
const BATCH_LIMIT = 500;

export async function markContactAutoTagsDirty(contactId: string): Promise<void> {
  if (!contactId) return;
  const redis = await getRedis();
  if (redis) {
    await redis.sadd(REDIS_KEY, contactId);
  } else {
    IN_MEMORY_FALLBACK.add(contactId);
  }
}

export async function drainDirtyContacts(): Promise<string[]> {
  const redis = await getRedis();
  if (redis) {
    const members = await redis.spop(REDIS_KEY, BATCH_LIMIT);
    return Array.isArray(members) ? members : [];
  }
  const arr = Array.from(IN_MEMORY_FALLBACK);
  IN_MEMORY_FALLBACK.clear();
  return arr.slice(0, BATCH_LIMIT);
}

/**
 * Cron worker: scan dirty set + batch UPDATE Contact.autoTags = union DISTINCT
 * across all friends WHERE FriendTag(source=auto_*).
 */
export async function runAutoTagsAggregateBatch(): Promise<{ updated: number }> {
  const contactIds = await drainDirtyContacts();
  if (contactIds.length === 0) return { updated: 0 };

  // 1 raw SQL update toàn batch
  const idList = contactIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  if (!idList) return { updated: 0 };

  // Aggregate per contact: union DISTINCT slug từ friend_tags(auto_*)
  // Sửa Contact.autoTags = [{slug1}, {slug2}, ...] string array Json
  try {
    await prisma.$executeRawUnsafe(`
      UPDATE contacts c
      SET auto_tags = COALESCE(
        (SELECT json_agg(DISTINCT t.slug)
         FROM friends f
         JOIN friend_tags ft ON ft.friend_id = f.id AND ft.removed_at IS NULL
         JOIN tags t ON t.id = ft.tag_id
         WHERE f.contact_id = c.id
           AND t.source IN ('auto_detect', 'auto_score', 'auto_engagement')
        ),
        '[]'::json
      )
      WHERE c.id IN (${idList})
    `);
    logger.debug(`[autotags-dirty] aggregated ${contactIds.length} contacts`);
    return { updated: contactIds.length };
  } catch (err) {
    logger.error('[autotags-dirty] batch failed: %s', (err as Error).message);
    // Re-mark dirty để retry next round
    for (const id of contactIds) await markContactAutoTagsDirty(id);
    return { updated: 0 };
  }
}

let cronTimer: NodeJS.Timeout | null = null;

export function startAutoTagsAggregateCron(intervalMs = 5 * 60 * 1000): void {
  if (cronTimer) return;
  cronTimer = setInterval(() => {
    runAutoTagsAggregateBatch().catch((err) => logger.error('[autotags-dirty] cron err: %s', err));
  }, intervalMs);
  logger.info(`[autotags-dirty] cron started, interval=${intervalMs}ms`);
}

export function stopAutoTagsAggregateCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
