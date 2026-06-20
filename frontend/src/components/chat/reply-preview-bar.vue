<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div
    v-if="message"
    class="reply-preview-bar"
    :class="mode === 'edit' ? 'bar--edit' : 'bar--reply'"
  >
    <v-icon size="16" class="reply-icon" :color="mode === 'edit' ? 'warning' : 'info'">
      {{ mode === 'edit' ? 'mdi-pencil-outline' : 'mdi-reply' }}
    </v-icon>

    <div class="reply-body">
      <template v-if="mode === 'reply'">
        <div class="reply-sender">{{ message.senderName || 'Ẩn danh' }}</div>
        <div class="reply-content" :title="contentFull">{{ contentPreview }}</div>
      </template>
      <template v-else>
        <div class="reply-sender">Chỉnh sửa tin nhắn</div>
        <div v-if="contentFull" class="reply-content">{{ contentPreview }}</div>
      </template>
    </div>

    <button class="close-btn" :title="mode === 'edit' ? 'Hủy chỉnh sửa' : 'Hủy trả lời'" @click="emit('cancel')">
      <v-icon size="16">mdi-close</v-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  message: { senderName: string | null; content: string | null; msgType?: string | null } | null;
  mode: 'reply' | 'edit';
}>();

const emit = defineEmits<{ cancel: [] }>();

const contentFull = computed(() => {
  const c = props.message?.content;
  if (!c) return '';
  return extractPreview(c, props.message?.msgType);
});

const contentPreview = computed(() => {
  const f = contentFull.value;
  return f.length > 80 ? f.slice(0, 80) + '…' : f;
});

/**
 * Extract human-readable preview từ raw content.
 * Handle cả plain text + JSON rich (title/text/description/href).
 * Fallback theo msgType khi content rỗng (image/video/voice/...).
 */
function extractPreview(content: string, msgType?: string | null): string {
  const trimmed = content.trim();
  if (!trimmed) return mediaFallback(msgType);

  if (trimmed.startsWith('{')) {
    try {
      const p = JSON.parse(trimmed);
      // Rich card với title (Zalo bot rtf, sản phẩm card, link share, ...)
      if (p.title && typeof p.title === 'string' && p.title.trim()) {
        const t = p.title.trim();
        // Lọc tên function internal Zalo (sendBubbleMessage = call)
        if (t === 'sendBubbleMessage') return mediaFallback('call');
        // Lọc filename (đuôi .jpg/.mp4/.pdf...)
        if (!/\.(jpe?g|png|webp|gif|mp4|mov|avi|pdf|docx?|xlsx?|zip|rar)$/i.test(t)) {
          return t.replace(/\n/g, ' · ');
        }
      }
      if (p.text && typeof p.text === 'string') return p.text;
      if (p.description && typeof p.description === 'string' && p.description.trim()) {
        return p.description;
      }
      if (p.href && typeof p.href === 'string') return '🔗 ' + p.href.slice(0, 60);
      // Action-based detection
      if (typeof p.action === 'string') {
        if (p.action.includes('calltime') || p.action.includes('misscall')) return mediaFallback('call');
        if (p.action === 'msginfo.actionlist') return '📅 Nhắc hẹn';
      }
      return mediaFallback(msgType);
    } catch {
      return trimmed.slice(0, 80);
    }
  }

  return trimmed;
}

function mediaFallback(msgType?: string | null): string {
  const t = (msgType || '').toLowerCase();
  if (!t) return '(tin nhắn)';
  if (t.includes('image') || t.includes('photo')) return '📷 Hình ảnh';
  if (t.includes('voice') || t.includes('audio')) return '🎤 Tin nhắn thoại';
  if (t.includes('video')) return '🎥 Video';
  if (t.includes('sticker')) return '🎴 Sticker';
  if (t.includes('gif')) return '🎞 GIF';
  if (t.includes('file') || t.includes('doc')) return '📎 Tệp đính kèm';
  if (t.includes('link')) return '🔗 Liên kết';
  if (t.includes('location')) return '📍 Vị trí';
  if (t.includes('call')) return '📞 Cuộc gọi';
  return '(tin nhắn)';
}
</script>

<style scoped>
.reply-preview-bar {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 11px;
  background: var(--smax-grey-50, #fafbfc);
  border: 1px solid var(--smax-grey-200, #ebedf0);
  border-left-width: 3px;
  border-radius: 7px;
  margin-bottom: 7px;
}
.bar--reply { border-left-color: var(--smax-primary, #2962ff); }
.bar--edit  { border-left-color: var(--smax-warning, #ff9100); }

.reply-icon { flex-shrink: 0; }

.reply-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.reply-sender {
  font-size: 11.5px; font-weight: 600;
  color: var(--smax-primary, #2962ff);
}
.bar--edit .reply-sender { color: var(--smax-warning, #ff9100); }
.reply-content {
  font-size: 12.5px;
  color: var(--smax-grey-700, #5a6478);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  background: transparent; border: none;
  width: 24px; height: 24px;
  border-radius: 50%;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--smax-grey-700, #5a6478);
  flex-shrink: 0;
}
.close-btn:hover { background: var(--smax-grey-100, #f5f6fa); color: var(--smax-error, #ff3d00); }
</style>
