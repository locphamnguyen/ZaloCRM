<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <MobileChatView v-if="isMobile" />
  <div v-else class="smax-chat-grid">
    <!-- COL 1: NEW Filter Sidebar (Phase 6+ Inbox Triage) -->
    <ConversationFilterSidebar
      :filters="inboxFilters"
      :workspace-name="workspaceName"
      :current-user-name="currentUserName"
      :current-user-id="currentUserId"
      :all-accounts-count="zaloAccounts?.length || 0"
      :account-statuses="accountStatuses"
      :total-unread="totalUnreadCount"
      :current-account-id="accountFilter"
      :current-account="currentAccount"
      @manage-folders="showFolderManagePopup = true"
      @clear-account-filter="onFilterAccount(null)"
    />

    <!-- COL 2: conversation list — FilterBar render INSIDE via named slot
         giữa CRM tag bar và conv list (đúng order user yêu cầu) -->
    <div class="smax-conv-col">
      <!-- FIX socket-chết v2 — báo mất kết nối realtime, KHÔNG để chết âm thầm (bỏ lỡ khách).
           Text generic, không lộ orgId/user. Ẩn khi đã kết nối. -->
      <div v-if="!socketConnected" class="realtime-offline-banner">
        <span class="dot" />
        Mất kết nối realtime — đang thử kết nối lại...
      </div>
      <!-- work-scope 2026-06-15 — 1 DÒNG tóm tắt "N tin ở M nick khác" (anh chốt: gọn,
           không liệt kê từng nick, icon hệ thống không emoji). Ẩn khi không có tin.
           Bấm → về "Toàn bộ" (xem tất cả nick) + reload. Chỉ đếm nick CÓ QUYỀN. -->
      <button
        v-if="outOfScopeTotal > 0"
        class="out-of-scope-bar"
        :title="`Có ${outOfScopeTotal} tin ở ${outOfScopeNickCount} nick khác — bấm để xem tất cả`"
        @click="onShowAllOutOfScope"
      >
        <v-icon size="16" class="oos-icon">mdi-bell-outline</v-icon>
        <span class="oos-text">{{ outOfScopeTotal }} tin ở {{ outOfScopeNickCount }} nick khác</span>
      </button>
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        :accounts="accountList"
        :selected-account-ids="selectedAccountIds"
        :active-tab-key="inboxFilters.state.activeTab"
        :auto-compose-phone="autoComposePhone"
        :following-pairs="followingPairs"
        v-model:search="searchQuery"
        @select="onSelectConv"
        @filter-account="onFilterAccount"
        @update:filters="onFiltersUpdate"
        @conversation-moved="onConversationMoved"
        @conversation-deleted="onConversationDeleted"
        @compose-opened="onComposeOpened"
        @follow-changed="onFollowChanged"
      >
        <template #filters>
          <ConversationFilterBar
            :filters="inboxFilters"
            :total-count="conversations.length"
            :counts="conversationCounts"
            :priority-has-unread="priorityHasUnread"
            @reselect-tab="onReselectActiveTab"
          />
        </template>
      </ConversationList>
    </div>

    <!-- COL 3: message thread (giữ nguyên — handles header/messages/input bên trong) -->
    <MessageThread
      :conversation="selectedConv"
      :messages="messages"
      :loading="loadingMsgs"
      :sending="sendingMsg"
      :ai-suggestion="aiSuggestion"
      :ai-suggestion-loading="aiSuggestionLoading"
      :ai-suggestion-error="aiSuggestionError"
      :all-conversations="conversations"
      :replying-to="replyingTo"
      :editing-message="editingMessage"
      :typing-users="currentTypers"
      :show-contact-panel="showContactPanel"
      class="smax-msg-col"
      @send="sendMessage"
      @ask-ai="generateAiSuggestion"
      @open-media-tab="onOpenMediaTab"
      @toggle-contact-panel="showContactPanel = !showContactPanel"
      @add-reaction="onAddReaction"
      @remove-reaction="onRemoveReaction"
      @delete-message="onDeleteMessage"
      @undo-message="onUndoMessage"
      @edit-message="onEditMessage"
      @forward-message="onForwardMessage"
      @set-reply-to="setReplyTo"
      @set-editing="setEditing"
      @cancel-reply-edit="onCancelReplyEdit"
      @typing="onTyping"
      @refresh-thread="selectedConvId && fetchMessages(selectedConvId)"
      @switch-conversation="onSwitchToNickConv"
      @profile-synced="patchContactProfile"
    />

    <!-- Folder management modal (overlay) -->
    <FolderManagePopup
      v-model="showFolderManagePopup"
      :filters="inboxFilters"
      :all-accounts-count="zaloAccounts?.length || 0"
      :account-statuses="accountStatuses"
      :total-unread="totalUnreadCount"
      :current-account-id="accountFilter"
      @view-applied="onFolderViewApplied"
    />

    <!-- COL 4: contact info panel (chỉ hiện khi có contact) -->
    <ChatContactPanel
      v-if="showContactPanel && selectedConv?.contact"
      ref="contactPanelRef"
      :contact-id="selectedConv.contact.id"
      :contact="selectedConv.contact"
      :friendship="selectedConv.friendship ?? null"
      :active-zalo-account-id="selectedConv.zaloAccount?.id ?? null"
      :friend-id="selectedConv.friendship?.id ?? null"
      :conversation-id="selectedConv.id ?? null"
      :active-zalo-account-name="selectedConv.zaloAccount?.displayName ?? null"
      :ai-summary="aiSummary"
      :ai-summary-loading="aiSummaryLoading"
      :ai-sentiment="aiSentiment"
      :ai-sentiment-loading="aiSentimentLoading"
      class="smax-info-col"
      @refresh-ai-summary="generateAiSummary"
      @refresh-ai-sentiment="generateAiSentiment"
      @close="showContactPanel = false"
      @saved="fetchConversations()"
      @status-changed="onPanelStatusChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import ConversationFilterSidebar from '@/components/chat/ConversationFilterSidebar.vue';
