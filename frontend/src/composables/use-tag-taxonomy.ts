// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-tag-taxonomy.ts — Shared cache cho Tag v2 taxonomy (Tag model), index theo SLUG.
 *
 * Vấn đề: các field legacy (Friend.crmTagsPerNick, Contact.tags, Friend.autoTags) lưu SLUG
 * của tag v2 (vd "tiem-nang"). UI cột 2 (ConversationList) trước đây render thẳng slug →
 * sale thấy "tiem-nang" thay vì "Tiềm Năng".
 *
 * Giải pháp: fetch /tags (scope=friend + scope=crm) 1 lần, build Map slug→{name,color,emoji}.
 * displayTags() tra Map này để render TÊN + màu chuẩn. Fallback raw slug nếu không tìm thấy def.
 *
 * Khác use-crm-tag-defs.ts (legacy CrmTag table, index theo NAME — dùng cho tag Zalo mirror).
 * Module-level cache share toàn app, reactive ref để component re-render khi load xong.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface TagTaxonomyDef {
  id: string;
  name: string;
  slug: string;
  color: string;
  emoji: string | null;
  scope: 'friend' | 'crm';
  source: string;
}

// Reactive version counter — bump sau mỗi lần load để computed/displayTags re-evaluate.
const taxonomyVersion = ref(0);
const tagsBySlug = new Map<string, TagTaxonomyDef>();
let fetchedOnce = false;
let inflightPromise: Promise<void> | null = null;

async function doFetch() {
  try {
    const [friendRes, crmRes] = await Promise.all([
      api.get('/tags', { params: { scope: 'friend', limit: 500 } }),
      api.get('/tags', { params: { scope: 'crm', limit: 500 } }),
    ]);
    tagsBySlug.clear();
    for (const raw of [...(friendRes.data.tags || []), ...(crmRes.data.tags || [])]) {
      const def = raw as TagTaxonomyDef;
      if (def.slug) tagsBySlug.set(def.slug, def);
    }
    fetchedOnce = true;
    taxonomyVersion.value++;
  } catch (err) {
    console.warn('[use-tag-taxonomy] Cannot load tag taxonomy', err);
  } finally {
    inflightPromise = null;
  }
}

/** Lazy load — chỉ fetch 1 lần per session. Concurrent calls dedup qua inflightPromise. */
export async function loadTagTaxonomy(): Promise<void> {
  if (fetchedOnce) return;
  if (inflightPromise) return inflightPromise;
  inflightPromise = doFetch();
  return inflightPromise;
}

/** Force refetch sau khi Tag taxonomy thay đổi (settings page edit). */
export async function refreshTagTaxonomy(): Promise<void> {
  fetchedOnce = false;
  inflightPromise = doFetch();
  return inflightPromise;
}

/** Lookup def theo slug. Return null nếu không có (free-text tag / chưa load). */
export function findTagBySlug(slug: string): TagTaxonomyDef | null {
  return tagsBySlug.get(slug) || null;
}

export function useTagTaxonomy() {
  return { taxonomyVersion, loadTagTaxonomy, refreshTagTaxonomy, findTagBySlug };
}
