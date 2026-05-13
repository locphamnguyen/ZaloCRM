import { ref } from 'vue';
import { api } from '@/api/index';

export interface DbFriend {
  id: string;
  contactId: string;
  zaloAccountId: string;
  zaloUidInNick: string;
  friendshipStatus: string;
  hasConversation: boolean;
  relationshipKind: 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost' | 'none';
  aliasInNick: string | null;
  zaloLabels: Array<{ id?: string; name?: string; color?: string }>;
  becameFriendAt: string | null;
  removedAt: string | null;
  firstMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastInteractionAt: string | null;
  totalInbound: number;
  totalOutbound: number;
  // Per-pair CRM state
  statusId?: string | null;
  statusRef?: { id: string; name: string; color: string | null; order: number; isTerminal?: boolean } | null;
  leadScore?: number;
  crmTagsPerNick?: string[];
  zaloDisplayName?: string | null;
  zaloAvatarUrl?: string | null;
  zaloGlobalId?: string | null;
  zaloUsername?: string | null;
  contact?: {
    id: string;
    fullName: string | null;
    crmName: string | null;
    phone: string | null;
    email: string | null;
    avatarUrl: string | null;
    tags: string[];
    leadScore: number;
    source: string | null;
    gender: string | null;
    status: string | null;
    province: string | null;
    district: string | null;
    birthYear: number | null;
  };
  zaloAccount?: {
    id: string;
    displayName: string | null;
    phone: string | null;
    avatarUrl?: string | null;
  };
}

export function useFriends() {
  const friends = ref<any[]>([]);
  const onlineFriends = ref<any[]>([]);
  const sentRequests = ref<any[]>([]);
  const recommendations = ref<any[]>([]);
  const searchResults = ref<any[]>([]);
  const loading = ref(false);

  // DB-backed (CRM-side persistent friend list)
  const friendsDb = ref<DbFriend[]>([]);
  const friendCounts = ref<Record<string, number>>({});
  const loadingDb = ref(false);
  const syncing = ref(false);

  function base(accountId: string) {
    return `/zalo-accounts/${accountId}/friends`;
  }

  async function fetchFriends(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}`);
      friends.value = res.data?.data ?? res.data ?? [];
    } catch (err) {
      console.error('fetchFriends failed:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchOnlineFriends(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/online`);
      onlineFriends.value = res.data?.data ?? res.data ?? [];
    } catch (err) {
      console.error('fetchOnlineFriends failed:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchRecommendations(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/recommendations`);
      recommendations.value = res.data?.data ?? res.data ?? [];
    } catch (err) {
      console.error('fetchRecommendations failed:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchSentRequests(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/requests/sent`);
      sentRequests.value = res.data?.data ?? res.data ?? [];
    } catch (err) {
      console.error('fetchSentRequests failed:', err);
    } finally {
      loading.value = false;
    }
  }

  async function getRequestStatus(accountId: string, userId: string) {
    try {
      const res = await api.get(`${base(accountId)}/requests/${userId}/status`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('getRequestStatus failed:', err);
      return null;
    }
  }

  async function searchFriends(accountId: string, query: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/find`, { params: { q: query } });
      searchResults.value = res.data?.data ?? res.data ?? [];
    } catch (err) {
      console.error('searchFriends failed:', err);
      searchResults.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function sendRequest(accountId: string, userId: string, message?: string) {
    try {
      const res = await api.post(`${base(accountId)}/requests`, { userId, message });
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('sendRequest failed:', err);
      return null;
    }
  }

  async function acceptRequest(accountId: string, userId: string) {
    try {
      const res = await api.post(`${base(accountId)}/requests/${userId}/accept`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('acceptRequest failed:', err);
      return null;
    }
  }

  async function rejectRequest(accountId: string, userId: string) {
    try {
      const res = await api.post(`${base(accountId)}/requests/${userId}/reject`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('rejectRequest failed:', err);
      return null;
    }
  }

  async function cancelRequest(accountId: string, userId: string) {
    try {
      const res = await api.delete(`${base(accountId)}/requests/${userId}`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('cancelRequest failed:', err);
      return null;
    }
  }

  async function removeFriend(accountId: string, userId: string) {
    try {
      const res = await api.delete(`${base(accountId)}/${userId}`);
      await fetchFriends(accountId);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('removeFriend failed:', err);
      return null;
    }
  }

  async function setAlias(accountId: string, userId: string, alias: string) {
    try {
      const res = await api.put(`${base(accountId)}/${userId}/alias`, { alias });
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('setAlias failed:', err);
      return null;
    }
  }

  async function removeAlias(accountId: string, userId: string) {
    try {
      const res = await api.delete(`${base(accountId)}/${userId}/alias`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('removeAlias failed:', err);
      return null;
    }
  }

  async function blockUser(accountId: string, userId: string) {
    try {
      const res = await api.post(`${base(accountId)}/${userId}/block`);
      await fetchFriends(accountId);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('blockUser failed:', err);
      return null;
    }
  }

  async function unblockUser(accountId: string, userId: string) {
    try {
      const res = await api.delete(`${base(accountId)}/${userId}/block`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('unblockUser failed:', err);
      return null;
    }
  }

  async function blockFeed(accountId: string, userId: string) {
    try {
      const res = await api.post(`${base(accountId)}/${userId}/block-feed`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('blockFeed failed:', err);
      return null;
    }
  }

  async function unblockFeed(accountId: string, userId: string) {
    try {
      const res = await api.delete(`${base(accountId)}/${userId}/block-feed`);
      return res.data?.data ?? res.data;
    } catch (err) {
      console.error('unblockFeed failed:', err);
      return null;
    }
  }

  const friendsDbTotal = ref(0);

  // DB-backed friend list — paginated read from our Friend table
  async function fetchFriendsDb(
    accountId: string,
    opts: { kind?: string; page?: number; limit?: number; search?: string } = {},
  ) {
    loadingDb.value = true;
    try {
      const res = await api.get(`${base(accountId)}-db`, {
        params: {
          kind: opts.kind ?? 'all',
          page: opts.page ?? 1,
          limit: opts.limit ?? 25,
          search: opts.search ?? '',
        },
      });
      friendsDb.value = res.data?.friends ?? [];
      friendCounts.value = res.data?.counts ?? {};
      friendsDbTotal.value = res.data?.total ?? 0;
    } catch (err) {
      console.error('fetchFriendsDb failed:', err);
      friendsDb.value = [];
      friendCounts.value = {};
      friendsDbTotal.value = 0;
    } finally {
      loadingDb.value = false;
    }
  }

  // Sync from Zalo → upsert our Friend table
  async function syncFriendsDb(accountId: string) {
    syncing.value = true;
    try {
      const res = await api.post(`${base(accountId)}-db/sync`);
      return res.data;
    } catch (err) {
      console.error('syncFriendsDb failed:', err);
      return null;
    } finally {
      syncing.value = false;
    }
  }

  return {
    friends,
    onlineFriends,
    sentRequests,
    recommendations,
    searchResults,
    loading,
    fetchFriends,
    fetchOnlineFriends,
    fetchRecommendations,
    fetchSentRequests,
    getRequestStatus,
    searchFriends,
    sendRequest,
    acceptRequest,
    rejectRequest,
    cancelRequest,
    removeFriend,
    setAlias,
    removeAlias,
    blockUser,
    unblockUser,
    blockFeed,
    unblockFeed,
    // DB-backed
    friendsDb,
    friendsDbTotal,
    friendCounts,
    loadingDb,
    syncing,
    fetchFriendsDb,
    syncFriendsDb,
  };
}
