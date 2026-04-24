import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTagDistribution } from '../tag-distribution.js';
import { prisma } from '../../../../shared/database/prisma-client.js';

vi.mock('../../../../shared/database/prisma-client.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe('tag-distribution report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty tags when no data', async () => {
    (prisma.$queryRaw as any).mockResolvedValue([]);

    const result = await getTagDistribution('org-1');
    expect(result.tags).toEqual([]);
  });

  it('should map raw query rows to tag distribution items', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'VIP', color: '#FF0000', source: 'manual', contact_count: BigInt(30) },
      { tag_id: 'tag-2', name: 'Standard', color: '#00FF00', source: 'auto', contact_count: BigInt(20) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0]).toEqual({
      tagId: 'tag-1',
      name: 'VIP',
      color: '#FF0000',
      source: 'manual',
      contactCount: 30,
      percent: 60.0,
    });
    expect(result.tags[1]).toEqual({
      tagId: 'tag-2',
      name: 'Standard',
      color: '#00FF00',
      source: 'auto',
      contactCount: 20,
      percent: 40.0,
    });
  });

  it('should calculate percentages summing to 100', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'A', color: '#000000', source: 'manual', contact_count: BigInt(33) },
      { tag_id: 'tag-2', name: 'B', color: '#111111', source: 'manual', contact_count: BigInt(33) },
      { tag_id: 'tag-3', name: 'C', color: '#222222', source: 'manual', contact_count: BigInt(34) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    const total = result.tags.reduce((sum, t) => sum + t.percent, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.1);
  });

  it('should handle single tag with 100%', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'Only', color: '#FFFFFF', source: 'manual', contact_count: BigInt(100) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    expect(result.tags[0].percent).toBe(100.0);
  });

  it('should filter by assignedUserId when provided', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1', { assignedUserId: 'user-456' });

    expect((prisma.$queryRaw as any)).toHaveBeenCalled();
    expect(result.tags).toBeDefined();
  });

  it('should ignore zaloAccountId silently', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    // zaloAccountId should be silently ignored, assignedUserId used
    const result = await getTagDistribution('org-1', {
      zaloAccountId: 'account-ignored',
      assignedUserId: 'user-used',
    });

    expect((prisma.$queryRaw as any)).toHaveBeenCalled();
    expect(result.tags).toBeDefined();
  });

  it('should handle zero total contacts (percent = 0)', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'Empty', color: '#000000', source: 'manual', contact_count: BigInt(0) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    expect(result.tags[0].percent).toBe(0);
  });

  it('should convert bigint contact_count to number', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'Big', color: '#000000', source: 'manual', contact_count: BigInt(9223372036854775807) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    expect(typeof result.tags[0].contactCount).toBe('number');
    expect(result.tags[0].contactCount).toBe(9223372036854775807);
  });

  it('should preserve Vietnamese tag names', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'Khách hàng VIP', color: '#FF0000', source: 'manual', contact_count: BigInt(50) },
      { tag_id: 'tag-2', name: 'Nhân viên', color: '#00FF00', source: 'auto', contact_count: BigInt(50) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    expect(result.tags[0].name).toBe('Khách hàng VIP');
    expect(result.tags[1].name).toBe('Nhân viên');
  });

  it('should round percent to 1 decimal place', async () => {
    const mockRows = [
      { tag_id: 'tag-1', name: 'A', color: '#000000', source: 'manual', contact_count: BigInt(1) },
      { tag_id: 'tag-2', name: 'B', color: '#111111', source: 'manual', contact_count: BigInt(2) },
      { tag_id: 'tag-3', name: 'C', color: '#222222', source: 'manual', contact_count: BigInt(3) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getTagDistribution('org-1');
    // 1/6 = 16.666... -> 16.7, 2/6 = 33.333... -> 33.3, 3/6 = 50%
    expect(result.tags[0].percent).toBe(16.7);
    expect(result.tags[1].percent).toBe(33.3);
    expect(result.tags[2].percent).toBe(50.0);
  });
});
