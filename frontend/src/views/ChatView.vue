<template>
  <MobileChatView v-if="isMobile" />
  <div v-else class="smax-chat-grid">
    <!-- COL 1: filter rail (collapse state observed via localStorage trong FilterRail) -->
    <FilterRail
      :accounts="accountList"
      :selected-account-ids="selectedAccountIds"
      :counts="threadCounts"
      @update:accounts="onAccountsChanged"
      @update:filters="onRailFiltersUpdate"
    />

    <!-- COL 2: conversation list -->
    <div class="smax-conv-col">
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        :accounts="accountList"
        :selected-account-ids="selectedAccountIds"
        v-model:search="searchQuery"
        @select="onSelectConv"
        @filter-account="onFilterAccount"
        @update:filters="onFiltersUpdate"
        @conversation-moved="onConversationMoved"
        @compose-opened="onComposeOpened"
      />
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
      @delete-message="onDeleteMessage"
      @undo-message="onUndoMessage"
      @edit-message="onEditMessage"
      @forward-message="onForwardMessage"
      @pin-conversation="onPinConversation"
      @set-reply-to="setReplyTo"
      @set-editing="setEditing"
      @cancel-reply-edit="onCancelReplyEdit"
      @typing="onTyping"
      @refresh-thread="selectedConvId && fetchMessages(selectedConvId)"
    />

    <!-- COL 4: contact info panel (chỉ hiện khi có contact) -->
    <ChatContactPanel
      v-if="showContactPanel && selectedConv?.contact"
      :contact-id="selectedConv.contact.id"
      :contact="selectedConv.contact"
      :active-zalo-account-id="selectedConv.zaloAccount?.id ?? null"
      :ai-summary="aiSummary"
      :ai-summary-loading="aiSummaryLoading"
      :ai-sentiment="aiSentiment"
      :ai-sentiment-loading="aiSentimentLoading"
      class="smax-info-col"
      @refresh-ai-summary="generateAiSummary"
      @refresh-ai-sentiment="generateAiSentiment"
      @close="showContactPanel = false"
      @saved="fetchConversations()"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import FilterRail from '@/components/chat/FilterRail.vue';
import { useChat } from '@/composables/use-chat';
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
} = useChat();

const {
  typingUsers, replyingTo, editingMessage,
  addReaction, sendTypingEvent, deleteMessage, undoMessage,
  editMessage, forwardMessage, pinConversation,
  setReplyTo, clearReplyTo, setEditing, clearEditing,
  registerSocketListeners,
  unpinConversation,
} = useChatOperations();

// ════════ Zalo accounts (for FilterRail nick picker) ════════
const { accounts: zaloAccounts, fetchAccounts: fetchZaloAccounts } = useZaloAccounts();
const selectedAccountIds = ref<string[]>([]);
const accountList = computed(() =>
  (zaloAccounts.value || []).map(a => ({
    id: a.id,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl ?? null,
    ownerUserId: a.ownerUserId,
  })),
);
const threadCounts = computed(() => {
  const groups = conversations.value.filter(c => c.threadType === 'group').length;
  const users = conversations.value.filter(c => c.threadType === 'user').length;
  return { groups, users };
});

function onAccountsChanged(ids: string[]) {
  selectedAccountIds.value = ids;
  // Backend hiện chỉ chấp nhận accountId single → dùng first ID; sẽ extend multi sau.
  accountFilter.value = ids[0] || null;
  fetchConversations();
}
function onRailFiltersUpdate(filters: Record<string, string>) {
  // Merge filters từ FilterRail với extraFilters hiện có (không đè filter từ ConversationList).
  const reserved = ['unread', 'unreplied', 'unreadOnTop', 'threadType', 'groupInbox'];
  const next = { ...extraFilters.value };
  for (const k of reserved) delete next[k];
  Object.assign(next, filters);
  extraFilters.value = next;
  fetchConversations();
}

// ════════ Existing handlers ════════
const currentTypers = computed(() =>
  (selectedConvId.value ? typingUsers.value.get(selectedConvId.value) : null) || [],
);

async function onAddReaction(msgId: string, reaction: string) {
  if (!selectedConvId.value) return;
  await addReaction(selectedConvId.value, msgId, reaction);
}
async function onDeleteMessage(msgId: string) {
  if (!selectedConvId.value) return;
  await deleteMessage(selectedConvId.value, msgId);
}
async function onUndoMessage(msgId: string) {
  if (!selectedConvId.value) return;
  await undoMessage(selectedConvId.value, msgId);
}
async function onEditMessage(msgId: string, content: string) {
  if (!selectedConvId.value) return;
  await editMessage(selectedConvId.value, msgId, content);
  clearEditing();
}
async function onForwardMessage(msgId: string, targetIds: string[]) {
  if (!selectedConvId.value) return;
  await forwardMessage(selectedConvId.value, msgId, targetIds);
}
async function onPinConversation() {
  if (!selectedConvId.value || !selectedConv.value) return;
  if (selectedConv.value.isPinned) {
    await unpinConversation(selectedConvId.value);
  } else {
    await pinConversation(selectedConvId.value);
  }
  await fetchConversations();
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
  fetchConversations();
}
function onFiltersUpdate(params: Record<string, string>) {
  extraFilters.value = { ...extraFilters.value, ...params };
  fetchConversations();
}
function onConversationMoved(_id: string, _tab: string) {
  fetchConversations();
}

// Khi user tạo conv mới từ "Tin nhắn mới" dialog → refresh list + nav vào conv đó.
async function onComposeOpened(conversationId: string) {
  await fetchConversations();
  router.push({ name: 'Chat', params: { convId: conversationId } });
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

onMounted(async () => {
  if (!isMobile.value) {
    await fetchZaloAccounts();
    fetchConversations();
    fetchAiConfig();
    initSocket();
    registerSocketListeners(getSocket());
    // Nếu URL đã có /chat/:convId → select luôn (deep-link)
    const initId = route.params.convId;
    if (typeof initId === 'string' && initId) {
      selectConversation(initId);
    }
  }
});
onUnmounted(() => {
  if (!isMobile.value) destroySocket();
});

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
/* Khi filter rail collapsed → col 1 = 56px */
.smax-chat-grid:has(.filter-rail.collapsed) {
  grid-template-columns: 56px 380px 1fr 350px;
}
.smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)) {
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
  .smax-chat-grid:has(.filter-rail.collapsed) {
    grid-template-columns: 56px 340px 1fr 310px;
  }
  .smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)) {
    grid-template-columns: 56px 340px 1fr;
  }
}
/* Tight: filter rail vẫn show nhưng compact */
@media (max-width: 1440px) {
  .smax-chat-grid { grid-template-columns: 240px 320px 1fr 280px; }
  .smax-chat-grid:not(:has(.smax-info-col)) {
    grid-template-columns: 240px 320px 1fr;
  }
  .smax-chat-grid:has(.filter-rail.collapsed) {
    grid-template-columns: 56px 320px 1fr 280px;
  }
  .smax-chat-grid:has(.filter-rail.collapsed):not(:has(.smax-info-col)) {
    grid-template-columns: 56px 320px 1fr;
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