import ConversationFilterBar from '@/components/chat/ConversationFilterBar.vue';
import FolderManagePopup from '@/components/chat/FolderManagePopup.vue';
import { useChat } from '@/composables/use-chat';
import { useInboxFilters } from '@/composables/use-inbox-filters';
import { useAuthStore } from '@/stores/auth';
import { usePrivacyStore } from '@/stores/privacy';
import { useChatOperations } from '@/composables/use-chat-operations';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useWorkScope } from '@/composables/use-work-scope';
import { shouldAdoptNickScope } from '@/composables/work-scope-logic';
import MobileChatView from '@/views/MobileChatView.vue';
import { useMobile } from '@/composables/use-mobile';

const { isMobile } = useMobile();
const route = useRoute();
const router = useRouter();

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter, extraFilters,
  aiSuggestion, aiSuggestionLoading, aiSuggestionError,
  aiSummary, aiSummaryLoading, aiSentiment, aiSentimentLoading,
  fetchConversations, fetchAiConfig, fetchMessages, selectConversation, sendMessage,
  generateAiSuggestion, generateAiSummary, generateAiSentiment,
  initSocket, destroySocket, getSocket,
  typingConvIds, socketConnected,
  outOfScopeCounts, clearOutOfScopeBadge,
  patchContactProfile,
} = useChat();

const {
  typingUsers, replyingTo, editingMessage,
  addReaction, removeReaction, sendTypingEvent, deleteMessage, undoMessage,
  editMessage, forwardMessage,
  setReplyTo, clearReplyTo, setEditing, clearEditing,
  registerSocketListeners,
} = useChatOperations();

// ════════ Auth (cần để compute isOwnedByMe fallback cho accountList) ════════
const authStore = useAuthStore();

// ════════ Zalo accounts (for FilterRail nick picker) ════════
const { accounts: zaloAccounts, fetchAccounts: fetchZaloAccounts } = useZaloAccounts();
const selectedAccountIds = ref<string[]>([]);
// work-scope (nguồn chân lý mới; accountFilter là facade bắc qua nó). Dùng validateAgainst
// để lọc scope đã lưu chỉ còn nick CÓ QUYỀN — bảo mật, Anh nhấn mạnh 2026-06-15.
const workScope = useWorkScope();

// 2026-06-09 (anh chốt) — NHỚ "Phạm vi xem" qua reload/tắt-mở tab. Lưu {folderId, accountId}
// vào localStorage. Khôi phục lúc mount SAU khi fetchZaloAccounts (để validate quyền):
// accountId đã lưu phải còn nằm trong danh sách nick accessible (zaloAccounts đã qua
// getZaloScope ở BE) — nếu không còn quyền/nick bị gỡ thì BỎ, về ALL (tuân thủ scope nghiêm ngặt).
const SCOPE_KEY = 'chat.scope.v1';
function saveScope(folderId: string | null, accountId: string | null) {
  try {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ folderId, accountId }));
  } catch { /* localStorage đầy/chặn → bỏ qua */ }
}
function loadScopeRaw(): { folderId: string | null; accountId: string | null } {
  try {
    const r = JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}');
    return { folderId: r.folderId ?? null, accountId: r.accountId ?? null };
  } catch { return { folderId: null, accountId: null }; }
}
// Áp scope đã lưu vào state, CÓ validate quyền nick.
// work-scope migration 2026-06-15: NICK giờ do workScope quản (seed từ chat.workscope.v2).
// validateAgainst bỏ nick MẤT QUYỀN (bảo mật — KHÔNG vượt quyền server getZaloScope cấp).
// restoreScope chỉ còn lo FOLDER (chat.scope.v1) — nick đã tách sang workScope.
function restoreScope() {
  const accessibleIds = (zaloAccounts.value || []).map(a => a.id);
  workScope.validateAgainst(accessibleIds); // lọc scope đã lưu chỉ còn nick có quyền
  // Folder: set vào inbox filter (sidebar tự bỏ nếu folder không tồn tại khi render).
  const saved = loadScopeRaw();
  inboxFilters.setFolder(saved.folderId);
}
// work-scope 2026-06-15 — tóm tắt "N tin ở M nick khác" (anh chốt: 1 dòng, không liệt kê).
// CHỈ đếm nick CÓ QUYỀN (join zaloAccounts đã qua getZaloScope) — bảo mật, không lộ/đếm
// nick ngoài quyền.
const outOfScopeAccessible = computed(() => {
  const out: Array<{ id: string; count: number }> = [];
  for (const [id, count] of outOfScopeCounts.value) {
    const acc = (zaloAccounts.value || []).find(a => a.id === id);
    if (!acc) continue; // nick ngoài quyền/đã gỡ → KHÔNG đếm (bảo mật)
    out.push({ id, count });
  }
  return out;
});
const outOfScopeTotal = computed(() => outOfScopeAccessible.value.reduce((s, b) => s + b.count, 0));
const outOfScopeNickCount = computed(() => outOfScopeAccessible.value.length);
// Bấm dòng → về "Toàn bộ" (scope rỗng = tất cả nick có quyền) + reload (anh chốt).
function onShowAllOutOfScope() {
  for (const b of outOfScopeAccessible.value) clearOutOfScopeBadge(b.id);
  workScope.setScope([]); // [] = TẤT CẢ nick có quyền
  window.location.reload();
}

