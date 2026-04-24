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
        <v-btn size="small" variant="tonal" color="info" class="mr-2" @click="onLinkClick">
          Link
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
        <template v-for="item in displayItems" :key="item.key">
          <!-- Album: multiple images sharing the same Zalo albumKey -->
          <div v-if="item.kind === 'album'" class="mb-2 d-flex" :class="item.senderType === 'self' ? 'justify-end' : 'justify-start'">
            <div style="max-width: 70%;">
              <div v-if="conversation.threadType === 'group' && item.senderType !== 'self'" class="text-caption mb-1" style="color: #00F2FF; font-weight: 500;">
                {{ item.senderName || 'Unknown' }}
              </div>
              <div class="message-bubble pa-1 rounded-lg" :class="item.senderType === 'self' ? 'bg-primary' : 'bg-white'">
                <div class="album-grid" :class="albumGridClass(item.messages.length)">
                  <img
                    v-for="m in item.messages"
                    :key="m.id"
                    :src="getImageUrl(m)!"
                    alt="Hình ảnh"
                    class="album-tile"
                    @click="previewImageUrl = getImageUrl(m)!"
                  />
                </div>
                <div v-if="item.totalExpected && item.totalExpected > item.messages.length" class="text-caption px-2 py-1" style="opacity: 0.7;">
                  {{ item.messages.length }}/{{ item.totalExpected }} ảnh đã nhận
                </div>
                <div class="text-caption px-2 pb-1 msg-time" :class="item.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
                  {{ formatMessageTime(item.sentAt) }} · 🖼️ {{ item.messages.length }} ảnh
                </div>
              </div>
            </div>
          </div>
          <!-- Single message — rendered via MessageBubble -->
          <MessageBubble
            v-else
            :message="item.msg"
            :reply="item.msg.reply || null"
            :reactions="item.msg.reactions || []"
            :is-self="item.msg.senderType === 'self'"
            :is-group="conversation.threadType === 'group'"
            @contextmenu="onContextMenu($event, item.msg)"
            @preview-image="previewImageUrl = $event"
            @toggle-reaction="onToggleReaction(item.msg, $event)"
          />
        </template>
        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Typing indicator -->
      <TypingIndicator :typers="currentTypers" />

      <!-- Input area -->
      <div class="pa-2 chat-input-area" @dragenter.prevent="dragActive = true" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
        <div v-if="dragActive" class="drop-overlay">
          <v-icon size="64" color="primary">mdi-cloud-upload</v-icon>
          <div class="text-h6 mt-2">Thả file vào đây</div>
        </div>
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
        <!-- Attachment preview strip -->
        <div v-if="pendingFiles.length > 0" class="d-flex flex-wrap ga-2 mb-2">
          <div v-for="(f, i) in pendingFiles" :key="f.id" class="attachment-chip">
            <img v-if="f.kind === 'image'" :src="f.previewUrl" class="attachment-thumb" alt="preview" />
            <div v-else-if="f.kind === 'video'" class="attachment-thumb attachment-video">
              <v-icon size="32" color="white">mdi-video</v-icon>
            </div>
            <div v-else class="attachment-thumb attachment-video" :title="f.file.name">
              <v-icon size="32" color="white">mdi-file-document</v-icon>
            </div>
            <v-btn icon size="x-small" class="attachment-remove" @click="removeFile(i)">
              <v-icon size="16">mdi-close</v-icon>
            </v-btn>
          </div>
        </div>
        <input ref="fileInputRef" type="file" multiple class="d-none" @change="onFileInputChange" />
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
            placeholder="Nhập tin nhắn... (gõ / để chèn mẫu, dán ảnh trực tiếp)"
            class="flex-grow-1 mr-2"
            @submit="handleSend"
            @typing="onTypingEvent"
            @paste.native="onPaste"
          >
            <template #toolbar-extra>
              <v-divider vertical class="mx-1" />
              <v-btn
                icon size="x-small" variant="text" :disabled="uploading"
                title="Đính kèm ảnh/video" @click="pickFiles('image/*,video/*')"
              >
                <v-icon size="16">mdi-image-multiple-outline</v-icon>
              </v-btn>
              <v-btn
                icon size="x-small" variant="text" :disabled="uploading"
                title="Đính kèm tệp" @click="pickFiles(FILE_ACCEPT)"
              >
                <v-icon size="16">mdi-paperclip</v-icon>
              </v-btn>
            </template>
          </RichTextEditor>
          <v-btn icon color="primary" :loading="sending || uploading" :disabled="!canSend" @click="handleSend">
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
      :is-pinned="conversation?.isPinned"
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
  send: [content: string, replyMessageId?: string | null];
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
  'refresh-thread': [];
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

