<template>
  <div style="max-width: 700px;">
    <h1 class="text-h5 mb-4">
      <v-icon class="mr-2" style="color: #00F2FF;">mdi-api</v-icon>
      API & Webhook
    </h1>

    <!-- API Key section -->
    <v-card class="mb-4">
      <v-card-title class="text-body-1">API Key</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="apiKey"
          label="API Key"
          readonly
          append-inner-icon="mdi-content-copy"
          @click:append-inner="copyKey"
        />
        <v-btn
          color="primary"
          variant="outlined"
          prepend-icon="mdi-refresh"
          :loading="generatingKey"
          @click="generateKey"
        >
          Tạo key mới
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- Webhook section -->
    <v-card class="mb-4">
      <v-card-title class="text-body-1">Webhook</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="webhookUrl"
          label="Webhook URL"
          placeholder="https://your-server.com/webhook"
          class="mb-2"
        />
        <v-text-field
          v-model="webhookSecret"
          label="Secret (HMAC)"
          :type="showWebhookSecret ? 'text' : 'password'"
          :append-inner-icon="showWebhookSecret ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append-inner="showWebhookSecret = !showWebhookSecret"
          class="mb-3"
        />
        <div class="d-flex gap-2">
          <v-btn color="primary" :loading="saving" @click="saveWebhook">Lưu</v-btn>
          <v-btn variant="outlined" :loading="testing" @click="testWebhook">Test Webhook</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title class="text-body-1 d-flex align-center">
        AI Assistant
        <v-spacer />
        <v-btn color="primary" variant="outlined" @click="showAiConfig = true">Cấu hình AI</v-btn>
      </v-card-title>
      <v-card-text>
        <div class="text-body-2">Provider: <strong>{{ aiConfig.provider }}</strong></div>
        <div class="text-body-2">Model: <strong>{{ aiConfig.model }}</strong></div>
        <div class="text-body-2">Quota/ngày: <strong>{{ aiConfig.maxDaily }}</strong></div>
        <div class="text-body-2">Trạng thái: <strong>{{ aiConfig.enabled ? 'Bật' : 'Tắt' }}</strong></div>
      </v-card-text>
    </v-card>

    <!-- API Docs -->
    <v-card>
      <v-card-title class="text-body-1">API Documentation</v-card-title>
      <v-card-text>
        <div class="mb-3">Document xem tại đây: <a href="https://docs.locnguyendata.com/" target="_blank" rel="noopener">https://docs.locnguyendata.com/</a></div>
        <pre style="font-size: 12px; overflow-x: auto; white-space: pre-wrap;">Header: X-API-Key: your-key

GET  /api/public/contacts
POST /api/public/contacts
GET  /api/public/conversations
POST /api/public/messages/send
GET  /api/public/appointments
POST /api/public/appointments

Webhook events:
- message.received
- message.sent
- contact.created
- zalo.connected
- zalo.disconnected</pre>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snack.show" :color="snack.color" :timeout="3000">
      {{ snack.text }}
    </v-snackbar>

    <AiConfigDialog
      v-model="showAiConfig"
      :loading="aiSaving"
      :config="aiConfig"
      @save="saveAiConfig"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import AiConfigDialog from '@/components/ai/ai-config-dialog.vue';

const apiKey = ref('');
const generatingKey = ref(false);
const webhookUrl = ref('');
const webhookSecret = ref('');
const showWebhookSecret = ref(false);
const saving = ref(false);
const testing = ref(false);
const showAiConfig = ref(false);
const aiSaving = ref(false);
const aiConfig = ref({ provider: 'anthropic', model: 'claude-sonnet-4-6', maxDaily: 500, enabled: true });

const snack = ref({ show: false, text: '', color: 'success' });

function showSnack(text: string, color = 'success') {
  snack.value = { show: true, text, color };
}

async function loadApiKey() {
  try {
    const res = await api.get('/settings/api-key');
    apiKey.value = res.data.apiKey ?? '';
  } catch {
    apiKey.value = '';
  }
}

async function loadWebhook() {
  try {
    const res = await api.get('/settings/webhook');
    webhookUrl.value = res.data.webhookUrl ?? '';
    webhookSecret.value = res.data.webhookSecret ?? '';
  } catch {
    webhookUrl.value = '';
    webhookSecret.value = '';
  }
}

async function loadAiConfig() {
  try {
    const res = await api.get('/ai/config');
    aiConfig.value = {
      provider: res.data.provider,
      model: res.data.model,
      maxDaily: res.data.maxDaily,
      enabled: res.data.enabled,
    };
  } catch {
    aiConfig.value = { provider: 'anthropic', model: 'claude-sonnet-4-6', maxDaily: 500, enabled: true };
  }
}

async function generateKey() {
  generatingKey.value = true;
  try {
    const res = await api.post('/settings/api-key/generate');
    apiKey.value = res.data.apiKey ?? '';
    showSnack('API key mới đã được tạo');
  } catch {
    showSnack('Tạo key thất bại', 'error');
  } finally {
    generatingKey.value = false;
  }
}

async function copyKey() {
  if (!apiKey.value) return;
  await navigator.clipboard.writeText(apiKey.value);
  showSnack('Đã sao chép API key');
}

async function saveWebhook() {
  saving.value = true;
  try {
    await api.put('/settings/webhook', {
      webhookUrl: webhookUrl.value,
      webhookSecret: webhookSecret.value,
    });
    showSnack('Đã lưu cấu hình webhook');
  } catch {
    showSnack('Lưu thất bại', 'error');
  } finally {
    saving.value = false;
  }
}

async function testWebhook() {
  testing.value = true;
  try {
    await api.post('/settings/webhook/test');
    showSnack('Gửi test webhook thành công');
  } catch {
    showSnack('Test webhook thất bại', 'error');
  } finally {
    testing.value = false;
  }
}

async function saveAiConfig(value: { provider: string; model: string; maxDaily: number; enabled: boolean }) {
  aiSaving.value = true;
  try {
    const res = await api.put('/ai/config', value);
    aiConfig.value = {
      provider: res.data.provider,
      model: res.data.model,
      maxDaily: res.data.maxDaily,
      enabled: res.data.enabled,
    };
    showAiConfig.value = false;
    showSnack('Đã lưu cấu hình AI');
  } catch {
    showSnack('Lưu cấu hình AI thất bại', 'error');
  } finally {
    aiSaving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadApiKey(), loadWebhook(), loadAiConfig()]);
});
</script>
