/**
 * use-inbox-filters.ts — Composable cho Phase 6+ Inbox Triage Filter (Cột 1 + Cột 2).
 *
 * State:
 *   - folderId — folder Nick Zalo đã chọn (null = ALL)
 *   - saleAssigneeId — sale phụ trách filter (null = self, 'all' = manager view)
 *   - tabType — 'user' | 'group' (Cá nhân / Nhóm)
 *   - tabBox — 'main' | 'other' (Chính / Khác)
 *   - quickPills — set of active pills: 'unread' | 'unanswered' | 'stuck' | 'ready'
 *   - tags — { zalo: string[], crm: string[] } (Nhãn dropdown popup)
 *   - sortMode — 'recent' | 'unread-first'
 *   - timeAxis — 'last-interaction' | 'oldest' | 'crm-added' | 'last-inbound'
 *   - timeRange — 'today' | '7d' | '30d' | { from, to }
 *
 * API:
 *   - getFolders() / createFolder() / updateFolder() / deleteFolder() / setFolderMembers()
 *   - getPresets() / createPreset() / updatePreset() / deletePreset() / usePreset()
 *   - buildQueryParams() — convert state → URLSearchParams cho GET /conversations
 */
import { ref, reactive, computed } from 'vue';
import { api } from '@/api/index';

// ─── Types ──────────────────────────────────────────────────────────────

export interface AccountFolder {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  members: Array<{
    id: string;
    zaloUid: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    status: string;
  }>;
  unreadCount: number;
  totalCount: number;
  createdAt: string;
}

