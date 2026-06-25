// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * source-badge.ts — Nhãn / icon / khoá-CSS cho NGUỒN lead (Phase Multi-Source 2026-06-23).
 *
 * Dùng chung cho ListsView (cấp tệp, từ platforms[]) + ListDetailView (cấp lead, từ sourceMeta.source).
 * `source` = giá trị trong CustomerListEntry.sourceMeta.source ('fb-leadads' | 'tiktok-leadgen' | 'zalo-ads' | ...).
 */

export interface SourceBadge {
  key: string; // dùng cho class CSS màu (src-fb / src-tiktok / ...)
  label: string; // nhãn ngắn hiển thị
  icon: string; // emoji
}

const MAP: Record<string, SourceBadge> = {
  'fb-leadads': { key: 'fb', label: 'Facebook', icon: '📘' },
  'tiktok-leadgen': { key: 'tiktok', label: 'TikTok', icon: '🎵' },
  'zalo-ads': { key: 'zalo', label: 'Zalo', icon: '💙' },
  'google-leadform': { key: 'google', label: 'Google', icon: '🔍' },
};

const MANUAL: SourceBadge = { key: 'manual', label: 'Thủ công', icon: '✋' };
const LEADADS_UNKNOWN: SourceBadge = { key: 'leadads', label: 'Lead Ads', icon: '⚡' };

/** Badge cho 1 source string. null/không khớp → Thủ công. */
export function sourceBadge(source: string | null | undefined): SourceBadge {
  if (!source) return MANUAL;
  return MAP[source] ?? { key: 'other', label: source, icon: '🏷️' };
}

/**
 * Badge cấp TỆP. platforms[] = các nguồn có lead trong tệp (BE trả).
 * - Có nguồn → badge từng nền tảng.
 * - Rỗng nhưng tệp là loại tự động (leadads/api) → "⚡ Lead Ads" (chưa có lead để biết nền tảng).
 * - Còn lại → "✋ Thủ công".
 */
export function listSourceBadges(platforms: string[] | null | undefined, sourceType?: string): SourceBadge[] {
  if (platforms && platforms.length) return platforms.map((p) => sourceBadge(p));
  if (sourceType === 'leadads' || sourceType === 'api') return [LEADADS_UNKNOWN];
  return [MANUAL];
}

/** Options cho dropdown lọc nền tảng ở trang Tệp. value khớp BE query `leadSource`. */
export const SOURCE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tất cả nguồn' },
  { value: 'fb-leadads', label: '📘 Facebook' },
  { value: 'tiktok-leadgen', label: '🎵 TikTok' },
  { value: 'zalo-ads', label: '💙 Zalo' },
  { value: 'manual', label: '✋ Thủ công' },
];