// Theo dõi (anh chốt 2026-06-15) — Set "contactId|nickId" đang theo dõi → ConversationList
// hiện chuông sau tên. Fetch 1 lần lúc mount; cập nhật ngay khi toggle follow ở menu.
const followingPairs = ref<Set<string>>(new Set());
async function fetchFollowingPairs() {
  try {
    const res = await api.get<{ pairs: Array<{ contactId: string; nickId: string }> }>(
      '/automation/care-sessions/listening-pairs',
    );
    followingPairs.value = new Set((res.data.pairs ?? []).map(p => `${p.contactId}|${p.nickId}`));
  } catch (err) {
    console.error('[follow] fetch listening-pairs failed', err);
  }
}
function onFollowChanged(contactId: string, nickId: string, following: boolean) {
  const key = `${contactId}|${nickId}`;
  const next = new Set(followingPairs.value);
  if (following) next.add(key); else next.delete(key);
  followingPairs.value = next; // gán Set mới → reactive, chuông cột 2 cập nhật ngay
}

const currentAccount = computed(() => {
  if (!accountFilter.value) return null;
  return zaloAccounts.value.find(a => a.id === accountFilter.value) || null;
});
const accountList = computed(() =>
  (zaloAccounts.value || []).map(a => ({
    id: a.id,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl ?? null,
    ownerUserId: a.ownerUserId,
    privacyMode: (a as any).privacyMode ?? 'sub',
    isOwnedByMe: (a as any).isOwnedByMe ?? (a.ownerUserId === authStore.user?.id),
    owner: (a as any).owner ?? null,
    zaloUid: (a as any).zaloUid ?? null,
  })),
);
// 2026-06-11: trạng thái LIVE từng nick (liveStatus pool → fallback DB status) cho sidebar
// đếm online/offline + chấm màu thay vì chỉ tổng "N nick".
const accountStatuses = computed(() =>
  (zaloAccounts.value || []).map(a => ({
    id: a.id,
    online: (((a as any).liveStatus || a.status) === 'connected'),
  })),
);

// ════════ Phase 6+ Inbox Triage Filters ════════
const inboxFilters = useInboxFilters();
const workspaceName = computed(() => authStore.user?.fullName?.split(' ')[0] || 'CRM');
const currentUserName = computed(() => authStore.user?.fullName || 'Tôi');
const currentUserId = computed(() => authStore.user?.id || '');
const showFolderManagePopup = ref(false);

const totalUnreadCount = computed(() =>
  conversations.value.reduce((sum, c) => sum + ((c as any).unreadCount || 0), 0)
);

// 2026-06-11 — tab "Ưu tiên" (tab=other) KHÔNG hiện số nhưng IN ĐẬM khi còn hội
// thoại chưa đọc. Lấy từ backend (otherUnread) vì khi đang ở tab khác, list cột 2
// không chứa conv tab Ưu tiên. Refresh khi mount / sau move / sau delete.
const priorityUnreadCount = ref(0);
const priorityHasUnread = computed(() => priorityUnreadCount.value > 0);
async function fetchPriorityUnread() {
  try {
    const params: Record<string, string> = {};
    if (accountFilter.value) params.accountId = accountFilter.value;
    const res = await api.get('/conversations/counts', { params });
    priorityUnreadCount.value = res.data?.otherUnread ?? 0;
  } catch {
    /* non-critical badge */
  }
}
// 2026-06-12 (anh báo đơ) — DEBOUNCE: refreshPriorityUnread gọi network /conversations/counts
// (endpoint nặng với admin: 4 count org-wide). Trước đây fire mỗi lần mở conv (route watch +
// click) + mỗi socket → triage nhanh 5-10 conv = 5-10 lần gọi /counts thừa. Gộp burst lại,
// trailing 400ms — badge "Ưu tiên" vẫn cập nhật sau khi ngừng chuyển ~0.4s (chấp nhận được
// cho 1 badge), giảm tải backend đúng phần GROUP 2 cũng lo.
let priorityUnreadTimer: ReturnType<typeof setTimeout> | null = null;
function refreshPriorityUnread() {
  if (priorityUnreadTimer) clearTimeout(priorityUnreadTimer);
  priorityUnreadTimer = setTimeout(() => { void fetchPriorityUnread(); }, 400);
}

