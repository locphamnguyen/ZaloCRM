/**
 * use-facebook-channel.ts — State + actions for the Facebook channel settings page.
 *
 * FB-11: Manual mapping removed. Forms are auto-discovered on OAuth callback.
 *
 * Owns:
 *  - pages list (FacebookPageConnectionDto[])
 *  - mappings list (FacebookFormMappingDto[]) — read-only, auto-populated
 *  - per-page rediscover loading state
 *
 * Actions:
 *  - connectPage      — redirect browser to OAuth start URL
 *  - refreshPages     — reload page list + mappings from API
 *  - rediscoverPage   — POST /pages/:pageId/rediscover, then refresh after delay
 *  - disconnectPage   — disconnect a page
 */
import { ref, computed } from 'vue';
import {
  listPages,
  listMappings,
  rediscoverPage as apiRediscoverPage,
  disconnectPage as apiDisconnectPage,
  startFbOAuth,
  type FacebookPageConnectionDto,
  type FacebookFormMappingDto,
} from '@/api/facebook-api';

export function useFacebookChannel() {
  // ── State ────────────────────────────────────────────────────────────────

  const pages = ref<FacebookPageConnectionDto[]>([]);
  const mappings = ref<FacebookFormMappingDto[]>([]);

  const loading = ref(false);
  const error = ref('');

  /** pageId → true while rediscover is in-flight */
  const rediscoveringPages = ref<Record<string, boolean>>({});

  // ── Derived ──────────────────────────────────────────────────────────────

  /** Mappings keyed by pageConnectionId for quick lookup per page */
  const mappingsByPageConnection = computed<Record<string, FacebookFormMappingDto[]>>(() => {
    const result: Record<string, FacebookFormMappingDto[]> = {};
    for (const m of mappings.value) {
      if (!result[m.pageConnectionId]) result[m.pageConnectionId] = [];
      result[m.pageConnectionId].push(m);
    }
    return result;
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Redirect to Meta OAuth. Returns to /settings/channels/facebook after auth. */
  async function connectPage(): Promise<void> {
    try {
      const url = await startFbOAuth();
      window.location.href = url;
    } catch (err) {
      error.value = (err as Error).message || 'Không khởi tạo được kết nối Facebook';
    }
  }

  async function refreshPages(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const [pagesData, mappingsData] = await Promise.all([listPages(), listMappings()]);
      pages.value = pagesData;
      mappings.value = mappingsData;
    } catch (err) {
      error.value = (err as Error).message ?? 'Không thể tải danh sách trang Facebook';
    } finally {
      loading.value = false;
    }
  }

  /**
   * Trigger manual re-discovery for a page.
   * Shows loading state for 5s then refreshes the page list.
   */
  async function rediscoverPage(pageId: string): Promise<void> {
    rediscoveringPages.value = { ...rediscoveringPages.value, [pageId]: true };
    try {
      await apiRediscoverPage(pageId);
      // Give the worker ~5s to finish, then reload
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await refreshPages();
    } catch (err) {
      error.value = (err as Error).message ?? 'Không thể đồng bộ form';
    } finally {
      const { [pageId]: _, ...rest } = rediscoveringPages.value;
      rediscoveringPages.value = rest;
    }
  }

  async function disconnectPage(pageId: string): Promise<{ disabledMappings: number }> {
    const result = await apiDisconnectPage(pageId);
    pages.value = pages.value.filter((p) => p.pageId !== pageId);
    // Remove mappings for this page from local state
    mappings.value = mappings.value.filter(
      (m) => !pages.value.find((p) => p.id === m.pageConnectionId && p.pageId === pageId),
    );
    return result;
  }

  return {
    // state
    pages,
    mappings,
    loading,
    error,
    rediscoveringPages,
    // derived
    mappingsByPageConnection,
    // actions
    connectPage,
    refreshPages,
    rediscoverPage,
    disconnectPage,
  };
}
