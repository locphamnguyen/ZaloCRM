import { api } from '@/api/index';

// ─── Types ────────────────────────────────────────────────────────────────

export interface GroupView {
  id: string;
  name: string;
  color: string | null;
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupViewConversation {
  id: string;
  zaloAccountId: string;
  contactId: string | null;
  threadType: string;
  lastMessageAt: string | null;
  unreadCount: number;
  tab: string;
  contact?: {
    id: string;
    fullName: string | null;
    crmName: string | null;
    avatarUrl: string | null;
    metadata?: Record<string, unknown>;
  };
  zaloAccount?: { id: string; displayName: string | null };
  messages?: Array<{
    id: string;
    content: string | null;
    contentType: string;
    senderType: string;
    isDeleted: boolean;
    sentAt: string;
  }>;
}

export interface ListConversationsParams {
  cursor?: string;
  limit?: number;
  tab?: string;
  unread?: boolean;
  unreplied?: boolean;
  from?: string;
  to?: string;
  tags?: string;
}

export interface ListConversationsResult {
  conversations: GroupViewConversation[];
  nextCursor: string | null;
  total: number;
}

export interface CreateGroupViewPayload {
  name: string;
  color?: string | null;
  accountIds: string[];
}

export interface UpdateGroupViewPayload {
  name?: string;
  color?: string | null;
  accountIds?: string[];
}

// ─── API functions ────────────────────────────────────────────────────────

export async function listGroupViews(): Promise<GroupView[]> {
  const res = await api.get('/group-views');
  return res.data.groupViews ?? [];
}

export async function getGroupView(id: string): Promise<GroupView> {
  const res = await api.get(`/group-views/${id}`);
  return res.data.groupView;
}

export async function createGroupView(payload: CreateGroupViewPayload): Promise<GroupView> {
  const res = await api.post('/group-views', payload);
  return res.data.groupView;
}

export async function updateGroupView(id: string, payload: UpdateGroupViewPayload): Promise<GroupView> {
  const res = await api.patch(`/group-views/${id}`, payload);
  return res.data.groupView;
}

export async function deleteGroupView(id: string): Promise<void> {
  await api.delete(`/group-views/${id}`);
}

export async function listGroupViewConversations(
  viewId: string,
  params: ListConversationsParams = {},
): Promise<ListConversationsResult> {
  const res = await api.get(`/group-views/${viewId}/conversations`, { params });
  return {
    conversations: res.data.conversations ?? [],
    nextCursor: res.data.nextCursor ?? null,
    total: res.data.total ?? 0,
  };
}
