<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="msg-row" :class="{ self: isSelf }">
    <!-- Avatar bên trái cho tin nhắn đến (cả group + 1-1) — click → mở Zalo user info -->
    <Avatar
      v-if="!isSelf"
      :src="senderAvatarUrl"
      :name="message.senderName || '?'"
      :size="32"
      :gradient-seed="message.senderUid || message.senderName || ''"
      class="msg-avatar msg-avatar-clickable"
      @click="emit('sender-click')"
    />

    <div class="bubble-wrapper">
      <!-- bubble-anchor: positioning parent CHỈ cho bubble + reaction. Tách khỏi
           wrapper để reaction-display absolute bottom: tính từ BUBBLE BOTTOM, không
           phải wrapper bottom (wrapper kéo dài khi có receipt chip phía dưới). -->
      <div class="bubble-anchor">
      <!-- Bubble -->
      <div
        class="message-bubble"
        :class="{ 'is-self': isSelf, 'is-other': !isSelf }"
        @contextmenu.prevent="emit('contextmenu', $event)"
      >
        <!-- Tên người gửi cho tin INBOUND — Anh chốt 2026-06-03 (4 case):
             1a. Nick có owner trong org (CASE B): "Tuan HS · Sale: Anh Tuấn"
             2b. Nick lẻ có crmName (CASE A): "Chị Lan · Lan Nguyen"
             2a. Nick lẻ không crmName: chỉ tên Zalo thật
             3.  Bubble INBOUND tím pastel (khác xanh nhạt OUTBOUND)
             4a. Hiện ở CẢ 1-1 + group (đồng nhất)
             Click → mở Zalo user info dialog. -->
        <div
          v-if="!isSelf && (message as any).senderResolved"
          class="sender-name sender-name-clickable"
          :class="{ 'is-internal': (message as any).senderResolved?.senderIsInternalNick }"
          @click="emit('sender-click')"
        >
          <span class="sender-name-primary">
            {{ (message as any).senderResolved?.senderDisplayName || message.senderName || 'Người lạ' }}
          </span>

          <!-- CASE B: nick nội bộ (sale khác trong org) — chip "Sale: {owner}" -->
          <span
            v-if="(message as any).senderResolved?.senderIsInternalNick && (message as any).senderResolved?.senderInternalNickOwner"
            class="sender-internal-chip"
            :title="`Nick ${(message as any).senderResolved.senderInternalNickLabel ?? ''} của ${(message as any).senderResolved.senderInternalNickOwner}`"
          >
            · Sale: {{ (message as any).senderResolved.senderInternalNickOwner }}
          </span>

          <!-- CASE A có crmName: kèm tên Zalo nhỏ bên cạnh để đối chiếu -->
          <span
            v-else-if="(message as any).senderResolved?.senderCrmName && (message as any).senderResolved?.senderZaloName && (message as any).senderResolved.senderCrmName !== (message as any).senderResolved.senderZaloName"
            class="sender-zalo-secondary"
            :title="`Tên Zalo: ${(message as any).senderResolved.senderZaloName}`"
          >
            · {{ (message as any).senderResolved.senderZaloName }}
          </span>
        </div>

        <!-- Fallback group cũ khi senderResolved null (vd tin cũ trước migration) -->
        <div
          v-else-if="isGroup && !isSelf"
          class="sender-name sender-name-clickable"
          @click="emit('sender-click')"
        >
          {{ message.senderName || 'Người lạ' }}
        </div>

        <!-- M55 2026-05-30: Sender attribution cho multi-sale cùng chăm.
             Bubble self (tin sale gửi qua CRM) — nếu repliedByUserId !== viewer
             → hiện badge "Sale X gửi" để phân biệt với tin mình gửi.
             ── Luồng Mục Tiêu M11 (2026-06-02): nếu message có sentVia (M11 source
             identity), MessageSourceBadge sẽ cover case này với 5 variant đầy đủ
             (Sale CRM / Sale Native / Bot Automation / Bot AI / Bot System).
             Logic ưu tiên: M11 badge nếu có metadata.sender hoặc sentVia != 'user';
             fallback M55 .other-sale-tag cho legacy multi-sale case. -->
        <MessageSourceBadge
          v-if="message.sentVia || message.metadata?.sender"
          :message="message"
          :prev-message="prevMessage ?? null"
          @open-sequence="(sid) => emit('open-sequence', sid)"
          @explain-native="emit('explain-native')"
          @audit-ai="emit('audit-ai')"
        />
        <div
          v-else-if="isSelf && otherSaleSenderName"
          class="other-sale-tag"
          :title="`Tin do ${otherSaleSenderName} gửi`"
        >
          👤 {{ otherSaleSenderName }}
        </div>

        <!-- E04 Tin thu hồi — anh chốt 2026-05-21: icon 🔂 + italic xám + gạch ngang.
             Nội dung gốc giữ lại (gạch ngang) để sale biết KH/sale đã thu hồi cái gì. -->
        <div v-if="message.isDeleted" class="recall-card">
          <div class="recall-header">
            <span class="recall-icon">🔂</span>
            <span class="recall-label">Tin nhắn đã thu hồi</span>
          </div>
          <div v-if="message.content" class="recall-body">{{ message.content }}</div>
        </div>

        <template v-else>
          <div
            v-if="reply"
            class="reply-card"
            :class="{ 'reply-clickable': !!reply.msgId }"
            :title="reply.msgId ? 'Đi tới tin nhắn gốc' : ''"
            @click.stop="reply.msgId && emit('jump-to-reply', reply.msgId)"
          >
            <div class="reply-header">
              <v-icon size="11" class="reply-icon">mdi-reply</v-icon>
              <span class="reply-sender">Trả lời{{ replySenderLabel ? ' ' + replySenderLabel : '' }}</span>
            </div>
            <div class="reply-text">{{ replyPreviewText }}</div>
          </div>

          <!-- Reminder card — đặt TRƯỚC image branch vì thumb URL của reminder có đuôi .png
               sẽ làm getImageUrl trả về và render full size hình minh hoạ Zalo (bug cũ). -->
          <div v-if="isReminderMessage(message)" class="reminder-card">
            <div class="d-flex align-center mb-1">
              <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
              <span class="text-caption font-weight-bold" style="color: #FFB74D;">Nhắc hẹn</span>
            </div>
            <div class="text-body-2">{{ getReminderTitle(message) }}</div>
            <div v-if="getReminderTime(message)" class="text-caption mt-1" style="opacity: 0.7;">
              <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(message) }}
            </div>
          </div>

          <!-- Image (có thể kèm caption phía dưới) -->
          <div v-else-if="getImageUrl(message)">
            <!-- 2026-06-11: @error → placeholder khi ảnh Zalo hết hạn link (404) thay vì
                 ô vỡ + log đỏ Console. loading=lazy: ảnh ngoài màn hình không tải vội. -->
            <div v-if="imgFailed" class="chat-image-failed">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              <span>Ảnh không tải được</span>
            </div>
            <img
              v-else
              :src="getImageUrl(message)!"
              alt="Hình ảnh"
              class="chat-image"
              loading="lazy"
              decoding="async"
              @click="emit('preview-image', getImageUrl(message)!)"
              @error="imgFailed = true"
            />
            <div v-if="formattedCaption" class="media-caption" v-html="formattedCaption" />
          </div>

          <!-- File/PDF -->
          <div v-else-if="getFileInfo(message)">
            <div class="file-card">
              <v-icon size="20" class="mr-2" color="info">mdi-file-document-outline</v-icon>
              <div class="flex-grow-1">
                <div class="text-body-2 font-weight-medium">{{ getFileInfo(message)!.name }}</div>
                <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(message)!.size }}</div>
              </div>
              <v-btn
                v-if="getFileInfo(message)!.href"
                icon
                size="x-small"
                variant="text"
                @click="openFile(getFileInfo(message)!.href, getFileInfo(message)!.name)"
              >
                <v-icon size="16">mdi-download</v-icon>
              </v-btn>
            </div>
            <div v-if="formattedCaption" class="media-caption" v-html="formattedCaption" />
          </div>

          <!-- Sticker — animated CSS sprite hoặc static image -->
          <div v-else-if="message.contentType === 'sticker'">
            <div class="sticker-msg">
              <!-- Animated sticker: CSS sprite animation steps(N) duration -->
              <div
                v-if="stickerMeta && stickerMeta.spriteUrl && stickerMeta.totalFrames > 1"
                class="sticker-anim"
                :style="{
                  width: stickerMeta.size + 'px',
                  height: stickerMeta.size + 'px',
                  backgroundImage: `url(${stickerMeta.spriteUrl})`,
                  backgroundSize: `${stickerMeta.size * stickerMeta.totalFrames}px ${stickerMeta.size}px`,
                  animation: `sticker-play ${stickerMeta.duration * stickerMeta.totalFrames}ms steps(${stickerMeta.totalFrames}) infinite`,
                }"
              ></div>
              <!-- Static sticker hoặc fallback while loading metadata: img tag với staticUrl
                   (nếu chưa load xong meta, fallback dùng URL trực tiếp từ content via proxy) -->
              <img
                v-else-if="stickerFallbackUrl"
                :src="stickerMeta?.staticUrl || stickerFallbackUrl"
                alt="sticker"
                class="sticker-img"
              />
              <span v-else>🎴 Sticker</span>
            </div>
            <div v-if="formattedCaption" class="media-caption" v-html="formattedCaption" />
          </div>

          <!-- Video — thumbnail with play overlay + caption -->
          <div v-else-if="message.contentType === 'video'">
            <div class="video-msg">
              <div v-if="videoThumb" class="video-thumb-wrap" @click="openVideo">
                <img :src="videoThumb" alt="video thumbnail" class="video-thumb" />
                <div class="video-play-overlay">
                  <v-icon size="36" color="white">mdi-play-circle</v-icon>
                </div>
                <div v-if="videoDuration" class="video-duration">{{ videoDuration }}</div>
              </div>
              <div v-else-if="getVideoUrl(message)" class="chat-video-wrap">
                <video
                  :src="getVideoUrl(message)!"
                  class="chat-video"
                  controls
                  preload="metadata"
                  playsinline
                />
              </div>
              <div v-else class="video-card" @click="openVideo">
                <v-icon size="20" color="info" class="mr-2">mdi-video-outline</v-icon>
                <div>
                  <div class="text-body-2 font-weight-medium">{{ videoTitle || 'Video' }}</div>
                  <div v-if="videoSize" class="text-caption">{{ videoSize }}</div>
                </div>
              </div>
            </div>
            <div v-if="formattedCaption" class="media-caption" v-html="formattedCaption" />
          </div>

          <!-- E10/E11 Voice / Audio — anh chốt 2026-05-21: inline player có waveform-decor +
               controls native, KHÔNG mở external link. Browser tự handle play/pause/seek/duration. -->
          <div v-else-if="message.contentType === 'voice' || message.contentType === 'audio'">
            <div class="voice-msg-v2">
              <v-icon size="16" class="voice-mic-icon">mdi-microphone</v-icon>
              <audio
                v-if="voiceUrl"
                :src="voiceUrl"
                controls
                preload="metadata"
                class="voice-audio"
              />
              <span v-else class="voice-fallback">🎤 Tin thoại (không tải được)</span>
            </div>
            <div v-if="formattedCaption" class="media-caption" v-html="formattedCaption" />
          </div>

          <!-- GIF -->
          <div v-else-if="message.contentType === 'gif'">
            <div class="gif-msg">
              <img v-if="gifUrl" :src="gifUrl" alt="gif" class="gif-img" />
              <span v-else>🎞 GIF</span>
            </div>
            <div v-if="formattedCaption" class="media-caption" v-html="formattedCaption" />
          </div>

          <!-- Call message (action recommened.calltime/misscall — thường stored as contact_card) -->
          <SpecialMessageRenderer
            v-else-if="isCallMessage"
            type="call"
            :content="callContent"
            @callback="$emit('callback', message)"
          />

          <!-- Special types — anh chốt 2026-05-21: phân biệt contact_card variants:
               action='show.profile' → danh thiếp profile; action='recommened.user' → gợi ý bạn bè -->
          <SpecialMessageRenderer
            v-else-if="isSpecialType(message.contentType)"
            :type="resolveSpecialType(message)"
            :content="parseContent(message.content)"
            @callback="$emit('callback', message)"
            @open-profile="onOpenProfile"
          />

          <!-- Default text — parse @mention + bullets + linebreaks -->
          <!-- Anh chốt 2026-06-03: click vào mention → load info user giống click avatar.
               Event delegation: bắt click trên container, check target có class .mention + data-uid. -->
          <div v-else class="text-content" v-html="formattedText" @click="onMentionClick" />

        </template>

        <!-- Timestamp -->
        <div class="bubble-time" :class="{ 'text-end': isSelf }">
          {{ formatTime(message.sentAt) }}
          <!-- Bug 3 fix: badge "(đã sửa)" + tooltip hover xem nội dung gốc.
               Edit không sync Zalo — KH ở Zalo vẫn thấy bản cũ. Tooltip giúp sale tự verify. -->
          <span
            v-if="message.editedAt"
            class="edited-badge"
            :title="message.originalContent ? `Trước khi sửa: ${message.originalContent}` : 'Đã chỉnh sửa'"
          >· đã sửa</span>
        </div>
      </div>

      <!-- Reaction display — Anh chốt 2026-05-22 Zalo native:
           1 box duy nhất chứa icons + tổng count. self → align RIGHT, other → align LEFT.
           Bên trong bubble-anchor để absolute bottom: tính từ bubble bottom, không phải
           wrapper bottom (wrapper kéo dài khi có receipt-chip-row phía dưới). -->
      <reaction-display
        v-if="reactions && reactions.length > 0"
        :reactions="reactions"
        class="bubble-reaction-overlap"
        :class="{ 'reaction-align-right': isSelf, 'reaction-align-left': !isSelf }"
        @toggle="(emoji) => emit('toggle-reaction', emoji)"
        @open-detail="emit('open-reaction-detail', { reactions, message })"
      />
      </div><!-- /bubble-anchor -->

      <!-- Wave 1+2 (2026-05-22 anh chốt Zalo native UX): receipt chip CHỈ hiện
           cho tin OUTGOING CUỐI CÙNG. Render SAU reaction-display để chip nằm
           DƯỚI reaction (anh feedback: reaction che chữ "Đã xem"). Tin sent < 3s → ẩn. -->
      <div
        v-if="isSelf && isLastSelf && receiptState !== 'sent'"
        class="receipt-chip-row"
        :class="{ 'has-reaction-above': reactions && reactions.length > 0 }"
      >
        <span class="receipt-chip" :class="receiptState" :title="receiptTooltip">
          <svg v-if="receiptState === 'sending'" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <svg v-else-if="receiptState === 'delivered'" width="13" height="9" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 7 11 16 1" />
          </svg>
          <svg v-else width="16" height="9" viewBox="0 0 22 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 7 11 16 1" />
            <polyline points="8 6 13 11 21 2" />
          </svg>
          <span class="receipt-label">{{ receiptLabel }}</span>
        </span>
      </div>

      <!-- Hover reaction picker — bubble hover → trigger button visible →
           hover trigger → emoji picker mở (open-on-hover trong reaction-picker) -->
      <div class="reaction-trigger" :class="isSelf ? 'reaction-trigger--left' : 'reaction-trigger--right'">
        <reaction-picker @react="onPickerReact" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '@/composables/use-chat';
