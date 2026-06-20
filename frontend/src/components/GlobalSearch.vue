<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div style="width: 280px;">
    <v-text-field
      v-model="query"
      placeholder="Tìm kiếm..."
      prepend-inner-icon="mdi-magnify"
      variant="solo-filled"
      density="compact"
      hide-details
      rounded="xl"
      clearable
      @update:model-value="debouncedSearch"
    />
    <v-menu
      v-model="showResults"
      activator="parent"
      :close-on-content-click="true"
      max-width="380"
      offset-y
    >
      <v-card v-if="hasResults" style="max-height: 400px; overflow-y: auto;">
        <!-- Contacts -->
        <template v-if="results.contacts.length">
          <v-list-subheader>Khách hàng</v-list-subheader>
          <v-list-item
            v-for="c in results.contacts"
            :key="c.id"
            @click="goTo('/contacts', c.id)"
            density="compact"
          >
            <template #prepend><v-icon size="18" color="primary">mdi-account</v-icon></template>
            <v-list-item-title>{{ c.fullName || c.phone }}</v-list-item-title>
            <v-list-item-subtitle v-if="c.diseaseName">{{ c.diseaseName }}</v-list-item-subtitle>
          </v-list-item>
        </template>
        <!-- Messages -->
        <template v-if="results.messages.length">
          <v-divider />
          <v-list-subheader>Tin nhắn</v-list-subheader>
          <v-list-item
            v-for="m in results.messages"
            :key="m.id"
            @click="goTo('/chat', m.conversation?.id)"
            density="compact"
          >
            <template #prepend><v-icon size="18" color="info">mdi-chat</v-icon></template>
            <v-list-item-title class="text-truncate" style="max-width: 300px;">
              {{ truncate(m.content, 60) }}
            </v-list-item-title>
            <v-list-item-subtitle>{{ m.senderName }} · {{ formatDate(m.sentAt) }}</v-list-item-subtitle>
          </v-list-item>
        </template>
        <!-- Appointments -->
        <template v-if="results.appointments.length">
          <v-divider />
          <v-list-subheader>Lịch hẹn</v-list-subheader>
          <v-list-item
            v-for="a in results.appointments"
            :key="a.id"
            @click="goTo('/appointments')"
            density="compact"
          >
            <template #prepend><v-icon size="18" color="warning">mdi-calendar</v-icon></template>
            <v-list-item-title>{{ a.contact?.fullName }} · {{ formatDate(a.appointmentDate) }}</v-list-item-title>
            <v-list-item-subtitle>{{ a.notes }}</v-list-item-subtitle>
          </v-list-item>
        </template>
      </v-card>
      <v-card
        v-else-if="query && !loading"
        class="pa-4 text-center text-caption text-grey"
      >
        Không tìm thấy kết quả
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { getOrgParts } from '@/composables/use-org-timezone';

interface ContactResult {
  id: string;
  fullName: string | null;
  phone: string | null;
  diseaseCode: string | null;
  diseaseName: string | null;
}

interface MessageResult {
  id: string;
  content: string | null;
  senderName: string | null;
  sentAt: string;
  conversation?: { id: string; contact?: { fullName: string | null } } | null;
}

interface AppointmentResult {
  id: string;
  appointmentDate: string;
  appointmentTime: string | null;
  notes: string | null;
  contact?: { fullName: string | null } | null;
}

interface SearchResults {
  contacts: ContactResult[];
  messages: MessageResult[];
  appointments: AppointmentResult[];
}

const query = ref('');
const loading = ref(false);
const showResults = ref(false);
const results = ref<SearchResults>({ contacts: [], messages: [], appointments: [] });
const router = useRouter();

const hasResults = computed(
  () => results.value.contacts.length + results.value.messages.length + results.value.appointments.length > 0
);

let timeout: ReturnType<typeof setTimeout>;

function debouncedSearch(val: string | null) {
  clearTimeout(timeout);
  if (!val || val.length < 2) {
    showResults.value = false;
    return;
  }
  timeout = setTimeout(async () => {
    loading.value = true;
    try {
      const res = await api.get('/search', { params: { q: val } });
      results.value = res.data;
      showResults.value = true;
    } catch {
      // silently ignore search errors
    } finally {
      loading.value = false;
    }
  }, 300);
}

function goTo(path: string, _id?: string) {
  showResults.value = false;
  query.value = '';
  router.push(path);
}

function truncate(s: string | null, len: number): string {
  return s && s.length > len ? s.slice(0, len) + '...' : s || '';
}

function formatDate(d: string): string {
  const p = getOrgParts(d);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
}
</script>
