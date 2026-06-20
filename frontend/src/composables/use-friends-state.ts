// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Persistent UI state for FriendsView — nick selection + filters + density survive reload.
 *
 * Priority order on init:
 *   1. URL params (?nick=xxx&kind=friend) → deep-link wins
 *   2. localStorage (last user session)
 *   3. Fallback handled by caller (typically accounts[0])
 *
 * Writes back to BOTH localStorage and URL on every change so a reload restores state,
 * AND the URL is shareable between sales (open a teammate's exact view).
 */
import { ref, watch } from 'vue';

const STORAGE_KEY = 'zalocrm.friends.state.v1';

export type FriendKindFilter = 'all' | 'none' | 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost';
export type DensityMode = 'compact' | 'normal' | 'detailed';

export interface PersistedFriendsState {
  nickId: string | null;     // 'all' for aggregate, or ZaloAccount.id
  kind: FriendKindFilter;
  density: DensityMode;
  careStatus: string;        // '' = all
  ts: number;
}

function readUrlState(): Partial<PersistedFriendsState> | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const nick = url.searchParams.get('nick');
  if (!nick) return null;
  const out: Partial<PersistedFriendsState> = { nickId: nick };
  const kind = url.searchParams.get('kind');
  if (kind) out.kind = kind as FriendKindFilter;
  const care = url.searchParams.get('care');
  if (care !== null) out.careStatus = care;
  return out;
}

function readStorage(): PersistedFriendsState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedFriendsState;
  } catch {
    return null;
  }
}

function writeStorage(s: PersistedFriendsState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // quota or private mode — ignore, URL params still work
  }
}

function syncUrl(s: PersistedFriendsState) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (s.nickId) url.searchParams.set('nick', s.nickId); else url.searchParams.delete('nick');
  if (s.kind && s.kind !== 'all') url.searchParams.set('kind', s.kind); else url.searchParams.delete('kind');
  if (s.careStatus) url.searchParams.set('care', s.careStatus); else url.searchParams.delete('care');
  window.history.replaceState(null, '', url);
}

export function useFriendsState() {
  // Compute initial values: URL beats localStorage beats defaults
  const urlState = readUrlState();
  const stored = readStorage();
  const initial: PersistedFriendsState = {
    nickId: urlState?.nickId ?? stored?.nickId ?? null,
    kind: urlState?.kind ?? stored?.kind ?? 'all',
    density: stored?.density ?? 'normal',
    careStatus: urlState?.careStatus ?? stored?.careStatus ?? '',
    ts: Date.now(),
  };

  const selectedNickId = ref<string | null>(initial.nickId);
  const kindFilter = ref<FriendKindFilter>(initial.kind);
  const density = ref<DensityMode>(initial.density);
  const careStatus = ref<string>(initial.careStatus);
  const restoredFromStorage = ref(!urlState && !!stored?.nickId);
  const restoredNickId = ref<string | null>(stored?.nickId ?? null);

  function persist() {
    const s: PersistedFriendsState = {
      nickId: selectedNickId.value,
      kind: kindFilter.value,
      density: density.value,
      careStatus: careStatus.value,
      ts: Date.now(),
    };
    writeStorage(s);
    syncUrl(s);
  }

  watch([selectedNickId, kindFilter, density, careStatus], persist);

  function reset() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      const url = new URL(window.location.href);
      ['nick', 'kind', 'care'].forEach(k => url.searchParams.delete(k));
      window.history.replaceState(null, '', url);
    }
    selectedNickId.value = null;
    kindFilter.value = 'all';
    density.value = 'normal';
    careStatus.value = '';
    restoredFromStorage.value = false;
  }

  function dismissRestoreToast() {
    restoredFromStorage.value = false;
  }

  return {
    selectedNickId,
    kindFilter,
    density,
    careStatus,
    restoredFromStorage,
    restoredNickId,
    dismissRestoreToast,
    reset,
    persist,
  };
}
