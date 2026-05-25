<template>
  <div>
    <!-- Loading skeleton -->
    <div v-if="loading" class="d-flex flex-column gap-2 pa-2">
      <v-skeleton-loader v-for="n in 3" :key="n" type="list-item-two-line" />
    </div>

    <!-- Empty state -->
    <div v-else-if="mappings.length === 0" class="text-center pa-4 text-medium-emphasis">
      <v-icon size="32" aria-hidden="true">mdi-form-select</v-icon>
      <p class="mt-1 text-body-2">
        Chưa có form nào — nếu vừa connect FB Page, đợi 10s cho hệ thống đồng bộ rồi reload.
      </p>
    </div>

    <!-- Forms table (read-only) -->
    <v-table v-else density="compact">
      <thead>
        <tr>
          <th>Form</th>
          <th>Tệp liên kết</th>
          <th class="text-right">Số lead</th>
          <th>Lead gần nhất</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="mapping in mappings" :key="mapping.id">
          <!-- Form name + id -->
          <td>
            <div class="font-weight-medium">{{ mapping.formName }}</div>
            <div class="text-caption text-medium-emphasis">ID: {{ mapping.formId }}</div>
            <v-chip
              v-if="!mapping.enabled"
              size="x-small"
              color="error"
              variant="flat"
              class="mt-1"
            >
              Đã tắt
            </v-chip>
          </td>

          <!-- Linked CustomerList -->
          <td>
            <router-link
              v-if="mapping.customerList"
              :to="`/automation/bot/lists/${mapping.customerList.id}`"
              class="list-link"
            >
              <v-icon size="16" color="blue" class="me-1" aria-hidden="true">mdi-facebook</v-icon>
              {{ mapping.customerList.name }}
            </router-link>
            <span v-else class="text-caption text-medium-emphasis">—</span>
          </td>

          <!-- Lead count -->
          <td class="text-right text-body-2">
            {{ mapping.leadCount > 0 ? mapping.leadCount.toLocaleString('vi-VN') : '—' }}
          </td>

          <!-- Last lead relative time -->
          <td class="text-caption text-medium-emphasis">
            {{ mapping.lastLeadAt ? formatRelativeTime(mapping.lastLeadAt) : '—' }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<script setup lang="ts">
import type { FacebookFormMappingDto } from '@/api/facebook-api';

defineProps<{
  mappings: FacebookFormMappingDto[];
  loading?: boolean;
}>();

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} ngày trước`;
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}
</script>

<style scoped>
.list-link {
  display: inline-flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
  font-weight: 500;
}
.list-link:hover {
  text-decoration: underline;
  color: #1565c0;
}
</style>
