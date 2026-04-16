<template>
  <div class="message-thread d-flex flex-column flex-grow-1" style="height: 100%;">
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1">
      <div class="text-center text-grey">
        <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
        <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid var(--border-glow, rgba(0,242,255,0.1));">
        <v-avatar size="36" color="grey-lighten-2" class="mr-3">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="mdi-account" />
        </v-avatar>
        <div class="flex-grow-1">
          <div class="font-weight-medium">{{ conversation.contact?.fullName || 'Unknown' }}</div>
          <div class="text-caption text-grey">{{ conversation.zaloAccount?.displayName || 'Zalo' }}</div>
        </div>
        <v-btn size="small" variant="tonal" color="primary" class="mr-2" :loading="aiSuggestionLoading" @click="$emit('ask-ai')">
          Ask AI
        </v-btn>
        <v-btn
          :icon="showContactPanel ? 'mdi-account-details' : 'mdi-account-details-outline'"
          size="small" variant="text"
          :color="showContactPanel ? 'primary' : undefined"
          @click="$emit('toggle-contact-panel')"
        />
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-grow-1 overflow-y-auto pa-3 chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
        <MessageBubble
          v-for="msg in messages"
          :key="msg.id"
          :message="msg"
          :is-self="msg.senderType === 'self'"
          :is-group="conversation.threadType === 'group'"
          @contextmenu="onContextMenu($event, msg)"
          @preview-image="previewImageUrl = $event"
          @toggle-reaction="onToggleReaction(msg, $event)"
        />
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Typing indicator -->
      <TypingIndicator :typers="currentTypers" />

      <!-- Input area -->
      <div class="pa-2 chat-input-area">
        <AiSuggestionPanel
          :suggestion="aiSuggestion"
          :loading="aiSuggestionLoading"
          :error="aiSuggestionError"
          @generate="$emit('ask-ai')"
          @apply="applySuggestion"
        />
        <ReplyPreviewBar
          :message="(replyingTo || editingMessage) ?? null"
          :mode="editingMessage ? 'edit' : 'reply'"
          @cancel="onCancelReplyEdit"
        />
        <div class="d-flex align-end" style="position: relative;">
          <QuickTemplatePopup
            :visible="showTemplatePopup"
            :query="templateQuery"
            :templates="templates"
            :contact="conversation.contact"
            @select="onTemplateSelect"
            @close="showTemplatePopup = false"
          />
          <RichTextEditor
            ref="editorRef"
            v-model="inputText"
            placeholder="Nhập tin nhắn... (gõ / để chèn mẫu)"
            class="flex-grow-1 mr-2"
            @submit="handleSend"
            @typing="onTypingEvent"
          />
          <v-btn icon color="primary" :loading="sending" :disabled="!inputText.trim()" @click="handleSend">
            <v-icon>mdi-send</v-icon>
          </v-btn>
        </div>
      </div>
    </template>

    <!-- Context menu -->
    <MessageContextMenu
      v-model="showContextMenu"
      :message="contextMsg"
      :is-self="contextMsg?.senderType === 'self'"
      :position="contextPos"
      @reply="onReply"
      @edit="onEdit"
      @delete="onDelete"
      @undo="onUndo"
      @forward="showForwardDialog = true"
      @copy="() => {}"
      @pin="onPin"
    />

    <!-- Forward dialog -->
    <ForwardDialog
      v-model="showForwardDialog"
      :conversations="allConversations ?? []"
      @forward="onForward"
    />

    <!-- Image preview dialog -->
    <v-dialog v-model="showImagePreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="showImagePreview = false" style="cursor: pointer;">
        <img :src="previewImageUrl" alt="Preview" style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);" />
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn để đóng</div>
      </div>
    </v-dialog>

    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import AiSuggestionPanel from '@/components/ai/ai-suggestion-panel.vue';
import QuickTemplatePopup from '@/components/chat/quick-template-popup.vue';
import MessageBubble from '@/components/chat/message-bubble.vue';
import MessageContextMenu from '@/components/chat/message-context-menu.vue';
import TypingIndicator from '@/components/chat/typing-indicator.vue';
import ReplyPreviewBar from '@/components/chat/reply-preview-bar.vue';
import ForwardDialog from '@/components/chat/forward-dialog.vue';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';