import { computed, ref, watch } from 'vue';
import { formatInOrgTz, weekdayInOrgTz } from '@/composables/use-org-timezone';
import SpecialMessageRenderer from '@/components/chat/special-message-renderer.vue';
import ReactionDisplay from '@/components/chat/reaction-display.vue';
import ReactionPicker from '@/components/chat/reaction-picker.vue';
import Avatar from '@/components/ui/Avatar.vue';
import MessageSourceBadge from '@/components/chat/MessageSourceBadge.vue';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{
  message: Message;
  isSelf: boolean;
  isGroup: boolean;
  reply?: Message['reply'];
  reactions?: { emoji: string; count: number; reacted: boolean }[];
  /** Avatar URL của người gửi (lookup từ Contact theo senderUid).
   *  Cho user thread: dùng conversation.contact.avatarUrl.
   *  Cho group: chờ backend expose per-sender avatar; tạm null fallback initials. */
  senderAvatarUrl?: string | null;
  /** Tin OUTGOING cuối cùng — chỉ tin này hiện receipt chip (Zalo native UX,
   *  chốt 2026-05-22). Tin cuối seen ⇒ ngầm hiểu mọi tin trên cũng seen. */
  isLastSelf?: boolean;
  /** Luồng Mục Tiêu M11: message liền trước cho group consecutive logic badge */
  prevMessage?: Message | null;
  /** M55 2026-05-30 — viewer userId để phân biệt "tin mình gửi" vs "tin sale khác cùng chăm gửi" */
  currentUserId?: string | null;
}>();

