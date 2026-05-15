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
import { logActivity } from '../activity/activity-logger.js';

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

  logger.info(`[zalo-labels] Pulling from Zalo SDK for account ${accountId}...`);
  const res = await api.getLabels();
  const labelData: LabelDataFromSdk[] = res?.labelData || res?.data?.labelData || [];
  const version: number = res?.version || res?.data?.version || 0;
  logger.info(`[zalo-labels] Got ${labelData.length} labels from Zalo (version=${version}) for account ${accountId}`);

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

  // Bulk update friend.zaloLabels + mirror sang CrmTagsPerNick + log diff.
  // Mirror naming: "🔵 {labelText}" prefix. CrmTagGroup auto-tạo per Zalo account.
  // CrmTag.managedBy='zalo_sync' + sourceZaloLabelId để read-only enforcement.
  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { displayName: true, phone: true },
  });
  const groupName = `Zalo - ${account?.displayName || 'Nick'}${account?.phone ? ` (${account.phone})` : ''}`;

  // Upsert CrmTagGroup for this Zalo account (managedBy='zalo_sync')
  const group = await prisma.crmTagGroup.upsert({
    where: { zaloAccountId_managedBy: { zaloAccountId: accountId, managedBy: 'zalo_sync' } },
    create: {
      orgId,
      name: groupName,
      managedBy: 'zalo_sync',
      zaloAccountId: accountId,
    },
    update: { name: groupName }, // rename khi displayName/phone đổi
  });

  // Upsert CrmTag per label — 3-step để xử lý legacy data từ PR2:
  //  1. Find theo sourceZaloLabelId (PR3+ rows) → update
  //  2. Else find theo (orgId, name) (legacy PR2 rows hoặc orphan) → claim + update fields
  //  3. Else create mới
  // Tránh upsert(where=sourceZaloLabelId) hit create branch khi legacy có same name
  // → fail unique constraint (orgId, name).
  for (const l of upserted) {
    const tagName = `🔵 ${l.text}`;
    const baseData = {
      color: l.color || '#1976D2',
      emoji: l.emoji || null,
      groupId: group.id,
      category: groupName,
      managedBy: 'zalo_sync',
      sourceZaloLabelId: l.zaloLabelId,
      description: `Auto-sync từ Zalo label ID ${l.zaloLabelId}`,
      archivedAt: null,
    };

    const bySource = await prisma.crmTag.findUnique({
      where: { sourceZaloLabelId: l.zaloLabelId },
    });
    if (bySource) {
      await prisma.crmTag.update({
        where: { id: bySource.id },
        data: { name: tagName, ...baseData },
      });
      continue;
    }

    const byName = await prisma.crmTag.findUnique({
      where: { orgId_name: { orgId, name: tagName } },
    });
    if (byName) {
      // Claim legacy row (sourceZaloLabelId=null từ PR2) → upgrade managedBy
      await prisma.crmTag.update({
        where: { id: byName.id },
        data: baseData,
      });
      continue;
    }

    await prisma.crmTag.create({
      data: { orgId, name: tagName, ...baseData },
    });
  }

  // Archive CrmTag tương ứng với label bị xoá (không còn trong upserted set)
  const currentLabelIds = upserted.map(l => l.zaloLabelId);
  await prisma.crmTag.updateMany({
    where: {
      orgId,
      managedBy: 'zalo_sync',
      groupId: group.id,
      sourceZaloLabelId: { notIn: currentLabelIds.length ? currentLabelIds : [-1] },
      archivedAt: null,
    },
    data: { archivedAt: new Date() },
  });

  // Bulk update friend.zaloLabels + diff log
  const friendsFull = await prisma.friend.findMany({
    where: { zaloAccountId: accountId },
    select: { id: true, zaloUidInNick: true, contactId: true, zaloLabels: true, crmTagsPerNick: true },
  });
  let friendsUpdated = 0;
  for (const f of friendsFull) {
    const newLabels = uidToLabels.get(f.zaloUidInNick) || [];
    const oldLabels = Array.isArray(f.zaloLabels) ? (f.zaloLabels as Array<{ name?: string }>) : [];
    const oldNames = new Set(oldLabels.map(l => l.name).filter(Boolean) as string[]);
    const newNames = new Set(newLabels.map(l => l.name).filter(Boolean));
    const addedLabels = [...newNames].filter(n => !oldNames.has(n));
    const removedLabels = [...oldNames].filter(n => !newNames.has(n));

    // Mirror sang crmTagsPerNick: remove tag "🔵 {oldLabel}" + add tag "🔵 {newLabel}"
    const oldCrmTags = Array.isArray(f.crmTagsPerNick) ? (f.crmTagsPerNick as string[]) : [];
    let newCrmTags = oldCrmTags.filter(t => {
      // Giữ lại tag KHÔNG phải Zalo-mirrored, hoặc tag Zalo-mirrored mà vẫn còn trong newNames
      if (!t.startsWith('🔵 ')) return true;
      const labelName = t.slice(2);
      return newNames.has(labelName);
    });
    for (const labelName of addedLabels) {
      const mirroredTag = `🔵 ${labelName}`;
      if (!newCrmTags.includes(mirroredTag)) newCrmTags.push(mirroredTag);
    }

    await prisma.friend.update({
      where: { id: f.id },
      data: {
        zaloLabels: newLabels,
        zaloLabelsSyncedAt: new Date(),
        crmTagsPerNick: newCrmTags,
      },
    });
    friendsUpdated++;

    // ── ACTIVITY LOG — gộp tag_change_zalo nếu có CẢ remove + add cùng sync.
    //  Single-select Zalo tag (1 label/friend) → đổi A→B thường có 1 remove + 1 add.
    //  Edge case nhiều add/remove cùng lúc → fallback log riêng từng action. ──
    if (f.contactId) {
      const baseDetails = { friendId: f.id, accountId, trigger: 'sync' };
      if (removedLabels.length === 1 && addedLabels.length === 1) {
        // Case phổ biến nhất: đổi tag A→B
        logActivity({
          orgId,
          systemSource: 'zalo_label_sync',
          action: 'tag_change_zalo',
          entityType: 'contact',
          entityId: f.contactId,
          details: { ...baseDetails, from: removedLabels[0], to: addedLabels[0] },
        });
      } else {
        // Fallback: log riêng từng add/remove (multi-add hoặc multi-remove)
        for (const labelName of addedLabels) {
          logActivity({
            orgId,
            systemSource: 'zalo_label_sync',
            action: 'tag_add_zalo',
            entityType: 'contact',
            entityId: f.contactId,
            details: { ...baseDetails, tag: labelName },
          });
        }
        for (const labelName of removedLabels) {
          logActivity({
            orgId,
            systemSource: 'zalo_label_sync',
            action: 'tag_remove_zalo',
            entityType: 'contact',
            entityId: f.contactId,
            details: { ...baseDetails, tag: labelName },
          });
        }
      }
    }
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

  // ── GET /api/v1/zalo-accounts/:id/labels — list từ DB.
  //    Query ?threadId=xxx → mỗi label kèm flag assignedTo (current thread có gán không).
  app.get('/api/v1/zalo-accounts/:id/labels', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { threadId?: string };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, displayName: true, avatarUrl: true, status: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const threadId = request.query.threadId || '';
      const labels = await prisma.zaloLabel.findMany({
        where: { zaloAccountId: account.id },
        orderBy: { offset: 'asc' },
      });
      return {
        account,
        labels: labels.map(l => {
          const convs = Array.isArray(l.conversations) ? (l.conversations as string[]) : [];
          return {
            id: l.zaloLabelId,
            dbId: l.id,
            text: l.text,
            textKey: l.textKey,
            color: l.color,
            emoji: l.emoji,
            offset: l.offset,
            syncedAt: l.syncedAt,
            assignedCount: convs.length,
            assignedTo: threadId ? convs.includes(threadId) : false,
          };
        }),
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

  // ── POST /api/v1/zalo-accounts/:id/labels/assign-thread — assign label cho thread (user UID hoặc group ID).
  //    Body: { threadId: string, labelId: number | null }
  //    Single-select: strip threadId khỏi mọi label, add vào label mới. Push qua SDK updateLabels().
  //    Supports BOTH user threads + group threads.
  app.post('/api/v1/zalo-accounts/:id/labels/assign-thread', async (request: FastifyRequest<{
    Params: { id: string };
    Body: { threadId: string; labelId: number | null };
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const account = await prisma.zaloAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: { id: true, orgId: true },
      });
      if (!account) return reply.status(404).send({ error: 'Zalo account not found' });

      const threadId = (request.body?.threadId || '').trim();
      const newLabelId = request.body?.labelId ?? null;
      if (!threadId) return reply.status(400).send({ error: 'threadId is required' });

      const api = zaloPool.getApi(account.id);
      if (!api || typeof api.updateLabels !== 'function') {
        return reply.status(503).send({ error: 'Zalo account chưa kết nối — không thể gán tag' });
      }

      const current = await api.getLabels();
      const labelData: LabelDataFromSdk[] = (current?.labelData || []).map((l: LabelDataFromSdk) => ({
        ...l,
        conversations: Array.isArray(l.conversations) ? [...l.conversations] : [],
      }));
      const version: number = current?.version || 0;

      // Strip threadId khỏi mọi label (single-select cleanup)
      for (const l of labelData) {
        l.conversations = (l.conversations || []).filter(c => c !== threadId);
      }

      // Add to new label if provided
      if (newLabelId !== null) {
        const target = labelData.find(l => Number(l.id) === newLabelId);
        if (!target) return reply.status(400).send({ error: 'Label ID không tồn tại' });
        target.conversations = target.conversations || [];
        if (!target.conversations.includes(threadId)) target.conversations.push(threadId);
      }

      logger.info(`[zalo-labels] Pushing labelData (${labelData.length} labels, v=${version}) → Zalo for thread ${threadId}, newLabelId=${newLabelId}`);
      try {
        const writeRes = await api.updateLabels({ labelData, version });
        logger.info(`[zalo-labels] Zalo updateLabels success → new version=${writeRes?.version}`);
      } catch (sdkErr: unknown) {
        const msg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
        logger.error(`[zalo-labels] Zalo updateLabels FAILED: ${msg}`);
        return reply.status(502).send({ error: `Zalo từ chối: ${msg}` });
      }
      const result = await syncLabelsForAccount(account.id, account.orgId);
      return { ok: true, assignedLabelId: newLabelId, ...result };
    } catch (err) {
      logger.error('[zalo-labels] Assign-thread error:', err);
      const msg = err instanceof Error ? err.message : 'Assign failed';
      return reply.status(500).send({ error: msg });
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
