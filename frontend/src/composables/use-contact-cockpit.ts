// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-contact-cockpit.ts — Composable cho tab "🎯 CRM" (chat cột 4).
 *
 * Design: docs/designs/CHAT-COL4-CRM-TAB.md (anh chốt 2026-05-22)
 *
 * Backend endpoints (BE Phase 1 ship cùng):
 *   GET  /api/v1/contacts/:id/cockpit?excludeZaloAccountId=<id>
 *   GET  /api/v1/contacts/:id/teammates?excludeZaloAccountId=<id>
 *   POST /api/v1/ai/sales-handoff-message  { contactId, targetUserId, targetZaloAccountId? }
 *
 * Cache strategy: contact-id key, in-memory Map, 60s TTL.
 * Khi chuyển conv mới → composable tự fetch contact mới, không invalidate cache cũ.
 */
import { ref, reactive } from 'vue';
import { api } from '@/api/index';

// ─── Types ───────────────────────────────────────────────────────────────

export interface CockpitData {
  contactId: string;
  fullName: string | null;
  crmName: string | null;
  phone: string | null;
  source: string | null;
  sourceDate: string | null;
  firstContactDate: string | null;
  status: string | null;
  statusRef: { id: string; name: string; color: string | null } | null;
  notes: string | null;
  tags: string[];
  autoTags: string[];
  assignedUser: { id: string; fullName: string } | null;
  getflyLink: { linked: boolean; getflyId: string | null; linkedAt: string | null };
  // Phase 8 score
  priorityScore: number | null;
  priorityUpdatedAt: string | null;
  engagementPattern: string | null;
  engagementTrend: number | null;
  engagementScore: number | null;
  engagementUpdatedAt: string | null;
  leadScore: number;
  // Timeline
  lastInboundAt: string | null;
  lastInboundPreview: string | null;
  lastOutboundAt: string | null;
  lastOutboundPreview: string | null;
  lastInteractionAt: string | null;
  nextAppointment: {
    id?: string;
    title?: string | null;
    at: string;
    type?: string | null;
    location?: string | null;
    status?: string;
    durationMin?: number;
  } | null;
  stuckSinceAggregate: string | null;
  totalInbound: number;
  totalOutbound: number;
  totalAppointments: number;
}

export interface Teammate {
  friendId: string;
  contactId: string;
  zaloAccountId: string;
  zaloUidInNick: string;
  relationshipKind: string;
  friendshipStatus: string;
  aliasInNick: string | null;
  totalInbound: number;
  totalOutbound: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastInteractionAt: string | null;
  becameFriendAt: string | null;
  firstMessageAt: string | null;
  nick: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
    zaloUid: string | null;
    phone: string | null;
    status: string;
  };
  owner: { id: string; fullName: string; email: string } | null;
}

export interface SalesHandoffResult {
  content: string;
  source: 'template' | 'ai' | 'fallback';
  /** UID nick Zalo của sale target — FE mở zalo.me/{uid} để DM giữa 2 sale */
  targetZaloUid: string | null;
  targetZaloAccountName: string | null;
}

// ─── Cache (in-memory, 60s TTL) ─────────────────────────────────────────

type CacheEntry<T> = { data: T; ts: number };
const TTL_MS = 60_000;
const cockpitCache = new Map<string, CacheEntry<CockpitData>>();
const teammatesCache = new Map<string, CacheEntry<Teammate[]>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, data: T) {
  map.set(key, { data, ts: Date.now() });
}

export function invalidateCockpitCache(contactId?: string) {
  if (!contactId) {
    cockpitCache.clear();
    teammatesCache.clear();
    return;
  }
  // Tất cả keys bắt đầu bằng contactId đều xoá (vì có suffix excludeZaloAccountId)
  for (const k of cockpitCache.keys()) if (k.startsWith(contactId)) cockpitCache.delete(k);
  for (const k of teammatesCache.keys()) if (k.startsWith(contactId)) teammatesCache.delete(k);
}

// ─── Composable ──────────────────────────────────────────────────────────

export function useContactCockpit() {
  const cockpit = ref<CockpitData | null>(null);
  const teammates = ref<Teammate[]>([]);
  const loading = reactive({ cockpit: false, teammates: false, handoff: false });
  const error = ref<string | null>(null);

  async function fetchCockpit(contactId: string, excludeZaloAccountId?: string) {
    if (!contactId) {
      cockpit.value = null;
      return;
    }
    const cacheKey = `${contactId}::${excludeZaloAccountId || '_'}`;
    const cached = cacheGet(cockpitCache, cacheKey);
    if (cached) {
      cockpit.value = cached;
      return;
    }
    loading.cockpit = true;
    error.value = null;
    try {
      const params = excludeZaloAccountId ? { excludeZaloAccountId } : undefined;
      const { data } = await api.get<CockpitData>(`/contacts/${contactId}/cockpit`, { params });
      cockpit.value = data;
      cacheSet(cockpitCache, cacheKey, data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      error.value = err.response?.data?.error || err.message || 'Không tải được cockpit';
      cockpit.value = null;
    } finally {
      loading.cockpit = false;
    }
  }

  async function fetchTeammates(contactId: string, excludeZaloAccountId?: string) {
    if (!contactId) {
      teammates.value = [];
      return;
    }
    const cacheKey = `${contactId}::${excludeZaloAccountId || '_'}`;
    const cached = cacheGet(teammatesCache, cacheKey);
    if (cached) {
      teammates.value = cached;
      return;
    }
    loading.teammates = true;
    try {
      const params = excludeZaloAccountId ? { excludeZaloAccountId } : undefined;
      const { data } = await api.get<{ teammates: Teammate[] }>(`/contacts/${contactId}/teammates`, { params });
      teammates.value = data.teammates || [];
      cacheSet(teammatesCache, cacheKey, teammates.value);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      error.value = err.response?.data?.error || err.message || 'Không tải được đồng đội';
      teammates.value = [];
    } finally {
      loading.teammates = false;
    }
  }

  async function generateHandoffMessage(input: {
    contactId: string;
    targetUserId: string;
    targetZaloAccountId?: string;
  }): Promise<SalesHandoffResult | null> {
    loading.handoff = true;
    try {
      const { data } = await api.post<SalesHandoffResult>('/ai/sales-handoff-message', input);
      return data;
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      error.value = err.response?.data?.error || err.message || 'Không soạn được tin AI';
      return null;
    } finally {
      loading.handoff = false;
    }
  }

  /** Bulk loader: fetch cockpit + teammates song song. */
  async function loadAll(contactId: string, excludeZaloAccountId?: string) {
    await Promise.all([
      fetchCockpit(contactId, excludeZaloAccountId),
      fetchTeammates(contactId, excludeZaloAccountId),
    ]);
  }

  return {
    cockpit,
    teammates,
    loading,
    error,
    fetchCockpit,
    fetchTeammates,
    generateHandoffMessage,
    loadAll,
    invalidate: invalidateCockpitCache,
  };
}
