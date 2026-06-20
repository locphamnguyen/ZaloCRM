<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4">
        <v-icon class="mr-2" style="color: #00F2FF;">mdi-connection</v-icon>
        Tích hợp
      </h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Thêm tích hợp</v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <!-- Integration cards -->
    <v-row>
      <v-col v-for="item in integrations" :key="item.id" cols="12" md="6" lg="4">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon :color="typeColor(item.type)" class="mr-2">{{ typeIcon(item.type) }}</v-icon>
            {{ item.name || typeLabel(item.type) }}
            <v-spacer />
            <v-chip :color="item.enabled ? 'success' : 'default'" size="small" variant="flat">
              {{ item.enabled ? 'Bật' : 'Tắt' }}
            </v-chip>
          </v-card-title>

          <v-card-subtitle>{{ typeLabel(item.type) }}</v-card-subtitle>

          <v-card-text>
            <div class="text-body-2 mb-2">
              Đồng bộ lần cuối: {{ item.lastSyncAt ? formatInOrgTz(item.lastSyncAt) : 'Chưa có' }}
            </div>

            <!-- Recent sync logs -->
            <div v-if="item.syncLogs?.length">
              <div class="text-caption text-medium-emphasis mb-1">Lịch sử gần đây:</div>
              <v-chip
                v-for="log in item.syncLogs.slice(0, 3)"
                :key="log.id"
                :color="log.status === 'success' ? 'success' : log.status === 'partial' ? 'warning' : 'error'"
                size="x-small"
                variant="tonal"
                class="mr-1 mb-1"
              >
                {{ log.status }} ({{ log.recordCount }})
              </v-chip>
            </div>
          </v-card-text>

          <v-card-actions>
            <v-btn size="small" variant="text" prepend-icon="mdi-sync" :loading="syncing === item.id" @click="handleSync(item.id)">
              Đồng bộ
            </v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-pencil" @click="openEdit(item)">Sửa</v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" color="error" prepend-icon="mdi-delete" @click="confirmDelete(item)">Xóa</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-if="!loading && integrations.length === 0" class="text-center pa-8">
      <v-icon size="64" color="grey">mdi-connection</v-icon>
      <div class="text-h6 mt-4">Chưa có tích hợp nào</div>
      <div class="text-body-2 text-medium-emphasis mb-4">Kết nối Google Sheets, Telegram, Facebook hoặc Zapier</div>
      <v-btn color="primary" @click="openCreate">Thêm tích hợp đầu tiên</v-btn>
    </v-card>

    <!-- Create/Edit dialog -->
    <v-dialog v-model="showDialog" max-width="520">
      <v-card>
        <v-card-title>{{ editing ? 'Chỉnh sửa tích hợp' : 'Thêm tích hợp' }}</v-card-title>
        <v-card-text>
          <v-select
            v-model="form.type"
            :items="typeOptions"
            item-title="label"
            item-value="value"
            label="Loại tích hợp *"
            :disabled="editing"
            class="mb-2"
          />
          <v-text-field v-model="form.name" label="Tên hiển thị" class="mb-2" />
          <v-switch v-model="form.enabled" label="Bật" color="success" class="mb-2" />

          <!-- Type-specific config fields -->
          <template v-if="form.type === 'google_sheets'">
            <v-text-field v-model="form.config.spreadsheetId" label="Spreadsheet ID *" class="mb-2" />
            <v-text-field v-model="form.config.apiKey" label="API Key *" :type="showApiKey ? 'text' : 'password'" :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'" @click:append-inner="showApiKey = !showApiKey" class="mb-2" />
            <v-text-field v-model="form.config.sheetName" label="Tên sheet" placeholder="Contacts" />
          </template>

          <template v-if="form.type === 'telegram'">
            <v-text-field v-model="form.config.botToken" label="Bot Token *" :type="showBotToken ? 'text' : 'password'" :append-inner-icon="showBotToken ? 'mdi-eye-off' : 'mdi-eye'" @click:append-inner="showBotToken = !showBotToken" class="mb-2" />
            <v-text-field v-model="form.config.chatId" label="Chat ID *" class="mb-2" />
          </template>

          <template v-if="form.type === 'facebook'">
            <v-text-field v-model="form.config.pageId" label="Page ID *" class="mb-2" />
            <v-text-field v-model="form.config.pageAccessToken" label="Page Access Token *" :type="showPageAccessToken ? 'text' : 'password'" :append-inner-icon="showPageAccessToken ? 'mdi-eye-off' : 'mdi-eye'" @click:append-inner="showPageAccessToken = !showPageAccessToken" />
          </template>

          <template v-if="form.type === 'zapier'">
            <v-text-field v-model="form.config.webhookUrl" label="Webhook URL *" placeholder="https://hooks.zapier.com/..." />
          </template>

          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleSave">{{ editing ? 'Lưu' : 'Tạo' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm -->
    <v-dialog v-model="showDelete" max-width="400">
      <v-card>
        <v-card-title>Xác nhận xóa</v-card-title>
        <v-card-text>Bạn có chắc muốn xóa tích hợp "{{ selectedItem?.name }}"?</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDelete = false">Hủy</v-btn>
          <v-btn color="error" :loading="saving" @click="handleDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import { formatInOrgTz } from '@/composables/use-org-timezone';

