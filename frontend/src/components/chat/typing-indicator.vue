<template>
  <div v-if="typers.length > 0" class="typing-indicator d-flex align-center pa-1 px-3">
    <span class="text-caption text-grey-darken-1">{{ label }}</span>
    <span class="dots ml-1">
      <span class="dot" />
      <span class="dot" />
      <span class="dot" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  typers: { userId: string; userName: string }[];
}>();

const label = computed(() => {
  const t = props.typers;
  if (t.length === 1) return `${t[0].userName} đang nhập`;
  if (t.length === 2) return `${t[0].userName} và ${t[1].userName} đang nhập`;
  const extra = t.length - 2;
  return `${t[0].userName}, ${t[1].userName} +${extra} người khác đang nhập`;
});
</script>

<style scoped>
.typing-indicator {
  min-height: 24px;
}
.dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
  animation: bounce 1.2s infinite ease-in-out;
}
.dot:nth-child(1) { animation-delay: 0s; }
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%            { transform: translateY(-5px); opacity: 1; }
}
</style>
