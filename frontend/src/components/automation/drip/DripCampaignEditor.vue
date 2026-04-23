<template>
  <v-dialog :model-value="modelValue" max-width="720" scrollable @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        {{ isEdit ? 'Chỉnh sửa chiến dịch' : 'Tạo chiến dịch mới' }}
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <v-text-field v-model="form.name" label="Tên chiến dịch *" density="compact" variant="outlined" class="mb-3" hide-details />
        <v-textarea v-model="form.description" label="Mô tả" rows="2" density="compact" variant="outlined" class="mb-3" hide-details />

        <div class="text-subtitle-2 mb-1">Khung giờ gửi tin ({{ form.windowStart }}h – {{ form.windowEnd }}h)</div>
        <div class="d-flex gap-3 mb-3">
          <div class="flex-1">
            <div class="text-caption mb-1">Bắt đầu</div>
            <v-slider v-model="form.windowStart" :min="0" :max="22" :step="1" thumb-label="always" color="primary" hide-details />
          </div>
          <div class="flex-1">
            <div class="text-caption mb-1">Kết thúc</div>
            <v-slider v-model="form.windowEnd" :min="1" :max="23" :step="1" thumb-label="always" color="primary" hide-details />
          </div>
        </div>

        <v-select
          v-model="form.timezone"
          :items="timezoneOptions"
          label="Múi giờ"
          density="compact"
          variant="outlined"
          class="mb-3"
          hide-details
        />

        <v-divider class="mb-3" />
        <div class="text-subtitle-2 mb-2">Điều kiện dừng</div>
        <v-switch v-model="form.stopOnReply" label="Dừng khi khách trả lời" color="primary" density="compact" hide-details class="mb-2" />
        <v-text-field
          v-model.number="form.stopOnInactiveDays"
          label="Dừng sau N ngày không hoạt động (bỏ trống = không áp dụng)"
          type="number"
          min="1"
          density="compact"
          variant="outlined"
          class="mb-3"
          hide-details
          clearable
        />

        <v-divider class="mb-3" />
        <div class="d-flex align-center mb-2">
          <span class="text-subtitle-2">Các bước gửi tin ({{ form.steps.length }})</span>
          <v-spacer />
          <v-btn size="small" color="primary" prepend-icon="mdi-plus" @click="addStep">Thêm bước</v-btn>
        </div>

        <DripStepEditor
          v-for="(step, idx) in form.steps"
          :key="idx"
          :step="step"
          :index="idx"
          :templates="templates"
          @update:step="updateStep(idx, $event)"
          @remove="removeStep(idx)"
        />

        <v-alert v-if="form.steps.length === 0" type="warning" variant="tonal" density="compact">
          Cần ít nhất một bước gửi tin
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="!canSave" @click="handleSave">Lưu</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import DripStepEditor from './DripStepEditor.vue';
import type { DripCampaign, DripStep, CreateCampaignPayload } from '@/api/drip-api';
import type { MessageTemplate } from '@/composables/use-message-templates';

const props = defineProps<{
  modelValue: boolean;
  campaign: DripCampaign | null;
  templates: MessageTemplate[];
  saving: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [payload: CreateCampaignPayload & { id?: string }];
}>();

const timezoneOptions = ['Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'Asia/Singapore', 'UTC'];

const isEdit = computed(() => !!props.campaign?.id);

const defaultForm = (): {
  name: string; description: string; windowStart: number; windowEnd: number;
  timezone: string; stopOnReply: boolean; stopOnInactiveDays: number | null; steps: DripStep[];
} => ({
  name: '',
  description: '',
  windowStart: 8,
  windowEnd: 11,
  timezone: 'Asia/Ho_Chi_Minh',
  stopOnReply: true,
  stopOnInactiveDays: null,
  steps: [],
});

const form = reactive(defaultForm());

watch(
  () => [props.modelValue, props.campaign] as const,
  ([open, c]) => {
    if (!open) return;
    if (c) {
      form.name = c.name;
      form.description = c.description ?? '';
      form.windowStart = c.windowStart;
      form.windowEnd = c.windowEnd;
      form.timezone = c.timezone;
      form.stopOnReply = c.stopOnReply;
      form.stopOnInactiveDays = c.stopOnInactiveDays ?? null;
      form.steps = c.steps ? [...c.steps] : [];
    } else {
      Object.assign(form, defaultForm());
    }
  },
  { immediate: true },
);

const canSave = computed(
  () => form.name.trim() && form.steps.length > 0 && form.windowEnd > form.windowStart,
);

function addStep() {
  form.steps.push({ dayOffset: form.steps.length, templateId: null, content: '' });
}

function updateStep(idx: number, step: DripStep) {
  form.steps[idx] = step;
}

function removeStep(idx: number) {
  form.steps.splice(idx, 1);
}

function handleSave() {
  const payload: CreateCampaignPayload & { id?: string } = {
    name: form.name.trim(),
    description: form.description || null,
    windowStart: form.windowStart,
    windowEnd: form.windowEnd,
    timezone: form.timezone,
    startTrigger: 'manual',
    stopOnReply: form.stopOnReply,
    stopOnInactiveDays: form.stopOnInactiveDays || null,
    steps: form.steps,
  };
  if (props.campaign?.id) payload.id = props.campaign.id;
  emit('save', payload);
}
</script>
