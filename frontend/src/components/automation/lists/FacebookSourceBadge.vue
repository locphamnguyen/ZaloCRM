<template>
  <v-tooltip location="top">
    <template #activator="{ props: tooltipProps }">
      <span v-bind="tooltipProps" class="fb-source-badge">
        <v-icon size="12" color="#1877F2">mdi-facebook</v-icon>
        <span>{{ totalLeads.toLocaleString('vi-VN') }}</span>
      </span>
    </template>
    <div class="fb-source-tooltip">
      <div><strong>{{ formName }}</strong></div>
      <div v-if="pageName">{{ pageName }}</div>
      <div>Lead: {{ totalLeads.toLocaleString('vi-VN') }}</div>
      <div v-if="lastLeadAt">Mới nhất: {{ formatDate(lastLeadAt) }}</div>
    </div>
  </v-tooltip>
</template>

<script setup lang="ts">
const props = defineProps<{
  formName: string;
  pageName?: string | null;
  lastLeadAt?: string | null;
  totalLeads: number;
}>();

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.fb-source-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid #bfdbfe;
  border-radius: 5px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  vertical-align: middle;
}

.fb-source-tooltip {
  max-width: 240px;
  font-size: 12px;
  line-height: 1.45;
}
</style>
