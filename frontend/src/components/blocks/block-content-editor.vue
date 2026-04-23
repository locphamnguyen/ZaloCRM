<template>
  <div>
    <!-- TEXT -->
    <template v-if="type === 'text'">
      <v-textarea
        :model-value="(content.text as string) || ''"
        label="Nội dung văn bản"
        variant="outlined"
        rows="4"
        auto-grow
        @update:model-value="patch('text', $event)"
      />
      <BlockVariablePicker class="mt-2" @insert="insertVariable" />
    </template>

    <!-- HTML -->
    <template v-else-if="type === 'html'">
      <v-textarea
        :model-value="(content.html as string) || ''"
        label="HTML"
        variant="outlined"
        rows="6"
        auto-grow
        font-family="monospace"
        @update:model-value="patch('html', $event)"
      />
      <div v-if="content.html" class="mt-2 pa-3 rounded border text-caption" style="max-height:160px; overflow:auto;">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-html="content.html as string" />
      </div>
      <v-alert type="info" density="compact" variant="tonal" class="mt-2 text-caption">
        HTML sẽ hiển thị dạng văn bản trên Zalo
      </v-alert>
    </template>

    <!-- IMAGE / FILE (multi) -->
    <template v-else-if="type === 'image' || type === 'file'">
      <v-textarea
        :model-value="(content.caption as string) || ''"
        label="Chú thích"
        variant="outlined"
        rows="2"
        auto-grow
        class="mb-3"
        @update:model-value="patch('caption', $event)"
      />
      <BlockAttachmentDropzone
        v-if="blockId"
        :block-id="blockId"
        :attachments="attachments"
        :multiple="true"
        :accept="type === 'image' ? 'image/*' : '*/*'"
        :label="type === 'image' ? 'Chọn ảnh' : 'Chọn tệp'"
        @uploaded="onAttUploaded"
        @delete="$emit('delete-attachment', $event)"
      />
      <div v-else class="text-caption text-grey">Lưu khối trước để tải tệp lên.</div>
    </template>

    <!-- VIDEO (single) -->
    <template v-else-if="type === 'video'">
      <v-textarea
        :model-value="(content.caption as string) || ''"
        label="Chú thích"
        variant="outlined"
        rows="2"
        auto-grow
        class="mb-3"
        @update:model-value="patch('caption', $event)"
      />
      <BlockAttachmentDropzone
        v-if="blockId"
        :block-id="blockId"
        :attachments="attachments"
        :multiple="false"
        accept="video/*"
        label="Chọn video"
        @uploaded="onAttUploaded"
        @delete="$emit('delete-attachment', $event)"
      />
      <div v-else class="text-caption text-grey">Lưu khối trước để tải video lên.</div>
    </template>

    <!-- LINK -->
    <template v-else-if="type === 'link'">
      <v-text-field
        :model-value="(content.url as string) || ''"
        label="URL"
        variant="outlined"
        density="compact"
        class="mb-2"
        @update:model-value="patch('url', $event)"
      />
      <v-text-field
        :model-value="(content.title as string) || ''"
        label="Tiêu đề"
        variant="outlined"
        density="compact"
        class="mb-2"
        @update:model-value="patch('title', $event)"
      />
      <v-text-field
        :model-value="(content.thumbnail as string) || ''"
        label="URL thumbnail"
        variant="outlined"
        density="compact"
        @update:model-value="patch('thumbnail', $event)"
      />
    </template>

    <!-- CARD -->
    <template v-else-if="type === 'card'">
      <v-text-field
        :model-value="(content.title as string) || ''"
        label="Tiêu đề card"
        variant="outlined"
        density="compact"
        class="mb-2"
        @update:model-value="patch('title', $event)"
      />
      <v-textarea
        :model-value="(content.description as string) || ''"
        label="Mô tả"
        variant="outlined"
        rows="2"
        auto-grow
        class="mb-2"
        @update:model-value="patch('description', $event)"
      />
      <v-text-field
        :model-value="(content.ctaText as string) || ''"
        label="Nút CTA (văn bản)"
        variant="outlined"
        density="compact"
        class="mb-2"
        @update:model-value="patch('ctaText', $event)"
      />
      <v-text-field
        :model-value="(content.ctaUrl as string) || ''"
        label="Nút CTA (URL)"
        variant="outlined"
        density="compact"
        class="mb-2"
        @update:model-value="patch('ctaUrl', $event)"
      />
      <BlockAttachmentDropzone
        v-if="blockId"
        :block-id="blockId"
        :attachments="attachments"
        :multiple="false"
        accept="image/*"
        label="Ảnh bìa card"
        @uploaded="onCardImageUploaded"
        @delete="$emit('delete-attachment', $event)"
      />
      <div v-else class="text-caption text-grey">Lưu khối trước để tải ảnh lên.</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { BlockType, BlockAttachment } from '@/api/blocks-api';
import BlockVariablePicker from './block-variable-picker.vue';
import BlockAttachmentDropzone from './block-attachment-dropzone.vue';

const props = defineProps<{
  type: BlockType;
  content: Record<string, unknown>;
  blockId?: string;
  attachments: BlockAttachment[];
}>();

const emit = defineEmits<{
  'update:content': [content: Record<string, unknown>];
  'delete-attachment': [attId: string];
}>();

function patch(key: string, value: unknown) {
  emit('update:content', { ...props.content, [key]: value });
}

function insertVariable(token: string) {
  const current = (props.content.text as string) || '';
  patch('text', current + token);
}

function onAttUploaded(att: BlockAttachment) {
  const ids = [...((props.content.attachmentIds as string[]) || []), att.id];
  patch('attachmentIds', ids);
}

function onCardImageUploaded(att: BlockAttachment) {
  patch('imageAttachmentId', att.id);
}
</script>
