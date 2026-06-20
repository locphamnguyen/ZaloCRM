// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-sync-routes.ts — Endpoints to sync Zalo friends/contacts to CRM contacts.
 * Requires owner or admin role.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { zaloPool } from './zalo-pool.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';
import { backfillAccountHistory } from './zalo-history-backfill.js';
import { resolveOrCreateContact } from '../contacts/resolve-contact.js';

export async function zaloSyncRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // Sync all friends from a Zalo account to contacts
  app.post('/api/v1/zalo-accounts/:id/sync-contacts', { preHandler: requireGrant('zalo_account', 'edit') },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

      try {
        const result = await instance.api.getAllFriends();
        // getAllFriends returns object with profiles
        const friends = Object.values(result || {}) as any[];
        let created = 0, updated = 0;

        for (const friend of friends) {
          const uid = friend.userId || friend.uid || '';
          if (!uid) continue;

          const zaloName = friend.zaloName || friend.zalo_name || friend.displayName || friend.display_name || '';
          const avatar = friend.avatar || '';
          const phone = friend.phoneNumber || '';
          const globalId = friend.globalId || '';
          const username = friend.username || '';

          // Wave 1.5-B (B7 fix): dùng central resolver thay vì Contact.zaloUid only dedup
          // (vi phạm rule per-account UID — cùng KH 2 nick có 2 zaloUid khác nhau → tạo dup).
          const resolved = await resolveOrCreateContact({
            orgId: user.orgId,
            zaloAccountId: id,
            zaloUidInNick: uid,
            zaloGlobalId: globalId || null,
            zaloUsername: username || null,
            phone: phone || null,
            fallbackFullName: zaloName || null,
            fallbackAvatarUrl: avatar || null,
            enrichViaGetUserInfo: false,
          });
          if (resolved.created) created++;
          else updated++;
        }

        // Backfill: link orphaned conversations (contactId is null) to contacts
        const linked = await linkOrphanedConversations(id, user.orgId, instance.api);

        logger.info(`[sync] Zalo contacts: ${created} created, ${updated} updated, ${linked} conversations linked`);
        return { success: true, created, updated, linked, total: friends.length };
      } catch (err) {
        logger.error('[sync] Zalo contacts error:', err);
        // 2026-06-11: Zalo trả 429 (Too Many Requests) khi đồng bộ quá dày → map sang thông
        // báo rõ ràng thay vì "Sync failed: ZcaApiError 429" khó hiểu. Trả đúng 429 (không 500).
        const msg = String(err);
        if (/\b429\b|too many requests/i.test(msg)) {
          return reply.status(429).send({
            error: 'Zalo đang giới hạn tần suất đồng bộ. Vui lòng thử lại sau vài phút.',
          });
        }
        return reply.status(500).send({ error: 'Đồng bộ danh bạ thất bại: ' + msg });
      }
    }
  );

  // Sync group history from Zalo (manual trigger for fresh accounts / re-sync)
  app.post('/api/v1/zalo-accounts/:id/sync-history', { preHandler: requireGrant('zalo_account', 'edit') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const instance = zaloPool.getInstance(id);
      if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

      try {
        const result = await backfillAccountHistory(instance.api, id);
        return { success: true, ...result };
      } catch (err) {
        logger.error('[sync] Zalo history sync error:', err);
        return reply.status(500).send({ error: 'Sync history failed: ' + String(err) });
      }
    }
  );
}

/**
 * Find conversations with no linked contact and resolve them via Zalo API.
 * Creates missing contacts and links them to their conversations.
 */
async function linkOrphanedConversations(
  accountId: string,
  orgId: string,
  api: any,
): Promise<number> {
  const orphaned = await prisma.conversation.findMany({
    where: { zaloAccountId: accountId, contactId: null, threadType: 'user' },
    select: { id: true, externalThreadId: true },
  });

  if (orphaned.length === 0) return 0;

  let linked = 0;
  for (const conv of orphaned) {
    const uid = conv.externalThreadId;
    if (!uid) continue;

    // Check if contact already exists for this UID
    let contact = await prisma.contact.findFirst({
      where: { zaloUid: uid, orgId },
      select: { id: true },
    });

    if (!contact) {
      // Resolve name from Zalo API
      let zaloName = '';
      let avatar = '';
      let phone = '';
      try {
        const result = await api.getUserInfo(uid);
        const profiles = result?.changed_profiles || {};
        const profile = profiles[uid] || profiles[`${uid}_0`];
        if (profile) {
          zaloName = profile.zaloName || profile.zalo_name || profile.displayName || profile.display_name || '';
          avatar = profile.avatar || '';
          phone = profile.phoneNumber || '';
        }
      } catch (err) {
        logger.warn(`[sync] getUserInfo failed for ${uid}:`, err);
      }

      contact = await prisma.contact.create({
        data: {
          id: randomUUID(),
          orgId,
          zaloUid: uid,
          fullName: zaloName || 'Unknown',
          avatarUrl: avatar || null,
          phone: phone || null,
        },
        select: { id: true },
      });
    }

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { contactId: contact.id },
    });
    linked++;
  }

  logger.info(`[sync] Linked ${linked} orphaned conversations for account ${accountId}`);
  return linked;
}