// 2026-06-12 (anh báo đơ khi 50 nick gửi tin) — gộp 6 lần .filter() (6 vòng duyệt
// cả list) thành 1 VÒNG LẶP duy nhất. Computed này re-tính mỗi khi conversations.value
// đổi (mỗi tin socket đến của bất kỳ nick nào trong 50 nick) → trước đây 6×100 = 600 phép
// duyệt/lần, giờ còn 100. Badge vẫn cập nhật tức thì trong cùng tick (không debounce →
// không lag con số "Chưa rep" mà sale dựa vào).
const conversationCounts = computed(() => {
  let unread = 0, unanswered = 0, stuck = 0, ready = 0, individual = 0, group = 0;
  for (const c of conversations.value) {
    const cc = c as any;
    if ((cc.unreadCount || 0) > 0) unread++;
    if (cc.isReplied === false) unanswered++;
    if (cc.friendship?.stuckSince != null) stuck++;
    if ((cc.contact?.leadScore || 0) >= 80) ready++;
    if (c.threadType === 'user') individual++;
    else if (c.threadType === 'group') group++;
  }
  return { unread, unanswered, stuck, ready, individual, group };
});

// Apply inbox filter state → extraFilters → refetch.
// Sync ngay extraFilters trên mount để first fetch dùng đúng default tab
// (Cá nhân → threadType=user) thay vì load tất cả conv.
extraFilters.value = inboxFilters.buildQueryParams();

let filterApplyTimer: ReturnType<typeof setTimeout> | null = null;
// M-tier follow-up (2026-05-21) — tách activeTab khỏi debounce.
// Tab click cần FEEDBACK NGAY (cache hit paint instant), 150ms debounce làm user
// cảm giác lag 280-420ms thay vì <100ms. Filter khác (tags/pills) vẫn debounce
// để tránh refetch khi user gõ nhiều ký tự.
watch(
  () => inboxFilters.state.activeTab,
  () => {
    if (filterApplyTimer) clearTimeout(filterApplyTimer);
    // 2026-06-12 — đổi tab (Cá nhân/Nhóm/Chính/Ưu tiên) thì XÓA ô tìm kiếm (anh báo:
    // search dính mãi). Clear trước khi fetch để list tab mới không còn lọc theo từ
    // khóa cũ. Chỉ clear khi đang có search → tránh đổi tab thường bị double-fetch.
    if (searchQuery.value) searchQuery.value = '';
    const params = inboxFilters.buildQueryParams();
    extraFilters.value = params;
    fetchConversations();
    // Bộ lọc link với nhau: số đếm folder cột 1 lọc theo cùng tab (anh chốt).
    void inboxFilters.fetchFolders();
  },
);

// 2026-06-20 (anh báo): click LẠI chính tab đang active (activeTab không đổi → watch trên
// không fire) cũng phải XÓA ô tìm kiếm. ConversationFilterBar emit 'reselect-tab' khi đó.
function onReselectActiveTab() {
  if (searchQuery.value) searchQuery.value = ''; // watch(searchQuery) tự refetch
}
watch(
  () => [
    inboxFilters.state.folderId,
    inboxFilters.state.saleAssigneeId,
    Array.from(inboxFilters.state.quickPills).join(','),
    inboxFilters.state.tagsZalo.join(','),
    inboxFilters.state.tagsCrm.join(','),
    inboxFilters.state.sortMode,
    inboxFilters.state.timeAxis,
    inboxFilters.state.timeRangePreset,
    // 2026-06-08 — Tier-1 deep CRM filter (cột 1 sidebar). Trước đây các field này
    // KHÔNG nằm trong watch → bấm nút sáng nhưng list không refetch ("nút chết").
    inboxFilters.state.autoTags.join(','),
    inboxFilters.state.scoreMin,
    inboxFilters.state.scoreMax,
    inboxFilters.state.scoreTier,
    inboxFilters.state.stages.join(','),
    inboxFilters.state.stuckDuration,
    inboxFilters.state.lastMessageWithin,
    inboxFilters.state.customerWaitingReply,
    inboxFilters.state.saleWaitingReply,
    inboxFilters.state.birthdayWithin7d,
    inboxFilters.state.appointmentWithin24h,
    inboxFilters.state.appointmentOverdue,
    inboxFilters.state.engagementPatterns.join(','),
    inboxFilters.state.messageReplyState,
  ],
  () => {
    if (filterApplyTimer) clearTimeout(filterApplyTimer);
    filterApplyTimer = setTimeout(() => {
      const params = inboxFilters.buildQueryParams();
      extraFilters.value = params;
      fetchConversations();
    }, 150);
  },
  { deep: true }
);

