<template>
  <v-dialog :model-value="modelValue" max-width="600" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-history</v-icon>
        Lịch sử gửi tin
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="$emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <div v-if="logsLoading" class="text-center py-4">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <v-alert v-else-if="!logs.length" type="info" variant="tonal" density="compact">
          Chưa có lịch sử gửi tin
        </v-alert>

        <v-timeline v-else density="compact" side="end">
          <v-timeline-item
            v-for="log in logs"
            :key="log.id"
            :dot-color="log.status === 'sent' ? 'success' : 'error'"
            size="small"
          >
            <div class="d-flex align-center flex-wrap gap-2">
              <v-chip size="x-small" :color="log.status === 'sent' ? 'success' : 'error'" variant="tonal">
                Bước {{ log.stepIndex + 1 }}
              </v-chip>
              <span class="text-caption">{{ formatDate(log.sentAt) }}</span>
              <v-chip size="x-small" :color="log.status === 'sent' ? 'success' : 'error'" variant="flat">
                {{ log.status === 'sent' ? 'Đã gửi' : 'Lỗi' }}
              </v-chip>
            </div>
            <div v-if="log.error" class="text-caption text-error mt-1">{{ log.error }}</div>
          </v-timeline-item>
        </v-timeline>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useDripEnrollments } from '@/composables/use-drip-enrollments';

const props = defineProps<{
  modelValue: boolean;
  enrollmentId: string | null;
}>();

defineEmits<{ 'update:modelValue': [value: boolean] }>();

const { logs, logsLoading, fetchLogs } = useDripEnrollments();

watch(
  () => [props.modelValue, props.enrollmentId] as const,
  ([open, id]) => {
    if (open && id) fetchLogs(id);
  },
);

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('vi-VN');
}
</script>
