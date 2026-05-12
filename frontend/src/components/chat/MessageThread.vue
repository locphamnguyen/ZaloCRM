<template>
  <div class="message-thread">
    <!-- Empty state -->
    <div v-if="!conversation" class="empty-state">
      <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
      <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
    </div>

    <template v-else>
      <!-- ════════ Chat header (Smax-style — 2 rows) ════════ -->
      <header class="chat-header">
        <Avatar
          :src="headerAvatarSrc"
          :name="headerName"
          :size="46"
          :gender="contactGender"
          :is-group="conversation.threadType === 'group'"
          :gradient-seed="conversation.id"
        />

        <div class="ch-info">
          <!-- Row 1: Name | Gender/Group icon to + Care status -->
          <div class="ch-row-1">
            <div class="ch-name" :title="headerName">{{ headerName }}</div>
            <span class="ch-sep">|</span>
            <span class="ch-gender-chip" :class="genderChipClass" :title="genderTitle">
              <svg v-if="conversation.threadType === 'group'" class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
              <svg v-else-if="contactGender === 'female'" class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17 9.5C17 6.46 14.54 4 11.5 4S6 6.46 6 9.5c0 2.71 1.96 4.94 4.5 5.41V17H8v2h2.5v2.5h2V19H15v-2h-2.5v-2.09c2.54-.47 4.5-2.7 4.5-5.41zm-9 0C8 7.57 9.57 6 11.5 6S15 7.57 15 9.5S13.43 13 11.5 13S8 11.43 8 9.5z"/>
              </svg>
              <svg v-else-if="contactGender === 'male'" class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 4h-6v2h2.59l-4.13 4.13C10.65 9.42 9.36 9 8 9c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6c0-1.36-.42-2.65-1.13-3.74L17 7.41V10h2V4h0zM8 19c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
              </svg>
              <svg v-else class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
              </svg>
              <span class="gender-label">{{ genderLabel }}</span>
            </span>
            <CareStatusBadge
              v-if="conversation.contact"
              :model-value="(conversation.contact.status as string | null) || 'new'"
              @update:model-value="onCareStatusChange"
            />
          </div>

          <!-- Row 2: nick avatar + nick name | in/out | last online -->
          <div class="ch-row-2">
            <Avatar
              v-if="conversation.zaloAccount"
              :src="conversation.zaloAccount.avatarUrl"
              :name="conversation.zaloAccount.displayName || 'Nick'"
              :size="22"
              :gradient-seed="conversation.zaloAccount.id"
              platform="zalo"
            />
            <span class="nick-name" :title="conversation.zaloAccount?.displayName || ''">
              {{ conversation.zaloAccount?.displayName || '—' }}
            </span>
            <span class="ch-sep">|</span>
            <span class="msg-counts" :title="`${msgInCount} tin đến / ${msgOutCount} tin gửi`">
              <span class="cnt-in">{{ msgInCount }}</span>↘
              <span class="cnt-out">{{ msgOutCount }}</span>↗
            </span>
            <span class="ch-sep">|</span>
            <span class="last-online" :class="{ 'is-online': isOnline }">
              <span class="online-dot" />
              {{ lastOnlineLabel }}
            </span>
          </div>
        </div>

        <div class="ch-actions">
          <!-- Smart friendship button: state-aware -->
          <button
            v-if="friendshipState === 'friend'"
            class="btn-action btn-friend-already"
            :title="friendshipTitle"
            disabled
          >
            <span class="ic">✓</span> Đã KB
            <span v-if="friendDaysLabel" class="sub-meta">{{ friendDaysLabel }}</span>
          </button>
          <button
            v-else-if="friendshipState === 'pending_friend'"
            class="btn-action btn-pending"
            :title="`Đã gửi mời. ${pendingDaysLabel}. Click để hủy.`"
            @click="onCancelInvite"
          >
            <span class="ic">📤</span> Đã mời <span class="sub-meta">{{ pendingDaysLabel }}</span>
          </button>
          <button
            v-else-if="friendshipState === 'ghost'"
            class="btn-action btn-add-friend"
            title="KH đã ngắt — gửi mời lại?"
            @click="onSendInvite"
          >
            <span class="ic">+</span> Mời lại
          </button>
          <button
            v-else-if="conversation.threadType === 'user'"
            class="btn-action btn-add-friend"
            title="Gửi lời mời kết bạn"
            @click="onSendInvite"
          >
            <span class="ic">+</span> Kết bạn
          </button>

          <button class="btn-action btn-webhook" :disabled="webhookLoading" @click="fireWebhook">
            {{ webhookLoading ? '⏳ Đang bắn…' : '🚀 Webhook' }}
          </button>

          <!-- More dropdown: gộp Lịch sử / Tìm / Note -->
          <v-menu>
            <template #activator="{ props: act }">
              <button class="icon-btn" v-bind="act" title="Thêm">⋮</button>
            </template>
            <v-list density="compact" min-width="180">
              <v-list-item prepend-icon="mdi-history" title="Lịch sử hội thoại" @click="toast.push('Lịch sử: chưa implement')" />
              <v-list-item prepend-icon="mdi-magnify" title="Tìm trong hội thoại" @click="toast.push('Tìm: chưa implement')" />
              <v-list-item prepend-icon="mdi-note-edit-outline" title="Ghi chú nhanh" @click="onOpenNote" />
              <v-divider />
              <v-list-item prepend-icon="mdi-bell-off-outline" title="Tắt thông báo" @click="toast.push('Mute: chưa implement')" />
              <v-list-item prepend-icon="mdi-flag-outline" title="Báo cáo" @click="toast.push('Report: chưa implement')" />
            </v-list>
          </v-menu>

          <button
            class="icon-btn"
            :class="{ on: showContactPanel }"
            title="Toggle thông tin KH"
            @click="$emit('toggle-contact-panel')"
          >ⓘ</button>
        </div>
      </header>

      <!-- ════════ Messages ════════ -->
      <div ref="messagesContainer" class="messages chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

        <template v-for="item in displayItems" :key="item.key">
          <!-- Date divider -->
          <div v-if="item.kind === 'divider'" class="msg-divider">{{ item.label }}</div>

          <!-- Album -->
          <div v-else-if="item.kind === 'album'" class="msg-album-wrap" :class="item.senderType === 'self' ? 'self' : ''">
            <div class="msg-album-body">
              <div v-if="conversation.threadType === 'group' && item.senderType !== 'self'" class="album-sender">
                {{ item.senderName || 'Unknown' }}
              </div>
              <div class="bubble album">
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
                <div v-if="item.totalExpected && item.totalExpected > item.messages.length" class="album-progress">
                  {{ item.messages.length }}/{{ item.totalExpected }} ảnh đã nhận
                </div>
                <div class="bubble-time">
                  {{ formatMessageTime(item.sentAt) }} · 🖼️ {{ item.messages.length }} ảnh
                </div>
              </div>
            </div>
          </div>

          <!-- Reminder notice — render inline timeline event (centered, no bubble) -->
          <div v-else-if="isReminderNotice(item.msg)" class="msg-system-event reminder-notice">
            <v-icon size="14" color="warning" class="mr-1">mdi-bell-ring</v-icon>
            <span>{{ reminderNoticeText(item.msg) }}</span>
            <span v-if="reminderNoticeTime(item.msg)" class="reminder-notice-time">· {{ reminderNoticeTime(item.msg) }}</span>
          </div>

          <!-- Single message — MessageBubble component -->
          <MessageBubble
            v-else
            :message="item.msg"
            :reply="item.msg.reply || null"
            :reactions="item.msg.reactions || []"
            :is-self="item.msg.senderType === 'self'"
            :is-group="conversation.threadType === 'group'"
            :sender-avatar-url="resolveSenderAvatar(item.msg)"
            @contextmenu="onContextMenu($event, item.msg)"
            @preview-image="previewImageUrl = $event"
            @toggle-reaction="onToggleReaction(item.msg, $event)"
            @sender-click="onSenderClick(item.msg)"
          />
        </template>

        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Typing indicator -->
      <TypingIndicator :typers="currentTypers" />

      <!-- AI suggest bar -->
      <AISuggestBar
        :suggestion="aiSuggestion"
        :loading="aiSuggestionLoading"
        :error="aiSuggestionError"
        @use="applySuggestion"
        @refresh="$emit('ask-ai')"
      />

      <!-- ════════ Input area: toolbar trên textarea (Smax-style) ════════ -->
      <div class="input-area">
        <ReplyPreviewBar
          :message="(replyingTo || editingMessage) ?? null"
          :mode="editingMessage ? 'edit' : 'reply'"
          @cancel="onCancelReplyEdit"
        />

        <!-- Compact toolbar (Zalo-style): chỉ 6 nút chức năng cốt lõi -->
        <div class="input-toolbar-top">
          <StickerPicker @select="onSendSticker" />
          <button class="icon-tool" title="Gửi ảnh" @click="onPickImage">
            <v-icon size="18">mdi-image-outline</v-icon>
          </button>
          <button class="icon-tool" title="Gửi file" @click="onPickFile">
            <v-icon size="18">mdi-paperclip</v-icon>
          </button>
          <button class="icon-tool" title="Gửi danh thiếp" @click="todoToast('Danh thiếp')">
            <v-icon size="18">mdi-account-box-outline</v-icon>
          </button>
          <button class="icon-tool" title="Định dạng văn bản" @click="toggleFormat">
            <v-icon size="18">mdi-format-text</v-icon>
          </button>
          <button class="icon-tool" title="Tạo nhắc hẹn" @click="todoToast('Nhắc hẹn')">
            <v-icon size="18">mdi-calendar-clock</v-icon>
          </button>
          <button class="icon-tool" title="Template tin nhắn (gõ /)" @click="openTemplatePopup">
            <v-icon size="18">mdi-flash-outline</v-icon>
          </button>
          <button class="icon-tool ai-btn" title="AI compose" :disabled="aiSuggestionLoading" @click="$emit('ask-ai')">
            <v-icon size="18">mdi-creation</v-icon>
          </button>
        </div>

        <div class="input-row">
          <!-- Avatar nick đang gửi (thụt vào để input thẳng hàng) -->
          <Avatar
            v-if="conversation.zaloAccount"
            :src="conversation.zaloAccount.avatarUrl"
            :name="conversation.zaloAccount.displayName || 'Nick'"
            :size="34"
            :gradient-seed="conversation.zaloAccount.id"
            platform="zalo"
            :title="`Đang gửi từ nick: ${conversation.zaloAccount.displayName || ''}`"
            class="sender-nick-avatar"
          />

          <div class="editor-wrap">
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
              :placeholder="inputPlaceholder"
              class="input-editor"
              @submit="handleSend"
              @typing="onTypingEvent"
              @paste-image="onPasteImage"
            />
          </div>

          <!-- Emoji picker (hover) — sát nút Gửi -->
          <EmojiPicker @pick="onPickEmoji" />

          <button class="send-btn" :disabled="!inputText.trim() || sending" @click="handleSend" title="Gửi (Enter)">
            <v-icon v-if="sending" size="20">mdi-loading mdi-spin</v-icon>
            <v-icon v-else size="20">mdi-send</v-icon>
          </button>
        </div>

        <!-- Hidden file inputs cho upload ảnh / file -->
        <input
          ref="imageInputRef"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="onImageFilesPicked"
        />
        <input
          ref="fileInputRef"
          type="file"
          multiple
          style="display: none"
          @change="onFileFilesPicked"
        />
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

    <!-- Image preview -->
    <v-dialog v-model="showImagePreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="showImagePreview = false" style="cursor: pointer;">
        <img :src="previewImageUrl" alt="Preview" style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);" />
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn để đóng</div>
      </div>
    </v-dialog>

    <!-- Zalo user info dialog — click avatar/sender trong group → mở -->
    <ZaloUserInfoDialog v-model="userInfoDialog" :uid="userInfoUid" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import AISuggestBar from '@/components/chat/AISuggestBar.vue';