interface TemplateItem { id: string; name: string; content: string; category: string | null; isPersonal: boolean; }

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
  aiSuggestion: string;
  aiSuggestionLoading: boolean;
  aiSuggestionError: string;
  allConversations?: Conversation[];
  replyingTo?: Message | null;
  editingMessage?: Message | null;
  typingUsers?: { userId: string; userName: string }[];
}>();

const emit = defineEmits<{
  send: [content: string];
  'toggle-contact-panel': [];
  'ask-ai': [];
  'add-reaction': [msgId: string, reaction: string];
  'delete-message': [msgId: string];
  'undo-message': [msgId: string];
  'edit-message': [msgId: string, content: string];
  'forward-message': [msgId: string, targetIds: string[]];
  'pin-conversation': [];
  'set-reply-to': [msg: Message];
  'set-editing': [msg: Message];
  'cancel-reply-edit': [];
  'typing': [];
}>();

const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) previewImageUrl.value = ''; } });
const syncSnack = ref({ show: false, text: '', color: 'success' });

// Context menu state
const showContextMenu = ref(false);
const contextMsg = ref<Message | null>(null);
const contextPos = ref({ x: 0, y: 0 });

// Forward dialog
const showForwardDialog = ref(false);
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);

// Typing indicator — computed from prop
const currentTypers = computed(() => props.typingUsers || []);

function onContextMenu(event: MouseEvent, msg: Message) {
  contextMsg.value = msg;
  contextPos.value = { x: event.clientX, y: event.clientY };
  showContextMenu.value = true;
}

function onToggleReaction(msg: Message, emoji: string) {
  emit('add-reaction', msg.id, emoji);
}

function onReply() {
  if (contextMsg.value) emit('set-reply-to', contextMsg.value);
}

function onEdit() {
  if (contextMsg.value) {
    emit('set-editing', contextMsg.value);
    inputText.value = contextMsg.value.content || '';
  }
}

function onDelete() {
  if (contextMsg.value) emit('delete-message', contextMsg.value.id);
}

function onUndo() {
  if (contextMsg.value) emit('undo-message', contextMsg.value.id);
}

function onPin() {
  emit('pin-conversation');
}

function onForward(targetIds: string[]) {
  if (contextMsg.value) emit('forward-message', contextMsg.value.id, targetIds);
  showForwardDialog.value = false;
}

function onCancelReplyEdit() {
  emit('cancel-reply-edit');
  if (props.editingMessage) inputText.value = '';
}

// --- Template quick-insert ---
const showTemplatePopup = ref(false);
const templateQuery = ref('');
const templates = ref<TemplateItem[]>([]);

async function loadTemplates() {
  try {
    const res = await api.get<{ templates: TemplateItem[] }>('/automation/templates');
    templates.value = res.data.templates;
  } catch { /* Non-critical */ }
}

onMounted(() => { loadTemplates(); });

function onTypingEvent() {
  emit('typing');
  // Template popup trigger: check if last char is /
  const value = inputText.value;
  if (value === '/' || /\s\/$/.test(value)) {
    showTemplatePopup.value = true;
    templateQuery.value = '';
  } else if (showTemplatePopup.value) {
    const lastSlash = value.lastIndexOf('/');
    if (lastSlash === -1) { showTemplatePopup.value = false; } else { templateQuery.value = value.slice(lastSlash + 1); }
  }
}

function onTemplateSelect(rendered: string) {
  const lastSlash = inputText.value.lastIndexOf('/');
  inputText.value = lastSlash >= 0 ? inputText.value.slice(0, lastSlash) + rendered : rendered;
  showTemplatePopup.value = false;
  templateQuery.value = '';
}

function handleSend() {
  if (showTemplatePopup.value) { showTemplatePopup.value = false; return; }
  if (!inputText.value.trim()) return;
  if (props.editingMessage) {
    emit('edit-message', props.editingMessage.id, inputText.value);
  } else {
    emit('send', inputText.value);
  }
  inputText.value = '';
  editorRef.value?.clear();
  emit('cancel-reply-edit');
}

function applySuggestion() { if (!props.aiSuggestion) return; inputText.value = props.aiSuggestion; }

watch(() => props.messages.length, async () => {
  await nextTick();
  if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
});
</script>
