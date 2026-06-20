// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
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

// 2026-06-08 — Khớp source of truth backend (scoring/types.ts AutoTagKey +
// frontend constants/auto-tags.ts). Trước đây dùng 'hot' KHÔNG tồn tại trong DB
// → nút Auto-tag "Hot" luôn ra rỗng. Bộ key thật: active/cooling/cold/frozen/
// rewarmed/stuck/ready/atrisk/has-appointment.
export type AutoTagKey =
  | 'active' | 'cooling' | 'cold' | 'frozen' | 'rewarmed'
  | 'stuck' | 'ready' | 'atrisk' | 'has-appointment';
export type EngagementPatternKey = 'hot' | 'champion' | 'stable' | 'cooling' | 'cold';
export type ScoreTier = 'cold' | 'warm' | 'hot' | 'champion' | null;
export type StuckDuration = '>3d' | '>7d' | '>14d' | '>30d' | null;
export type LastMessageWithin = '24h' | '7d' | '30d' | '>30d' | 'custom' | null;
export type SaleAssigneeFilter = string | null | 'all' | 'unassigned';
// 2026-06-09 — Nhóm lọc "Tin nhắn" (user vs bot), radio 1-of-3 (null = không lọc).
//   unanswered  = tin cuối là khách, chưa ai trả lời
//   bot_no_sale = sau lượt khách cuối chỉ có bot, chưa sale nào
//   sale_replied= có tin sale thật sau lượt khách cuối
export type MessageReplyState = 'unanswered' | 'bot_no_sale' | 'sale_replied' | null;

export interface FilterState {
  folderId: string | null;
  saleAssigneeId: SaleAssigneeFilter;
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
  // ─── NEW Tier 1 deep CRM filter (v3 mockup) ──────────────
  autoTags: AutoTagKey[];
  scoreMin: number | null;
  scoreMax: number | null;
  scoreTier: ScoreTier;
  stages: string[];
  stuckDuration: StuckDuration;
  lastMessageWithin: LastMessageWithin;
  customerWaitingReply: boolean;
  saleWaitingReply: boolean;
  birthdayWithin7d: boolean;
  appointmentWithin24h: boolean;
  appointmentOverdue: boolean;
  // Phase 8 — Engagement heatmap patterns
  engagementPatterns: EngagementPatternKey[];
  // 2026-06-09 — Nhóm lọc "Tin nhắn" (user vs bot), radio 1-of-3
  messageReplyState: MessageReplyState;
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
    // Tier 1 deep CRM filter defaults
    autoTags: [],
    scoreMin: null,
    scoreMax: null,
    scoreTier: null,
    stages: [],
    stuckDuration: null,
    lastMessageWithin: null,
    customerWaitingReply: false,
    saleWaitingReply: false,
    birthdayWithin7d: false,
    appointmentWithin24h: false,
    appointmentOverdue: false,
    engagementPatterns: [],
    messageReplyState: null,
  };
}

// ─── Composable ─────────────────────────────────────────────────────────