import CareStatusBadge from '@/components/ui/CareStatusBadge.vue';
import Avatar from '@/components/ui/Avatar.vue';
import EmojiPicker from '@/components/chat/EmojiPicker.vue';
import QuickTemplatePopup from '@/components/chat/quick-template-popup.vue';
import MessageBubble from '@/components/chat/message-bubble.vue';
import StickerPicker from '@/components/chat/StickerPicker.vue';
import ZaloUserInfoDialog from '@/components/chat/ZaloUserInfoDialog.vue';
import MessageContextMenu from '@/components/chat/message-context-menu.vue';
import TypingIndicator from '@/components/chat/typing-indicator.vue';
import ReplyPreviewBar from '@/components/chat/reply-preview-bar.vue';
import ForwardDialog from '@/components/chat/forward-dialog.vue';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';
import { useToast } from '@/composables/use-toast';

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
  'care-status-changed': [value: string];
}>();

const toast = useToast();
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) previewImageUrl.value = ''; } });
const webhookLoading = ref(false);

// Context menu state
const showContextMenu = ref(false);
const contextMsg = ref<Message | null>(null);
const contextPos = ref({ x: 0, y: 0 });
const showForwardDialog = ref(false);
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const currentTypers = computed(() => props.typingUsers || []);

// ── Header derived data (Avatar handles initials/gradient/gender) ──────────
const headerName = computed(() => {
  if (props.conversation?.threadType === 'group') {
    return (props.conversation as { groupName?: string }).groupName
      || props.conversation?.contact?.fullName
      || 'Nhóm Zalo';
  }
  const c = props.conversation?.contact;
  return c?.crmName || c?.fullName || 'Unknown';
});
const headerAvatarSrc = computed(() => {
  if (props.conversation?.threadType === 'group') {
    return (props.conversation as { groupAvatarUrl?: string }).groupAvatarUrl || null;
  }
  return props.conversation?.contact?.avatarUrl || null;
});
const contactGender = computed(() => props.conversation?.contact?.gender || null);

