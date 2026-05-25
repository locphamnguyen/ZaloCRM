/**
 * Composable cho Tệp khách hàng (CustomerList).
 *  - List view: fetchLists (filter status: active/archived/all)
 *  - Detail: fetchListById, fetchEntries (tab filter)
 *  - Mutations: create, archive, unarchive, rescan, deleteList, bulkEntries
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';

export interface FbSourceDto {
  formId: string;
  formName: string;
  pageName: string | null;
  lastLeadAt: string | null;
  totalFbLeads: number;
}

export interface CustomerListSummary {
  id: string;
  name: string;
  iconEmoji: string | null;
  sourceType: string;
  status: 'processing' | 'done' | 'archived';
  archivedAt: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  createdById: string;
  createdBy: { id: string; fullName: string | null; email: string } | null;
  totalEntries: number;
  validEntries: number;
  invalidEntries: number;
  dupInListEntries: number;
  dupCrossListEntries: number;
  dupWithContactEntries: number;
  hasZaloEntries: number;
  noZaloEntries: number;
  pendingLookupEntries: number;
  facebookSource: FbSourceDto | null;
}

export interface MappedRow {
  phone: string;
  name?: string | null;
  personalNote?: string | null;
}

export type SystemMessageType =
  | 'DUP_IN_LIST'
  | 'DUP_CROSS_LIST'
  | 'DUP_WITH_CRM'
  | 'INVALID_FORMAT'
  | 'INVALID_PREFIX'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'EMPTY'
  | 'SKIPPED_BY_SALE'
  | 'PHONE_EDITED'
  | 'ENRICHED_NO_MATCH';

export interface SystemMessage {
  type: SystemMessageType;
  text: string;
  ts: string;
  payload?: Record<string, unknown>;
}

export type Lifecycle = 'NEW' | 'WAITING_SCAN' | 'HAS_ZALO' | 'NO_ZALO' | 'INVALID';

export interface CustomerListEntry {
  id: string;
  customerListId: string;
  rowIndex: number;
  phoneRaw: string;
  nameRaw: string | null;
  personalNote: string | null;
  systemMessages: SystemMessage[];
  phoneE164: string | null;
  phoneLocal: string | null;
  phoneValid: boolean;
  invalidReason: string | null;
  contactId: string | null;
  zaloUid: string | null;
  zaloGlobalId: string | null;
  zaloName: string | null;
  resolvedByNickId: string | null;
  resolvedByNick: { id: string; displayName: string | null; phone: string | null } | null;
  multiNickCount: number;
  hasZalo: boolean | null;
  dupInListWithEntryId: string | null;
  dupWithListId: string | null;
  dupWithListEntryId: string | null;
  dupWithListName: string | null;
  dupWithContactId: string | null;
  status: string;
  errorMessage: string | null;
  enrichedAt: string | null;
  // Facebook Lead Ads metadata (optional — only populated for FB-source entries)
  fbLeadgenId?: string | null;
  fbAdId?: string | null;
  fbAdName?: string | null;
  fbAdsetId?: string | null;
  fbAdsetName?: string | null;
  fbCampaignId?: string | null;
  fbCampaignName?: string | null;
  fbFormId?: string | null;
  fbFormName?: string | null;
  fbInboxUrl?: string | null;
  fbPlatform?: string | null;
  fbIsOrganic?: boolean | null;
  fbCustomAnswers?: Array<{ question: string; answer: string }> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DryRunResult {
  total: number;
  valid: number;
  invalid: number;
  dupInList: number;
  dupCrossList: number;
  dupWithCrm: number;
  sample: any[];
}

export type ListStatusFilter = 'active' | 'archived' | 'all';
export type EntryStatusTab =
  | 'all'
  | 'valid'
  | 'invalid'
  | 'dup'
  | 'dup_in_list'
  | 'dup_cross_list'
  | 'dup_with_crm'
  | 'has_zalo'
  | 'no_zalo';

export function useCustomerLists() {
  // Lists state
  const lists = ref<CustomerListSummary[]>([]);
  const listsTotal = ref(0);
  const loadingLists = ref(false);
  const listsStatus = ref<ListStatusFilter>('active');
  const listsSearch = ref('');
  const listsPage = ref(1);
  const listsLimit = ref(20);

  // Detail state
  const currentList = ref<CustomerListSummary | null>(null);
  const entries = ref<CustomerListEntry[]>([]);
  const entriesTotal = ref(0);
  const loadingEntries = ref(false);
  const entryTab = ref<EntryStatusTab>('all');
  const entrySearch = ref('');
  const entryPage = ref(1);
  const entryLimit = ref(50);

  // Selection for bulk
  const selectedEntryIds = ref<Set<string>>(new Set());
  const selectedCount = computed(() => selectedEntryIds.value.size);

  // ───────── Lists ─────────
  async function fetchLists() {
    loadingLists.value = true;
    try {
      const res = await api.get('/customer-lists', {
        params: {
          status: listsStatus.value,
          page: listsPage.value,
          limit: listsLimit.value,
          search: listsSearch.value || undefined,
        },
      });
      lists.value = res.data.lists ?? [];
      listsTotal.value = res.data.total ?? 0;
    } catch (err) {
      console.error('[customer-lists] fetchLists failed:', err);
      lists.value = [];
      listsTotal.value = 0;
    } finally {
      loadingLists.value = false;
    }
  }

  async function fetchListById(id: string) {
    try {
      const res = await api.get(`/customer-lists/${id}`);
      currentList.value = res.data;
      return res.data;
    } catch (err) {
      console.error('[customer-lists] fetchListById failed:', err);
      return null;
    }
  }

  async function dryRun(input: string | MappedRow[]): Promise<DryRunResult | null> {
    try {
      const payload = typeof input === 'string' ? { rawText: input } : { rows: input };
      const res = await api.post('/customer-lists/dry-run', payload);
      return res.data;
    } catch (err) {
      console.error('[customer-lists] dryRun failed:', err);
      return null;
    }
  }

  async function createList(payload: {
    name?: string;
    iconEmoji?: string;
    sourceType?: string;
    rawText?: string;
    rows?: MappedRow[];
  }) {
    try {
      const res = await api.post('/customer-lists', payload);
      await fetchLists();
      return res.data as { id: string; name: string; totalEntries: number };
    } catch (err: any) {
      console.error('[customer-lists] create failed:', err);
      return null;
    }
  }

  async function archiveList(id: string) {
    try {
      await api.post(`/customer-lists/${id}/archive`);
      await fetchLists();
      return true;
    } catch (err) {
      console.error('[customer-lists] archive failed:', err);
      return false;
    }
  }

  async function unarchiveList(id: string) {
    try {
      await api.post(`/customer-lists/${id}/unarchive`);
      await fetchLists();
      return true;
    } catch (err) {
      console.error('[customer-lists] unarchive failed:', err);
      return false;
    }
  }

  async function rescanZalo(id: string) {
    try {
      const res = await api.post(`/customer-lists/${id}/rescan-zalo`);
      return res.data;
    } catch (err) {
      console.error('[customer-lists] rescan failed:', err);
      return null;
    }
  }

  async function deleteList(id: string) {
    try {
      await api.delete(`/customer-lists/${id}`);
      await fetchLists();
      return true;
    } catch (err) {
      console.error('[customer-lists] delete failed:', err);
      return false;
    }
  }

  async function renameList(id: string, name: string) {
    try {
      await api.patch(`/customer-lists/${id}`, { name });
      if (currentList.value?.id === id) currentList.value = { ...currentList.value, name };
      // Refresh lists nếu đang ở list view
      const inLists = lists.value.find((l) => l.id === id);
      if (inLists) inLists.name = name;
      return true;
    } catch (err) {
      console.error('[customer-lists] rename failed:', err);
      return false;
    }
  }

  // ───────── Entries ─────────
  async function fetchEntries(listId: string) {
    loadingEntries.value = true;
    try {
      const res = await api.get(`/customer-lists/${listId}/entries`, {
        params: {
          tab: entryTab.value,
          page: entryPage.value,
          limit: entryLimit.value,
          search: entrySearch.value || undefined,
        },
      });
      entries.value = res.data.entries ?? [];
      entriesTotal.value = res.data.total ?? 0;
    } catch (err) {
      console.error('[customer-lists] fetchEntries failed:', err);
      entries.value = [];
      entriesTotal.value = 0;
    } finally {
      loadingEntries.value = false;
    }
  }

  async function updateEntry(
    listId: string,
    entryId: string,
    patch: { phoneRaw?: string; nameRaw?: string | null; personalNote?: string | null },
  ): Promise<{ entry: CustomerListEntry; conflictWarn: boolean; dupWithListName: string | null } | null> {
    try {
      const res = await api.patch(`/customer-lists/${listId}/entries/${entryId}`, patch);
      // Replace entry in-place trong state
      const idx = entries.value.findIndex((e) => e.id === entryId);
      if (idx !== -1 && res.data?.entry) {
        entries.value[idx] = { ...entries.value[idx], ...res.data.entry, dupWithListName: res.data.dupWithListName ?? null };
      }
      // Refresh counters từ server
      await fetchListById(listId);
      return res.data;
    } catch (err) {
      console.error('[customer-lists] updateEntry failed:', err);
      return null;
    }
  }

  async function addEntries(listId: string, rawText: string) {
    try {
      const res = await api.post(`/customer-lists/${listId}/entries`, { rawText });
      await fetchEntries(listId);
      await fetchListById(listId);
      return res.data as { ok: true; added: number; valid: number; invalid: number };
    } catch (err) {
      console.error('[customer-lists] addEntries failed:', err);
      return null;
    }
  }

  async function deleteEntry(listId: string, entryId: string) {
    try {
      await api.delete(`/customer-lists/${listId}/entries/${entryId}`);
      return true;
    } catch (err) {
      console.error('[customer-lists] deleteEntry failed:', err);
      return false;
    }
  }

  async function bulkResolveEntries(
    listId: string,
    action: 'skip' | 'overwrite' | 'keep_both' | 'delete',
  ) {
    const entryIds = Array.from(selectedEntryIds.value);
    if (entryIds.length === 0) return null;
    try {
      const res = await api.post(`/customer-lists/${listId}/entries/bulk`, { entryIds, action });
      selectedEntryIds.value = new Set();
      await fetchEntries(listId);
      await fetchListById(listId);
      return res.data;
    } catch (err) {
      console.error('[customer-lists] bulk failed:', err);
      return null;
    }
  }

  function toggleSelect(entryId: string) {
    if (selectedEntryIds.value.has(entryId)) selectedEntryIds.value.delete(entryId);
    else selectedEntryIds.value.add(entryId);
    selectedEntryIds.value = new Set(selectedEntryIds.value);
  }

  function selectAllVisible() {
    const ids = entries.value.map((e) => e.id);
    selectedEntryIds.value = new Set(ids);
  }

  function clearSelection() {
    selectedEntryIds.value = new Set();
  }

  function isSelected(entryId: string) {
    return selectedEntryIds.value.has(entryId);
  }

  return {
    // lists
    lists,
    listsTotal,
    loadingLists,
    listsStatus,
    listsSearch,
    listsPage,
    listsLimit,
    fetchLists,
    fetchListById,
    currentList,
    dryRun,
    createList,
    archiveList,
    unarchiveList,
    rescanZalo,
    deleteList,
    renameList,
    updateEntry,
    addEntries,
    deleteEntry,
    // entries
    entries,
    entriesTotal,
    loadingEntries,
    entryTab,
    entrySearch,
    entryPage,
    entryLimit,
    fetchEntries,
    bulkResolveEntries,
    // selection
    selectedEntryIds,
    selectedCount,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    isSelected,
  };
}
