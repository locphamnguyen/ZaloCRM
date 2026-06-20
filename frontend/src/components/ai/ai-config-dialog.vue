<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>Cấu hình AI</v-card-title>
      <v-card-text>
        <v-progress-linear v-if="loadingProviders" indeterminate class="mb-4" />

        <v-select
          v-model="local.provider"
          :items="providerItems"
          label="Provider"
          class="mb-3"
          :disabled="loadingProviders"
          @update:model-value="onProviderChange"
        />

        <v-text-field
          v-model="local.baseUrl"
          label="Base URL"
          placeholder="https://api.openai.com"
          class="mb-3"
          density="comfortable"
        />

        <div v-if="currentProvider" class="text-caption mb-1" :class="currentProvider.hasKey ? 'text-success' : 'text-medium-emphasis'">
          {{ currentProvider.hasKey ? `Đã cấu hình key ${currentProvider.keyMask}` : 'Chưa có API key — nhập bên dưới' }}
        </div>
        <v-text-field
          v-model="local.apiKey"
          label="API key"
          :type="showApiKey ? 'text' : 'password'"
          :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append-inner="showApiKey = !showApiKey"
          autocomplete="off"
          :placeholder="currentProvider?.hasKey ? '•••• (để trống = giữ key hiện tại)' : 'Dán API key của provider'"
          hint="Key được mã hoá khi lưu. Để trống xoá key sẽ quay về cấu hình .env."
          persistent-hint
          class="mb-2"
        />
        <div class="aic-actions mb-3">
          <button class="aic-apply" :disabled="savingProvider" @click="applyProvider">
            <v-icon size="16" :class="{ 'aic-spin': savingProvider }">{{ savingProvider ? 'mdi-loading' : 'mdi-cloud-download-outline' }}</v-icon>
            Áp dụng key + tải model
          </button>
          <button v-if="currentProvider?.hasKey" class="aic-clear" :disabled="savingProvider" @click="clearKey">
            <v-icon size="16">mdi-key-remove</v-icon>
            Xoá key
          </button>
        </div>

        <v-combobox
          v-model="local.model"
          :items="modelOptions"
          item-title="title"
          item-value="value"
          :return-object="false"
          label="Model"
          :loading="loadingModels"
          class="mb-1"
          :hint="modelHint"
          persistent-hint
        >
          <template #append>
            <v-btn icon="mdi-refresh" size="small" variant="text" :loading="loadingModels" @click="fetchModels" />
          </template>
        </v-combobox>
        <div class="mb-3" />

        <v-text-field v-model.number="local.maxDaily" type="number" label="Quota mỗi ngày" :min="1" :rules="[v => v >= 1 || 'Tối thiểu 1']" class="mb-3" />
        <v-switch v-model="local.enabled" label="Bật AI" inset color="primary" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Đóng</v-btn>
        <v-btn color="primary" :loading="loading || savingProvider" @click="onSave">Lưu</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch } from 'vue';
import { api } from '@/api';

type ProviderModel = { title: string; value: string };
type ProviderInfo = { id: string; name: string; baseUrl: string; hasKey: boolean; keyMask: string };

const props = defineProps<{
  modelValue: boolean;
  loading: boolean;
  config: { provider: string; model: string; maxDaily: number; enabled: boolean };
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [value: { provider: string; model: string; maxDaily: number; enabled: boolean }];
}>();

const providers = ref<ProviderInfo[]>([]);
const loadingProviders = ref(false);
const modelOptions = ref<ProviderModel[]>([]);
const loadingModels = ref(false);
const modelsError = ref('');
const savingProvider = ref(false);
const showApiKey = ref(false);

const local = reactive({ provider: 'openai', model: '', maxDaily: 500, enabled: true, baseUrl: '', apiKey: '' });

const providerItems = computed(() => providers.value.map((p) => ({ title: p.name, value: p.id })));
const currentProvider = computed(() => providers.value.find((p) => p.id === local.provider));
const modelHint = computed(() => {
  if (loadingModels.value) return 'Đang tải danh sách model…';
  if (modelsError.value) return `Không lấy được danh sách (${modelsError.value}) — gõ tay tên model.`;
  if (!modelOptions.value.length) return 'Chưa có danh sách — lưu API key rồi bấm tải, hoặc gõ tay tên model.';
  return 'Chọn từ danh sách hoặc gõ tay tên model.';
});

