// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-timeline — Fetch unified timeline (Notes + Activity) cho panel KH.
 * Cursor-based pagination, filter theo categories.
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import type { Note } from './use-notes';

export interface ActivityLogItem {
  id: string;
  orgId: string;
  userId: string | null;
  actorType: 'user' | 'bot' | 'system';
  botName: string | null;
  systemSource: string | null;
  category: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  user?: { id: string; fullName: string | null; email: string } | null;
}

export interface TimelineItem {
  type: 'note' | 'activity';
  createdAt: string;
  data: Note | ActivityLogItem;
}

export function useTimeline(getContactId: () => string | null) {
  const items = ref<TimelineItem[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const nextCursor = ref<string | null>(null);
  const hasMore = computed(() => nextCursor.value !== null);

  /**
   * Fetch trang đầu — reset items.
   * @param categories Array of category names ('note' để include Notes, others là activity categories)
   */
  async function fetchFirstPage(categories?: string[]) {
    const contactId = getContactId();
    if (!contactId) {
      items.value = [];
      nextCursor.value = null;
      return;
    }
    loading.value = true;
    try {
      const params: Record<string, string> = { limit: '50' };
      if (categories?.length) params.categories = categories.join(',');
      const { data } = await api.get(`/customers/${contactId}/timeline`, { params });
      items.value = data.items || [];
      nextCursor.value = data.nextCursor || null;
    } catch (err) {
      console.error('[timeline] fetch error', err);
      items.value = [];
      nextCursor.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** Load thêm trang khi scroll near bottom */
  async function loadMore(categories?: string[]) {
    const contactId = getContactId();
    if (!contactId || !nextCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
      const params: Record<string, string> = {
        limit: '50',
        cursor: nextCursor.value,
      };
      if (categories?.length) params.categories = categories.join(',');
      const { data } = await api.get(`/customers/${contactId}/timeline`, { params });
      items.value = [...items.value, ...(data.items || [])];
      nextCursor.value = data.nextCursor || null;
    } catch (err) {
      console.error('[timeline] load more error', err);
    } finally {
      loadingMore.value = false;
    }
  }

  /** Re-fetch trang đầu sau mutation (note create/edit, activity từ user action). */
  async function refresh(categories?: string[]) {
    nextCursor.value = null;
    await fetchFirstPage(categories);
  }

  /** Root notes count cho badge */
  const rootNoteCount = computed(() =>
    items.value.filter(i => i.type === 'note').length,
  );

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    rootNoteCount,
    fetchFirstPage,
    loadMore,
    refresh,
  };
}
