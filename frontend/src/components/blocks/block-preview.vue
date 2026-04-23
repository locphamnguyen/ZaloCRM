<template>
  <v-card variant="outlined" rounded="lg">
    <v-card-title class="d-flex align-center text-body-1 pa-3">
      <v-icon class="mr-2" size="18">mdi-eye-outline</v-icon>
      Xem trước
      <v-spacer />
      <v-btn size="small" variant="tonal" :loading="loading" @click="loadPreview">Làm mới</v-btn>
    </v-card-title>
    <v-divider />

    <!-- Contact picker -->
    <div class="pa-3">
      <v-autocomplete
        v-model="selectedContactId"
        :items="contacts"
        item-title="label"
        item-value="id"
        label="Dữ liệu khách hàng mẫu"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="mb-3"
        :loading="searchLoading"
        @update:search="onSearch"
        @update:model-value="loadPreview"
      />

      <!-- Rendered preview -->
      <div v-if="loading" class="d-flex justify-center pa-4">
        <v-progress-circular indeterminate size="24" />
      </div>
      <div v-else-if="error" class="text-caption text-error">{{ error }}</div>
      <div v-else-if="rendered" class="preview-content pa-2 rounded" style="background: rgba(0,0,0,0.04);">
        <pre v-if="typeof rendered === 'string'" style="white-space: pre-wrap; font-size: 0.85rem;">{{ rendered }}</pre>
        <div v-else class="text-caption">
          <pre style="white-space: pre-wrap; font-size: 0.85rem;">{{ JSON.stringify(rendered, null, 2) }}</pre>
        </div>
      </div>
      <div v-else class="text-caption text-grey text-center pa-3">Chọn khách hàng để xem trước</div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { previewBlock, api } from '@/api/blocks-api';

const props = defineProps<{ blockId: string }>();

const selectedContactId = ref<string | null>(null);
const contacts = ref<{ id: string; label: string }[]>([]);
const rendered = ref<unknown>(null);
const loading = ref(false);
const searchLoading = ref(false);
const error = ref('');

let searchTimer: ReturnType<typeof setTimeout>;

function onSearch(q: string) {
  clearTimeout(searchTimer);
  if (!q || q.length < 2) return;
  searchTimer = setTimeout(() => fetchContacts(q), 300);
}

async function fetchContacts(q: string) {
  searchLoading.value = true;
  try {
    const res = await api.get<{ contacts: { id: string; fullName: string; phone: string }[] }>('/contacts', { params: { q, limit: 20 } });
    contacts.value = (res.data.contacts || []).map((c) => ({
      id: c.id,
      label: `${c.fullName || ''}${c.phone ? ' · ' + c.phone : ''}`,
    }));
  } catch {
    // non-critical
  } finally {
    searchLoading.value = false;
  }
}

async function loadPreview() {
  if (!props.blockId) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await previewBlock(props.blockId, {
      contactId: selectedContactId.value ?? undefined,
    });
    rendered.value = res.rendered;
  } catch (err) {
    error.value = 'Không thể tải xem trước.';
    console.error('[block-preview] error:', err);
  } finally {
    loading.value = false;
  }
}
</script>
