import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exportCsv, isValidExportType } from '../csv-export.js';

// Mock all report functions
vi.mock('../reports/conversion-funnel.js', () => ({
  getConversionFunnel: vi.fn(),
}));

vi.mock('../reports/team-performance.js', () => ({
  getTeamPerformance: vi.fn(),
}));

vi.mock('../reports/response-time.js', () => ({
  getResponseTimeAnalysis: vi.fn(),
}));

vi.mock('../reports/heatmap.js', () => ({
  getResponseHeatmap: vi.fn(),
}));

vi.mock('../reports/tag-distribution.js', () => ({
  getTagDistribution: vi.fn(),
}));

vi.mock('../reports/drip-kpi.js', () => ({
  getDripKpi: vi.fn(),
}));

describe('csv-export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidExportType', () => {
    it('should accept valid export types', () => {
      expect(isValidExportType('funnel')).toBe(true);
      expect(isValidExportType('team')).toBe(true);
      expect(isValidExportType('response')).toBe(true);
      expect(isValidExportType('heatmap')).toBe(true);
      expect(isValidExportType('tags')).toBe(true);
      expect(isValidExportType('drip')).toBe(true);
    });

    it('should reject invalid export types', () => {
      expect(isValidExportType('invalid')).toBe(false);
      expect(isValidExportType('foo')).toBe(false);
      expect(isValidExportType('')).toBe(false);
    });
  });

  describe('exportCsv - funnel', () => {
    it('should export funnel with correct headers and rows', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      (getConversionFunnel as any).mockResolvedValue({
        stages: [
          { status: 'lead', count: 100, rate: 1.0 },
          { status: 'contact', count: 80, rate: 0.8 },
          { status: 'appointment', count: 50, rate: 0.5 },
        ],
      });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines[0]).toBe('status,count,rate');
        expect(lines[1]).toBe('lead,100,1');
        expect(lines[2]).toBe('contact,80,0.8');
        expect(lines[3]).toBe('appointment,50,0.5');
      }
    });

    it('should export empty funnel result as headers-only', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      (getConversionFunnel as any).mockResolvedValue({ stages: [] });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines.length).toBe(1);
        expect(lines[0]).toBe('status,count,rate');
      }
    });
  });

  describe('exportCsv - team', () => {
    it('should export team performance with correct headers', async () => {
      const { getTeamPerformance } = await import('../reports/team-performance.js');
      (getTeamPerformance as any).mockResolvedValue({
        users: [
          { userId: 'user-1', fullName: 'Nguyễn Văn A', messagesSent: 50, contactsConverted: 10, appointmentsCompleted: 5, avgResponseTime: 120 },
        ],
      });

      const result = await exportCsv('org-1', 'team', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines[0]).toBe('userId,fullName,messagesSent,contactsConverted,appointmentsCompleted,avgResponseTimeSec');
        expect(lines[1]).toContain('Nguyễn Văn A');
      }
    });
  });

  describe('exportCsv - response', () => {
    it('should export response time (daily series only)', async () => {
      const { getResponseTimeAnalysis } = await import('../reports/response-time.js');
      (getResponseTimeAnalysis as any).mockResolvedValue({
        daily: [
          { date: '2026-04-01', avgSeconds: 120 },
          { date: '2026-04-02', avgSeconds: 110 },
        ],
      });

      const result = await exportCsv('org-1', 'response', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines[0]).toBe('date,avgSeconds');
        expect(lines[1]).toBe('2026-04-01,120');
        expect(lines[2]).toBe('2026-04-02,110');
      }
    });
  });

  describe('exportCsv - heatmap', () => {
    it('should export heatmap cells with correct headers', async () => {
      const { getResponseHeatmap } = await import('../reports/heatmap.js');
      (getResponseHeatmap as any).mockResolvedValue({
        cells: [
          { dow: 1, hour: 9, avgSeconds: 120, sampleCount: 50 },
          { dow: 1, hour: 10, avgSeconds: 110, sampleCount: 55 },
        ],
      });

      const result = await exportCsv('org-1', 'heatmap', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines[0]).toBe('dow,hour,avgSeconds,sampleCount');
        expect(lines[1]).toBe('1,9,120,50');
      }
    });

    it('should export empty heatmap as headers-only', async () => {
      const { getResponseHeatmap } = await import('../reports/heatmap.js');
      (getResponseHeatmap as any).mockResolvedValue({ cells: [] });

      const result = await exportCsv('org-1', 'heatmap', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines.length).toBe(1);
      }
    });
  });

  describe('exportCsv - tags', () => {
    it('should export tags with correct headers', async () => {
      const { getTagDistribution } = await import('../reports/tag-distribution.js');
      (getTagDistribution as any).mockResolvedValue({
        tags: [
          { tagId: 'tag-1', name: 'VIP', color: '#FF0000', source: 'manual', contactCount: 30, percent: 75.0 },
          { tagId: 'tag-2', name: 'Standard', color: '#00FF00', source: 'auto', contactCount: 10, percent: 25.0 },
        ],
      });

      const result = await exportCsv('org-1', 'tags', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines[0]).toBe('tagId,name,color,source,contactCount,percent');
        expect(lines[1]).toContain('VIP');
      }
    });

    it('should export empty tags as headers-only', async () => {
      const { getTagDistribution } = await import('../reports/tag-distribution.js');
      (getTagDistribution as any).mockResolvedValue({ tags: [] });

      const result = await exportCsv('org-1', 'tags', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines.length).toBe(1);
      }
    });
  });

  describe('exportCsv - drip', () => {
    it('should export drip KPI with correct headers', async () => {
      const { getDripKpi } = await import('../reports/drip-kpi.js');
      (getDripKpi as any).mockResolvedValue({
        campaigns: [
          {
            id: 'camp-1',
            name: 'Q2 Campaign',
            enrolled: 100,
            active: 50,
            completed: 30,
            failed: 10,
            cancelled: 10,
            sendSuccessRate: 95.5,
            avgDaysToComplete: 7.5,
          },
        ],
      });

      const result = await exportCsv('org-1', 'drip', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines[0]).toBe('campaignId,name,enrolled,active,completed,failed,cancelled,sendSuccessRate,avgDaysToComplete');
        expect(lines[1]).toContain('Q2 Campaign');
      }
    });

    it('should export empty drip KPI as headers-only', async () => {
      const { getDripKpi } = await import('../reports/drip-kpi.js');
      (getDripKpi as any).mockResolvedValue({ campaigns: [] });

      const result = await exportCsv('org-1', 'drip', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
      if ('csv' in result) {
        const lines = result.csv.split('\r\n');
        expect(lines.length).toBe(1);
      }
    });
  });

  describe('CSV escaping', () => {
    it('should escape fields containing commas', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      (getConversionFunnel as any).mockResolvedValue({
        stages: [{ status: 'lead,secondary', count: 100, rate: 1.0 }],
      });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      if ('csv' in result) {
        expect(result.csv).toContain('"lead,secondary"');
      }
    });

    it('should escape fields containing quotes', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      (getConversionFunnel as any).mockResolvedValue({
        stages: [{ status: 'lead"quoted', count: 100, rate: 1.0 }],
      });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      if ('csv' in result) {
        expect(result.csv).toContain('"lead""quoted"');
      }
    });

    it('should preserve Vietnamese diacritics', async () => {
      const { getTeamPerformance } = await import('../reports/team-performance.js');
      (getTeamPerformance as any).mockResolvedValue({
        users: [
          { userId: 'user-1', fullName: 'Nguyễn Văn Nhân viên', messagesSent: 50, contactsConverted: 10, appointmentsCompleted: 5, avgResponseTime: 120 },
        ],
      });

      const result = await exportCsv('org-1', 'team', '2026-04-01', '2026-04-30', {});
      if ('csv' in result) {
        expect(result.csv).toContain('Nguyễn Văn Nhân viên');
      }
    });

    it('should escape fields containing newlines', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      (getConversionFunnel as any).mockResolvedValue({
        stages: [{ status: 'lead\nnewline', count: 100, rate: 1.0 }],
      });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      if ('csv' in result) {
        expect(result.csv).toContain('"lead\nnewline"');
      }
    });
  });

  describe('Row limit enforcement', () => {
    it('should reject export exceeding 50k rows', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      const hugeStages = Array.from({ length: 50001 }, (_, i) => ({
        status: `status-${i}`,
        count: 1,
        rate: 0.01,
      }));
      (getConversionFunnel as any).mockResolvedValue({ stages: hugeStages });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('too_large');
      }
    });

    it('should accept export at exactly 50k rows', async () => {
      const { getConversionFunnel } = await import('../reports/conversion-funnel.js');
      const stages = Array.from({ length: 50000 }, (_, i) => ({
        status: `status-${i}`,
        count: 1,
        rate: 0.01,
      }));
      (getConversionFunnel as any).mockResolvedValue({ stages });

      const result = await exportCsv('org-1', 'funnel', '2026-04-01', '2026-04-30', {});
      expect('csv' in result).toBe(true);
    });
  });

  describe('Unknown type handling', () => {
    it('should return unknown_type error for invalid type', async () => {
      const result = await exportCsv('org-1', 'unknown', '2026-04-01', '2026-04-30', {});
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('unknown_type');
      }
    });
  });
});