const genderLabel = computed(() => {
  if (props.conversation?.threadType === 'group') return 'Nhóm';
  if (contactGender.value === 'female') return 'Nữ';
  if (contactGender.value === 'male') return 'Nam';
  return 'Chưa rõ';
});
const genderTitle = computed(() => {
  if (props.conversation?.threadType === 'group') return 'Nhóm hội thoại';
  return `Giới tính: ${genderLabel.value}`;
});
const genderChipClass = computed(() => {
  if (props.conversation?.threadType === 'group') return 'gender-group';
  if (contactGender.value === 'female') return 'gender-female';
  if (contactGender.value === 'male') return 'gender-male';
  return 'gender-unknown';
});

// ── Message counts (per-pair, lấy từ contact aggregate cho user thread) ──────
const msgInCount = computed(() => props.conversation?.contact?.totalInbound ?? 0);
const msgOutCount = computed(() => props.conversation?.contact?.totalOutbound ?? 0);

// ── Last online status ──────────────────────────────────────────────────────
// MOCK: dùng contact.lastInboundAt làm proxy. Chờ wire endpoint
// GET /zalo-accounts/:accountId/profile/last-online/:userId cho realtime.
const onlineMins = computed<number | null>(() => {
  if (props.conversation?.threadType === 'group') return null;
  const at = props.conversation?.contact?.lastInboundAt;
  if (!at) return null;
  return Math.floor((Date.now() - new Date(at).getTime()) / 60000);
});
const isOnline = computed(() => onlineMins.value != null && onlineMins.value < 5);
const lastOnlineLabel = computed(() => {
  if (props.conversation?.threadType === 'group') {
    const count = (props.conversation as { groupMembersCount?: number | null }).groupMembersCount;
    return count ? `${count} thành viên` : 'Nhóm';
  }
  const mins = onlineMins.value;
  if (mins == null) return 'Không rõ';
  if (mins < 5) return 'Vừa online';
  if (mins < 60) return `Online ${mins}p trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Online ${hours}h trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Online ${days}d trước`;
  return 'Không rõ';
});

