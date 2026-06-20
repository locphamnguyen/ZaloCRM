<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-menu
    v-model="open"
    open-on-hover
    :open-delay="100"
    :close-delay="220"
    :close-on-content-click="false"
    location="top"
    transition="scale-transition"
  >
    <template #activator="{ props: act }">
      <button class="reaction-trigger-btn" v-bind="act" :title="title || 'Thả cảm xúc'">
        <v-icon size="16">mdi-emoticon-outline</v-icon>
      </button>
    </template>

    <div class="reaction-picker-card">
      <button
        v-for="r in REACTIONS"
        :key="r.key"
        class="emoji-btn"
        :title="r.label"
        @click="onSelect(r.key)"
      >
        {{ r.emoji }}
      </button>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ title?: string }>();
const emit = defineEmits<{ react: [reactionKey: string] }>();

const open = ref(false);

const REACTIONS = [
  { key: 'heart', emoji: '❤️', label: 'Thích' },
  { key: 'like',  emoji: '👍', label: 'Đồng ý' },
  { key: 'haha',  emoji: '😆', label: 'Vui' },
  { key: 'wow',   emoji: '😮', label: 'Bất ngờ' },
  { key: 'sad',   emoji: '😭', label: 'Buồn' },
  { key: 'angry', emoji: '😡', label: 'Tức giận' },
];

function onSelect(key: string) {
  open.value = false;
  emit('react', key);
}
</script>

<style scoped>
.reaction-trigger-btn {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--smax-bg, #fff);
  border: 1px solid var(--smax-grey-200, #ebedf0);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--smax-grey-700, #5a6478);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  transition: all 0.15s;
}
.reaction-trigger-btn:hover {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  border-color: var(--smax-primary, #2962ff);
  transform: scale(1.08);
}

.reaction-picker-card {
  display: inline-flex; gap: 4px;
  background: var(--smax-bg, #fff);
  padding: 6px 9px;
  border-radius: 999px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  border: 1px solid var(--smax-grey-200, #ebedf0);
}
.emoji-btn {
  font-size: 22px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 50%;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: transform 0.12s ease;
  line-height: 1;
}
.emoji-btn:hover {
  transform: scale(1.35);
  background: var(--smax-grey-100, #f5f6fa);
}
</style>