// Anh chốt 2026-05-22: khi privacy state đổi (lock/unlock) → refetch conversation
// list + messages thread đang mở. Server sẽ trả msg.redacted + conv.redacted
// theo state mới → bubble blur cập nhật đúng cả cột 2 + cột 3 ngay lập tức
// (không phải F5 mới apply). Skip lần đầu mount.
const _privacyStore = usePrivacyStore();
watch(
  () => _privacyStore.isUnlocked,
  () => {
    fetchConversations();
    if (selectedConvId.value) fetchMessages(selectedConvId.value);
  },
);

// ════════ Existing handlers ════════
// currentTypers: sale collab typing (typingUsers từ presence) + KH typing
// (typingConvIds từ Wave 1 zalo:typing socket). KH hiện thành "KH" hoặc tên contact.
// Loại bỏ CHÍNH user đang đăng nhập khỏi list — user tự biết mình đang gõ, không
// cần hiện "thanhpc@x đang nhập" cho chính họ thấy. Anh chốt 2026-05-22.
const currentTypers = computed(() => {
  const myId = currentUserId.value;
  const internalAll = (selectedConvId.value ? typingUsers.value.get(selectedConvId.value) : null) || [];
  const internal = myId ? internalAll.filter(u => u.userId !== myId) : internalAll;
  if (!selectedConvId.value || !typingConvIds.value.has(selectedConvId.value)) {
    return internal;
  }
  const conv = selectedConv.value;
  const customerName = conv?.contact?.fullName || (conv?.threadType === 'group' ? 'Thành viên' : 'Khách hàng');
  return [
    { userId: '__customer__', userName: customerName },
    ...internal,
  ];
});

async function onAddReaction(msgId: string, reaction: string) {
  if (!selectedConvId.value) return;
  await addReaction(selectedConvId.value, msgId, reaction);
}
async function onRemoveReaction(msgId: string, reaction: string) {
  if (!selectedConvId.value) return;
  await removeReaction(selectedConvId.value, msgId, reaction);
}
const toast = useToast();

async function onDeleteMessage(msgId: string) {
  if (!selectedConvId.value) return;
  await deleteMessage(selectedConvId.value, msgId);
}
async function onUndoMessage(msgId: string) {
  if (!selectedConvId.value) return;
  try {
    await undoMessage(selectedConvId.value, msgId);
    toast.success('Đã thu hồi tin nhắn');
    await fetchMessages(selectedConvId.value);
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Không thu hồi được tin');
  }
}
async function onEditMessage(msgId: string, content: string) {
  if (!selectedConvId.value) return;
  try {
    await editMessage(selectedConvId.value, msgId, content);
    toast.warning('Đã sửa trên CRM — KH ở Zalo vẫn thấy bản gốc');
    clearEditing();
    await fetchMessages(selectedConvId.value);
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Không sửa được tin');
  }
}
async function onForwardMessage(msgId: string, targetIds: string[]) {
  if (!selectedConvId.value) return;
  try {
    await forwardMessage(selectedConvId.value, msgId, targetIds);
    toast.success(`Đã chuyển tiếp tới ${targetIds.length} hội thoại`);
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Không chuyển tiếp được');
  }
}
function onCancelReplyEdit() {
  clearReplyTo();
  clearEditing();
}
function onTyping() {
  if (selectedConvId.value) sendTypingEvent(selectedConvId.value);
}
function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  saveScope(inboxFilters.state.folderId, id); // nhớ Phạm vi xem qua reload
  fetchConversations();
}
function onFolderViewApplied(payload: { folderId: string | null; accountId: string | null }) {
  inboxFilters.setFolder(payload.folderId);
  accountFilter.value = payload.accountId;
  saveScope(payload.folderId, payload.accountId); // nhớ Phạm vi xem qua reload
  fetchConversations();
}
function onFiltersUpdate(params: Record<string, string>) {
  extraFilters.value = { ...extraFilters.value, ...params };
  fetchConversations();
}
function onConversationMoved(_id: string, _tab: string) {
  // bypassCache: conv vừa move qua tab khác → cache cũ sẽ flicker conv tại tab cũ
  fetchConversations({ bypassCache: true });
  // Move có thể đẩy conv chưa đọc vào/ra tab Ưu tiên → cập nhật badge đậm.
  void refreshPriorityUnread();
}

// Xóa mềm hội thoại từ cột 2: gỡ optimistic khỏi list, rời conv nếu đang mở,
// rồi refetch (bypassCache để khỏi flicker conv đã ẩn) + cập nhật badge Ưu tiên.
function onConversationDeleted(id: string) {
  const idx = conversations.value.findIndex((c) => c.id === id);
  if (idx !== -1) conversations.value.splice(idx, 1);
  if (selectedConvId.value === id) {
    router.push({ name: 'Chat' }).catch(() => {});
  }
  fetchConversations({ bypassCache: true });
  void refreshPriorityUnread();
}

// Khi user tạo conv mới từ "Tin nhắn mới" dialog → refresh list + nav vào conv đó.
async function onComposeOpened(conversationId: string) {
  await fetchConversations();
  router.push({ name: 'Chat', params: { convId: conversationId } });
}

