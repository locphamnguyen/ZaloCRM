<template>
  <v-card>
    <v-card-title>Chỉnh sửa thông tin</v-card-title>
    <v-card-text>
      <v-alert
        v-if="localError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        closable
        @click:close="localError = ''"
      >
        {{ localError }}
      </v-alert>

      <v-text-field
        v-model="form.name"
        label="Tên hiển thị"
        :disabled="saving"
        class="mb-2"
      />

      <v-select
        v-model="form.gender"
        :items="genderOptions"
        item-title="label"
        item-value="value"
        label="Giới tính"
        :disabled="saving"
        class="mb-2"
      />

      <v-text-field
        v-model="form.dob"
        label="Ngày sinh (YYYY-MM-DD)"
        placeholder="1990-01-15"
        :rules="[dobRule]"
        :disabled="saving"
        class="mb-2"
      />
    </v-card-text>

    <v-card-actions class="px-4 pb-4">
      <v-spacer />
      <v-btn variant="text" :disabled="saving" @click="emit('cancel')">Hủy</v-btn>
      <v-btn color="primary" :loading="saving" @click="submit">Lưu</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ZaloProfile } from '@/composables/use-profile';

const props = defineProps<{
  profile: ZaloProfile | null;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: 'save', payload: { name?: string; gender?: 0 | 1; dob?: string }): void;
  (e: 'cancel'): void;
}>();

// Mirror parent error prop into local writable ref so it can be cleared inline
const localError = ref(props.error);
watch(() => props.error, (v) => { localError.value = v; });

const genderOptions = [
  { label: 'Nam', value: 0 },
  { label: 'Nữ', value: 1 },
];

const form = ref({
  name: '',
  gender: 0 as 0 | 1,
  dob: '',
});

// Populate form from profile whenever it changes
watch(
  () => props.profile,
  (p) => {
    if (!p) return;
    form.value.name = String(p.displayName ?? p.zaloName ?? p.username ?? '');
    form.value.gender = Number(p.gender) === 1 ? 1 : 0;

    const sdob = String(p.sdob ?? '');
    const dobTs = Number(p.dob ?? 0);
    if (/^\d{4}-\d{2}-\d{2}$/.test(sdob)) {
      form.value.dob = sdob;
    } else if (dobTs && Number.isFinite(dobTs)) {
      const ms = dobTs > 10_000_000_000 ? dobTs : dobTs * 1000;
      form.value.dob = new Date(ms).toISOString().split('T')[0] ?? '';
    }
  },
  { immediate: true },
);

function dobRule(v: string): boolean | string {
  if (!v) return true; // optional
  return /^\d{4}-\d{2}-\d{2}$/.test(v) || 'Định dạng: YYYY-MM-DD';
}

function submit() {
  if (form.value.dob && !/^\d{4}-\d{2}-\d{2}$/.test(form.value.dob)) return;
  emit('save', {
    name: form.value.name || undefined,
    gender: form.value.gender,
    dob: form.value.dob || undefined,
  });
}
</script>
