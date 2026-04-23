<template>
  <v-expansion-panels variant="accordion" class="mt-3">
    <v-expansion-panel>
      <v-expansion-panel-title class="text-body-2 font-weight-medium">
        <v-icon class="mr-2" size="18">mdi-tag-multiple-outline</v-icon>
        Thuộc tính tùy chỉnh
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-progress-linear v-if="store.loading" indeterminate color="primary" class="mb-2" />

        <div v-if="store.defs.length === 0 && !store.loading" class="text-caption text-grey py-2">
          Chưa có thuộc tính nào được cấu hình.
        </div>

        <div v-for="def in store.defs" :key="def.id" class="mb-3">
          <!-- string -->
          <v-text-field
            v-if="def.dataType === 'string'"
            :model-value="(localAttrs[def.key] as string) ?? ''"
            :label="def.label"
            variant="outlined"
            density="compact"
            hide-details="auto"
            :error-messages="errors[def.key]"
            @update:model-value="onFieldChange(def.key, $event)"
            @blur="saveField(def.key)"
          />
          <!-- number -->
          <v-text-field
            v-else-if="def.dataType === 'number'"
            :model-value="(localAttrs[def.key] as number) ?? ''"
            :label="def.label"
            variant="outlined"
            density="compact"
            type="number"
            hide-details="auto"
            :error-messages="errors[def.key]"
            @update:model-value="onFieldChange(def.key, Number($event))"
            @blur="saveField(def.key)"
          />
          <!-- date -->
          <v-text-field
            v-else-if="def.dataType === 'date'"
            :model-value="(localAttrs[def.key] as string) ?? ''"
            :label="def.label"
            variant="outlined"
            density="compact"
            type="date"
            hide-details="auto"
            :error-messages="errors[def.key]"
            @update:model-value="onFieldChange(def.key, $event)"
            @blur="saveField(def.key)"
          />
          <!-- boolean -->
          <v-switch
            v-else-if="def.dataType === 'boolean'"
            :model-value="!!(localAttrs[def.key])"
            :label="def.label"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="onFieldChange(def.key, $event); saveField(def.key)"
          />
          <!-- enum -->
          <v-select
            v-else-if="def.dataType === 'enum'"
            :model-value="(localAttrs[def.key] as string) ?? null"
            :label="def.label"
            :items="def.enumValues ?? []"
            variant="outlined"
            density="compact"
            clearable
            hide-details="auto"
            :error-messages="errors[def.key]"
            @update:model-value="onFieldChange(def.key, $event); saveField(def.key)"
          />
        </div>

        <div v-if="saving" class="text-caption text-grey">Đang lưu...</div>
        <div v-if="savedMsg" class="text-caption text-success">Đã lưu!</div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useCustomAttrsStore } from '@/stores/custom-attrs';
import { patchContactCustomAttrs } from '@/api/custom-attrs-api';

const props = defineProps<{
  contactId: string;
  customAttrs?: Record<string, unknown> | null;
}>();

const emit = defineEmits<{ updated: [attrs: Record<string, unknown>] }>();

const store = useCustomAttrsStore();
const localAttrs = ref<Record<string, unknown>>({});
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const savedMsg = ref(false);

// Pending save timers per field key
const timers: Record<string, ReturnType<typeof setTimeout>> = {};

onMounted(() => {
  store.fetch();
  localAttrs.value = { ...(props.customAttrs ?? {}) };
});

watch(() => props.customAttrs, (v) => {
  localAttrs.value = { ...(v ?? {}) };
});

function onFieldChange(key: string, value: unknown) {
  localAttrs.value = { ...localAttrs.value, [key]: value };
  delete errors.value[key];
}

function saveField(key: string) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => persistField(key), 800);
}

async function persistField(key: string) {
  if (!props.contactId) return;
  saving.value = true;
  savedMsg.value = false;
  try {
    const result = await patchContactCustomAttrs(props.contactId, { [key]: localAttrs.value[key] });
    localAttrs.value = { ...localAttrs.value, ...(result.customAttrs as Record<string, unknown>) };
    emit('updated', localAttrs.value);
    savedMsg.value = true;
    setTimeout(() => { savedMsg.value = false; }, 2000);
  } catch (err: unknown) {
    const e = err as { response?: { data?: { errors?: Record<string, string> } } };
    if (e.response?.data?.errors) {
      errors.value = { ...errors.value, ...e.response.data.errors };
    } else {
      errors.value = { ...errors.value, [key]: 'Lưu thất bại' };
    }
  } finally {
    saving.value = false;
  }
}
</script>
