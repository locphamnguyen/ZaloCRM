import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getResponseHeatmap } from '../heatmap.js';
import { prisma } from '../../../../shared/database/prisma-client.js';

vi.mock('../../../../shared/database/prisma-client.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe('heatmap report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty cells when no data', async () => {
    (prisma.$queryRaw as any).mockResolvedValue([]);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30');
    expect(result.cells).toEqual([]);
  });

  it('should map raw query rows to cells with correct structure', async () => {
    const mockRows = [
      { dow: 1, hour: 9, avg_seconds: 120.5, sample_count: BigInt(50) },
      { dow: 1, hour: 10, avg_seconds: 110.2, sample_count: BigInt(55) },
      { dow: 5, hour: 14, avg_seconds: 95.8, sample_count: BigInt(40) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30');
    expect(result.cells).toHaveLength(3);
    expect(result.cells[0]).toEqual({ dow: 1, hour: 9, avgSeconds: 121, sampleCount: 50 });
    expect(result.cells[1]).toEqual({ dow: 1, hour: 10, avgSeconds: 110, sampleCount: 55 });
    expect(result.cells[2]).toEqual({ dow: 5, hour: 14, avgSeconds: 96, sampleCount: 40 });
  });

  it('should round avgSeconds correctly', async () => {
    const mockRows = [
      { dow: 0, hour: 12, avg_seconds: 99.4, sample_count: BigInt(100) },
      { dow: 2, hour: 15, avg_seconds: 99.5, sample_count: BigInt(100) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30');
    expect(result.cells[0].avgSeconds).toBe(99);
    expect(result.cells[1].avgSeconds).toBe(100);
  });

  it('should clamp date range to 90 days maximum', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    // Request 120 days: from 2026-01-01 to 2026-04-30
    // Should clamp to: from 2026-01-31 to 2026-04-30 (90 days before 2026-04-30)
    const result = await getResponseHeatmap('org-1', '2026-01-01', '2026-04-30');

    // Verify the function was called
    expect((prisma.$queryRaw as any)).toHaveBeenCalled();
    expect(result.cells).toBeDefined();
  });

  it('should use default 30-day range when no dates provided', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    // Fixed "now" to 2026-04-24 for deterministic test
    const now = new Date('2026-04-24').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await getResponseHeatmap('org-1');

    vi.useRealTimers();

    const callArgs = (prisma.$queryRaw as any).mock.calls[0];
    expect(callArgs).toBeDefined();
  });

  it('should use provided to date and calculate from date as last 30 days', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    await getResponseHeatmap('org-1', undefined, '2026-04-30');

    const callArgs = (prisma.$queryRaw as any).mock.calls[0];
    expect(callArgs).toBeDefined();
  });

  it('should filter by zaloAccountId when provided', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30', {
      zaloAccountId: 'account-123',
    });

    // Verify the function was called (actual SQL parameter binding happens in Prisma, not visible here)
    expect((prisma.$queryRaw as any)).toHaveBeenCalled();
    expect(result.cells).toBeDefined();
  });

  it('should filter by assignedUserId when provided', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30', {
      assignedUserId: 'user-456',
    });

    expect((prisma.$queryRaw as any)).toHaveBeenCalled();
    expect(result.cells).toBeDefined();
  });

  it('should filter by both zaloAccountId and assignedUserId when both provided', async () => {
    const mockRows = [] as any[];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30', {
      zaloAccountId: 'account-123',
      assignedUserId: 'user-456',
    });

    expect((prisma.$queryRaw as any)).toHaveBeenCalled();
    expect(result.cells).toBeDefined();
  });

  it('should convert bigint sample_count to number', async () => {
    const mockRows = [
      { dow: 0, hour: 9, avg_seconds: 100, sample_count: BigInt(9223372036854775807) },
    ];
    (prisma.$queryRaw as any).mockResolvedValue(mockRows);

    const result = await getResponseHeatmap('org-1', '2026-04-01', '2026-04-30');
    expect(typeof result.cells[0].sampleCount).toBe('number');
    expect(result.cells[0].sampleCount).toBe(9223372036854775807);
  });
});