const emit = defineEmits<{
  contextmenu: [event: MouseEvent];
  'preview-image': [url: string];
  'preview-video': [url: string];
  'toggle-reaction': [emoji: string];
  'sender-click': [];
  callback: [message: Message];
  'open-profile': [uid: string];
  'open-reaction-detail': [payload: { reactions: any[]; message: Message }];
  'jump-to-reply': [msgId: string];
  // Luồng Mục Tiêu M11 source badge events
  'open-sequence': [sequenceId: string];
  'explain-native': [];
  'audit-ai': [];
}>();

// 2026-06-11 — ảnh tin nhắn 404 (link Zalo hết hạn) → hiện placeholder thay ô vỡ.
const imgFailed = ref(false);

// M55 2026-05-30 — Sender attribution: hiện tên sale khác cùng chăm nếu tin
// self do user khác (collaborator) gửi qua CRM. Skip nếu tin do mình gửi.
const otherSaleSenderName = computed<string | null>(() => {
  if (!props.isSelf) return null;
  const m = props.message as { repliedByUserId?: string | null; repliedBy?: { fullName?: string | null; email?: string | null } | null };
  const senderUid = m.repliedByUserId;
  if (!senderUid) return null;
  if (props.currentUserId && senderUid === props.currentUserId) return null;
  const name = m.repliedBy?.fullName || m.repliedBy?.email;
  return name || null;
});

const SPECIAL_TYPES = new Set([
  'bank_transfer', 'call', 'qr_code', 'reminder', 'poll', 'note', 'forwarded', 'rich', 'location', 'link',
]);

function isSpecialType(contentType: string | null | undefined): boolean {
  return !!contentType && SPECIAL_TYPES.has(contentType);
}

function parseContent(content: string | null): unknown {
  if (!content) return null;
  try { return JSON.parse(content); } catch { return content; }
}

/**
 * P5 2026-05-21: contact_card polymorphic theo action. Map sang type cụ thể để
 * special-message-renderer render UI khác nhau:
 *   show.profile      → 'contact_card_profile' (danh thiếp thật, avatar + name + phone + Mở chat)
 *   recommened.user   → 'user_suggest'         (gợi ý kết bạn — chip Gợi ý + Xem thông tin)
 *   recommened.link   → 'link'                 (share link có preview)
 *   khác (incl recall)→ giữ nguyên contentType (rich fallback)
 */
function resolveSpecialType(msg: Message): string {
  if (msg.contentType !== 'contact_card') return msg.contentType;
  try {
    const p = safeParse(msg.content);
    const action = String(p?.action || '').toLowerCase();
    if (action === 'show.profile') return 'contact_card_profile';
    if (action === 'recommened.user' || action === 'recommended.user') return 'user_suggest';
    if (action === 'recommened.link' || action === 'recommended.link') return 'link';
  } catch { /* fallthrough */ }
  return 'contact_card';
}

// E21/E22 — mở Zalo user info dialog cho UID trong card. Parent (MessageThread) handle.
function onOpenProfile(uid: string) {
  emit('open-profile', uid);
}

