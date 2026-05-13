/**
 * Composable for contact (khách hàng) management:
 * - List with filters, pagination
 * - CRUD operations
 * - CRM pipeline status
 */
import { ref, reactive } from 'vue';
import { api } from '@/api/index';

export interface Contact {
  id: string;
  fullName: string | null;
  crmName?: string | null;
  phone: string | null;
  phone2?: string | null;
  phone3?: string | null;
  phonesExtra?: Array<{ phone: string; label?: string }>;
  email?: string | null;
  avatarUrl?: string | null;
  source: string | null;
  sourceDate?: string | null;
  status: string | null;
  zaloUid?: string | null;
  zaloGlobalId?: string | null;
  zaloUsername?: string | null;
  _count?: { conversations?: number; appointments?: number; children?: number };
  // Aggregate Friend rows theo relationshipKind: friend / pending_friend / chatting_stranger / ghost
  nicksByKind?: Record<string, number>;
  // Parent-child fields (PR 1/PR 2 new):
  parentContactId?: string | null;
  statusId?: string | null;
  statusRef?: { id: string; name: string; order: number; color: string | null; isTerminal: boolean } | null;
  displayStatus?: { id: string; name: string; order: number; color: string | null; isTerminal: boolean } | null;
  displayLeadScore?: number;
  displayHasZalo?: boolean | null;
  childrenCount?: number;
  // Aggregate Zalo identity keys (computed từ Friend rows):
  //   null khi không có data hoặc Friend bất đồng (distinctXxxCount > 1)
  aggregateZaloGlobalId?: string | null;
  aggregateZaloUsername?: string | null;
  distinctGlobalIdCount?: number;
  distinctUsernameCount?: number;
  nextAppointment: string | null;
  notes: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  assignedUserId?: string | null;
  assignedUser?: { id?: string; fullName: string; email?: string } | null;
  createdAt?: string;
  updatedAt?: string;
  firstContactDate?: string | null;
  leadScore: number;
  lastActivity: string | null;
  mergedInto: string | null;

  // Demographic / personal
  gender?: string | null;
  birthYear?: number | null;
  birthDate?: string | null;
  occupation?: string | null;
  incomeRange?: string | null;
  socialFacebook?: string | null;
  socialTiktok?: string | null;
  preferredLang?: string | null;

  // Address
  province?: string | null;
  district?: string | null;
  ward?: string | null;
  addressLine?: string | null;

  // Discovery / Zalo (read-only)
  hasZalo?: boolean | null;
  zaloLookupAt?: string | null;
  zaloLookupAttempts?: number;
  importBatchId?: string | null;

  // Consent
  consentStatus?: string | null;
  consentRevokedAt?: string | null;
  consentSource?: string | null;

  // Aggregate inbound (read-only)
  lastInboundAt?: string | null;
  lastInboundMessageId?: string | null;
  lastInboundPreview?: string | null;
  lastInboundType?: string | null;

  // Aggregate outbound (read-only)
  lastOutboundAt?: string | null;
  lastOutboundMessageId?: string | null;
  lastOutboundPreview?: string | null;
  lastOutboundType?: string | null;
  lastOutboundByUserId?: string | null;
  lastOutboundByZaloAccountId?: string | null;

  // Last interaction (read-only)
  lastInteractionAt?: string | null;
  lastInteractionType?: string | null;
  lastInteractionPayload?: Record<string, unknown> | null;

  // Counter cache (read-only)
  totalInbound?: number;
  totalOutbound?: number;
  totalAppointments?: number;
}

export const GENDER_OPTIONS = [
  { text: 'Nam', value: 'male' },
  { text: 'Nữ', value: 'female' },
  { text: 'Khác', value: 'other' },
  { text: 'Không rõ', value: 'unknown' },
];

export const INCOME_RANGE_OPTIONS = [
  { text: '< 20 triệu', value: 'lt_20m' },
  { text: '20 – 50 triệu', value: '20_50m' },
  { text: '50 – 100 triệu', value: '50_100m' },
  { text: '> 100 triệu', value: 'gt_100m' },
];