export function useInboxFilters() {
  const state = reactive<FilterState>(defaultFilterState());
  const folders = ref<AccountFolder[]>([]);
  const presets = ref<SavedFilterPreset[]>([]);
  // 2026-06-08 — map statusId → tên Trạng thái KH, để chip footer hiện tên thật
  // (state.stages chứa statusId). Sidebar set sau khi loadStatuses().
  const stageNameMap = ref<Record<string, string>>({});
  const activePresetId = ref<string | null>(null);
  const loading = ref(false);

  // ─── Folder API ───────────────────────────────────────────────────────
  // 2026-06-11 — số đếm folder cột 1 lọc theo CÙNG key tab đang chọn để các bộ
  // lọc link với nhau (anh chốt). Gửi threadType/tab dịch từ activeTab xuống BE.
  async function fetchFolders() {
    const params: Record<string, string> = {};
    switch (state.activeTab) {
      case 'personal': params.threadType = 'user'; break;
      case 'group':    params.threadType = 'group'; break;
      case 'main':     params.tab = 'main'; break;
      case 'other':    params.tab = 'other'; break;
    }
    const { data } = await api.get('/account-folders', { params });
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

  // 2026-06-11 — Tự tạo thư mục theo nick: mỗi sale có nick → 1 thư mục (đồng bộ
  // thông minh, không xóa chỉnh tay). Trả { ownersWithNicks, createdFolders, addedMembers }.
  async function syncFoldersByOwner() {
    const { data } = await api.post('/account-folders/sync-by-owner');
    await fetchFolders();
    return data as { ok: boolean; ownersWithNicks: number; createdFolders: number; addedMembers: number };
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

    // ─── NEW Tier 1 deep CRM filter params ──────────────
    // 2026-06-08 — BE đọc key `autoTagsAny` (CSV), KHÔNG phải `autoTags`. Trước đây
    // FE gửi sai tên → nút Auto-tag (Hot/Active/Stuck/Cold) sáng nhưng không lọc.
    if (state.autoTags.length > 0) params.autoTagsAny = state.autoTags.join(',');
    if (state.scoreMin !== null) params.scoreMin = String(state.scoreMin);
    if (state.scoreMax !== null) params.scoreMax = String(state.scoreMax);
    if (state.scoreTier) params.scoreTier = state.scoreTier;
    if (state.stages.length > 0) params.stages = state.stages.join(',');
    if (state.stuckDuration) params.stuckDuration = state.stuckDuration;
    if (state.lastMessageWithin) params.lastMessageWithin = state.lastMessageWithin;
    if (state.customerWaitingReply) params.customerWaitingReply = 'true';
    if (state.saleWaitingReply) params.saleWaitingReply = 'true';
    if (state.birthdayWithin7d) params.birthdayWithin7d = 'true';
    if (state.appointmentWithin24h) params.appointmentWithin24h = 'true';
    if (state.appointmentOverdue) params.appointmentOverdue = 'true';
    if (state.saleAssigneeId === 'unassigned') params.assignedUserId = 'unassigned';
    // Phase 8 — Engagement pattern filter
    if (state.engagementPatterns.length > 0) {
      params.engagementPattern = state.engagementPatterns.join(',');
    }
    // 2026-06-09 — Nhóm lọc "Tin nhắn" (user vs bot)
    if (state.messageReplyState) params.messageReplyState = state.messageReplyState;

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
      state.searchQuery.length > 0 ||
      // Tier 1 new filters
      state.autoTags.length > 0 ||
      state.scoreMin !== null ||
      state.scoreMax !== null ||
      state.scoreTier !== null ||
      state.stages.length > 0 ||
      state.stuckDuration !== null ||
      state.lastMessageWithin !== null ||
      state.customerWaitingReply ||
      state.saleWaitingReply ||
      state.birthdayWithin7d ||
      state.appointmentWithin24h ||
      state.appointmentOverdue ||
      state.engagementPatterns.length > 0 ||
      state.messageReplyState !== null
    );
  });

  /** Chip list cho footer "Active filter" — mỗi chip có label + removeFn */
  const activeFilterChips = computed<Array<{ key: string; label: string; remove: () => void }>>(() => {
    const chips: Array<{ key: string; label: string; remove: () => void }> = [];
    for (const t of state.tagsCrm) {
      chips.push({
        key: `crm:${t}`,
        label: `🏷 ${t}`,
        remove: () => {
          state.tagsCrm = state.tagsCrm.filter(x => x !== t);
          activePresetId.value = null;
        },
      });
    }
    for (const t of state.tagsZalo) {
      chips.push({
        key: `zalo:${t}`,
        label: `🔵 ${t}`,
        remove: () => {
          state.tagsZalo = state.tagsZalo.filter(x => x !== t);
          activePresetId.value = null;
        },
      });
    }
    const AUTO_TAG_CHIP: Record<string, string> = {
      active: '🔥 Hoạt động', ready: '💯 Sẵn sàng chốt', stuck: '⏰ Đình trệ',
      cold: '🧊 Nguội', cooling: '❄️ Đang nguội', frozen: '🥶 Đóng băng',
      rewarmed: '🔄 Ấm trở lại', atrisk: '🚧 Có nguy cơ', 'has-appointment': '📅 Có lịch hẹn',
    };
    for (const at of state.autoTags) {
      chips.push({
        key: `auto:${at}`,
        label: AUTO_TAG_CHIP[at] ?? at,
        remove: () => {
          state.autoTags = state.autoTags.filter(x => x !== at);
          activePresetId.value = null;
        },
      });
    }
    if (state.scoreMin !== null || state.scoreMax !== null) {
      chips.push({
        key: 'score',
        label: `Score ${state.scoreMin ?? 0}-${state.scoreMax ?? 100}`,
        remove: () => {
          state.scoreMin = null;
          state.scoreMax = null;
          state.scoreTier = null;
          activePresetId.value = null;
        },
      });
    }
    for (const s of state.stages) {
      chips.push({
        key: `stage:${s}`,
        label: stageNameMap.value[s] ?? s,
        remove: () => {
          state.stages = state.stages.filter(x => x !== s);
          activePresetId.value = null;
        },
      });
    }
    if (state.stuckDuration) {
      chips.push({
        key: 'stuck',
        label: `Stuck ${state.stuckDuration}`,
        remove: () => { state.stuckDuration = null; activePresetId.value = null; },
      });
    }
    if (state.lastMessageWithin) {
      chips.push({
        key: 'lastMsg',
        label: `Tin ${state.lastMessageWithin}`,
        remove: () => { state.lastMessageWithin = null; activePresetId.value = null; },
      });
    }
    if (state.customerWaitingReply) {
      chips.push({
        key: 'kh-wait',
        label: 'KH chờ reply',
        remove: () => { state.customerWaitingReply = false; activePresetId.value = null; },
      });
    }
    if (state.saleWaitingReply) {
      chips.push({
        key: 'sale-wait',
        label: 'Sale chờ reply',
        remove: () => { state.saleWaitingReply = false; activePresetId.value = null; },
      });
    }
    if (state.birthdayWithin7d) {
      chips.push({
        key: 'bday',
        label: '🎂 SN 7d',
        remove: () => { state.birthdayWithin7d = false; activePresetId.value = null; },
      });
    }
    if (state.appointmentWithin24h) {
      chips.push({
        key: 'appt-24h',
        label: '📞 Hẹn 24h',
        remove: () => { state.appointmentWithin24h = false; activePresetId.value = null; },
      });
    }
    if (state.appointmentOverdue) {
      chips.push({
        key: 'appt-overdue',
        label: '⚠️ Quá hạn',
        remove: () => { state.appointmentOverdue = false; activePresetId.value = null; },
      });
    }
    if (state.saleAssigneeId === 'all') {
      chips.push({ key: 'sale-all', label: '👥 Tất cả sale', remove: () => { state.saleAssigneeId = null; activePresetId.value = null; } });
    } else if (state.saleAssigneeId === 'unassigned') {
      chips.push({ key: 'sale-none', label: '🆕 Chưa giao', remove: () => { state.saleAssigneeId = null; activePresetId.value = null; } });
    }
    // Phase 8 — Engagement patterns
    const PATTERN_CHIP_LABELS: Record<EngagementPatternKey, string> = {
      hot: '🔥 Đang nóng',
      champion: '💎 Champion',
      stable: '📈 Ổn định',
      cooling: '⚠ Đang nguội',
      cold: '😴 Lạnh',
    };
    for (const p of state.engagementPatterns) {
      chips.push({
        key: `eng:${p}`,
        label: PATTERN_CHIP_LABELS[p],
        remove: () => {
          state.engagementPatterns = state.engagementPatterns.filter((x) => x !== p);
          activePresetId.value = null;
        },
      });
    }
    // 2026-06-09 — Nhóm "Tin nhắn" (user vs bot)
    if (state.messageReplyState) {
      const MSG_REPLY_LABELS: Record<NonNullable<MessageReplyState>, string> = {
        unanswered: '✉️ Chưa trả lời',
        bot_no_sale: '🤖 Bot trả lời (No Sale)',
        sale_replied: '✅ Sale đã trả lời',
      };
      chips.push({
        key: 'msg-reply',
        label: MSG_REPLY_LABELS[state.messageReplyState],
        remove: () => { state.messageReplyState = null; activePresetId.value = null; },
      });
    }
    return chips;
  });

  return {
    state,
    folders,
    presets,
    activePresetId,
    stageNameMap,
    loading,
    hasActiveFilter,
    activeFilterChips,
    // Folder API
    fetchFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    setFolderMembers,
    reorderFolders,
    syncFoldersByOwner,
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
