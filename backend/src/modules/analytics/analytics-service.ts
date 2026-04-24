/**
 * analytics-service.ts — Re-exports all analytics report functions + shared types.
 */
export { getConversionFunnel } from './reports/conversion-funnel.js';
export type { ConversionFunnelResult, FunnelStage } from './reports/conversion-funnel.js';

export { getTeamPerformance } from './reports/team-performance.js';
export type { TeamPerformanceResult, TeamMember } from './reports/team-performance.js';

export { getResponseTimeAnalysis } from './reports/response-time.js';
export type { ResponseTimeResult } from './reports/response-time.js';

export { executeCustomReport } from './reports/custom-report.js';
export type { ReportConfig, CustomReportResult } from './reports/custom-report.js';

export { getResponseHeatmap } from './reports/heatmap.js';
export type { HeatmapResult, HeatmapCell } from './reports/heatmap.js';

export { getTagDistribution } from './reports/tag-distribution.js';
export type { TagDistributionResult, TagDistributionItem } from './reports/tag-distribution.js';

export { getDripKpi } from './reports/drip-kpi.js';
export type { DripKpiResult, DripCampaignKpi } from './reports/drip-kpi.js';
