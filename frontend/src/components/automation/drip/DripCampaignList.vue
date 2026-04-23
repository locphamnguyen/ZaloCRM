<template>
  <div>
    <v-data-table
      :headers="headers"
      :items="campaigns"
      :loading="loading"
      no-data-text="Chưa có chiến dịch nào"
    >
      <template #item.enabled="{ item }">
        <v-switch
          :model-value="item.enabled"
          color="primary"
          hide-details
          density="compact"
          :disabled="!canManage"
          @update:model-value="$emit('toggle', item, !!$event)"
        />
      </template>

      <template #item.steps="{ item }">
        <v-chip size="small" variant="tonal">{{ item._count?.steps ?? 0 }} bước</v-chip>
      </template>

      <template #item.enrollments="{ item }">
        <v-chip size="small" color="primary" variant="tonal">
          {{ item._count?.enrollments ?? 0 }}
        </v-chip>
      </template>

      <template #item.window="{ item }">
        <span class="text-caption">{{ item.windowStart }}h – {{ item.windowEnd }}h</span>
      </template>

      <template #item.actions="{ item }">
        <div class="d-flex gap-1">
          <v-btn
            size="small"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-account-plus"
            @click="$emit('enroll', item)"
          >
            Enroll
          </v-btn>
          <template v-if="canManage">
            <v-btn icon size="small" variant="text" @click="$emit('edit', item)">
              <v-icon size="16">mdi-pencil</v-icon>
            </v-btn>
            <v-btn icon size="small" variant="text" color="error" @click="$emit('delete', item.id)">
              <v-icon size="16">mdi-delete</v-icon>
            </v-btn>
          </template>
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import type { DripCampaign } from '@/api/drip-api';

defineProps<{
  campaigns: DripCampaign[];
  loading: boolean;
  canManage: boolean;
}>();

defineEmits<{
  edit: [campaign: DripCampaign];
  delete: [id: string];
  toggle: [campaign: DripCampaign, enabled: boolean];
  enroll: [campaign: DripCampaign];
}>();

const headers = [
  { title: 'Tên chiến dịch', key: 'name' },
  { title: 'Bật', key: 'enabled', sortable: false },
  { title: 'Số bước', key: 'steps', sortable: false },
  { title: 'Đã enroll', key: 'enrollments', sortable: false },
  { title: 'Khung giờ', key: 'window', sortable: false },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];
</script>
