<template>
  <v-card rounded="lg" variant="outlined" hover class="block-card">
    <v-card-text class="pa-3">
      <div class="d-flex align-start ga-2">
        <v-icon :icon="typeIcon" size="28" color="primary" class="mt-1 flex-shrink-0" />
        <div class="flex-grow-1 min-width-0">
          <div class="font-weight-medium text-truncate">{{ block.name }}</div>
          <div class="d-flex align-center ga-1 mt-1 flex-wrap">
            <v-chip size="x-small" variant="tonal" color="secondary">{{ typeLabel }}</v-chip>
            <v-chip v-if="block.isShared" size="x-small" variant="tonal" color="success">
              <v-icon start size="10">mdi-share-variant</v-icon>Dùng chung
            </v-chip>
          </div>
          <div class="text-caption text-grey mt-1">{{ formatDate(block.updatedAt) }}</div>
        </div>
      </div>
    </v-card-text>

    <v-card-actions class="pa-2 pt-0">
      <v-btn size="x-small" variant="text" color="primary" prepend-icon="mdi-pencil-outline" @click.stop="$emit('edit', block.id)">
        Sửa
      </v-btn>
      <v-btn size="x-small" variant="text" color="secondary" prepend-icon="mdi-content-copy" @click.stop="$emit('duplicate', block.id)">
        Bản sao
      </v-btn>
      <v-spacer />
      <v-btn size="x-small" variant="text" color="error" icon @click.stop="$emit('delete', block.id)">
        <v-icon size="16">mdi-delete-outline</v-icon>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Block } from '@/api/blocks-api';

const props = defineProps<{ block: Block }>();
defineEmits<{ edit: [id: string]; duplicate: [id: string]; delete: [id: string] }>();

const TYPE_META: Record<string, { icon: string; label: string }> = {
  text: { icon: 'mdi-text-box-outline', label: 'Văn bản' },
  html: { icon: 'mdi-language-html5', label: 'HTML' },
  image: { icon: 'mdi-image-outline', label: 'Hình ảnh' },
  video: { icon: 'mdi-video-outline', label: 'Video' },
  file: { icon: 'mdi-file-outline', label: 'Tệp' },
  link: { icon: 'mdi-link-variant', label: 'Liên kết' },
  card: { icon: 'mdi-card-text-outline', label: 'Card' },
};

const typeIcon = computed(() => TYPE_META[props.block.type]?.icon ?? 'mdi-package-variant');
const typeLabel = computed(() => TYPE_META[props.block.type]?.label ?? props.block.type);

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
</script>

<style scoped>
.block-card { transition: box-shadow 0.15s; }
.min-width-0 { min-width: 0; }
</style>
