/**
 * tag-service-merge.test.ts — mergeTags 3-guard unit test.
 * Wave 3 /plan-eng-review M57 Issue 7A.
 *
 * Test mergeTags() guards:
 *   1. idempotent — source archived → skip
 *   2. scope match — src.scope !== tgt.scope → throw SCOPE_MISMATCH
 *   3. zalo_real reject — src.source === 'zalo_real' → throw ZALO_REAL_NOT_MERGEABLE
 *   4. dedup conflict — friend đã có cả 2 tag → soft-remove source row trước UPDATE
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma module trước import tag-service
vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockTx = {
    tag: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    friendTag: { updateMany: vi.fn() },
    contactTag: { updateMany: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
      __mockTx: mockTx,
    },
  };
});

// Mock dirty queue (skip Redis side effects)
vi.mock('../../src/modules/tags/contact-autotags-dirty.js', () => ({
  markContactAutoTagsDirty: vi.fn(),
}));

import { mergeTags } from '../../src/modules/tags/tag-service';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { prisma } from '../../src/shared/database/prisma-client';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx: any = (prisma as any).__mockTx;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mergeTags — Guard 1: idempotent', () => {
  it('returns skipped=source_already_archived khi source.archivedAt set', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: new Date(), scope: 'crm', source: 'manual_crm' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'crm', source: 'manual_crm' });

    const result = await mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' });

    expect(result).toEqual({ moved: 0, skipped: 'source_already_archived' });
    expect(tx.friendTag.updateMany).not.toHaveBeenCalled();
  });

  it('returns skipped=source_already_archived khi source missing', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'crm', source: 'manual_crm' });

    const result = await mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' });

    expect(result.skipped).toBe('source_already_archived');
  });

  it('returns skipped=target_archived khi target.archivedAt set', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: null, scope: 'crm', source: 'manual_crm' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: new Date(), scope: 'crm', source: 'manual_crm' });

    const result = await mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' });

    expect(result.skipped).toBe('target_archived');
  });
});

describe('mergeTags — Guard 2: scope match', () => {
  it('throws SCOPE_MISMATCH khi src=friend vs tgt=crm', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: null, scope: 'friend', source: 'manual_per_nick' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'crm', source: 'manual_crm' });

    await expect(
      mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' })
    ).rejects.toThrow('SCOPE_MISMATCH');
  });

  it('throws SCOPE_MISMATCH khi src=crm vs tgt=friend', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: null, scope: 'crm', source: 'manual_crm' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'friend', source: 'manual_per_nick' });

    await expect(
      mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' })
    ).rejects.toThrow('SCOPE_MISMATCH');
  });
});

describe('mergeTags — Guard 3: zalo_real reject', () => {
  it('throws ZALO_REAL_NOT_MERGEABLE khi src.source=zalo_real', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: null, scope: 'friend', source: 'zalo_real' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'friend', source: 'manual_per_nick' });

    await expect(
      mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' })
    ).rejects.toThrow('ZALO_REAL_NOT_MERGEABLE');
  });

  it('allows merge khi target.source=zalo_real nhưng src KHÔNG zalo_real', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: null, scope: 'friend', source: 'manual_per_nick' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'friend', source: 'zalo_real' });
    tx.friendTag.updateMany.mockResolvedValue({ count: 3 });
    tx.contactTag.updateMany.mockResolvedValue({ count: 0 });
    tx.tag.update.mockResolvedValue({ id: 'src', archivedAt: new Date() });

    const result = await mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' });

    expect(result.moved).toBe(3);
    expect(result.skipped).toBeNull();
  });
});

describe('mergeTags — happy path', () => {
  it('moves friend_tags + archives source', async () => {
    tx.tag.findUnique
      .mockResolvedValueOnce({ id: 'src', archivedAt: null, scope: 'crm', source: 'manual_crm' })
      .mockResolvedValueOnce({ id: 'tgt', archivedAt: null, scope: 'crm', source: 'manual_crm' });
    tx.friendTag.updateMany.mockResolvedValue({ count: 0 });
    tx.contactTag.updateMany.mockResolvedValue({ count: 5 });
    tx.tag.update.mockResolvedValue({ id: 'src', archivedAt: new Date() });
    tx.$executeRaw.mockResolvedValue(0);

    const result = await mergeTags({ orgId: 'org-1', sourceTagId: 'src', targetTagId: 'tgt', mergedBy: 'user-1' });

    expect(result.moved).toBe(5);
    expect(result.skipped).toBeNull();
    // dedup conflict raw SQL chạy 2 lần (friend_tags + contact_tags)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.tag.update).toHaveBeenCalledWith({
      where: { id: 'src' },
      data: { archivedAt: expect.any(Date) },
    });
  });
});
