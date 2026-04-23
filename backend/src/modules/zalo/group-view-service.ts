/**
 * group-view-service.ts — CRUD + merged conversation listing for ZaloGroupView.
 * All queries are org + user scoped. ACL enforced for member-role access.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';

type JwtUser = { id: string; orgId: string; role: string };

// ── ACL helper ────────────────────────────────────────────────────────────────

/**
 * Owner/admin bypass ACL and get all requested accountIds.
 * Members are filtered to only those they have explicit ZaloAccountAccess for.
 */
export async function filterAccessibleAccounts(
  accountIds: string[],
  user: JwtUser,
): Promise<string[]> {
  if (accountIds.length === 0) return [];
  if (['owner', 'admin'].includes(user.role)) return accountIds;

  const access = await prisma.zaloAccountAccess.findMany({
    where: { userId: user.id, zaloAccountId: { in: accountIds } },
    select: { zaloAccountId: true },
  });
  return access.map((a) => a.zaloAccountId);
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

export async function createView(
  user: JwtUser,
  data: { name: string; accountIds: string[]; color?: string | null },
) {
  return prisma.zaloGroupView.create({
    data: {
      id: randomUUID(),
      orgId: user.orgId,
      userId: user.id,
      name: data.name,
      accountIds: data.accountIds,
      color: data.color ?? null,
    },
  });
}

export async function listViews(user: JwtUser) {
  return prisma.zaloGroupView.findMany({
    where: { orgId: user.orgId, userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getView(viewId: string, user: JwtUser) {
  return prisma.zaloGroupView.findFirst({
    where: { id: viewId, orgId: user.orgId, userId: user.id },
  });
}

export async function updateView(
  viewId: string,
  user: JwtUser,
  data: { name?: string; accountIds?: string[]; color?: string | null },
) {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.accountIds !== undefined) patch.accountIds = data.accountIds;
  if (data.color !== undefined) patch.color = data.color;

  return prisma.zaloGroupView.update({
    where: { id: viewId },
    data: patch,
  });
}

export async function deleteView(viewId: string) {
  return prisma.zaloGroupView.delete({ where: { id: viewId } });
}

// ── Conversation listing ──────────────────────────────────────────────────────

interface ListConvsOptions {
  cursor?: string;
  limit?: number;
  tab?: string;
}

/**
 * Merges conversations across all accountIds in the view.
 * Cursor-based pagination on lastMessageAt DESC.
 * Ties broken by id DESC to avoid drift (best-effort; documented in plan).
 */
export async function listConversations(
  viewId: string,
  user: JwtUser,
  { cursor, limit = 30, tab = 'main' }: ListConvsOptions,
) {
  const view = await getView(viewId, user);
  if (!view) return null;

  const allowedIds = await filterAccessibleAccounts(view.accountIds, user);

  if (allowedIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const take = Math.min(Math.max(1, limit), 100);

  // Build cursor condition: lastMessageAt < cursorDate OR (lastMessageAt = cursorDate AND id < cursorId)
  // Cursor format: "<ISO datetime>|<id>" or plain ISO for backwards compat
  let cursorWhere: Record<string, unknown> | undefined;
  if (cursor) {
    const [isoStr, cursorId] = cursor.split('|');
    const cursorDate = new Date(isoStr);
    if (!Number.isNaN(cursorDate.getTime())) {
      if (cursorId) {
        cursorWhere = {
          OR: [
            { lastMessageAt: { lt: cursorDate } },
            { lastMessageAt: cursorDate, id: { lt: cursorId } },
          ],
        };
      } else {
        cursorWhere = { lastMessageAt: { lt: cursorDate } };
      }
    }
  }

  const where = {
    orgId: user.orgId,
    zaloAccountId: { in: allowedIds },
    tab,
    ...(cursorWhere ?? {}),
  };

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      zaloAccount: { select: { id: true, displayName: true, avatarUrl: true } },
      contact: {
        select: {
          id: true,
          fullName: true,
          crmName: true,
          avatarUrl: true,
          phone: true,
        },
      },
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  });

  const hasMore = conversations.length > take;
  const items = conversations.slice(0, take);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    const isoStr = last.lastMessageAt?.toISOString() ?? new Date(0).toISOString();
    nextCursor = `${isoStr}|${last.id}`;
  }

  return { items, nextCursor };
}
