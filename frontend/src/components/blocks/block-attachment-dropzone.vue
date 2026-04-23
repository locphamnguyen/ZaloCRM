<template>
  <div>
    <v-file-input
      :label="label"
      :multiple="multiple"
      :accept="accept"
      variant="outlined"
      density="compact"
      hide-details
      prepend-icon=""
      prepend-inner-icon="mdi-paperclip"
      @change="onFilesSelected"
    />

    <!-- Thumbnail strip -->
    <div v-if="attachments.length" class="d-flex flex-wrap ga-2 mt-2">
      <div
        v-for="att in attachments"
        :key="att.id"
        class="att-chip d-flex align-center rounded-lg pa-1 px-2"
        style="background: rgba(0,242,255,0.06); border: 1px solid rgba(0,242,255,0.15);"
      >
        <v-img
          v-if="isImage(att.mimeType)"
          :src="att.url"
          width="40"
          height="40"
          cover
          rounded="md"
          class="mr-2"
        />
        <v-icon v-else size="28" class="mr-2" color="grey">mdi-file-outline</v-icon>
        <div style="max-width: 120px;">
          <div class="text-caption text-truncate">{{ att.filename }}</div>
          <div class="text-caption text-grey">{{ formatSize(att.size) }}</div>
        </div>
        <v-btn icon size="x-small" variant="text" color="error" class="ml-1" @click="$emit('delete', att.id)">
          <v-icon size="14">mdi-close</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Upload progress -->
    <v-progress-linear v-if="uploading" indeterminate color="primary" class="mt-2" />
    <div v-if="uploadError" class="text-caption text-error mt-1">{{ uploadError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { BlockAttachment } from '@/api/blocks-api';

const props = defineProps<{
  blockId: string;
  attachments: BlockAttachment[];
  multiple?: boolean;
  accept?: string;
  label?: string;
}>();

const emit = defineEmits<{
  uploaded: [att: BlockAttachment];
  delete: [attId: string];
}>();

const uploading = ref(false);
const uploadError = ref('');

import { uploadAttachment } from '@/api/blocks-api';

async function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files?.length) return;
  uploading.value = true;
  uploadError.value = '';
  try {
    for (const file of Array.from(input.files)) {
      const att = await uploadAttachment(props.blockId, file);
      emit('uploaded', att);
    }
  } catch (err) {
    uploadError.value = 'Tải lên thất bại, thử lại.';
    console.error('[block-attachment-dropzone] upload error:', err);
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

function isImage(mime: string) { return mime.startsWith('image/'); }
function formatSize(bytes: number) {
  if (bytes > 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
</script>
