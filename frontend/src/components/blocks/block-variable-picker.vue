<template>
  <div>
    <div class="text-caption text-grey mb-2">Chèn biến:</div>
    <div class="d-flex flex-wrap ga-1">
      <v-chip
        v-for="v in allVariables"
        :key="v.token"
        size="small"
        variant="tonal"
        color="primary"
        clickable
        @click="$emit('insert', v.token)"
      >
        {{ v.token }}
      </v-chip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useCustomAttrsStore } from '@/stores/custom-attrs';

defineEmits<{ insert: [token: string] }>();

const attrsStore = useCustomAttrsStore();

onMounted(() => attrsStore.fetch());

const BUILTIN = [
  { token: '{crm_name}' },
  { token: '{phone}' },
  { token: '{email}' },
  { token: '{date}' },
  { token: '{pipeline_status}' },
];

const allVariables = computed(() => [
  ...BUILTIN,
  ...attrsStore.defs.map((d) => ({ token: `{${d.key}}` })),
]);
</script>
