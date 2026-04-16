<template>
  <div v-if="reactions.length > 0" class="d-flex flex-wrap ga-1 mt-1">
    <v-chip
      v-for="r in reactions"
      :key="r.emoji"
      size="x-small"
      :variant="r.reacted ? 'tonal' : 'outlined'"
      :color="r.reacted ? 'primary' : undefined"
      class="reaction-chip"
      :class="{ 'reaction-chip--reacted': r.reacted }"
      @click="emit('toggle', r.emoji)"
    >
      {{ r.emoji }}&nbsp;{{ r.count }}
    </v-chip>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  reactions: { emoji: string; count: number; reacted: boolean }[];
}>();

const emit = defineEmits<{
  toggle: [emoji: string];
}>();
</script>

<style scoped>
.reaction-chip {
  cursor: pointer;
  transition: transform 0.12s;
}
.reaction-chip:hover {
  transform: scale(1.1);
}
.reaction-chip--reacted {
  border-width: 1.5px;
}
</style>