// ── Attachment state ────────────────────────────────────────────────────────

interface PendingFile { id: string; file: File; kind: 'image' | 'video' | 'file'; previewUrl: string; }
const pendingFiles = ref<PendingFile[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const dragActive = ref(false);
const uploading = ref(false);

const IMAGE_MAX = 100 * 1024 * 1024;
const VIDEO_MAX = 500 * 1024 * 1024;

// MIME whitelist for "Upload file" picker — accept attribute string
const FILE_ACCEPT = [
  'image/*', 'video/*',
  'application/pdf',
  '.xlsx', '.xls', '.csv',
  '.docx', '.doc',
  '.pptx', '.ppt',
  '.zip', '.gz', '.rar', '.tar', '.tar.gz', '.tgz',
].join(',');
const FILE_MAX = 1024 * 1024 * 1024;

function fileKind(f: File): 'image' | 'video' | 'file' {
  if (f.type.startsWith('image/')) return 'image';
  if (f.type.startsWith('video/')) return 'video';
  return 'file';
}

function addFiles(list: FileList | File[]) {
  for (const file of Array.from(list)) {
    const kind = fileKind(file);
    const max = kind === 'image' ? IMAGE_MAX : kind === 'video' ? VIDEO_MAX : FILE_MAX;
    if (file.size > max) {
      syncSnack.value = { show: true, text: `${file.name} vượt ${max / 1024 / 1024}MB`, color: 'error' };
      continue;
    }
    pendingFiles.value.push({ id: `${Date.now()}-${Math.random()}`, file, kind, previewUrl: kind === 'image' ? URL.createObjectURL(file) : '' });
  }
}

function pickFiles(accept: string) {
  if (fileInputRef.value) {
    fileInputRef.value.accept = accept;
    fileInputRef.value.value = '';
    fileInputRef.value.click();
  }
}

function onFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files) addFiles(target.files);
}

function removeFile(index: number) {
  const removed = pendingFiles.value.splice(index, 1);
  removed.forEach((f) => URL.revokeObjectURL(f.previewUrl));
}

function onDragLeave(e: DragEvent) {
  const rt = e.relatedTarget as Node | null;
  if (!rt || !(e.currentTarget as HTMLElement).contains(rt)) dragActive.value = false;
}

function onDrop(e: DragEvent) {
  dragActive.value = false;
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) addFiles(files);
}

const canSend = computed(() => (inputText.value.trim() || pendingFiles.value.length > 0) && !uploading.value);

