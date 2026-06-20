// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-contact-profile.ts — Composable cho tab "Hồ sơ KH tổng hợp".
 *
 * STATUS: SKELETON STUB — Phase Y (future). Backend endpoint
 *   GET /api/v1/contacts/:id/profile chưa implement.
 *   Composable này chỉ define API contract + return mock data để
 *   ContactProfileView render được skeleton UI.
 *
 * Khi backend sẵn sàng:
 *   1. Bỏ MOCK in fetchContactProfile(), uncomment api.get(...)
 *   2. Verify response shape khớp ContactProfileResponse
 *   3. Wire pagination cho friends list nếu KH có > 50 nick
 *   4. Cache 60s/contact để tránh refetch quá nhiều
 */
import { ref } from 'vue';
// import { api } from '@/api/index'; // TODO(phase-Y): uncomment khi backend sẵn sàng

// ─── Types: API contract (cần backend implement) ────────────────────────

export interface ContactProfileResponse {
  contact: {
    id: string;
    displayName: string;
    fullName: string | null;
    crmName: string | null;
    /** 3 field này ẨN khỏi ChatContactPanel cột 4, chỉ hiển thị ở đây */
    email: string | null;
    addressLine: string | null;
    occupation: string | null;
    /** Multi-phone */
    phone: string | null;
    phone2: string | null;
    phone3: string | null;
    /** Profile demographics */
    gender: string | null;
    birthDate: string | null;
    birthYear: number | null;
    province: string | null;
    district: string | null;
    ward: string | null;
    /** Aggregated từ Friend rows */
    leadScore: number;
    statusId: string | null;
    statusName: string | null;
    avatarUrl: string | null;
  };
  /** Tất cả Friend rows (per-pair) của KH này */
  friends: Array<{
    id: string;
    zaloUid: string | null;
    accountId: string;
    accountName: string | null;
    displayName: string | null;
    aliasInNick: string | null;
    leadScore: number;
    statusName: string | null;
    relationshipKind: string;
    totalInbound: number;
    totalOutbound: number;
    lastInboundAt: string | null;
  }>;
  /** Score MAX across friends (Phase 6 architecture) */
  aggregateScore: number;
  /** Tags gộp từ Contact.tags + UNION(Friend.crmTagsPerNick) — dedupe */
  aggregateTags: string[];
  /** Sale có Friend leadScore cao nhất + lastInboundAt < 14d */
  primaryOwner: {
    userId: string;
    userName: string;
  } | null;
}

// ─── Composable ─────────────────────────────────────────────────────────

export function useContactProfile() {
  const profile = ref<ContactProfileResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchContactProfile(contactId: string): Promise<ContactProfileResponse | null> {
    loading.value = true;
    error.value = null;
    try {
      // TODO(phase-Y): Uncomment khi backend GET /api/v1/contacts/:id/profile sẵn sàng
      // const { data } = await api.get(`/contacts/${contactId}/profile`);
      // profile.value = data;

      // MOCK: response shape hiện tại — backend chưa có endpoint này.
      // Trả dữ liệu placeholder để ContactProfileView render được skeleton.
      profile.value = mockProfileResponse(contactId);
      return profile.value;
    } catch (err: any) {
      error.value = err?.response?.data?.error || err?.message || 'failed';
      return null;
    } finally {
      loading.value = false;
    }
  }

  function clear() {
    profile.value = null;
    error.value = null;
  }

  return { profile, loading, error, fetchContactProfile, clear };
}

// ─── MOCK placeholder (xoá khi backend sẵn sàng) ────────────────────────

function mockProfileResponse(contactId: string): ContactProfileResponse {
  return {
    contact: {
      id: contactId,
      displayName: 'Đang tải hồ sơ tổng hợp...',
      fullName: null,
      crmName: null,
      email: null,
      addressLine: null,
      occupation: null,
      phone: null,
      phone2: null,
      phone3: null,
      gender: null,
      birthDate: null,
      birthYear: null,
      province: null,
      district: null,
      ward: null,
      leadScore: 0,
      statusId: null,
      statusName: null,
      avatarUrl: null,
    },
    friends: [],
    aggregateScore: 0,
    aggregateTags: [],
    primaryOwner: null,
  };
}
