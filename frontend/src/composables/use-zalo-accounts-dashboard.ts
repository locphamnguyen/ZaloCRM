/**
 * Dashboard composable — wraps the existing use-zalo-accounts QR/socket flow
 * and adds the dashboard-specific data: enriched list, team KPI stats,
 * bulk-action, per-account uptime sparkline.
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { useZaloAccounts } from './use-zalo-accounts';

export interface CrewMember {
  accessId: string;
  permission: 'read' | 'chat' | 'admin' | string;
  role: 'owner' | 'editor' | 'viewer';
  user: { id: string; fullName: string | null; email: string };
}

export interface EnrichedAccount {
  id: string;
  zaloUid: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status: string;
  liveStatus: string;
  hasProxy: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
  owner: { id: string; fullName: string | null; email: string } | null;
  crew: CrewMember[];
  crewCount: number;
  msgToday: number;
  quota: number;
  uptime7d: number;
  lastActivityAt: string | null;
  healthAlert: boolean;
}

export interface TeamStats {
  totalNick: number;
  active: number;
  idle: number;
  error: number;
  msgToday: number;
  quota: number;
  uptimeTeam: number;
  needReloginIds: string[];
}

export interface UptimeBucket {
  date: string;
  msgSent: number;
  msgReceived: number;
  hasActivity: boolean;
}

export interface BulkActionResult {
  action: string;
  total: number;
  ok: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

export function useZaloAccountsDashboard() {
  const base = useZaloAccounts();

  const enriched = ref<EnrichedAccount[]>([]);
  const stats = ref<TeamStats | null>(null);
  const loadingEnriched = ref(false);
  const loadingStats = ref(false);

  // Selection state for bulk actions
  const selectedIds = ref<Set<string>>(new Set());
  const selectedCount = computed(() => selectedIds.value.size);

  // Filters
  const search = ref('');
  const statusFilter = ref<'all' | 'active' | 'idle' | 'error'>('all');
  const saleFilter = ref<string>(''); // userId
  const viewMode = ref<'list' | 'cards'>('list');
  const sortMode = ref<'recent' | 'msg-desc' | 'uptime-asc' | 'name'>('recent');

  // Drawer state
  const drawerOpen = ref(false);
  const drawerAccountId = ref<string | null>(null);
  const drawerAccount = computed(() =>
    enriched.value.find((a) => a.id === drawerAccountId.value) ?? null,
  );

  // Uptime sparkline cache (per accountId)
  const uptimeCache = ref<Record<string, UptimeBucket[]>>({});

  // ─────────────────────────────────────────────────────────────────
  // API calls
  // ─────────────────────────────────────────────────────────────────
  async function fetchStats() {
    loadingStats.value = true;
    try {
      const res = await api.get<TeamStats>('/zalo-accounts/stats');
      stats.value = res.data;
    } catch (err) {
      console.error('fetchStats failed:', err);
    } finally {
      loadingStats.value = false;
    }
  }

  async function fetchEnriched() {
    loadingEnriched.value = true;
    try {
      const res = await api.get<EnrichedAccount[]>('/zalo-accounts/enriched');
      enriched.value = res.data;
    } catch (err) {
      console.error('fetchEnriched failed:', err);
    } finally {
      loadingEnriched.value = false;
    }
  }

  async function refreshAll() {
    await Promise.all([fetchStats(), fetchEnriched()]);
  }

  async function fetchUptime(accountId: string, range: '24h' | '7d' | '30d' = '7d') {
    try {
      const res = await api.get<{ buckets: UptimeBucket[]; uptimePct: number }>(
        `/zalo-accounts/${accountId}/uptime?range=${range}`,
      );
      uptimeCache.value[accountId] = res.data.buckets;
      return res.data;
    } catch (err) {
      console.error('fetchUptime failed:', err);
      return null;
    }
  }

  async function bulkAction(action: 'reconnect' | 'sync-contacts' | 'disable') {
    const ids = Array.from(selectedIds.value);
    if (ids.length === 0) return null;

    try {
      const res = await api.post<BulkActionResult>('/zalo-accounts/bulk-action', { ids, action });

      // For sync-contacts the dashboard route is a no-op intent marker; fan out
      // the actual per-account sync calls in parallel here.
      if (action === 'sync-contacts') {
        await Promise.allSettled(
          ids.map((id) => api.post(`/zalo-accounts/${id}/sync-contacts`)),
        );
      }

      await refreshAll();
      return res.data;
    } catch (err: any) {
      console.error('bulkAction failed:', err);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Selection helpers
  // ─────────────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    if (selectedIds.value.has(id)) selectedIds.value.delete(id);
    else selectedIds.value.add(id);
    // Force reactivity on Set
    selectedIds.value = new Set(selectedIds.value);
  }

  function selectAll(ids: string[]) {
    selectedIds.value = new Set(ids);
  }

  function clearSelection() {
    selectedIds.value = new Set();
  }

  function isSelected(id: string) {
    return selectedIds.value.has(id);
  }

  // ─────────────────────────────────────────────────────────────────
  // Drawer helpers
  // ─────────────────────────────────────────────────────────────────
  function openDrawer(accountId: string) {
    drawerAccountId.value = accountId;
    drawerOpen.value = true;
    // Lazy-fetch uptime sparkline when drawer opens
    if (!uptimeCache.value[accountId]) {
      fetchUptime(accountId, '7d');
    }
  }

  function closeDrawer() {
    drawerOpen.value = false;
    drawerAccountId.value = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // Derived: filtered + sorted list
  // ─────────────────────────────────────────────────────────────────
  const filtered = computed<EnrichedAccount[]>(() => {
    let list = enriched.value;

    if (search.value.trim()) {
      const q = search.value.trim().toLowerCase();
      list = list.filter((a) => {
        const name = (a.displayName ?? '').toLowerCase();
        const uid = (a.zaloUid ?? '').toLowerCase();
        const phone = (a.phone ?? '').toLowerCase();
        return name.includes(q) || uid.includes(q) || phone.includes(q);
      });
    }

    if (statusFilter.value !== 'all') {
      list = list.filter((a) => {
        const isConnected = a.liveStatus === 'connected';
        if (statusFilter.value === 'active') return isConnected && a.msgToday > 0;
        if (statusFilter.value === 'idle') return isConnected && a.msgToday === 0;
        if (statusFilter.value === 'error') return !isConnected;
        return true;
      });
    }

    if (saleFilter.value) {
      list = list.filter((a) => a.crew.some((c) => c.user.id === saleFilter.value));
    }

    const sorted = [...list];
    if (sortMode.value === 'recent') {
      sorted.sort((a, b) => {
        const ta = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const tb = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
        return tb - ta;
      });
    } else if (sortMode.value === 'msg-desc') {
      sorted.sort((a, b) => b.msgToday - a.msgToday);
    } else if (sortMode.value === 'uptime-asc') {
      sorted.sort((a, b) => a.uptime7d - b.uptime7d);
    } else if (sortMode.value === 'name') {
      sorted.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
    }
    return sorted;
  });

  // Helpers exposed to UI
  function relativeTime(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return `${m} phút trước`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} giờ trước`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} ngày trước`;
    return date.toLocaleDateString('vi-VN');
  }

  function statusLabel(live: string): { label: string; color: string } {
    if (live === 'connected') return { label: 'Active', color: 'success' };
    if (live === 'connecting' || live === 'qr_pending') return { label: 'Đang kết nối', color: 'warning' };
    return { label: 'Disconnected', color: 'error' };
  }

  function uptimeColor(uptime: number): 'success' | 'warning' | 'error' {
    if (uptime >= 90) return 'success';
    if (uptime >= 80) return 'warning';
    return 'error';
  }

  return {
    // re-export QR/socket flow from base composable
    ...base,
    // dashboard data
    enriched, stats, filtered,
    loadingEnriched, loadingStats,
    // filters
    search, statusFilter, saleFilter, viewMode, sortMode,
    // selection
    selectedIds, selectedCount,
    toggleSelect, selectAll, clearSelection, isSelected,
    // drawer
    drawerOpen, drawerAccountId, drawerAccount, openDrawer, closeDrawer,
    // uptime
    uptimeCache, fetchUptime,
    // actions
    fetchStats, fetchEnriched, refreshAll, bulkAction,
    // helpers
    relativeTime, statusLabel, uptimeColor,
  };
}