// Sprint v3 Tuần 3 Row 6.9 (2026-06-03): sale switch nick trong header chat.
// Conv mới có thể chưa nằm trong list 100 → refresh trước khi push.
async function onSwitchToNickConv(convId: string) {
  // Nếu conv chưa nằm trong list (KH chưa từng chat qua nick mới) → refresh để list có
  if (!conversations.value.find(c => c.id === convId)) {
    await fetchConversations();
  }
  router.push({ name: 'Chat', params: { convId } });
}

// Auto-show panel khi chọn conv có contact
const showContactPanel = ref(true);

// 2026-06-12 (anh chốt): nút "Chèn từ kho" ở composer cột 3 → mở cột 4 sang tab Media.
// Panel render bằng v-if nên nếu đang ẩn phải bật + chờ nextTick rồi mới gọi setMainTab.
const contactPanelRef = ref<{ setMainTab: (t: 'profile' | 'media' | 'ai' | 'followup') => void } | null>(null);
async function onOpenMediaTab() {
  if (!showContactPanel.value) {
    showContactPanel.value = true;
    await nextTick();
  }
  contactPanelRef.value?.setMainTab('media');
}

// ════════ URL routing: /chat/:convId — deep-link hội thoại ════════
/** Khi user click 1 conv → push URL /chat/:id (watcher bên dưới sẽ trigger selectConversation) */
function onSelectConv(convId: string) {
  if (route.params.convId === convId) {
    // Click lại conv đang mở → vẫn refresh messages
    // 2026-06-12 — sau khi đọc (mark-read), refresh badge "Ưu tiên" để chấm đỏ/đậm
    // tắt khi đã đọc hết. selectConversation async (mark-read bên trong) → chờ xong.
    void selectConversation(convId).then(() => refreshPriorityUnread());
    return;
  }
  router.push({ name: 'Chat', params: { convId } });
}

// Watch route → select conv khi convId thay đổi (deep-link, back/forward, mới click)
// work-scope 2026-06-15 — FIX BUG NHẢY NICK: nếu hội thoại mở thuộc nick NGOÀI scope
// (vd từ Friend bấm chat khách nick B trong khi đang khóa nick A) → đặt scope = nick B
// rồi RELOAD trang (Anh chốt: state sạch). Nick TRONG scope → luồng tự thông (không reload).
// Đặt adopt-scope Ở ĐÂY (watcher), KHÔNG trong selectConversation (selectConversation có
// nhiều caller: onSelectConv/onLabelsSynced/onSwitchToNickConv — tránh adopt nhầm). Eng-review.
watch(
  () => route.params.convId,
  (id) => {
    if (typeof id === 'string' && id && id !== selectedConvId.value) {
      void selectConversation(id).then(() => {
        // Sau resolve: selectedConv đã có (từ list HOẶC selectedConvDetail). Đọc nick của nó.
        const convNick = (selectedConv.value as any)?.zaloAccount?.id as string | undefined;
        if (shouldAdoptNickScope(workScope.accountIds.value, convNick) && convNick) {
          // setScope idempotent (đã check shouldAdopt → chắc chắn đổi). Persist localStorage
          // rồi reload → restoreScope nạp scope mới → cột 2 + cột 3 đều đúng nick B (hết split-brain).
          workScope.setScope([convNick]);
          window.location.reload();
          return;
        }
        refreshPriorityUnread();
      });
    }
  },
  { immediate: false },
);

// Phase 2026-05-30 — Mở chat từ lead Facebook (/chat?compose=SĐT). Truyền xuống
// ConversationList để tự mở "Tin nhắn mới" + điền sẵn SĐT → dialog tự lookup Zalo + tạo hội thoại.
const autoComposePhone = computed(() => {
  const c = route.query.compose;
  return typeof c === 'string' ? c : '';
});

// Watch query.contactId — khi nav từ Contacts/Friends qua /chat?contactId=xxx
// Resolve sang convId qua conversations list, rồi redirect /chat/:convId.
watch(
  [() => route.query.contactId, conversations],
  ([contactId, convs]) => {
    if (!contactId || typeof contactId !== 'string') return;
    if (!Array.isArray(convs) || !convs.length) return;
    const match = convs.find(c => c.contact?.id === contactId && c.threadType === 'user');
    if (match) {
      router.replace({ name: 'Chat', params: { convId: match.id } });
    }
  },
  { deep: false, immediate: false },
);

// Listener cho zalo-labels-synced custom event (dispatch từ MessageThread sau khi
// touch/assign/sync labels). Refetch conversation detail để update friendship.zaloLabels.
function onLabelsSynced() {
  if (selectedConvId.value) {
    selectConversation(selectedConvId.value);
  }
}

