<template>
  <div class="mobile-contacts pa-3">
    <!-- Search bar -->
    <v-text-field
      v-model="filters.search"
      placeholder="Tìm khách hàng..."
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
      density="compact"
      hide-details
      clearable
      rounded="xl"
      class="mb-3"
      @update:model-value="onSearch"
    />

    <!-- Filter chips -->
    <div class="d-flex gap-2 mb-3 overflow-x-auto" style="flex-wrap: nowrap;">
      <v-chip
        v-for="status in STATUS_OPTIONS"
        :key="status.value"
        :color="filters.status === status.value ? statusColor(status.value) : undefined"
        :variant="filters.status === status.value ? 'flat' : 'outlined'"
        size="small"
        @click="toggleStatus(status.value)"
      >
        {{ status.text }}
      </v-chip>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- Contact cards -->
    <div v-else class="d-flex flex-column gap-2">
      <v-card
        v-for="contact in contacts"
        :key="contact.id"
        variant="tonal"
        rounded="xl"
        class="pa-3"
        @click="openContact(contact)"
      >
        <div class="d-flex align-center">
          <v-avatar size="40" color="grey-lighten-2" class="mr-3">
            <v-img v-if="contact.avatarUrl" :src="contact.avatarUrl" />
            <v-icon v-else size="20">mdi-account</v-icon>
          </v-avatar>
          <div style="flex: 1; min-width: 0;">
            <div class="text-body-2 font-weight-medium text-truncate">{{ contact.fullName }}</div>
            <div class="text-caption text-medium-emphasis">{{ contact.phone || 'Chưa có SĐT' }}</div>
          </div>
          <v-chip v-if="contact.status" :color="statusColor(contact.status)" size="x-small" variant="tonal">
            {{ statusLabel(contact.status) }}
          </v-chip>
        </div>
      </v-card>

      <div v-if="contacts.length === 0" class="text-center py-8 text-medium-emphasis">
        Không tìm thấy khách hàng
      </div>
    </div>

    <!-- FAB: add contact -->
    <v-btn
      icon
      color="primary"
      size="large"
      style="position: fixed; bottom: 88px; right: 16px; z-index: 50;"
      @click="openCreate"
    >
      <v-icon>mdi-plus</v-icon>
    </v-btn>

    <!-- Detail dialog -->
    <ContactDetailDialog
      v-model="showDialog"
      :contact="selectedContact"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import { useContacts, STATUS_OPTIONS } from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';

const { contacts, loading, filters, fetchContacts } = useContacts();

const showDialog = ref(false);
const selectedContact = ref<Contact | null>(null);

function statusColor(status: string) {
  const map: Record<string, string> = {
    new: 'grey', contacted: 'blue', interested: 'orange',
    converted: 'success', lost: 'error',
  };
  return map[status] ?? 'grey';
}

function statusLabel(value: string) {
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
}

function toggleStatus(value: string) {
  filters.status = filters.status === value ? '' : value;
  fetchContacts();
}

let searchTimeout: ReturnType<typeof setTimeout>;
function onSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchContacts(), 300);
}

function openContact(contact: Contact) {
  selectedContact.value = contact;
  showDialog.value = true;
}

function openCreate() {
  selectedContact.value = null;
  showDialog.value = true;
}

function onSaved() { fetchContacts(); }
function onDeleted() { fetchContacts(); }

onMounted(() => fetchContacts());
onUnmounted(() => clearTimeout(searchTimeout));
</script>