function getImageUrl(msg: Message): string | null {
  // Skip link preview / QR / sticker / reminder / call — không render thumb như chat-image,
  // chúng có renderer riêng (link-preview-card, qr-card, special-message-renderer, ...)
  if (msg.contentType && ['link', 'qr_code', 'sticker', 'reminder', 'call', 'contact_card'].includes(msg.contentType)) {
    return null;
  }
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try {
      const p = JSON.parse(msg.content);
      return p.hdUrl || p.href || p.normalUrl || p.thumbUrl || p.thumb || null;
    } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.hdUrl || p.href || p.normalUrl || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      // Zalo CDN host — usually image even without ext
      if (href && (href.includes('zdn.vn') || href.includes('zaloapp.com') || href.includes('zalocontent.com'))) {
        const fileExt = (typeof p.params === 'string' ? safeParse(p.params) : p.params)?.fileExt;
        if (!fileExt || /^(jpg|jpeg|png|webp|gif)$/i.test(fileExt)) return href;
      }
    } catch {}
  }
  return null;
}

function safeParse(s: unknown): Record<string, unknown> | null {
  if (typeof s !== 'string') return null;
  try { return JSON.parse(s); } catch { return null; }
}

function getVideoUrl(msg: Message): string | null {
  if (msg.contentType !== 'video' || !msg.content) return null;
  if (msg.content.startsWith('http')) return msg.content;
  if (!msg.content.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    return p.href || p.fileUrl || p.normalUrl || null;
  } catch { return null; }
}

function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  const fmtSize = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 0 ? `${Math.round(b / 1024)} KB` : '';
  try {
    const p = JSON.parse(msg.content);
    const mime = typeof p.mime === 'string' ? p.mime : '';
    const isImgVid = mime.startsWith('image/') || mime.startsWith('video/');
    // 2026-06-13 (anh báo tải file gửi đi không ra): NỚI điều kiện — tin contentType='file' HOẶC
    // có {href,name} mà KHÔNG phải ảnh/video → render file-card + nút tải. KHÔNG bắt buộc mime
    // (file cũ persist mime="" trước fix → trước đây rơi về text '🔗 url', không có nút tải).
    if (p.href && p.name && (msg.contentType === 'file' || (!isImgVid && !p.thumb))) {
      return { name: p.name, size: fmtSize(typeof p.size === 'number' ? p.size : 0), href: p.href };
    }
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size: fmtSize(bytes), href: p.href || '' };
    }
  } catch {}
  return null;
}

function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (!content.startsWith('{')) return content;
  try {
    const p = JSON.parse(content);
    if (p.title && p.href) return `${p.title}\n🔗 ${p.href}`;
    if (p.title) return p.title;
    if (p.text) return p.text;
    if (p.description) return p.description;
    if (p.href) return `🔗 ${p.href}`;
    return content;
  } catch { return content; }
}

// HTML-safe formatter for text content: escape + @mention highlight + linebreaks
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Apply mentions theo pos+len từ Zalo SDK (Anh chốt 2026-06-03 Lớp 2).
 * Pos là vị trí byte (UTF-8) trong raw text; len là độ dài full mention bao
 * gồm cả ký tự @ + tên đầy đủ (vd "@Trung Trường - Hs Holding" = len 27).
 *
 * Algorithm:
 *  1. Sort mentions theo pos tăng dần để xử lý từ đầu chuỗi.
 *  2. Cắt text thành các segment: [plain trước mention][mention][plain sau].
 *  3. Escape HTML từng segment riêng (KHÔNG escape cả chuỗi rồi cắt vì
 *     escape làm dài chuỗi → pos shift sai).
 *
 * Lưu ý UTF-8: Zalo dùng byte position, Js string là UTF-16. Với tin tiếng
 * Việt + emoji có thể lệch. Thử dùng string.substring trước, nếu sai shift
 * sẽ fix lần sau bằng TextEncoder/Decoder.
 */
function applyMentionsFormat(
  raw: string,
  mentions: Array<{ uid: string; pos: number; len: number; type: 0 | 1 }>,
): string {
  if (!mentions || mentions.length === 0) return highlightTextRegex(raw);
  const sorted = [...mentions].sort((a, b) => a.pos - b.pos);
  let out = '';
  let cursor = 0;
  for (const m of sorted) {
    if (m.pos < cursor) continue; // overlap → skip
    // Plain text trước mention
    if (m.pos > cursor) {
      out += escapeHtml(raw.substring(cursor, m.pos));
    }
    // Mention chunk
    const chunk = raw.substring(m.pos, m.pos + m.len);
    out += `<span class="mention" data-uid="${m.uid}">${escapeHtml(chunk)}</span>`;
    cursor = m.pos + m.len;
  }
  // Plain text còn lại
  if (cursor < raw.length) {
    out += escapeHtml(raw.substring(cursor));
  }
  // Auto-link + linebreak (vẫn áp dụng cho mọi segment)
  out = out.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="link">$1</a>');
  out = out.replace(/\r?\n/g, '<br>');
  return out;
}

/**
 * Fallback regex cho tin CŨ chưa có mentions JSONB (trước migration
 * 20260603074923_add_message_mentions). Pattern hỗ trợ separator " - ".
 */
function highlightTextRegex(raw: string): string {
  if (!raw) return '';
  let s = escapeHtml(raw);
  s = s.replace(
    /@(\p{Lu}[\p{L}0-9._]*(?:\s\p{Lu}[\p{L}0-9._]*){0,2}(?:\s[-–—]\s\p{Lu}[\p{L}0-9._]*(?:\s\p{Lu}[\p{L}0-9._]*){0,2})?)/gu,
    '<span class="mention">@$1</span>',
  );
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="link">$1</a>');
  s = s.replace(/\r?\n/g, '<br>');
  return s;
}

function highlightText(raw: string): string {
  return highlightTextRegex(raw);
}

/**
 * Anh chốt 2026-06-03: click vào mention span → load info user (giống avatar click).
 * Event delegation: bắt click trên div container, check target có class .mention + data-uid.
 * Stop propagation để không trigger sender-click của bubble cha.
 */
function onMentionClick(ev: MouseEvent): void {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  // Walk up tới element gần nhất có class .mention (vì <strong>/<em> bên trong có thể là target)
  const mentionEl = target.closest('.mention') as HTMLElement | null;
  if (!mentionEl) return;
  const uid = mentionEl.dataset.uid;
  if (!uid) return;
  ev.stopPropagation();
  // Emit open-profile (event handler ZaloUserInfoDialog đã có sẵn ở MessageThread.vue)
  emit('open-profile', uid);
}

