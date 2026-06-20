// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-user-preferences — Read/write per-user prefs (cross-device sync qua backend).
 * Singleton-ish: cache local trong module để tránh nhiều fetch song song.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

const cache = ref<Record<string, unknown> | null>(null);
let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (cache.value) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { data } = await api.get('/me/preferences');
      cache.value = data.preferences || {};
    } catch (err) {
      console.warn('[user-preferences] load error', err);
      cache.value = {};
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export function useUserPreferences() {
  async function getPref<T = unknown>(key: string, fallback: T): Promise<T> {
    await ensureLoaded();
    const v = cache.value?.[key];
    return (v === undefined || v === null ? fallback : v) as T;
  }

  /** Get sync (chỉ trả từ cache, không fetch). Dùng sau khi đã loadPrefs(). */
  function getPrefSync<T = unknown>(key: string, fallback: T): T {
    const v = cache.value?.[key];
    return (v === undefined || v === null ? fallback : v) as T;
  }

  async function setPref(key: string, value: unknown): Promise<void> {
    // Optimistic cache update
    if (!cache.value) cache.value = {};
    cache.value[key] = value;
    try {
      await api.put(`/me/preferences/${encodeURIComponent(key)}`, { value });
    } catch (err) {
      console.warn('[user-preferences] save error', err);
    }
  }

  async function loadPrefs(): Promise<void> {
    await ensureLoaded();
  }

  return { getPref, getPrefSync, setPref, loadPrefs, cache };
}