export interface SavedFilterPreset {
  id: string;
  name: string;
  emoji: string;
  filterJson: Record<string, unknown>;
  sortOrder: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export type QuickPillKey = 'unread' | 'unanswered' | 'stuck' | 'ready';
/** 4 tabs single-active (mutually exclusive):
 *   personal = chỉ user-user (threadType=user)
 *   group    = chỉ nhóm (threadType=group)
 *   main     = Hộp thư chính (cả user lẫn nhóm)
 *   other    = Move qua Khác
 */
export type ActiveTab = 'personal' | 'group' | 'main' | 'other';
export type SortMode = 'recent' | 'unread-first';
export type TimeAxis =
  | 'last-interaction'
  | 'oldest'
  | 'crm-added'
  | 'last-inbound';

export interface FilterState {
  folderId: string | null;
  saleAssigneeId: string | null | 'all';
  /** Tab single-active (1 trong 4: personal/group/main/other). Default = main. */
  activeTab: ActiveTab;
  quickPills: Set<QuickPillKey>;
  tagsZalo: string[];
  tagsCrm: string[];
  sortMode: SortMode;
  timeAxis: TimeAxis;
  timeRangePreset: 'today' | '7d' | '30d' | 'custom';
  timeFrom: string | null;
  timeTo: string | null;
  searchQuery: string;
}

// ─── Default state ──────────────────────────────────────────────────────

export function defaultFilterState(): FilterState {
  return {
    folderId: null,
    saleAssigneeId: null,
    activeTab: 'personal', // Default: Cá nhân (user-user 1-1)
    quickPills: new Set(),
    tagsZalo: [],
    tagsCrm: [],
    sortMode: 'recent',
    timeAxis: 'last-interaction',
    timeRangePreset: '7d',
    timeFrom: null,
    timeTo: null,
    searchQuery: '',
  };
}

// ─── Composable ─────────────────────────────────────────────────────────

export function useInboxFilters() {
  const state = reactive<FilterState>(defaultFilterState());
  const folders = ref<AccountFolder[]>([]);
  const presets = ref<SavedFilterPreset[]>([]);
  const activePresetId = ref<string | null>(null);
  const loading = ref(false);

  // ─── Folder API ───────────────────────────────────────────────────────
  async function fetchFolders() {
    const { data } = await api.get('/account-folders');
    folders.value = data.folders;
  }

  async function createFolder(input: { name: string; color?: string; accountIds?: string[] }) {
    const { data } = await api.post('/account-folders', input);
    await fetchFolders();
    return data;
  }

  async function updateFolder(id: string, body: { name?: string; color?: string }) {
    const { data } = await api.put(`/account-folders/${id}`, body);
    await fetchFolders();
    return data;
  }

  async function deleteFolder(id: string) {
    await api.delete(`/account-folders/${id}`);
    if (state.folderId === id) state.folderId = null;
    await fetchFolders();
  }

  async function setFolderMembers(folderId: string, accountIds: string[]) {
    await api.put(`/account-folders/${folderId}/members`, { accountIds });
    await fetchFolders();
  }

  async function reorderFolders(folderIds: string[]) {
    await api.post('/account-folders/reorder', { folderIds });
    await fetchFolders();
  }

  // ─── Preset API ───────────────────────────────────────────────────────
  async function fetchPresets() {
    const { data } = await api.get('/filter-presets');
    presets.value = data.presets;
  }

  async function createPreset(input: { name: string; emoji?: string }) {
    // Serialize current state to filterJson (Set không serialize được → array)
    const filterJson = {
      folderId: state.folderId,
      saleAssigneeId: state.saleAssigneeId,
      activeTab: state.activeTab,
      quickPills: Array.from(state.quickPills),
      tagsZalo: state.tagsZalo,
      tagsCrm: state.tagsCrm,
      sortMode: state.sortMode,
      timeAxis: state.timeAxis,
      timeRangePreset: state.timeRangePreset,
    };
    const { data } = await api.post('/filter-presets', { ...input, filterJson });
    await fetchPresets();
    return data;
  }

  async function deletePreset(id: string) {
    await api.delete(`/filter-presets/${id}`);
    if (activePresetId.value === id) activePresetId.value = null;
    await fetchPresets();
  }

  async function applyPreset(preset: SavedFilterPreset) {
    const j = preset.filterJson as Partial<FilterState> & { quickPills?: string[] };
    if (j.folderId !== undefined) state.folderId = j.folderId;
    if (j.saleAssigneeId !== undefined) state.saleAssigneeId = j.saleAssigneeId;
    if (j.activeTab) state.activeTab = j.activeTab;
    if (j.quickPills) state.quickPills = new Set(j.quickPills as QuickPillKey[]);
    if (j.tagsZalo) state.tagsZalo = j.tagsZalo;
    if (j.tagsCrm) state.tagsCrm = j.tagsCrm;
    if (j.sortMode) state.sortMode = j.sortMode;
    if (j.timeAxis) state.timeAxis = j.timeAxis;
    if (j.timeRangePreset) state.timeRangePreset = j.timeRangePreset;
    activePresetId.value = preset.id;
    // Mark used (fire-and-forget)
    void api.post(`/filter-presets/${preset.id}/use`).catch(() => {});
  }

  // ─── Mutators (clear preset state khi user thay đổi filter thủ công) ──
  function setFolder(id: string | null) {
    state.folderId = id;
    activePresetId.value = null;
  }

  function toggleQuickPill(key: QuickPillKey) {
    if (state.quickPills.has(key)) state.quickPills.delete(key);
    else state.quickPills.add(key);
    activePresetId.value = null;
  }

  function setSortMode(mode: SortMode) {
    state.sortMode = mode;
  }

  function setActiveTab(t: ActiveTab) {
    state.activeTab = t;
    activePresetId.value = null;
  }

  function clearAll() {
    Object.assign(state, defaultFilterState());
    activePresetId.value = null;
  }

  // ─── Build query params cho GET /conversations ────────────────────────
  function buildQueryParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (state.folderId) params.folderId = state.folderId;
    if (state.searchQuery) params.search = state.searchQuery;
    // 4 tabs single-active → translate sang threadType + tab Zalo box
    switch (state.activeTab) {
      case 'personal':
        params.threadType = 'user';
        break;
      case 'group':
        params.threadType = 'group';
        break;
      case 'main':
        params.tab = 'main';
        break;
      case 'other':
        params.tab = 'other';
        break;
    }
    if (state.sortMode === 'unread-first') params.sortMode = 'unread-first';

    // Quick pills → individual query params
    if (state.quickPills.has('unread')) params.unread = 'true';
    if (state.quickPills.has('unanswered')) params.unreplied = 'true';
    if (state.quickPills.has('stuck')) params.stuck = 'true';
    if (state.quickPills.has('ready')) params.ready = 'true';

    // Sale
    if (state.saleAssigneeId === 'all') {
      // No filter, manager xem all
    } else if (state.saleAssigneeId) {
      params.assignedUserId = state.saleAssigneeId;
    }
    // (saleAssigneeId === null = self mặc định, FE handle currentUser fallback)

    // Tags
    if (state.tagsZalo.length > 0) params.zaloLabels = state.tagsZalo.join(',');
    if (state.tagsCrm.length > 0) params.tags = state.tagsCrm.join(',');

    // Time range
    if (state.timeFrom) params.dateFrom = state.timeFrom;
    if (state.timeTo) params.dateTo = state.timeTo;

    return params;
  }

  // Computed: detect xem filter có "khác default" không (để show "Xoá filter" nổi bật)
  const hasActiveFilter = computed(() => {
    return (
      state.folderId !== null ||
      state.saleAssigneeId !== null ||
      state.quickPills.size > 0 ||
      state.tagsZalo.length > 0 ||
      state.tagsCrm.length > 0 ||
      state.sortMode !== 'recent' ||
      state.timeRangePreset !== '7d' ||
      state.searchQuery.length > 0
    );
  });

  return {
    state,
    folders,
    presets,
    activePresetId,
    loading,
    hasActiveFilter,
    // Folder API
    fetchFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    setFolderMembers,
    reorderFolders,
    // Preset API
    fetchPresets,
    createPreset,
    deletePreset,
    applyPreset,
    // Mutators
    setFolder,
    toggleQuickPill,
    setSortMode,
    setActiveTab,
    clearAll,
    // Query
    buildQueryParams,
  };
}