onMounted(async () => {
  if (!isMobile.value) {
    await fetchZaloAccounts();
    // 2026-06-09 — khôi phục Phạm vi xem đã lưu (validate quyền nick) TRƯỚC khi fetch
    // conversations, để lần đầu load đúng scope đã chọn thay vì ALL rồi mới đổi.
    restoreScope();
    extraFilters.value = inboxFilters.buildQueryParams();
    fetchConversations();
    void fetchPriorityUnread(); // badge đậm tab Ưu tiên — load NGAY lúc mount (không debounce)
    void fetchFollowingPairs(); // theo dõi — Set để cột 2 hiện chuông (anh chốt 2026-06-15)
    fetchAiConfig();
    initSocket();
    registerSocketListeners(getSocket());
    // 2026-06-06 (Anh chốt): listen 'friend:updated' để sync realtime giai đoạn KH
    // cross-device. BE emit patch.statusId cho mọi friend của contact khi đổi trạng thái.
    // Cập nhật conversations[].contact.statusId → cột 3 (DealStageSelector watch) + cột 4 đổi ngay.
    const _socket = getSocket();
    if (_socket) {
      _socket.emit('org:join', { orgId: authStore.user?.orgId });
      _socket.on('friend:updated', (p: {
        contactId?: string;
        zaloUidInNick?: string;
        patch?: { statusId?: string | null; zaloLabels?: Array<{ id?: number; name?: string; color?: string }> };
      }) => {
        if (!p?.contactId || !p.patch) return;
        // statusId → cột 3 (DealStageSelector watch) + cột 4 đổi ngay (toàn bộ friend của contact).
        if ('statusId' in p.patch) {
          for (const conv of conversations.value) {
            if ((conv as any).contact?.id === p.contactId) {
              (conv as any).contact.statusId = p.patch.statusId ?? null;
            }
          }
        }
        // 2026-06-06 (Anh chốt) — Tag Zalo Real realtime: BE emit patch.zaloLabels khi sync/assign.
        // Match theo (contactId × zaloUidInNick = externalThreadId) — KHÔNG ghi đè mọi friend của
        // contact, vì per-nick UID rule: cùng KH nhiều friend rows, mỗi nick label riêng.
        // Cột 2 (ConversationList.displayTags) đọc friendship.zaloLabels → tự re-render.
        if ('zaloLabels' in p.patch && Array.isArray(p.patch.zaloLabels)) {
          for (const conv of conversations.value) {
            const c = conv as any;
            if (c.contact?.id !== p.contactId) continue;
            // Khớp đúng friend row qua thread id (nếu BE gửi kèm), fallback theo contact.
            if (p.zaloUidInNick && c.externalThreadId && c.externalThreadId !== p.zaloUidInNick) continue;
            if (!c.friendship) c.friendship = {};
            c.friendship.zaloLabels = p.patch.zaloLabels;
          }
        }
      });
    }
    // Nếu URL đã có /chat/:convId → select luôn (deep-link)
    const initId = route.params.convId;
    if (typeof initId === 'string' && initId) {
      selectConversation(initId);
    }
    window.addEventListener('zalo-labels-synced', onLabelsSynced);
    // 2026-06-12 — tin mới đến (use-chat bắn 'chat:inbound-message') → refresh badge tab
    // "Ưu tiên". Cần vì conv tab Ưu tiên không nằm trong list tab đang xem nên socket
    // không cập nhật được badge tại chỗ. refreshPriorityUnread đã debounce 400ms.
    window.addEventListener('chat:inbound-message', refreshPriorityUnread);
  }
});
onUnmounted(() => {
  if (!isMobile.value) {
    destroySocket();
    window.removeEventListener('zalo-labels-synced', onLabelsSynced);
    window.removeEventListener('chat:inbound-message', refreshPriorityUnread);
  }
});

// Đổi trạng thái ở cột 4 (panel) → cập nhật selectedConv.contact.statusId → cột 3 sync (cùng tab).
function onPanelStatusChanged(statusId: string | null) {
  if (selectedConv.value?.contact) {
    (selectedConv.value.contact as { statusId?: string | null }).statusId = statusId;
  }
}

let searchTimeout: ReturnType<typeof setTimeout>;
watch(searchQuery, () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchConversations(), 300);
});
</script>

<style scoped>
/* ════════ Responsive chat layout — adaptive 4 tier + filter collapse ════════
   Filter rail có 2 mode: expanded (default tier width) hoặc collapsed (56px).
   Collapse state qua :has(.filter-rail.collapsed) — auto sync khi FilterRail
   toggle localStorage. Grid template column 1 thay đổi theo. */
.smax-chat-grid {
  display: grid;
  grid-template-columns: 290px 380px 1fr 350px;
  height: calc(100vh - var(--smax-topnav-h, 52px));
  overflow: hidden;
  background: var(--smax-grey-100);
}

/* Khi info-panel đóng, col 4 collapse → grid auto-adjust */
.smax-chat-grid:has(.smax-info-col:not(:empty)) { /* presence query placeholder */ }
.smax-chat-grid:not(:has(.smax-info-col)) {
  grid-template-columns: 290px 380px 1fr;
}
/* Khi filter rail collapsed → col 1 = 56px (cả new sidebar lẫn legacy) */
.smax-chat-grid:has(.filter-rail.collapsed),
.smax-chat-grid:has(.filter-sidebar.collapsed) {
  grid-template-columns: 56px 380px 1fr 350px;
}
.smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)),
  .smax-chat-grid:has(.filter-sidebar.collapsed):not(:has(.smax-info-col)),
