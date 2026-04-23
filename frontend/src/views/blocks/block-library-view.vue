<template>
  <div>
    <!-- Toolbar -->
    <div class="d-flex align-center flex-wrap ga-2 mb-4">
      <v-text-field
        v-model="search"
        placeholder="Tìm kiếm khối..."
        variant="outlined"
        density="compact"
        hide-details
        prepend-inner-icon="mdi-magnify"
        clearable
        style="max-width: 280px;"
        @update:model-value="onSearch"
      />
      <v-chip-group v-model="typeFilter" class="flex-grow-1">
        <v-chip value="" variant="tonal">Tất cả</v-chip>
        <v-chip v-for="t in TYPES" :key="t.value" :value="t.value" variant="tonal">{{ t.label }}</v-chip>
      </v-chip-group>
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="goCreate">
        Khối mới
      </v-btn>
    </div>

    <!-- Loading -->
    <v-progress-linear v-if="store.loading" indeterminate color="primary" class="mb-3" />

    <!-- Grid -->
    <div v-if="store.blocks.length" class="blocks-grid">
      <BlockCard
        v-for="block in store.blocks"
        :key="block.id"
        :block="block"
        @edit="goEdit"
        @duplicate="duplicateBlock"
        @delete="confirmDelete"
      />
    </div>

    <!-- Empty state -->
    <div v-else-if="!store.loading" class="d-flex flex-column align-center justify-center py-16 text-grey">
      <v-icon size="72" color="grey-lighten-2">mdi-package-variant-closed</v-icon>
      <p class="text-h6 mt-4">Chưa có khối nội dung nào</p>
      <v-btn v-if="authStore.isAdmin" color="primary" class="mt-2" prepend-icon="mdi-plus" @click="goCreate">
        Tạo khối đầu tiên
      </v-btn>
    </div>

    <!-- Delete confirm -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Xóa khối nội dung?</v-card-title>
        <v-card-text>Khối sẽ bị xóa mềm và không thể phục hồi từ giao diện.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Hủy</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">{{ snack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useBlocksStore } from '@/stores/blocks';
import { useAuthStore } from '@/stores/auth';
import { createBlock } from '@/api/blocks-api';
import BlockCard from '@/components/blocks/block-card.vue';

const store = useBlocksStore();
const authStore = useAuthStore();
const router = useRouter();

const search = ref('');
const typeFilter = ref('');
const deleteDialog = ref(false);
const deleting = ref(false);
const pendingDeleteId = ref<string | null>(null);
const snack = ref({ show: false, text: '', color: 'success' });

const TYPES = [
  { value: 'text', label: 'Văn bản' },
  { value: 'html', label: 'HTML' },
  { value: 'image', label: 'Hình ảnh' },
  { value: 'video', label: 'Video' },
  { value: 'file', label: 'Tệp' },
  { value: 'link', label: 'Liên kết' },
  { value: 'card', label: 'Card' },
];

onMounted(() => loadBlocks());

watch(typeFilter, () => loadBlocks());

let searchTimer: ReturnType<typeof setTimeout>;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadBlocks(), 300);
}

async function loadBlocks() {
  await store.fetch({
    q: search.value || undefined,
    type: (typeFilter.value as import('@/api/blocks-api').BlockType) || undefined,
  });
}

function goCreate() { router.push('/blocks/new'); }
function goEdit(id: string) { router.push(`/blocks/${id}`); }

async function duplicateBlock(id: string) {
  const src = store.blocks.find((b) => b.id === id);
  if (!src) return;
  try {
    await createBlock({ name: `${src.name} (bản sao)`, type: src.type, content: src.content, isShared: src.isShared });
    await loadBlocks();
    snack.value = { show: true, text: 'Đã tạo bản sao!', color: 'success' };
  } catch {
    snack.value = { show: true, text: 'Tạo bản sao thất bại', color: 'error' };
  }
}

function confirmDelete(id: string) {
  pendingDeleteId.value = id;
  deleteDialog.value = true;
}

async function doDelete() {
  if (!pendingDeleteId.value) return;
  deleting.value = true;
  const ok = await store.remove(pendingDeleteId.value);
  deleting.value = false;
  deleteDialog.value = false;
  snack.value = { show: true, text: ok ? 'Đã xóa khối' : 'Xóa thất bại', color: ok ? 'success' : 'error' };
}
</script>

<style scoped>
.blocks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
</style>
