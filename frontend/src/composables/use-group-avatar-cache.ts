// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { reactive } from 'vue';
import { api } from '@/api';

// Cache UID → avatar URL toàn app (persist qua các lần MessageThread re-mount).
// undefined = chưa tra; '' = đã tra, không có; string = avatar URL.
const cache = reactive<Record<string, string>>({});
const pending = new Set<string>();

// 2026-06-11 — accountId = nick của hội thoại nhóm. Truyền xuống để BE CHỈ gọi đúng
// nick đó thay vì thử 30-50 nick (per-nick UID) → tránh lag + đốt quota Zalo trên product.
async function fetchBatch(uids: string[], accountId?: string) {
  const toFetch = Array.from(new Set(uids))
    .filter(u => typeof u === 'string' && u.length > 0 && cache[u] === undefined && !pending.has(u));
  if (toFetch.length === 0) return;
  toFetch.forEach(u => pending.add(u));
  try {
    const res = await api.post('/zalo-user-info/batch', { uids: toFetch, ...(accountId ? { accountId } : {}) });
    const users = (res.data?.users || {}) as Record<string, { avatar?: string } | null>;
    for (const uid of toFetch) {
      cache[uid] = users[uid]?.avatar || '';
    }
  } catch (err) {
    console.error('[group-avatar-cache] batch fetch failed:', err);
    toFetch.forEach(u => { cache[u] = ''; });
  } finally {
    toFetch.forEach(u => pending.delete(u));
  }
}

export const groupAvatarStore = {
  has: (uid: string) => cache[uid] !== undefined,
  get: (uid: string) => cache[uid],
  fetchBatch,
};