const formattedText = computed(() => {
  const raw = parseDisplayContent(props.message.content);
  // Anh chốt 2026-06-03: ưu tiên mentions từ Zalo SDK (pos+len chính xác
  // 100%). Tin cũ trước migration không có mentions → fallback regex.
  const msgMentions = (props.message as any).mentions;
  if (Array.isArray(msgMentions) && msgMentions.length > 0) {
    return applyMentionsFormat(raw, msgMentions);
  }
  return highlightText(raw);
});

/**
 * Wave 1+2 (2026-05-21) — Read-receipt state cho tin OUTGOING (isSelf=true).
 *   seen      — KH đã mở conversation đọc tin (2 tick xanh primary)
 *   delivered — Zalo confirm device KH nhận packet, chưa đọc (1 tick xám)
 *   sending   — chưa có deliveredAt VÀ tin > 3s tuổi (clock outline)
 *   sent      — < 3s (vừa gửi, chưa có confirm) — hiện không icon (giảm noise)
 */
const receiptState = computed<'sending' | 'delivered' | 'seen' | 'sent'>(() => {
  const m = props.message;
  if (m.seenAt) return 'seen';
  if (m.deliveredAt) return 'delivered';
  const ageMs = Date.now() - new Date(m.sentAt).getTime();
  return ageMs > 3000 ? 'sending' : 'sent';
});

const receiptTooltip = computed<string>(() => {
  const m = props.message;
  switch (receiptState.value) {
    case 'seen':      return `KH đã xem${m.seenAt ? ' lúc ' + formatTime(m.seenAt) : ''}`;
    case 'delivered': return `Đã gửi tới KH${m.deliveredAt ? ' lúc ' + formatTime(m.deliveredAt) : ''}`;
    case 'sending':   return 'Đang gửi...';
    default:          return '';
  }
});

const receiptLabel = computed<string>(() => {
  const m = props.message;
  switch (receiptState.value) {
    case 'seen':      return m.seenAt ? `Đã xem ${formatTime(m.seenAt)}` : 'Đã xem';
    case 'delivered': return 'Đã nhận';
    case 'sending':   return 'Đang gửi';
    default:          return '';
  }
});

/**
 * Caption text khi message vừa có media (image/video/sticker/gif/file) vừa có text.
 * Zalo gửi message kèm caption thường lưu trong content.title hoặc content.description.
 * Đặc biệt: bỏ qua nếu title trông giống URL/filename/path (vd ".jpg", "/photos/...").
 */
const messageCaption = computed<string>(() => {
  const ct = props.message.contentType;
  if (!['image', 'video', 'sticker', 'gif', 'file'].includes(ct)) return '';
  const p = safeParse(props.message.content);
  if (!p) return '';
  const candidates = [p.title, p.caption, p.description, p.text];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (!t) continue;
    // Loại bỏ URL
    if (/^https?:\/\//i.test(t)) continue;
    // Loại bỏ filename pattern (kết thúc .jpg/.png/.mp4...)
    if (/\.(jpe?g|png|webp|gif|mp4|mov|avi|mkv|webm|pdf|doc|docx|xls|xlsx|zip|rar)$/i.test(t)) continue;
    // Loại bỏ path bắt đầu bằng /
    if (t.startsWith('/')) continue;
    return t;
  }
  return '';
});

const formattedCaption = computed(() => highlightText(messageCaption.value));

// ── Sticker — fetch metadata + CSS sprite animation cho animated stickers ──
interface StickerMeta {
  type: number;
  staticUrl: string;
  spriteUrl: string | null;
  totalFrames: number;
  duration: number; // ms per frame
  size: number;
}
const stickerMeta = ref<StickerMeta | null>(null);

async function fetchStickerMeta(catId: string | number, id: string | number) {
  try {
    const res = await fetch(`/api/v1/zalo-sticker/${catId}/${id}`);
    if (!res.ok) return;
    stickerMeta.value = (await res.json()) as StickerMeta;
  } catch (err) {
    console.error('[sticker] fetch meta error:', err);
  }
}

// Fallback URL — img render ngay từ proxy endpoint với ?img=1 → redirect Zalo CDN
// (Trong khi metadata async fetch chưa xong, hoặc nếu fetch fail. Tránh "🎴 Sticker" text)
const stickerFallbackUrl = computed<string>(() => {
  if (props.message.contentType !== 'sticker' || !props.message.content) return '';
  const p = safeParse(props.message.content);
  if (!p || typeof p !== 'object') return '';
  const id = (p as Record<string, unknown>).id;
  const catId = (p as Record<string, unknown>).catId;
  if (!id || !catId) return '';
  return `/api/v1/zalo-sticker/${catId}/${id}?img=1`;
});

watch(() => props.message.content, (content) => {
  if (props.message.contentType !== 'sticker' || !content) return;
  stickerMeta.value = null; // reset khi message thay đổi (list reuse component)
  const p = safeParse(content);
  if (!p || typeof p !== 'object') return;
  const id = (p as Record<string, unknown>).id;
  const catId = (p as Record<string, unknown>).catId;
  if (id && catId) void fetchStickerMeta(String(catId), String(id));
}, { immediate: true });

const gifUrl = computed(() => extractMediaUrl('gif', props.message.content));
const voiceUrl = computed(() => extractMediaUrl('voice', props.message.content));

