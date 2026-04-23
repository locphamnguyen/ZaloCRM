<template>
  <div style="max-width: 900px; margin: 0 auto;">
    <!-- Header -->
    <div class="d-flex align-center mb-4">
      <v-btn icon variant="text" @click="router.push('/blocks')">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <h2 class="text-h6 ml-2">{{ isNew ? 'Tạo khối mới' : 'Chỉnh sửa khối' }}</h2>
      <v-spacer />
      <v-btn variant="text" class="mr-2" @click="router.push('/blocks')">Hủy</v-btn>
      <v-btn color="primary" :loading="saving" :disabled="!form.name || !form.type" @click="save">Lưu</v-btn>
    </div>

    <!-- Step 1: type selector for new block -->
    <template v-if="isNew && !form.type">
      <v-card rounded="lg" class="pa-4">
        <v-card-title class="text-body-1 pb-2">Chọn loại khối</v-card-title>
        <BlockTypeSelector v-model="form.type" />
      </v-card>
    </template>

    <!-- Step 2: editor form -->
    <template v-else-if="form.type">
      <v-row>
        <v-col cols="12" md="7">
          <v-card rounded="lg" class="pa-4 mb-4">
            <v-text-field
              v-model="form.name"
              label="Tên khối *"
              variant="outlined"
              density="compact"
              class="mb-3"
              :rules="[v => !!v || 'Tên là bắt buộc']"
            />
            <v-switch v-model="form.isShared" label="Dùng chung (tất cả nhân viên)" color="primary" hide-details class="mb-3" />
            <v-divider class="mb-3" />
            <BlockContentEditor
              :type="form.type"
              :content="form.content"
              :block-id="savedBlockId"
              :attachments="attachments"
              @update:content="form.content = $event"
              @delete-attachment="onDeleteAttachment"
            />
          </v-card>
        </v-col>

        <v-col cols="12" md="5">
          <BlockPreview v-if="savedBlockId" :block-id="savedBlockId" />
          <v-alert v-else type="info" variant="tonal" density="compact" class="text-caption">
            Lưu khối để xem trước
          </v-alert>
        </v-col>
      </v-row>
    </template>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">{{ snack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getBlock, createBlock, updateBlock, type BlockType, type BlockAttachment } from '@/api/blocks-api';
import { useBlocksStore } from '@/stores/blocks';
import BlockTypeSelector from '@/components/blocks/block-type-selector.vue';
import BlockContentEditor from '@/components/blocks/block-content-editor.vue';
import BlockPreview from '@/components/blocks/block-preview.vue';

const route = useRoute();
const router = useRouter();
const store = useBlocksStore();

const routeId = computed(() => route.params.id as string | undefined);
const isNew = computed(() => !routeId.value || routeId.value === 'new');
const savedBlockId = ref<string | undefined>(undefined);
const attachments = ref<BlockAttachment[]>([]);

const form = ref<{ name: string; type: BlockType | null; content: Record<string, unknown>; isShared: boolean }>({
  name: '',
  type: null,
  content: {},
  isShared: false,
});

const saving = ref(false);
const snack = ref({ show: false, text: '', color: 'success' });

onMounted(async () => {
  if (!isNew.value && routeId.value) {
    try {
      const block = await getBlock(routeId.value);
      form.value = { name: block.name, type: block.type, content: block.content, isShared: block.isShared };
      savedBlockId.value = block.id;
      attachments.value = block.attachments;
    } catch {
      snack.value = { show: true, text: 'Không thể tải khối', color: 'error' };
    }
  }
});

async function save() {
  if (!form.value.name || !form.value.type) return;
  saving.value = true;
  try {
    if (isNew.value && !savedBlockId.value) {
      const block = await createBlock({
        name: form.value.name,
        type: form.value.type,
        content: form.value.content,
        isShared: form.value.isShared,
      });
      savedBlockId.value = block.id;
      attachments.value = block.attachments;
      snack.value = { show: true, text: 'Đã tạo khối!', color: 'success' };
      await router.replace(`/blocks/${block.id}`);
    } else if (savedBlockId.value) {
      const block = await updateBlock(savedBlockId.value, {
        name: form.value.name,
        content: form.value.content,
        isShared: form.value.isShared,
      });
      attachments.value = block.attachments;
      snack.value = { show: true, text: 'Đã lưu!', color: 'success' };
    }
    store.fetch();
  } catch {
    snack.value = { show: true, text: 'Lưu thất bại', color: 'error' };
  } finally {
    saving.value = false;
  }
}

async function onDeleteAttachment(attId: string) {
  if (!savedBlockId.value) return;
  const ok = await store.deleteBlockAttachment(savedBlockId.value, attId);
  if (ok) {
    attachments.value = attachments.value.filter((a) => a.id !== attId);
  }
}
</script>