async function uploadAttachments() {
  if (!props.conversation) return;
  uploading.value = true;
  try {
    const form = new FormData();
    form.append('caption', inputText.value);
    for (const p of pendingFiles.value) form.append('files', p.file, p.file.name);
    await api.post(`/conversations/${props.conversation.id}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    pendingFiles.value.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    pendingFiles.value = [];
    emit('refresh-thread');
  } catch (err: any) {
    syncSnack.value = { show: true, text: err?.response?.data?.error ?? 'Upload thất bại', color: 'error' };
    throw err;
  } finally {
    uploading.value = false;
  }
}

// Typing indicator — computed from prop
const currentTypers = computed(() => props.typingUsers || []);

// ── Display item types ──────────────────────────────────────────────────────

type DisplayItem =
  | { kind: 'single'; key: string; msg: Message }
  | { kind: 'album'; key: string; senderType: string; senderName: string | null; sentAt: string; totalExpected: number | null; messages: Message[] };

/** Group consecutive image messages sharing the same Zalo albumKey into an album item. */
const displayItems = computed<DisplayItem[]>(() => {
  const out: DisplayItem[] = [];
  let cur: Extract<DisplayItem, { kind: 'album' }> | null = null;
  for (const msg of props.messages) {
    const canGroup = msg.contentType === 'image' && msg.albumKey && !msg.isDeleted && !!getImageUrl(msg);
    if (canGroup && cur && cur.key === `album:${msg.albumKey}:${msg.senderType}`) {
      cur.messages.push(msg);
      continue;
    }
    cur = null;
    if (canGroup) {
      cur = {
        kind: 'album',
        key: `album:${msg.albumKey}:${msg.senderType}`,
        senderType: msg.senderType,
        senderName: msg.senderName,
        sentAt: msg.sentAt,
        totalExpected: msg.albumTotal ?? null,
        messages: [msg],
      };
      out.push(cur);
    } else {
      out.push({ kind: 'single', key: msg.id, msg });
    }
  }
  // Sort images within each album by albumIndex for stable order
  for (const item of out) {
    if (item.kind === 'album') {
      item.messages.sort((a, b) => (a.albumIndex ?? 0) - (b.albumIndex ?? 0));
    }
  }
  return out;
});

function albumGridClass(count: number): string {
  if (count <= 1) return 'album-grid-1';
  if (count === 2) return 'album-grid-2';
  if (count <= 4) return 'album-grid-2';
  return 'album-grid-3';
}

// ── Context menu / actions ──────────────────────────────────────────────────

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

async function onLinkClick() {
  const url = window.prompt('Nhập URL để gửi link');
  if (!url?.trim() || !props.conversation) return;
  try {
    await api.post(`/conversations/${props.conversation.id}/link`, { url: url.trim() });
    emit('refresh-thread');
  } catch (err) {
    console.error('Failed to send link:', err);
  }
}

function onForward(targetIds: string[]) {
  if (contextMsg.value) emit('forward-message', contextMsg.value.id, targetIds);
  showForwardDialog.value = false;
}

function onCancelReplyEdit() {
  emit('cancel-reply-edit');
  if (props.editingMessage) inputText.value = '';
}

// ── Template quick-insert ───────────────────────────────────────────────────

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

// ── Send ────────────────────────────────────────────────────────────────────

function handleSend() {
  if (showTemplatePopup.value) { showTemplatePopup.value = false; return; }
  if (pendingFiles.value.length > 0) {
    uploadAttachments().then(() => {
      inputText.value = '';
      editorRef.value?.clear();
    }).catch(() => { /* error already displayed */ });
    return;
  }
  if (!inputText.value.trim()) return;
  if (props.editingMessage) {
    emit('edit-message', props.editingMessage.id, inputText.value);
  } else {
    emit('send', inputText.value, props.replyingTo?.id ?? null);
  }
  inputText.value = '';
  editorRef.value?.clear();
  emit('cancel-reply-edit');
}

function applySuggestion() { if (!props.aiSuggestion) return; inputText.value = props.aiSuggestion; }

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatMessageTime(d: string) {
  return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** Extract image URL from JSON content */
function getImageUrl(msg: Message): string | null {
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

// ── Scroll on new messages ──────────────────────────────────────────────────

watch(() => props.messages.length, async () => {
  await nextTick();
  if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
});
</script>

<style scoped>
.message-bubble { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.album-grid { display: grid; gap: 3px; border-radius: 10px; overflow: hidden; max-width: 420px; }
.album-grid-1 { grid-template-columns: 1fr; }
.album-grid-2 { grid-template-columns: 1fr 1fr; }
.album-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.album-tile { width: 100%; aspect-ratio: 1/1; object-fit: cover; cursor: pointer; transition: transform 0.2s; }
.album-tile:hover { transform: scale(1.02); }
.attachment-chip { position: relative; width: 60px; height: 60px; }
.attachment-thumb { width: 60px; height: 60px; object-fit: cover; border-radius: 8px; display: block; }
.attachment-video { background: #333; display: flex; align-items: center; justify-content: center; }
.attachment-remove { position: absolute; top: -6px; right: -6px; background: rgba(0,0,0,0.7) !important; min-width: 20px !important; width: 20px !important; height: 20px !important; }
.chat-input-area { position: relative; }
.drop-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0, 242, 255, 0.15); border: 2px dashed var(--border-glow, rgba(0,242,255,0.6)); border-radius: 12px; z-index: 10; pointer-events: none; backdrop-filter: blur(4px); }
</style>
