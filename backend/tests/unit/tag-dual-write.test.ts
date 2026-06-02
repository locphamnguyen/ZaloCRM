/**
 * tag-dual-write.test.ts — read-modify-write dedup Set unit test.
 * Wave 3 /plan-eng-review M57 Issue 5A.
 *
 * Test addFriendTag double-click không tạo duplicate slug trong Friend.crmTagsPerNick.
 * Test addCrmTag tương tự cho Contact.tags.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma — simulate dual-write transaction
vi.mock('../../src/shared/database/prisma-client.js', () => {
  // In-memory state cho dual-write
  const state = {
    friend: { id: 'f1', orgId: 'org-1', contactId: 'c1', zaloAccountId: 'z1', crmTagsPerNick: [] as string[], zaloLabels: [] as Array<{ id?: number; name?: string; color?: string }>, autoTags: [] as string[] },
    contact: { id: 'c1', orgId: 'org-1', tags: [] as string[] },
    friendTags: [] as Array<{ id: string; friendId: string; tagId: string; removedAt: Date | null; addedBy: string | null; addedVia: string }>,
    contactTags: [] as Array<{ id: string; contactId: string; tagId: string; removedAt: Date | null; addedBy: string | null; addedVia: string }>,
    tag: { id: 'tag-vip', orgId: 'org-1', name: 'VIP', slug: 'vip', scope: 'friend' as const, source: 'manual_per_nick' as const, color: '#FF0000', emoji: null, sourceZaloLabelId: null, priority: 2, archivedAt: null, zaloAccountId: null, groupId: null, autoRule: null, description: null, usageCount: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
  };

  const tx = {
    friend: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        if (where.id !== state.friend.id) return null;
        if (select?.crmTagsPerNick) return { crmTagsPerNick: state.friend.crmTagsPerNick };
        if (select?.zaloLabels) return { zaloLabels: state.friend.zaloLabels };
        if (select?.autoTags) return { autoTags: state.friend.autoTags };
        return state.friend;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        if (where.id !== state.friend.id) throw new Error('not found');
        if (data.crmTagsPerNick !== undefined) state.friend.crmTagsPerNick = data.crmTagsPerNick;
        if (data.zaloLabels !== undefined) state.friend.zaloLabels = data.zaloLabels;
        if (data.autoTags !== undefined) state.friend.autoTags = data.autoTags;
        return state.friend;
      }),
    },
    contact: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        if (where.id !== state.contact.id) return null;
        if (select?.tags) return { tags: state.contact.tags };
        return state.contact;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        if (where.id !== state.contact.id) throw new Error('not found');
        if (data.tags !== undefined) state.contact.tags = data.tags;
        return state.contact;
      }),
    },
    tag: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === state.tag.id ? state.tag : null)),
      findFirst: vi.fn(async () => state.tag),
      create: vi.fn(async ({ data }: any) => ({ ...state.tag, ...data, id: 'tag-new' })),
    },
    friendTag: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { friendId, tagId } = where.friendId_tagId;
        return state.friendTags.find((f) => f.friendId === friendId && f.tagId === tagId) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ft-${state.friendTags.length}`, ...data, removedAt: null };
        state.friendTags.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = state.friendTags.findIndex((f) => f.id === where.id);
        if (idx < 0) throw new Error('not found');
        state.friendTags[idx] = { ...state.friendTags[idx], ...data };
        return state.friendTags[idx];
      }),
    },
    contactTag: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { contactId, tagId } = where.contactId_tagId;
        return state.contactTags.find((c) => c.contactId === contactId && c.tagId === tagId) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ct-${state.contactTags.length}`, ...data, removedAt: null };
        state.contactTags.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = state.contactTags.findIndex((c) => c.id === where.id);
        if (idx < 0) throw new Error('not found');
        state.contactTags[idx] = { ...state.contactTags[idx], ...data };
        return state.contactTags[idx];
      }),
    },
  };

  return {
    prisma: {
      friend: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === state.friend.id ? { id: state.friend.id, orgId: state.friend.orgId, contactId: state.friend.contactId, zaloAccountId: state.friend.zaloAccountId } : null)),
      },
      contact: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === state.contact.id ? { id: state.contact.id, orgId: state.contact.orgId } : null)),
      },
      $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
      __state: state,
    },
  };
});

vi.mock('../../src/modules/tags/contact-autotags-dirty.js', () => ({
  markContactAutoTagsDirty: vi.fn(),
}));

import { addFriendTag, addCrmTag } from '../../src/modules/tags/tag-service';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { prisma } from '../../src/shared/database/prisma-client';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: any = (prisma as any).__state;

beforeEach(() => {
  state.friend.crmTagsPerNick = [];
  state.friend.zaloLabels = [];
  state.friend.autoTags = [];
  state.contact.tags = [];
  state.friendTags.length = 0;
  state.contactTags.length = 0;
});

describe('addFriendTag — dual-write dedup (Issue 5A)', () => {
  it('add cùng tag 2 lần → 1 row junction + 1 slug trong crmTagsPerNick', async () => {
    await addFriendTag({
      friendId: 'f1',
      tagId: 'tag-vip',
      source: 'manual_per_nick',
      addedBy: 'user-1',
    });
    await addFriendTag({
      friendId: 'f1',
      tagId: 'tag-vip',
      source: 'manual_per_nick',
      addedBy: 'user-1',
    });

    expect(state.friendTags.filter((f: any) => f.removedAt === null).length).toBe(1);
    expect(state.friend.crmTagsPerNick).toEqual(['vip']);
  });
});

describe('addCrmTag — dual-write dedup', () => {
  it('add cùng tag 2 lần → 1 row ContactTag + 1 slug trong Contact.tags', async () => {
    state.tag.scope = 'crm';
    state.tag.source = 'manual_crm';
    await addCrmTag({
      contactId: 'c1',
      tagId: 'tag-vip',
      source: 'manual_crm',
      addedBy: 'user-1',
    });
    await addCrmTag({
      contactId: 'c1',
      tagId: 'tag-vip',
      source: 'manual_crm',
      addedBy: 'user-1',
    });

    expect(state.contactTags.filter((c: any) => c.removedAt === null).length).toBe(1);
    expect(state.contact.tags).toEqual(['vip']);
  });
});
