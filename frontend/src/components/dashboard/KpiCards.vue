<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-row>
    <v-col v-for="card in cards" :key="card.title" cols="6" sm="4" md="2">
      <v-card variant="outlined">
        <v-card-text class="text-center pa-3">
          <v-icon :icon="card.icon" :color="card.color" size="32" class="mb-1" />
          <div class="text-h5 font-weight-bold">{{ card.value }}</div>
          <div class="text-caption text-grey">{{ card.title }}</div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface KpiData {
  messagesToday: number;
  messagesUnreplied: number;
  messagesUnread: number;
  appointmentsToday: number;
  newContactsThisWeek: number;
  totalContacts: number;
}

const props = defineProps<{
  kpi: KpiData | null;
}>();

const cards = computed(() => [
  { title: 'Tin nhắn hôm nay', value: props.kpi?.messagesToday ?? '—', icon: 'mdi-chat', color: 'primary' },
  { title: 'Chưa trả lời', value: props.kpi?.messagesUnreplied ?? '—', icon: 'mdi-chat-alert', color: 'warning' },
  { title: 'Chưa đọc', value: props.kpi?.messagesUnread ?? '—', icon: 'mdi-email-outline', color: 'orange' },
  { title: 'Lịch hẹn hôm nay', value: props.kpi?.appointmentsToday ?? '—', icon: 'mdi-calendar-today', color: 'success' },
  { title: 'KH mới tuần này', value: props.kpi?.newContactsThisWeek ?? '—', icon: 'mdi-account-plus', color: 'info' },
  { title: 'Tổng khách hàng', value: props.kpi?.totalContacts ?? '—', icon: 'mdi-account-group', color: 'secondary' },
]);
</script>