const videoThumb = computed(() => {
  const p = safeParse(props.message.content);
  if (!p) return null;
  const thumb = (p.thumbUrl as string) || (p.thumb as string) || (p.thumbnail as string);
  if (typeof thumb !== 'string' || !thumb.startsWith('http')) return null;
  if (/\.(mp4|mov|webm|mkv)(\?|#|$)/i.test(thumb)) return null;
  return thumb;
});
const videoTitle = computed(() => {
  const p = safeParse(props.message.content);
  return (p?.title as string) || '';
});
const videoDuration = computed(() => {
  const p = safeParse(props.message.content);
  const ms = (p?.duration as number) || 0;
  if (!ms) return '';
  const total = ms > 1000 ? Math.floor(ms / 1000) : ms;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
});
const videoSize = computed(() => {
  const p = safeParse(props.message.content);
  const params = typeof p?.params === 'string' ? safeParse(p.params) : (p?.params as Record<string, unknown> | undefined);
  const bytes = parseInt(params?.fileSize as string || '0');
  if (!bytes) return '';
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
});

function extractMediaUrl(_kind: string, content: string | null): string | null {
  if (!content) return null;
  if (content.startsWith('http')) return content;
  const p = safeParse(content);
  if (!p) return null;
  const url = (p.hdUrl as string) || (p.href as string) || (p.url as string) || (p.normalUrl as string) || '';
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

// E08 — anh chốt 2026-05-21: video play TRONG popup modal, KHÔNG mở tab mới.
// Emit 'preview-video' với URL — parent (MessageThread) mở modal `<video controls autoplay>`.
function openVideo() {
  const p = safeParse(props.message.content);
  const url = (p?.href as string) || (p?.hdUrl as string) || (p?.normalUrl as string);
  if (typeof url === 'string' && url.startsWith('http')) {
    emit('preview-video', url);
  }
}

function isReminderMessage(msg: Message): boolean {
  if (!msg.content) return false;
  try {
    const p = JSON.parse(msg.content);
    // Loại 1: notice "msginfo.actionlist" — system message thông báo tạo reminder
    if (p.action === 'msginfo.actionlist') return true;
    // Loại 2: reminder card (stored as contact_card, action show.profile, params.actions contains create_reminder*)
    if (p.action === 'show.profile') {
      const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
      const actions = Array.isArray(params?.actions) ? params.actions : [];
      const hasReminderAction = actions.some((a: { data?: string }) => typeof a.data === 'string' && a.data.includes('create_reminder'));
      if (hasReminderAction) return true;
      // Fallback: title bắt đầu bằng ⏰
      if (typeof p.title === 'string' && p.title.trim().startsWith('⏰')) return true;
    }
    return false;
  } catch { return false; }
}

// ── Call message detection (Zalo lưu dưới content_type contact_card với action recommened.*) ─
const isCallMessage = computed(() => {
  const p = safeParse(props.message.content);
  if (!p) return false;
  const action = typeof p.action === 'string' ? p.action : '';
  return action.includes('calltime') || action.includes('misscall');
});

const callContent = computed(() => {
  const p = safeParse(props.message.content);
  if (!p) return {};
  const params = typeof p.params === 'string' ? safeParse(p.params) : (p.params as Record<string, unknown> || {});
  const action = typeof p.action === 'string' ? p.action : '';
  return {
    action,
    isMissed: action.includes('misscall'),
    isCaller: params?.isCaller === 1, // 1 = self gọi đi, 0 = nhận
    callType: params?.calltype === 1 ? 'video' : 'voice',
    callDuration: typeof params?.duration === 'number' ? params.duration : 0,
  };
});

// ── Reply preview helpers ───────────────────────────────────────────────────
const replySenderLabel = computed(() => {
  const r = props.reply;
  if (!r) return '';
  return r.senderName ? r.senderName : '';
});

const replyPreviewText = computed(() => {
  const r = props.reply;
  if (!r) return '';
  const text = (r.content || '').trim();
  if (text) return text.length > 80 ? text.slice(0, 80) + '…' : text;
  // Fallback theo msgType (zalo msgType khi text rỗng — image/sticker/voice...)
  const t = (r.msgType || '').toLowerCase();
  if (t.includes('image') || t.includes('photo')) return '📷 Hình ảnh';
  if (t.includes('voice') || t.includes('audio')) return '🎤 Tin nhắn thoại';
  if (t.includes('video'))   return '🎥 Video';
  if (t.includes('sticker')) return '🎴 Sticker';
  if (t.includes('gif'))     return '🎞 GIF';
  if (t.includes('file'))    return '📎 Tệp đính kèm';
  if (t.includes('link') || t.includes('url')) return '🔗 Liên kết';
  if (t.includes('location')) return '📍 Vị trí';
  return '(tin nhắn)';
});

function getReminderTitle(msg: Message): string {
  try {
    const p = JSON.parse(msg.content!);
    const title = String(p.title || '');
    // Bỏ leading ⏰/emoji cho reminder card variant ("⏰ Okkk" → "Okkk")
    return title.replace(/^[⏰🔔📅]\s*/u, '').trim() || msg.content || '';
  } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    // 1. highLightsV2 (notice variant) — có ts ms
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) return `${weekdayInOrgTz(h.ts, undefined, 'long')}, ${formatInOrgTz(h.ts)}`;
    }
    // 2. Reminder card variant — description có sẵn time string ("Thứ Ba, 12 tháng 5 lúc 09:55")
    const desc = String(p.description || '').trim();
    if (desc) return desc;
  } catch {}
  return null;
}

function formatTime(d: string): string {
  return formatInOrgTz(d, undefined, { timeOnly: true });
}

function onPickerReact(key: string) {
  emit('toggle-reaction', key);
}

// 2026-06-13 (anh báo tải file mất tên): kho lưu media/{hash}.ext nên mở thẳng URL → tải về
// tên-hash. Tải QUA cổng CRM /media/download (cùng origin, gắn Content-Disposition tên thật) →
// trình duyệt giữ đúng tên. Dùng axios api (kèm auth) → blob → <a download="tên thật">.
// 2026-06-13 (anh báo 1 file tải ra tên hash + Chrome hỏi popup): lỗi cổng tải lúc đó là
// TIMEOUT tạm thời → trước đây fallback window.open(href) = tải tên-hash (sai). Giờ: RETRY 1
// lần (timeout 60s cho file lớn), nếu vẫn lỗi thì BÁO toast (KHÔNG window.open để tránh tên-hash).
const downloadingFiles = new Set<string>();
async function openFile(href: string, name?: string) {
  if (downloadingFiles.has(href)) return; // chống double-click → tránh Chrome hỏi popup "tải nhiều"
  downloadingFiles.add(href);
  const { api } = await import('@/api/index');
  const fetchBlob = () => api.get('/media/download', {
    params: { url: href, name: name || '' },
    responseType: 'blob',
    timeout: 60000, // file lớn (vài MB) + MinIO cold → nới timeout, tránh fallback tên-hash
  });
  try {
    let res;
    try { res = await fetchBlob(); }
    catch { res = await fetchBlob(); } // retry 1 lần (lỗi mạng/timeout tạm thời)
    const blobUrl = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name || 'tep';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  } catch (e) {
    console.error('[openFile] tải qua cổng lỗi sau retry:', e);
    try { useToast().warning('Tải tệp lỗi tạm thời, thử lại sau ít giây.'); } catch { /* */ }
  } finally {
    downloadingFiles.delete(href);
  }
}
</script>

<style scoped>
/* 2026-06-11 — placeholder ảnh tin nhắn không tải được (Zalo hết hạn link). */
.chat-image-failed {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  width: 180px; height: 120px; border-radius: 10px;
  background: #f1f5f9; color: #94a3b8;
  font-size: 11.5px; border: 1px dashed #cbd5e1;
}
/* Phase A UI fix (2026-05-21):
   - align-items: flex-start → avatar luôn nằm TOP-LEFT của bubble (cả user msg + group msg)
   - Bỏ msg-avatar margin-bottom hack (cũ: align với bottom + offset sender name)
   - Có margin-bottom 18px ở bubble-wrapper để chừa chỗ cho reaction overlap (50% trong/ngoài) */
