<template>
  <v-card>
    <v-card-title>Sao lưu thông tin xác thực</v-card-title>
    <v-card-text>
      <v-alert
        v-if="localError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        closable
        @click:close="localError = ''"
      >
        {{ localError }}
      </v-alert>
      <v-alert
        v-if="successMsg"
        type="success"
        variant="tonal"
        density="compact"
        class="mb-3"
        closable
        @click:close="successMsg = ''"
      >
        {{ successMsg }}
      </v-alert>

      <div class="text-body-2 text-medium-emphasis mb-4">
        Xuất và nhập thông tin xác thực Zalo (cookie, IMEI, User-Agent).
        File JSON này cho phép khôi phục phiên đăng nhập mà không cần quét mã QR lại.
      </div>

      <v-divider class="mb-4" />

      <!-- Export -->
      <div class="mb-4">
        <div class="text-subtitle-2 mb-2">Xuất thông tin xác thực</div>
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-download"
          :loading="exporting"
          @click="onExport"
        >
          Tải xuống JSON
        </v-btn>
      </div>

      <v-divider class="mb-4" />

      <!-- Import -->
      <div>
        <div class="text-subtitle-2 mb-2">Nhập thông tin xác thực</div>
        <div
          class="drop-zone rounded-lg d-flex flex-column align-center justify-center pa-4 mb-2"
          :class="{ 'drop-active': isDragging }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="fileInput?.click()"
        >
          <v-icon size="32" color="grey-lighten-1">mdi-file-upload-outline</v-icon>
          <div class="text-body-2 text-medium-emphasis mt-1">Kéo thả file JSON hoặc nhấn để chọn</div>
          <input ref="fileInput" type="file" accept=".json,application/json" class="d-none" @change="onFileInput" />
        </div>
        <div v-if="pendingFileName" class="d-flex align-center gap-2 mb-2">
          <v-icon size="16" color="success">mdi-check-circle</v-icon>
          <span class="text-body-2">{{ pendingFileName }}</span>
          <v-btn icon size="x-small" variant="text" @click="clearFile">
            <v-icon size="14">mdi-close</v-icon>
          </v-btn>
        </div>
        <v-btn
          v-if="pendingContent"
          color="success"
          variant="tonal"
          prepend-icon="mdi-upload"
          :loading="saving"
          @click="onImport"
        >
          Nhập và lưu
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  saving: boolean;
  exporting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: 'export'): void;
  (e: 'import', content: string): void;
}>();

// Local copies so template can clear them independently of parent
const localError = ref(props.error);
const successMsg = ref('');
watch(() => props.error, (v) => { localError.value = v; });

const isDragging = ref(false);
const pendingFileName = ref('');
const pendingContent = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

function onExport() {
  emit('export');
}

async function readFile(file: File) {
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    localError.value = 'Chỉ hỗ trợ file .json';
    return;
  }
  const text = await file.text();
  pendingFileName.value = file.name;
  pendingContent.value = text;
  localError.value = '';
}

function onDrop(ev: DragEvent) {
  isDragging.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (file) readFile(file);
}

function onFileInput(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file) readFile(file);
}

function clearFile() {
  pendingFileName.value = '';
  pendingContent.value = '';
  if (fileInput.value) fileInput.value.value = '';
}

function onImport() {
  if (pendingContent.value) {
    emit('import', pendingContent.value);
  }
}
</script>

<style scoped>
.drop-zone {
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.2);
  transition: border-color 0.2s, background-color 0.2s;
  cursor: pointer;
  min-height: 80px;
}
.drop-zone.drop-active {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.05);
}
</style>
