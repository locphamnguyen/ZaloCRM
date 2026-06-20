<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-menu :close-on-content-click="false" location="bottom end">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        variant="outlined"
        prepend-icon="mdi-view-column"
        class="mr-2"
      >
        Cột
        <v-badge
          v-if="hidden > 0"
          :content="hidden"
          color="grey"
          inline
        />
      </v-btn>
    </template>

    <v-card min-width="320">
      <v-card-title class="text-subtitle-2 d-flex align-center">
        Hiển thị cột
        <v-spacer />
        <v-btn
          size="x-small"
          variant="text"
          @click="emit('reset')"
        >
          Mặc định
        </v-btn>
      </v-card-title>
      <v-divider />

      <div class="d-flex" style="max-height: 480px;">
        <div
          v-for="(group, gi) in grouped"
          :key="gi"
          class="flex-grow-1 px-2 py-2 column-group"
        >
          <div class="text-caption text-grey-darken-1 px-2 mb-1">
            {{ group.label }}
          </div>
          <v-list-item
            v-for="col in group.cols"
            :key="col.key"
            density="compact"
            :disabled="col.required"
            @click="toggle(col.key)"
          >
            <template #prepend>
              <v-checkbox-btn
                :model-value="modelValue.includes(col.key)"
                :disabled="col.required"
                density="compact"
                hide-details
              />
            </template>
            <v-list-item-title class="text-body-2">
              {{ col.title }}
              <v-icon v-if="col.required" size="x-small" class="ml-1" color="grey">
                mdi-lock
              </v-icon>
            </v-list-item-title>
          </v-list-item>
        </div>
      </div>

      <v-divider />
      <v-card-actions>
        <v-btn size="small" variant="text" @click="selectNone">Bỏ tất cả</v-btn>
        <v-spacer />
        <v-btn size="small" variant="text" color="primary" @click="selectAll">
          Chọn tất cả
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface ColumnDef {
  key: string;
  title: string;
  /** Always visible — toggle disabled. Used for ID/identifying columns. */
  required?: boolean;
  /** Logical grouping in the toggle UI. */
  group?: 'core' | 'identity' | 'crm' | 'demo' | 'address' | 'zalo' | 'activity';
}

const props = defineProps<{
  modelValue: string[];        // currently visible keys
  columns: ColumnDef[];        // all available columns
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
  reset: [];
}>();

const GROUP_LABELS: Record<NonNullable<ColumnDef['group']>, string> = {
  core: 'Cơ bản',
  identity: 'Định danh',
  crm: 'CRM',
  demo: 'Cá nhân',
  address: 'Địa chỉ',
  zalo: 'Zalo',
  activity: 'Tương tác',
};

const grouped = computed(() => {
  const order: Array<NonNullable<ColumnDef['group']>> = [
    'core', 'identity', 'crm', 'demo', 'address', 'zalo', 'activity',
  ];
  return order
    .map((g) => ({
      label: GROUP_LABELS[g],
      cols: props.columns.filter((c) => (c.group ?? 'core') === g),
    }))
    .filter((g) => g.cols.length > 0);
});

const hidden = computed(() =>
  props.columns.filter((c) => !c.required && !props.modelValue.includes(c.key)).length,
);

function toggle(key: string) {
  const col = props.columns.find((c) => c.key === key);
  if (col?.required) return;
  if (props.modelValue.includes(key)) {
    emit('update:modelValue', props.modelValue.filter((k) => k !== key));
  } else {
    emit('update:modelValue', [...props.modelValue, key]);
  }
}

function selectAll() {
  emit('update:modelValue', props.columns.map((c) => c.key));
}

function selectNone() {
  emit('update:modelValue', props.columns.filter((c) => c.required).map((c) => c.key));
}
</script>

<style scoped>
.column-group {
  min-width: 180px;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.column-group:last-child {
  border-right: none;
}
</style>
