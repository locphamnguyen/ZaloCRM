<!--
  FacebookConfigModal.vue — shared 4-field config dialog for both Lead Ads tabs.
  Fields: FB_APP_ID, FB_APP_SECRET, FB_WEBHOOK_VERIFY_TOKEN, FB_TOKEN_ENC_KEY.
  Secrets (appSecret / tokenEncKey) only sent when the user types a new value.
-->
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fb-modal-bg" @click.self="close">
      <div class="fb-modal">
        <header class="fb-modal-head">
          <span>⚙ Cấu hình Facebook App</span>
          <button @click="close">×</button>
        </header>
        <div class="fb-modal-body">
          <div v-if="loading" class="fb-cfg-loading">Đang tải cấu hình...</div>
          <template v-else>
            <div v-if="config?.fromEnvFallback" class="fb-cfg-note">
              Đang dùng cấu hình mặc định từ biến môi trường (.env). Lưu để ghi đè cho org này.
            </div>

            <div class="fb-form-row">
              <label>FB App ID</label>
              <input v-model.trim="form.appId" placeholder="vd: 1234567890123456" />
              <div class="fb-form-hint">Meta App Dashboard → Settings → Basic → App ID.</div>
            </div>

            <div class="fb-form-row">
              <label>FB App Secret</label>
              <div class="pw-wrap">
                <input
                  v-model="form.appSecret"
                  :type="showAppSecret ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="config?.hasAppSecret ? '•••••••• (đã lưu — để trống nếu giữ nguyên)' : 'App Secret'"
                />
                <button type="button" class="pw-eye" tabindex="-1"
                        :aria-label="showAppSecret ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                        @click="showAppSecret = !showAppSecret">
                  <EyeOff v-if="showAppSecret" :size="17" /><Eye v-else :size="17" />
                </button>
              </div>
              <div class="fb-form-hint">Meta App Dashboard → Settings → Basic → App Secret (Show).</div>
            </div>

            <div class="fb-form-row">
              <label>Webhook Verify Token</label>
              <input v-model.trim="form.webhookVerifyToken" placeholder="vd: my-verify-token-2026" />
              <div class="fb-form-hint">
                Chuỗi bất kỳ bạn tự đặt — nhập trùng ở Meta → Webhooks khi verify callback.
              </div>
            </div>

            <div class="fb-form-row">
              <label>Token Encryption Key</label>
              <div class="pw-wrap">
                <input
                  v-model="form.tokenEncKey"
                  :type="showTokenEncKey ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="config?.hasTokenEncKey ? '•••••••• (đã lưu — để trống nếu giữ nguyên)' : '64 ký tự hex'"
                />
                <button type="button" class="pw-eye" tabindex="-1"
                        :aria-label="showTokenEncKey ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
                        @click="showTokenEncKey = !showTokenEncKey">
                  <EyeOff v-if="showTokenEncKey" :size="17" /><Eye v-else :size="17" />
                </button>
              </div>
              <div class="fb-form-hint">
                Sinh bằng <code>openssl rand -hex 32</code> (64 ký tự hex) để mã hoá access token.
              </div>
            </div>

            <div v-if="errorMsg" class="fb-form-err">{{ errorMsg }}</div>
          </template>
        </div>
        <footer class="fb-modal-foot">
          <button class="fb-btn-ghost" @click="close">Hủy</button>
          <button class="fb-btn-primary" :disabled="saving || loading" @click="save">
            {{ saving ? 'Đang lưu...' : 'Lưu' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useToast } from '@/composables/use-toast';
import { getConfig, putConfig, type FacebookConfigDto } from '@/api/facebook-api';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const toast = useToast();
const loading = ref(false);
const saving = ref(false);
const errorMsg = ref('');
const config = ref<FacebookConfigDto | null>(null);
const showAppSecret = ref(false);
const showTokenEncKey = ref(false);

const form = reactive({
  appId: '',
  appSecret: '',
  webhookVerifyToken: '',
  tokenEncKey: '',
});

async function load(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await getConfig();
    config.value = data;
    form.appId = data.appId ?? '';
    form.webhookVerifyToken = data.webhookVerifyToken ?? '';
    form.appSecret = '';
    form.tokenEncKey = '';
  } catch {
    toast.error('Không tải được cấu hình Facebook');
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  errorMsg.value = '';
  // Only send secrets the user actually typed; always send the text fields.
  const body: Record<string, string> = {
    appId: form.appId,
    webhookVerifyToken: form.webhookVerifyToken,
  };
  if (form.appSecret.trim()) body.appSecret = form.appSecret.trim();
  if (form.tokenEncKey.trim()) body.tokenEncKey = form.tokenEncKey.trim();
  try {
    config.value = await putConfig(body);
    toast.success('Đã lưu cấu hình Facebook');
    emit('saved');
    close();
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } } };
    errorMsg.value = err.response?.data?.error || 'Lưu cấu hình thất bại';
  } finally {
    saving.value = false;
  }
}

function close(): void {
  emit('update:modelValue', false);
}

// Load fresh config every time the modal opens.
watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
  },
);
</script>

<style scoped>
.fb-modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.fb-modal {
  background: white; border-radius: 12px; max-width: 480px; width: calc(100vw - 40px);
  display: flex; flex-direction: column;
  box-shadow: 0 20px 40px rgba(0,0,0,0.2);
}
.fb-modal-head {
  display: flex; align-items: center; padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb; font-weight: 700; font-size: 15px;
}
.fb-modal-head span { flex: 1; }
.fb-modal-head button {
  background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280;
}
.fb-modal-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; max-height: 70vh; overflow-y: auto; }
.fb-cfg-loading { color: #6b7280; font-size: 13px; padding: 12px 0; }
.fb-cfg-note {
  background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af;
  border-radius: 7px; padding: 8px 12px; font-size: 12px;
}
.fb-form-row { display: flex; flex-direction: column; gap: 4px; }
.fb-form-row label { font-size: 12.5px; font-weight: 600; color: #374151; }
.fb-form-row input {
  border: 1px solid #d1d5db; border-radius: 7px; padding: 8px 12px; font-size: 13px;
  font-family: inherit;
}
.fb-form-hint { font-size: 11.5px; color: #6b7280; }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 40px; width: 100%; box-sizing: border-box; }
.pw-eye {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0; margin: 0;
  border: none; background: transparent; cursor: pointer;
  color: var(--ink-4, #97a0b3); border-radius: 6px;
}
.pw-eye:hover { color: var(--ink-2, #475066); background: rgba(0,0,0,.04); }
.fb-form-hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-family: monospace; color: #0f172a; }
.fb-form-err {
  background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b;
  border-radius: 7px; padding: 8px 12px; font-size: 12.5px;
}
.fb-btn-primary {
  background: #1877F2; color: white; border: none; border-radius: 8px;
  padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.fb-btn-primary:hover:not(:disabled) { background: #166fe5; }
.fb-btn-primary:disabled { opacity: 0.5; cursor: wait; }
.fb-btn-ghost {
  background: white; color: #374151; border: 1px solid #d1d5db; border-radius: 7px;
  padding: 8px 14px; font-size: 13px; cursor: pointer;
}
.fb-btn-ghost:hover { background: #f3f4f6; }
.fb-modal-foot {
  display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #e5e7eb;
  justify-content: flex-end; background: #fafafa;
}
</style>
