<template>
  <v-dialog :model-value="modelValue" max-width="440" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center gap-2">
        <v-icon color="error" aria-hidden="true">mdi-facebook</v-icon>
        Ngắt kết nối trang Facebook
      </v-card-title>
      <v-card-text>
        <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
          <strong>{{ pageName }}</strong> sẽ bị ngắt kết nối.
        </v-alert>
        <p class="text-body-2 mb-2">
          Sau khi disconnect:
        </p>
        <ul class="text-body-2 pl-4 mb-3">
          <li>Lead mới từ trang này <strong>sẽ không</strong> về ZaloCRM.</li>
          <li v-if="activeMappingCount > 0">
            <strong>{{ activeMappingCount }} form mapping</strong> sẽ bị vô hiệu hóa (lịch sử được giữ lại).
          </li>
          <li>Bạn có thể kết nối lại bất kỳ lúc nào.</li>
        </ul>
        <v-alert v-if="error" type="error" density="compact" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="$emit('update:modelValue', false)">Hủy</v-btn>
        <v-btn color="error" :loading="loading" @click="$emit('confirm')">
          Ngắt kết nối
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  pageName: string;
  activeMappingCount: number;
  loading?: boolean;
  error?: string;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
}>();
</script>
