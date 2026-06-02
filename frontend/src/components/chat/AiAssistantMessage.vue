<template>
  <!-- M53 2026-05-30: AI Trợ Lý bubble + suggestion card -->
  <div class="ai-msg-row">
    <div class="ai-avatar">🤖</div>
    <div class="ai-body">
      <div class="ai-bubble">
        <div class="ai-label">
          <span class="ai-label-text">Trợ lý AI</span>
          <span class="ai-label-time">{{ formatTime(message.sentAt) }}</span>
        </div>
        <!-- M55.4 2026-05-30: render markdown bold/italic/code/br qua v-html (escape XSS trước) -->
        <div class="ai-content" v-html="formattedContent" />
      </div>

      <!-- Suggestion card hiện dưới bubble nếu có entities -->
      <AiSuggestionCard
        v-if="extractedEntities"
        :entities="extractedEntities"
        :contact-id="contactId"
        :message-id="message.id"
        :existing-contact="existingContact"
        @applied="emit('suggestion-applied', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '@/composables/use-chat';
import AiSuggestionCard from '@/components/chat/AiSuggestionCard.vue';

const props = defineProps<{
  message: Message;
  contactId: string;
  existingContact?: Record<string, unknown> | null;
}>();

const emit = defineEmits<{
  'suggestion-applied': [acceptedFields: Array<{ field: string; value: unknown }>];
}>();

const extractedEntities = computed(() => {
  const meta = (props.message as { metadata?: { extracted?: Record<string, unknown> } | null }).metadata;
  return meta?.extracted ?? null;
});

// M55.4 2026-05-30: parse mini markdown (bold, italic, code, line-break) cho AI message.
// Escape HTML trước để chống XSS. Regex 4 dòng đủ cho AI generate (không cần marked lib).
const formattedContent = computed(() => {
  const raw = props.message.content || '';
  // 1. Escape HTML
  let html = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  // 2. Quote markdown (> text) — render thành blockquote (cho note snippet trong dup-alert)
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  // 3. **bold**
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  // 4. *italic* (single star, không đụng **)
  html = html.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  // 5. `code`
  html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  // 6. Line break (sau khi blockquote done, để \n trong blockquote không thành <br><br>)
  html = html.replace(/\n/g, '<br>');
  return html;
});

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
  } catch {
    return '';
  }
}
</script>

<style scoped>
.ai-msg-row {
  display: flex;
  gap: 8px;
  max-width: 75%;
  margin-bottom: 8px;
  align-self: flex-start;
}
.ai-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #818cf8, #6366f1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.ai-body { flex: 1; min-width: 0; }
.ai-bubble {
  background: #eff6ff;
  border-left: 3px solid #3b82f6;
  border-radius: 12px;
  border-bottom-left-radius: 4px;
  padding: 10px 14px;
  /* M55.4 2026-05-30: tăng 13→14px đồng nhất MessageBubble (.bubble = 14px) */
  font-size: 14px;
  color: #1e3a8a;
}
.ai-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.ai-label-text {
  font-size: 10px;
  color: #6366f1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.ai-label-time {
  font-size: 10px;
  color: #94a3b8;
}
.ai-content {
  /* M55.4: KHÔNG dùng pre-wrap nữa vì \n đã render thành <br> qua v-html.
     Giữ break-word + line-height cho readability. */
  word-break: break-word;
  line-height: 1.55;
}
/* M55.4 2026-05-30: style markdown elements render qua v-html.
   :deep() vì <style scoped> không apply cho HTML inject động. */
.ai-content :deep(strong) {
  font-weight: 700;
  color: #1e3a8a;
}
.ai-content :deep(em) {
  font-style: italic;
  color: #4338ca;
}
.ai-content :deep(code) {
  background: rgba(99, 102, 241, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.9em;
  color: #312e81;
}
.ai-content :deep(blockquote) {
  margin: 6px 0;
  padding: 6px 10px;
  border-left: 3px solid #c7d2fe;
  background: rgba(199, 210, 254, 0.2);
  color: #3730a3;
  font-style: italic;
  border-radius: 4px;
}
</style>
