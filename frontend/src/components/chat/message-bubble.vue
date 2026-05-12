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
      <!-- Tên người gửi: hiện cho group + non-self, click → mở Zalo user info -->
      <div
        v-if="isGroup && !isSelf"
        class="sender-name sender-name-clickable"
        @click="emit('sender-click')"
      >
        {{ message.senderName || 'Unknown' }}
      </div>

      <!-- Bubble -->
      <div
        class="message-bubble"
        :class="{ 'is-self': isSelf, 'is-other': !isSelf }"
        @contextmenu.prevent="emit('contextmenu', $event)"
      >
        <!-- Deleted -->
        <div v-if="message.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
          {{ message.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
        </div>

        <template v-else>
          <div v-if="reply" class="reply-card">
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
            <img
              :src="getImageUrl(message)!"
              alt="Hình ảnh"
              class="chat-image"
              @click="emit('preview-image', getImageUrl(message)!)"
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
                @click="openFile(getFileInfo(message)!.href)"
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

          <!-- Voice -->
          <div v-else-if="message.contentType === 'voice'">
            <div class="voice-msg">
              <v-icon size="18">mdi-microphone</v-icon>
              <span class="ml-1">Tin nhắn thoại</span>
              <a v-if="voiceUrl" :href="voiceUrl" target="_blank" class="ml-2 voice-link">▶ Nghe</a>
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
          />

          <!-- Special types -->
          <SpecialMessageRenderer
            v-else-if="isSpecialType(message.contentType)"
            :type="message.contentType"
            :content="parseContent(message.content)"
          />

          <!-- Default text — parse @mention + bullets + linebreaks -->
          <div v-else class="text-content" v-html="formattedText" />

        </template>

        <!-- Timestamp -->
        <div class="bubble-time" :class="{ 'text-end': isSelf }">
          {{ formatTime(message.sentAt) }}
        </div>
      </div>

      <!-- Reaction display -->
      <reaction-display
        v-if="reactions && reactions.length > 0"
        :reactions="reactions"
        :class="isSelf ? 'justify-end' : 'justify-start'"
        @toggle="(emoji) => emit('toggle-reaction', emoji)"
      />

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
import SpecialMessageRenderer from '@/components/chat/special-message-renderer.vue';
import ReactionDisplay from '@/components/chat/reaction-display.vue';
import ReactionPicker from '@/components/chat/reaction-picker.vue';
import Avatar from '@/components/ui/Avatar.vue';

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
}>();

const emit = defineEmits<{
  contextmenu: [event: MouseEvent];
  'preview-image': [url: string];
  'toggle-reaction': [emoji: string];
  'sender-click': [];
}>();

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

function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size, href: p.href || '' };
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

function highlightText(raw: string): string {
  if (!raw) return '';
  let s = escapeHtml(raw);
  // Mention regex: match @ + 1-2 words capitalized only (tên người VN phổ biến).
  // Trước đây {0,2} → 3 words max → bôi lố từ thường vào tên (vd "@Đại Khánh thể").
  // {0,1} → max 2 words. Word phải BẮT ĐẦU BẰNG CHỮ HOA để loại từ thường tiếng Việt.
  s = s.replace(
    /@(\p{Lu}[\p{L}0-9._-]*(?:\s\p{Lu}[\p{L}0-9._-]*){0,1})/gu,
    '<span class="mention">@$1</span>',
  );
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="link">$1</a>');
  s = s.replace(/\r?\n/g, '<br>');
  return s;
}

const formattedText = computed(() => {
  const raw = parseDisplayContent(props.message.content);
  return highlightText(raw);
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
  return typeof thumb === 'string' && thumb.startsWith('http') ? thumb : null;
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

function openVideo() {
  const p = safeParse(props.message.content);
  const url = (p?.href as string) || (p?.hdUrl as string) || (p?.normalUrl as string);
  if (typeof url === 'string' && url.startsWith('http')) {
    window.open(url, '_blank');
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
      if (h.ts > 1e12) return new Date(h.ts).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    // 2. Reminder card variant — description có sẵn time string ("Thứ Ba, 12 tháng 5 lúc 09:55")
    const desc = String(p.description || '').trim();
    if (desc) return desc;
  } catch {}
  return null;
}

function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function onPickerReact(key: string) {
  emit('toggle-reaction', key);
}

function openFile(href: string) {
  window.open(href, '_blank');
}
</script>

<style scoped>
.msg-row {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  margin-bottom: 5px;
}
.msg-row.self {
  flex-direction: row-reverse;
}
.msg-avatar {
  flex-shrink: 0;
  margin-bottom: 16px;  /* align với bubble (offset bởi sender name + time) */
}
.msg-avatar-clickable { cursor: pointer; transition: transform 0.1s ease; }
.msg-avatar-clickable:hover { transform: scale(1.06); }
.bubble-wrapper {
  max-width: 65%;
  position: relative;
}
.sender-name {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--smax-primary, #2962ff);
  margin-bottom: 3px;
  padding: 0 4px;
}
.sender-name-clickable { cursor: pointer; }
.sender-name-clickable:hover { text-decoration: underline; }

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
.message-bubble.is-other {
  background: var(--smax-bg, #ffffff);
  color: var(--smax-text, #212121);
  border-radius: 4px 15px 15px 15px;
  border: 1px solid var(--smax-grey-200, #ebedf0);
}
.message-bubble.is-self {
  background: var(--smax-bubble-self, #d0e6ff);
  color: var(--smax-text, #212121);
  border-radius: 15px 15px 4px 15px;
}

.bubble-time {
  font-size: 11px;
  color: var(--smax-grey-700, #5a6478);
  margin-top: 3px;
  padding: 0 2px;
}
.bubble-time.text-end { text-align: right; }

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
}
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
</style>
