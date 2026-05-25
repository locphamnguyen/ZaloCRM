/**
 * facebook-form-discovery.test.ts — Unit tests for FB form auto-discovery logic.
 *
 * Tests normalizeName + processFormDiscoveryJob core logic via mocked Prisma.
 * No real DB or Redis needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeName } from '../../src/modules/integrations/providers/facebook/facebook-form-discovery-worker.js';

// ── normalizeName ────────────────────────────────────────────────────────────

describe('normalizeName', () => {
  it('trims whitespace', () => {
    expect(normalizeName('  Form Demo  ')).toBe('form demo');
  });

  it('lowercases ASCII', () => {
    expect(normalizeName('FORM DEMO')).toBe('form demo');
  });

  it('lowercases Vietnamese with diacritics', () => {
    expect(normalizeName('Tệp Khách Hàng')).toBe('tệp khách hàng');
  });

  it('NFKC normalizes fullwidth characters', () => {
    // Fullwidth 'Ａ' → 'A' after NFKC then lowercase → 'a'
    expect(normalizeName('ＡＢＣ')).toBe('abc');
  });

  it('handles combined unicode (NFC form)', () => {
    // "é" (NFC decomposed é) → NFKC → "é" → lowercase
    const combined = 'é';
    const result = normalizeName(combined);
    // After NFKC: composed é, then lowercase
    expect(result).toBe('é');
  });

  it('trims and lowercases mixed case + whitespace', () => {
    expect(normalizeName('  Hello World  ')).toBe('hello world');
  });

  it('empty string stays empty', () => {
    expect(normalizeName('')).toBe('');
  });
});

// ── processFormDiscoveryJob (unit via mocking Prisma + graph client) ─────────

// We use vi.mock to replace DB and graph client

vi.mock('../../src/shared/database/prisma-client.js', () => {
  const mockPrisma = {
    facebookPageConnection: {
      findUnique: vi.fn(),
    },
    facebookFormMapping: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    customerList: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock('../../src/shared/crypto/aes-gcm.js', () => ({
  decrypt: vi.fn((enc: string) => enc === '' ? (() => { throw new Error('empty'); })() : 'decrypted-token'),
}));

vi.mock('../../src/modules/integrations/providers/facebook/facebook-graph-client.js', () => ({
  getLeadgenForms: vi.fn(),
}));

import { prisma } from '../../src/shared/database/prisma-client.js';
import { getLeadgenForms } from '../../src/modules/integrations/providers/facebook/facebook-graph-client.js';
import { processFormDiscoveryJob } from '../../src/modules/integrations/providers/facebook/facebook-form-discovery-worker.js';
import type { Job } from 'bullmq';

function makeJob(data: { orgId: string; pageConnectionId: string; pageId: string }): Job {
  return { data, id: 'test-job', attemptsMade: 0 } as unknown as Job;
}

describe('processFormDiscoveryJob', () => {
  const orgId = 'org-1';
  const pageConnectionId = 'conn-1';
  const pageId = 'page-1';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: page connection found and connected
    (prisma.facebookPageConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessTokenEnc: 'token-enc',
      status: 'connected',
      orgId,
    });

    // Default: no stale mappings
    (prisma.facebookFormMapping.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips already-mapped enabled form (idempotent)', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'form-1', name: 'Form Demo', status: 'ACTIVE', created_time: '2026-01-01' },
    ]);
    (prisma.facebookFormMapping.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'map-1',
      enabled: true,
      customerListId: 'list-1',
    });

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.matched).toBe(0);
    expect(prisma.customerList.create).not.toHaveBeenCalled();
    expect(prisma.facebookFormMapping.create).not.toHaveBeenCalled();
  });

  it('re-enables disabled mapping without creating new list', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'form-1', name: 'Form Demo', status: 'ACTIVE', created_time: '2026-01-01' },
    ]);
    (prisma.facebookFormMapping.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'map-1',
      enabled: false,
      customerListId: 'list-1',
    });
    (prisma.facebookFormMapping.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.matched).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(prisma.facebookFormMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'map-1' }, data: expect.objectContaining({ enabled: true }) }),
    );
    expect(prisma.customerList.create).not.toHaveBeenCalled();
  });

  it('matches existing CustomerList by name (case/whitespace insensitive)', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'form-2', name: '  FORM DEMO  ', status: 'ACTIVE', created_time: '2026-01-01' },
    ]);
    (prisma.facebookFormMapping.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // Simulate LOWER(BTRIM(name)) match
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'existing-list-id' }]);
    (prisma.facebookFormMapping.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.matched).toBe(1);
    expect(summary.created).toBe(0);
    expect(prisma.customerList.create).not.toHaveBeenCalled();
    expect(prisma.facebookFormMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerListId: 'existing-list-id', formId: 'form-2' }),
      }),
    );
  });

  it('creates new CustomerList when no name match', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'form-new', name: 'Form Mới', status: 'ACTIVE', created_time: '2026-01-01' },
    ]);
    (prisma.facebookFormMapping.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]); // no match
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'owner-user-1' });
    (prisma.customerList.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'new-list-id' });
    (prisma.facebookFormMapping.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.created).toBe(1);
    expect(prisma.customerList.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Form Mới',
          sourceType: 'api',
          iconEmoji: '📘',
          orgId,
        }),
      }),
    );
    expect(prisma.facebookFormMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ formId: 'form-new', customerListId: 'new-list-id' }),
      }),
    );
  });

  it('disables stale mappings for forms no longer returned by Graph', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'form-active', name: 'Active Form', status: 'ACTIVE', created_time: '2026-01-01' },
    ]);
    // form-active already mapped
    (prisma.facebookFormMapping.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'map-active',
      enabled: true,
      customerListId: 'list-active',
    });
    // stale mapping (form-deleted not in Graph result)
    (prisma.facebookFormMapping.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'map-stale', formId: 'form-deleted', formName: 'Deleted Form' },
    ]);
    (prisma.facebookFormMapping.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.disabled).toBe(1);
    expect(prisma.facebookFormMapping.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['map-stale'] } }),
        data: { enabled: false },
      }),
    );
  });

  it('returns early when page connection not found', async () => {
    (prisma.facebookPageConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.discovered).toBe(0);
    expect(getLeadgenForms).not.toHaveBeenCalled();
  });

  it('returns early when page orgId mismatch', async () => {
    (prisma.facebookPageConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessTokenEnc: 'token-enc',
      status: 'connected',
      orgId: 'different-org',
    });

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.discovered).toBe(0);
    expect(getLeadgenForms).not.toHaveBeenCalled();
  });

  it('returns early when page not in connected status', async () => {
    (prisma.facebookPageConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessTokenEnc: 'token-enc',
      status: 'revoked',
      orgId,
    });

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.discovered).toBe(0);
    expect(getLeadgenForms).not.toHaveBeenCalled();
  });

  it('handles zero forms returned (empty page)', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const summary = await processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }));

    expect(summary.discovered).toBe(0);
    expect(summary.created).toBe(0);
    expect(summary.matched).toBe(0);
    expect(prisma.facebookFormMapping.create).not.toHaveBeenCalled();
  });

  it('throws when Graph API fails (so BullMQ can retry)', async () => {
    (getLeadgenForms as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('[fb-graph] GET leadgen_forms failed 500'),
    );

    await expect(processFormDiscoveryJob(makeJob({ orgId, pageConnectionId, pageId }))).rejects.toThrow(
      'GET leadgen_forms failed 500',
    );
  });
});