// ── Resolve sender avatar cho MessageBubble ─────────────────────────────────
// User thread: incoming msgs → conversation.contact.avatarUrl
// Group: lookup per-sender qua backend cache via /api/v1/zalo-user-info/:uid
const groupAvatarCache = ref<Record<string, string>>({}); // uid → avatar URL

async function fetchGroupSenderAvatar(uid: string) {
  if (!uid || groupAvatarCache.value[uid] !== undefined) return;
  groupAvatarCache.value[uid] = ''; // mark fetching để tránh duplicate calls
  try {
    const res = await api.get(`/zalo-user-info/${uid}`);
    groupAvatarCache.value[uid] = res.data?.avatar || '';
  } catch {
    groupAvatarCache.value[uid] = '';
  }
}

function resolveSenderAvatar(msg: Message): string | null {
  if (msg.senderType === 'self') return null;
  if (props.conversation?.threadType === 'user') {
    return props.conversation?.contact?.avatarUrl || null;
  }
  // Group: fetch async + return cached URL nếu có
  if (msg.senderUid) {
    if (groupAvatarCache.value[msg.senderUid] === undefined) {
      void fetchGroupSenderAvatar(msg.senderUid);
    }
    return groupAvatarCache.value[msg.senderUid] || null;
  }
  return null;
}

// ── Click avatar / sender → open Zalo profile dialog ────────────────────────
const userInfoDialog = ref(false);
const userInfoUid = ref('');
function onSenderClick(msg: Message) {
  if (!msg.senderUid || msg.senderType === 'self') return;
  userInfoUid.value = msg.senderUid;
  userInfoDialog.value = true;
}

