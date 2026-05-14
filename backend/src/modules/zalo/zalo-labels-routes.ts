/**
 * zalo-labels-routes.ts — Sync và quản lý Zalo native labels (thẻ Zalo Real) per nick.
 *
 * Zalo SDK exposes:
 *  - api.getLabels() → returns { labelData: [{ id, text, textKey, color, emoji, offset, conversations[] }], version }
 *  - api.updateLabels({ labelData, version }) → write back (replace whole structure)
 *
 * CRM model:
 *  - ZaloLabel: per (zaloAccountId, zaloLabelId). Mirror of SDK shape.
 *  - Friend.zaloLabels JSON: array of {id, name, color} — the labels assigned to that friend.
 *    Recomputed on every sync by walking ZaloLabel.conversations[] and matching externalThreadId.
 *
 * Realtime: sync-now endpoint + periodic cron (every 60s for connected accounts).
 * Socket broadcast on change so UI auto-refresh.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloPool } from './zalo-pool.js';

type LabelDataFromSdk = {
  id: number | string;
  text: string;
  textKey: string;
  color: string;
  emoji?: string;
  offset?: number;
  conversations?: string[];
  createTime?: number;
};

/**
 * Pull labels from a Zalo account via SDK, upsert into DB, then recompute Friend.zaloLabels
 * for every friend of that account. Returns { labels, friendsUpdated }.
 */
export async function syncLabelsForAccount(accountId: string, orgId: string): Promise<{
  labels: Array<{ id: number; text: string; color: string; emoji: string | null; assignedCount: number }>;
  friendsUpdated: number;
  version: number;
}> {
  const api = zaloPool.getApi(accountId);
  if (!api) throw new Error('Zalo account chưa kết nối — không thể đồng bộ label');
  if (typeof api.getLabels !== 'function') throw new Error('SDK không hỗ trợ getLabels()');

  const res = await api.getLabels();
  const labelData: LabelDataFromSdk[] = res?.labelData || res?.data?.labelData || [];
  const version: number = res?.version || res?.data?.version || 0;

  // Upsert all labels from SDK → DB
  const upserted = await prisma.$transaction(async (tx) => {
    // Clear old labels not in current set
    const incomingIds = labelData.map(l => Number(l.id));
    await tx.zaloLabel.deleteMany({
      where: { zaloAccountId: accountId, zaloLabelId: { notIn: incomingIds.length ? incomingIds : [-1] } },
    });
    const rows = [];
    for (const lbl of labelData) {
      const row = await tx.zaloLabel.upsert({
        where: { zaloAccountId_zaloLabelId: { zaloAccountId: accountId, zaloLabelId: Number(lbl.id) } },
        create: {
          orgId,
          zaloAccountId: accountId,
          zaloLabelId: Number(lbl.id),
          textKey: lbl.textKey || '',
          text: lbl.text || '',
          color: lbl.color || '#999999',
          emoji: lbl.emoji || null,
          offset: lbl.offset ?? 0,
          version,
          conversations: lbl.conversations || [],
          createTime: lbl.createTime ? BigInt(lbl.createTime) : null,
        },
        update: {
          text: lbl.text || '',
          textKey: lbl.textKey || '',
          color: lbl.color || '#999999',
          emoji: lbl.emoji || null,
          offset: lbl.offset ?? 0,
          version,
          conversations: lbl.conversations || [],
          syncedAt: new Date(),
        },
      });
      rows.push(row);
    }
    return rows;
  });

  // Rebuild Friend.zaloLabels JSON: per friend, find all labels whose conversations[] includes friend.zaloUidInNick.
  const friends = await prisma.friend.findMany({
    where: { zaloAccountId: accountId },
    select: { id: true, zaloUidInNick: true },
  });

  // Build reverse index: uid → labels[]
  const uidToLabels = new Map<string, Array<{ id: number; name: string; color: string; emoji: string | null }>>();
  for (const lbl of upserted) {
    const convs: unknown = lbl.conversations;
    const arr = Array.isArray(convs) ? (convs as string[]) : [];
    for (const uid of arr) {
      const list = uidToLabels.get(uid) || [];
      list.push({ id: lbl.zaloLabelId, name: lbl.text, color: lbl.color, emoji: lbl.emoji });
      uidToLabels.set(uid, list);
    }
  }

  // Bulk update friend.zaloLabels
  let friendsUpdated = 0;
  for (const f of friends) {
    const labels = uidToLabels.get(f.zaloUidInNick) || [];
    await prisma.friend.update({
      where: { id: f.id },
      data: { zaloLabels: labels, zaloLabelsSyncedAt: new Date() },
    });
    friendsUpdated++;
  }

  return {
    labels: upserted.map(l => ({
      id: l.zaloLabelId,
      text: l.text,
      color: l.color,
      emoji: l.emoji,
      assignedCount: Array.isArray(l.conversations) ? (l.conversations as string[]).length : 0,
    })),
    friendsUpdated,
    version,
  };
}

