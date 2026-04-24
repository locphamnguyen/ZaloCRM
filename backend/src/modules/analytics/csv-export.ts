/**
 * csv-export.ts — Thin dispatcher: type → report fn → CSV string.
 * BOM is prepended by the route handler, not here (keep this module pure string).
 * byUser breakdown is dropped for CSV response-time (daily series only) — noted.
 */
import { getConversionFunnel } from './reports/conversion-funnel.js';
import { getTeamPerformance } from './reports/team-performance.js';
import { getResponseTimeAnalysis } from './reports/response-time.js';
import { getResponseHeatmap } from './reports/heatmap.js';
import { getTagDistribution } from './reports/tag-distribution.js';
import { getDripKpi } from './reports/drip-kpi.js';

export interface ReportFilters {
  zaloAccountId?: string;
  assignedUserId?: string;
}

const EXPORT_TYPES = ['funnel', 'team', 'response', 'heatmap', 'tags', 'drip'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export function isValidExportType(v: string): v is ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(v);
}

const MAX_ROWS = 50_000;

/** Escape a single CSV field: quote if it contains comma, double-quote, or newline. */
function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines: string[] = [headers.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvField).join(','));
  }
  return lines.join('\r\n');
}

export type ExportResult =
  | { csv: string; filename: string }
  | { error: 'too_large' | 'unknown_type' };

export async function exportCsv(
  orgId: string,
  type: string,
  from: string,
  to: string,
  filters: ReportFilters,
): Promise<ExportResult> {
  if (!isValidExportType(type)) {
    return { error: 'unknown_type' };
  }

  let headers: string[];
  let rows: (string | number | null | undefined)[][];

  switch (type) {
    case 'funnel': {
      const result = await getConversionFunnel(orgId, from, to, filters);
      headers = ['status', 'count', 'rate'];
      rows = result.stages.map((s) => [s.status, s.count, s.rate]);
      break;
    }
    case 'team': {
      const result = await getTeamPerformance(orgId, from, to, filters);
      headers = ['userId', 'fullName', 'messagesSent', 'contactsConverted', 'appointmentsCompleted', 'avgResponseTimeSec'];
      rows = result.users.map((u) => [
        u.userId,
        u.fullName,
        u.messagesSent,
        u.contactsConverted,
        u.appointmentsCompleted,
        u.avgResponseTime,
      ]);
      break;
    }
    case 'response': {
      // byUser dropped for CSV; daily series only (simpler and less likely to exceed cap).
      const result = await getResponseTimeAnalysis(orgId, from, to, filters);
      headers = ['date', 'avgSeconds'];
      rows = result.daily.map((d) => [d.date, d.avgSeconds]);
      break;
    }
    case 'heatmap': {
      const result = await getResponseHeatmap(orgId, from, to, filters);
      headers = ['dow', 'hour', 'avgSeconds', 'sampleCount'];
      rows = result.cells.map((c) => [c.dow, c.hour, c.avgSeconds, c.sampleCount]);
      break;
    }
    case 'tags': {
      const result = await getTagDistribution(orgId, filters);
      headers = ['tagId', 'name', 'color', 'source', 'contactCount', 'percent'];
      rows = result.tags.map((t) => [t.tagId, t.name, t.color, t.source, t.contactCount, t.percent]);
      break;
    }
    case 'drip': {
      const result = await getDripKpi(orgId, from, to, filters);
      headers = ['campaignId', 'name', 'enrolled', 'active', 'completed', 'failed', 'cancelled', 'sendSuccessRate', 'avgDaysToComplete'];
      rows = result.campaigns.map((c) => [
        c.id,
        c.name,
        c.enrolled,
        c.active,
        c.completed,
        c.failed,
        c.cancelled,
        c.sendSuccessRate,
        c.avgDaysToComplete,
      ]);
      break;
    }
    default:
      return { error: 'unknown_type' };
  }

  if (rows.length > MAX_ROWS) {
    return { error: 'too_large' };
  }

  const csv = buildCsv(headers, rows);
  const filename = `${type}-${from}-${to}.csv`;

  return { csv, filename };
}
