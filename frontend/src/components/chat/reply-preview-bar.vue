<template>
  <div
    v-if="message"
    class="reply-preview-bar d-flex align-center pa-2 px-3"
    :class="mode === 'edit' ? 'bar--edit' : 'bar--reply'"
  >
    <v-icon size="16" class="mr-2" :color="mode === 'edit' ? 'warning' : 'cyan'">
      {{ mode === 'edit' ? 'mdi-pencil-outline' : 'mdi-reply-outline' }}
    </v-icon>

    <div class="flex-grow-1 text-truncate text-body-2">
      <template v-if="mode === 'reply'">
        <span class="font-weight-medium">{{ message.senderName || 'Ẩn danh' }}:&nbsp;</span>
        <span class="text-grey-darken-1">{{ truncate(message.content) }}</span>
      </template>
      <template v-else>
        <span class="font-weight-medium">Chỉnh sửa tin nhắn</span>
        <span v-if="message.content" class="text-grey-darken-1 ml-1">— {{ truncate(message.content) }}</span>
      </template>
    </div>

    <v-btn icon size="x-small" variant="text" @click="emit('cancel')">
      <v-icon size="16">mdi-close</v-icon>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  message: { senderName: string | null; content: string | null } | null;
  mode: 'reply' | 'edit';
}>();

const emit = defineEmits<{
  cancel: [];
}>();

function truncate(text: string | null, max = 50): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}
</script>

<style scoped>
.reply-preview-bar {
  border-radius: 8px 8px 0 0;
  background: rgba(255, 255, 255, 0.04);
}
.bar--reply {
  border-left: 3px solid #00F2FF;
}
.bar--edit {
  border-left: 3px solid #FF9800;
}
</style>
