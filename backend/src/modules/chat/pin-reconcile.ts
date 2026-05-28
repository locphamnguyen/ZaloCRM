// Pin reconcile — 2-chiều Zalo ↔ CRM cho ghim hội thoại (anh chốt 2026-05-28).
//
// Bối cảnh: zca-js Listener KHÔNG emit event khi user pin/unpin trên Zalo Web/App
// → chiều ngược Zalo→CRM phải dùng polling/sync. Approach: gọi getPinConversations
// mỗi lần nick reconnect (event 'connected') để reset state khớp Zalo native.
//
// Side đối xứng vs chiều xuôi (CRM→Zalo via chat-operations-routes.ts:680-720):
//   - Zalo có mà CRM thiếu → INSERT vào CRM + emit socket 'chat:pinned'
//   - CRM có mà Zalo không → DELETE từ CRM + emit socket 'chat:unpinned'
//
// CHỈ chạy 1 lần per reconnect (không cron periodic) — tránh load nhiều cho SDK.
// Sale switch giữa Zalo native ↔ CRM hiếm khi cần realtime sync pin.

import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';

export async function reconcilePinsOnReconnect(
  accountId: string,
  io: Server | null,
): Promise<{ added: number; removed: number; total: number }> {
  try {
    // 1. Lấy list pin từ Zalo native — strip prefix u/g để khớp CRM externalThreadId
    //    (SDK trả "u7002...123" cho user thread, "g4642...659" cho group; CRM lưu
    //    chỉ digits sau prefix). Verified 2026-05-28 qua debug log "no match" sample.
    const result: any = await zaloOps.getPinConversations(accountId);
    const zaloRawIds: string[] = Array.isArray(result?.conversations) ? result.conversations : [];
    const zaloThreadIds = zaloRawIds.map((id) => id.replace(/^[ug]/, ''));

    // 2. Resolve nick → org + accessible conversations
    const nick = await prisma.zaloAccount.findUnique({
      where: { id: accountId },
      select: { id: true, orgId: true },
    });
    if (!nick) {
      logger.warn(`[pin-reconcile:${accountId}] nick not found in DB`);
      return { added: 0, removed: 0, total: 0 };
    }

    // 3. Map zalo threadIds → CRM Conversation ids (qua externalThreadId)
    const zaloSet = new Set(zaloThreadIds);
    const matchedConvs = zaloThreadIds.length === 0
      ? []
      : await prisma.conversation.findMany({
          where: {
            zaloAccountId: accountId,
            externalThreadId: { in: zaloThreadIds },
          },
          select: { id: true, externalThreadId: true },
        });
    const zaloMatchedConvIds = new Set(matchedConvs.map((c) => c.id));

    // 4. Lấy CRM pinned hiện tại — JOIN conversation để biết externalThreadId
    const crmPinned = await prisma.pinnedConversation.findMany({
      where: { zaloAccountId: accountId },
      select: {
        id: true,
        conversationId: true,
        conversation: { select: { externalThreadId: true } },
      },
    });

    // Debug log — sample 3 IDs mỗi bên để so format khi mismatch
    if (zaloThreadIds.length > 0 && zaloMatchedConvIds.size === 0) {
      const sampleZalo = zaloThreadIds.slice(0, 3);
      const sampleCrm = await prisma.conversation.findMany({
        where: { zaloAccountId: accountId, externalThreadId: { not: null } },
        select: { externalThreadId: true },
        take: 3,
      });
      logger.warn(`[pin-reconcile:${accountId}] no match! sample zalo=${JSON.stringify(sampleZalo)} | sample CRM=${JSON.stringify(sampleCrm.map(c => c.externalThreadId))}`);
    }

    // 5. Diff — SAFE remove: chỉ xoá pin CRM khi conv đó có externalThreadId và
    //    externalThreadId KHÔNG có trong Zalo list. Pin không có externalThreadId
    //    → skip (chưa sync với Zalo, không thể compare).
    const toAdd = [...zaloMatchedConvIds].filter((id) => !crmPinned.some(p => p.conversationId === id));
    const toRemove: string[] = [];
    for (const p of crmPinned) {
      const ext = p.conversation?.externalThreadId;
      // SKIP nếu conv không có externalThreadId — chưa link Zalo
      if (!ext) continue;
      // CHỈ remove khi confirm Zalo không có conv này
      if (!zaloSet.has(ext)) toRemove.push(p.conversationId);
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
      logger.info(`[pin-reconcile:${accountId}] in-sync, ${crmPinned.length} pins (zalo=${zaloThreadIds.length}, matched=${zaloMatchedConvIds.size})`);
      return { added: 0, removed: 0, total: crmPinned.length };
    }

    // 6. Apply
    if (toAdd.length > 0) {
      await prisma.pinnedConversation.createMany({
        data: toAdd.map((conversationId) => ({
          id: randomUUID(),
          orgId: nick.orgId,
          zaloAccountId: accountId,
          conversationId,
          pinnedAt: new Date(),
        })),
        skipDuplicates: true,
      });
      for (const conversationId of toAdd) {
        io?.emit('chat:pinned', { conversationId, isPinned: true, source: 'zalo-sync' });
      }
    }
    if (toRemove.length > 0) {
      await prisma.pinnedConversation.deleteMany({
        where: {
          zaloAccountId: accountId,
          conversationId: { in: toRemove },
        },
      });
      for (const conversationId of toRemove) {
        io?.emit('chat:unpinned', { conversationId, isPinned: false, source: 'zalo-sync' });
      }
    }

    logger.info(`[pin-reconcile:${accountId}] synced ${toAdd.length} added, ${toRemove.length} removed (zalo=${zaloThreadIds.length}, matched=${zaloMatchedConvIds.size})`);
    return { added: toAdd.length, removed: toRemove.length, total: zaloMatchedConvIds.size };
  } catch (err) {
    logger.error(`[pin-reconcile:${accountId}] error:`, err);
    return { added: 0, removed: 0, total: 0 };
  }
}
