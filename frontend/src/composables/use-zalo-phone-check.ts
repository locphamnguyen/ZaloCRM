// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-zalo-phone-check.ts — Phase user-create-with-zalo 2026-05-27
 *
 * Composable cho admin check SĐT sale có Zalo + quan hệ với nick hệ thống.
 * Wrap POST /users/check-zalo-by-phone, expose reactive state.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export type FriendRelation = 'friend' | 'received_from_them' | 'sent_by_me' | 'none';

export interface ZaloPreview {
  uid: string;
  displayName: string;
  zaloName: string;
  avatar: string;
  gender: number | string;
  dob: number;
  sdob: string;
  globalId: string;
}

export interface CheckZaloResult {
  found: boolean;
  preview: ZaloPreview | null;
  relation: FriendRelation;
  warnings: string[];
  error: string | null;
}

const RELATION_LABEL: Record<FriendRelation, { label: string; emoji: string; tone: 'success' | 'warning' | 'info' | 'grey'; help: string }> = {
  friend: {
    label: 'Đã là bạn',
    emoji: '🟢',
    tone: 'success',
    help: 'Tin login sẽ vào hộp chat chính của sale',
  },
  received_from_them: {
    label: 'Sale đã gửi lời mời — tự đồng ý',
    emoji: '🟡',
    tone: 'warning',
    help: 'Bấm xác nhận sẽ tự accept friend request → tin login vào hộp chat chính',
  },
  sent_by_me: {
    label: 'Đã gửi lời mời — đợi sale accept',
    emoji: '🔵',
    tone: 'info',
    help: 'Tin login sẽ vào tab "Người lạ" cho đến khi sale accept friend',
  },
  none: {
    label: 'Chưa kết bạn',
    emoji: '⚪',
    tone: 'grey',
    help: 'Tin login sẽ vào tab "Người lạ" của sale — sale cần chủ động check',
  },
};

export function useZaloPhoneCheck() {
  const loading = ref(false);
  const result = ref<CheckZaloResult | null>(null);
  const error = ref('');
  let lastCheckedPhone = '';

  async function check(phone: string) {
    if (!phone || phone === lastCheckedPhone) return;
    loading.value = true;
    error.value = '';
    try {
      const { data } = await api.post('/users/check-zalo-by-phone', { phone });
      result.value = data as CheckZaloResult;
      lastCheckedPhone = phone;
      if (data.error) error.value = data.error;
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Lỗi check Zalo';
      error.value = msg;
      result.value = null;
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    result.value = null;
    error.value = '';
    lastCheckedPhone = '';
  }

  return { loading, result, error, check, reset, RELATION_LABEL };
}