.msg-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 5px;
}
.msg-row.self {
  flex-direction: row-reverse;
}
.msg-avatar {
  flex-shrink: 0;
}
.msg-avatar-clickable { cursor: pointer; transition: transform 0.1s ease; }
.msg-avatar-clickable:hover { transform: scale(1.06); }
.bubble-wrapper {
  max-width: 65%;
  position: relative;
  /* Chừa chỗ cho reaction-display overlap (12px = 50% chiều cao chip 24px) */
  margin-bottom: 12px;
}
/* bubble-anchor: positioning context cho reaction-display absolute.
   Wrap bubble + reaction để bottom: tính từ BUBBLE bottom, không phải wrapper
   bottom (wrapper extend khi có receipt-chip-row dưới). */
.bubble-anchor {
  position: relative;
  display: block;
}
/* Sender name giờ nằm TRONG bubble — style như header thay vì label ngoài. */
.sender-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--smax-primary, #2962ff);
  margin-bottom: 4px;
  line-height: 1.2;
}
.sender-name-clickable { cursor: pointer; }
.sender-name-clickable:hover { text-decoration: underline; }

/* M55 2026-05-30 — Other sale sender tag trên bubble self khi sale cùng chăm gửi */
.other-sale-tag {
  font-size: 10px;
  font-weight: 600;
  color: #7c2d12;
  background: rgba(254, 215, 170, 0.6);
  border-radius: 6px;
  padding: 1px 6px;
  margin-bottom: 4px;
  display: inline-block;
  cursor: help;
  border: 1px solid rgba(251, 146, 60, 0.4);
}

.message-bubble {
  padding: 8px 13px;
  border-radius: 15px;
  font-size: 14px;
  line-height: 1.45;
  word-wrap: break-word;
  word-break: break-word;
  position: relative;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
}
/* INBOUND bubble — GIỮ NGUYÊN trắng như cũ (Anh chốt lại 2026-06-03:
   chỉ nền tím PHẦN TÊN người gửi, không nhuộm cả bubble) */