export const CONSENT_OPTIONS = [
  { text: 'Mặc định', value: 'implicit' },
  { text: 'Đồng ý', value: 'granted' },
  { text: 'Đã rút', value: 'revoked' },
];

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  image: '📷 Hình ảnh',
  file: '📎 File',
  sticker: '🎴 Sticker',
  voice: '🎤 Voice',
  video: '🎥 Video',
  gif: '🎞️ GIF',
  link: '🔗 Liên kết',
  contact_card: '👤 Danh thiếp',
  location: '📍 Vị trí',
};

/** "Hôm nay 12:49" / "Hôm qua 23:14" / "5/5/2026 14:32" */
export function formatRecentDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const dayOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (dayOfMsg.getTime() === today.getTime()) return `Hôm nay ${hh}:${mm}`;
  if (dayOfMsg.getTime() === yesterday.getTime()) return `Hôm qua ${hh}:${mm}`;
  return `${d.toLocaleDateString('vi-VN')} ${hh}:${mm}`;
}

/** Truncated preview: 60 chars max. Falls back to media-type label when content is empty. */
export function messagePreview(
  content: string | null | undefined,
  contentType: string | null | undefined,
  maxLen = 60,
): string {
  const trimmed = content?.trim();
  if (trimmed) {
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed;
  }
  return CONTENT_TYPE_LABEL[contentType ?? ''] ?? (contentType ?? '');
}

export interface AccountActivityItem {
  zaloAccountId: string;
  zaloAccount: {
    id: string;
    displayName: string | null;
    phone: string | null;
    avatarUrl: string | null;
  };
  conversationId: string;
  totalInbound: number;
  totalOutbound: number;
  lastInbound: { id: string; content: string | null; contentType: string; sentAt: string } | null;
  lastOutbound: {
    id: string;
    content: string | null;
    contentType: string;
    sentAt: string;
    repliedByUserId: string | null;
    repliedBy: { id: string; fullName: string } | null;
  } | null;
}

export interface DuplicateGroup {
  id: string;
  contactIds: string[];
  matchType: string;
  confidence: number;
  resolved: boolean;
  createdAt: string;
  contacts: Contact[];
}

