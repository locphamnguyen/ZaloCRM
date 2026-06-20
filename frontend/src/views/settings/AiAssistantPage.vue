<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- M53 2026-05-30: Trang cài đặt Trợ Lý AI cho Virtual Chat (KH no-Zalo).
       Admin edit prompt template, toggle on/off, đổi regex skip noise. -->
  <div class="ai-page">
    <header class="ai-page-header">
      <div>
        <h1 class="ai-page-title">🤖 Trợ lý AI cho Chat nội bộ</h1>
        <p class="ai-page-sub">
          Cấu hình prompt và quy tắc cho trợ lý gợi ý sale khai thác thông tin + tự động trích xuất dữ liệu KH.
        </p>
      </div>
      <div v-if="loading" class="loading-pill">⏳ Đang tải...</div>
    </header>

    <div v-if="config" class="ai-page-body">
      <!-- Toggle bật/tắt -->
      <div class="toggle-card">
        <label class="toggle-row">
          <input type="checkbox" v-model="config.aiAssistantEnabled" />
          <div>
            <div class="toggle-label">Bật trợ lý AI</div>
            <div class="toggle-hint">
              Khi tắt: virtual chat vẫn lưu nhật ký bình thường, nhưng AI sẽ không gợi ý + extract thông tin nữa.
            </div>
          </div>
        </label>
      </div>

      <!-- Provider info -->
      <div class="info-card">
        <div class="info-row">
          <span class="info-label">Nhà cung cấp AI</span>
          <span class="info-value">{{ config.provider }} — {{ config.model }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Quota hôm nay</span>
          <span class="info-value">{{ usage?.usedToday ?? 0 }} / {{ config.maxDaily }} lượt</span>
        </div>
        <div class="info-row">
          <span class="info-label">Còn lại</span>
          <span class="info-value" :class="{ 'low-quota': lowQuota }">
            {{ usage?.remaining ?? config.maxDaily }} lượt
          </span>
        </div>
      </div>

      <!-- Prompt editor -->
      <div class="field-group">
        <label class="field-label">
          Prompt mẫu cho trợ lý AI
          <span class="field-meta">(anh edit để thay đổi cách AI nói chuyện với sale)</span>
        </label>
        <textarea
          v-model="config.aiAssistantPromptTemplate"
          class="prompt-editor"
          rows="20"
          spellcheck="false"
        />
        <div class="field-hint">
          Dùng markdown. Lưu thay đổi sẽ áp dụng ngay cho mọi sale trong tổ chức.
        </div>
      </div>

      <!-- Skip noise regex -->
      <div class="field-group">
        <label class="field-label">
          Quy tắc bỏ qua tin nhắn ngắn (regex)
          <span class="field-meta">(tiết kiệm token — AI không trả lời tin "ok", "ờ", "uhm"...)</span>
        </label>
        <input
          v-model="config.aiAssistantSkipNoisePattern"
          class="regex-input"
          spellcheck="false"
        />
        <div class="field-hint">
          Tin nhắn matching regex này sẽ KHÔNG kích hoạt AI. Mặc định bỏ qua "ok", "ờ", "uhm"...
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <button class="btn-danger-ghost" @click="restoreDefault" :disabled="saving">
          ↺ Khôi phục prompt mặc định
        </button>
        <button class="btn-secondary" @click="testPromptOpen = true" :disabled="saving">
          🧪 Test prompt với tin nhắn mẫu
        </button>
        <button class="btn-primary" @click="save" :disabled="saving">
          {{ saving ? '⏳ Đang lưu...' : '💾 Lưu cài đặt' }}
        </button>
      </div>

      <div v-if="saveMessage" class="save-msg" :class="saveOk ? 'ok' : 'err'">{{ saveMessage }}</div>
    </div>

    <!-- Test prompt modal -->
    <div v-if="testPromptOpen" class="modal-overlay" @click.self="testPromptOpen = false">
      <div class="modal-body">
        <header class="modal-header">
          <h3>🧪 Test prompt</h3>
          <button class="modal-close" @click="testPromptOpen = false">✕</button>
        </header>
        <div class="modal-content">
          <p class="modal-hint">
            Chức năng test prompt với tin nhắn mẫu sẽ ra mắt phiên bản kế tiếp.
            Hiện tại anh có thể test trực tiếp bằng cách mở 1 virtual chat (KH no-Zalo)
            và gửi tin để xem AI phản hồi.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api/index';

interface AiAssistantConfig {
  aiAssistantEnabled: boolean;
  aiAssistantPromptTemplate: string | null;
  aiAssistantSkipNoisePattern: string;
  defaultPrompt: string;
  provider: string;
  model: string;
  maxDaily: number;
  enabled: boolean;
}

interface AiUsage {
  usedToday: number;
  maxDaily: number;
  remaining: number;
  enabled: boolean;
}

const loading = ref(true);
const saving = ref(false);
const config = ref<AiAssistantConfig | null>(null);
const usage = ref<AiUsage | null>(null);
const saveMessage = ref('');
const saveOk = ref(false);
const testPromptOpen = ref(false);

const lowQuota = computed(() => {
  if (!usage.value || !config.value) return false;
  return usage.value.remaining < config.value.maxDaily * 0.2;
});

async function load() {
  loading.value = true;
  try {
    const [cfgRes, usageRes] = await Promise.all([
      api.get<AiAssistantConfig>('/ai/assistant-config'),
      api.get<AiUsage>('/ai/usage'),
    ]);
    config.value = cfgRes.data;
    usage.value = usageRes.data;
  } catch (e: any) {
    saveMessage.value = e?.response?.data?.error || e?.message || 'Lỗi tải cài đặt';
    saveOk.value = false;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!config.value || saving.value) return;
  saving.value = true;
  saveMessage.value = '';
  try {
    // Validate regex client-side
    try {
      new RegExp(config.value.aiAssistantSkipNoisePattern);
    } catch {
      saveMessage.value = 'Regex không hợp lệ';
      saveOk.value = false;
      saving.value = false;
      return;
    }
    await api.put('/ai/assistant-config', {
      aiAssistantEnabled: config.value.aiAssistantEnabled,
      aiAssistantPromptTemplate: config.value.aiAssistantPromptTemplate,
      aiAssistantSkipNoisePattern: config.value.aiAssistantSkipNoisePattern,
    });
    saveMessage.value = '✓ Đã lưu cài đặt';
    saveOk.value = true;
    setTimeout(() => (saveMessage.value = ''), 3000);
  } catch (e: any) {
    saveMessage.value = e?.response?.data?.error || e?.message || 'Lỗi lưu cài đặt';
    saveOk.value = false;
  } finally {
    saving.value = false;
  }
}

function restoreDefault() {
  if (!config.value) return;
  if (!confirm('Khôi phục prompt mặc định? Prompt đã edit sẽ bị thay thế.')) return;
  config.value.aiAssistantPromptTemplate = config.value.defaultPrompt;
}

onMounted(load);
</script>

<style scoped>
.ai-page {
  max-width: 960px;
  padding: 20px;
}
.ai-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}
.ai-page-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 6px;
}
.ai-page-sub {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}
.loading-pill {
  padding: 4px 10px;
  background: #f1f5f9;
  border-radius: 8px;
  font-size: 12px;
  color: #64748b;
}
.ai-page-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.toggle-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
}
.toggle-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  cursor: pointer;
}
.toggle-row input { margin-top: 2px; }
.toggle-label { font-weight: 600; font-size: 13px; }
.toggle-hint { font-size: 11px; color: #64748b; margin-top: 2px; }
.info-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px 14px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 4px 0;
}
.info-label { color: #64748b; }
.info-value { font-weight: 500; }
.info-value.low-quota { color: #b91c1c; }

.field-group {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
}
.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #1f2937;
}
.field-meta {
  color: #64748b;
  font-weight: 400;
  font-size: 11px;
}
.field-hint {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
}
.prompt-editor {
  width: 100%;
  min-height: 380px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  background: #fafbfc;
  color: #1e3a8a;
  resize: vertical;
}
.regex-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 0;
  border-top: 1px solid #e2e8f0;
}
.btn-primary {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-secondary {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  font-weight: 500;
  cursor: pointer;
  font-size: 13px;
}
.btn-danger-ghost {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid #fecaca;
  background: #fff;
  color: #b91c1c;
  font-weight: 500;
  cursor: pointer;
  font-size: 13px;
}
.save-msg {
  text-align: right;
  font-size: 12px;
  padding: 6px;
}
.save-msg.ok { color: #166534; }
.save-msg.err { color: #b91c1c; }

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-body {
  background: #fff;
  border-radius: 8px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  overflow: auto;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
}
.modal-header h3 { margin: 0; font-size: 14px; font-weight: 600; }
.modal-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #64748b;
}
.modal-content { padding: 16px; }
.modal-hint { font-size: 13px; color: #64748b; line-height: 1.6; }
</style>
