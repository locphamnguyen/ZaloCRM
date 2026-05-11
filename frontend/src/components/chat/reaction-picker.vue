<template>
  <v-menu v-model="open" :close-on-content-click="false" location="top">
    <template #activator="{ props: menuProps }">
      <v-btn icon size="x-small" variant="text" v-bind="menuProps">
        <v-icon size="16">mdi-emoticon-outline</v-icon>
      </v-btn>
    </template>

    <v-card class="pa-2 reaction-picker-card">
      <div class="d-flex ga-1">
        <button
          v-for="r in REACTIONS"
          :key="r.key"
          class="emoji-btn"
          :title="r.key"
          @click="onSelect(r.key)"
        >
          {{ r.emoji }}
        </button>
      </div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  react: [reactionKey: string];
}>();

const open = ref(false);

const REACTIONS = [
  { key: 'heart', emoji: '❤️' },
  { key: 'like',  emoji: '👍' },
  { key: 'haha',  emoji: '😆' },
  { key: 'wow',   emoji: '😮' },
  { key: 'sad',   emoji: '😭' },
  { key: 'angry', emoji: '😡' },
];

function onSelect(key: string) {
  open.value = false;
  emit('react', key);
}
</script>

<style scoped>
.reaction-picker-card {
  border-radius: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.emoji-btn {
  font-size: 22px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s, background 0.15s;
  line-height: 1;
}
.emoji-btn:hover {
  transform: scale(1.3);
  background: rgba(0, 0, 0, 0.06);
}
</style>
