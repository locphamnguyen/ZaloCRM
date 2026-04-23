<template>
  <v-dialog :model-value="modelValue" max-width="500" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="text-body-1 pa-4">
        {{ isEdit ? 'Chỉnh sửa thuộc tính' : 'Tạo thuộc tính mới' }}
      </v-card-title>
      <v-card-text class="pa-4 pt-0">
        <v-text-field
          v-model="form.key"
          label="Khóa (key) *"
          variant="outlined"
          density="compact"
          class="mb-3"
          :disabled="isEdit"
          :rules="[v => /^[a-z][a-z0-9_]*$/.test(v) || 'Chỉ chữ thường, số và dấu _; bắt đầu bằng chữ']"
          hint="VD: lead_score, budget_range"
          persistent-hint
        />
        <v-text-field
          v-model="form.label"
          label="Nhãn hiển thị *"
          variant="outlined"
          density="compact"
          class="mb-3"
        />
        <v-select
          v-model="form.dataType"
          label="Kiểu dữ liệu *"
          :items="DATA_TYPES"
          item-title="label"
          item-value="value"
          variant="outlined"
          density="compact"
          class="mb-3"
          :disabled="isEdit"
        />
        <v-combobox
          v-if="form.dataType === 'enum'"
          v-model="form.enumValues"
          label="Các giá trị (nhấn Enter để thêm)"
          variant="outlined"
          density="compact"
          class="mb-3"
          multiple
          chips
          closable-chips
          hide-details
        />
        <v-switch
          v-model="form.required"
          label="Bắt buộc nhập"
          color="primary"
          hide-details
        />
      </v-card-text>
      <v-card-actions class="pa-4 pt-0">
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="!isValid" @click="submit">Lưu</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { AttrDef, AttrDataType } from '@/api/custom-attrs-api';

const props = defineProps<{
  modelValue: boolean;
  editDef?: AttrDef | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [v: boolean];
  saved: [];
}>();

const DATA_TYPES = [
  { value: 'string', label: 'Văn bản' },
  { value: 'number', label: 'Số' },
  { value: 'date', label: 'Ngày' },
  { value: 'boolean', label: 'Đúng/Sai' },
  { value: 'enum', label: 'Danh sách chọn' },
];

const isEdit = computed(() => !!props.editDef);
const saving = ref(false);

const form = ref({
  key: '',
  label: '',
  dataType: 'string' as AttrDataType,
  enumValues: [] as string[],
  required: false,
});

watch(() => props.modelValue, (open) => {
  if (open) {
    if (props.editDef) {
      form.value = {
        key: props.editDef.key,
        label: props.editDef.label,
        dataType: props.editDef.dataType,
        enumValues: props.editDef.enumValues ?? [],
        required: props.editDef.required,
      };
    } else {
      form.value = { key: '', label: '', dataType: 'string', enumValues: [], required: false };
    }
  }
});

const isValid = computed(() =>
  form.value.label.trim() &&
  (isEdit.value || (/^[a-z][a-z0-9_]*$/.test(form.value.key) && form.value.dataType)) &&
  (form.value.dataType !== 'enum' || form.value.enumValues.length > 0),
);

import { useCustomAttrsStore } from '@/stores/custom-attrs';
const store = useCustomAttrsStore();

async function submit() {
  if (!isValid.value) return;
  saving.value = true;
  try {
    if (isEdit.value && props.editDef) {
      await store.update(props.editDef.id, {
        label: form.value.label,
        enumValues: form.value.dataType === 'enum' ? form.value.enumValues : null,
        required: form.value.required,
      });
    } else {
      await store.create({
        key: form.value.key,
        label: form.value.label,
        dataType: form.value.dataType,
        enumValues: form.value.dataType === 'enum' ? form.value.enumValues : null,
        required: form.value.required,
      });
    }
    emit('update:modelValue', false);
    emit('saved');
  } finally {
    saving.value = false;
  }
}
</script>
