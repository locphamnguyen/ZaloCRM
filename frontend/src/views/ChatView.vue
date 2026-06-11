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
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        :accounts="accountList"
        :selected-account-ids="selectedAccountIds"
        :active-tab-key="inboxFilters.state.activeTab"
        :auto-compose-phone="autoComposePhone"
        v-model:search="searchQuery"
        @select="onSelectConv"
        @filter-account="onFilterAccount"
        @update:filters="onFiltersUpdate"
        @conversation-moved="onConversationMoved"
        @compose-opened="onComposeOpened"
      >
        <template #filters>
          <ConversationFilterBar
            :filters="inboxFilters"
            :total-count="conversations.length"
            :counts="conversationCounts"
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  typingConvIds,
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
// Áp scope đã lưu vào state, CÓ validate quyền nick. Folder validate ở sidebar
// (fetchFolders chỉ trả folder của user); accountId validate theo zaloAccounts accessible.
function restoreScope() {
  const saved = loadScopeRaw();
  let invalid = false;
  // Nick: chỉ khôi phục nếu còn trong quyền truy cập hiện tại.
  if (saved.accountId) {
    const stillAccessible = (zaloAccounts.value || []).some(a => a.id === saved.accountId);
    accountFilter.value = stillAccessible ? saved.accountId : null;
    if (!stillAccessible) { saved.folderId = null; invalid = true; } // nick mất quyền → bỏ luôn folder kèm
  } else {
    accountFilter.value = null;
  }
  // Folder: set vào inbox filter (sidebar tự bỏ nếu folder không tồn tại khi render).
  inboxFilters.setFolder(saved.folderId);
  // Nick đã lưu mất quyền → ghi đè localStorage về scope hợp lệ (giữ folder nếu còn).
  if (invalid) saveScope(saved.folderId, accountFilter.value);
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

const conversationCounts = computed(() => {
  const list = conversations.value;
  const unread = list.filter((c) => ((c as any).unreadCount || 0) > 0).length;
  const unanswered = list.filter((c) => (c as any).isReplied === false).length;
  const stuck = list.filter((c) => (c as any).friendship?.stuckSince != null).length;
  const ready = list.filter((c) => ((c as any).contact?.leadScore || 0) >= 80).length;
  const individual = list.filter((c) => c.threadType === 'user').length;
  const group = list.filter((c) => c.threadType === 'group').length;
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
    const params = inboxFilters.buildQueryParams();
    extraFilters.value = params;
    fetchConversations();
  },
);
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

// ════════ URL routing: /chat/:convId — deep-link hội thoại ════════
/** Khi user click 1 conv → push URL /chat/:id (watcher bên dưới sẽ trigger selectConversation) */
function onSelectConv(convId: string) {
  if (route.params.convId === convId) {
    // Click lại conv đang mở → vẫn refresh messages
    selectConversation(convId);
    return;
  }
  router.push({ name: 'Chat', params: { convId } });
}

// Watch route → select conv khi convId thay đổi (deep-link, back/forward, mới click)
watch(
  () => route.params.convId,
  (id) => {
    if (typeof id === 'string' && id && id !== selectedConvId.value) {
      selectConversation(id);
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
  }
});
onUnmounted(() => {
  if (!isMobile.value) {
    destroySocket();
    window.removeEventListener('zalo-labels-synced', onLabelsSynced);
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
