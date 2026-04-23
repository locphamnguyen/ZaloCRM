<template>
  <v-card variant="outlined" class="mb-2 pa-2">
    <div class="d-flex align-center gap-2 flex-wrap">
      <v-chip size="small" color="primary" variant="tonal">Bước {{ index + 1 }}</v-chip>

      <v-text-field
        v-model.number="localStep.dayOffset"
        label="Ngày gửi"
        type="number"
        min="0"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 100px;"
        @update:model-value="emitUpdate"
      />

      <v-spacer />

      <v-btn icon size="small" color="error" variant="text" @click="$emit('remove')">
        <v-icon size="16">mdi-delete</v-icon>
      </v-btn>
    </div>

    <div class="mt-2">
      <v-switch
        v-model="useTemplate"
        label="Dùng mẫu tin"
        density="compact"
        hide-details
        color="primary"
        class="mb-2"
        @update:model-value="onModeSwitch"
      />

      <v-select
        v-if="useTemplate"
        v-model="localStep.templateId"
        :items="templates"
        item-title="name"
        item-value="id"
        label="Chọn mẫu tin"
        density="compact"
        variant="outlined"
        clearable
        hide-details
        @update:model-value="emitUpdate"
      />

      <v-textarea
        v-else
        v-model="localStep.content"
        label="Nội dung tin nhắn"
        rows="2"
        auto-grow
        density="compact"
        variant="outlined"
        hide-details
        @update:model-value="emitUpdate"
      />
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { DripStep } from '@/api/drip-api';
import type { MessageTemplate } from '@/composables/use-message-templates';

const props = defineProps<{
  step: DripStep;
  index: number;
  templates: MessageTemplate[];
}>();

const emit = defineEmits<{
  'update:step': [step: DripStep];
  remove: [];
}>();

const useTemplate = ref(!!props.step.templateId);
const localStep = reactive<DripStep>({ ...props.step });

watch(
  () => props.step,
  (s) => {
    Object.assign(localStep, s);
    useTemplate.value = !!s.templateId;
  },
);

function onModeSwitch(val: boolean | null) {
  if (val) {
    localStep.content = null;
  } else {
    localStep.templateId = null;
  }
  emitUpdate();
}

function emitUpdate() {
  emit('update:step', { ...localStep });
}
</script>