.message-bubble.is-other {
  background: var(--smax-bg, #ffffff);
  color: var(--smax-text, #212121);
  border-radius: 4px 15px 15px 15px;
  border: 1px solid var(--smax-grey-200, #ebedf0);
}
.message-bubble.is-self {
  background: var(--smax-bubble-self, #d7ecf7);
  color: var(--smax-text, #212121);
  border-radius: 15px 15px 4px 15px;
}

/* INBOUND sender name row (Anh chốt 2026-06-03 - 3 case):
   Pill tím pastel BAO QUANH TÊN người gửi để phân biệt với OUTBOUND.
   Bubble nội dung giữ TRẮNG nguyên — chỉ tên ở trên có nền tím. */
.message-bubble.is-other .sender-name {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  margin-bottom: 4px;
  cursor: pointer;
  background: #ede9fe; /* violet-100 pastel — nền chỉ ÔM tên */
  border: 1px solid rgba(196, 181, 253, 0.55);
  border-radius: 10px;
  padding: 2px 8px;
  line-height: 1.4;
}
.message-bubble.is-other .sender-name-primary {
  color: #5b21b6; /* violet-700, contrast 7.6:1 AAA với bg pastel */
  font-size: 12px;
  font-weight: 600;
}
.message-bubble.is-other .sender-name:hover .sender-name-primary {
  text-decoration: underline;
}
/* CASE A khi có crmName: "Chị Lan · Lan Nguyen" — tên Zalo phụ nhỏ hơn */
.message-bubble.is-other .sender-zalo-secondary {
  color: #6d28d9; /* violet-700 nhạt, contrast 6.1:1 (skeptic FIX 3) */
  font-size: 11px;
  font-weight: 400;
  margin-left: 3px;
}
/* CASE B chip "Sale: {owner}" — solid violet để chip rõ ràng (skeptic FIX 1) */
.message-bubble.is-other .sender-internal-chip {
  display: inline-flex;
  align-items: center;
  background: #5b21b6; /* solid violet */
  color: #ffffff;       /* trắng trên violet đậm = 9:1 AAA */
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 8px;
  margin-left: 5px;
  line-height: 1.45;
  letter-spacing: 0.02em;
}
.message-bubble.is-other .sender-name.is-internal {
  background: #f5f3ff; /* nhạt hơn 1 cấp khi có chip Sale đặc */
}
.message-bubble.is-other .sender-name.is-internal .sender-name-primary {
  color: #4c1d95; /* violet-800 sẫm hơn để sender chính nổi với chip phụ */
}

.bubble-time {
  font-size: 11px;
  color: var(--smax-grey-700, #5a6478);
  margin-top: 3px;
  padding: 0 2px;
}
.bubble-time.text-end { text-align: right; }
/* Badge "đã sửa" — italic xám nhạt, hover xem nội dung gốc qua title attr */
.edited-badge {
  font-style: italic;
  color: var(--smax-grey-500, #9ca3af);
  margin-left: 2px;
  cursor: help;
}

/* Read-receipt chip (Wave 1+2, anh chốt 2026-05-22 Zalo native UX):
   Chip nhỏ NẰM DƯỚI bubble cuối cùng outgoing — không chèn timestamp.
   Right-aligned, pill bo tròn, icon + text label.
   Color tier modern soft: sending xám nhạt / delivered xám trung / seen xanh.
   .has-reaction-above: reaction-display absolute overlap → chip cần margin lớn
   để clear reaction height (~24px) thay vì 4px như default. */
.receipt-chip-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  padding: 0 2px;
}
.receipt-chip-row.has-reaction-above {
  margin-top: 24px;
}
.receipt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.1px;
  cursor: help;
  user-select: none;
  background: rgba(120, 130, 145, 0.10);
  color: rgba(75, 85, 105, 0.85);
  transition: background 0.18s ease, color 0.18s ease;
}
.receipt-chip.sending {
  background: rgba(120, 130, 145, 0.08);
  color: rgba(100, 110, 125, 0.7);
}
.receipt-chip.delivered {
  background: rgba(120, 130, 145, 0.10);
  color: rgba(75, 85, 105, 0.85);
}
.receipt-chip.seen {
  background: rgba(37, 99, 235, 0.10);
  color: #2563eb;
}
.receipt-chip svg { display: block; flex-shrink: 0; }
.receipt-label { line-height: 1.2; }

.reminder-card {
  padding: 8px 12px;
  border-left: 3px solid var(--smax-warning, #ff9100);
  border-radius: 7px;
  background: rgba(255, 145, 0, 0.08);
}
.reply-card {
  padding: 6px 10px;
  border-radius: 7px;
  background: rgba(33, 150, 243, 0.08);
  border-left: 3px solid var(--smax-primary, #2962ff);
  margin-bottom: 6px;
  transition: background-color 0.15s ease;
}
.reply-card.reply-clickable { cursor: pointer; }
.reply-card.reply-clickable:hover { background: rgba(33, 150, 243, 0.16); }
.reply-header {
  display: flex; align-items: center; gap: 4px;
  font-size: 10.5px;
  color: var(--smax-primary, #2962ff);
  font-weight: 600;
  margin-bottom: 2px;
}
.reply-icon { opacity: 0.85; }
.reply-sender { letter-spacing: 0.2px; }
.reply-text {
  font-size: 12.5px;
  color: var(--smax-text, #212121);
  opacity: 0.78;
  line-height: 1.35;
  word-break: break-word;
}
.file-card {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 7px;
  background: rgba(33, 150, 243, 0.06);
  border: 1px solid var(--smax-grey-200, #ebedf0);
}
.chat-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.2s;
  display: block;
}
.chat-image:hover {
  transform: scale(1.02);
}

/* Text content with @mention + links */
.text-content {
  word-break: break-word;
  white-space: pre-wrap; /* fallback nếu \n không được replace bằng <br> */
}

/* Caption text below media (image/video/sticker/gif/file + text) */
.media-caption {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--smax-text, #212121);
  word-break: break-word;
  white-space: pre-wrap;
}
:deep(.mention) {
  color: var(--smax-primary, #2962ff);
  font-weight: 500;
  background: var(--smax-primary-soft, #e3f2fd);
  padding: 0 4px;
  border-radius: 3px;
  transition: background 0.15s ease;
}
/* Anh chốt 2026-06-03: cursor pointer + hover CHỈ áp cho mention CÓ data-uid
   (tin mới có metadata từ SDK). Tin cũ regex fallback KHÔNG có data-uid →
   không click được → không show cursor pointer (tránh user click hụt). */
:deep(.mention[data-uid]) {
  cursor: pointer;
}
:deep(.mention[data-uid]:hover) {
  background: var(--smax-primary, #2962ff);
  color: white;
}
:deep(.link) {
  color: var(--smax-primary, #2962ff);
  text-decoration: underline;
}

/* Sticker */
.sticker-msg { display: inline-block; }
.sticker-img {
  max-width: 120px;
  max-height: 120px;
  display: block;
}
/* Animated sticker via CSS sprite — duration * totalFrames per loop */
.sticker-anim {
  display: block;
  background-repeat: no-repeat;
  background-position: 0 0;
}
@keyframes sticker-play {
  from { background-position: 0 0; }
  /* Translate sprite từ trái sang phải. steps(N) trong animation property
     sẽ chia thành N stops → mỗi frame nhảy 1 bước. */
  to { background-position: -100% 0; }
}

/* GIF */
.gif-msg { display: inline-block; }
.gif-img {
  max-width: 200px;
  max-height: 200px;
  border-radius: 10px;
  display: block;
}

/* Video */
.video-msg { display: block; }
.video-thumb-wrap {
  position: relative;
  display: inline-block;
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  max-width: 300px;
}
.video-thumb {
  display: block;
  max-width: 100%;
  max-height: 280px;
  object-fit: cover;
}
.video-play-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.18);
  transition: background 0.15s;
}
.video-thumb-wrap:hover .video-play-overlay { background: rgba(0, 0, 0, 0.32); }
.video-duration {
  position: absolute;
  bottom: 6px; right: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: white;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
}
.video-card {
  display: flex; align-items: center;
  padding: 8px 12px;
  border-radius: 7px;
  background: rgba(33, 150, 243, 0.06);
  border: 1px solid var(--smax-grey-200, #ebedf0);
  cursor: pointer;
}

/* Voice */
.voice-msg {
  display: inline-flex; align-items: center;
  padding: 6px 10px;
  background: var(--smax-grey-100, #f5f6fa);
  border-radius: 7px;
  font-size: 13px;
  color: var(--smax-text);
}
.voice-link {
  color: var(--smax-primary, #2962ff);
  text-decoration: none;
  font-weight: 500;
}
.voice-link:hover { text-decoration: underline; }

.voice-msg-v2 {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: var(--smax-grey-100, #f5f6fa);
  border-radius: 9px;
  max-width: 280px;
}
.voice-mic-icon { color: var(--smax-primary, #2962ff); flex-shrink: 0; }
.voice-audio { height: 32px; flex: 1; min-width: 0; }
.voice-fallback { font-size: 12px; color: var(--smax-grey-700); font-style: italic; }

.recall-card {
  /* 2026-06-20 (anh báo dồn sau tên): block riêng dòng + hug content + tách khỏi tên người gửi. */
  display: block;
  width: fit-content;
  margin-top: 3px;
  padding: 6px 10px;
  background: rgba(107, 114, 128, 0.06);
  border-radius: 7px;
  border-left: 2px solid var(--smax-grey-500, #9e9e9e);
  opacity: 0.85;
  max-width: 100%;
}
.recall-header {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px;
  color: var(--smax-grey-700, #5a6478);
  font-weight: 600;
}
.recall-icon { font-size: 14px; }
.recall-label { font-style: normal; }
.recall-body {
  text-decoration: line-through;
  color: var(--smax-grey-700, #5a6478);
  font-size: 13px;
  font-style: italic;
  margin-top: 2px;
  word-break: break-word;
}

.bubble-wrapper .reaction-trigger {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 0.15s;
}
.bubble-wrapper:hover .reaction-trigger {
  opacity: 1;
}
.reaction-trigger--left {
  left: -28px;
}
.reaction-trigger--right {
  right: -28px;
}

/* Phase A UI fix v4 (2026-05-22) — Zalo native reaction box.
   Anh chốt: 1 box duy nhất chứa icons sát nhau + tổng count cuối.
   self → align RIGHT bubble, other → align LEFT bubble.
   Overlap ~6px dưới mép bubble (anh feedback 2026-05-22: cho sát box hơn).
   Click box → MessageThread mở popup detail. */
.bubble-anchor > .bubble-reaction-overlap {
  position: absolute;
  bottom: -10px;
  margin: 0;
  z-index: 2;
  /* FIX 2026-05-22: BỎ max-width — bubble nhỏ (vd tin "1") + 4 icons + total
     "4" sẽ bị clip mất số count. Để box grow theo content, anchor right/left
     edge tại bubble → grows về phía trong message area, vẫn fit trong
     .messages overflow-x:hidden (chỉ extreme far ngoài thread mới bị cắt). */
  width: max-content;
}
/* Tin self (gửi đi, bubble bên phải): anchor phải bubble, content grows leftward */
.bubble-anchor > .bubble-reaction-overlap.reaction-align-right {
  right: 8px;
  left: auto;
}
/* Tin received (gửi đến, bubble bên trái): anchor trái bubble, content grows rightward */
.bubble-anchor > .bubble-reaction-overlap.reaction-align-left {
  left: 8px;
  right: auto;
}
</style>