/* Fetch providers + trạng thái key per-org */
async function fetchProviders() {
  loadingProviders.value = true;
  try {
    const res = await api.get('/ai/providers');
    providers.value = res.data;
  } catch {
    providers.value = [];
  } finally {
    loadingProviders.value = false;
  }
}

/* Fetch model list động từ provider */
async function fetchModels() {
  if (!local.provider) return;
  loadingModels.value = true;
  modelsError.value = '';
  try {
    const res = await api.get(`/ai/providers/${local.provider}/models`);
    modelOptions.value = res.data?.models ?? [];
    modelsError.value = res.data?.error ?? '';
  } catch (e: any) {
    modelOptions.value = [];
    modelsError.value = e?.response?.data?.error || 'lỗi tải model';
  } finally {
    loadingModels.value = false;
  }
}

/* Lưu key + baseUrl cho provider hiện tại */
async function putProvider(payload: { apiKey?: string | null; baseUrl?: string | null }) {
  savingProvider.value = true;
  try {
    await api.put(`/ai/providers/${local.provider}`, payload);
    await fetchProviders();
  } finally {
    savingProvider.value = false;
  }
}

/* Nút "Áp dụng key + tải model" */
async function applyProvider() {
  const payload: { apiKey?: string; baseUrl?: string | null } = { baseUrl: local.baseUrl };
  if (local.apiKey) payload.apiKey = local.apiKey;
  await putProvider(payload);
  local.apiKey = '';
  await fetchModels();
}

async function clearKey() {
  await putProvider({ apiKey: null });
  local.apiKey = '';
  modelOptions.value = [];
}

function onProviderChange() {
  local.baseUrl = currentProvider.value?.baseUrl ?? '';
  local.apiKey = '';
  modelOptions.value = [];
  modelsError.value = '';
  fetchModels();
}

/* Lưu tất cả: key/baseUrl (nếu có) rồi aiConfig */
async function onSave() {
  const baseUrlChanged = local.baseUrl !== (currentProvider.value?.baseUrl ?? '');
  if (local.apiKey || baseUrlChanged) {
    const payload: { apiKey?: string; baseUrl?: string | null } = { baseUrl: local.baseUrl };
    if (local.apiKey) payload.apiKey = local.apiKey;
    await putProvider(payload);
    local.apiKey = '';
  }
  emit('save', { provider: local.provider, model: local.model, maxDaily: local.maxDaily, enabled: local.enabled });
}

/* Mở dialog → nạp providers, sau đó init local + base URL + models */
watch(() => props.modelValue, async (open) => {
  if (!open) return;
  await fetchProviders();
  local.baseUrl = currentProvider.value?.baseUrl ?? '';
  local.apiKey = '';
  fetchModels();
});

/* Sync config prop → local */
watch(() => props.config, (value) => {
  local.provider = value.provider;
  local.model = value.model;
  local.maxDaily = value.maxDaily;
  local.enabled = value.enabled;
}, { immediate: true, deep: true });
</script>

<style scoped>
/* Nút theo phong cách trang Zalo (NickGridCards): áp dụng = coral đặc, xoá = viền đỏ nền trắng */
.aic-actions { display: flex; gap: 8px; }
.aic-apply, .aic-clear {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; border: none; border-radius: 9px; font-weight: 600; font-size: 13.5px; cursor: pointer;
}
.aic-apply { background: #f04438; color: #fff; }
.aic-apply:hover:not(:disabled) { background: #d92d20; }
.aic-clear { background: #fff; border: 1px solid #FECACA; color: #B91C1C; }
.aic-clear:hover:not(:disabled) { background: #FEF2F2; }
.aic-apply:disabled, .aic-clear:disabled { opacity: .4; cursor: not-allowed; }
.aic-spin { animation: aic-spin .8s linear infinite; }
@keyframes aic-spin { to { transform: rotate(360deg); } }
</style>
