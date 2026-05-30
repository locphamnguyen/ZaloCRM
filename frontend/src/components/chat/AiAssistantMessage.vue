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
        <div class="ai-content">{{ message.content }}</div>
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
  padding: 8px 12px;
  font-size: 13px;
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
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
</style>
