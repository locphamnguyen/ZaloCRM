<template>
  <v-card min-width="200" max-height="280" class="d-flex flex-column">
    <v-text-field
      v-model="search"
      placeholder="Tìm tag..."
      density="compact"
      variant="solo-filled"
      hide-details
      prepend-inner-icon="mdi-magnify"
      class="ma-2"
      autofocus
    />
    <v-list density="compact" class="flex-grow-1 overflow-y-auto pa-0">
      <v-list-item
        v-for="tag in filtered"
        :key="tag.id"
        @click="emit('select', tag)"
      >
        <template #prepend>
          <v-avatar :color="tag.color ?? 'grey'" size="16" class="mr-2">
            <span style="font-size:8px; color:white">●</span>
          </v-avatar>
        </template>
        <v-list-item-title class="text-body-2">{{ tag.name }}</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="filtered.length === 0">
        <v-list-item-title class="text-caption text-grey">Không tìm thấy</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Tag } from '@/stores/tags';

const props = defineProps<{ tags: Tag[]; loading?: boolean }>();
const emit = defineEmits<{ select: [tag: Tag]; close: [] }>();

const search = ref('');
const filtered = computed(() =>
  props.tags.filter((t) => t.name.toLowerCase().includes(search.value.toLowerCase())),
);
</script>
