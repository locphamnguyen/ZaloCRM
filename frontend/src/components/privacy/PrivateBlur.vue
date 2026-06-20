<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  PrivateBlur — wrapper hiển thị nội dung bị làm mờ vì Privacy mode.

  Anh chốt 2026-05-22:
    - Blur 75% (filter blur 8px + opacity 0.7) — không phải ô vuông đen
    - Click → emit unlock-request (mở PIN dialog)
    - Cho 2 mode: inline (preview cột 2) và bubble (message cột 3, full opacity overlay)

  Usage:
    <PrivateBlur :redacted="msg.redacted" mode="bubble">{{ msg.content }}</PrivateBlur>
    <PrivateBlur :redacted="conv.redacted" mode="inline">{{ conv.lastMessageContent }}</PrivateBlur>

  Behavior:
    - redacted=false → pass-through render slot
    - redacted=true → render placeholder text (Lorem-like) blurred + icon 🔒
      Slot content KHÔNG render (server đã redact, content thực sự không có)
-->
<template>
  <span v-if="!redacted" class="pb-passthrough"><slot /></span>
  <!-- Inline mode (cột 2 preview) — visual only, KHÔNG bắt click để row click bubble bình thường -->
  <span
    v-else-if="mode === 'inline'"
    class="private-blur mode-inline"
    :title="lockTitle"
    aria-hidden="true"
  >
    <span class="blur-content">{{ placeholder }}</span>
    <span class="lock-ico-inline">🔒</span>
  </span>
  <!-- Bubble mode — click bắt event, emit unlock-request -->
  <span
    v-else
    class="private-blur mode-bubble"
    role="button"
    tabindex="0"
    :title="lockTitle"
    @click.stop="$emit('unlock-request')"
    @keyup.enter="$emit('unlock-request')"
  >
    <span class="blur-content" aria-hidden="true">{{ placeholder }}</span>
    <span class="lock-badge"><span class="lock-ico">🔒</span> Riêng tư</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    redacted?: boolean;
    /** 'inline' = preview cột 2 ngắn / 'bubble' = full message bubble cột 3 */
    mode?: 'inline' | 'bubble';
    /** Override placeholder text — mặc định auto generate */
    placeholderOverride?: string;
  }>(),
  { mode: 'inline' },
);

defineEmits<{ 'unlock-request': [] }>();

// Generate fake text để blur lên — trông như tin nhắn thực sự (không phải ô vuông)
const PLACEHOLDER_INLINE = 'Nội dung tin nhắn riêng tư được bảo vệ';
const PLACEHOLDER_BUBBLE = 'Đây là nội dung riêng tư được bảo vệ bởi chủ nick. Bạn cần mã PIN của chính chủ để mở khoá xem được tin nhắn này.';

const placeholder = computed(() => {
  if (props.placeholderOverride) return props.placeholderOverride;
  return props.mode === 'bubble' ? PLACEHOLDER_BUBBLE : PLACEHOLDER_INLINE;
});

const lockTitle = computed(() => 'Nội dung riêng tư — chỉ chính chủ unlock được');
</script>

<style scoped>
.pb-passthrough { display: contents; }

.private-blur {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  position: relative;
  vertical-align: middle;
}

.blur-content {
  /* 75% blur intensity — text mờ đến mức không đọc được nhưng giữ shape tin nhắn */
  filter: blur(8px) saturate(0.4);
  opacity: 0.7;
  color: #4B5563;
  letter-spacing: 0.5px;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  /* Animation shimmer nhẹ để báo "đang bảo vệ" */
  background: linear-gradient(
    90deg,
    rgba(229, 231, 235, 0.4) 0%,
    rgba(209, 213, 219, 0.4) 50%,
    rgba(229, 231, 235, 0.4) 100%
  );
  background-size: 200% 100%;
  animation: blur-shimmer 3s ease-in-out infinite;
  border-radius: 4px;
  padding: 0 4px;
}

@keyframes blur-shimmer {
  0%, 100% { background-position: 0% 0%; }
  50% { background-position: -200% 0%; }
}

/* Inline mode (cột 2 preview, contact PII list etc) */
.mode-inline {
  display: inline-flex;
  max-width: 100%;
}
.mode-inline .blur-content {
  font-size: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lock-ico-inline {
  font-size: 0.85em;
  opacity: 0.6;
  flex-shrink: 0;
}

/* Bubble mode (cột 3 full message bubble) */
.mode-bubble {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 0;
}
.mode-bubble .blur-content {
  white-space: normal;
  line-height: 1.5;
  font-size: 13px;
  max-width: 360px;
  filter: blur(10px) saturate(0.3);
  padding: 8px 12px;
}
.lock-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #7A2000;
  background: #FBE6DC;
  padding: 3px 10px;
  border-radius: 9999px;
  border: 1px solid rgba(170, 45, 0, 0.2);
}
.lock-ico { font-size: 12px; }

/* Hover state */
.private-blur:hover .blur-content {
  filter: blur(6px) saturate(0.5);
  opacity: 0.85;
}
.mode-bubble:hover .blur-content {
  filter: blur(8px) saturate(0.4);
}

.private-blur:focus {
  outline: 2px solid #5E6AD2;
  outline-offset: 2px;
  border-radius: 6px;
}
</style>
