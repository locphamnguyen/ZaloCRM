// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-crm-tag-defs.ts — Shared cache cho CrmTag definitions (color + managedBy).
 *
 * Mục đích: nhiều component (ConversationList, TagCrmBar, ActivityItem, MessageThread)
 * cần lookup "tag X có phải Zalo-managed không?" + "màu của tag X?" để render TagIcon
 * monochromatic. Trước đây mỗi component tự fetch /crm-tags → duplicate request +
 * inconsistent cache. Module-level Map ở đây fetch 1 lần, share toàn app.
 *
 * Refresh: gọi `refreshTagDefs()` sau khi CrmTag thay đổi (settings page edit / sync).
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface CrmTagDef {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  managedBy: string | null;  // 'zalo_sync' | null
  sourceZaloLabelId: number | null;
  order: number;
  isActive: boolean;
}

const tagDefs = ref<CrmTagDef[]>([]);
const tagsByName = new Map<string, CrmTagDef>();
let fetchedOnce = false;
let inflightPromise: Promise<void> | null = null;

function rebuildIndex() {
  tagsByName.clear();
  for (const t of tagDefs.value) {
    tagsByName.set(t.name, t);
  }
}

async function doFetch() {
  try {
    const { data } = await api.get('/crm-tags');
    tagDefs.value = ((data.tags || []) as CrmTagDef[]).filter(t => t.isActive);
    rebuildIndex();
    fetchedOnce = true;
  } catch (err) {
    console.warn('[use-crm-tag-defs] Cannot load tag defs', err);
  } finally {
    inflightPromise = null;
  }
}

/** Lazy load — chỉ fetch 1 lần per session. Concurrent calls dedup qua inflightPromise. */
export async function loadTagDefs(): Promise<void> {
  if (fetchedOnce) return;
  if (inflightPromise) return inflightPromise;
  inflightPromise = doFetch();
  return inflightPromise;
}

/** Force refetch sau khi CrmTag thay đổi. */
export async function refreshTagDefs(): Promise<void> {
  fetchedOnce = false;
  inflightPromise = doFetch();
  return inflightPromise;
}

/** Lookup tag def theo name. Return null nếu không có. */
export function findTagDef(name: string): CrmTagDef | null {
  return tagsByName.get(name) || null;
}

/** Check xem tag name có phải Zalo-managed không.
 *  Hỗ trợ cả tên cũ có prefix "🔵 " (chưa migrate) và tên mới sạch. */
export function isZaloManaged(name: string): boolean {
  // Tên cũ có prefix → vẫn detect đúng
  if (name.startsWith('🔵 ')) return true;
  const def = findTagDef(name);
  return def?.managedBy === 'zalo_sync';
}

/** Strip prefix "🔵 " nếu có (backward compat cho data cũ chưa migrate). */
export function cleanTagName(name: string): string {
  return name.startsWith('🔵 ') ? name.slice(3) : name;
}

/** Lookup color cho tag. Ưu tiên CrmTag.color, fallback Zalo blue cho mirror tags. */
export function tagColor(name: string): string {
  const cleaned = cleanTagName(name);
  const def = findTagDef(cleaned) || findTagDef(name);
  if (def?.color) return def.color;
  // Fallback: Zalo-mirror tag chưa fetch được def → blue mặc định
  if (name.startsWith('🔵 ')) return '#0068FF';
  return '#6B7280';  // gray
}

export function useCrmTagDefs() {
  return { tagDefs, loadTagDefs, refreshTagDefs, findTagDef, isZaloManaged, cleanTagName, tagColor };
}