.smax-chat-grid:has(.filter-sidebar.collapsed):not(:has(.smax-info-col)) {
  grid-template-columns: 56px 380px 1fr;
}

.smax-conv-col,
.smax-msg-col,
.smax-info-col {
  min-width: 0; min-height: 0;
  height: 100%;
  overflow: hidden;
}

.smax-conv-col {
  border-right: 1px solid var(--smax-grey-200);
  background: var(--smax-bg);
}

/* work-scope 2026-06-15 — 1 DÒNG "N tin ở M nick khác" ở đầu cột 2 (anh chốt: gọn) */
.out-of-scope-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  background: #eff6ff;
  border: none;
  border-bottom: 1px solid #bfdbfe;
  font-size: 12px;
  font-weight: 600;
  color: #1e40af;
  cursor: pointer;
  text-align: left;
}
.out-of-scope-bar:hover { background: #dbeafe; }
.out-of-scope-bar .oos-icon { color: #1e40af; }
.out-of-scope-bar .oos-text { line-height: 1.2; }

/* FIX socket-chết v2 — banner mất kết nối realtime ở đầu cột 2 */
.realtime-offline-banner {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #92400e;
  background: #fef3c7;
  border-bottom: 1px solid #fde68a;
}
.realtime-offline-banner .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  animation: rt-pulse 1.2s ease-in-out infinite;
}
@keyframes rt-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.smax-msg-col {
  background: var(--smax-grey-100);
}

/* HD+ compact: thu nhỏ chút để thread có thêm space */
@media (max-width: 1700px) {
  .smax-chat-grid { grid-template-columns: 260px 340px 1fr 310px; }
  .smax-chat-grid:not(:has(.smax-info-col)) {
    grid-template-columns: 260px 340px 1fr;
  }
  .smax-chat-grid:has(.filter-rail.collapsed),
  .smax-chat-grid:has(.filter-sidebar.collapsed) {
    grid-template-columns: 56px 340px 1fr 310px;
  }
  .smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)),
  .smax-chat-grid:has(.filter-sidebar.collapsed):not(:has(.smax-info-col)) {
    grid-template-columns: 56px 340px 1fr;
  }
}
/* Tight: filter rail vẫn show nhưng compact */
@media (max-width: 1440px) {
  .smax-chat-grid { grid-template-columns: 240px 320px 1fr 280px; }
  .smax-chat-grid:not(:has(.smax-info-col)) {
    grid-template-columns: 240px 320px 1fr;
  }
  .smax-chat-grid:has(.filter-rail.collapsed),
  .smax-chat-grid:has(.filter-sidebar.collapsed) {
    grid-template-columns: 56px 320px 1fr 280px;
  }
  .smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)),
  .smax-chat-grid:has(.filter-sidebar.collapsed):not(:has(.smax-info-col)) {
    grid-template-columns: 56px 320px 1fr;
  }
}
/* HD 1366 — target chính sale VN. Chèn 2026-06-06 (/plan-design-review), giữ :has() động đủ 4 trạng thái. */
@media (max-width: 1366px) {
  .smax-chat-grid { grid-template-columns: 220px 296px 1fr 288px; }
  .smax-chat-grid:not(:has(.smax-info-col)) {
    grid-template-columns: 220px 296px 1fr;
  }
  .smax-chat-grid:has(.filter-rail.collapsed),
  .smax-chat-grid:has(.filter-sidebar.collapsed) {
    grid-template-columns: 56px 296px 1fr 288px;
  }
  .smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)),
  .smax-chat-grid:has(.filter-sidebar.collapsed):not(:has(.smax-info-col)) {
    grid-template-columns: 56px 296px 1fr;
  }
}
/* 1280 — XGA, vẫn giữ 4 cột, thread giữa ~450px đủ rộng. */
@media (max-width: 1280px) {
  .smax-chat-grid { grid-template-columns: 208px 280px 1fr 280px; }
  .smax-chat-grid:not(:has(.smax-info-col)) {
    grid-template-columns: 208px 280px 1fr;
  }
  .smax-chat-grid:has(.filter-rail.collapsed),
  .smax-chat-grid:has(.filter-sidebar.collapsed) {
    grid-template-columns: 56px 280px 1fr 280px;
  }
  .smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)),
  .smax-chat-grid:has(.filter-sidebar.collapsed):not(:has(.smax-info-col)) {
    grid-template-columns: 56px 280px 1fr;
  }
}
/* < 1200: drop filter rail */
@media (max-width: 1200px) {
  .smax-chat-grid { grid-template-columns: 0 320px 1fr 280px; }
  .smax-chat-grid:not(:has(.smax-info-col)) {
    grid-template-columns: 0 320px 1fr;
  }
  .smax-chat-grid > :first-child { display: none; }
}
/* < 1024: drop info panel too — chỉ còn conv list + thread */
@media (max-width: 1024px) {
  .smax-chat-grid { grid-template-columns: 320px 1fr; }
  .smax-chat-grid > :first-child,
  .smax-chat-grid > :nth-child(4) { display: none; }
}

</style>
