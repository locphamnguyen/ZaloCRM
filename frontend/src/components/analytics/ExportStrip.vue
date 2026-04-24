<template>
  <div class="d-flex justify-end mb-2">
    <v-btn
      size="small"
      variant="tonal"
      prepend-icon="mdi-download"
      :loading="exportLoading === type"
      @click="emit('export', type)"
    >
      Xuất CSV
    </v-btn>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  type: string;
  exportLoading: string | null;
}>();

const emit = defineEmits<{ (e: 'export', type: string): void }>();
</script>