export interface ContactFilters {
  search: string;
  source: string;
  status: string;
  // Mở rộng theo design office-hours 2026-05-13
  statusId?: string;
  assignedUserId?: string;
  threadType?: 'user' | 'group' | '';
  hasZalo?: 'true' | 'false' | 'unknown' | '';
  multiNick?: 'true' | '';
  scoreMin?: number | null;
  scoreMax?: number | null;
  relationshipKindAny?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const SOURCE_OPTIONS = [
  { text: 'Facebook', value: 'FB' },
  { text: 'TikTok', value: 'TT' },
  { text: 'Giới thiệu', value: 'GT' },
  { text: 'Cá nhân', value: 'CN' },
];

export const STATUS_OPTIONS = [
  { text: 'Mới', value: 'new' },
  { text: 'Đã liên hệ', value: 'contacted' },
  { text: 'Quan tâm', value: 'interested' },
  { text: 'Chuyển đổi', value: 'converted' },
  { text: 'Mất', value: 'lost' },
];

export function useContacts() {
  const contacts = ref<Contact[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const saving = ref(false);
  const deleting = ref(false);

  const filters = reactive<ContactFilters>({
    search: '',
    source: '',
    status: '',
    statusId: '',
    assignedUserId: '',
    threadType: '',
    hasZalo: '',
    multiNick: '',
    scoreMin: null,
    scoreMax: null,
    relationshipKindAny: '',
    dateFrom: '',
    dateTo: '',
  });

  const pagination = reactive({ page: 1, limit: 20 });

  async function fetchContacts() {
    loading.value = true;
    try {
      const res = await api.get('/contacts', {
        params: {
          page: pagination.page,
          limit: pagination.limit,
          search: filters.search || undefined,
          source: filters.source || undefined,
          status: filters.status || undefined,
          statusId: filters.statusId || undefined,
          assignedUserId: filters.assignedUserId || undefined,
          threadType: filters.threadType || undefined,
          hasZalo: filters.hasZalo || undefined,
          multiNick: filters.multiNick || undefined,
          scoreMin: filters.scoreMin ?? undefined,
          scoreMax: filters.scoreMax ?? undefined,
          relationshipKindAny: filters.relationshipKindAny || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
      });
      contacts.value = res.data.contacts ?? res.data;
      total.value = res.data.total ?? contacts.value.length;
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchContact(id: string): Promise<Contact | null> {
    try {
      const res = await api.get(`/contacts/${id}`);
      return res.data;
    } catch (err) {
      console.error('Failed to fetch contact:', err);
      return null;
    }
  }

  async function createContact(payload: Partial<Contact>): Promise<Contact | null> {
    saving.value = true;
    try {
      const res = await api.post('/contacts', payload);
      await fetchContacts();
      return res.data;
    } catch (err) {
      console.error('Failed to create contact:', err);
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function updateContact(id: string, payload: Partial<Contact>): Promise<Contact | null> {
    saving.value = true;
    try {
      const res = await api.put(`/contacts/${id}`, payload);
      const idx = contacts.value.findIndex(c => c.id === id);
      if (idx !== -1) contacts.value[idx] = res.data;
      return res.data;
    } catch (err) {
      console.error('Failed to update contact:', err);
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function deleteContact(id: string): Promise<boolean> {
    deleting.value = true;
    try {
      await api.delete(`/contacts/${id}`);
      await fetchContacts();
      return true;
    } catch (err) {
      console.error('Failed to delete contact:', err);
      return false;
    } finally {
      deleting.value = false;
    }
  }

  function resetFilters() {
    filters.search = '';
    filters.source = '';
    filters.status = '';
    pagination.page = 1;
    fetchContacts();
  }

  return {
    contacts, total, loading, saving, deleting,
    filters, pagination,
    fetchContacts, fetchContact,
    createContact, updateContact, deleteContact,
    resetFilters,
  };
}

export function useContactIntelligence() {
  const duplicateGroups = ref<DuplicateGroup[]>([]);
  const duplicateTotal = ref(0);
  const loadingDuplicates = ref(false);
  const merging = ref(false);

  async function fetchDuplicateGroups(page = 1, limit = 20) {
    loadingDuplicates.value = true;
    try {
      const res = await api.get('/contacts/duplicates', {
        params: { page, limit, resolved: 'false' },
      });
      duplicateGroups.value = res.data.groups ?? [];
      duplicateTotal.value = res.data.total ?? 0;
    } catch (err) {
      console.error('Failed to fetch duplicate groups:', err);
    } finally {
      loadingDuplicates.value = false;
    }
  }

  async function mergeDuplicateGroup(groupId: string, primaryContactId: string): Promise<boolean> {
    merging.value = true;
    try {
      await api.post(`/contacts/duplicates/${groupId}/merge`, { primaryContactId });
      return true;
    } catch (err) {
      console.error('Failed to merge contacts:', err);
      return false;
    } finally {
      merging.value = false;
    }
  }

  async function dismissDuplicateGroup(groupId: string): Promise<boolean> {
    try {
      await api.post(`/contacts/duplicates/${groupId}/dismiss`, {});
      return true;
    } catch (err) {
      console.error('Failed to dismiss duplicate group:', err);
      return false;
    }
  }

  async function recomputeIntelligence(): Promise<boolean> {
    try {
      await api.post('/contacts/intelligence/recompute');
      return true;
    } catch (err) {
      console.error('Failed to trigger recompute:', err);
      return false;
    }
  }

  return {
    duplicateGroups, duplicateTotal, loadingDuplicates, merging,
    fetchDuplicateGroups, mergeDuplicateGroup, dismissDuplicateGroup, recomputeIntelligence,
  };
}