// ── Reminder notice (inline timeline event) ─────────────────────────────────
// Zalo gửi 2 row khi tạo reminder: notice "X tạo nhắc hẹn mới Y - HH:mm" (action=msginfo.actionlist)
// và card (action=show.profile). Notice không nên là bubble — render centered inline event.
function isReminderNotice(msg: Message): boolean {
  if (msg.contentType !== 'reminder') return false;
  try {
    const p = JSON.parse(msg.content || '{}');
    return p.action === 'msginfo.actionlist';
  } catch { return false; }
}
function reminderNoticeText(msg: Message): string {
  try {
    const p = JSON.parse(msg.content || '{}');
    return String(p.title || '').trim() || 'Nhắc hẹn mới';
  } catch { return 'Nhắc hẹn mới'; }
}
function reminderNoticeTime(msg: Message): string {
  try {
    const p = JSON.parse(msg.content || '{}');
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    const hl = Array.isArray(params?.highLightsV2) ? params.highLightsV2 : [];
    for (const h of hl) {
      if (Number(h.ts) > 1e12) {
        return new Date(Number(h.ts)).toLocaleString('vi-VN', {
          weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
      }
    }
  } catch {}
  return '';
}
// ── Smart friendship state ─────────────────────────────────────────────────
// Source: conv.friendship (backend join Friend by zaloAccountId × contactId).
// Fallback heuristic: nếu không có Friend record nhưng contact.zaloUid set → assume 'chatting_stranger'.
type FriendshipState = 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost' | null;

const friendshipState = computed<FriendshipState>(() => {
  if (props.conversation?.threadType !== 'user') return null;
  const fs = props.conversation?.friendship;
  if (fs) {
    const k = fs.relationshipKind;
    if (k === 'friend' || k === 'pending_friend' || k === 'chatting_stranger' || k === 'ghost') {
      return k;
    }
  }
  // No friend record yet → if contact has zaloUid (đã từng xuất hiện) treat as stranger
  if (props.conversation?.contact?.zaloUid) return 'chatting_stranger';
  return null;
});

const friendDaysLabel = computed(() => {
  const at = props.conversation?.friendship?.becameFriendAt;
  if (!at) return null;
  const d = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  if (d < 1) return 'hôm nay';
  if (d < 30) return `${d} ngày`;
  if (d < 365) return `${Math.floor(d / 30)} tháng`;
  return `${Math.floor(d / 365)} năm`;
});

const pendingDaysLabel = computed(() => {
  // becameFriendAt được set khi accept; với pending dùng firstMessageAt (first outbound) làm proxy
  const at = props.conversation?.friendship?.firstMessageAt
    || props.conversation?.contact?.lastOutboundAt
    || null;
  if (!at) return 'vừa gửi';
  const d = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  if (d < 1) return 'hôm nay';
  if (d < 30) return `${d} ngày`;
  return `${Math.floor(d / 30)} tháng`;
});

const friendshipTitle = computed(() => {
  if (friendshipState.value === 'friend') {
    return friendDaysLabel.value ? `Đã kết bạn ${friendDaysLabel.value}` : 'Đã kết bạn';
  }
  return '';
});

// Action stubs — chờ backend wire /friends/requests
function onSendInvite() {
  toast.warning('Gửi mời KB: chờ backend POST /friends/requests');
}
function onCancelInvite() {
  toast.warning('Hủy mời KB: chờ backend DELETE /friends/requests/:uid');
}
function onOpenNote() {
  // Open right info panel + scroll to note footer
  if (!props.showContactPanel) emit('toggle-contact-panel');
  toast.push('Mở ghi chú nhanh ở panel bên phải');
}
const inputPlaceholder = computed(() => {
  // Bỏ "Đang nhắn từ nick" vì đã có avatar nick bên trái input — gọn hơn.
  // Hint phím tắt giữ ngắn gọn.
  return 'Gõ tin nhắn… ("/" template, "@" mention, "#" tag)';
});

function onCareStatusChange(value: string) {
  emit('care-status-changed', value);
  toast.success(`Đã đổi care status → ${value}`);
}

async function fireWebhook() {
  if (!props.conversation?.contact?.id) return;
  webhookLoading.value = true;
  try {
    // MOCK: chờ POST /webhooks/fire endpoint
    await new Promise(r => setTimeout(r, 700));
    toast.success('Webhook đã bắn về CRM');
  } catch {
    toast.error('Webhook fail');
  } finally {
    webhookLoading.value = false;
  }
}

function todoToast(label: string) {
  toast.push(`${label}: chưa implement`, 'warning');
}

function onPickEmoji(emoji: string) {
  editorRef.value?.insertText(emoji);
}

// Send sticker từ picker — POST /sticker với {id, catId, type}
async function onSendSticker(sticker: { id: number; catId: number; type: number }) {
  if (!props.conversation?.id) return;
  try {
    await api.post(`/conversations/${props.conversation.id}/sticker`, {
      stickerId: sticker.id,
      cateId: sticker.catId,
      type: sticker.type,
    });
    emit('refresh-thread');
    // Scroll xuống ngay (retry x3 trong scrollToBottom xử lý img async load)
    await nextTick();
    scrollToBottom();
  } catch (err) {
    console.error('[sticker] send error:', err);
    toast.push('Không gửi được sticker', 'error');
  }
}

// ── File / image upload ─────────────────────────────────────────────────────
const imageInputRef = ref<HTMLInputElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

function onPickImage() { imageInputRef.value?.click(); }
function onPickFile() { fileInputRef.value?.click(); }

function onImageFilesPicked(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  if (files.length) handleImageFiles(files);
  if (imageInputRef.value) imageInputRef.value.value = '';
}
function onFileFilesPicked(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  if (files.length) handleFiles(files);
  if (fileInputRef.value) fileInputRef.value.value = '';
}
function onPasteImage(files: File[]) {
  // Bắt được khi user Ctrl+V image vào editor
  handleImageFiles(files);
}

async function handleImageFiles(files: File[]) {
  if (!props.conversation?.id) return;
  if (!files.length) return;
  toast.push(`📷 Đang gửi ${files.length} ảnh…`);
  try {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    await api.post(`/conversations/${props.conversation.id}/upload-image`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    toast.success(`Đã gửi ${files.length} ảnh`);
    emit('refresh-thread');
  } catch (err) {
    const detail = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload thất bại';
    toast.error(`Lỗi gửi ảnh: ${detail}`);
    console.error('[upload-image]', err);
  }
}
async function handleFiles(files: File[]) {
  // TODO: backend chưa có endpoint /upload-file riêng cho non-image
  // Tạm dùng same endpoint upload-image — Zalo SDK auto detect type qua extension
  if (!props.conversation?.id) return;
  if (!files.length) return;
  toast.push(`📎 Đang gửi ${files.length} file…`);
  try {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    await api.post(`/conversations/${props.conversation.id}/upload-image`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    toast.success(`Đã gửi ${files.length} file`);
    emit('refresh-thread');
  } catch (err) {
    const detail = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload thất bại';
    toast.error(`Lỗi gửi file: ${detail}`);
  }
}

// ── Format toggle (HTML formatting toolbar of RichTextEditor) ────────────────
const formatBarVisible = ref(false);
function toggleFormat() {
  formatBarVisible.value = !formatBarVisible.value;
  // RichTextEditor toolbar tự show khi focus; click button này để focus + toggle CSS class
  if (formatBarVisible.value) {
    editorRef.value?.focus();
    toast.push('Bôi đen text rồi dùng Ctrl+B / Ctrl+I / Ctrl+U');
  }
}

// ── Display item types (album grouping + date dividers) ─────────────────────
type DisplayItem =
  | { kind: 'single'; key: string; msg: Message }
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'album'; key: string; senderType: string; senderName: string | null; sentAt: string; totalExpected: number | null; messages: Message[] };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  if (day.getTime() === today.getTime()) return `Hôm nay ${hh}:${mi}`;
  if (day.getTime() === yesterday.getTime()) return `Hôm qua ${hh}:${mi}`;
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const displayItems = computed<DisplayItem[]>(() => {
  const out: DisplayItem[] = [];
  let curAlbum: Extract<DisplayItem, { kind: 'album' }> | null = null;
  let lastDayKey = '';

  for (const msg of props.messages) {
    const d = new Date(msg.sentAt);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${Math.floor(d.getHours() / 4)}`;
    if (dayKey !== lastDayKey) {
      out.push({ kind: 'divider', key: 'div:' + dayKey, label: dayLabel(msg.sentAt) });
      lastDayKey = dayKey;
      curAlbum = null;
    }

    const canGroup = msg.contentType === 'image' && msg.albumKey && !msg.isDeleted && !!getImageUrl(msg);
    if (canGroup && curAlbum && curAlbum.key === `album:${msg.albumKey}:${msg.senderType}`) {
      curAlbum.messages.push(msg);
      continue;
    }
    curAlbum = null;
    if (canGroup) {
      curAlbum = {
        kind: 'album',
        key: `album:${msg.albumKey}:${msg.senderType}`,
        senderType: msg.senderType,
        senderName: msg.senderName,
        sentAt: msg.sentAt,
        totalExpected: msg.albumTotal ?? null,
        messages: [msg],
      };
      out.push(curAlbum);
    } else {
      out.push({ kind: 'single', key: msg.id, msg });
    }
  }
  for (const item of out) {
    if (item.kind === 'album') {
      item.messages.sort((a, b) => (a.albumIndex ?? 0) - (b.albumIndex ?? 0));
    }
  }
  return out;
});

function albumGridClass(count: number): string {
  if (count <= 1) return 'album-grid-1';
  if (count <= 4) return 'album-grid-2';
  return 'album-grid-3';
}

// ── Context menu / actions ──────────────────────────────────────────────────
function onContextMenu(event: MouseEvent, msg: Message) {
  contextMsg.value = msg;
  contextPos.value = { x: event.clientX, y: event.clientY };
  showContextMenu.value = true;
}
function onToggleReaction(msg: Message, emoji: string) { emit('add-reaction', msg.id, emoji); }
function onReply() { if (contextMsg.value) emit('set-reply-to', contextMsg.value); }
function onEdit() {
  if (contextMsg.value) {
    emit('set-editing', contextMsg.value);
    inputText.value = contextMsg.value.content || '';
  }
}
function onDelete() { if (contextMsg.value) emit('delete-message', contextMsg.value.id); }
function onUndo() { if (contextMsg.value) emit('undo-message', contextMsg.value.id); }
function onPin() { emit('pin-conversation'); }


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
  } catch { /* non-critical */ }
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
    if (lastSlash === -1) showTemplatePopup.value = false;
    else templateQuery.value = value.slice(lastSlash + 1);
  }
}

function openTemplatePopup() {
  showTemplatePopup.value = true;
  templateQuery.value = '';
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

function applySuggestion(text?: string) {
  const t = text || props.aiSuggestion;
  if (!t) return;
  inputText.value = t;
  toast.success('Đã chèn vào ô chat');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatMessageTime(d: string) {
  return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

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

/** Scroll xuống đáy (tin nhắn mới nhất). Retry sau khi images load. */
function scrollToBottom(immediate = false) {
  if (!messagesContainer.value) return;
  const el = messagesContainer.value;
  el.scrollTop = el.scrollHeight;
  if (!immediate) {
    // Retry vài lần vì image load async — đảm bảo cuộn xuống tận cùng sau khi hình rendered
    setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 100);
    setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 400);
    setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 1000);
  }
}

// Khi messages thêm (tin mới đến) → scroll mượt
watch(() => props.messages.length, async () => {
  await nextTick();
  scrollToBottom();
});

// Khi đổi sang conv khác → reset scroll xuống đáy ngay + retry sau khi messages
// load xong (messages.length thay đổi async sau khi parent fetch).
watch(() => props.conversation?.id, async (newId) => {
  if (!newId) return;
  await nextTick();
  scrollToBottom();
  // Retry sau khi messages async load — scrollToBottom đã có retry 100/400/1000ms
  // nhưng nếu messages chưa thay đổi sau lần đầu thì watch messages.length sẽ trigger tiếp.
});
</script>

<style scoped>
.message-thread {
  display: flex; flex-direction: column;
  height: 100%;
  background: var(--smax-grey-100);
  overflow: hidden;
}

.empty-state {
  display: flex; flex: 1;
  align-items: center; justify-content: center;
  flex-direction: column;
  color: var(--smax-grey-700);
}

/* ════════ Chat header (2-row layout) ════════ */
.chat-header {
  background: var(--smax-bg);
  padding: 10px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
  display: flex; align-items: center; gap: 13px;
  flex-shrink: 0;
}

.ch-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 5px;
}

/* Row 1: Name | Gender icon | Care status */
.ch-row-1 {
  display: flex; align-items: center; gap: 8px;
  min-width: 0; /* cho phép children shrink — ch-name ellipsis hoạt động */
  flex-wrap: nowrap; overflow: hidden;
}
.ch-name {
  font-weight: 600; font-size: 16px;
  color: var(--smax-text);
  min-width: 0; flex-shrink: 1; max-width: 320px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ch-sep {
  color: var(--smax-grey-300);
  font-weight: 300;
  user-select: none;
}

/* Gender/Group chip — icon to + label */
.ch-gender-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px 3px 5px;
  border-radius: 13px;
  font-size: 12px; font-weight: 500;
}
.ch-gender-chip .gender-svg {
  width: 16px; height: 16px;
  flex-shrink: 0;
}
.gender-female {
  background: rgba(233, 30, 99, 0.10);
  color: var(--smax-female, #e91e63);
}
.gender-male {
  background: rgba(30, 136, 229, 0.10);
  color: var(--smax-male, #1e88e5);
}
.gender-unknown {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
}
.gender-unknown .gender-q { background: var(--smax-grey-700); }
.gender-group {
  background: rgba(13, 71, 161, 0.10);
  color: #0D47A1;
}

/* Row 2: nick avatar + nick name | in/out | last online */
.ch-row-2 {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--smax-grey-700);
  flex-wrap: wrap;
}
.nick-name {
  font-weight: 500; color: var(--smax-text);
  max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.msg-counts {
  display: inline-flex; align-items: center; gap: 7px;
}
.msg-counts .cnt-in {
  color: #00897b; font-weight: 600;
}
.msg-counts .cnt-out {
  color: var(--smax-primary); font-weight: 600;
}
.last-online {
  display: inline-flex; align-items: center; gap: 4px;
}
.last-online .online-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--smax-grey-300);
  flex-shrink: 0;
}
.last-online.is-online .online-dot {
  background: var(--smax-success);
  box-shadow: 0 0 0 2px rgba(0, 200, 83, 0.15);
  animation: online-pulse 2s ease-in-out infinite;
}
@keyframes online-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(0, 200, 83, 0.15); }
  50%      { box-shadow: 0 0 0 4px rgba(0, 200, 83, 0.30); }
}

/* Legacy keeps */
.status-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 500;
}
.pill-success { background: rgba(0,200,83,0.12); color: #00897b; }

.ch-actions { display: flex; gap: 5px; align-items: center; }
.btn-action {
  padding: 6px 11px;
  border-radius: 7px;
  border: 1px solid;
  cursor: pointer;
  font-size: 12px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--smax-bg);
  font-family: inherit;
}
.btn-friend-already {
  background: rgba(0,200,83,0.08);
  color: #00897b;
  border-color: rgba(0,200,83,0.25);
  cursor: default;
}
.btn-friend-already:disabled { opacity: 1; }
.btn-pending {
  background: rgba(255,145,0,0.10);
  color: #ef6c00;
  border-color: rgba(255,145,0,0.35);
}
.btn-pending:hover { background: rgba(255,145,0,0.18); }
.btn-add-friend {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  border-color: var(--smax-primary);
}
.btn-add-friend:hover { background: var(--smax-primary); color: white; }
.btn-action .ic {
  font-size: 13px;
  line-height: 1;
}
.btn-action .sub-meta {
  font-size: 10px;
  opacity: 0.7;
  font-weight: 400;
  margin-left: 2px;
}
.btn-webhook {
  background: var(--smax-primary);
  color: white;
  border-color: var(--smax-primary);
}
.btn-webhook:hover:not(:disabled) { background: var(--smax-primary-hover); }
.btn-webhook:disabled { opacity: 0.5; cursor: not-allowed; }

.icon-btn {
  width: 33px; height: 33px;
  border-radius: 7px;
  background: transparent; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--smax-grey-700);
  font-size: 15px;
}
.icon-btn:hover { background: var(--smax-grey-100); }
.icon-btn.on {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
}

/* ════════ Messages ════════ */
.messages {
  flex: 1; overflow-y: auto;
  padding: 14px 26px;
  display: flex; flex-direction: column; gap: 5px;
}
.msg-divider {
  text-align: center; margin: 13px 0 9px;
  color: var(--smax-grey-700); font-size: 11px;
}
.msg-divider::before,
.msg-divider::after {
  content: ''; display: inline-block;
  width: 60px; height: 1px;
  background: var(--smax-grey-300);
  vertical-align: middle; margin: 0 9px;
}

/* Inline system event (reminder notice, etc.) — centered, no bubble */
.msg-system-event {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 10px auto;
  padding: 6px 14px;
  background: rgba(255, 152, 0, 0.08);
  border: 1px solid rgba(255, 152, 0, 0.18);
  border-radius: 20px;
  font-size: 12px;
  color: #ef6c00;
  max-width: 80%;
  width: fit-content;
}
.msg-system-event.reminder-notice .reminder-notice-time {
  color: var(--smax-grey-700);
  font-weight: 500;
}

.msg-album-wrap { display: flex; }
.msg-album-wrap.self { justify-content: flex-end; }
.msg-album-body { max-width: 60%; }
.album-sender {
  font-size: 11px; color: var(--smax-primary);
  font-weight: 500; margin-bottom: 3px;
}
.bubble.album {
  background: var(--smax-bg);
  border-radius: 13px;
  overflow: hidden;
  box-shadow: 0 1px 1px rgba(0,0,0,0.06);
}
.album-grid { display: grid; gap: 3px; max-width: 420px; }
.album-grid-1 { grid-template-columns: 1fr; }
.album-grid-2 { grid-template-columns: 1fr 1fr; }
.album-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.album-tile {
  width: 100%; aspect-ratio: 1/1;
  object-fit: cover; cursor: pointer;
  transition: transform 0.2s;
}
.album-tile:hover { transform: scale(1.02); }
.album-progress { font-size: 10px; padding: 5px 9px; opacity: 0.7; }
.bubble-time {
  font-size: 11px; color: var(--smax-grey-700);
  padding: 5px 9px;
  text-align: right;
}

/* ════════ Input area ════════ */
.input-area {
  background: var(--smax-bg);
  border-top: 1px solid var(--smax-grey-200);
  padding: 7px 13px 9px;
  flex-shrink: 0;
}
.input-toolbar-top {
  display: flex; align-items: center; gap: 1px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--smax-grey-100);
  flex-wrap: wrap;
}
.icon-tool {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  color: var(--smax-grey-700);
  background: transparent; border: none;
  font-family: inherit;
}
.icon-tool:hover { background: var(--smax-grey-100); color: var(--smax-primary); }
.icon-tool.spacer-after {
  border-right: 1px solid var(--smax-grey-200);
  margin-right: 4px; padding-right: 4px;
}
.icon-tool.ai-btn { color: #9c27b0; }

.input-row {
  display: flex; align-items: flex-end; gap: 8px;
  position: relative;
}
.sender-nick-avatar {
  margin-bottom: 4px; /* căn đáy với textarea */
  flex-shrink: 0;
}
.editor-wrap {
  flex: 1; min-width: 0;
  position: relative;
}
.input-editor { width: 100%; }

.send-btn {
  background: var(--smax-primary);
  color: white;
  width: 40px; height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-bottom: 1px;
}
.send-btn:hover:not(:disabled) { background: var(--smax-primary-hover); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; background: var(--smax-grey-300); }

/* EmojiPicker trigger — emoji icon next to send button */
.input-row :deep(.emoji-trigger) {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
  font-size: 22px;
  cursor: pointer;
  border-radius: 50%;
  margin-bottom: 3px;
  flex-shrink: 0;
}
.input-row :deep(.emoji-trigger:hover) {
  background: var(--smax-grey-100);
}
</style>
