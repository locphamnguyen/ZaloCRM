<template>
  <v-card>
    <v-card-text class="d-flex align-center justify-space-between py-3">
      <div>
        <div class="text-body-1 font-weight-medium">Trạng thái trực tuyến</div>
        <div class="text-caption text-medium-emphasis mt-1">
          {{ isOnline ? 'Đang trực tuyến' : 'Ngoại tuyến' }}
        </div>
      </div>
      <v-switch
        v-model="isOnline"
        color="success"
        hide-details
        :disabled="saving"
        :loading="saving"
        @update:model-value="onToggle"
      />
    </v-card-text>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mx-4 mb-3">
      {{ error }}
    </v-alert>
  </v-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  online: boolean;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: 'change', online: boolean): void;
}>();

const isOnline = ref(props.online);
watch(() => props.online, (v) => { isOnline.value = v; });

function onToggle(val: boolean | null) {
  emit('change', !!val);
}
</script>