interface SyncLog {
  id: string;
  status: string;
  recordCount: number;
  createdAt: string;
}

interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  enabled: boolean;
  lastSyncAt: string | null;
  syncLogs: SyncLog[];
}

const integrations = ref<Integration[]>([]);
const loading = ref(false);
const error = ref('');
const saving = ref(false);
const syncing = ref<string | null>(null);
const dialogError = ref('');
const showApiKey = ref(false);
const showBotToken = ref(false);
const showPageAccessToken = ref(false);

const showDialog = ref(false);
const showDelete = ref(false);
const editing = ref(false);
const selectedItem = ref<Integration | null>(null);

const form = ref({
  type: 'google_sheets',
  name: '',
  enabled: true,
  config: {} as Record<string, any>,
});

const typeOptions = [
  { label: 'Google Sheets', value: 'google_sheets' },
  { label: 'Telegram Bot', value: 'telegram' },
  { label: 'Facebook', value: 'facebook' },
  { label: 'Zapier', value: 'zapier' },
];

function typeIcon(type: string) {
  const map: Record<string, string> = {
    google_sheets: 'mdi-google-spreadsheet',
    telegram: 'mdi-send',
    facebook: 'mdi-facebook',
    zapier: 'mdi-lightning-bolt',
  };
  return map[type] ?? 'mdi-connection';
}

function typeColor(type: string) {
  const map: Record<string, string> = {
    google_sheets: '#0F9D58',
    telegram: '#0088cc',
    facebook: '#1877F2',
    zapier: '#FF4A00',
  };
  return map[type] ?? '#666';
}

function typeLabel(type: string) {
  return typeOptions.find((t) => t.value === type)?.label ?? type;
}

async function fetchIntegrations() {
  loading.value = true;
  try {
    const { data } = await api.get('/integrations');
    integrations.value = data;
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Lỗi tải danh sách tích hợp';
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = false;
  selectedItem.value = null;
  form.value = { type: 'google_sheets', name: '', enabled: true, config: {} };
  dialogError.value = '';
  showDialog.value = true;
}

function openEdit(item: Integration) {
  editing.value = true;
  selectedItem.value = item;
  form.value = { type: item.type, name: item.name, enabled: item.enabled, config: { ...item.config } };
  dialogError.value = '';
  showDialog.value = true;
}

function confirmDelete(item: Integration) {
  selectedItem.value = item;
  showDelete.value = true;
}

async function handleSave() {
  saving.value = true;
  dialogError.value = '';
  try {
    if (editing.value && selectedItem.value) {
      await api.put(`/integrations/${selectedItem.value.id}`, {
        name: form.value.name,
        config: form.value.config,
        enabled: form.value.enabled,
      });
    } else {
      await api.post('/integrations', form.value);
    }
    showDialog.value = false;
    await fetchIntegrations();
  } catch (err: any) {
    dialogError.value = err.response?.data?.error || 'Lỗi lưu tích hợp';
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  if (!selectedItem.value) return;
  saving.value = true;
  try {
    await api.delete(`/integrations/${selectedItem.value.id}`);
    showDelete.value = false;
    await fetchIntegrations();
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Lỗi xóa tích hợp';
  } finally {
    saving.value = false;
  }
}

async function handleSync(id: string) {
  syncing.value = id;
  try {
    await api.post(`/integrations/${id}/sync`);
    await fetchIntegrations();
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Lỗi đồng bộ';
  } finally {
    syncing.value = null;
  }
}

onMounted(fetchIntegrations);
</script>
