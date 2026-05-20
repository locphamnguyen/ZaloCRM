<template>
  <div class="mobile-chat">
    <div v-if="!selectedConvId" class="mobile-chat-pane">
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        v-model:search="searchQuery"
        @select="selectConversation"
        @filter-account="onFilterAccount"
      />
    </div>

    <div v-else class="mobile-chat-thread-shell">
      <div class="mobile-thread-bar">
        <v-btn icon variant="text" size="small" class="mobile-back-btn" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
        <span v-if="selectedConv" class="mobile-thread-title">
          {{ selectedConv.contact?.fullName || selectedConv.groupName || 'Chat' }}
        </span>
      </div>

      <MessageThread
        :conversation="selectedConv"
        :messages="allMessages"
        :loading="loadingMsgs"
        :sending="sendingMsg"
        :show-contact-panel="false"
        :ai-suggestion="aiSuggestion"
        :ai-suggestion-loading="aiSuggestionLoading"
        :ai-suggestion-error="aiSuggestionError"
        class="mobile-message-thread"
        @send="handleSend"
        @ask-ai="generateAiSuggestion"
        @refresh-thread="selectedConvId && fetchMessages(selectedConvId)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, computed } from 'vue';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import { useChat } from '@/composables/use-chat';
import { useOfflineQueue } from '@/composables/use-offline-queue';

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter,
  aiSuggestion, aiSuggestionLoading, aiSuggestionError,
  fetchConversations, fetchMessages, selectConversation, sendMessage, sendMessageTo,
  generateAiSuggestion,
  initSocket, destroySocket,
} = useChat();

const { pendingMessages, enqueue, flush } = useOfflineQueue();

function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  fetchConversations();
}

function goBack() {
  selectedConvId.value = null;
}

// Merge real messages with pending offline messages
const allMessages = computed(() => {
  const pending = pendingMessages.value
    .filter(p => p.conversationId === selectedConvId.value)
    .map(p => ({
      id: p.id,
      content: p.content,
      contentType: 'text',
      senderType: 'self',
      senderName: null,
      sentAt: p.createdAt,
      isDeleted: false,
      zaloMsgId: null,
      albumKey: null,
      albumIndex: null,
      albumTotal: null,
      _pending: true,
      _pendingStatus: p.status,
    }));
  return [...messages.value, ...pending];
});

async function handleSend(content: string, replyMessageId?: string | null) {
  if (!selectedConvId.value) return;
  if (!navigator.onLine) {
    enqueue(selectedConvId.value, content);
    return;
  }
  await sendMessage(content, replyMessageId);
}

// Flush queue when coming back online
function onOnline() {
  flush(sendMessageTo);
}

onMounted(() => {
  fetchConversations();
  initSocket();
  window.addEventListener('online', onOnline);
  if (navigator.onLine) {
    void flush(sendMessageTo);
  }
});

onUnmounted(() => {
  destroySocket();
  window.removeEventListener('online', onOnline);
  clearTimeout(searchTimeout);
});

let searchTimeout: ReturnType<typeof setTimeout>;
watch(searchQuery, () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchConversations(), 300);
});
</script>

<style scoped>
.mobile-chat {
  height: calc(100dvh - var(--v-layout-top) - 72px - env(safe-area-inset-bottom));
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--gold-bg);
}

@supports not (height: 100dvh) {
  .mobile-chat {
    height: calc(100vh - var(--v-layout-top) - 72px - env(safe-area-inset-bottom));
  }
}

.mobile-chat-pane,
.mobile-chat-thread-shell {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.mobile-chat-thread-shell {
  display: flex;
  flex-direction: column;
}

.mobile-thread-bar {
  flex: 0 0 auto;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--gold-border);
  background: rgba(16, 21, 34, 0.94);
}

.mobile-back-btn {
  width: 44px !important;
  height: 44px !important;
}

.mobile-thread-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--gold-text);
  font-size: 14px;
  font-weight: 700;
}

.mobile-message-thread {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: 100%;
}

.mobile-chat :deep(.conversation-list),
.mobile-chat :deep(.message-thread) {
  height: 100%;
  max-width: 100%;
  min-width: 0;
}

.mobile-chat :deep(.smax-contact-panel),
.mobile-chat :deep(.chat-contact-panel),
.mobile-chat :deep(.tag-crm-bar) {
  display: none !important;
}
</style>
