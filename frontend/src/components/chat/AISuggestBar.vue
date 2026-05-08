<template>
  <div v-if="visible" class="ai-suggest-bar">
    <div class="ai-suggest-icon">✨</div>
    <span class="ai-suggest-label">AI gợi ý:</span>
    <div class="ai-suggest-pills">
      <div
        v-for="(s, i) in pills"
        :key="i"
        class="ai-suggest-pill"
        :title="s.text"
        @click="$emit('use', s.text)"
      >
        <span class="ai-action">{{ s.action }}:</span>
        {{ truncated(s.text) }}
      </div>
      <div v-if="loading" class="ai-suggest-pill loading">
        <v-progress-circular indeterminate size="14" width="2" />
        Đang sinh gợi ý…
      </div>
      <div v-if="!pills.length && !loading && error" class="ai-suggest-pill error">
        ⚠ {{ error }}
      </div>
    </div>
    <button class="ai-refresh" :disabled="loading" title="Làm mới gợi ý" @click="$emit('refresh')">↻</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  suggestion: string;
  loading?: boolean;
  error?: string;
}>();
defineEmits<{ use: [text: string]; refresh: [] }>();

interface Pill { action: string; text: string; }
const pills = computed<Pill[]>(() => {
  const text = (props.suggestion || '').trim();
  if (!text) return [];
  // Backend hiện trả 1 chuỗi gợi ý duy nhất → bọc thành 1 pill.
  return [{ action: 'Reply', text }];
});

const visible = computed(() => props.loading || pills.value.length > 0 || !!props.error);

function truncated(text: string) {
  if (text.length <= 90) return `"${text}"`;
  return `"${text.slice(0, 90)}…"`;
}
</script>

<style scoped>
.ai-suggest-bar {
  background: linear-gradient(90deg, rgba(156,39,176,0.06), rgba(33,150,243,0.06));
  border-top: 1px solid var(--smax-grey-200);
  padding: 9px 17px;
  display: flex; align-items: center; gap: 9px;
  flex-shrink: 0;
}
.ai-suggest-icon {
  width: 31px; height: 31px;
  background: linear-gradient(135deg, #9c27b0, #2196f3);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 15px;
  flex-shrink: 0;
}
.ai-suggest-label {
  font-size: 11px; color: var(--smax-grey-700);
  text-transform: uppercase; letter-spacing: 0.4px;
  flex-shrink: 0; font-weight: 600;
}
.ai-suggest-pills {
  display: flex; gap: 7px;
  overflow-x: auto;
  flex: 1;
}
.ai-suggest-pill {
  background: var(--smax-bg);
  border: 1px solid #d1c4e9;
  border-radius: 17px;
  padding: 7px 13px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  color: #311b92;
  flex-shrink: 0;
}
.ai-suggest-pill:hover { background: #ede7f6; border-color: #9c27b0; }
.ai-suggest-pill .ai-action { color: #9c27b0; font-weight: 600; margin-right: 5px; }
.ai-suggest-pill.loading,
.ai-suggest-pill.error { cursor: default; opacity: 0.85; }
.ai-suggest-pill.error { border-color: #ef9a9a; color: #c62828; background: #ffebee; }
.ai-refresh {
  width: 31px; height: 31px;
  border-radius: 50%;
  border: 1px solid var(--smax-grey-300);
  background: var(--smax-bg);
  cursor: pointer; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--smax-grey-700);
  font-size: 14px;
}
.ai-refresh:hover:not(:disabled) { background: var(--smax-grey-50); color: var(--smax-primary); }
.ai-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