export async function zaloLabelsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/zalo-accounts/:id/labels — list từ DB ────────────────────
  app.get('/api/v1/zalo-accounts/:id/labels', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, displayName: true, avatarUrl: true, status: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const labels = await prisma.zaloLabel.findMany({
        where: { zaloAccountId: account.id },
        orderBy: { offset: 'asc' },
      });
      return {
        account,
        labels: labels.map(l => ({
          id: l.zaloLabelId,
          dbId: l.id,
          text: l.text,
          textKey: l.textKey,
          color: l.color,
          emoji: l.emoji,
          offset: l.offset,
          syncedAt: l.syncedAt,
          assignedCount: Array.isArray(l.conversations) ? (l.conversations as string[]).length : 0,
        })),
      };
    } catch (err) {
      logger.error('[zalo-labels] List error:', err);
      return reply.status(500).send({ error: 'Failed to list labels' });
    }
  });

  // ── GET /api/v1/zalo-accounts/labels-overview — all accounts user has access ─
  app.get('/api/v1/zalo-accounts/labels-overview', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const accounts = await prisma.zaloAccount.findMany({
        where: {
          orgId: user.orgId,
          OR: [
            { ownerUserId: user.id },
            { access: { some: { userId: user.id } } },
          ],
        },
        select: {
          id: true, displayName: true, avatarUrl: true, status: true,
          zaloLabelsList: {
            select: { zaloLabelId: true, text: true, color: true, emoji: true, conversations: true, syncedAt: true, offset: true },
            orderBy: { offset: 'asc' },
          },
        },
      });
      return {
        accounts: accounts.map(a => ({
          id: a.id, displayName: a.displayName, avatarUrl: a.avatarUrl, status: a.status,
          labels: a.zaloLabelsList.map(l => ({
            id: l.zaloLabelId,
            text: l.text,
            color: l.color,
            emoji: l.emoji,
            offset: l.offset,
            syncedAt: l.syncedAt,
            assignedCount: Array.isArray(l.conversations) ? (l.conversations as string[]).length : 0,
          })),
        })),
      };
    } catch (err) {
      logger.error('[zalo-labels] Overview error:', err);
      return reply.status(500).send({ error: 'Failed to load labels overview' });
    }
  });

  // ── POST /api/v1/zalo-accounts/:id/labels/sync — pull từ Zalo SDK (force, bỏ cooldown).
  //    Settings page "Đồng bộ ngay" + manual user click.
  app.post('/api/v1/zalo-accounts/:id/labels/sync', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, orgId: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });
      const result = await syncLabelsForAccount(account.id, account.orgId);
      return result;
    } catch (err) {
      logger.error('[zalo-labels] Sync error:', err);
      const msg = err instanceof Error ? err.message : 'Sync failed';
      return reply.status(500).send({ error: msg });
    }
  });

  // ── POST /api/v1/zalo-accounts/:id/labels/touch — sync nếu stale (cooldown 5s).
  //    Frontend trigger khi switch conversation / load tab. No-op nếu vừa sync gần đây.
  app.post('/api/v1/zalo-accounts/:id/labels/touch', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, orgId: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });
      const result = await syncLabelsIfStale(account.id, account.orgId);
      if (!result) return { ok: true, skipped: true, reason: 'cooldown' };
      return { ok: true, ...result };
    } catch (err) {
      // Mềm: không trả 500 cho touch vì đây là trigger background — chỉ log + 200 ok=false
      const msg = err instanceof Error ? err.message : 'Touch failed';
      logger.warn('[zalo-labels] Touch sync warn:', msg);
      return { ok: false, error: msg };
    }
  });

  // ── POST /api/v1/friends/:friendId/zalo-label — assign 1 label cho friend (single-select).
  //    Body: { labelId: number | null }. null = remove all labels.
  //    Logic: tìm tất cả label hiện đang chứa externalThreadId → remove, rồi add vào label mới.
  //    Cập nhật toàn bộ qua SDK updateLabels({labelData, version}).
  app.post('/api/v1/friends/:friendId/zalo-label', async (request: FastifyRequest<{
    Params: { friendId: string };
    Body: { labelId: number | null };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const friend = await prisma.friend.findFirst({
        where: { id: request.params.friendId, orgId: user.orgId },
        select: { id: true, zaloAccountId: true, zaloUidInNick: true, orgId: true },
      });
      if (!friend) return reply.status(404).send({ error: 'Friend not found' });

      const newLabelId = request.body?.labelId ?? null;
      const api = zaloPool.getApi(friend.zaloAccountId);
      if (!api || typeof api.updateLabels !== 'function') {
        return reply.status(503).send({ error: 'Zalo account chưa kết nối — không thể gán tag' });
      }

      // Pull current label data from Zalo (authoritative source)
      const current = await api.getLabels();
      const labelData: LabelDataFromSdk[] = (current?.labelData || []).map((l: LabelDataFromSdk) => ({
        ...l,
        conversations: Array.isArray(l.conversations) ? [...l.conversations] : [],
      }));
      const version: number = current?.version || 0;
      const uid = friend.zaloUidInNick;

      // Remove uid khỏi mọi label đang chứa nó (single-select cleanup)
      for (const l of labelData) {
        l.conversations = (l.conversations || []).filter(c => c !== uid);
      }

      // Add uid vào label được chọn (nếu có)
      if (newLabelId !== null) {
        const target = labelData.find(l => Number(l.id) === newLabelId);
        if (!target) {
          return reply.status(400).send({ error: 'Label ID không tồn tại trong tài khoản này' });
        }
        target.conversations = target.conversations || [];
        if (!target.conversations.includes(uid)) target.conversations.push(uid);
      }

      // Push back to Zalo
      await api.updateLabels({ labelData, version });

      // Re-sync để DB phản ánh state mới (Friend.zaloLabels rebuilt)
      const result = await syncLabelsForAccount(friend.zaloAccountId, friend.orgId);
      return { ok: true, assignedLabelId: newLabelId, ...result };
    } catch (err) {
      logger.error('[zalo-labels] Assign error:', err);
      const msg = err instanceof Error ? err.message : 'Assign failed';
      return reply.status(500).send({ error: msg });
    }
  });

  // ── PATCH /api/v1/zalo-accounts/:id/labels/:labelId — edit color/text → write back qua SDK ─
  app.patch('/api/v1/zalo-accounts/:id/labels/:labelId', async (request: FastifyRequest<{
    Params: { id: string; labelId: string };
    Body: { color?: string; text?: string; emoji?: string };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, orgId: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const labelId = Number(request.params.labelId);
      const label = await prisma.zaloLabel.findUnique({
        where: { zaloAccountId_zaloLabelId: { zaloAccountId: account.id, zaloLabelId: labelId } },
      });
      if (!label) return reply.status(404).send({ error: 'Label not found' });

      const api = zaloPool.getApi(account.id);
      if (!api || typeof api.updateLabels !== 'function') {
        return reply.status(503).send({ error: 'Zalo account chưa kết nối — không thể cập nhật' });
      }

      // Fetch full current labelData, mutate the target, then push back via SDK
      const current = await api.getLabels();
      const labelData = (current?.labelData || []).map((l: LabelDataFromSdk) => {
        if (Number(l.id) !== labelId) return l;
        return {
          ...l,
          text: request.body.text ?? l.text,
          color: request.body.color ?? l.color,
          emoji: request.body.emoji ?? l.emoji,
        };
      });
      await api.updateLabels({ labelData, version: current?.version || 0 });

      // Re-sync to capture the new server state
      const result = await syncLabelsForAccount(account.id, account.orgId);
      return { ok: true, ...result };
    } catch (err) {
      logger.error('[zalo-labels] Patch error:', err);
      const msg = err instanceof Error ? err.message : 'Update failed';
      return reply.status(500).send({ error: msg });
    }
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * On-demand sync với rate-limit per-account (cooldown 5s).
 * Gọi từ frontend khi switch conversation hoặc reload tab — không poll định kỳ.
 * ──────────────────────────────────────────────────────────────────────── */
const lastSyncedAt = new Map<string, number>();
const SYNC_COOLDOWN_MS = 5_000;

/**
 * Sync nếu lần gần nhất > 5s. Returns sync result hoặc null nếu skipped do cooldown.
 * Designed cho việc gọi từ HTTP trigger khi user activity (conv switch, tab load).
 */
export async function syncLabelsIfStale(accountId: string, orgId: string): Promise<Awaited<ReturnType<typeof syncLabelsForAccount>> | null> {
  const last = lastSyncedAt.get(accountId) || 0;
  if (Date.now() - last < SYNC_COOLDOWN_MS) return null;
  lastSyncedAt.set(accountId, Date.now());
  try {
    return await syncLabelsForAccount(accountId, orgId);
  } catch (e) {
    // Reset cooldown nếu failed → lần sau retry sớm hơn
    lastSyncedAt.delete(accountId);
    throw e;
  }
}

// Compat exports — đã bỏ background interval, giữ stub để app.ts không break
export function startLabelsBackgroundSync(_intervalMs?: number): void {
  logger.info('[zalo-labels] On-demand sync mode (no background interval, 5s cooldown per account)');
}
export function stopLabelsBackgroundSync(): void {}
