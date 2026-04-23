<template>
  <div v-if="visible" class="block-picker-popup">
    <v-card elevation="8" rounded="lg" width="380">
      <div class="pa-2 pb-1">
        <v-text-field
          v-model="search"
          placeholder="Tìm khối..."
          variant="solo-filled"
          density="compact"
          hide-details
          prepend-inner-icon="mdi-magnify"
          autofocus
        />
      </div>

      <v-list density="compact" nav class="overflow-y-auto" style="max-height: 260px;">
        <v-list-subheader>Khối nội dung</v-list-subheader>

        <v-list-item
          v-for="block in filtered"
          :key="block.id"
          :prepend-icon="typeIcon(block.type)"
          @click="selectBlock(block)"
        >
          <v-list-item-title class="text-body-2">{{ block.name }}</v-list-item-title>
          <v-list-item-subtitle class="text-caption">{{ typeLabel(block.type) }}</v-list-item-subtitle>
        </v-list-item>

        <v-list-item v-if="!filtered.length && !store.loading" disabled>
          <v-list-item-title class="text-grey text-caption">Không tìm thấy khối nào</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- Preview + send dialog -->
    <v-dialog v-model="previewDialog" max-width="480">
      <v-card>
        <v-card-title class="text-body-1">Xem trước & Gửi</v-card-title>
        <v-card-text>
          <div class="text-caption text-grey mb-2">{{ selectedBlock?.name }}</div>
          <div v-if="previewLoading" class="d-flex justify-center py-4">
            <v-progress-circular indeterminate size="24" />
          </div>
          <div v-else-if="previewData" class="pa-2 rounded bg-grey-lighten-4">
            <pre style="white-space: pre-wrap; font-size: 0.82rem;">{{ typeof previewData === 'string' ? previewData : JSON.stringify(previewData, null, 2) }}</pre>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="previewDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="sending" prepend-icon="mdi-send" @click="doSend">Gửi</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">{{ snack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useBlocksStore } from '@/stores/blocks';
import { previewBlock, sendBlock, type Block } from '@/api/blocks-api';

const props = defineProps<{
  visible: boolean;
  conversationId: string | null;
  contactId?: string | null;
}>();

const emit = defineEmits<{ close: []; sent: [] }>();

const store = useBlocksStore();
const search = ref('');
const selectedBlock = ref<Block | null>(null);
const previewDialog = ref(false);
const previewData = ref<unknown>(null);
const previewLoading = ref(false);
const sending = ref(false);
const snack = ref({ show: false, text: '', color: 'success' });

watch(() => props.visible, (v) => {
  if (v) store.fetch();
});

const filtered = computed(() => {
  if (!search.value) return store.blocks;
  const q = search.value.toLowerCase();
  return store.blocks.filter((b) => b.name.toLowerCase().includes(q));
});

const TYPE_META: Record<string, { icon: string; label: string }> = {
  text: { icon: 'mdi-text-box-outline', label: 'Văn bản' },
  html: { icon: 'mdi-language-html5', label: 'HTML' },
  image: { icon: 'mdi-image-outline', label: 'Hình ảnh' },
  video: { icon: 'mdi-video-outline', label: 'Video' },
  file: { icon: 'mdi-file-outline', label: 'Tệp' },
  link: { icon: 'mdi-link-variant', label: 'Liên kết' },
  card: { icon: 'mdi-card-text-outline', label: 'Card' },
};

function typeIcon(t: string) { return TYPE_META[t]?.icon ?? 'mdi-package-variant'; }
function typeLabel(t: string) { return TYPE_META[t]?.label ?? t; }

async function selectBlock(block: Block) {
  selectedBlock.value = block;
  previewDialog.value = true;
  previewLoading.value = true;
  previewData.value = null;
  try {
    const res = await previewBlock(block.id, { contactId: props.contactId ?? undefined });
    previewData.value = res.rendered;
  } catch {
    previewData.value = '(Không thể tải xem trước)';
  } finally {
    previewLoading.value = false;
  }
}

async function doSend() {
  if (!selectedBlock.value || !props.conversationId) return;
  sending.value = true;
  try {
    await sendBlock(selectedBlock.value.id, { conversationId: props.conversationId });
    snack.value = { show: true, text: 'Đã gửi khối!', color: 'success' };
    previewDialog.value = false;
    emit('sent');
    emit('close');
  } catch {
    snack.value = { show: true, text: 'Gửi thất bại', color: 'error' };
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.block-picker-popup {
  position: absolute;
  bottom: 100%;
  left: 0;
  z-index: 200;
  margin-bottom: 4px;
}
</style>
