<template>
  <v-card>
    <v-card-title>Ảnh đại diện</v-card-title>
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

      <!-- Drop zone -->
      <div
        class="drop-zone rounded-lg d-flex flex-column align-center justify-center pa-6"
        :class="{ 'drop-active': isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
      >
        <v-icon size="48" color="grey-lighten-1">mdi-cloud-upload-outline</v-icon>
        <div class="text-body-2 text-medium-emphasis mt-2">Kéo thả ảnh vào đây</div>
        <div class="text-caption text-disabled mt-1">hoặc</div>
        <v-btn variant="tonal" size="small" class="mt-2" @click="triggerPicker">
          Chọn file
        </v-btn>
        <input ref="fileInput" type="file" accept="image/*" class="d-none" @change="onFileInput" />
      </div>

      <!-- Preview -->
      <div v-if="previewUrl" class="mt-4 text-center">
        <v-avatar size="96">
          <v-img :src="previewUrl" alt="Preview" />
        </v-avatar>
        <div class="text-caption text-medium-emphasis mt-1">{{ pendingFileName }}</div>
        <div class="mt-2">
          <v-btn color="primary" size="small" :loading="saving" @click="upload">
            Tải lên
          </v-btn>
          <v-btn variant="text" size="small" class="ml-2" @click="clearPreview">
            Hủy
          </v-btn>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ saving: boolean; error: string }>();

const emit = defineEmits<{
  (e: 'upload', filePath: string): void;
}>();

// Local error merges parent-provided error with inline validation messages
const localError = ref(props.error);
watch(() => props.error, (v) => { localError.value = v; });

const isDragging = ref(false);
const previewUrl = ref('');
const pendingFileName = ref('');
const pendingFilePath = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

function triggerPicker() {
  fileInput.value?.click();
}

function onFileInput(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file) handleFile(file);
}

function onDrop(ev: DragEvent) {
  isDragging.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    handleFile(file);
  } else {
    localError.value = 'Chỉ hỗ trợ file ảnh';
  }
}

function handleFile(file: File) {
  if (file.size > 300 * 1024) {
    localError.value = 'Ảnh phải nhỏ hơn 300KB (giới hạn Zalo)';
    return;
  }
  localError.value = '';
  previewUrl.value = URL.createObjectURL(file);
  pendingFileName.value = file.name;
  // Parent view must handle actual server upload; blob URL signals selection here
  pendingFilePath.value = previewUrl.value;
}

function upload() {
  if (pendingFilePath.value) {
    emit('upload', pendingFilePath.value);
  }
}

function clearPreview() {
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  pendingFileName.value = '';
  pendingFilePath.value = '';
  if (fileInput.value) fileInput.value.value = '';
}
</script>

<style scoped>
.drop-zone {
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.2);
  transition: border-color 0.2s, background-color 0.2s;
  cursor: pointer;
  min-height: 160px;
}
.drop-zone.drop-active {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.05);
}
</style>
