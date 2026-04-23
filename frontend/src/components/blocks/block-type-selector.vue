<template>
  <div class="d-flex flex-wrap ga-4 pa-4">
    <v-card
      v-for="t in BLOCK_TYPES"
      :key="t.value"
      :class="['block-type-card', { selected: modelValue === t.value }]"
      width="140"
      rounded="lg"
      variant="outlined"
      :color="modelValue === t.value ? 'primary' : undefined"
      hover
      @click="$emit('update:modelValue', t.value)"
    >
      <v-card-text class="d-flex flex-column align-center justify-center pa-4" style="gap: 8px;">
        <v-icon :icon="t.icon" size="36" :color="modelValue === t.value ? 'primary' : 'grey'" />
        <span class="text-body-2 font-weight-medium text-center">{{ t.label }}</span>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import type { BlockType } from '@/api/blocks-api';

defineProps<{ modelValue: BlockType | null }>();
defineEmits<{ 'update:modelValue': [value: BlockType] }>();

const BLOCK_TYPES: { value: BlockType; label: string; icon: string }[] = [
  { value: 'text', label: 'Văn bản', icon: 'mdi-text-box-outline' },
  { value: 'html', label: 'HTML', icon: 'mdi-language-html5' },
  { value: 'image', label: 'Hình ảnh', icon: 'mdi-image-outline' },
  { value: 'video', label: 'Video', icon: 'mdi-video-outline' },
  { value: 'file', label: 'Tệp đính kèm', icon: 'mdi-file-outline' },
  { value: 'link', label: 'Liên kết', icon: 'mdi-link-variant' },
  { value: 'card', label: 'Card', icon: 'mdi-card-text-outline' },
];
</script>

<style scoped>
.block-type-card { cursor: pointer; transition: border-color 0.2s, transform 0.15s; }
.block-type-card:hover { transform: translateY(-2px); }
.block-type-card.selected { border-width: 2px; }
</style>
